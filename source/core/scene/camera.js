import {
  clamp,
  crossVec3,
  getAabbCenter,
  getAabbSize,
  getAabbCorners,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  normalizeVec3,
  subtractVec3,
  transformPoint,
} from '../../shared/math/math-utils.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';

// カメラから見たシーンの最小深度（最も手前にあるオブジェクトの距離） minDepth  の  10%  (AUTO_CLIP_NEAR_SCALE ) を基準とし、それが  0.01  〜  0.5 の範囲に収まるようにクランプしてニアクリップ値に設定する。computeAutoClipPlanes を参照
const CAMERA_DEFAULTS_SECTION = 'camera';
const AUTO_CLIP_NEAR_MIN = 0.01;
const AUTO_CLIP_NEAR_MAX = 0.5;
const AUTO_CLIP_NEAR_SCALE = 0.01;
const AUTO_CLIP_FAR_SCALE = 1.1;
const AUTO_CLIP_FAR_GAP = 10.0;
const CAMERA_FIT_PADDING = 0.6;
const DEFAULT_VIEW_ASPECT = 16 / 9;
const CAMERA_VIEW_MIN_DISTANCE = 0.01;

/**
 * カメラの初期状態を作成します。
 * @param {number} unitScale - モデルの単位スケール。
 * @returns {object} カメラ状態。
 */
export function createCameraState(unitScale) {
  const defaults = getDefaultsSnapshot(CAMERA_DEFAULTS_SECTION);
  const baseCenter = Array.isArray(defaults.center) ? defaults.center : [0, 10, 0];
  const baseClipPlanes = defaults.clipPlanes && typeof defaults.clipPlanes === 'object'
    ? defaults.clipPlanes
    : { near: 0.1, far: 1000.0 };
  return {
    center: [0, toFiniteNumber(baseCenter[1], 10) * unitScale, 0],
    distance: toFiniteNumber(defaults.distance, Math.sqrt(925)) * unitScale,
    clipPlanes: {
      near: toFiniteNumber(baseClipPlanes.near, 0.1),
      far: toFiniteNumber(baseClipPlanes.far, 1000.0),
    },
    isDragging: false,
    isPanning: false,
    lastX: 0,
    lastY: 0,
    fovY: toFiniteNumber(defaults.fovY, 45 * Math.PI / 180),
    manualCenter: null,
    manualDistance: null,
    manualPhi: null,
    manualTheta: null,
    manualRoll: null,
    manualPoseFrame: null,
    manualFovY: null,
    manualFovFrame: null,
    phi: toFiniteNumber(defaults.phi, Math.asin(5 / Math.sqrt(925))),
    roll: toFiniteNumber(defaults.roll, 0),
    theta: toFiniteNumber(defaults.theta, 0),
  };
}

/**
 * ビュー投影行列を作成します。
 * @param {HTMLCanvasElement} canvas - 描画対象キャンバス。
 * @param {object} camera - カメラ状態。
 * @param {{near: number, far: number}|null} [clipPlanes=null] - 使用する clip plane。
 * @returns {Array<number>} ビュー投影行列。
 */
export function createViewProjection(canvas, camera, clipPlanes = null) {
  const defaults = getDefaultsSnapshot(CAMERA_DEFAULTS_SECTION);
  const defaultClipPlanes = defaults.clipPlanes && typeof defaults.clipPlanes === 'object'
    ? defaults.clipPlanes
    : { near: 0.1, far: 1000.0 };
  const planes = clipPlanes ?? camera.clipPlanes ?? {
    near: toFiniteNumber(defaultClipPlanes.near, 0.1),
    far: toFiniteNumber(defaultClipPlanes.far, 1000.0),
  };
  const near = Math.max(0.0001, planes.near ?? toFiniteNumber(defaultClipPlanes.near, 0.1));
  const far = Math.max(near + 0.0001, planes.far ?? toFiniteNumber(defaultClipPlanes.far, 1000.0));
  return mat4Multiply(
    mat4Perspective(camera.fovY ?? (45 * Math.PI / 180), canvas.width / canvas.height, near, far),
    createViewMatrix(camera),
  );
}

/**
 * scene AABB からカメラの自動 clip plane を算出します。
 * @param {object} camera - カメラ状態。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @returns {{near: number, far: number}} clip plane。
 */
export function computeAutoClipPlanes(camera, sceneBounds) {
  const defaults = getDefaultsSnapshot(CAMERA_DEFAULTS_SECTION);
  const defaultClipPlanes = defaults.clipPlanes && typeof defaults.clipPlanes === 'object'
    ? defaults.clipPlanes
    : { near: 0.1, far: 1000.0 };
  if (!sceneBounds) {
    return {
      near: toFiniteNumber(defaultClipPlanes.near, 0.1),
      far: toFiniteNumber(defaultClipPlanes.far, 1000.0),
    };
  }

  const view = createViewMatrix(camera);
  let minDepth = Infinity;
  let maxDepth = 0;

  for (const corner of getAabbCorners(sceneBounds)) {
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
      near: toFiniteNumber(defaultClipPlanes.near, 0.1),
      far: toFiniteNumber(defaultClipPlanes.far, 1000.0),
    };
  }

  // MMD のワールドは大きめなので、近接ショットで near が太りすぎないように控えめにする。
  const near = clamp(minDepth * AUTO_CLIP_NEAR_SCALE, AUTO_CLIP_NEAR_MIN, AUTO_CLIP_NEAR_MAX);
  const far = Math.max(near + AUTO_CLIP_FAR_GAP, maxDepth * AUTO_CLIP_FAR_SCALE);
  if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) {
    return {
      near: toFiniteNumber(defaultClipPlanes.near, 0.1),
      far: toFiniteNumber(defaultClipPlanes.far, 1000.0),
    };
  }

  return { near, far };
}

/**
 * ビュー行列を作成します。
 * @param {object} camera - カメラ状態。
 * @returns {Array<number>} ビュー行列。
 */
export function createViewMatrix(camera) {
  return mat4LookAt(createCameraEye(camera), camera.center, createCameraUp(camera));
}

/**
 * カメラの視点位置を作成します。
 * @param {object} camera - カメラ状態。
 * @returns {Array<number>} カメラ位置。
 */
export function createCameraEye(camera) {
  return [
    camera.center[0] + camera.distance * Math.cos(camera.phi) * Math.sin(camera.theta),
    camera.center[1] + camera.distance * Math.sin(camera.phi),
    camera.center[2] + camera.distance * Math.cos(camera.phi) * Math.cos(camera.theta),
  ];
}

/**
 * camera の view up ベクトルを作成します。
 * @param {object} camera - カメラ状態。
 * @returns {Array<number>} up ベクトル。
 */
function createCameraUp(camera) {
  const eye = createCameraEye(camera);
  const forward = normalizeVec3(subtractVec3(camera.center, eye)) || [0, 0, -1];
  let right = normalizeVec3(crossVec3([0, 1, 0], forward));
  if (!right) {
    right = normalizeVec3(crossVec3([0, 0, 1], forward)) || [1, 0, 0];
  }
  let up = normalizeVec3(crossVec3(forward, right)) || [0, 1, 0];
  const roll = toFiniteNumber(camera.roll, 0);
  if (Math.abs(roll) < 1e-8) {
    return up;
  }

  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  up = [
    up[0] * cosRoll + right[0] * sinRoll,
    up[1] * cosRoll + right[1] * sinRoll,
    up[2] * cosRoll + right[2] * sinRoll,
  ];
  return normalizeVec3(up) || [0, 1, 0];
}

/**
 * 現在の orbit camera を VMD camera rotation 用のオイラー角へ変換します。
 * @param {object} camera - カメラ状態。
 * @returns {Array<number>} VMD camera rotation。
 */
export function createCameraRotation(camera) {
  return [
    -(camera.phi ?? 0),
    camera.theta ?? 0,
    camera.roll ?? 0,
  ];
}

/**
 * 数値を有限値へ正規化します。
 * @param {number} value - 入力値。
 * @param {number} fallback - 代替値。
 * @returns {number} 正規化後の値。
 */
function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 3 要素ベクトルを配列へ複製します。
 * @param {ArrayLike<number>|null|undefined} value - 元のベクトル。
 * @param {number[]} fallback - 代替値。
 * @returns {number[]} 複製後のベクトル。
 */
function cloneVec3(value, fallback) {
  return [
    toFiniteNumber(value?.[0], fallback[0]),
    toFiniteNumber(value?.[1], fallback[1]),
    toFiniteNumber(value?.[2], fallback[2]),
  ];
}

/**
 * 指定軸方向から AABB 全体を収めるための camera 距離を返します。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @param {number} fovY - 縦 FOV (ラジアン)。
 * @param {number} aspect - アスペクト比。
 * @param {'x'|'y'|'z'} viewAxis - 視線軸。
 * @returns {number} 必要な camera 距離。
 */
export function computeCameraFitDistance(sceneBounds, fovY, aspect, viewAxis) {
  if (!sceneBounds) {
    return CAMERA_VIEW_MIN_DISTANCE;
  }

  const size = getAabbSize(sceneBounds);
  const halfWidth = {
    x: size[0] * 0.5,
    y: size[1] * 0.5,
    z: size[2] * 0.5,
  };
  const safeFovY = Number.isFinite(fovY) && fovY > 0 ? fovY : 45 * Math.PI / 180;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_VIEW_ASPECT;
  const tanHalfVFov = Math.tan(safeFovY * 0.5);
  const tanHalfHFov = tanHalfVFov * safeAspect;

  let horizontalHalfSize = halfWidth.x;
  let verticalHalfSize = halfWidth.y;
  if (viewAxis === 'x') {
    horizontalHalfSize = halfWidth.z;
    verticalHalfSize = halfWidth.y;
  } else if (viewAxis === 'y') {
    horizontalHalfSize = halfWidth.x;
    verticalHalfSize = halfWidth.z;
  }

  const horizontalDistance = horizontalHalfSize > 0 && tanHalfHFov > 0 ? horizontalHalfSize / tanHalfHFov : 0;
  const verticalDistance = verticalHalfSize > 0 && tanHalfVFov > 0 ? verticalHalfSize / tanHalfVFov : 0;
  const distance = Math.max(horizontalDistance, verticalDistance) * CAMERA_FIT_PADDING;
  return Math.max(distance, CAMERA_VIEW_MIN_DISTANCE);
}

/**
 * AABB の中心を注視点にした軸揃え camera 視点を作成します。
 * @param {{min: number[], max: number[]} | null} sceneBounds - シーン境界。
 * @param {object} camera - camera state。
 * @param {'x'|'y'|'z'} viewAxis - 視線軸。
 * @param {number} axisSign - 視線軸の符号。+1 は正方向、-1 は負方向。
 * @param {number} aspect - アスペクト比。
 * @returns {{eye: number[], target: number[], distance: number}} camera 視点。
 */
export function createAxisAlignedCameraView(sceneBounds, camera, viewAxis, axisSign, aspect) {
  const target = sceneBounds ? getAabbCenter(sceneBounds) : cloneVec3(camera?.center, [0, 0, 0]);
  const distance = computeCameraFitDistance(sceneBounds, camera?.fovY ?? (45 * Math.PI / 180), aspect, viewAxis);
  const eye = [target[0], target[1], target[2]];
  const index = viewAxis === 'x' ? 0 : (viewAxis === 'y' ? 1 : 2);
  eye[index] += distance * axisSign;
  return { eye, target, distance };
}

/**
 * camera の手動姿勢を解除します。
 * @param {object} camera - camera state。
 */
export function clearCameraManualPose(camera) {
  if (!camera) {
    return;
  }

  camera.manualCenter = null;
  camera.manualDistance = null;
  camera.manualPhi = null;
  camera.manualTheta = null;
  camera.manualRoll = null;
  camera.manualPoseFrame = null;
}

/**
 * camera の手動 FOV を現在フレームに紐づけて設定します。
 * @param {object} camera - camera state。
 * @param {number} fovY - 縦 FOV (ラジアン)。
 * @param {number} frame - 紐づけるフレーム。
 */
export function setCameraManualFov(camera, fovY, frame) {
  if (!camera) {
    return;
  }
  const safeFovY = toFiniteNumber(fovY, camera.fovY ?? (45 * Math.PI / 180));
  camera.manualFovY = safeFovY;
  camera.manualFovFrame = Number.isFinite(frame) ? frame : null;
  camera.fovY = safeFovY;
}

/**
 * camera の手動 FOV を現在フレームに対して適用します。
 * フレームがずれた場合は manual 値を無効化します。
 * @param {object} camera - camera state。
 * @param {number} frame - 現在フレーム。
 * @returns {boolean} 手動 FOV を適用したかどうか。
 */
export function applyCameraManualFov(camera, frame) {
  if (!camera) {
    return false;
  }

  if (!Number.isFinite(camera.manualFovY) || !Number.isFinite(camera.manualFovFrame)) {
    return false;
  }

  if (camera.manualFovFrame !== frame) {
    camera.manualFovY = null;
    camera.manualFovFrame = null;
    return false;
  }

  camera.fovY = camera.manualFovY;
  return true;
}

/**
 * camera の手動姿勢を現在フレームに紐づけて設定します。
 * @param {object} camera - camera state。
 * @param {ArrayLike<number>} center - 注視点。
 * @param {number} distance - カメラ距離。
 * @param {number} phi - 上下回転。
 * @param {number} theta - 左右回転。
 * @param {number} roll - 前方軸回りの回転。
 * @param {number} frame - 紐づけるフレーム。
 */
export function setCameraManualPose(camera, center, distance, phi, theta, roll, frame) {
  if (!camera) {
    return;
  }

  const hasExplicitRoll = arguments.length >= 7;
  const resolvedRoll = hasExplicitRoll ? roll : 0;
  const resolvedFrame = hasExplicitRoll ? frame : roll;

  const fallbackCenter = Array.isArray(camera.center) ? camera.center : [0, 0, 0];
  camera.manualCenter = cloneVec3(center, fallbackCenter);
  camera.manualDistance = toFiniteNumber(distance, camera.distance ?? 0);
  camera.manualPhi = toFiniteNumber(phi, camera.phi ?? 0);
  camera.manualTheta = toFiniteNumber(theta, camera.theta ?? 0);
  camera.manualRoll = toFiniteNumber(resolvedRoll, camera.roll ?? 0);
  camera.manualPoseFrame = Number.isFinite(resolvedFrame) ? resolvedFrame : null;
}

/**
 * eye と target から camera の手動姿勢を設定します。
 * @param {object} camera - camera state。
 * @param {ArrayLike<number>} eye - カメラ位置。
 * @param {ArrayLike<number>} target - 注視点。
 * @param {number} roll - 前方軸回りの回転。
 * @param {number} frame - 紐づけるフレーム。
 */
export function setCameraManualView(camera, eye, target, roll, frame) {
  if (!camera) {
    return;
  }

  const fallbackCenter = Array.isArray(camera.center) ? camera.center : [0, 0, 0];
  const safeTarget = cloneVec3(target, fallbackCenter);
  const fallbackEye = createCameraEye(camera);
  const safeEye = cloneVec3(eye, fallbackEye);
  const offset = subtractVec3(safeEye, safeTarget);
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  let phi = camera.phi ?? 0;
  let theta = camera.theta ?? 0;
  if (distance > 1e-8) {
    const yRatio = clamp(offset[1] / distance, -1, 1);
    phi = Math.asin(yRatio);
    theta = Math.atan2(offset[0], offset[2]);
  }

  setCameraManualPose(camera, safeTarget, distance, phi, theta, roll, frame);
}

/**
 * camera の手動姿勢を現在フレームに対して適用します。
 * フレームがずれた場合は manual 値を無効化します。
 * @param {object} camera - camera state。
 * @param {number} frame - 現在フレーム。
 * @returns {boolean} 手動姿勢を適用したかどうか。
 */
export function applyCameraManualPose(camera, frame) {
  if (!camera) {
    return false;
  }

  if (!Array.isArray(camera.manualCenter) || !Number.isFinite(camera.manualDistance) || !Number.isFinite(camera.manualPhi) || !Number.isFinite(camera.manualTheta) || !Number.isFinite(camera.manualPoseFrame)) {
    return false;
  }

  if (camera.manualPoseFrame !== frame) {
    clearCameraManualPose(camera);
    return false;
  }

  if (!Array.isArray(camera.center)) {
    camera.center = [0, 0, 0];
  }
  camera.center[0] = camera.manualCenter[0];
  camera.center[1] = camera.manualCenter[1];
  camera.center[2] = camera.manualCenter[2];
  camera.distance = camera.manualDistance;
  camera.phi = camera.manualPhi;
  camera.theta = camera.manualTheta;
  camera.roll = Number.isFinite(camera.manualRoll) ? camera.manualRoll : 0;
  return true;
}

/**
 * Cubic Bezier の y を評価します。
 * @param {number} p1 - 制御点 1 の y。
 * @param {number} p2 - 制御点 2 の y。
 * @param {number} t - 入力。
 * @returns {number} 評価結果。
 */
function evalBezierCurve(p1, p2, t) {
  const it = 1.0 - t;
  return 3 * t * it * it * p1 + 3 * t * t * it * p2 + t * t * t;
}

/**
 * Cubic Bezier の x を逆引きするための t を探します。
 * @param {number} x1 - 制御点 1 の x。
 * @param {number} x2 - 制御点 2 の x。
 * @param {number} x - 求めたい x。
 * @returns {number} 逆引きした t。
 */
function findBezierT(x1, x2, x) {
  let start = 0.0;
  let end = 1.0;
  let t = 0.5;
  for (let i = 0; i < 12; i++) {
    const evalX = evalBezierCurve(x1, x2, t);
    if (evalX < x) {
      start = t;
    } else {
      end = t;
    }
    t = (start + end) * 0.5;
  }
  return t;
}

/**
 * 補間 byte 配列を使って t を再評価します。
 * camera の FOV は VMD 仕様上に専用補間がないため、OpenMMD 内部では
 * camera keyframe の補間データをそのまま流用します。
 * @param {Uint8Array|ArrayLike<number>|null|undefined} interpolation - 補間 byte。
 * @param {number} t - 入力。
 * @returns {number} 補間後の t。
 */
function evaluateBezierInterpolation(interpolation, t) {
  if (!interpolation || interpolation.length < 4) {
    return t;
  }

  const x1 = interpolation[0] / 127.0;
  const y1 = interpolation[1] / 127.0;
  const x2 = interpolation[2] / 127.0;
  const y2 = interpolation[3] / 127.0;
  if (x1 === y1 && x2 === y2) {
    return t;
  }
  const bezierT = findBezierT(x1, x2, t);
  return evalBezierCurve(y1, y2, bezierT);
}

/**
 * camera keyframe の補間対象を 1 件分サンプルします。
 * @param {object} keyframe - camera keyframe。
 * @returns {object} サンプル済み camera state。
 */
function createCameraStateFromKeyframe(keyframe) {
  const distance = toFiniteNumber(keyframe?.distance, 0);
  const target = cloneVec3(keyframe?.target, [0, 0, 0]);
  const rotation = cloneVec3(keyframe?.rotation, [0, 0, 0]);
  const fovDegrees = toFiniteNumber(keyframe?.fov, 45);

  return {
    center: target,
    distance,
    phi: -rotation[0],
    theta: rotation[1],
    roll: rotation[2],
    fovY: fovDegrees * Math.PI / 180,
    perspective: toFiniteNumber(keyframe?.perspective, 1),
  };
}

/**
 * camera keyframe の区間補間を行います。
 * @param {object} startKeyframe - 開始 keyframe。
 * @param {object} endKeyframe - 終了 keyframe。
 * @param {number} frame - 現在フレーム。
 * @returns {object} サンプル済み camera state。
 */
function interpolateCameraKeyframes(startKeyframe, endKeyframe, frame) {
  const startFrame = toFiniteNumber(startKeyframe?.frameNum, 0);
  const endFrame = toFiniteNumber(endKeyframe?.frameNum, startFrame);
  const span = Math.max(endFrame - startFrame, 0.000001);
  const linearT = clamp((frame - startFrame) / span, 0, 1);

  // FOV は専用補間が VMD にないため、内部では camera interpolation を流用する。
  const motionT = evaluateBezierInterpolation(startKeyframe?.interpolation, linearT);
  const fovT = evaluateBezierInterpolation(
    startKeyframe?.fovInterpolation ?? startKeyframe?.interpolation,
    linearT,
  );

  const startState = createCameraStateFromKeyframe(startKeyframe);
  const endState = createCameraStateFromKeyframe(endKeyframe);

  return {
    center: [
      startState.center[0] + (endState.center[0] - startState.center[0]) * motionT,
      startState.center[1] + (endState.center[1] - startState.center[1]) * motionT,
      startState.center[2] + (endState.center[2] - startState.center[2]) * motionT,
    ],
    distance: startState.distance + (endState.distance - startState.distance) * motionT,
    phi: startState.phi + (endState.phi - startState.phi) * motionT,
    theta: startState.theta + (endState.theta - startState.theta) * motionT,
    roll: startState.roll + (endState.roll - startState.roll) * motionT,
    fovY: startState.fovY + (endState.fovY - startState.fovY) * fovT,
    perspective: linearT >= 1 ? endState.perspective : startState.perspective,
  };
}

/**
 * camera keyframe 列を現在フレームへ反映します。
 * @param {object} camera - 反映先 camera state。
 * @param {Array<object>} cameraKeyframes - camera keyframe 列。
 * @param {number} frame - 現在フレーム。
 * @returns {object|null} 適用した camera state。
 */
export function applyCameraKeyframesToCamera(camera, cameraKeyframes, frame) {
  if (!camera || !Array.isArray(cameraKeyframes) || cameraKeyframes.length === 0) {
    return null;
  }

  const currentFrame = Number.isFinite(frame) ? frame : 0;
  let appliedState = null;

  if (cameraKeyframes.length === 1) {
    appliedState = createCameraStateFromKeyframe(cameraKeyframes[0]);
  } else if (currentFrame <= toFiniteNumber(cameraKeyframes[0].frameNum, 0)) {
    appliedState = createCameraStateFromKeyframe(cameraKeyframes[0]);
  } else {
    let startKeyframe = cameraKeyframes[0];
    appliedState = createCameraStateFromKeyframe(cameraKeyframes[cameraKeyframes.length - 1]);

    for (let i = 1; i < cameraKeyframes.length; i++) {
      const endKeyframe = cameraKeyframes[i];
      const endFrame = toFiniteNumber(endKeyframe?.frameNum, 0);
      if (currentFrame <= endFrame) {
        appliedState = interpolateCameraKeyframes(startKeyframe, endKeyframe, currentFrame);
        break;
      }
      startKeyframe = endKeyframe;
    }
  }

  if (!Array.isArray(camera.center)) {
    camera.center = [0, 0, 0];
  }
  camera.center[0] = appliedState.center[0];
  camera.center[1] = appliedState.center[1];
  camera.center[2] = appliedState.center[2];
  camera.distance = appliedState.distance;
  camera.phi = appliedState.phi;
  camera.theta = appliedState.theta;
  camera.roll = appliedState.roll;
  camera.fovY = appliedState.fovY;
  camera.perspective = appliedState.perspective;

  return appliedState;
}
