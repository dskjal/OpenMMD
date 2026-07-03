import { mat4, vec3 } from '../../lib/esm/index.js';
import { createCameraEye } from '../../core/scene/camera.js';
import {
  clamp,
  computeAabbFromPoints,
  getAabbCenter,
  getAabbCorners,
  getAabbSize,
  mat4LookAt,
  mat4Ortho,
  normalize,
  transformPoint,
} from '../../shared/math/math-utils.js';
import { getDefaultsSnapshot } from '../config/defaults/defaults-manager.js';

const SHADOW_MANAGER_DEFAULTS_SECTION = 'shadowManager';

/**
 * カスケードシャドウマップ管理オブジェクトを作成します。
 * @param {object} [options={}] - 設定。
 * @param {number} [options.cascadeCount=4] - カスケード数。
 * @param {number} [options.cameraNear=0.1] - カメラ near。
 * @param {number} [options.cameraFar=1000] - カメラ far。
 * @param {boolean} [options.autoFar=true] - visible depth から far を自動算出するか。
 * @param {number} [options.lambda=0.75] - practical split の補間係数。
 * @param {number} [options.shadowMapSize=2048] - 1 cascade あたりの shadow map 解像度。
 * @param {number} [options.padding=0.5] - light frustum の安全マージン。
 * @returns {object} shadow manager。
 */
export function createShadowManager(options = {}) {
  const state = createShadowState(options);
  const api = {
    /**
     * shadow 用のカスケード情報を更新します。
     * @param {object} params - 更新パラメータ。
     * @param {object} params.camera - カメラ状態。
     * @param {{min: number[], max: number[]} | null} params.sceneBounds - シーン境界。
     * @param {ArrayLike<number>} params.lightDirection - 方向光の向き。
     * @param {number} params.aspect - アスペクト比。
     * @param {{near: number, far: number} | null} [params.clipPlanes=null] - 主カメラの clip plane。
     * @returns {object} shadow manager。
     */
    update({ camera, sceneBounds, lightDirection, aspect, clipPlanes = null }) {
      const updated = computeCascadedShadowData(camera, sceneBounds, lightDirection, aspect, state, clipPlanes);
      state.cascadeCount = updated.cascadeCount;
      state.cascadeSplits.set(updated.cascadeSplits);
      state.cascadeMatrices = updated.cascadeMatrices;
      state.lightView = updated.lightView;
      state.lightDirection = updated.lightDirection;
      state.lightFocus = updated.lightFocus;
      state.lightUp = updated.lightUp;
      return api;
    },
    getState() {
      return state;
    },
    getCascadeCount() {
      return state.cascadeCount;
    },
    getCascadeSplits() {
      return state.cascadeSplits;
    },
    getCascadeMatrices() {
      return state.cascadeMatrices;
    },
  };
  return api;
}

/**
 * shadow manager の内部状態を初期化します。
 * @param {object} options - 設定。
 * @returns {object} 内部状態。
 */
function createShadowState(options) {
  const defaults = getDefaultsSnapshot(SHADOW_MANAGER_DEFAULTS_SECTION);
  const cascadeCount = clamp(Math.floor(options.cascadeCount ?? defaults.cascadeCount ?? 4), 1, 4);
  return {
    cascadeCount,
    cameraNear: options.cameraNear ?? defaults.cameraNear ?? 0.1,
    cameraFar: options.cameraFar ?? defaults.cameraFar ?? 1000.0,
    autoFar: options.autoFar ?? defaults.autoFar ?? true,
    lambda: options.lambda ?? defaults.lambda ?? 0.75,
    shadowMapSize: options.shadowMapSize ?? defaults.shadowMapSize ?? 2048,
    padding: options.padding ?? defaults.padding ?? 0.5,
    cascadeSplits: new Float32Array(4),
    cascadeMatrices: Array.from({ length: 4 }, () => mat4.create()),
    lightView: mat4.create(),
    lightDirection: vec3.fromValues(0, -1, 0),
    lightFocus: vec3.create(),
    lightUp: vec3.fromValues(0, 1, 0),
  };
}

/**
 * カスケード split を計算します。
 * @param {number} near - 近距離。
 * @param {number} far - 遠距離。
 * @param {number} cascadeCount - カスケード数。
 * @param {number} lambda - linear / logarithmic の補間係数。
 * @returns {Float32Array} split 距離。
 */
export function computeCascadeSplits(near, far, cascadeCount, lambda) {
  const splits = new Float32Array(4);
  const clampedLambda = clamp(lambda, 0, 1);
  const safeNear = Math.max(near, 0.001);
  const safeFar = Math.max(far, safeNear + 0.001);

  for (let i = 0; i < cascadeCount; i++) {
    const ratio = (i + 1) / cascadeCount;
    const log = safeNear * Math.pow(safeFar / safeNear, ratio);
    const linear = safeNear + (safeFar - safeNear) * ratio;
    splits[i] = linear * (1 - clampedLambda) + log * clampedLambda;
  }

  splits[cascadeCount - 1] = safeFar;
  return splits;
}

/**
 * カメラ frustum と scene bounds の交差頂点を求めます。
 * @param {ArrayLike<number>} cameraEye - カメラ位置。
 * @param {ArrayLike<number>} cameraCenter - カメラ注視点。
 * @param {ArrayLike<number>} cameraUp - カメラ上方向。
 * @param {number} fovY - 縦 FOV。
 * @param {number} aspect - アスペクト比。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @param {object} state - shadow state。
 * @param {{near: number, far: number} | null} [clipPlanes=null] - 主カメラの clip plane。
 * @returns {Array<number[]>} 交差頂点。
 */
function computeVisibleSceneIntersectionVertices(
  cameraEye,
  cameraCenter,
  cameraUp,
  fovY,
  aspect,
  sceneBounds,
  state,
  clipPlanes = null,
) {
  if (!sceneBounds) {
    return [];
  }

  const cameraForward = normalize(vec3.sub(vec3.create(), cameraCenter, cameraEye));
  if (!cameraForward) {
    return [];
  }

  const cameraRight = normalize(vec3.cross(vec3.create(), cameraForward, cameraUp));
  if (!cameraRight) {
    return [];
  }

  const clipNear = Math.max(0.001, clipPlanes?.near ?? state.cameraNear);
  const clipFar = Math.max(clipNear + 0.001, clipPlanes?.far ?? state.cameraFar);
  return computeCascadeSlabSceneIntersectionVertices(
    cameraEye,
    cameraForward,
    cameraRight,
    cameraUp,
    fovY,
    aspect,
    clipNear,
    clipFar,
    sceneBounds,
  );
}

/**
 * カメラと scene bounds からカスケード shadow データを計算します。
 * @param {object} camera - カメラ状態。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @param {ArrayLike<number>} lightDirection - 方向光の向き。
 * @param {number} aspect - アスペクト比。
 * @param {object} state - shadow state。
 * @param {{near: number, far: number} | null} [clipPlanes=null] - 主カメラの clip plane。
 * @returns {object} shadow 計算結果。
 */
export function computeCascadedShadowData(camera, sceneBounds, lightDirection, aspect, state, clipPlanes = null) {
  const cascadeCount = state.cascadeCount;
  const cameraEye = createCameraEye(camera);
  const cameraCenter = camera.center;
  const cameraForward = normalize(vec3.sub(vec3.create(), cameraCenter, cameraEye));
  const worldUp = Math.abs(vec3.dot(cameraForward, vec3.fromValues(0, 1, 0))) > 0.95
    ? vec3.fromValues(0, 0, 1)
    : vec3.fromValues(0, 1, 0);
  const cameraRight = normalize(vec3.cross(vec3.create(), cameraForward, worldUp));
  const cameraUp = normalize(vec3.cross(vec3.create(), cameraRight, cameraForward));
  const fovY = camera.fovY ?? (45 * Math.PI / 180);
  const visibleScenePoints = computeVisibleSceneIntersectionVertices(
    cameraEye,
    cameraCenter,
    cameraUp,
    fovY,
    aspect,
    sceneBounds,
    state,
    clipPlanes,
  );
  const visibleSceneBounds = visibleScenePoints.length > 0
    ? computeAabbFromPoints(visibleScenePoints)
    : sceneBounds;
  const visibleDepthRange = computeVisibleDepthRange(
    cameraEye,
    cameraCenter,
    cameraUp,
    fovY,
    aspect,
    sceneBounds,
    state,
    clipPlanes,
    visibleScenePoints,
  );

  const direction = normalize(vec3.fromValues(lightDirection[0], lightDirection[1], lightDirection[2]));
  const focusPoint = visibleSceneBounds ? getAabbCenter(visibleSceneBounds) : cameraCenter;
  const focusSize = visibleSceneBounds
    ? getAabbSize(visibleSceneBounds)
    : [camera.distance, camera.distance, camera.distance];
  const focusDistance = Math.max(
    Math.max(focusSize[0], focusSize[1], focusSize[2]) * 2,
    visibleDepthRange.far * 2,
    camera.distance,
    10,
  );
  const lightEye = [
    focusPoint[0] - direction[0] * focusDistance,
    focusPoint[1] - direction[1] * focusDistance,
    focusPoint[2] - direction[2] * focusDistance,
  ];

  const lightUpReference = Math.abs(vec3.dot(direction, vec3.fromValues(0, 1, 0))) > 0.95
    ? vec3.fromValues(0, 0, 1)
    : vec3.fromValues(0, 1, 0);
  const lightRight = normalize(vec3.cross(vec3.create(), direction, lightUpReference));
  const lightUp = normalize(vec3.cross(vec3.create(), lightRight, direction));
  const lightView = mat4LookAt(lightEye, focusPoint, lightUp);
  const cascadeSplits = computeCascadeSplits(visibleDepthRange.near, visibleDepthRange.far, cascadeCount, state.lambda);
  const cascadeMatrices = Array.from({ length: 4 }, (_, index) => state.cascadeMatrices[index] || mat4.create());
  const sceneLightPoints = visibleScenePoints.length > 0
    ? visibleScenePoints.map((corner) => transformPoint(lightView, corner))
    : sceneBounds
      ? getAabbCorners(sceneBounds).map((corner) => transformPoint(lightView, corner))
    : [];

  let previousSplit = visibleDepthRange.near;
  for (let i = 0; i < cascadeCount; i++) {
    const splitFar = cascadeSplits[i];
    const frustumCorners = getFrustumSliceCorners(
      cameraEye,
      cameraForward,
      cameraRight,
      cameraUp,
      fovY,
      aspect,
      previousSplit,
      splitFar,
    );

    const intersectionPoints = computeCascadeSlabSceneIntersectionVertices(
      cameraEye,
      cameraForward,
      cameraRight,
      cameraUp,
      fovY,
      aspect,
      previousSplit,
      splitFar,
      visibleSceneBounds,
    );
    const boundsPoints = intersectionPoints.length > 0 ? intersectionPoints : frustumCorners;
    const lightPoints = boundsPoints.map((corner) => transformPoint(lightView, corner));
    const lightBounds = computeAabbFromPoints(lightPoints);

    const centerX = (lightBounds.min[0] + lightBounds.max[0]) * 0.5;
    const centerY = (lightBounds.min[1] + lightBounds.max[1]) * 0.5;
    const halfWidth = Math.max((lightBounds.max[0] - lightBounds.min[0]) * 0.5 + state.padding, 0.5);
    const halfHeight = Math.max((lightBounds.max[1] - lightBounds.min[1]) * 0.5 + state.padding, 0.5);

    const texelSizeX = halfWidth * 2 / state.shadowMapSize;
    const texelSizeY = halfHeight * 2 / state.shadowMapSize;
    const snappedCenterX = texelSizeX > 0 ? Math.round(centerX / texelSizeX) * texelSizeX : centerX;
    const snappedCenterY = texelSizeY > 0 ? Math.round(centerY / texelSizeY) * texelSizeY : centerY;

    const left = snappedCenterX - halfWidth;
    const right = snappedCenterX + halfWidth;
    const bottom = snappedCenterY - halfHeight;
    const top = snappedCenterY + halfHeight;
    const zBounds = computeAabbFromPoints(sceneLightPoints.length > 0 ? sceneLightPoints : lightPoints);
    const near = Math.max(0.001, -zBounds.max[2] - state.padding);
    const far = Math.max(near + 0.001, -zBounds.min[2] + state.padding);

    const lightProj = mat4Ortho(left, right, bottom, top, near, far);
    mat4.multiply(cascadeMatrices[i], lightProj, lightView);
    previousSplit = splitFar;
  }

  return {
    cascadeCount,
    cascadeSplits,
    cascadeMatrices,
    lightView,
    lightDirection: direction,
    lightFocus: focusPoint,
    lightUp,
  };
}

/**
 * カスケード slab と scene AABB の交差多面体の頂点を求めます。
 * @param {ArrayLike<number>} eye - カメラ位置。
 * @param {ArrayLike<number>} forward - カメラ正面方向。
 * @param {ArrayLike<number>} right - カメラ右方向。
 * @param {ArrayLike<number>} up - カメラ上方向。
 * @param {number} fovY - 縦 FOV。
 * @param {number} aspect - アスペクト比。
 * @param {number} nearDistance - cascade の near。
 * @param {number} farDistance - cascade の far。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @returns {Array<number[]>} 交差多面体の頂点。
 */
export function computeCascadeSlabSceneIntersectionVertices(
  eye,
  forward,
  right,
  up,
  fovY,
  aspect,
  nearDistance,
  farDistance,
  sceneBounds,
) {
  const frustumPlanes = createFrustumSlicePlanes(eye, forward, right, up, fovY, aspect, nearDistance, farDistance);
  const planes = sceneBounds ? [...frustumPlanes, ...createAabbPlanes(sceneBounds)] : frustumPlanes;
  return computeConvexPolyhedronVertices(planes);
}

/**
 * 指定 frustum slice の 6 平面を作成します。
 * @param {ArrayLike<number>} eye - カメラ位置。
 * @param {ArrayLike<number>} forward - カメラ正面方向。
 * @param {ArrayLike<number>} right - カメラ右方向。
 * @param {ArrayLike<number>} up - カメラ上方向。
 * @param {number} fovY - 縦 FOV。
 * @param {number} aspect - アスペクト比。
 * @param {number} nearDistance - 近距離。
 * @param {number} farDistance - 遠距離。
 * @returns {Array<{normal: number[], constant: number}>} 平面配列。
 */
function createFrustumSlicePlanes(eye, forward, right, up, fovY, aspect, nearDistance, farDistance) {
  const nearHeight = 2 * Math.tan(fovY * 0.5) * nearDistance;
  const nearWidth = nearHeight * aspect;
  const farHeight = 2 * Math.tan(fovY * 0.5) * farDistance;
  const farWidth = farHeight * aspect;
  const nearCenter = [
    eye[0] + forward[0] * nearDistance,
    eye[1] + forward[1] * nearDistance,
    eye[2] + forward[2] * nearDistance,
  ];
  const farCenter = [
    eye[0] + forward[0] * farDistance,
    eye[1] + forward[1] * farDistance,
    eye[2] + forward[2] * farDistance,
  ];
  const nearTopLeft = [
    nearCenter[0] - right[0] * nearWidth * 0.5 + up[0] * nearHeight * 0.5,
    nearCenter[1] - right[1] * nearWidth * 0.5 + up[1] * nearHeight * 0.5,
    nearCenter[2] - right[2] * nearWidth * 0.5 + up[2] * nearHeight * 0.5,
  ];
  const nearTopRight = [
    nearCenter[0] + right[0] * nearWidth * 0.5 + up[0] * nearHeight * 0.5,
    nearCenter[1] + right[1] * nearWidth * 0.5 + up[1] * nearHeight * 0.5,
    nearCenter[2] + right[2] * nearWidth * 0.5 + up[2] * nearHeight * 0.5,
  ];
  const nearBottomLeft = [
    nearCenter[0] - right[0] * nearWidth * 0.5 - up[0] * nearHeight * 0.5,
    nearCenter[1] - right[1] * nearWidth * 0.5 - up[1] * nearHeight * 0.5,
    nearCenter[2] - right[2] * nearWidth * 0.5 - up[2] * nearHeight * 0.5,
  ];
  const nearBottomRight = [
    nearCenter[0] + right[0] * nearWidth * 0.5 - up[0] * nearHeight * 0.5,
    nearCenter[1] + right[1] * nearWidth * 0.5 - up[1] * nearHeight * 0.5,
    nearCenter[2] + right[2] * nearWidth * 0.5 - up[2] * nearHeight * 0.5,
  ];
  const centerPoint = [
    eye[0] + forward[0] * ((nearDistance + farDistance) * 0.5),
    eye[1] + forward[1] * ((nearDistance + farDistance) * 0.5),
    eye[2] + forward[2] * ((nearDistance + farDistance) * 0.5),
  ];
  return [
    createOrientedPlaneFromPoint(nearCenter, forward, centerPoint),
    createOrientedPlaneFromPoint(farCenter, vec3.scale(vec3.create(), forward, -1), centerPoint),
    createOrientedPlaneFromPoints(eye, nearBottomLeft, nearTopLeft, centerPoint),
    createOrientedPlaneFromPoints(eye, nearTopRight, nearBottomRight, centerPoint),
    createOrientedPlaneFromPoints(eye, nearTopLeft, nearTopRight, centerPoint),
    createOrientedPlaneFromPoints(eye, nearBottomRight, nearBottomLeft, centerPoint),
  ];
}

/**
 * AABB を表す 6 平面を作成します。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @returns {Array<{normal: number[], constant: number}>} 平面配列。
 */
function createAabbPlanes(aabb) {
  return [
    { normal: [1, 0, 0], constant: -aabb.min[0] },
    { normal: [-1, 0, 0], constant: aabb.max[0] },
    { normal: [0, 1, 0], constant: -aabb.min[1] },
    { normal: [0, -1, 0], constant: aabb.max[1] },
    { normal: [0, 0, 1], constant: -aabb.min[2] },
    { normal: [0, 0, -1], constant: aabb.max[2] },
  ];
}

/**
 * 3 点から向き付き平面を作成します。
 * @param {ArrayLike<number>} a - 点 A。
 * @param {ArrayLike<number>} b - 点 B。
 * @param {ArrayLike<number>} c - 点 C。
 * @param {ArrayLike<number>} insidePoint - 平面の内側判定に使う点。
 * @returns {{normal: number[], constant: number}} 平面。
 */
function createOrientedPlaneFromPoints(a, b, c, insidePoint) {
  const ab = vec3.sub(vec3.create(), b, a);
  const ac = vec3.sub(vec3.create(), c, a);
  const normal = normalize(vec3.cross(vec3.create(), ab, ac));
  const plane = {
    normal: Array.from(normal),
    constant: -vec3.dot(normal, a),
  };
  if (!isPointInsidePlane(insidePoint, plane)) {
    plane.normal[0] = -plane.normal[0];
    plane.normal[1] = -plane.normal[1];
    plane.normal[2] = -plane.normal[2];
    plane.constant = -plane.constant;
  }
  return plane;
}

/**
 * 点と法線から向き付き平面を作成します。
 * @param {ArrayLike<number>} point - 平面上の点。
 * @param {ArrayLike<number>} normal - 法線。
 * @param {ArrayLike<number>} insidePoint - 平面の内側判定に使う点。
 * @returns {{normal: number[], constant: number}} 平面。
 */
function createOrientedPlaneFromPoint(point, normal, insidePoint) {
  const normalized = normalize(vec3.fromValues(normal[0], normal[1], normal[2]));
  const plane = {
    normal: Array.from(normalized),
    constant: -vec3.dot(normalized, point),
  };
  if (!isPointInsidePlane(insidePoint, plane)) {
    plane.normal[0] = -plane.normal[0];
    plane.normal[1] = -plane.normal[1];
    plane.normal[2] = -plane.normal[2];
    plane.constant = -plane.constant;
  }
  return plane;
}

/**
 * 3 平面の交点を求めます。
 * @param {{normal: number[], constant: number}} planeA - 平面 A。
 * @param {{normal: number[], constant: number}} planeB - 平面 B。
 * @param {{normal: number[], constant: number}} planeC - 平面 C。
 * @returns {number[] | null} 交点。
 */
function intersectThreePlanes(planeA, planeB, planeC) {
  const n1 = planeA.normal;
  const n2 = planeB.normal;
  const n3 = planeC.normal;
  const det = vec3.dot(n1, vec3.cross(vec3.create(), n2, n3));
  if (Math.abs(det) < 1e-8) {
    return null;
  }
  const term1 = vec3.scale(vec3.create(), vec3.cross(vec3.create(), n2, n3), -planeA.constant);
  const term2 = vec3.scale(vec3.create(), vec3.cross(vec3.create(), n3, n1), -planeB.constant);
  const term3 = vec3.scale(vec3.create(), vec3.cross(vec3.create(), n1, n2), -planeC.constant);
  const point = vec3.add(vec3.create(), term1, term2);
  vec3.add(point, point, term3);
  vec3.scale(point, point, 1 / det);
  return Array.from(point);
}

/**
 * 複数平面で囲まれた凸多面体の頂点を求めます。
 * @param {Array<{normal: number[], constant: number}>} planes - 平面配列。
 * @returns {Array<number[]>} 頂点配列。
 */
function computeConvexPolyhedronVertices(planes) {
  const vertices = [];
  const epsilon = 1e-5;
  for (let i = 0; i < planes.length - 2; i++) {
    for (let j = i + 1; j < planes.length - 1; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const point = intersectThreePlanes(planes[i], planes[j], planes[k]);
        if (!point) {
          continue;
        }
        if (!isPointInsidePlanes(point, planes, epsilon)) {
          continue;
        }
        if (!hasSimilarPoint(vertices, point, epsilon)) {
          vertices.push(point);
        }
      }
    }
  }
  return vertices;
}

/**
 * 点が全平面の内側にあるか判定します。
 * @param {ArrayLike<number>} point - 判定対象点。
 * @param {Array<{normal: number[], constant: number}>} planes - 平面配列。
 * @param {number} epsilon - 許容誤差。
 * @returns {boolean} 内側なら true。
 */
function isPointInsidePlanes(point, planes, epsilon) {
  for (const plane of planes) {
    if (!isPointInsidePlane(point, plane, epsilon)) {
      return false;
    }
  }
  return true;
}

/**
 * 点が平面の内側にあるか判定します。
 * @param {ArrayLike<number>} point - 判定対象点。
 * @param {{normal: number[], constant: number}} plane - 平面。
 * @param {number} [epsilon=1e-5] - 許容誤差。
 * @returns {boolean} 内側なら true。
 */
function isPointInsidePlane(point, plane, epsilon = 1e-5) {
  return vec3.dot(plane.normal, point) + plane.constant >= -epsilon;
}

/**
 * 既存頂点に十分近い点があるか判定します。
 * @param {Array<number[]>} vertices - 既存頂点。
 * @param {ArrayLike<number>} point - 比較対象。
 * @param {number} epsilon - 許容誤差。
 * @returns {boolean} 近い点があれば true。
 */
function hasSimilarPoint(vertices, point, epsilon) {
  const epsilonSq = epsilon * epsilon;
  for (const vertex of vertices) {
    const dx = vertex[0] - point[0];
    const dy = vertex[1] - point[1];
    const dz = vertex[2] - point[2];
    if (dx * dx + dy * dy + dz * dz <= epsilonSq) {
      return true;
    }
  }
  return false;
}

/**
 * シーン境界からカメラ前方に見えている深度範囲を求めます。
 * @param {ArrayLike<number>} cameraEye - カメラ位置。
 * @param {ArrayLike<number>} cameraCenter - カメラ注視点。
 * @param {ArrayLike<number>} cameraUp - カメラ上方向。
 * @param {number} fovY - 縦 FOV。
 * @param {number} aspect - アスペクト比。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @param {object} state - shadow state。
 * @param {{near: number, far: number} | null} [clipPlanes=null] - 主カメラの clip plane。
 * @param {Array<number[]>|null} [visibleScenePoints=null] - 既に算出済みの可視交差頂点。
 * @returns {{near: number, far: number}} 深度範囲。
 */
export function computeVisibleDepthRange(
  cameraEye,
  cameraCenter,
  cameraUp,
  fovY,
  aspect,
  sceneBounds,
  state,
  clipPlanes = null,
  visibleScenePoints = null,
) {
  const clipNear = Math.max(
    0.001,
    clipPlanes?.near ?? state.cameraNear,
  );
  const clipFar = Math.max(
    clipNear + 0.001,
    clipPlanes?.far ?? state.cameraFar,
  );

  if (!state.autoFar || !sceneBounds) {
    return {
      near: clipNear,
      far: clipFar,
    };
  }

  const intersectionPoints = Array.isArray(visibleScenePoints) && visibleScenePoints.length > 0
    ? visibleScenePoints
    : computeVisibleSceneIntersectionVertices(
      cameraEye,
      cameraCenter,
      cameraUp,
      fovY,
      aspect,
      sceneBounds,
      state,
      clipPlanes,
    );
  if (intersectionPoints.length === 0) {
    return {
      near: clipNear,
      far: clipFar,
    };
  }

  const view = mat4LookAt(cameraEye, cameraCenter, cameraUp);
  let minDepth = Infinity;
  let maxDepth = 0;

  for (const corner of intersectionPoints) {
    const viewPoint = transformPoint(view, corner);
    const depth = -viewPoint[2];
    if (depth <= 0) {
      continue;
    }
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }

  if (!Number.isFinite(minDepth) || maxDepth <= 0) {
    return {
      near: clipNear,
      far: clipFar,
    };
  }

  const cameraInsideSceneBounds = isPointInsideAabb(cameraEye, sceneBounds);
  const near = cameraInsideSceneBounds
    ? clipNear
    : clamp(minDepth - state.padding * 2, clipNear, clipFar - 0.001);
  const far = clamp(maxDepth + state.padding * 2, near + 0.001, clipFar);
  return { near, far };
}

/**
 * 点が AABB の内側にあるか判定します。
 * @param {ArrayLike<number>} point - 判定対象点。
 * @param {{min: number[], max: number[]}} aabb - AABB。
 * @returns {boolean} 内側なら true。
 */
function isPointInsideAabb(point, aabb) {
  return point[0] >= aabb.min[0] && point[0] <= aabb.max[0]
    && point[1] >= aabb.min[1] && point[1] <= aabb.max[1]
    && point[2] >= aabb.min[2] && point[2] <= aabb.max[2];
}

/**
 * 指定区間の camera frustum を world space の 8 頂点に展開します。
 * @param {ArrayLike<number>} eye - カメラ位置。
 * @param {ArrayLike<number>} forward - 正面方向。
 * @param {ArrayLike<number>} right - 右方向。
 * @param {ArrayLike<number>} up - 上方向。
 * @param {number} fovY - 縦 FOV。
 * @param {number} aspect - アスペクト比。
 * @param {number} nearDistance - 近距離。
 * @param {number} farDistance - 遠距離。
 * @returns {Array<number[]>} 8 頂点。
 */
function getFrustumSliceCorners(eye, forward, right, up, fovY, aspect, nearDistance, farDistance) {
  const nearHeight = 2 * Math.tan(fovY * 0.5) * nearDistance;
  const nearWidth = nearHeight * aspect;
  const farHeight = 2 * Math.tan(fovY * 0.5) * farDistance;
  const farWidth = farHeight * aspect;

  const nearCenter = [
    eye[0] + forward[0] * nearDistance,
    eye[1] + forward[1] * nearDistance,
    eye[2] + forward[2] * nearDistance,
  ];
  const farCenter = [
    eye[0] + forward[0] * farDistance,
    eye[1] + forward[1] * farDistance,
    eye[2] + forward[2] * farDistance,
  ];

  return [
    [
      nearCenter[0] - right[0] * nearWidth * 0.5 + up[0] * nearHeight * 0.5,
      nearCenter[1] - right[1] * nearWidth * 0.5 + up[1] * nearHeight * 0.5,
      nearCenter[2] - right[2] * nearWidth * 0.5 + up[2] * nearHeight * 0.5,
    ],
    [
      nearCenter[0] + right[0] * nearWidth * 0.5 + up[0] * nearHeight * 0.5,
      nearCenter[1] + right[1] * nearWidth * 0.5 + up[1] * nearHeight * 0.5,
      nearCenter[2] + right[2] * nearWidth * 0.5 + up[2] * nearHeight * 0.5,
    ],
    [
      nearCenter[0] - right[0] * nearWidth * 0.5 - up[0] * nearHeight * 0.5,
      nearCenter[1] - right[1] * nearWidth * 0.5 - up[1] * nearHeight * 0.5,
      nearCenter[2] - right[2] * nearWidth * 0.5 - up[2] * nearHeight * 0.5,
    ],
    [
      nearCenter[0] + right[0] * nearWidth * 0.5 - up[0] * nearHeight * 0.5,
      nearCenter[1] + right[1] * nearWidth * 0.5 - up[1] * nearHeight * 0.5,
      nearCenter[2] + right[2] * nearWidth * 0.5 - up[2] * nearHeight * 0.5,
    ],
    [
      farCenter[0] - right[0] * farWidth * 0.5 + up[0] * farHeight * 0.5,
      farCenter[1] - right[1] * farWidth * 0.5 + up[1] * farHeight * 0.5,
      farCenter[2] - right[2] * farWidth * 0.5 + up[2] * farHeight * 0.5,
    ],
    [
      farCenter[0] + right[0] * farWidth * 0.5 + up[0] * farHeight * 0.5,
      farCenter[1] + right[1] * farWidth * 0.5 + up[1] * farHeight * 0.5,
      farCenter[2] + right[2] * farWidth * 0.5 + up[2] * farHeight * 0.5,
    ],
    [
      farCenter[0] - right[0] * farWidth * 0.5 - up[0] * farHeight * 0.5,
      farCenter[1] - right[1] * farWidth * 0.5 - up[1] * farHeight * 0.5,
      farCenter[2] - right[2] * farWidth * 0.5 - up[2] * farHeight * 0.5,
    ],
    [
      farCenter[0] + right[0] * farWidth * 0.5 - up[0] * farHeight * 0.5,
      farCenter[1] + right[1] * farWidth * 0.5 - up[1] * farHeight * 0.5,
      farCenter[2] + right[2] * farWidth * 0.5 - up[2] * farHeight * 0.5,
    ],
  ];
}
