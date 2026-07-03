import { quaternionFromEulerXYZ, pushLineQuads } from '../../shared/math/math-utils.js';
import { quat, vec3 } from '../../lib/esm/index.js';
import { findBoneIndexByName } from './model-scene.js';

const CUSTOM_RIG_SCALE = 0.1;
const ARM_OFFSET = 1 * CUSTOM_RIG_SCALE;
const AQUA_COLOR = [0.3, 0.4, 0.5]; // ボーンの描画色は source/ui-overlay.js 内の updateBoneLineBuffer 関数で定義されている
const AQUA_COLOR_SELECTED = [0.6, 0.8, 1.0]; 
const RED_COLOR = [0.5, 0.2, 0.2];
const RED_COLOR_SELECTED = [1, 0.3, 0.3];
/**
 * カスタムリグの円形状定義です。pdateBoneLineBuffer においてこれらのボーンが「隠しボーン」として扱われ、通常の骨格線（ライン）が表示されなくなる副作用がある
 * rotation は x, y, z の順で、度（degree）で回転量を指定する
 * @type {Array<{boneName: string, offset: Array<number>, rotation: Array<number>, radius: number, color: Array<number>, selectedColor: Array<number>}>}
 */
export const CUSTOM_RIG_CIRCLE_DEFINITIONS = [
  {
    boneName: '全ての親',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    radius: 2.5 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: 'センター',
    offset: [0, 0, 0],
    rotation: [90, 0, 0],
    radius: 2.5 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: '頭',
    offset: [0, 0.8 * CUSTOM_RIG_SCALE, 0],
    rotation: [0, 0, 0],
    radius: 2 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: '首',
    offset: [0, 0.5 * CUSTOM_RIG_SCALE, 0],
    rotation: [-15, 0, 0],
    radius: 0.8 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: '下半身',
    offset: [0, -0.2, 0],
    rotation: [0, 0, 0],
    radius: 2.5 * CUSTOM_RIG_SCALE,
    color: [0.5, 0, 0.5],
    selectedColor: [0.8, 0, 1],
  },
  {
    boneName: '右腕',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: '右ひじ',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: '左腕',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: '左ひじ',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  /**
   * VRM
   */
    {
    boneName: 'hips',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    radius: 2.5 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: 'head',
    offset: [0, 0.8 * CUSTOM_RIG_SCALE, 0],
    rotation: [0, 0, 0],
    radius: 2 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: 'head',
    offset: [0, 0.8 * CUSTOM_RIG_SCALE, 0],
    rotation: [0, 0, 0],
    radius: 2 * CUSTOM_RIG_SCALE,
    color: RED_COLOR,
    selectedColor: RED_COLOR_SELECTED,
  },
  {
    boneName: 'leftUpperArm',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: 'leftLowerArm',
    offset: [ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: 'rightUpperArm',
    offset: [-ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
  {
    boneName: 'rightLowerArm',
    offset: [-ARM_OFFSET, 0, 0],
    rotation: [0, 0, 90],
    radius: 1 * CUSTOM_RIG_SCALE,
    color: AQUA_COLOR,
    selectedColor: AQUA_COLOR_SELECTED,
  },
];

/**
 * カスタムリグで扱うボーン名の一覧を返します。
 * @returns {Array<string>} ボーン名一覧。
 */
export function getCustomRigBoneNames() {
  const names = [];
  const seen = new Set();
  for (const definition of CUSTOM_RIG_CIRCLE_DEFINITIONS) {
    if (!definition || typeof definition.boneName !== 'string' || seen.has(definition.boneName)) {
      continue;
    }
    seen.add(definition.boneName);
    names.push(definition.boneName);
  }
  return names;
}

/**
 * カスタムリグの円形状ターゲットを返します。
 * @param {object} instance - モデルインスタンス。
 * @returns {Array<object>} 円形状情報。
 */
export function getCustomRigCircleTargets(instance) {
  const model = instance?.model || null;
  const scene = instance?.scene || null;
  if (
    instance?.visible === false
    || !model
    || !scene
    || !Array.isArray(model.bones)
    || !Array.isArray(scene.boneWorldPositions)
  ) {
    return [];
  }

  const customRigBoneIndexByName = scene.boneDebugLists?.customRigBoneIndexByName || null;
  const targets = [];
  for (const definition of CUSTOM_RIG_CIRCLE_DEFINITIONS) {
    const boneIndex = resolveCustomRigBoneIndex(model, customRigBoneIndexByName, definition.boneName);
    if (boneIndex === -1) {
      continue;
    }

    const position = scene.boneWorldPositions[boneIndex];
    if (!Array.isArray(position) || position.length < 3) {
      continue;
    }

    const localTransform = Array.isArray(scene.boneLocalTransforms) ? scene.boneLocalTransforms[boneIndex] ?? null : null;
    const offsetRotation = createCustomRigCircleBaseQuaternion(localTransform);
    const transformedOffset = getCustomRigOffset(definition.offset, offsetRotation);
    const rotation = Array.isArray(definition.rotation) ? definition.rotation : [0, 0, 0];
    const circleRotation = createCustomRigCircleRotationQuaternion(offsetRotation, rotation);
    targets.push({
      boneIndex,
      boneName: definition.boneName,
      center: [
        position[0] + (transformedOffset[0] || 0),
        position[1] + (transformedOffset[1] || 0),
        position[2] + (transformedOffset[2] || 0),
      ],
      normal: transformCustomRigNormal(circleRotation),
      radius: definition.radius,
      color: definition.color,
      selectedColor: definition.selectedColor ?? definition.color,
      rotation,
      circleRotation,
    });
  }

  return targets;
}

/**
 * カスタムリグのオフセットをボーン基底で world-space に変換します。
 * @param {ArrayLike<number>|null|undefined} offset - ローカル軸でのオフセット。
 * @param {quat} offsetRotation - ボーン姿勢込みの基底回転。
 * @returns {Array<number>} 変換後のオフセット。
 */
function getCustomRigOffset(offset, offsetRotation) {
  if (!Array.isArray(offset) && !ArrayBuffer.isView(offset)) {
    return [0, 0, 0];
  }

  const sourceOffset = [offset[0] || 0, offset[1] || 0, offset[2] || 0];
  const transformedOffset = vec3.transformQuat(vec3.create(), sourceOffset, offsetRotation);
  return [transformedOffset[0], transformedOffset[1], transformedOffset[2]];
}

/**
 * カスタムリグの基底回転を返します。
 * @param {object|null} localTransform - ボーンのローカル変換状態。
 * @returns {quat} ボーン姿勢込みの基底回転。
 */
function createCustomRigCircleBaseQuaternion(localTransform) {
  const baseRotation = isVectorLike(localTransform?.worldRotation, 4)
    ? localTransform.worldRotation
    : quat.create();
  const localX = localTransform?.localX;
  const localY = localTransform?.localY;
  const localZ = localTransform?.localZ;
  if (!isVectorLike(localX, 3) || !isVectorLike(localY, 3) || !isVectorLike(localZ, 3)) {
    return quat.clone(baseRotation);
  }

  const basisMat = [
    localX[0], localX[1], localX[2],
    localY[0], localY[1], localY[2],
    localZ[0], localZ[1], localZ[2],
  ];
  const basisRotation = quat.fromMat3(quat.create(), basisMat);
  const combinedRotation = quat.create();
  quat.multiply(combinedRotation, baseRotation, basisRotation);
  quat.normalize(combinedRotation, combinedRotation);
  return combinedRotation;
}

/**
 * カスタムリグ定義の追加回転をクォータニオンで返します。
 * ボーンの姿勢と基底に合わせたあと、定義の rotation をローカル軸で適用します。
 * @param {quat} baseRotation - ボーン姿勢込みの基底回転。
 * @param {ArrayLike<number>|null|undefined} rotation - XYZ 順の度数回転。
 * @returns {quat} 回転クォータニオン。
 */
function createCustomRigCircleRotationQuaternion(baseRotation, rotation) {
  const normalizedBaseRotation = isVectorLike(baseRotation, 4)
    ? baseRotation
    : quat.create();
  if (!Array.isArray(rotation) && !ArrayBuffer.isView(rotation)) {
    return quat.clone(normalizedBaseRotation);
  }

  const x = (rotation[0] || 0) * Math.PI / 180;
  const y = (rotation[1] || 0) * Math.PI / 180;
  const z = (rotation[2] || 0) * Math.PI / 180;
  if (Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8 && Math.abs(z) < 1e-8) {
    return quat.clone(normalizedBaseRotation);
  }

  const extraRotation = quaternionFromEulerXYZ([x, y, z], quat.create());
  const combinedRotation = quat.create();
  quat.multiply(combinedRotation, normalizedBaseRotation, extraRotation);
  quat.normalize(combinedRotation, combinedRotation);
  return combinedRotation;
}

/**
 * 円の法線を回転します。
 * @param {quat} rotationQuat - 回転クォータニオン。
 * @returns {Array<number>} 回転後の法線。
 */
function transformCustomRigNormal(rotationQuat) {
  const normal = vec3.transformQuat(vec3.create(), [0, 1, 0], rotationQuat);
  return [normal[0], normal[1], normal[2]];
}

/**
 * カスタムリグの円形状を描画するための頂点を返します。
 * @param {Array<number>} position - 中心座標。
 * @param {Array<number>} positionOffset - 追加オフセット。
 * @param {ArrayLike<number>|null|undefined} rotation - XYZ 順の度数回転。
 * @param {number} radius - 半径。
 * @param {Array<number>} color - 色。
 * @param {number} [segments=128] - 分割数。
 * @returns {Array<number>} 頂点配列。
 */
export function createCustomRigCircleVertices(position, positionOffset, rotation, radius, color, segments = 128) {
  const center = [
    position[0] + positionOffset[0],
    position[1] + positionOffset[1],
    position[2] + positionOffset[2],
  ];
  const rotationQuat = (Array.isArray(rotation) || ArrayBuffer.isView(rotation)) && rotation.length === 4
    ? rotation
    : createCustomRigCircleRotationQuaternion(null, rotation);
  const xAxis = vec3.transformQuat(vec3.create(), [1, 0, 0], rotationQuat);
  const zAxis = vec3.transformQuat(vec3.create(), [0, 0, 1], rotationQuat);
  const vertices = [];
  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;
    const point1 = [
      center[0] + xAxis[0] * Math.cos(angle1) * radius + zAxis[0] * Math.sin(angle1) * radius,
      center[1] + xAxis[1] * Math.cos(angle1) * radius + zAxis[1] * Math.sin(angle1) * radius,
      center[2] + xAxis[2] * Math.cos(angle1) * radius + zAxis[2] * Math.sin(angle1) * radius,
    ];
    const point2 = [
      center[0] + xAxis[0] * Math.cos(angle2) * radius + zAxis[0] * Math.sin(angle2) * radius,
      center[1] + xAxis[1] * Math.cos(angle2) * radius + zAxis[1] * Math.sin(angle2) * radius,
      center[2] + xAxis[2] * Math.cos(angle2) * radius + zAxis[2] * Math.sin(angle2) * radius,
    ];
    pushLineQuads(
      vertices,
      point1,
      point2,
      color,
    );
  }
  return vertices;
}

/**
 * 数値ベクトルとして扱えるか判定します。
 * @param {ArrayLike<number>|null|undefined} value - 判定対象。
 * @param {number} length - 必要要素数。
 * @returns {boolean} ベクトルとして扱える場合 true。
 */
function isVectorLike(value, length) {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length >= length;
}

function resolveCustomRigBoneIndex(model, customRigBoneIndexByName, boneName) {
  if (customRigBoneIndexByName && typeof customRigBoneIndexByName.get === 'function') {
    const mappedIndex = customRigBoneIndexByName.get(boneName);
    if (Number.isInteger(mappedIndex)) {
      return mappedIndex;
    }
  }

  return findBoneIndexByName(model, boneName);
}
