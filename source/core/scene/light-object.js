import { quat, vec3 } from '../../lib/esm/index.js';
import { createCameraEye } from './camera.js';
import {
  clamp,
  cross,
  normalize,
  pushLineQuads,
} from '../../shared/math/math-utils.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';

const LIGHT_DEFAULTS_SECTION = 'lightObject';
const LIGHT_ICON_STRIDE = 40;
const LIGHT_ICON_BUFFER_SIZE = 4096 * LIGHT_ICON_STRIDE;
const LIGHT_ICON_RADIUS = 0.42;
const LIGHT_ICON_RAY_START = 0.58;
const LIGHT_ICON_RAY_END = 0.95;
const LIGHT_ICON_RAY_COUNT = 8;
const LIGHT_ICON_PICK_HALF_SIZE = 0.95;
const LIGHT_ICON_WORLD_SIZE = 0.18;
const LIGHT_ICON_RENDER_SCALE = 0.25;
const LIGHT_GIZMO_RENDER_SCALE = 1.0;
const LIGHT_DIRECTION_LINE_START = 0.32;
const LIGHT_DIRECTION_LINE_END = 0.84;
const LIGHT_DIRECTION_LINE_DEFAULT_COLOR = [0.86, 0.66, 0.18];
const LIGHT_ICON_SELECTED_COLOR = [1.0, 0.92, 0.35];
const LIGHT_ICON_DEFAULT_COLOR = [0.95, 0.78, 0.22];
const VMD_LIGHT_POSITION_LENGTH = Math.sqrt(2);
const VMD_LIGHT_FALLBACK_POSITION = [-1, 0, 1];

/**
 * 方向光オブジェクトの初期状態を作成します。
 * @param {object} [initialValues={}] - 初期値。
 * @returns {{position: number[], rotation: quat, direction: number[], uiOverlay: object|null}} ライト状態。
 */
export function createLightObjectState(initialValues = {}) {
  const defaults = getDefaultsSnapshot(LIGHT_DEFAULTS_SECTION);
  const defaultDirection = Array.isArray(defaults.direction) ? normalize(defaults.direction) : normalize([-0.5, -1.0, -0.5]);
  const defaultPosition = Array.isArray(defaults.position) ? defaults.position : [0.8, 1.8, 0.8];
  const direction = normalizeOrDefault(initialValues.direction, defaultDirection);
  const rotation = quat.create();
  quat.rotationTo(rotation, [0, -1, 0], direction);
  quat.normalize(rotation, rotation);
  return {
    position: normalizeVec3(initialValues.position, defaultPosition),
    rotation,
    direction,
    manualPosition: null,
    manualRotation: null,
    manualPoseFrame: null,
    uiOverlay: null,
  };
}

/**
 * ライトオーバーレイ用の GPU 状態を作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {{iconVertexBuffer: object, iconVertexCount: number, directionLineVertexBuffer: object, directionLineVertexCount: number, gizmoVertexBuffer: object, gizmoVertexCount: number}} オーバーレイ状態。
 */
export function createLightOverlayState(device) {
  if (typeof GPUBufferUsage === 'undefined' || typeof device?.createBuffer !== 'function') {
    return {
      iconVertexBuffer: createFallbackVertexBuffer(),
      iconVertexCount: 0,
      directionLineVertexBuffer: createFallbackVertexBuffer(),
      directionLineVertexCount: 0,
      gizmoVertexBuffer: createFallbackVertexBuffer(),
      gizmoVertexCount: 0,
    };
  }

  return {
    iconVertexBuffer: device.createBuffer({
      size: LIGHT_ICON_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    iconVertexCount: 0,
    directionLineVertexBuffer: device.createBuffer({
      size: LIGHT_ICON_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    directionLineVertexCount: 0,
    gizmoVertexBuffer: device.createBuffer({
      size: LIGHT_ICON_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    gizmoVertexCount: 0,
  };
}

/**
 * ライトの方向を更新します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} direction - 新しい方向。
 */
export function setLightDirection(lightObject, direction) {
  if (!lightObject) {
    return;
  }

  const defaults = getDefaultsSnapshot(LIGHT_DEFAULTS_SECTION);
  const fallbackDirection = lightObject.direction
    || (Array.isArray(defaults.direction) ? normalize(defaults.direction) : normalize([-0.5, -1.0, -0.5]));
  const nextDirection = normalizeOrDefault(direction, fallbackDirection);
  const nextRotation = quat.create();
  quat.rotationTo(nextRotation, [0, -1, 0], nextDirection);
  quat.normalize(nextRotation, nextRotation);
  lightObject.direction = nextDirection;
  lightObject.rotation = nextRotation;
}

/**
 * ライトの手動位置を設定します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} position - 設定先位置。
 * @param {number} [frame] - 紐づける frame。
 */
export function setLightManualPosition(lightObject, position, frame) {
  if (!lightObject || !position) {
    return;
  }

  const nextPosition = normalizeVec3(position, lightObject.position || [0, 0, 0]);
  lightObject.manualPosition = nextPosition;
  lightObject.manualPoseFrame = Number.isFinite(frame) ? frame : null;
  setLightPosition(lightObject, nextPosition);
}

/**
 * ライトの手動回転を設定します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} rotation - 設定先 quaternion。
 * @param {number} [frame] - 紐づける frame。
 */
export function setLightManualRotationQuaternion(lightObject, rotation, frame) {
  if (!lightObject || !rotation) {
    return;
  }

  const nextRotation = quat.normalize(quat.create(), rotation);
  lightObject.manualRotation = Array.from(nextRotation);
  lightObject.manualPoseFrame = Number.isFinite(frame) ? frame : null;
  setLightRotationQuaternion(lightObject, nextRotation);
}

/**
 * ライトの手動 position / rotation を設定します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>|null|undefined} position - 設定先位置。
 * @param {ArrayLike<number>|null|undefined} rotation - 設定先 quaternion。
 * @param {number} [frame] - 紐づける frame。
 */
export function setLightManualPose(lightObject, position, rotation, frame) {
  if (!lightObject) {
    return;
  }

  if (position) {
    setLightManualPosition(lightObject, position, frame);
  }
  if (rotation) {
    setLightManualRotationQuaternion(lightObject, rotation, frame);
  }
  if (!position && !rotation) {
    lightObject.manualPoseFrame = Number.isFinite(frame) ? frame : null;
  }
}

/**
 * ライトの手動 pose を解除します。
 * @param {object} lightObject - ライト状態。
 */
export function clearLightManualPose(lightObject) {
  if (!lightObject) {
    return;
  }

  lightObject.manualPosition = null;
  lightObject.manualRotation = null;
  lightObject.manualPoseFrame = null;
}

/**
 * VMD の点光源位置から OpenMMD の directional light direction を近似生成します。
 * 点光源位置は原点から光源へ向かうベクトルとみなし、照射方向はその逆向きを使います。
 * @param {ArrayLike<number>|null|undefined} position - VMD light position。
 * @returns {number[]} directional light direction。
 */
export function createDirectionalLightDirectionFromVmdPosition(position) {
  const fallbackPosition = normalizeVec3(VMD_LIGHT_FALLBACK_POSITION, VMD_LIGHT_FALLBACK_POSITION);
  const safePosition = normalizeVec3(position, fallbackPosition);
  if (Math.hypot(safePosition[0], safePosition[1], safePosition[2]) < 1e-8) {
    return getDefaultLightDirection();
  }
  const normalizedPosition = normalize(safePosition);
  if (!isFiniteVec3(normalizedPosition)) {
    return getDefaultLightDirection();
  }
  return [
    -normalizedPosition[0],
    -normalizedPosition[1],
    -normalizedPosition[2],
  ];
}

/**
 * directional light direction から VMD の点光源位置を近似生成します。
 * @param {ArrayLike<number>|null|undefined} direction - directional light direction。
 * @param {number} [length=VMD_LIGHT_POSITION_LENGTH] - 仮想点光源までの距離。
 * @returns {number[]} VMD light position。
 */
export function createVmdLightPositionFromDirectionalLight(direction, length = VMD_LIGHT_POSITION_LENGTH) {
  const fallbackDirection = getDefaultLightDirection();
  const safeDirection = normalizeOrDefault(direction, fallbackDirection);
  const safeLength = Number.isFinite(length) && length > 0 ? length : VMD_LIGHT_POSITION_LENGTH;
  return [
    -safeDirection[0] * safeLength,
    -safeDirection[1] * safeLength,
    -safeDirection[2] * safeLength,
  ];
}

/**
 * VMD の点光源位置から directional light 用 quaternion を生成します。
 * @param {ArrayLike<number>|null|undefined} position - VMD light position。
 * @returns {quat} directional light rotation。
 */
export function createLightRotationFromVmdPosition(position) {
  const direction = createDirectionalLightDirectionFromVmdPosition(position);
  const rotation = quat.create();
  quat.rotationTo(rotation, [0, -1, 0], direction);
  quat.normalize(rotation, rotation);
  return rotation;
}

/**
 * directional light rotation から VMD の点光源位置を近似生成します。
 * @param {ArrayLike<number>|null|undefined} rotation - directional light rotation quaternion。
 * @param {number} [length=VMD_LIGHT_POSITION_LENGTH] - 仮想点光源までの距離。
 * @returns {number[]} VMD light position。
 */
export function createVmdLightPositionFromRotation(rotation, length = VMD_LIGHT_POSITION_LENGTH) {
  const direction = vec3.transformQuat(vec3.create(), [0, -1, 0], rotation || quat.create());
  return createVmdLightPositionFromDirectionalLight(direction, length);
}

/**
 * VMD light keyframe を directional light state へ正規化します。
 * @param {object|null|undefined} keyframe - 元 keyframe。
 * @returns {{frameNum: number, color: number[], position: number[]|null, direction: number[], rotation: quat, keyedPosition: boolean, keyedRotation: boolean}} 正規化済み keyframe。
 */
export function normalizeVmdLightKeyframe(keyframe) {
  const hasStoredPosition = Boolean(keyframe?.position)
    && typeof keyframe.position.length === 'number'
    && keyframe.position.length >= 3
    && keyframe.keyedPosition !== false;
  const hasStoredRotation = Boolean(keyframe?.rotation)
    && typeof keyframe.rotation.length === 'number'
    && keyframe.rotation.length >= 4;
  const hasStoredDirection = Boolean(keyframe?.direction)
    && typeof keyframe.direction.length === 'number'
    && keyframe.direction.length >= 3;

  let position = null;
  let direction = null;
  let rotation = null;

  if (hasStoredRotation) {
    rotation = quat.normalize(quat.create(), keyframe.rotation);
    direction = normalize(vec3.transformQuat(vec3.create(), [0, -1, 0], rotation));
    position = hasStoredPosition ? normalizeVec3(keyframe.position, VMD_LIGHT_FALLBACK_POSITION) : null;
  } else if (hasStoredDirection) {
    direction = normalizeVec3(keyframe.direction, getDefaultLightDirection());
    position = hasStoredPosition ? normalizeVec3(keyframe.position, VMD_LIGHT_FALLBACK_POSITION) : null;
    rotation = quat.create();
    quat.rotationTo(rotation, [0, -1, 0], direction);
    quat.normalize(rotation, rotation);
  } else {
    position = normalizeVec3(keyframe?.position, VMD_LIGHT_FALLBACK_POSITION);
    direction = createDirectionalLightDirectionFromVmdPosition(position);
    rotation = createLightRotationFromVmdPosition(position);
  }

  return {
    frameNum: Number(keyframe?.frameNum) || 0,
    color: normalizeVec3(keyframe?.color, [1, 1, 1]),
    position,
    direction,
    rotation,
    keyedPosition: hasStoredPosition,
    keyedRotation: hasStoredRotation || hasStoredDirection || hasStoredPosition,
  };
}

/**
 * VMD light keyframe を現在 frame の directional light state に補間します。
 * @param {object|null} lightObject - 反映先 light state。
 * @param {Array<object>|null|undefined} lightKeyframes - VMD light keyframe 列。
 * @param {number} frame - 現在 frame。
 * @param {number[]|null} [lightColor=null] - 反映先 lightColor RGBA。
 * @returns {{color: number[], position: number[]|null, direction: number[], rotation: quat}|null} 適用状態。
 */
export function applyVmdLightKeyframesToLightObject(lightObject, lightKeyframes, frame, lightColor = null) {
  if (!lightObject || !Array.isArray(lightKeyframes) || lightKeyframes.length === 0) {
    return null;
  }

  const currentFrame = Number.isFinite(frame) ? frame : 0;
  const normalizedKeyframes = lightKeyframes.map((keyframe) => normalizeVmdLightKeyframe(keyframe));
  const color = sampleLightColor(normalizedKeyframes, currentFrame);
  const position = sampleLightPosition(normalizedKeyframes, currentFrame, lightObject.position);
  const rotation = sampleLightRotation(normalizedKeyframes, currentFrame, lightObject.rotation);
  const direction = normalize(vec3.transformQuat(vec3.create(), [0, -1, 0], rotation));

  if (position) {
    setLightPosition(lightObject, position);
  }
  setLightRotationQuaternion(lightObject, rotation);
  applyLightManualPose(lightObject, currentFrame);
  if (lightColor && lightColor.length >= 3) {
    lightColor[0] = color[0];
    lightColor[1] = color[1];
    lightColor[2] = color[2];
  }
  return {
    color,
    position: position ? [position[0], position[1], position[2]] : null,
    direction: [direction[0], direction[1], direction[2]],
    rotation,
  };
}

/**
 * ライトの向きを回転差分で更新します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} axis - 回転軸。
 * @param {number} radians - 回転角。
 */
export function rotateLightDirection(lightObject, axis, radians) {
  if (!lightObject || !isVectorLike(axis)) {
    return;
  }

  const delta = quat.setAxisAngle(quat.create(), axis, radians);
  quat.multiply(lightObject.rotation, delta, lightObject.rotation);
  quat.normalize(lightObject.rotation, lightObject.rotation);
  syncLightDirectionFromRotation(lightObject);
}

/**
 * ライトの回転を絶対値で設定します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} rotation - 設定先 quaternion。
 */
export function setLightRotationQuaternion(lightObject, rotation) {
  if (!lightObject || !rotation) {
    return;
  }

  lightObject.rotation = quat.normalize(quat.create(), rotation);
  syncLightDirectionFromRotation(lightObject);
}

/**
 * ライトの回転差分を開始時回転から適用します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} startRotation - ドラッグ開始時回転。
 * @param {ArrayLike<number>} axis - 回転軸。
 * @param {number} radians - 回転角。
 */
export function applyLightRotationDelta(lightObject, startRotation, axis, radians, frame = null) {
  if (!lightObject || !startRotation || !isVectorLike(axis)) {
    return;
  }

  const delta = quat.setAxisAngle(quat.create(), axis, radians);
  const nextRotation = quat.multiply(quat.create(), delta, startRotation);
  quat.normalize(nextRotation, nextRotation);
  setLightManualRotationQuaternion(lightObject, nextRotation, frame);
}

/**
 * ライトをワールド空間で移動します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} delta - 移動差分。
 */
export function translateLightObject(lightObject, delta) {
  if (!lightObject || !isVectorLike(delta)) {
    return;
  }

  lightObject.position[0] += delta[0] || 0;
  lightObject.position[1] += delta[1] || 0;
  lightObject.position[2] += delta[2] || 0;
}

/**
 * ライト位置を絶対値で設定します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} position - 設定先位置。
 */
export function setLightPosition(lightObject, position) {
  if (!lightObject || !position) {
    return;
  }

  lightObject.position[0] = Number.isFinite(position[0]) ? position[0] : lightObject.position[0];
  lightObject.position[1] = Number.isFinite(position[1]) ? position[1] : lightObject.position[1];
  lightObject.position[2] = Number.isFinite(position[2]) ? position[2] : lightObject.position[2];
}

/**
 * ライト移動差分を開始時位置から適用します。
 * @param {object} lightObject - ライト状態。
 * @param {ArrayLike<number>} startPosition - ドラッグ開始時位置。
 * @param {ArrayLike<number>} delta - 移動差分。
 */
export function applyLightTranslationDelta(lightObject, startPosition, delta, frame = null) {
  if (!lightObject || !startPosition || !delta) {
    return;
  }

  setLightManualPosition(lightObject, [
    (startPosition[0] || 0) + (delta[0] || 0),
    (startPosition[1] || 0) + (delta[1] || 0),
    (startPosition[2] || 0) + (delta[2] || 0),
  ], frame);
}

/**
 * 現在 frame の manual pose を lightObject に反映します。
 * frame が一致しない場合は manual pose を解除します。
 * @param {object} lightObject - ライト状態。
 * @param {number} frame - 現在 frame。
 * @returns {boolean} manual pose を適用したかどうか。
 */
export function applyLightManualPose(lightObject, frame) {
  if (!lightObject) {
    return false;
  }

  const hasManualPosition = Array.isArray(lightObject.manualPosition) || ArrayBuffer.isView(lightObject.manualPosition);
  const hasManualRotation = Array.isArray(lightObject.manualRotation) || ArrayBuffer.isView(lightObject.manualRotation);
  if (!hasManualPosition && !hasManualRotation) {
    return false;
  }

  if (!Number.isFinite(lightObject.manualPoseFrame) || lightObject.manualPoseFrame !== frame) {
    clearLightManualPose(lightObject);
    return false;
  }

  if (hasManualPosition) {
    setLightPosition(lightObject, lightObject.manualPosition);
  }
  if (hasManualRotation) {
    setLightRotationQuaternion(lightObject, lightObject.manualRotation);
  }
  return true;
}

/**
 * 現在 frame での light keyframe 保存用 pose を解決します。
 * manual pose が有効ならそれを優先し、無い場合は現在 state をそのまま返します。
 * @param {object|null|undefined} lightObject - ライト状態。
 * @param {number} frame - 現在 frame。
 * @param {'all'|'rotation'} [mode='all'] - 保存対象モード。
 * @returns {{position: number[]|null, direction: number[], rotation: number[], keyedPosition: boolean, keyedRotation: boolean}|null} 保存用 pose。
 */
export function resolveLightKeyframePose(lightObject, frame, mode = 'all') {
  if (!lightObject) {
    return null;
  }

  const saveRotationOnly = mode === 'rotation';
  const position = normalizeVec3(lightObject.position, [0, 0, 0]);
  const direction = normalizeVec3(lightObject.direction, getDefaultLightDirection());
  const rotation = Array.isArray(lightObject.rotation) || ArrayBuffer.isView(lightObject.rotation)
    ? Array.from(lightObject.rotation).slice(0, 4)
    : Array.from(quat.create());

  const hasManualPosition = Array.isArray(lightObject.manualPosition) || ArrayBuffer.isView(lightObject.manualPosition);
  const hasManualRotation = Array.isArray(lightObject.manualRotation) || ArrayBuffer.isView(lightObject.manualRotation);
  const manualActive = Number.isFinite(lightObject.manualPoseFrame) && lightObject.manualPoseFrame === frame;

  if (manualActive) {
    if (hasManualPosition && !saveRotationOnly) {
      const manualPosition = normalizeVec3(lightObject.manualPosition, position);
      position[0] = manualPosition[0];
      position[1] = manualPosition[1];
      position[2] = manualPosition[2];
    }
    if (hasManualRotation) {
      const manualRotation = quat.normalize(quat.create(), lightObject.manualRotation);
      const resolvedDirection = vec3.transformQuat(vec3.create(), [0, -1, 0], manualRotation);
      const normalizedDirection = normalize(resolvedDirection);
      const resolvedPosition = createVmdLightPositionFromRotation(manualRotation);
      rotation[0] = manualRotation[0];
      rotation[1] = manualRotation[1];
      rotation[2] = manualRotation[2];
      rotation[3] = manualRotation[3];
      direction[0] = normalizedDirection[0];
      direction[1] = normalizedDirection[1];
      direction[2] = normalizedDirection[2];
      position[0] = resolvedPosition[0];
      position[1] = resolvedPosition[1];
      position[2] = resolvedPosition[2];
    }
  }

  return {
    position: saveRotationOnly ? null : [position[0], position[1], position[2]],
    direction: [direction[0], direction[1], direction[2]],
    rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
    keyedPosition: !saveRotationOnly,
    keyedRotation: true,
  };
}

/**
 * ライトの icon と gizmo に使う頂点を更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} lightObject - ライト状態。
 * @param {object} selection - 現在の選択状態。
 * @param {object} camera - カメラ状態。
 */
export function updateLightOverlayBuffer(device, lightObject, selection, camera) {
  if (!lightObject?.uiOverlay) {
    return;
  }

  const overlay = lightObject.uiOverlay;
  const iconColor = selection?.selectedLight ? LIGHT_ICON_SELECTED_COLOR : LIGHT_ICON_DEFAULT_COLOR;
  const iconVertices = buildLightIconVertices(lightObject, camera, iconColor);
  overlay.iconVertexCount = iconVertices.length / 10;
  ensureBufferCapacity(device, overlay, 'iconVertexBuffer', iconVertices.length * 4);
  if (overlay.iconVertexCount > 0) {
    device.queue.writeBuffer(overlay.iconVertexBuffer, 0, new Float32Array(iconVertices));
  }

  const directionLineColor = selection?.selectedLight
    ? [1.0, 0.86, 0.28]
    : LIGHT_DIRECTION_LINE_DEFAULT_COLOR;
  const directionLineVertices = buildLightDirectionLineVertices(lightObject, camera, directionLineColor);
  overlay.directionLineVertexCount = directionLineVertices.length / 10;
  ensureBufferCapacity(device, overlay, 'directionLineVertexBuffer', directionLineVertices.length * 4);
  if (overlay.directionLineVertexCount > 0) {
    device.queue.writeBuffer(overlay.directionLineVertexBuffer, 0, new Float32Array(directionLineVertices));
  }

  if (selection?.selectedLight) {
    const gizmoVertices = buildLightGizmoVertices(lightObject, camera);
    overlay.gizmoVertexCount = gizmoVertices.length / 10;
    ensureBufferCapacity(device, overlay, 'gizmoVertexBuffer', gizmoVertices.length * 4);
    if (overlay.gizmoVertexCount > 0) {
      device.queue.writeBuffer(overlay.gizmoVertexBuffer, 0, new Float32Array(gizmoVertices));
    }
  } else {
    overlay.gizmoVertexCount = 0;
  }
}

/**
 * ライト overlay を描画します。
 * @param {GPURenderPassEncoder} pass - レンダーパス。
 * @param {object} lightObject - ライト状態。
 */
export function drawLightOverlay(pass, lightObject) {
  const overlay = lightObject?.uiOverlay;
  if (!overlay) {
    return;
  }

  if (overlay.directionLineVertexCount > 0) {
    pass.setVertexBuffer(0, overlay.directionLineVertexBuffer);
    pass.draw(overlay.directionLineVertexCount, 1, 0, 0);
  }

  if (overlay.iconVertexCount > 0) {
    pass.setVertexBuffer(0, overlay.iconVertexBuffer);
    pass.draw(overlay.iconVertexCount, 1, 0, 0);
  }

  if (overlay.gizmoVertexCount > 0) {
    pass.setVertexBuffer(0, overlay.gizmoVertexBuffer);
    pass.draw(overlay.gizmoVertexCount, 1, 0, 0);
  }
}

/**
 * ライト icon の ray pick を行います。
 * @param {{start: number[], end: number[]}} ray - ピックレイ。
 * @param {object} camera - カメラ状態。
 * @param {object} lightObject - ライト状態。
 * @returns {object|null} ヒット情報。
 */
export function pickLightObject(ray, camera, lightObject) {
  if (!ray || !camera || !lightObject) {
    return null;
  }

  const cameraEye = createCameraEye(camera);
  const { right, up, forward } = getCameraBasis(camera);
  const planeNormal = normalize(vec3.sub(vec3.create(), cameraEye, lightObject.position));
  if (vec3.length(planeNormal) < 1e-6) {
    return null;
  }

  const rayVector = vec3.sub(vec3.create(), ray.end, ray.start);
  const rayLength = vec3.length(rayVector);
  if (rayLength < 1e-6) {
    return null;
  }

  const denom = vec3.dot(planeNormal, rayVector);
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const t = vec3.dot(vec3.sub(vec3.create(), lightObject.position, ray.start), planeNormal) / denom;
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    return null;
  }

  const hitPoint = vec3.add(vec3.create(), ray.start, vec3.scale(vec3.create(), rayVector, t));
  const local = vec3.sub(vec3.create(), hitPoint, lightObject.position);
  const localX = vec3.dot(local, right);
  const localY = vec3.dot(local, up);
  const pickHalfSize = LIGHT_ICON_PICK_HALF_SIZE * getLightObjectScale(cameraEye, lightObject.position);
  if (Math.abs(localX) > pickHalfSize || Math.abs(localY) > pickHalfSize) {
    return null;
  }

  return {
    kind: 'light-object',
    kindRank: 0,
    mode: 'select',
    axis: null,
    hitPoint: [hitPoint[0], hitPoint[1], hitPoint[2]],
    distance: t,
    depth: vec3.dot(vec3.sub(vec3.create(), lightObject.position, cameraEye), forward),
    normal: [planeNormal[0], planeNormal[1], planeNormal[2]],
  };
}

/**
 * ライト gizmo 用の pose を作成します。
 * @param {object} lightObject - ライト状態。
 * @returns {object|null} gizmo pose。
 */
export function resolveLightGizmoPose(lightObject) {
  if (!lightObject) {
    return null;
  }

  return {
    isLightObject: true,
    boneIndices: [],
    referenceBoneIndex: -1,
    position: [lightObject.position[0], lightObject.position[1], lightObject.position[2]],
    displayQuat: quat.create(),
    localBasis: {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0, 1],
    },
    worldAxes: {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0, 1],
    },
    gizmoModes: {
      rotatable: true,
      translatable: true,
    },
  };
}

/**
 * ライト向きをクォータニオンから再同期します。
 * @param {object} lightObject - ライト状態。
 */
export function syncLightDirectionFromRotation(lightObject) {
  if (!lightObject) {
    return;
  }

  const direction = vec3.transformQuat(vec3.create(), [0, -1, 0], lightObject.rotation);
  const normalized = normalize(direction);
  lightObject.direction = normalized;
}

/**
 * ライト icon の頂点を作成します。
 * @param {object} lightObject - ライト状態。
 * @param {object} camera - カメラ状態。
 * @param {Array<number>} color - 色。
 * @returns {Array<number>} 頂点列。
 */
export function buildLightIconVertices(lightObject, camera, color) {
  const cameraEye = createCameraEye(camera);
  const { right, up } = getCameraBasis(camera);
  const scale = getLightObjectScale(cameraEye, lightObject.position) * LIGHT_ICON_RENDER_SCALE;
  const center = lightObject.position;
  const vertices = [];
  const ringRadius = LIGHT_ICON_RADIUS * scale;
  const rayStart = LIGHT_ICON_RAY_START * scale;
  const rayEnd = LIGHT_ICON_RAY_END * scale;
  const rayColor = color || LIGHT_ICON_DEFAULT_COLOR;

  appendBillboardCircle(vertices, center, right, up, ringRadius, rayColor);
  appendSunRays(vertices, center, right, up, rayStart, rayEnd, rayColor);
  return vertices;
}

/**
 * ライト方向を示す線分の頂点を作成します。
 * @param {object} lightObject - ライト状態。
 * @param {object} camera - カメラ状態。
 * @param {Array<number>} [color=LIGHT_DIRECTION_LINE_DEFAULT_COLOR] - 色。
 * @returns {Array<number>} 頂点列。
 */
export function buildLightDirectionLineVertices(lightObject, camera, color = LIGHT_DIRECTION_LINE_DEFAULT_COLOR) {
  const cameraEye = createCameraEye(camera);
  const scale = getLightObjectScale(cameraEye, lightObject.position);
  const defaults = getDefaultsSnapshot(LIGHT_DEFAULTS_SECTION);
  const fallbackDirection = Array.isArray(defaults.direction) ? normalize(defaults.direction) : normalize([-0.5, -1.0, -0.5]);
  const direction = normalizeOrDefault(lightObject?.direction, fallbackDirection);
  const startDistance = LIGHT_DIRECTION_LINE_START * scale;
  const endDistance = LIGHT_DIRECTION_LINE_END * scale;
  const center = lightObject.position;
  const start = [
    center[0] + direction[0] * startDistance,
    center[1] + direction[1] * startDistance,
    center[2] + direction[2] * startDistance,
  ];
  const end = [
    center[0] + direction[0] * endDistance,
    center[1] + direction[1] * endDistance,
    center[2] + direction[2] * endDistance,
  ];
  const vertices = [];
  pushLineQuads(vertices, start, end, color);
  return vertices;
}

/**
 * ライト gizmo の頂点を作成します。
 * @param {object} lightObject - ライト状態。
 * @param {object} camera - カメラ状態。
 * @returns {Array<number>} 頂点列。
 */
export function buildLightGizmoVertices(lightObject, camera) {
  const cameraEye = createCameraEye(camera);
  const { right, up } = getCameraBasis(camera);
  const scale = getLightObjectScale(cameraEye, lightObject.position) * LIGHT_GIZMO_RENDER_SCALE;
  const center = lightObject.position;
  const vertices = [];
  const ringRadius = LIGHT_ICON_RAY_END * scale;
  const rayStart = LIGHT_ICON_RAY_START * scale;
  const rayEnd = LIGHT_ICON_RAY_END * scale;
  const color = [1.0, 0.9, 0.25];

  appendBillboardCircle(vertices, center, right, up, ringRadius, color);
  appendSunRays(vertices, center, right, up, rayStart, rayEnd, color);
  return vertices;
}

/**
 * ライトの表示スケールを返します。
 * @param {ArrayLike<number>} cameraEye - カメラ位置。
 * @param {ArrayLike<number>} lightPosition - ライト位置。
 * @returns {number} スケール値。
 */
export function getLightObjectScale(cameraEye, lightPosition) {
  const distance = Array.isArray(cameraEye) && Array.isArray(lightPosition)
    ? vec3.distance(cameraEye, lightPosition)
    : 1.0;
  return clamp(distance * LIGHT_ICON_WORLD_SIZE, 0.06, 1.25);
}

/**
 * ライト icon の選択状態を解除します。
 * @param {object} selection - 現在の選択状態。
 */
export function clearLightSelection(selection) {
  if (!selection) {
    return;
  }

  selection.selectedLight = false;
}

/**
 * ライト icon を選択します。
 * @param {object} selection - 現在の選択状態。
 */
export function setLightSelection(selection) {
  if (!selection) {
    return;
  }

  selection.selectedLight = true;
  selection.selectedBoneIndex = -1;
  selection.selectedBoneIndices = [];
  selection.activeBoneIndex = -1;
  selection.selectedTargetIndex = -1;
  selection.selectedRigidbodyIndex = -1;
}

function normalizeVec3(value, fallback) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    return [...fallback];
  }
  const normalized = [
    Number.isFinite(value[0]) ? value[0] : fallback[0],
    Number.isFinite(value[1]) ? value[1] : fallback[1],
    Number.isFinite(value[2]) ? value[2] : fallback[2],
  ];
  return normalized;
}

/**
 * ベクトルが有限 3 要素かどうかを返します。
 * @param {ArrayLike<number>|null|undefined} value - 判定対象。
 * @returns {boolean} 有限値ベクトルなら true。
 */
function isFiniteVec3(value) {
  return Boolean(value)
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Number.isFinite(value[2]);
}

function normalizeOrDefault(value, fallback) {
  const vector = normalizeVec3(value, fallback);
  const normalized = normalize(vector);
  if (!isFiniteVec3(normalized)) {
    return [...fallback];
  }
  return normalized;
}

/**
 * 既定の light direction を返します。
 * @returns {number[]} 既定 direction。
 */
function getDefaultLightDirection() {
  const defaults = getDefaultsSnapshot(LIGHT_DEFAULTS_SECTION);
  return Array.isArray(defaults.direction) ? normalize(defaults.direction) : normalize([-0.5, -1.0, -0.5]);
}

/**
 * light keyframe 列から color を線形補間します。
 * @param {Array<object>} keyframes - 正規化済み keyframe 列。
 * @param {number} frame - 現在 frame。
 * @returns {number[]} 補間済み color。
 */
function sampleLightColor(keyframes, frame) {
  return sampleLightVec3Track(keyframes, frame, (keyframe) => keyframe.color, [1, 1, 1]);
}

/**
 * light keyframe 列から position track を解決します。
 * @param {Array<object>} keyframes - 正規化済み keyframe 列。
 * @param {number} frame - 現在 frame。
 * @param {ArrayLike<number>|null|undefined} fallbackPosition - fallback 位置。
 * @returns {number[]|null} 解決済み position。
 */
function sampleLightPosition(keyframes, frame, fallbackPosition) {
  const positionKeyframes = keyframes.filter((keyframe) => keyframe.keyedPosition && keyframe.position);
  if (positionKeyframes.length === 0) {
    return normalizeVec3(fallbackPosition, VMD_LIGHT_FALLBACK_POSITION);
  }
  return sampleLightVec3Track(positionKeyframes, frame, (keyframe) => keyframe.position, VMD_LIGHT_FALLBACK_POSITION);
}

/**
 * light keyframe 列から rotation track を解決します。
 * @param {Array<object>} keyframes - 正規化済み keyframe 列。
 * @param {number} frame - 現在 frame。
 * @param {ArrayLike<number>|null|undefined} fallbackRotation - fallback 回転。
 * @returns {quat} 解決済み rotation。
 */
function sampleLightRotation(keyframes, frame, fallbackRotation) {
  const rotationKeyframes = keyframes.filter((keyframe) => keyframe.keyedRotation && keyframe.rotation);
  if (rotationKeyframes.length === 0) {
    return quat.normalize(quat.create(), fallbackRotation || quat.create());
  }
  if (rotationKeyframes.length === 1) {
    return quat.clone(rotationKeyframes[0].rotation);
  }
  if (frame <= rotationKeyframes[0].frameNum) {
    return quat.clone(rotationKeyframes[0].rotation);
  }

  let startKeyframe = rotationKeyframes[0];
  let endKeyframe = rotationKeyframes[rotationKeyframes.length - 1];
  for (let i = 1; i < rotationKeyframes.length; i++) {
    endKeyframe = rotationKeyframes[i];
    if (frame <= endKeyframe.frameNum) {
      const span = Math.max(endKeyframe.frameNum - startKeyframe.frameNum, 0.000001);
      const t = clamp((frame - startKeyframe.frameNum) / span, 0, 1);
      const rotation = quat.create();
      quat.slerp(rotation, startKeyframe.rotation, endKeyframe.rotation, t);
      quat.normalize(rotation, rotation);
      return rotation;
    }
    startKeyframe = endKeyframe;
  }
  return quat.clone(rotationKeyframes[rotationKeyframes.length - 1].rotation);
}

/**
 * light keyframe 列から vec3 track を線形補間します。
 * @param {Array<object>} keyframes - 正規化済み keyframe 列。
 * @param {number} frame - 現在 frame。
 * @param {(keyframe: object) => ArrayLike<number>} getValue - 値取得関数。
 * @param {ArrayLike<number>} fallback - fallback 値。
 * @returns {number[]} 補間済み vec3。
 */
function sampleLightVec3Track(keyframes, frame, getValue, fallback) {
  if (keyframes.length === 0) {
    return normalizeVec3(fallback, [0, 0, 0]);
  }
  if (keyframes.length === 1) {
    return normalizeVec3(getValue(keyframes[0]), normalizeVec3(fallback, [0, 0, 0]));
  }
  if (frame <= keyframes[0].frameNum) {
    return normalizeVec3(getValue(keyframes[0]), normalizeVec3(fallback, [0, 0, 0]));
  }

  let startKeyframe = keyframes[0];
  let endKeyframe = keyframes[keyframes.length - 1];
  for (let i = 1; i < keyframes.length; i++) {
    endKeyframe = keyframes[i];
    if (frame <= endKeyframe.frameNum) {
      const span = Math.max(endKeyframe.frameNum - startKeyframe.frameNum, 0.000001);
      const t = clamp((frame - startKeyframe.frameNum) / span, 0, 1);
      const startValue = normalizeVec3(getValue(startKeyframe), fallback);
      const endValue = normalizeVec3(getValue(endKeyframe), fallback);
      return [
        startValue[0] + (endValue[0] - startValue[0]) * t,
        startValue[1] + (endValue[1] - startValue[1]) * t,
        startValue[2] + (endValue[2] - startValue[2]) * t,
      ];
    }
    startKeyframe = endKeyframe;
  }
  return normalizeVec3(getValue(keyframes[keyframes.length - 1]), fallback);
}

/**
 * ベクトル風の値かどうかを判定します。
 * @param {ArrayLike<number>|null|undefined} value - 判定対象。
 * @returns {boolean} ベクトル風かどうか。
 */
function isVectorLike(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function getCameraBasis(camera) {
  const cameraEye = createCameraEye(camera);
  const forward = normalize([
    Math.cos(camera.phi) * Math.sin(camera.theta),
    Math.sin(camera.phi),
    Math.cos(camera.phi) * Math.cos(camera.theta),
  ]);
  const right = normalizeOrFallback(cross([0, 1, 0], forward), [1, 0, 0]);
  const up = cross(forward, right);
  const roll = Number.isFinite(camera.roll) ? camera.roll : 0;
  if (Math.abs(roll) < 1e-8) {
    return { cameraEye, forward, right, up };
  }

  const rolledRight = rotateVectorAroundAxis(right, forward, roll);
  const rolledUp = rotateVectorAroundAxis(up, forward, roll);
  return {
    cameraEye,
    forward,
    right: normalizeOrFallback(rolledRight, right),
    up: normalizeOrFallback(rolledUp, up),
  };
}

function rotateVectorAroundAxis(vector, axis, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const crossVec = cross(axis, vector);
  return [
    vector[0] * cos + crossVec[0] * sin + axis[0] * dot * (1 - cos),
    vector[1] * cos + crossVec[1] * sin + axis[1] * dot * (1 - cos),
    vector[2] * cos + crossVec[2] * sin + axis[2] * dot * (1 - cos),
  ];
}

function normalizeOrFallback(vector, fallback) {
  const normalized = normalize(vector);
  if (!Number.isFinite(normalized[0]) || !Number.isFinite(normalized[1]) || !Number.isFinite(normalized[2])) {
    return [...fallback];
  }
  return normalized;
}

function appendBillboardCircle(vertices, center, right, up, radius, color) {
  const segments = 18;
  for (let i = 0; i < segments; i++) {
    const a1 = (i / segments) * Math.PI * 2;
    const a2 = ((i + 1) / segments) * Math.PI * 2;
    const p1 = getBillboardPoint(center, right, up, Math.cos(a1) * radius, Math.sin(a1) * radius);
    const p2 = getBillboardPoint(center, right, up, Math.cos(a2) * radius, Math.sin(a2) * radius);
    pushLineQuads(vertices, p1, p2, color);
  }
}

function appendSunRays(vertices, center, right, up, rayStart, rayEnd, color) {
  for (let i = 0; i < LIGHT_ICON_RAY_COUNT; i++) {
    const angle = (i / LIGHT_ICON_RAY_COUNT) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const start = getBillboardPoint(center, right, up, dirX * rayStart, dirY * rayStart);
    const end = getBillboardPoint(center, right, up, dirX * rayEnd, dirY * rayEnd);
    pushLineQuads(vertices, start, end, color);
  }
}

function getBillboardPoint(center, right, up, x, y) {
  return [
    center[0] + right[0] * x + up[0] * y,
    center[1] + right[1] * x + up[1] * y,
    center[2] + right[2] * x + up[2] * y,
  ];
}

function ensureBufferCapacity(device, overlay, bufferKey, requiredSize) {
  const buffer = overlay[bufferKey];
  if (requiredSize <= buffer.size) {
    return;
  }
  buffer.destroy();
  overlay[bufferKey] = device.createBuffer({
    size: Math.max(requiredSize * 1.5, LIGHT_ICON_BUFFER_SIZE),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function createFallbackVertexBuffer() {
  return {
    size: 0,
    destroy() {},
  };
}
