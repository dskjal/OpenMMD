import { mat4, quat, vec3, vec4 } from '../../lib/esm/index.js';
import { mat4Vec4Mul, normalize, cross, clamp, pushLineQuads } from '../../shared/math/math-utils.js';
import { worldDeltaToLocalDelta } from '../physics/ik.js';
import { getSelectedBoneIndices } from './renderer-selection.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';
import { getInitialRotationLocksFromBoneName } from '../model/model-scene.js';
import { getEffectiveLocalRotation } from '../../shared/bones/bone-display-utils.js';
import {
  applyLightRotationDelta,
  applyLightTranslationDelta,
  resolveLightGizmoPose,
} from '../scene/light-object.js';

function isWorldMode(selection, inspectorState = null) {
  return Boolean(inspectorState?.useWorldCoordinate ?? selection?.useWorldCoordinate);
}

/**
 * ボーンの回転ロック状態を返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {{x: boolean, y: boolean, z: boolean}} ロック状態。
 */
function getBoneRotationLocks(bone) {
  const defaultBoneName = bone?.vrmHumanoidBoneName || bone?.name || '';
  const defaultLocks = getInitialRotationLocksFromBoneName(defaultBoneName);
  const locks = bone?.rotationLocks || {};
  return {
    x: Boolean(locks.x ?? defaultLocks.x),
    y: Boolean(locks.y ?? defaultLocks.y),
    z: Boolean(locks.z ?? defaultLocks.z),
  };
}

/**
 * ボーンのアンロック済み回転軸を返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {Array<string>} アンロック済み回転軸。
 */
function getAllowedRotationAxes(bone) {
  const locks = getBoneRotationLocks(bone);
  const axes = [];
  if (!locks.x) axes.push('x');
  if (!locks.y) axes.push('y');
  if (!locks.z) axes.push('z');
  return axes;
}

/**
 * 選択集合で共通してアンロックな回転軸を返します。
 * @param {object} model - モデル。
 * @param {Array<number>} boneIndices - ボーンインデックス一覧。
 * @returns {Array<string>} 共通で利用可能な回転軸名の配列。
 */
function getAggregateRotationAxes(model, boneIndices) {
  if (!Array.isArray(boneIndices) || boneIndices.length === 0) {
    return [];
  }

  let axes = ['x', 'y', 'z'];
  for (const boneIndex of boneIndices) {
    const bone = model?.bones?.[boneIndex];
    if (!bone) {
      continue;
    }
    const allowedAxes = getAllowedRotationAxes(bone);
    axes = axes.filter((axis) => allowedAxes.includes(axis));
    if (axes.length === 0) {
      return [];
    }
  }

  return axes;
}

/**
 * @typedef {Object} GizmoState
 * @property {string|null} mode - 'rotate' or 'translate' or null.
 * @property {string|null} axis - 'x', 'y', 'z' or null.
 * @property {string|null} dragKind - 'ring-plane' or 'edge-on-ring' or null.
 * @property {number} boneIndex - Selected bone index.
 * @property {Array<number>} selectedBoneIndices - Drag target bone indices.
 * @property {Array<Object>} startBoneStates - Drag start snapshots for each bone.
 * @property {vec3} startPosition - Aggregate gizmo position at drag start.
 * @property {quat} startLocalRotation - Effective local rotation at drag start.
 * @property {vec3} startManualTranslation - Manual translation at drag start.
 * @property {vec3} startHitPoint - World hit point at drag start.
 * @property {vec3} dragPlaneNormal - Normal of the plane used for dragging.
 * @property {vec3} dragAxisWorld - World axis vector being dragged.
 * @property {vec3} edgeOnBasisX - Edge-on hit basis X axis.
 * @property {vec3} edgeOnBasisY - Edge-on hit basis Y axis.
 * @property {vec3} edgeOnBasisZ - Edge-on hit basis Z axis.
 * @property {number} edgeOnHalfSizeX - Edge-on hit box half size on X.
 * @property {number} edgeOnHalfSizeY - Edge-on hit box half size on Y.
 * @property {number} edgeOnHalfSizeZ - Edge-on hit box half size on Z.
 * @property {number} edgeOnStartAngle - Edge-on drag start angle.
 * @property {boolean} isDragging - True if currently dragging.
 */

/**
 * ギズモ状態を生成します。
 * @returns {GizmoState}
 */
export function createGizmoState() {
  const defaults = getDefaultsSnapshot('gizmoState');
  const startPosition = Array.isArray(defaults.startPosition) ? defaults.startPosition : [0, 0, 0];
  const startLocalRotation = Array.isArray(defaults.startManualRotation) ? defaults.startManualRotation : [0, 0, 0, 1];
  const startManualTranslation = Array.isArray(defaults.startManualTranslation) ? defaults.startManualTranslation : [0, 0, 0];
  const startLightRotation = Array.isArray(defaults.startLightRotation) ? defaults.startLightRotation : [0, 0, 0, 1];
  const startLightPosition = Array.isArray(defaults.startLightPosition) ? defaults.startLightPosition : [0, 0, 0];
  const startHitPoint = Array.isArray(defaults.startHitPoint) ? defaults.startHitPoint : [0, 0, 0];
  const dragPlaneNormal = Array.isArray(defaults.dragPlaneNormal) ? defaults.dragPlaneNormal : [0, 0, 0];
  const dragAxisWorld = Array.isArray(defaults.dragAxisWorld) ? defaults.dragAxisWorld : [0, 0, 0];
  const edgeOnBasisX = Array.isArray(defaults.edgeOnBasisX) ? defaults.edgeOnBasisX : [0, 0, 0];
  const edgeOnBasisY = Array.isArray(defaults.edgeOnBasisY) ? defaults.edgeOnBasisY : [0, 0, 0];
  const edgeOnBasisZ = Array.isArray(defaults.edgeOnBasisZ) ? defaults.edgeOnBasisZ : [0, 0, 0];
  return {
    mode: defaults.mode ?? null,
    axis: defaults.axis ?? null,
    dragKind: defaults.dragKind ?? null,
    isLightObject: Boolean(defaults.isLightObject),
    boneIndex: Number.isInteger(defaults.boneIndex) ? defaults.boneIndex : -1,
    selectedBoneIndices: Array.isArray(defaults.selectedBoneIndices) ? [...defaults.selectedBoneIndices] : [],
    startBoneStates: Array.isArray(defaults.startBoneStates) ? [...defaults.startBoneStates] : [],
    startPosition: vec3.fromValues(startPosition[0] ?? 0, startPosition[1] ?? 0, startPosition[2] ?? 0),
    startLocalRotation: quat.fromValues(startLocalRotation[0] ?? 0, startLocalRotation[1] ?? 0, startLocalRotation[2] ?? 0, startLocalRotation[3] ?? 1),
    startManualTranslation: vec3.fromValues(startManualTranslation[0] ?? 0, startManualTranslation[1] ?? 0, startManualTranslation[2] ?? 0),
    startLightRotation: quat.fromValues(startLightRotation[0] ?? 0, startLightRotation[1] ?? 0, startLightRotation[2] ?? 0, startLightRotation[3] ?? 1),
    startLightPosition: vec3.fromValues(startLightPosition[0] ?? 0, startLightPosition[1] ?? 0, startLightPosition[2] ?? 0),
    startHitPoint: vec3.fromValues(startHitPoint[0] ?? 0, startHitPoint[1] ?? 0, startHitPoint[2] ?? 0),
    dragPlaneNormal: vec3.fromValues(dragPlaneNormal[0] ?? 0, dragPlaneNormal[1] ?? 0, dragPlaneNormal[2] ?? 0),
    dragAxisWorld: vec3.fromValues(dragAxisWorld[0] ?? 0, dragAxisWorld[1] ?? 0, dragAxisWorld[2] ?? 0),
    edgeOnBasisX: vec3.fromValues(edgeOnBasisX[0] ?? 0, edgeOnBasisX[1] ?? 0, edgeOnBasisX[2] ?? 0),
    edgeOnBasisY: vec3.fromValues(edgeOnBasisY[0] ?? 0, edgeOnBasisY[1] ?? 0, edgeOnBasisY[2] ?? 0),
    edgeOnBasisZ: vec3.fromValues(edgeOnBasisZ[0] ?? 0, edgeOnBasisZ[1] ?? 0, edgeOnBasisZ[2] ?? 0),
    edgeOnHalfSizeX: Number.isFinite(defaults.edgeOnHalfSizeX) ? defaults.edgeOnHalfSizeX : 0,
    edgeOnHalfSizeY: Number.isFinite(defaults.edgeOnHalfSizeY) ? defaults.edgeOnHalfSizeY : 0,
    edgeOnHalfSizeZ: Number.isFinite(defaults.edgeOnHalfSizeZ) ? defaults.edgeOnHalfSizeZ : 0,
    edgeOnStartAngle: Number.isFinite(defaults.edgeOnStartAngle) ? defaults.edgeOnStartAngle : 0,
    isDragging: Boolean(defaults.isDragging),
  };
}

const GIZMO_RADIUS = 2.0;
const GIZMO_THICKNESS = 0.5; // Selection tolerance in world units (approx)
/**
 * カメラが極端に近い場合でも gizmo が潰れないようにする最小スケールです。
 */
const GIZMO_MIN_SCALE = 0.05;
/**
 * ライト gizmo は通常ボーン gizmo と同等のサイズで表示します。
 */
const LIGHT_OBJECT_GIZMO_SCALE_FACTOR = 1.0;
const HANDLE_EDGE_ON_DOT_THRESHOLD = 0.15;
const HANDLE_MIN_LENGTH = 1e-6;
const GIZMO_SEGMENTS = 64;
const GIZMO_ARROW_START = GIZMO_RADIUS + 0.2;
const GIZMO_ARROW_LENGTH = 1.0;
const GIZMO_HEAD_SIZE = 0.5;
export const GIZMO_AXIS_COLORS = Object.freeze({
  x: [1.0, 0.0, 0.0],
  y: [0.0, 1.0, 0.0],
  z: [0.0, 0.0, 1.0],
});
const BONE_FLAG_ROTATABLE = 0x0002;
const BONE_FLAG_TRANSLATABLE = 0x0004;

/**
 * ギズモのスケールを計算します。
 * @param {Array<number>} cameraEye - カメラ視点位置。
 * @param {Array<number>} gizmoPosition - ギズモ位置。
 * @returns {number} スケール値。
 */
export function getGizmoScale(cameraEye, gizmoPosition) {
  if (!cameraEye) return 1.0;
  const dist = vec3.distance(cameraEye, gizmoPosition);
  return Math.max(dist * 0.05, GIZMO_MIN_SCALE);
}

/**
 * 目的に応じた gizmo スケールを返します。
 * @param {Array<number>} cameraEye - カメラ視点位置。
 * @param {Array<number>} gizmoPosition - ギズモ位置。
 * @param {boolean} isLightObject - ライト gizmo かどうか。
 * @returns {number} スケール値。
 */
function getPoseGizmoScale(cameraEye, gizmoPosition, isLightObject) {
  const scale = getGizmoScale(cameraEye, gizmoPosition);
  return isLightObject ? scale * LIGHT_OBJECT_GIZMO_SCALE_FACTOR : scale;
}

/**
 * 選択中ボーン集合のギズモ pose を返します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {object|null} [lightState=null] - ライト状態。
 * @param {object|null} [inspectorState=null] - ボーンインスペクター状態。
 * @returns {GizmoPose|null} ギズモ pose。
 */
export function resolveGizmoPose(instance, selection, lightState = null, inspectorState = null) {
  if (selection?.selectedLight && lightState) {
    return resolveLightGizmoPose(lightState);
  }

  if (!instance || !instance.model || !instance.scene) {
    return null;
  }

  const { model, scene } = instance;
  const boneIndices = getSelectedBoneIndices(selection, instance);
  if (boneIndices.length === 0) {
    return null;
  }

  const validBoneIndices = [];
  let positionSum = vec3.create();
  let worldXSum = vec3.create();
  let worldYSum = vec3.create();
  let worldZSum = vec3.create();

  for (const boneIndex of boneIndices) {
    const position = scene.boneWorldPositions?.[boneIndex];
    const transform = scene.boneLocalTransforms?.[boneIndex];
    if (!position || !transform) {
      continue;
    }

    validBoneIndices.push(boneIndex);
    vec3.add(positionSum, positionSum, position);

    const worldBasis = getWorldSpaceGizmoBasis(transform);
    vec3.add(worldXSum, worldXSum, worldBasis.x);
    vec3.add(worldYSum, worldYSum, worldBasis.y);
    vec3.add(worldZSum, worldZSum, worldBasis.z);
  }

  if (validBoneIndices.length === 0) {
    return null;
  }

  const count = validBoneIndices.length;
  const singleTransform = count === 1 ? scene.boneLocalTransforms?.[validBoneIndices[0]] ?? null : null;
  vec3.scale(positionSum, positionSum, 1 / count);
  vec3.scale(worldXSum, worldXSum, 1 / count);
  vec3.scale(worldYSum, worldYSum, 1 / count);
  vec3.scale(worldZSum, worldZSum, 1 / count);

  const referenceBoneIndex = resolveGizmoReferenceBoneIndex(selection, validBoneIndices);
  const rotationAxes = getAggregateRotationAxes(model, validBoneIndices);
  const localBasis = isWorldMode(selection, inspectorState)
    ? createWorldGizmoBasis()
    : count === 1
      ? createSingleGizmoBasis(singleTransform)
      : orthonormalizeAveragedBasis(worldXSum, worldYSum, worldZSum);
  const displayQuat = isWorldMode(selection, inspectorState)
    ? quat.create()
    : count === 1 && singleTransform
      ? quat.multiply(quat.create(), singleTransform.worldRotation, quat.fromMat3(quat.create(), [
        singleTransform.localX[0], singleTransform.localX[1], singleTransform.localX[2],
        singleTransform.localY[0], singleTransform.localY[1], singleTransform.localY[2],
        singleTransform.localZ[0], singleTransform.localZ[1], singleTransform.localZ[2],
      ]))
      : quat.fromMat3(quat.create(), [
        localBasis.x[0], localBasis.x[1], localBasis.x[2],
        localBasis.y[0], localBasis.y[1], localBasis.y[2],
        localBasis.z[0], localBasis.z[1], localBasis.z[2],
      ]);

  const worldAxes = {
    x: vec3.transformQuat(vec3.create(), [1, 0, 0], displayQuat),
    y: vec3.transformQuat(vec3.create(), [0, 1, 0], displayQuat),
    z: vec3.transformQuat(vec3.create(), [0, 0, 1], displayQuat),
  };

  return {
    isLightObject: false,
    boneIndices: validBoneIndices,
    referenceBoneIndex,
    position: [positionSum[0], positionSum[1], positionSum[2]],
    displayQuat,
    localBasis,
    worldAxes,
    rotationAxes,
    gizmoModes: getAggregateGizmoModes(model, validBoneIndices),
  };
}

/**
 * ギズモ描画用の頂点列を生成します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {Array<number>} cameraEye - Camera eye position.
 * @param {object|null} [lightState=null] - ライト状態。
 * @param {object|null} [inspectorState=null] - ボーンインスペクター状態。
 */
export function buildGizmoVertices(instance, selection, cameraEye, lightState = null, inspectorState = null) {
  const pose = resolveGizmoPose(instance, selection, lightState, inspectorState);
  const rotationAxes = pose?.rotationAxes || (pose?.isLightObject ? ['x', 'y', 'z'] : []);
  if (!pose || ((rotationAxes.length === 0) && !pose.gizmoModes.translatable)) {
    return [];
  }

  const { model } = instance || {};
  const bone = pose.isLightObject ? null : model?.bones?.[pose.referenceBoneIndex] ?? null;
  const scale = getPoseGizmoScale(cameraEye, pose.position, pose.isLightObject);
  const radius = GIZMO_RADIUS * scale;
  const arrowStart = GIZMO_ARROW_START * scale;
  const arrowLength = GIZMO_ARROW_LENGTH * scale;
  const headSize = GIZMO_HEAD_SIZE * scale;
  const rotMat = mat4.fromQuat(mat4.create(), pose.displayQuat);

  const vertices = [];
  const allowedRotationAxes = pose.isLightObject ? ['x', 'y', 'z'] : rotationAxes;

  if (pose.gizmoModes.rotatable && allowedRotationAxes.length > 0) {
    // --- Rotation Rings ---
    if (allowedRotationAxes.includes('x')) {
      appendCircleVertices(vertices, pose.position, rotMat, [0, 1, 0], [0, 0, 1], GIZMO_AXIS_COLORS.x, radius);
    }
    if (allowedRotationAxes.includes('y')) {
      appendCircleVertices(vertices, pose.position, rotMat, [0, 0, 1], [1, 0, 0], GIZMO_AXIS_COLORS.y, radius);
    }
    if (allowedRotationAxes.includes('z')) {
      appendCircleVertices(vertices, pose.position, rotMat, [1, 0, 0], [0, 1, 0], GIZMO_AXIS_COLORS.z, radius);
    }
  }

  if (pose.gizmoModes.translatable) {
    // --- Translation Arrows ---
    // X axis (Red)
    appendArrowVertices(vertices, pose.position, rotMat, [1, 0, 0], [0, 1, 0], [0, 0, 1], GIZMO_AXIS_COLORS.x, arrowStart, arrowLength, headSize);
    // Y axis (Green)
    appendArrowVertices(vertices, pose.position, rotMat, [0, 1, 0], [0, 0, 1], [1, 0, 0], GIZMO_AXIS_COLORS.y, arrowStart, arrowLength, headSize);
    // Z axis (Blue)
    appendArrowVertices(vertices, pose.position, rotMat, [0, 0, 1], [1, 0, 0], [0, 1, 0], GIZMO_AXIS_COLORS.z, arrowStart, arrowLength, headSize);
  }

  return vertices;
}

/**
 * 選択中のギズモ参照ボーンを返します。
 * @param {object} selection - 現在の選択状態。
 * @param {Array<number>} fallbackIndices - 選択中ボーンの候補。
 * @returns {number} 参照ボーンインデックス。
 */
function resolveGizmoReferenceBoneIndex(selection, fallbackIndices) {
  if (Number.isInteger(selection?.activeBoneIndex) && selection.activeBoneIndex >= 0 && fallbackIndices.includes(selection.activeBoneIndex)) {
    return selection.activeBoneIndex;
  }
  if (Number.isInteger(selection?.selectedBoneIndex) && selection.selectedBoneIndex >= 0 && fallbackIndices.includes(selection.selectedBoneIndex)) {
    return selection.selectedBoneIndex;
  }
  return fallbackIndices[0] ?? -1;
}

/**
 * 選択集合に含まれるボーンの gizmo 対応可否を集約します。
 * @param {object} model - モデルデータ。
 * @param {Array<number>} boneIndices - ボーンインデックス一覧。
 * @returns {{rotatable: boolean, translatable: boolean}} ギズモ対応フラグ。
 */
function getAggregateGizmoModes(model, boneIndices) {
  let rotatable = false;
  let translatable = false;
  for (const boneIndex of boneIndices) {
    const bone = model.bones?.[boneIndex];
    if (!bone) {
      continue;
    }
    const modes = getBoneGizmoModes(bone);
    rotatable ||= modes.rotatable;
    translatable ||= modes.translatable;
  }

  return { rotatable, translatable };
}

/**
 * World coordinate 用の gizmo basis を返します。
 * @returns {{x: vec3, y: vec3, z: vec3}} basis。
 */
function createWorldGizmoBasis() {
  return {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
  };
}

/**
 * 単一選択時の gizmo basis を返します。
 * @param {object|null} transform - ボーンのローカル変換状態。
 * @returns {{x: vec3, y: vec3, z: vec3}} basis。
 */
function createSingleGizmoBasis(transform) {
  if (!transform) {
    return createWorldGizmoBasis();
  }

  return {
    x: [transform.localX[0], transform.localX[1], transform.localX[2]],
    y: [transform.localY[0], transform.localY[1], transform.localY[2]],
    z: [transform.localZ[0], transform.localZ[1], transform.localZ[2]],
  };
}

/**
 * ボーンのローカル基底をワールド空間へ変換した gizmo basis を返します。
 * @param {object|null} transform - ボーンのローカル変換状態。
 * @returns {{x: vec3, y: vec3, z: vec3}} basis。
 */
function getWorldSpaceGizmoBasis(transform) {
  if (!transform) {
    return createWorldGizmoBasis();
  }

  const rotation = transform.worldRotation || quat.create();
  return {
    x: vec3.transformQuat(vec3.create(), transform.localX, rotation),
    y: vec3.transformQuat(vec3.create(), transform.localY, rotation),
    z: vec3.transformQuat(vec3.create(), transform.localZ, rotation),
  };
}

/**
 * 平均した local basis を正規直交化します。
 * @param {ArrayLike<number>} avgX - 平均 X 軸。
 * @param {ArrayLike<number>} avgY - 平均 Y 軸。
 * @param {ArrayLike<number>} avgZ - 平均 Z 軸。
 * @returns {{x: vec3, y: vec3, z: vec3}} basis。
 */
function orthonormalizeAveragedBasis(avgX, avgY, avgZ) {
  const x = normalizeOrFallback(avgX, [1, 0, 0]);
  let y = vec3.sub(vec3.create(), avgY, vec3.scale(vec3.create(), x, vec3.dot(avgY, x)));
  if (vec3.length(y) < HANDLE_MIN_LENGTH) {
    y = vec3.cross(vec3.create(), avgZ, x);
  }
  if (vec3.length(y) < HANDLE_MIN_LENGTH) {
    y = normalizeOrFallback([0, 1, 0], [0, 1, 0]);
  } else {
    vec3.normalize(y, y);
  }

  let z = vec3.cross(vec3.create(), x, y);
  if (vec3.length(z) < HANDLE_MIN_LENGTH) {
    z = normalizeOrFallback(avgZ, [0, 0, 1]);
  } else {
    vec3.normalize(z, z);
  }

  if (vec3.dot(z, avgZ) < 0) {
    vec3.scale(z, z, -1);
    vec3.scale(y, y, -1);
  }

  return {
    x: [x[0], x[1], x[2]],
    y: [y[0], y[1], y[2]],
    z: [z[0], z[1], z[2]],
  };
}

/**
 * ベクトルを正規化し、失敗時は fallback を返します。
 * @param {ArrayLike<number>} vector - 対象ベクトル。
 * @param {Array<number>} fallback - フォールバック。
 * @returns {vec3} 正規化結果。
 */
function normalizeOrFallback(vector, fallback) {
  const normalized = normalize(vector);
  if (vec3.length(normalized) < HANDLE_MIN_LENGTH) {
    return vec3.clone(fallback);
  }
  return normalized;
}

function appendCircleVertices(vertices, center, rotMat, axis1, axis2, color, radius) {
  for (let i = 0; i < GIZMO_SEGMENTS; i++) {
    const a1 = (i / GIZMO_SEGMENTS) * Math.PI * 2;
    const a2 = ((i + 1) / GIZMO_SEGMENTS) * Math.PI * 2;

    const p1 = [
      (Math.cos(a1) * axis1[0] + Math.sin(a1) * axis2[0]) * radius,
      (Math.cos(a1) * axis1[1] + Math.sin(a1) * axis2[1]) * radius,
      (Math.cos(a1) * axis1[2] + Math.sin(a1) * axis2[2]) * radius,
    ];
    const p2 = [
      (Math.cos(a2) * axis1[0] + Math.sin(a2) * axis2[0]) * radius,
      (Math.cos(a2) * axis1[1] + Math.sin(a2) * axis2[1]) * radius,
      (Math.cos(a2) * axis1[2] + Math.sin(a2) * axis2[2]) * radius,
    ];

    const v1 = mat4Vec4Mul(rotMat, [...p1, 1]);
    const v2 = mat4Vec4Mul(rotMat, [...p2, 1]);

    pushLineQuads(vertices,
      [center[0] + v1[0], center[1] + v1[1], center[2] + v1[2]],
      [center[0] + v2[0], center[1] + v2[1], center[2] + v2[2]],
      color
    );
  }
}

function appendArrowVertices(vertices, center, rotMat, forward, up, right, color, arrowStart, arrowLength, headSize) {
  const start = vec3.scale(vec3.create(), forward, arrowStart);
  const end = vec3.scale(vec3.create(), forward, arrowStart + arrowLength);

  const vStart = mat4Vec4Mul(rotMat, [...start, 1]);
  const vEnd = mat4Vec4Mul(rotMat, [...end, 1]);

  // Main line
  pushLineQuads(vertices,
    [center[0] + vStart[0], center[1] + vStart[1], center[2] + vStart[2]],
    [center[0] + vEnd[0], center[1] + vEnd[1], center[2] + vEnd[2]],
    color
  );

  // Cone tip (cube-like or wireframe cone)
  const tipBase = vec3.scale(vec3.create(), forward, arrowStart + arrowLength - headSize);
  const headOffsets = [
    vec3.add(vec3.create(), tipBase, vec3.scale(vec3.create(), up, headSize * 0.5)),
    vec3.add(vec3.create(), tipBase, vec3.scale(vec3.create(), right, headSize * 0.5)),
    vec3.add(vec3.create(), tipBase, vec3.scale(vec3.create(), up, -headSize * 0.5)),
    vec3.add(vec3.create(), tipBase, vec3.scale(vec3.create(), right, -headSize * 0.5)),
  ];

  for (const offset of headOffsets) {
    const vOffset = mat4Vec4Mul(rotMat, [...offset, 1]);
    pushLineQuads(vertices,
      [center[0] + vEnd[0], center[1] + vEnd[1], center[2] + vEnd[2]],
      [center[0] + vOffset[0], center[1] + vOffset[1], center[2] + vOffset[2]],
      color
    );
  }
  
  // Base of the cone
  for (let i = 0; i < headOffsets.length; i++) {
    const v1 = mat4Vec4Mul(rotMat, [...headOffsets[i], 1]);
    const v2 = mat4Vec4Mul(rotMat, [...headOffsets[(i + 1) % headOffsets.length], 1]);
    pushLineQuads(vertices,
      [center[0] + v1[0], center[1] + v1[1], center[2] + v1[2]],
      [center[0] + v2[0], center[1] + v2[1], center[2] + v2[2]],
      color
    );
  }
}

/**
 * ポインターレイでギズモをヒットテストします。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {object|null} [lightState=null] - ライト状態。
 */
export function pickGizmo(ray, instance, selection, lightState = null, inspectorState = null) {
  const pose = resolveGizmoPose(instance, selection, lightState, inspectorState);
  const rotationAxes = pose?.rotationAxes || (pose?.isLightObject ? ['x', 'y', 'z'] : []);
  if (!pose || ((rotationAxes.length === 0) && !pose.gizmoModes.translatable)) {
    return null;
  }

  const { model } = instance || {};
  const bone = pose.isLightObject ? null : model?.bones?.[pose.referenceBoneIndex] ?? null;
  const scale = getPoseGizmoScale(ray.start, pose.position, pose.isLightObject);
  const radius = GIZMO_RADIUS * scale;
  const thickness = GIZMO_THICKNESS * scale;
  const arrowStart = GIZMO_ARROW_START * scale;
  const arrowLength = GIZMO_ARROW_LENGTH * scale;

  const hits = [];
  const allowedRotationAxes = pose.isLightObject ? ['x', 'y', 'z'] : rotationAxes;

  if (pose.gizmoModes.rotatable && allowedRotationAxes.length > 0) {
    // Rotation hits
    if (allowedRotationAxes.includes('x')) {
      addCircleHandleHit(hits, ray, pose.position, pose.worldAxes.x, 'x', radius, thickness, 'rotate');
    }
    if (allowedRotationAxes.includes('y')) {
      addCircleHandleHit(hits, ray, pose.position, pose.worldAxes.y, 'y', radius, thickness, 'rotate');
    }
    if (allowedRotationAxes.includes('z')) {
      addCircleHandleHit(hits, ray, pose.position, pose.worldAxes.z, 'z', radius, thickness, 'rotate');
    }
  }

  if (pose.gizmoModes.translatable) {
    // Translation hits
    checkArrowHit(hits, ray, pose.position, pose.worldAxes.x, 'x', arrowStart, arrowStart + arrowLength, thickness);
    checkArrowHit(hits, ray, pose.position, pose.worldAxes.y, 'y', arrowStart, arrowStart + arrowLength, thickness);
    checkArrowHit(hits, ray, pose.position, pose.worldAxes.z, 'z', arrowStart, arrowStart + arrowLength, thickness);
  }

  if (hits.length === 0) return null;

  // Prefer direct plane hits over edge-on fallback hits.
  hits.sort((a, b) => {
    const aRank = a.kindRank ?? 0;
    const bRank = b.kindRank ?? 0;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.distance - b.distance;
  });
  return hits[0];
}

/**
 * 円形ハンドルのヒットテストを行います。
 * 視線が円の法線に対して平行に近い場合は、共通の OBB 判定へフォールバックします。
 * @param {object} ray - レイ。
 * @param {Array<number>} center - ハンドル中心。
 * @param {Array<number>} normal - ハンドル法線。
 * @param {string} axis - 軸名。
 * @param {number} radius - ハンドル半径。
 * @param {number} thickness - 許容厚み。
 * @param {string} [mode='rotate'] - ヒットモード。
 * @returns {object|null} ヒット情報。
 */
export function pickCircularHandleHit(ray, center, normal, axis, radius, thickness, mode='rotate') {
  const rayVector = vec3.sub(vec3.create(), ray.end, ray.start);
  const rayLength = vec3.length(rayVector);
  if (rayLength < HANDLE_MIN_LENGTH) {
    return null;
  }

  const rayDir = vec3.scale(vec3.create(), rayVector, 1 / rayLength);
  const circleNormal = normalizeCircleVector(normal);
  if (!circleNormal) {
    return null;
  }

  const planeAlignment = Math.abs(vec3.dot(circleNormal, rayDir));
  if (planeAlignment >= HANDLE_EDGE_ON_DOT_THRESHOLD) {
    return pickRingPlaneHit(ray, center, circleNormal, axis, radius, thickness, mode);
  }

  const basis = createEdgeOnHandleBasis(circleNormal, rayDir);
  if (!basis) {
    return pickRingPlaneHit(ray, center, circleNormal, axis, radius, thickness, mode);
  }

  const halfSizeX = radius + thickness;
  const halfSizeY = thickness;
  const halfSizeZ = thickness;
  const localHit = intersectRayOrientedBox(
    ray,
    center,
    basis.xAxis,
    basis.yAxis,
    basis.zAxis,
    halfSizeX,
    halfSizeY,
    halfSizeZ,
  );
  if (!localHit) {
    return null;
  }

  return {
    axis,
    mode,
    hitPoint: localHit.hitPoint,
    distance: localHit.distance / rayLength,
    normal: circleNormal,
    kindRank: 1,
    dragKind: 'edge-on-ring',
    localPoint: localHit.localPoint,
    edgeOnBasisX: basis.xAxis,
    edgeOnBasisY: basis.yAxis,
    edgeOnBasisZ: basis.zAxis,
    edgeOnHalfSizeX: halfSizeX,
    edgeOnHalfSizeY: halfSizeY,
    edgeOnHalfSizeZ: halfSizeZ,
  };
}

/**
 * 後方互換用のリングヒットテストです。
 * @param {object} ray - レイ。
 * @param {Array<number>} center - リング中心。
 * @param {Array<number>} normal - リング法線。
 * @param {string} axis - 軸名。
 * @param {number} radius - リング半径。
 * @param {number} thickness - 許容厚み。
 * @param {string} [mode='rotate'] - ヒットモード。
 * @returns {object|null} ヒット情報。
 */
export function pickRingHit(ray, center, normal, axis, radius, thickness, mode='rotate') {
  return pickCircularHandleHit(ray, center, normal, axis, radius, thickness, mode);
}

function addCircleHandleHit(hits, ray, center, normal, axis, radius, thickness, mode) {
  const hit = pickCircularHandleHit(ray, center, normal, axis, radius, thickness, mode);
  if (hit) {
    hits.push(hit);
  }
}

/**
 * 円ヒットの法線ベクトルを正規化します。
 * @param {ArrayLike<number>} vector - ベクトル。
 * @returns {Array<number>|null} 正規化結果。
 */
function normalizeCircleVector(vector) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    return null;
  }

  const length = vec3.length(vector);
  if (!Number.isFinite(length) || length < HANDLE_MIN_LENGTH) {
    return null;
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * 視線が edge-on の円ハンドル用の基底を作成します。
 * @param {Array<number>} normal - 円法線。
 * @param {Array<number>} rayDir - レイ方向。
 * @returns {{xAxis: Array<number>, yAxis: Array<number>, zAxis: Array<number>}|null} 基底。
 */
function createEdgeOnHandleBasis(normal, rayDir) {
  const xAxis = vec3.cross(vec3.create(), normal, rayDir);
  if (vec3.length(xAxis) < HANDLE_MIN_LENGTH) {
    return null;
  }
  vec3.normalize(xAxis, xAxis);

  const yAxis = vec3.cross(vec3.create(), normal, xAxis);
  if (vec3.length(yAxis) < HANDLE_MIN_LENGTH) {
    return null;
  }
  vec3.normalize(yAxis, yAxis);

  return {
    xAxis: [xAxis[0], xAxis[1], xAxis[2]],
    yAxis: [yAxis[0], yAxis[1], yAxis[2]],
    zAxis: [normal[0], normal[1], normal[2]],
  };
}

/**
 * レイと OBB の交差を求めます。
 * @param {object} ray - レイ。
 * @param {Array<number>} center - OBB 中心。
 * @param {Array<number>} axisX - OBB の X 軸。
 * @param {Array<number>} axisY - OBB の Y 軸。
 * @param {Array<number>} axisZ - OBB の Z 軸。
 * @param {number} halfSizeX - X 軸半サイズ。
 * @param {number} halfSizeY - Y 軸半サイズ。
 * @param {number} halfSizeZ - Z 軸半サイズ。
 * @returns {{hitPoint: Array<number>, localPoint: Array<number>, distance: number}|null} ヒット情報。
 */
function intersectRayOrientedBox(ray, center, axisX, axisY, axisZ, halfSizeX, halfSizeY, halfSizeZ) {
  const rayVector = vec3.sub(vec3.create(), ray.end, ray.start);
  const rayLength = vec3.length(rayVector);
  if (rayLength < HANDLE_MIN_LENGTH) {
    return null;
  }

  const rayDir = vec3.scale(vec3.create(), rayVector, 1 / rayLength);
  const origin = vec3.sub(vec3.create(), ray.start, center);
  const localOrigin = [
    vec3.dot(origin, axisX),
    vec3.dot(origin, axisY),
    vec3.dot(origin, axisZ),
  ];
  const localDir = [
    vec3.dot(rayDir, axisX),
    vec3.dot(rayDir, axisY),
    vec3.dot(rayDir, axisZ),
  ];
  const halfSizes = [halfSizeX, halfSizeY, halfSizeZ];
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let i = 0; i < 3; i++) {
    const originValue = localOrigin[i];
    const directionValue = localDir[i];
    const halfSize = halfSizes[i];
    if (Math.abs(directionValue) < HANDLE_MIN_LENGTH) {
      if (Math.abs(originValue) > halfSize) {
        return null;
      }
      continue;
    }

    let t1 = (-halfSize - originValue) / directionValue;
    let t2 = (halfSize - originValue) / directionValue;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return null;
    }
  }

  const t = tMin >= 0 ? tMin : tMax;
  if (!Number.isFinite(t) || t < 0 || t > rayLength) {
    return null;
  }

  const localPoint = [
    localOrigin[0] + localDir[0] * t,
    localOrigin[1] + localDir[1] * t,
    localOrigin[2] + localDir[2] * t,
  ];
  const hitPoint = vec3.add(vec3.create(), center, vec3.scale(vec3.create(), rayDir, t));
  return {
    hitPoint: [hitPoint[0], hitPoint[1], hitPoint[2]],
    localPoint,
    distance: t,
  };
}

/**
 * リング平面との交差を求めます。
 * @param {object} ray - レイ。
 * @param {Array<number>} center - リング中心。
 * @param {Array<number>} normal - リング法線。
 * @param {string} axis - 軸名。
 * @param {number} radius - リング半径。
 * @param {number} thickness - 許容厚み。
 * @param {string} mode - ヒットモード。
 * @returns {object|null} ヒット情報。
 */
function pickRingPlaneHit(ray, center, normal, axis, radius, thickness, mode) {
  const rayVector = vec3.sub(vec3.create(), ray.end, ray.start);
  const denom = vec3.dot(normal, rayVector);
  if (Math.abs(denom) < HANDLE_MIN_LENGTH) {
    return null;
  }

  const t = vec3.dot(vec3.sub(vec3.create(), center, ray.start), normal) / denom;
  if (t < 0 || t > 1) {
    return null;
  }

  const hitPoint = vec3.add(vec3.create(), ray.start, vec3.scale(vec3.create(), rayVector, t));
  const distToCenter = vec3.distance(hitPoint, center);
  if (Math.abs(distToCenter - radius) >= thickness) {
    return null;
  }

  return {
    axis,
    mode,
    hitPoint,
    distance: t,
    normal,
    kindRank: 0,
    dragKind: 'ring-plane',
  };
}

/**
 * ボーンのギズモ表示可否を判定します。
 * PMD のようにフラグがない形式は、従来どおり両方表示します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {{rotatable: boolean, translatable: boolean}} 表示可否。
 */
export function getBoneGizmoModes(bone) {
  const flags = bone?.flags;
  if (typeof flags !== 'number') {
    return { rotatable: true, translatable: true };
  }

  return {
    rotatable: (flags & BONE_FLAG_ROTATABLE) !== 0,
    translatable: (flags & BONE_FLAG_TRANSLATABLE) !== 0,
  };
}

function checkArrowHit(hits, ray, center, worldAxis, axis, arrowStart, totalLength, thickness) {
  const shaftStartPos = vec3.add(vec3.create(), center, vec3.scale(vec3.create(), worldAxis, arrowStart));
  const tipPos = vec3.add(vec3.create(), center, vec3.scale(vec3.create(), worldAxis, totalLength));
  
  const rayDir = normalize(vec3.sub(vec3.create(), ray.end, ray.start));
  const shaftVec = vec3.sub(vec3.create(), tipPos, shaftStartPos);
  const shaftDir = normalize(vec3.clone(shaftVec));
  const shaftLen = vec3.length(shaftVec);

  // Ray-segment closest distance
  // Line 1: P = ray.start + rayDir * t
  // Line 2: Q = shaftStartPos + shaftDir * s  (0 <= s <= shaftLen)
  
  const w0 = vec3.sub(vec3.create(), ray.start, shaftStartPos);
  const a = vec3.dot(rayDir, rayDir);
  const b = vec3.dot(rayDir, shaftDir);
  const c = vec3.dot(shaftDir, shaftDir);
  const d = vec3.dot(rayDir, w0);
  const e = vec3.dot(shaftDir, w0);
  
  const denom = a * c - b * b;
  let t, s;

  if (denom < 1e-6) {
    t = 0;
    s = e / c;
  } else {
    t = (b * e - c * d) / denom;
    s = (a * e - b * d) / denom;
  }

  s = clamp(s, 0, shaftLen);
  if (t < 0) t = 0;

  const pOnRay = vec3.add(vec3.create(), ray.start, vec3.scale(vec3.create(), rayDir, t));
  const qOnShaft = vec3.add(vec3.create(), shaftStartPos, vec3.scale(vec3.create(), shaftDir, s));
  const dist = vec3.distance(pOnRay, qOnShaft);

  if (dist < thickness * 2.0) {
    hits.push({
      axis,
      mode: 'translate',
      hitPoint: pOnRay,
      distance: t / vec3.distance(ray.start, ray.end),
      normal: worldAxis,
      kindRank: 0,
    });
  }
}

/**
 * ドラッグを開始します。
 */
export function beginGizmoDrag(state, hit, instance, selection, modelManager, lightState = null, inspectorState = null) {
  const pose = resolveGizmoPose(instance, selection, lightState, inspectorState);
  if (!pose) {
    return;
  }

  state.isDragging = true;
  state.mode = hit.mode;
  state.axis = hit.axis;
  state.dragKind = hit.dragKind || 'ring-plane';
  state.startPosition = vec3.clone(pose.position);
  state.startHitPoint = vec3.clone(hit.hitPoint);
  state.dragPlaneNormal = vec3.clone(hit.normal);
  state.dragAxisWorld = vec3.clone(hit.normal);
  state.edgeOnHalfSizeX = hit.edgeOnHalfSizeX || 0;
  state.edgeOnHalfSizeY = hit.edgeOnHalfSizeY || 0;
  state.edgeOnHalfSizeZ = hit.edgeOnHalfSizeZ || 0;
  state.edgeOnBasisX = hit.edgeOnBasisX ? vec3.clone(hit.edgeOnBasisX) : vec3.create();
  state.edgeOnBasisY = hit.edgeOnBasisY ? vec3.clone(hit.edgeOnBasisY) : vec3.create();
  state.edgeOnBasisZ = hit.edgeOnBasisZ ? vec3.clone(hit.edgeOnBasisZ) : vec3.create();
  state.edgeOnStartAngle = Array.isArray(hit.localPoint)
    ? Math.atan2(hit.localPoint[1], hit.localPoint[0])
    : 0;

  if (pose.isLightObject) {
    state.isLightObject = true;
    state.lightState = lightState ?? null;
    state.boneIndex = -1;
    state.selectedBoneIndices = [];
    state.startBoneStates = [];
    state.startLightRotation = quat.clone(state.lightState?.rotation ?? quat.create());
    state.startLightPosition = vec3.clone(state.lightState?.position ?? pose.position);
    state.startLocalRotation = quat.create();
    state.startManualTranslation = vec3.create();
    return;
  }

  const firstBoneState = buildGizmoDragBoneState(instance, pose.referenceBoneIndex);
  if (!firstBoneState) {
    return;
  }

  state.isLightObject = false;
  state.lightState = null;
  state.boneIndex = pose.referenceBoneIndex;
  state.selectedBoneIndices = pose.boneIndices.slice();
  state.startBoneStates = pose.boneIndices
    .map((boneIndex) => buildGizmoDragBoneState(instance, boneIndex))
    .filter((boneState) => boneState !== null);
  state.startLocalRotation = quat.clone(firstBoneState.startLocalRotation);
  state.startManualTranslation = vec3.clone(firstBoneState.startManualTranslation);
}

/**
 * ドラッグ中の更新を行います。
 */
export function updateGizmoDrag(state, instance, ray, selection, modelManager, inspectorState = null) {
  if (!state.isDragging) return false;

  if (state.isLightObject && state.lightState) {
    const currentFrame = Number.isFinite(instance?.animationController?.currentFrame)
      ? instance.animationController.currentFrame
      : null;
    if (state.mode === 'rotate') {
      const angle = computeGizmoRotationAngle(state, ray);
      if (angle === null) {
        return false;
      }
      applyLightRotationDelta(state.lightState, state.startLightRotation, state.dragAxisWorld, angle, currentFrame);
      return true;
    }

    if (state.mode === 'translate') {
      const worldMove = computeGizmoTranslationDelta(state, ray);
      if (!worldMove) {
        return false;
      }
      applyLightTranslationDelta(state.lightState, state.startLightPosition, worldMove, currentFrame);
      return true;
    }
    return false;
  }

  if (state.mode === 'rotate') {
    if (!getAllowedRotationAxes(instance.model.bones[state.boneIndex]).includes(state.axis)) {
      return false;
    }
    const angle = computeGizmoRotationAngle(state, ray);
    if (angle === null) {
      return false;
    }

    if (isWorldMode(selection, inspectorState)) {
      applyWorldRotationDeltaToSelection(state, instance, angle, modelManager);
    } else {
      applyLocalRotationDeltaToSelection(state, instance, angle, modelManager);
    }
    return true;
  }

  if (state.mode === 'translate') {
    const worldMove = computeGizmoTranslationDelta(state, ray);
    if (!worldMove) {
      return false;
    }

    applyTranslationDeltaToSelection(state, instance, worldMove, modelManager);
    return true;
  }

  return false;
}

/**
 * ドラッグを終了します。
 */
export function endGizmoDrag(state) {
  state.isDragging = false;
  state.mode = null;
  state.axis = null;
  state.dragKind = null;
  state.isLightObject = false;
  state.lightState = null;
  state.boneIndex = -1;
  state.selectedBoneIndices = [];
  state.startBoneStates = [];
  vec3.set(state.startPosition, 0, 0, 0);
  vec3.set(state.startHitPoint, 0, 0, 0);
  quat.identity(state.startLocalRotation);
  vec3.set(state.startManualTranslation, 0, 0, 0);
  quat.identity(state.startLightRotation);
  vec3.set(state.startLightPosition, 0, 0, 0);
  vec3.set(state.dragPlaneNormal, 0, 0, 0);
  vec3.set(state.dragAxisWorld, 0, 0, 0);
  vec3.set(state.edgeOnBasisX, 0, 0, 0);
  vec3.set(state.edgeOnBasisY, 0, 0, 0);
  vec3.set(state.edgeOnBasisZ, 0, 0, 0);
  state.edgeOnHalfSizeX = 0;
  state.edgeOnHalfSizeY = 0;
  state.edgeOnHalfSizeZ = 0;
  state.edgeOnStartAngle = 0;
}

/**
 * ギズモドラッグ用のボーン状態を作成します。
 * @param {object} instance - モデルインスタンス。
 * @param {number} boneIndex - ボーンインデックス。
 * @returns {Object|null} ボーン状態。
 */
function buildGizmoDragBoneState(instance, boneIndex) {
  const transform = instance.scene.boneLocalTransforms?.[boneIndex];
  if (!transform) {
    return null;
  }

  return {
    boneIndex,
    startLocalRotation: getEffectiveLocalRotation(transform),
    startManualTranslation: vec3.clone(transform.manualTranslation),
    localX: vec3.clone(transform.localX),
    localY: vec3.clone(transform.localY),
    localZ: vec3.clone(transform.localZ),
  };
}

/**
 * 回転ドラッグの角度差分を計算します。
 * @param {GizmoState} state - ギズモ状態。
 * @param {object} ray - レイ。
 * @returns {number|null} 差分角。
 */
function computeGizmoRotationAngle(state, ray) {
  const center = state.startPosition;

  if (state.dragKind === 'edge-on-ring') {
    const currentHit = intersectRayOrientedBox(
      ray,
      center,
      state.edgeOnBasisX,
      state.edgeOnBasisY,
      state.edgeOnBasisZ,
      state.edgeOnHalfSizeX,
      state.edgeOnHalfSizeY,
      state.edgeOnHalfSizeZ,
    );
    if (!currentHit) {
      return null;
    }
    return Math.atan2(currentHit.localPoint[1], currentHit.localPoint[0]) - state.edgeOnStartAngle;
  }

  const rayVector = vec3.sub(vec3.create(), ray.end, ray.start);
  const denom = vec3.dot(state.dragPlaneNormal, rayVector);
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const t = vec3.dot(vec3.sub(vec3.create(), center, ray.start), state.dragPlaneNormal) / denom;
  const hitPoint = vec3.add(vec3.create(), ray.start, vec3.scale(vec3.create(), rayVector, t));
  const vStart = normalize(vec3.sub(vec3.create(), state.startHitPoint, center));
  const vCurrent = normalize(vec3.sub(vec3.create(), hitPoint, center));
  return signedAngle(vStart, vCurrent, state.dragPlaneNormal);
}

/**
 * 平行移動ドラッグの差分を計算します。
 * @param {GizmoState} state - ギズモ状態。
 * @param {object} ray - レイ。
 * @returns {vec3|null} ワールド空間の移動差分。
 */
function computeGizmoTranslationDelta(state, ray) {
  const rayDir = normalize(vec3.sub(vec3.create(), ray.end, ray.start));
  const worldAxis = state.dragAxisWorld;
  const planeNormal = normalize(cross(cross(rayDir, worldAxis), worldAxis));
  const denom = vec3.dot(planeNormal, rayDir);
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const t = vec3.dot(vec3.sub(vec3.create(), state.startHitPoint, ray.start), planeNormal) / denom;
  const hitPoint = vec3.add(vec3.create(), ray.start, vec3.scale(vec3.create(), rayDir, t));
  const worldDelta = vec3.sub(vec3.create(), hitPoint, state.startHitPoint);
  const moveAmount = vec3.dot(worldDelta, worldAxis);
  return vec3.scale(vec3.create(), worldAxis, moveAmount);
}

/**
 * 回転差分を選択集合へ適用します。
 * @param {GizmoState} state - ギズモ状態。
 * @param {object} instance - モデルインスタンス。
 * @param {number} angle - 回転差分角。
 * @param {object} modelManager - モデル管理インスタンス。
 */
function applyLocalRotationDeltaToSelection(state, instance, angle, modelManager) {
  const { scene } = instance;
  for (let i = 0; i < state.startBoneStates.length; i++) {
    const boneState = state.startBoneStates[i];
    if (!getAllowedRotationAxes(instance.model.bones[boneState.boneIndex]).includes(state.axis)) {
      continue;
    }
    const transform = scene.boneLocalTransforms[boneState.boneIndex];
    if (!transform) {
      continue;
    }

    let localAxis;
    if (state.axis === 'x') localAxis = boneState.localX;
    else if (state.axis === 'y') localAxis = boneState.localY;
    else localAxis = boneState.localZ;

    const deltaRot = quat.setAxisAngle(quat.create(), localAxis, angle);
    const targetRotation = quat.multiply(quat.create(), boneState.startLocalRotation, deltaRot);
    modelManager.setManualLocalRotationQuaternion(instance, boneState.boneIndex, targetRotation);
  }
}

/**
 * 世界空間の回転差分を選択集合へ適用します。
 * @param {GizmoState} state - ギズモ状態。
 * @param {object} instance - モデルインスタンス。
 * @param {number} angle - 回転差分角。
 * @param {object} modelManager - モデル管理インスタンス。
 */
function applyWorldRotationDeltaToSelection(state, instance, angle, modelManager) {
  const { scene, model } = instance;
  const deltaRotWorld = quat.setAxisAngle(quat.create(), state.dragAxisWorld, angle);

  for (const boneState of state.startBoneStates) {
    const bone = model.bones?.[boneState.boneIndex];
    if (!getAllowedRotationAxes(bone).includes(state.axis)) {
      continue;
    }
    const transform = scene.boneLocalTransforms?.[boneState.boneIndex];
    if (!bone || !transform) {
      continue;
    }

    const parentWorldRot = bone.parentIndex !== -1
      ? scene.boneLocalTransforms?.[bone.parentIndex]?.worldRotation ?? quat.create()
      : quat.create();
    const invParentRot = quat.invert(quat.create(), parentWorldRot);
    const deltaRotLocal = quat.multiply(quat.create(), invParentRot, deltaRotWorld);
    quat.multiply(deltaRotLocal, deltaRotLocal, parentWorldRot);

    const targetRotation = quat.multiply(quat.create(), deltaRotLocal, boneState.startLocalRotation);
    modelManager.setManualLocalRotationQuaternion(instance, boneState.boneIndex, targetRotation);
  }
}

/**
 * 平行移動差分を選択集合へ適用します。
 * @param {GizmoState} state - ギズモ状態。
 * @param {object} instance - モデルインスタンス。
 * @param {vec3} worldMove - ワールド空間移動量。
 * @param {object} modelManager - モデル管理インスタンス。
 */
function applyTranslationDeltaToSelection(state, instance, worldMove, modelManager) {
  const { scene, model } = instance;
  for (const boneState of state.startBoneStates) {
    const transform = scene.boneLocalTransforms?.[boneState.boneIndex];
    if (!transform) {
      continue;
    }

    const localDelta = worldDeltaToLocalDelta(scene, model, boneState.boneIndex, worldMove);
    const targetPosition = vec3.add(vec3.create(), transform.translation, boneState.startManualTranslation);
    vec3.add(targetPosition, targetPosition, localDelta);
    modelManager.setManualLocalPosition(instance, boneState.boneIndex, targetPosition);
  }
}

function signedAngle(v1, v2, axis) {
  const crossProd = cross(v1, v2);
  const dot = vec3.dot(v1, v2);
  const angle = Math.atan2(vec3.length(crossProd), dot);
  return vec3.dot(axis, crossProd) < 0 ? -angle : angle;
}
