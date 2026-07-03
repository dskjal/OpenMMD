import { ensureAnimationClip } from './animation-clip.js';
import { quat } from '../../lib/esm/index.js';
import { findBoneIndexByName } from '../model/model-scene.js';
import { quaternionFromBasis, quaternionFromEulerXYZ } from '../../shared/math/math-utils.js';

const DEGREE_TO_RADIAN = Math.PI / 180;
const VMD_SOURCE_KIND = 'vmd';
const VRMA_SOURCE_KIND = 'vrma';
const IDENTITY_QUATERNION = Object.freeze([0, 0, 0, 1]);
const DEFAULT_BASIS_AXES = Object.freeze({
  localX: Object.freeze([1, 0, 0]),
  localY: Object.freeze([0, 1, 0]),
  localZ: Object.freeze([0, 0, 1]),
});
const VMD_SPINE_SOURCE_BASIS_QUATERNION = Object.freeze(Array.from(quaternionFromBasis(
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
)));
const VMD_MIRRORED_YZ_SOURCE_BASIS_QUATERNION = Object.freeze(Array.from(quaternionFromBasis(
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
)));
const VMD_ARM_SOURCE_BASIS_QUATERNION = Object.freeze([...IDENTITY_QUATERNION]);
const VMD_KNEE_SOURCE_BASIS_QUATERNION = VMD_MIRRORED_YZ_SOURCE_BASIS_QUATERNION;
const VRM_ARM_TARGET_BASIS_QUATERNION = Object.freeze([...IDENTITY_QUATERNION]);
const VMD_VRM_LEFT_ARM_TARGET_BASIS_QUATERNION = Object.freeze(Array.from(quaternionFromBasis(
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
)));
const VMD_VRM_RIGHT_ARM_TARGET_BASIS_QUATERNION = VMD_MIRRORED_YZ_SOURCE_BASIS_QUATERNION;
const VMD_VRM_RIGHT_ARM_TARGET_APPLY_CORRECTION_QUATERNION = Object.freeze([...IDENTITY_QUATERNION]);
const VRMA_BODY_AXIS_CORRECTION_QUATERNION = Object.freeze(Array.from(quaternionFromBasis(
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
)));
const VMD_TOE_SOURCE_BASIS_CANDIDATES = Object.freeze([
  Object.freeze([...IDENTITY_QUATERNION]),
  VMD_MIRRORED_YZ_SOURCE_BASIS_QUATERNION,
]);
const VMD_SOURCE_BONE_NAME_ALIASES = Object.freeze({
  '右人指１': '右人差指１',
  '右人指２': '右人差指２',
  '右人指３': '右人差指３',
  '右親指先': '右親指２',
  '左人指１': '左人差指１',
  '左人指２': '左人差指２',
  '左人指３': '左人差指３',
  '左親指先': '左親指２',
});
const DEFAULT_VMD_VRM_ANIMATION_MAPPINGS = Object.freeze([
  ['全ての親', '全ての親', [0, 0, 0]],
  ['下半身', '下半身', [0, 0, 0]],  // VRM にはない OpenMMD の独自拡張
  ['センター', 'hips', [0, 0, 0]],
  ['頭', 'head', [0, 0, 0]],
  ['首', 'neck', [0, 0, 0]],
  ['上半身２', 'upperChest', [0, 0, 0]],
  ['上半身', 'chest', [0, 0, 0]],
  ['右目', 'rightEye', [0, 0, 0]],
  ['左目', 'leftEye', [0, 0, 0]],
  ['右足', 'rightUpperLeg', [0, 0, 0]],
  ['左足', 'leftUpperLeg', [0, 0, 0]],
  ['右ひざ', 'rightLowerLeg', [0, 0, 0]],
  ['左ひざ', 'leftLowerLeg', [0, 0, 0]],
  ['右足首', 'rightFoot', [0, 0, 0]],
  ['左足首', 'leftFoot', [0, 0, 0]],
  ['右つま先', 'rightToes', [0, 0, 0]],
  ['左つま先', 'leftToes', [0, 0, 0]],
  ['右足ＩＫ', '右足ＩＫ', [0, 0, 0]],
  ['左足ＩＫ', '左足ＩＫ', [0, 0, 0]],
  ['右つま足ＩＫ', '右つま足ＩＫ', [0, 0, 0]],
  ['左つま足ＩＫ', '左つま足ＩＫ', [0, 0, 0]],
  ['右肩', 'rightShoulder', [0, 0, 0]],
  ['左肩', 'leftShoulder', [0, 0, 0]],
  ['右腕', 'rightUpperArm', [0, 0, 0]],
  ['左腕', 'leftUpperArm', [0, 0, 0]],
  ['右ひじ', 'rightLowerArm', [0, 0, 0]],
  ['左ひじ', 'leftLowerArm', [0, 0, 0]],
  ['右手首', 'rightHand', [0, 0, 0]],
  ['左手首', 'leftHand', [0, 0, 0]],
  ['右親指０', 'rightThumbMetacarpal', [0, 0, 0]],
  ['右親指１', 'rightThumbProximal', [0, 0, 0]],
  ['右親指２', 'rightThumbDistal', [0, 0, 0]],
  ['右人差指１', 'rightIndexProximal', [0, 0, 0]],
  ['右人差指２', 'rightIndexIntermediate', [0, 0, 0]],
  ['右人差指３', 'rightIndexDistal', [0, 0, 0]],
  ['右中指１', 'rightMiddleProximal', [0, 0, 0]],
  ['右中指２', 'rightMiddleIntermediate', [0, 0, 0]],
  ['右中指３', 'rightMiddleDistal', [0, 0, 0]],
  ['右薬指１', 'rightRingProximal', [0, 0, 0]],
  ['右薬指２', 'rightRingIntermediate', [0, 0, 0]],
  ['右薬指３', 'rightRingDistal', [0, 0, 0]],
  ['右小指１', 'rightLittleProximal', [0, 0, 0]],
  ['右小指２', 'rightLittleIntermediate', [0, 0, 0]],
  ['右小指３', 'rightLittleDistal', [0, 0, 0]],
  ['左親指０', 'leftThumbMetacarpal', [0, 0, 0]],
  ['左親指１', 'leftThumbProximal', [0, 0, 0]],
  ['左親指２', 'leftThumbDistal', [0, 0, 0]],
  ['左人差指１', 'leftIndexProximal', [0, 0, 0]],
  ['左人差指２', 'leftIndexIntermediate', [0, 0, 0]],
  ['左人差指３', 'leftIndexDistal', [0, 0, 0]],
  ['左中指１', 'leftMiddleProximal', [0, 0, 0]],
  ['左中指２', 'leftMiddleIntermediate', [0, 0, 0]],
  ['左中指３', 'leftMiddleDistal', [0, 0, 0]],
  ['左薬指１', 'leftRingProximal', [0, 0, 0]],
  ['左薬指２', 'leftRingIntermediate', [0, 0, 0]],
  ['左薬指３', 'leftRingDistal', [0, 0, 0]],
  ['左小指１', 'leftLittleProximal', [0, 0, 0]],
  ['左小指２', 'leftLittleIntermediate', [0, 0, 0]],
  ['左小指３', 'leftLittleDistal', [0, 0, 0]],
]);
const DEFAULT_VMD_VRM_MAPPING_BY_SOURCE_BONE_NAME = new Map(
  DEFAULT_VMD_VRM_ANIMATION_MAPPINGS.map(([sourceBoneName, targetBoneName, rotationOffsetEuler]) => ([
    sourceBoneName,
    Object.freeze({
      targetBoneName,
      rotationOffsetEuler,
    }),
  ])),
);
export const DEFAULT_VRMA_PMX_ANIMATION_MAPPINGS = Object.freeze([
  ['hips', 'センター'],
  ['spine', '上半身'],
  ['chest', '上半身'],
  ['upperChest', '上半身２'],
  ['neck', '首'],
  ['head', '頭'],
  ['rightEye', '右目'],
  ['leftEye', '左目'],
  ['rightShoulder', '右肩'],
  ['leftShoulder', '左肩'],
  ['rightUpperArm', '右腕'],
  ['leftUpperArm', '左腕'],
  ['rightLowerArm', '右ひじ'],
  ['leftLowerArm', '左ひじ'],
  ['rightHand', '右手首'],
  ['leftHand', '左手首'],
  ['rightUpperLeg', '右足'],
  ['leftUpperLeg', '左足'],
  ['rightLowerLeg', '右ひざ'],
  ['leftLowerLeg', '左ひざ'],
  ['rightFoot', '右足首'],
  ['leftFoot', '左足首'],
  ['rightToes', '右つま先'],
  ['leftToes', '左つま先'],
  ['rightThumbMetacarpal', '右親指０'],
  ['rightThumbProximal', '右親指１'],
  ['rightThumbDistal', '右親指２'],
  ['rightIndexProximal', '右人差指１'],
  ['rightIndexIntermediate', '右人差指２'],
  ['rightIndexDistal', '右人差指３'],
  ['rightMiddleProximal', '右中指１'],
  ['rightMiddleIntermediate', '右中指２'],
  ['rightMiddleDistal', '右中指３'],
  ['rightRingProximal', '右薬指１'],
  ['rightRingIntermediate', '右薬指２'],
  ['rightRingDistal', '右薬指３'],
  ['rightLittleProximal', '右小指１'],
  ['rightLittleIntermediate', '右小指２'],
  ['rightLittleDistal', '右小指３'],
  ['leftThumbMetacarpal', '左親指０'],
  ['leftThumbProximal', '左親指１'],
  ['leftThumbDistal', '左親指２'],
  ['leftIndexProximal', '左人差指１'],
  ['leftIndexIntermediate', '左人差指２'],
  ['leftIndexDistal', '左人差指３'],
  ['leftMiddleProximal', '左中指１'],
  ['leftMiddleIntermediate', '左中指２'],
  ['leftMiddleDistal', '左中指３'],
  ['leftRingProximal', '左薬指１'],
  ['leftRingIntermediate', '左薬指２'],
  ['leftRingDistal', '左薬指３'],
  ['leftLittleProximal', '左小指１'],
  ['leftLittleIntermediate', '左小指２'],
  ['leftLittleDistal', '左小指３'],
]);
const DEFAULT_VRMA_PMX_MAPPING_BY_SOURCE_BONE_NAME = new Map(
  DEFAULT_VRMA_PMX_ANIMATION_MAPPINGS.map(([sourceBoneName, targetBoneName]) => ([
    sourceBoneName,
    Object.freeze({ targetBoneName }),
  ])),
);
const VMD_SPINE_BONE_NAMES = new Set(['下半身', '上半身', '上半身２', '首', '頭']);
const VMD_ARM_BONE_NAMES = new Set(['右肩', '左肩', '右腕', '左腕', '右ひじ', '左ひじ', '右手首', '左手首']);
const VRM_ARM_HUMANOID_BONE_NAMES = new Set([
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
]);
const VRMA_SIDE_HUMANOID_BONE_NAMES = new Set([
  'leftEye',
  'rightEye',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftToes',
  'rightToes',
  'leftThumbMetacarpal',
  'rightThumbMetacarpal',
  'leftThumbProximal',
  'rightThumbProximal',
  'leftThumbDistal',
  'rightThumbDistal',
  'leftIndexProximal',
  'rightIndexProximal',
  'leftIndexIntermediate',
  'rightIndexIntermediate',
  'leftIndexDistal',
  'rightIndexDistal',
  'leftMiddleProximal',
  'rightMiddleProximal',
  'leftMiddleIntermediate',
  'rightMiddleIntermediate',
  'leftMiddleDistal',
  'rightMiddleDistal',
  'leftRingProximal',
  'rightRingProximal',
  'leftRingIntermediate',
  'rightRingIntermediate',
  'leftRingDistal',
  'rightRingDistal',
  'leftLittleProximal',
  'rightLittleProximal',
  'leftLittleIntermediate',
  'rightLittleIntermediate',
  'leftLittleDistal',
  'rightLittleDistal',
]);
const VRMA_BODY_HUMANOID_BONE_NAMES = new Set([
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
  'leftToes',
  'rightToes',
]);
const VRMA_THUMB_METACARPAL_HUMANOID_BONE_NAMES = new Set([
  'leftThumbMetacarpal',
  'rightThumbMetacarpal',
]);
const VRMA_BASIS_CORRECTION_HUMANOID_BONE_NAMES = new Set([
  ...VRMA_BODY_HUMANOID_BONE_NAMES,
  ...VRMA_SIDE_HUMANOID_BONE_NAMES,
]);
const VMD_FINGER_BONE_NAMES = new Set([
  '右親指０', '右親指１', '右親指２',
  '右人差指１', '右人差指２', '右人差指３',
  '右中指１', '右中指２', '右中指３',
  '右薬指１', '右薬指２', '右薬指３',
  '右小指１', '右小指２', '右小指３',
  '左親指０', '左親指１', '左親指２',
  '左人差指１', '左人差指２', '左人差指３',
  '左中指１', '左中指２', '左中指３',
  '左薬指１', '左薬指２', '左薬指３',
  '左小指１', '左小指２', '左小指３',
]);
const VMD_IK_BONE_NAMES = new Set([
  '右足ＩＫ',
  '左足ＩＫ',
  '右つま足ＩＫ',
  '左つま足ＩＫ',
  '右つま先ＩＫ',
  '左つま先ＩＫ',
]);
const VMD_KNEE_BONE_NAMES = new Set(['右ひざ', '左ひざ']);
const VMD_TOE_BONE_NAMES = new Set(['右つま先', '左つま先']);
const VMD_IK_SOURCE_BASIS_QUATERNION = Object.freeze(Array.from(quaternionFromEulerXYZ([0, 0, Math.PI])));
const VMD_CENTER_SOURCE_BASIS_QUATERNION = VMD_SPINE_SOURCE_BASIS_QUATERNION;

/**
 * モデルが VRM かどうかを返します。
 * @param {object|null} model - モデルデータ。
 * @returns {boolean} VRM なら true。
 */
function isVrmModel(model) {
  return String(model?.magic || '').trim() === 'Vrm';
}

/**
 * モデルが PMD/PMX かどうかを返します。
 * @param {object|null} model - モデルデータ。
 * @returns {boolean} PMD/PMX なら true。
 */
function isPmxModel(model) {
  const magic = String(model?.magic || '').trim();
  return magic === 'Pmx' || magic === 'Pmd';
}

/**
 * モデルが VRM 0.x かどうかを返します。
 * @param {object|null} model - モデルデータ。
 * @returns {boolean} VRM 0.x なら true。
 */
function isVrm0Model(model) {
  return isVrmModel(model) && String(model?.vrm?.version || '').trim() === 'vrm0';
}

/**
 * animation source の一意キーを返します。
 * @param {object|null} source - animation source。
 * @returns {string} source key。
 */
export function getAnimationSourceKey(source) {
  if (!source || typeof source !== 'object') {
    return '';
  }

  const kind = String(source.kind || 'unknown').trim();
  const name = String(source.name || source.animationSourceName || '').trim();
  if (kind && name) {
    return `${kind}:${name}`;
  }
  if (kind) {
    return kind;
  }
  return '';
}

/**
 * animation source に対応する clip を返します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} [source=instance?.animationSource] - animation source。
 * @returns {object|null} animation clip。
 */
export function getAnimationSourceClip(instance, source = instance?.animationSource) {
  if (source?.clip && Array.isArray(source.clip.channels)) {
    return source.clip;
  }
  if (source?.data) {
    return ensureAnimationClip(source.data);
  }
  if (instance?.vmd) {
    return ensureAnimationClip(instance.vmd);
  }
  return null;
}

/**
 * VMD の source bone 名を既定 mapping 用の正規名へ正規化します。
 * @param {string} sourceBoneName - source bone 名。
 * @returns {string} 正規化済み source bone 名。
 */
function normalizeVmdSourceBoneName(sourceBoneName) {
  const normalizedBoneName = String(sourceBoneName || '').trim();
  if (!normalizedBoneName) {
    return '';
  }

  return VMD_SOURCE_BONE_NAME_ALIASES[normalizedBoneName] || normalizedBoneName;
}

/**
 * VMD の source bone 名が alias かどうかを返します。
 * @param {string} sourceBoneName - source bone 名。
 * @returns {boolean} alias なら true。
 */
function isVmdSourceBoneNameAlias(sourceBoneName) {
  const normalizedBoneName = String(sourceBoneName || '').trim();
  return Object.prototype.hasOwnProperty.call(VMD_SOURCE_BONE_NAME_ALIASES, normalizedBoneName);
}

/**
 * clip から bone channel 名一覧を抽出します。
 * @param {object|null} clip - animation clip。
 * @returns {string[]} bone 名一覧。
 */
export function collectAnimationSourceBoneNames(clip) {
  const names = [];
  const seen = new Set();
  for (const channel of clip?.channels || []) {
    if (channel?.target?.kind !== 'bone') {
      continue;
    }
    const name = String(channel?.target?.name || '').trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * animation mapping の既定エントリを生成します。
 * @param {string} sourceBoneName - source 側ボーン名。
 * @param {object|null} [source=null] - animation source。
 * @param {boolean} [modelIsVrm=false] - 対象モデルが VRM かどうか。
 * @returns {object} mapping entry。
 */
function createDefaultAnimationMappingEntry(sourceBoneName, source = null, isVrmModel = false, isPmxModelValue = false) {
  const sourceKind = String(source?.kind || '').trim();
  const normalizedSourceBoneName = sourceKind === VMD_SOURCE_KIND
    ? normalizeVmdSourceBoneName(sourceBoneName)
    : String(sourceBoneName || '').trim();
  const defaultMapping = sourceKind === VMD_SOURCE_KIND
    && isVrmModel
    ? DEFAULT_VMD_VRM_MAPPING_BY_SOURCE_BONE_NAME.get(normalizedSourceBoneName)
    : sourceKind === VRMA_SOURCE_KIND
      && isPmxModelValue
      ? DEFAULT_VRMA_PMX_MAPPING_BY_SOURCE_BONE_NAME.get(normalizedSourceBoneName)
    : null;
  const rotationFlipAxes = createDefaultRotationFlipAxes(sourceKind, isVrmModel, isPmxModelValue);
  return {
    sourceBoneName,
    targetBoneName: sourceKind === VRMA_SOURCE_KIND && isVrmModel
      ? normalizedSourceBoneName
      : String(defaultMapping?.targetBoneName || ''),
    rotationOffsetEuler: Array.isArray(defaultMapping?.rotationOffsetEuler)
      ? [...defaultMapping.rotationOffsetEuler]
      : [0, 0, 0],
    rotationFlipAxes: sourceKind === VRMA_SOURCE_KIND && isPmxModelValue && normalizedSourceBoneName === 'hips'
      ? { x: false, y: false, z: false }
      : rotationFlipAxes,
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  };
}

/**
 * 回転軸反転設定の既定値を返します。
 * @param {string} [sourceKind=''] - animation source kind。
 * @param {boolean} [isVrmModel=false] - 対象モデルが VRM かどうか。
 * @param {boolean} [isPmxModel=false] - 対象モデルが PMX かどうか。
 * @returns {{x: boolean, y: boolean, z: boolean}} 既定値。
 */
function createDefaultRotationFlipAxes(sourceKind = '', isVrmModel = false, isPmxModel = false) {
  if (sourceKind === VMD_SOURCE_KIND && isVrmModel) {
    return {
      x: false,
      y: false,
      z: false,
    };
  }
  if (sourceKind === VRMA_SOURCE_KIND && isPmxModel) {
    return {
      x: false,
      y: false,
      z: false,
    };
  }

  return {
    x: false,
    y: false,
    z: false,
  };
}

/**
 * 回転軸反転設定を正規化します。
 * @param {object|null|undefined} value - 入力値。
 * @returns {{x: boolean, y: boolean, z: boolean}} 正規化済み設定。
 */
function normalizeRotationFlipAxes(value) {
  return {
    x: Boolean(value?.x),
    y: Boolean(value?.y),
    z: Boolean(value?.z),
  };
}

/**
 * target bone 名を VRM humanoid 名に正規化します。
 * @param {object|null} model - モデルデータ。
 * @param {string} boneName - target bone 名。
 * @returns {string} 正規化済み target bone 名。
 */
function normalizeTargetBoneName(model, boneName) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName) {
    return '';
  }

  if (!isVrmModel(model)) {
    return normalizedBoneName;
  }

  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap;
  if (!humanoidBoneNameMap || typeof humanoidBoneNameMap !== 'object') {
    return normalizedBoneName;
  }

  for (const [humanoidBoneName, resolvedBoneName] of Object.entries(humanoidBoneNameMap)) {
    if (String(resolvedBoneName || '').trim() === normalizedBoneName) {
      return String(humanoidBoneName || '').trim();
    }
  }

  return normalizedBoneName;
}

/**
 * モデルの target bone 候補を正規化名ベースで抽出します。
 * @param {object|null} model - モデルデータ。
 * @returns {string[]} target bone 名一覧。
 */
function collectTargetBoneNames(model) {
  const names = [];
  const seen = new Set();
  for (const bone of model?.bones || []) {
    const boneName = normalizeTargetBoneName(model, bone?.name);
    if (!boneName || seen.has(boneName)) {
      continue;
    }
    seen.add(boneName);
    names.push(boneName);
  }
  return names;
}

/**
 * source kind が humanoid target 正規化対象かどうかを返します。
 * @param {string} sourceKind - animation source kind。
 * @returns {boolean} 正規化対象なら true。
 */
function usesNormalizedVrmTargetNames(sourceKind) {
  return sourceKind === VMD_SOURCE_KIND || sourceKind === VRMA_SOURCE_KIND;
}

/**
 * source/model 向け target bone 候補一覧を返します。
 * @param {object|null} model - モデルデータ。
 * @param {string} sourceKind - animation source kind。
 * @returns {string[]} target bone 名一覧。
 */
function collectAnimationMappingTargetBoneNames(model, sourceKind) {
  if (usesNormalizedVrmTargetNames(sourceKind) && isVrmModel(model)) {
    return collectTargetBoneNames(model).filter(Boolean);
  }
  return (model?.bones || [])
    .map((bone) => String(bone?.name || '').trim())
    .filter(Boolean);
}

/**
 * entry の target bone 名を source/model に応じて解決します。
 * @param {object|null} model - モデルデータ。
 * @param {string} sourceKind - animation source kind。
 * @param {object|null|undefined} entry - animation mapping entry。
 * @returns {string} 解決済み target bone 名。
 */
function resolveAnimationMappingTargetBoneName(model, sourceKind, entry) {
  const targetBoneName = String(entry?.targetBoneName || '').trim();
  if (!targetBoneName) {
    return '';
  }
  if (usesNormalizedVrmTargetNames(sourceKind) && isVrmModel(model)) {
    return normalizeTargetBoneName(model, targetBoneName);
  }
  if (sourceKind === VRMA_SOURCE_KIND && isPmxModel(model)) {
    return resolvePmxTargetBoneName(model, targetBoneName);
  }
  return targetBoneName;
}

/**
 * PMX target bone 名の表記揺れを含めて実名へ解決します。
 * @param {object|null} model - 対象モデル。
 * @param {string} boneName - 変換前の bone 名。
 * @returns {string} 実名。見つからなければ元の名前。
 */
function resolvePmxTargetBoneName(model, boneName) {
  const candidates = getPmxTargetBoneNameCandidates(boneName);
  for (const candidate of candidates) {
    const resolved = model?.bones?.find((bone) => String(bone?.name || '').trim() === candidate) || null;
    if (resolved) {
      return String(resolved.name || '').trim();
    }
  }
  return String(boneName || '').trim();
}

/**
 * PMX target bone 名の照合候補を返します。
 * @param {string} boneName - 元 bone 名。
 * @returns {string[]} 照合候補一覧。
 */
function getPmxTargetBoneNameCandidates(boneName) {
  const normalizedName = String(boneName || '').trim();
  if (!normalizedName) {
    return [];
  }

  const candidates = new Set([normalizedName]);
  const variants = [normalizedName];
  for (const variant of variants) {
    candidates.add(variant.replace(/人差指/g, '人指'));
    candidates.add(variant.replace(/人指/g, '人差指'));
    candidates.add(convertFullWidthDigitsToAscii(variant));
    candidates.add(convertAsciiDigitsToFullWidth(variant));
  }

  return Array.from(candidates);
}

/**
 * 全角数字を ASCII 数字へ変換します。
 * @param {string} value - 変換対象文字列。
 * @returns {string} 変換後文字列。
 */
function convertFullWidthDigitsToAscii(value) {
  return String(value || '').replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
}

/**
 * ASCII 数字を全角数字へ変換します。
 * @param {string} value - 変換対象文字列。
 * @returns {string} 変換後文字列。
 */
function convertAsciiDigitsToFullWidth(value) {
  return String(value || '').replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xFEE0));
}

/**
 * state 内 entry を source/model 用に取得または初期化します。
 * @param {Map<string, object>} entries - state entries。
 * @param {string} sourceBoneName - source bone 名。
 * @param {object|null} source - animation source。
 * @param {boolean} modelIsVrm - 対象モデルが VRM かどうか。
 * @param {object|null} model - モデルデータ。
 * @returns {object} mapping entry。
 */
function getOrCreateAnimationMappingEntry(entries, sourceBoneName, source, modelIsVrm, model) {
  let entry = entries.get(sourceBoneName) || null;
  if (!entry) {
    entry = createDefaultAnimationMappingEntry(sourceBoneName, source, modelIsVrm, isPmxModel(model));
    entries.set(sourceBoneName, entry);
  }
  entry.targetBoneName = resolveAnimationMappingTargetBoneName(model, String(source?.kind || '').trim(), entry);
  return entry;
}

/**
 * state 内の target bone 名を正規化します。
 * @param {object|null} model - モデルデータ。
 * @param {object|null} state - animation mapping state。
 */
function normalizeStateTargetBoneNames(model, state) {
  if (!isVrmModel(model)) {
    return;
  }

  if (!state?.entries || typeof state.entries.forEach !== 'function') {
    return;
  }

  state.entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    entry.targetBoneName = normalizeTargetBoneName(model, entry.targetBoneName);
  });
}

/**
 * 値を 3 要素ベクトルへ正規化します。
 * @param {ArrayLike<number>|null|undefined} value - 入力値。
 * @param {Array<number>} fallback - 既定値。
 * @returns {[number, number, number]} 正規化済みベクトル。
 */
function normalizeVector3(value, fallback) {
  return [
    Number.isFinite(Number(value?.[0])) ? Number(value[0]) : fallback[0],
    Number.isFinite(Number(value?.[1])) ? Number(value[1]) : fallback[1],
    Number.isFinite(Number(value?.[2])) ? Number(value[2]) : fallback[2],
  ];
}

/**
 * 値をクォータニオン配列へ正規化します。
 * @param {ArrayLike<number>|null|undefined} value - 入力値。
 * @returns {[number, number, number, number]} 正規化済みクォータニオン。
 */
function normalizeQuaternionValues(value) {
  return [
    Number.isFinite(Number(value?.[0])) ? Number(value[0]) : 0,
    Number.isFinite(Number(value?.[1])) ? Number(value[1]) : 0,
    Number.isFinite(Number(value?.[2])) ? Number(value[2]) : 0,
    Number.isFinite(Number(value?.[3])) ? Number(value[3]) : 1,
  ];
}

/**
 * bone の local rest rotation を返します。
 * @param {object|null|undefined} bone - 対象 bone。
 * @returns {[number, number, number, number]} local rest rotation。
 */
export function getBoneLocalRestRotationQuaternion(bone) {
  const basisQuaternion = getBoneBasisQuaternion(bone);
  const baseRotationQuaternion = normalizeQuaternionValues(bone?.baseRotationQuaternion);
  const result = quat.create();
  quat.multiply(result, baseRotationQuaternion, basisQuaternion);
  quat.normalize(result, result);
  return normalizeQuaternionValues(result);
}

/**
 * model の bone world rest rotation を返します。
 * @param {object|null} model - モデルデータ。
 * @param {number} boneIndex - bone index。
 * @param {Map<number, [number, number, number, number]>} cache - 計算キャッシュ。
 * @returns {[number, number, number, number]} world rest rotation。
 */
export function getBoneWorldRestRotationQuaternion(model, boneIndex, cache) {
  if (cache.has(boneIndex)) {
    return cache.get(boneIndex);
  }

  const bone = model?.bones?.[boneIndex] || null;
  const localRestRotation = getBoneLocalRestRotationQuaternion(bone);
  const parentIndex = Number.isInteger(bone?.parentIndex) ? bone.parentIndex : -1;
  if (parentIndex < 0) {
    cache.set(boneIndex, localRestRotation);
    return localRestRotation;
  }

  const parentWorldRestRotation = getBoneWorldRestRotationQuaternion(model, parentIndex, cache);
  const result = quat.create();
  quat.multiply(result, parentWorldRestRotation, localRestRotation);
  quat.normalize(result, result);
  const normalized = normalizeQuaternionValues(result);
  cache.set(boneIndex, normalized);
  return normalized;
}

/**
 * VRMA retarget 用に synthetic root 正規化を除外した bone world rest rotation を返します。
 * @param {object|null} model - モデルデータ。
 * @param {number} boneIndex - bone index。
 * @param {Map<number, [number, number, number, number]>} cache - 計算キャッシュ。
 * @returns {[number, number, number, number]} world rest rotation。
 */
function getVrmaTargetWorldRestRotationQuaternion(model, boneIndex, cache) {
  if (cache.has(boneIndex)) {
    return cache.get(boneIndex);
  }

  const bone = model?.bones?.[boneIndex] || null;
  const localRestRotation = isVrmSyntheticAllParentBone(model, bone)
    ? getBoneBasisQuaternion(bone)
    : getBoneLocalRestRotationQuaternion(bone);
  const parentIndex = Number.isInteger(bone?.parentIndex) ? bone.parentIndex : -1;
  if (parentIndex < 0) {
    cache.set(boneIndex, localRestRotation);
    return localRestRotation;
  }

  const parentWorldRestRotation = getVrmaTargetWorldRestRotationQuaternion(model, parentIndex, cache);
  const result = quat.create();
  quat.multiply(result, parentWorldRestRotation, localRestRotation);
  quat.normalize(result, result);
  const normalized = normalizeQuaternionValues(result);
  cache.set(boneIndex, normalized);
  return normalized;
}

/**
 * VRM 正規化用の synthetic な 全ての親 ボーンかどうかを返します。
 * @param {object|null} model - モデルデータ。
 * @param {object|null|undefined} bone - 判定対象 bone。
 * @returns {boolean} synthetic root なら true。
 */
function isVrmSyntheticAllParentBone(model, bone) {
  return isVrmModel(model)
    && String(bone?.name || '').trim() === '全ての親';
}

/**
 * VRMA source の humanoid rest rotation を返します。
 * @param {object|null} source - animation source。
 * @param {string} sourceBoneName - source bone 名。
 * @returns {{localRotation: [number, number, number, number], worldRotation: [number, number, number, number]}|null} rest rotation。
 */
function getVrmaSourceRestRotation(source, sourceBoneName) {
  const restRotations = source?.clip?.metadata?.vrmAnimation?.humanBoneRestRotations;
  if (!restRotations || typeof restRotations !== 'object') {
    return null;
  }

  const entry = restRotations[String(sourceBoneName || '').trim()];
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    localRotation: normalizeQuaternionValues(entry.localRotation),
    worldRotation: normalizeQuaternionValues(entry.worldRotation),
  };
}

/**
 * クォータニオンが恒等回転かどうかを返します。
 * @param {ArrayLike<number>|null|undefined} quaternion - 判定対象。
 * @returns {boolean} 恒等回転なら true。
 */
function isIdentityQuaternion(quaternion) {
  return Math.abs((Number(quaternion?.[0]) || 0)) < 1e-6
    && Math.abs((Number(quaternion?.[1]) || 0)) < 1e-6
    && Math.abs((Number(quaternion?.[2]) || 0)) < 1e-6
    && Math.abs((Number(quaternion?.[3]) || 1) - 1) < 1e-6;
}

/**
 * bone の実ローカル基底からクォータニオンを取得します。
 * @param {object|null} bone - target bone。
 * @returns {[number, number, number, number]} 基底クォータニオン。
 */
function getBoneBasisQuaternion(bone) {
  const localX = normalizeVector3(bone?.localX, DEFAULT_BASIS_AXES.localX);
  const localY = normalizeVector3(bone?.localY, DEFAULT_BASIS_AXES.localY);
  const localZ = normalizeVector3(bone?.localZ, DEFAULT_BASIS_AXES.localZ);
  return normalizeQuaternionValues(quaternionFromBasis(localX, localY, localZ));
}

/**
 * VMD source bone の意味的基底候補を返します。
 * @param {string} sourceBoneName - source bone 名。
 * @returns {Array<[number, number, number, number]>} 基底候補。
 */
function getVmdSourceBasisCandidates(sourceBoneName) {
  const normalizedName = normalizeVmdSourceBoneName(sourceBoneName);
  if (!normalizedName) {
    return [];
  }
  if (normalizedName === 'センター') {
    return [VMD_CENTER_SOURCE_BASIS_QUATERNION];
  }
  if (VMD_SPINE_BONE_NAMES.has(normalizedName)) {
    return [VMD_SPINE_SOURCE_BASIS_QUATERNION];
  }
  if (VMD_ARM_BONE_NAMES.has(normalizedName)) {
    return [getVmdArmSourceBasisQuaternion(normalizedName)];
  }
  if (VMD_FINGER_BONE_NAMES.has(normalizedName)) {
    return [VMD_MIRRORED_YZ_SOURCE_BASIS_QUATERNION];
  }
  if (VMD_IK_BONE_NAMES.has(normalizedName)) {
    return [VMD_IK_SOURCE_BASIS_QUATERNION];
  }
  if (VMD_KNEE_BONE_NAMES.has(normalizedName)) {
    return [VMD_KNEE_SOURCE_BASIS_QUATERNION];
  }
  if (VMD_TOE_BONE_NAMES.has(normalizedName)) {
    return [...VMD_TOE_SOURCE_BASIS_CANDIDATES];
  }
  return [];
}

/**
 * VMD の腕系 source bone 名から左右を返します。
 * @param {string} sourceBoneName - VMD source bone 名。
 * @returns {'left'|'right'|''} 左右。
 */
function getVmdArmSide(sourceBoneName) {
  const normalizedName = String(sourceBoneName || '').trim();
  if (!normalizedName) {
    return '';
  }
  if (normalizedName.startsWith('左')) {
    return 'left';
  }
  if (normalizedName.startsWith('右')) {
    return 'right';
  }
  return '';
}

/**
 * VMD の腕系 source bone 名から semantic class を返します。
 * @param {string} sourceBoneName - VMD source bone 名。
 * @returns {'shoulder'|'upperArm'|'lowerArm'|'hand'|''} semantic class。
 */
function getVmdArmSemanticClass(sourceBoneName) {
  const normalizedName = String(sourceBoneName || '').trim();
  if (normalizedName === '左肩' || normalizedName === '右肩') {
    return 'shoulder';
  }
  if (normalizedName === '左腕' || normalizedName === '右腕') {
    return 'upperArm';
  }
  if (normalizedName === '左ひじ' || normalizedName === '右ひじ') {
    return 'lowerArm';
  }
  if (normalizedName === '左手首' || normalizedName === '右手首') {
    return 'hand';
  }
  return '';
}

/**
 * VMD の腕系 source bone 名に対応する canonical basis を返します。
 * VMD の腕系回転は quaternion 自体に左右差が入っているため、
 * source basis では shoulder / upperArm / lowerArm / hand の追加 mirror 補正を入れません。
 * @param {string} sourceBoneName - VMD source bone 名。
 * @returns {[number, number, number, number]} canonical basis quaternion。
 */
function getVmdArmSourceBasisQuaternion(sourceBoneName) {
  if (!getVmdArmSide(sourceBoneName) || !getVmdArmSemanticClass(sourceBoneName)) {
    return [...IDENTITY_QUATERNION];
  }
  return [...VMD_ARM_SOURCE_BASIS_QUATERNION];
}

/**
 * VRM humanoid 腕ボーン名から左右を返します。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @returns {'left'|'right'|''} 左右。
 */
function getVrmArmSide(humanoidBoneName) {
  const normalizedName = String(humanoidBoneName || '').trim();
  if (normalizedName.startsWith('left')) {
    return 'left';
  }
  if (normalizedName.startsWith('right')) {
    return 'right';
  }
  return '';
}

/**
 * VRM humanoid 腕ボーン名から semantic class を返します。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @returns {'shoulder'|'upperArm'|'lowerArm'|'hand'|''} semantic class。
 */
function getVrmArmSemanticClass(humanoidBoneName) {
  const normalizedName = String(humanoidBoneName || '').trim();
  if (normalizedName === 'leftShoulder' || normalizedName === 'rightShoulder') {
    return 'shoulder';
  }
  if (normalizedName === 'leftUpperArm' || normalizedName === 'rightUpperArm') {
    return 'upperArm';
  }
  if (normalizedName === 'leftLowerArm' || normalizedName === 'rightLowerArm') {
    return 'lowerArm';
  }
  if (normalizedName === 'leftHand' || normalizedName === 'rightHand') {
    return 'hand';
  }
  return '';
}

/**
 * VRM humanoid 腕ボーン名に対応する canonical target basis を返します。
 * @param {object|null} model - target モデル。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @param {object|null} [targetBone=null] - target bone。
 * @returns {[number, number, number, number]} canonical basis quaternion。
 */
function getVrmArmTargetBasisQuaternion(model, humanoidBoneName, targetBone = null) {
  if (!getVrmArmSide(humanoidBoneName) || !getVrmArmSemanticClass(humanoidBoneName)) {
    return [...IDENTITY_QUATERNION];
  }
  if (isVrm0Model(model) && targetBone) {
    const targetBasisQuaternion = getBoneBasisQuaternion(targetBone);
    if (!isIdentityQuaternion(targetBasisQuaternion)) {
      return targetBasisQuaternion;
    }
    return getVmdVrmFallbackArmTargetBasisQuaternion(humanoidBoneName);
  }
  return [...VRM_ARM_TARGET_BASIS_QUATERNION];
}

/**
 * VMD -> VRM の腕 retarget 用 fallback target basis を返します。
 * VRM 0.x の実ボーン基底が identity のモデルでは、左右の腕 semantic に対応する canonical 基底を使います。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @returns {[number, number, number, number]} canonical basis quaternion。
 */
function getVmdVrmFallbackArmTargetBasisQuaternion(humanoidBoneName) {
  const side = getVrmArmSide(humanoidBoneName);
  const semanticClass = getVrmArmSemanticClass(humanoidBoneName);
  if (!side || !semanticClass) {
    return [...IDENTITY_QUATERNION];
  }
  return side === 'left'
    ? [...VMD_VRM_LEFT_ARM_TARGET_BASIS_QUATERNION]
    : [...VMD_VRM_RIGHT_ARM_TARGET_BASIS_QUATERNION];
}

/**
 * VMD -> VRM の target apply correction を返します。
 * 右腕チェーンは target local 空間で X=180 度の共役を入れて、Y/Z の回転方向を合わせます。
 * @param {object|null} model - target モデル。
 * @param {string} targetHumanoidBoneName - target VRM humanoid 名。
 * @returns {[number, number, number, number]} target apply correction quaternion。
 */
function getVmdVrmTargetApplyCorrectionQuaternion(model, targetHumanoidBoneName) {
  if (!isVrm0Model(model)) {
    return [...IDENTITY_QUATERNION];
  }
  if (!VRM_ARM_HUMANOID_BONE_NAMES.has(String(targetHumanoidBoneName || '').trim())) {
    return [...IDENTITY_QUATERNION];
  }
  return getVrmArmSide(targetHumanoidBoneName) === 'right'
    ? [...VMD_VRM_RIGHT_ARM_TARGET_APPLY_CORRECTION_QUATERNION]
    : [...IDENTITY_QUATERNION];
}

/**
 * VRMA humanoid side bone 名から左右を返します。
 * @param {string} humanoidBoneName - VRMA humanoid 名。
 * @returns {'left'|'right'|''} 左右。
 */
function getVrmaSideBoneSide(humanoidBoneName) {
  const normalizedName = String(humanoidBoneName || '').trim();
  if (normalizedName.startsWith('left')) {
    return 'left';
  }
  if (normalizedName.startsWith('right')) {
    return 'right';
  }
  return '';
}

/**
 * VRMA humanoid bone 名から semantic class を返します。
 * @param {string} humanoidBoneName - VRMA humanoid 名。
 * @returns {string} semantic class。
 */
function getVrmaBoneSemanticClass(humanoidBoneName) {
  const normalizedName = String(humanoidBoneName || '').trim();
  if (VRMA_BASIS_CORRECTION_HUMANOID_BONE_NAMES.has(normalizedName)) {
    return normalizedName;
  }
  return '';
}

/**
 * VRMA source bone の canonical basis 候補を返します。
 * @param {string} humanoidBoneName - source humanoid 名。
 * @returns {Array<[number, number, number, number]>} 基底候補。
 */
function getVrmaSourceBasisCandidates(humanoidBoneName) {
  if (VRMA_BODY_HUMANOID_BONE_NAMES.has(String(humanoidBoneName || '').trim())) {
    return [[...IDENTITY_QUATERNION]];
  }
  if (!getVrmaSideBoneSide(humanoidBoneName) || !getVrmaBoneSemanticClass(humanoidBoneName)) {
    return [];
  }

  return [[...IDENTITY_QUATERNION]];
}

/**
 * VRMA target bone の canonical basis を返します。
 * @param {string} humanoidBoneName - target humanoid 名。
 * @returns {[number, number, number, number]} canonical basis quaternion。
 */
function getVrmaTargetBasisQuaternion(humanoidBoneName) {
  if (VRMA_BODY_HUMANOID_BONE_NAMES.has(String(humanoidBoneName || '').trim())) {
    return [...VRMA_BODY_AXIS_CORRECTION_QUATERNION];
  }
  if (!getVrmaSideBoneSide(humanoidBoneName) || !getVrmaBoneSemanticClass(humanoidBoneName)) {
    return [...IDENTITY_QUATERNION];
  }
  return [...IDENTITY_QUATERNION];
}

/**
 * PMX humanoid semantic の canonical basis を返します。
 * @param {string} humanoidBoneName - target semantic 名。
 * @returns {[number, number, number, number]} canonical basis quaternion。
 */
function getPmxVrmaTargetBasisQuaternion(humanoidBoneName) {
  const normalizedName = String(humanoidBoneName || '').trim();
  if (!normalizedName) {
    return [...IDENTITY_QUATERNION];
  }
  if (
    normalizedName.endsWith('LowerArm')
    || normalizedName.endsWith('ThumbMetacarpal')
    || normalizedName.endsWith('ThumbProximal')
    || normalizedName.endsWith('ThumbDistal')
    || normalizedName.endsWith('LowerLeg')
    || normalizedName.endsWith('Foot')
    || normalizedName.endsWith('Toes')
  ) {
    return [...IDENTITY_QUATERNION];
  }
  if (
    normalizedName.endsWith('IndexProximal')
    || normalizedName.endsWith('IndexIntermediate')
    || normalizedName.endsWith('IndexDistal')
    || normalizedName.endsWith('MiddleProximal')
    || normalizedName.endsWith('MiddleIntermediate')
    || normalizedName.endsWith('MiddleDistal')
    || normalizedName.endsWith('RingProximal')
    || normalizedName.endsWith('RingIntermediate')
    || normalizedName.endsWith('RingDistal')
    || normalizedName.endsWith('LittleProximal')
    || normalizedName.endsWith('LittleIntermediate')
    || normalizedName.endsWith('LittleDistal')
  ) {
    return [...IDENTITY_QUATERNION];
  }
  return [...VRMA_BODY_AXIS_CORRECTION_QUATERNION];
}

/**
 * VRMA -> VRM 用の semantic basis 補正クォータニオンを返します。
 * @param {string} sourceBoneName - source humanoid 名。
 * @param {string} targetBoneName - target humanoid 名。
 * @returns {[number, number, number, number]} 基底補正 quaternion。
 */
function createVrmaBasisCorrectionQuaternion(sourceBoneName, targetBoneName) {
  const sourceBasisCandidates = getVrmaSourceBasisCandidates(sourceBoneName);
  if (sourceBasisCandidates.length === 0) {
    return [...IDENTITY_QUATERNION];
  }
  const targetBasisQuaternion = getVrmaTargetBasisQuaternion(targetBoneName);
  return selectBasisCorrectionQuaternion(sourceBasisCandidates, targetBasisQuaternion);
}

/**
 * VRMA -> PMX 用の semantic basis 補正クォータニオンを返します。
 * @param {string} sourceBoneName - source humanoid 名。
 * @param {string} targetBoneName - target semantic 名。
 * @returns {[number, number, number, number]} 基底補正 quaternion。
 */
function createVrmaPmxBasisCorrectionQuaternion(sourceBoneName, targetBoneName) {
  const sourceBasisCandidates = getVrmaSourceBasisCandidates(sourceBoneName);
  if (sourceBasisCandidates.length === 0) {
    return [...IDENTITY_QUATERNION];
  }
  return selectBasisCorrectionQuaternion(sourceBasisCandidates, getPmxVrmaTargetBasisQuaternion(targetBoneName));
}

/**
 * source/target 基底差分から補正クォータニオンを選びます。
 * @param {Array<[number, number, number, number]>} sourceBasisCandidates - source 基底候補。
 * @param {[number, number, number, number]} targetBasisQuaternion - target 基底。
 * @returns {[number, number, number, number]} 補正クォータニオン。
 */
function selectBasisCorrectionQuaternion(sourceBasisCandidates, targetBasisQuaternion) {
  if (!Array.isArray(sourceBasisCandidates) || sourceBasisCandidates.length === 0) {
    return [...IDENTITY_QUATERNION];
  }

  const normalizedTargetBasis = normalizeQuaternionValues(targetBasisQuaternion);
  const bestCorrection = quat.create();
  let hasBest = false;
  let bestScore = -Infinity;

  for (const sourceBasisQuaternion of sourceBasisCandidates) {
    const normalizedSourceBasis = normalizeQuaternionValues(sourceBasisQuaternion);
    const inverseSourceBasis = quat.create();
    const correctionQuaternion = quat.create();
    quat.invert(inverseSourceBasis, normalizedSourceBasis);
    quat.multiply(correctionQuaternion, normalizedTargetBasis, inverseSourceBasis);
    quat.normalize(correctionQuaternion, correctionQuaternion);
    const score = Math.abs(correctionQuaternion[3]);
    if (!hasBest || score > bestScore) {
      quat.copy(bestCorrection, correctionQuaternion);
      bestScore = score;
      hasBest = true;
    }
  }

  return hasBest ? normalizeQuaternionValues(bestCorrection) : [...IDENTITY_QUATERNION];
}

/**
 * VMD -> VRM 用の基底補正クォータニオンを生成します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {string} sourceBoneName - source bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @returns {[number, number, number, number]} 基底補正クォータニオン。
 */
function createVmdVrmBasisCorrectionQuaternion(instance, sourceBoneName, targetBoneIndex) {
  if (!isVrmModel(instance?.model)) {
    return [...IDENTITY_QUATERNION];
  }

  if (!Number.isInteger(targetBoneIndex) || targetBoneIndex < 0) {
    return [...IDENTITY_QUATERNION];
  }

  const sourceBasisCandidates = getVmdSourceBasisCandidates(sourceBoneName);
  if (sourceBasisCandidates.length === 0) {
    return [...IDENTITY_QUATERNION];
  }

  const targetBone = instance.model.bones?.[targetBoneIndex] || null;
  const targetHumanoidBoneName = normalizeTargetBoneName(instance.model, targetBone?.name);
  const targetBasisQuaternion = VRM_ARM_HUMANOID_BONE_NAMES.has(targetHumanoidBoneName)
    ? getVrmArmTargetBasisQuaternion(instance.model, targetHumanoidBoneName, targetBone)
    : getBoneBasisQuaternion(targetBone);
  return selectBasisCorrectionQuaternion(sourceBasisCandidates, targetBasisQuaternion);
}

/**
 * 解決済み mapping の共通部分を生成します。
 * @param {string} sourceKind - animation source kind。
 * @param {string} sourceBoneName - source bone 名。
 * @param {string} targetBoneName - target bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @param {object|null|undefined} entry - mapping entry。
 * @returns {object} 共通 mapping。
 */
function createBaseResolvedBoneMapping(sourceKind, sourceBoneName, targetBoneName, targetBoneIndex, entry) {
  return {
    sourceKind,
    debugSourceFormat: sourceKind || 'internal',
    sourceBoneName,
    targetBoneName,
    targetBoneIndex,
    basisCorrectionQuaternion: [...IDENTITY_QUATERNION],
    basisCorrectionInverseQuaternion: [...IDENTITY_QUATERNION],
    rotationOffsetQuaternion: createRotationOffsetQuaternion(entry?.rotationOffsetEuler),
    vrmaRightLegPostCorrectionQuaternion: [...IDENTITY_QUATERNION],
    vrmaUseWorldRestRetarget: false,
    vrmaBasisCorrectionQuaternion: [...IDENTITY_QUATERNION],
    vrmaBasisCorrectionInverseQuaternion: [...IDENTITY_QUATERNION],
    targetApplyCorrectionQuaternion: [...IDENTITY_QUATERNION],
    targetApplyCorrectionInverseQuaternion: [...IDENTITY_QUATERNION],
    sourceLocalRestRotation: [...IDENTITY_QUATERNION],
    sourceWorldRestRotation: [...IDENTITY_QUATERNION],
    targetLocalRestRotation: [...IDENTITY_QUATERNION],
    targetWorldRestRotation: [...IDENTITY_QUATERNION],
    rotationRetargetMode: 'direct-basis',
    applyTranslationFlipAxes: sourceKind === VMD_SOURCE_KIND,
    applyRotationFlipAxesInDirectMode: sourceKind === VMD_SOURCE_KIND,
    useBindTranslation: false,
    subtractTargetBaseTranslation: false,
    translationCorrectionQuaternion: [...IDENTITY_QUATERNION],
    translationScale: [1, 1, 1],
    rotationFlipAxes: normalizeRotationFlipAxes(entry?.rotationFlipAxes),
    translationOffset: normalizeVector3(entry?.translationOffset, [0, 0, 0]),
    scaleOffset: normalizeVector3(entry?.scaleOffset, [1, 1, 1]),
  };
}

/**
 * VMD -> VRM の回転マッピングを無効化します。
 * @param {object} mapping - resolved mapping。
 */
function disableVmdVrmRotationMapping(mapping) {
  mapping.basisCorrectionQuaternion = [...IDENTITY_QUATERNION];
  mapping.basisCorrectionInverseQuaternion = [...IDENTITY_QUATERNION];
  mapping.rotationOffsetQuaternion = [...IDENTITY_QUATERNION];
  mapping.targetApplyCorrectionQuaternion = [...IDENTITY_QUATERNION];
  mapping.targetApplyCorrectionInverseQuaternion = [...IDENTITY_QUATERNION];
}

/**
 * VMD -> VRM 用の解決済み mapping を生成します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {string} sourceBoneName - source bone 名。
 * @param {string} targetBoneName - target bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @param {object|null|undefined} entry - mapping entry。
 * @returns {object} 解決済み mapping。
 */
function createResolvedVmdVrmBoneMapping(instance, sourceBoneName, targetBoneName, targetBoneIndex, entry) {
  const mapping = createBaseResolvedBoneMapping(
    VMD_SOURCE_KIND,
    sourceBoneName,
    targetBoneName,
    targetBoneIndex,
    entry,
  );
  disableVmdVrmRotationMapping(mapping);
  return mapping;
}

/**
 * VRMA -> VRM 用の解決済み mapping を生成します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} source - animation source。
 * @param {string} sourceBoneName - source bone 名。
 * @param {string} targetBoneName - target bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @param {object|null|undefined} entry - mapping entry。
 * @param {Map<number, [number, number, number, number]>} targetWorldRestRotationCache - world rest rotation cache。
 * @returns {object} 解決済み mapping。
 */
function createResolvedVrmaVrmBoneMapping(
  instance,
  source,
  sourceBoneName,
  targetBoneName,
  targetBoneIndex,
  entry,
  targetWorldRestRotationCache,
) {
  const mapping = createBaseResolvedBoneMapping(
    VRMA_SOURCE_KIND,
    sourceBoneName,
    targetBoneName,
    targetBoneIndex,
    entry,
  );
  const normalizedSourceBoneName = String(sourceBoneName || '').trim();
  const vrmaSourceRestRotation = getVrmaSourceRestRotation(source, sourceBoneName);
  const restRotationData = createVrmaRestRotationData(
    instance?.model,
    targetBoneIndex,
    vrmaSourceRestRotation,
    targetWorldRestRotationCache,
  );
  const vrmaBasisCorrectionQuaternion = vrmaSourceRestRotation
    && VRMA_BASIS_CORRECTION_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
    ? createVrmaBasisCorrectionQuaternion(sourceBoneName, targetBoneName)
    : [...IDENTITY_QUATERNION];
  mapping.rotationRetargetMode = 'rest-pose';
  mapping.applyTranslationFlipAxes = false;
  mapping.applyRotationFlipAxesInDirectMode = false;
  mapping.useBindTranslation = true;
  mapping.subtractTargetBaseTranslation = true;
  mapping.vrmaUseWorldRestRetarget = (
    VRMA_BODY_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
    || VRM_ARM_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
  );
  mapping.vrmaBasisCorrectionQuaternion = vrmaBasisCorrectionQuaternion;
  mapping.vrmaBasisCorrectionInverseQuaternion = createInverseQuaternion(vrmaBasisCorrectionQuaternion);
  mapping.sourceLocalRestRotation = restRotationData.sourceLocalRestRotation;
  mapping.sourceWorldRestRotation = restRotationData.sourceWorldRestRotation;
  mapping.targetLocalRestRotation = restRotationData.targetLocalRestRotation;
  mapping.targetWorldRestRotation = restRotationData.targetWorldRestRotation;
  return mapping;
}

/**
 * VRMA -> PMX 用の解決済み mapping を生成します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} source - animation source。
 * @param {string} sourceBoneName - source bone 名。
 * @param {string} targetBoneName - target bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @param {object|null|undefined} entry - mapping entry。
 * @param {Map<number, [number, number, number, number]>} targetWorldRestRotationCache - world rest rotation cache。
 * @returns {object} 解決済み mapping。
 */
function createResolvedVrmaPmxBoneMapping(
  instance,
  source,
  sourceBoneName,
  targetBoneName,
  targetBoneIndex,
  entry,
  targetWorldRestRotationCache,
) {
  const mapping = createBaseResolvedBoneMapping(
    VRMA_SOURCE_KIND,
    sourceBoneName,
    targetBoneName,
    targetBoneIndex,
    entry,
  );
  const normalizedSourceBoneName = String(sourceBoneName || '').trim();
  const vrmaSourceRestRotation = getVrmaSourceRestRotation(source, sourceBoneName);
  const restRotationData = createVrmaRestRotationData(
    instance?.model,
    targetBoneIndex,
    vrmaSourceRestRotation,
    targetWorldRestRotationCache,
  );
  const basisCorrectionQuaternion = vrmaSourceRestRotation
    ? createVrmaPmxBasisCorrectionQuaternion(sourceBoneName, targetBoneName)
    : [...IDENTITY_QUATERNION];
  mapping.rotationRetargetMode = 'rest-pose';
  mapping.applyTranslationFlipAxes = false;
  mapping.applyRotationFlipAxesInDirectMode = false;
  mapping.useBindTranslation = true;
  mapping.subtractTargetBaseTranslation = true;
  mapping.vrmaUseWorldRestRetarget = (
    VRMA_BODY_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
    || VRM_ARM_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
    || VRMA_THUMB_METACARPAL_HUMANOID_BONE_NAMES.has(normalizedSourceBoneName)
  );
  mapping.vrmaBasisCorrectionQuaternion = basisCorrectionQuaternion;
  mapping.vrmaBasisCorrectionInverseQuaternion = createInverseQuaternion(basisCorrectionQuaternion);
  mapping.sourceLocalRestRotation = restRotationData.sourceLocalRestRotation;
  mapping.sourceWorldRestRotation = restRotationData.sourceWorldRestRotation;
  // VRMA -> PMX は一度 PMX を VRM rest pose 相当の identity basis 空間へ正規化してから適用する。
  mapping.targetLocalRestRotation = [...IDENTITY_QUATERNION];
  mapping.targetWorldRestRotation = [...IDENTITY_QUATERNION];
  mapping.translationScale = createVrmaPmxTranslationScale(instance?.model, sourceBoneName, source);
  if (normalizedSourceBoneName === 'hips') {
    const parentBoneIndex = Number.isInteger(instance?.model?.bones?.[targetBoneIndex]?.parentIndex)
      ? instance.model.bones[targetBoneIndex].parentIndex
      : -1;
    mapping.translationCorrectionQuaternion = parentBoneIndex >= 0
      ? createInverseQuaternion(getBoneWorldRestRotationQuaternion(instance?.model, parentBoneIndex, new Map()))
      : [...IDENTITY_QUATERNION];
  }
  return mapping;
}

/**
 * source/model 非依存の通常 mapping を生成します。
 * @param {string} sourceKind - animation source kind。
 * @param {string} sourceBoneName - source bone 名。
 * @param {string} targetBoneName - target bone 名。
 * @param {number} targetBoneIndex - target bone index。
 * @param {object|null|undefined} entry - mapping entry。
 * @returns {object} 解決済み mapping。
 */
function createResolvedGenericBoneMapping(sourceKind, sourceBoneName, targetBoneName, targetBoneIndex, entry) {
  return createBaseResolvedBoneMapping(sourceKind, sourceBoneName, targetBoneName, targetBoneIndex, entry);
}

/**
 * source bone alias が state.entries 上でスキップ対象かどうかを返します。
 * @param {Map<string, object>} entries - state entries。
 * @param {string} sourceBoneName - source bone 名。
 * @returns {boolean} スキップするなら true。
 */
function shouldSkipAliasedSourceBoneEntry(entries, sourceBoneName) {
  const canonicalSourceBoneName = normalizeVmdSourceBoneName(sourceBoneName);
  return isVmdSourceBoneNameAlias(sourceBoneName) && entries.has(canonicalSourceBoneName);
}

/**
 * Euler オフセットから回転クォータニオンを生成します。
 * @param {ArrayLike<number>|null|undefined} rotationOffsetEuler - Euler degree オフセット。
 * @returns {[number, number, number, number]} 回転オフセット quaternion。
 */
function createRotationOffsetQuaternion(rotationOffsetEuler) {
  const rotationOffsetRadians = normalizeVector3(rotationOffsetEuler, [0, 0, 0])
    .map((value) => value * DEGREE_TO_RADIAN);
  return normalizeQuaternionValues(quaternionFromEulerXYZ(rotationOffsetRadians));
}

/**
 * クォータニオンの逆回転を返します。
 * @param {ArrayLike<number>|null|undefined} quaternion - 元クォータニオン。
 * @returns {[number, number, number, number]} 正規化済み逆クォータニオン。
 */
function createInverseQuaternion(quaternion) {
  if (isIdentityQuaternion(quaternion)) {
    return [...IDENTITY_QUATERNION];
  }

  const inverseQuaternion = quat.create();
  quat.invert(inverseQuaternion, normalizeQuaternionValues(quaternion));
  quat.normalize(inverseQuaternion, inverseQuaternion);
  return normalizeQuaternionValues(inverseQuaternion);
}

/**
 * VRMA 向け rest rotation 情報を生成します。
 * @param {object|null} model - モデルデータ。
 * @param {number} targetBoneIndex - target bone index。
 * @param {{localRotation: [number, number, number, number], worldRotation: [number, number, number, number]}|null} sourceRestRotation - source rest rotation。
 * @param {Map<number, [number, number, number, number]>} worldRestRotationCache - world rest rotation cache。
 * @returns {{
 *   sourceLocalRestRotation: [number, number, number, number],
 *   sourceWorldRestRotation: [number, number, number, number],
 *   targetLocalRestRotation: [number, number, number, number],
 *   targetWorldRestRotation: [number, number, number, number],
 * }} rest rotation 情報。
 */
function createVrmaRestRotationData(model, targetBoneIndex, sourceRestRotation, worldRestRotationCache) {
  if (!sourceRestRotation) {
    return {
      sourceLocalRestRotation: [...IDENTITY_QUATERNION],
      sourceWorldRestRotation: [...IDENTITY_QUATERNION],
      targetLocalRestRotation: [...IDENTITY_QUATERNION],
      targetWorldRestRotation: [...IDENTITY_QUATERNION],
    };
  }

  const targetBone = model?.bones?.[targetBoneIndex] || null;
  return {
    sourceLocalRestRotation: sourceRestRotation.localRotation,
    sourceWorldRestRotation: sourceRestRotation.worldRotation,
    targetLocalRestRotation: getBoneLocalRestRotationQuaternion(targetBone),
    targetWorldRestRotation: getVrmaTargetWorldRestRotationQuaternion(model, targetBoneIndex, worldRestRotationCache),
  };
}

/**
 * PMX 脚チェーンから hips 高さを推定します。
 * @param {object|null} model - モデルデータ。
 * @param {string} upperLegBoneName - 上脚ボーン名。
 * @param {string} lowerLegBoneName - 下脚ボーン名。
 * @param {string} footBoneName - 足首ボーン名。
 * @returns {number} 推定高さ。
 */
function estimatePmxVrmaLegHeight(model, upperLegBoneName, lowerLegBoneName, footBoneName) {
  const upperLegBoneIndex = findBoneIndexByName(model, upperLegBoneName);
  const lowerLegBoneIndex = findBoneIndexByName(model, lowerLegBoneName);
  const footBoneIndex = findBoneIndexByName(model, footBoneName);
  const upperLegBone = upperLegBoneIndex >= 0 ? model?.bones?.[upperLegBoneIndex] || null : null;
  const lowerLegBone = lowerLegBoneIndex >= 0 ? model?.bones?.[lowerLegBoneIndex] || null : null;
  const footBone = footBoneIndex >= 0 ? model?.bones?.[footBoneIndex] || null : null;
  if (!upperLegBone || !lowerLegBone || !footBone) {
    return 0;
  }
  const upperLength = Math.abs((Number(lowerLegBone.position?.[1]) || 0) - (Number(upperLegBone.position?.[1]) || 0));
  const lowerLength = Math.abs((Number(footBone.position?.[1]) || 0) - (Number(lowerLegBone.position?.[1]) || 0));
  return upperLength + lowerLength;
}

/**
 * PMX T ポーズ相当の hips 高さを推定します。
 * @param {object|null} model - モデルデータ。
 * @returns {number} 推定高さ。
 */
function estimatePmxVrmaHipsHeight(model) {
  const leftLegHeight = estimatePmxVrmaLegHeight(model, '左足', '左ひざ', '左足首');
  if (leftLegHeight > 0) {
    return leftLegHeight;
  }
  const rightLegHeight = estimatePmxVrmaLegHeight(model, '右足', '右ひざ', '右足首');
  if (rightLegHeight > 0) {
    return rightLegHeight;
  }
  const centerBoneIndex = findBoneIndexByName(model, 'センター');
  const centerBone = centerBoneIndex >= 0 ? model?.bones?.[centerBoneIndex] || null : null;
  return Math.max(Math.abs(Number(centerBone?.position?.[1]) || 0), 1);
}

/**
 * VRMA source metadata から hips 高さを推定します。
 * @param {object|null} source - animation source。
 * @returns {number} 推定高さ。
 */
function getVrmaSourceHipsHeight(source) {
  const hipsRestPosition = source?.clip?.metadata?.vrmAnimation?.hipsRestPosition;
  const sourceHeight = Math.abs(Number(hipsRestPosition?.[1]) || 0);
  return sourceHeight > 0 ? sourceHeight : 1;
}

/**
 * VRMA -> PMX 用の hips translation scale を返します。
 * @param {object|null} model - target モデル。
 * @param {string} sourceBoneName - source bone 名。
 * @param {object|null} source - animation source。
 * @returns {[number, number, number]} translation scale。
 */
function createVrmaPmxTranslationScale(model, sourceBoneName, source) {
  if (String(sourceBoneName || '').trim() !== 'hips') {
    return [1, 1, 1];
  }
  const sourceHeight = getVrmaSourceHipsHeight(source);
  const targetHeight = estimatePmxVrmaHipsHeight(model);
  const uniformScale = sourceHeight > 1e-6 ? targetHeight / sourceHeight : 1;
  return [uniformScale, uniformScale, uniformScale];
}

/**
 * instance/source 用の mapping state を取得または初期化します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} [source=instance?.animationSource] - animation source。
 * @returns {object|null} mapping state。
 */
export function ensureAnimationMappingState(instance, source = instance?.animationSource) {
  if (!instance) {
    return null;
  }

  const sourceKey = getAnimationSourceKey(source);
  if (!sourceKey) {
    return null;
  }

  if (!(instance.animationMappingBySourceKey instanceof Map)) {
    instance.animationMappingBySourceKey = new Map();
  }

  let state = instance.animationMappingBySourceKey.get(sourceKey) || null;
  if (!state) {
    state = {
      sourceKey,
      entries: new Map(),
    };
    instance.animationMappingBySourceKey.set(sourceKey, state);
  }

  const clip = getAnimationSourceClip(instance, source);
  const modelIsVrm = isVrmModel(instance.model);
  const modelIsPmx = isPmxModel(instance.model);
  const sourceBoneNames = collectAnimationSourceBoneNames(clip);
  const sourceBoneNameSet = new Set(sourceBoneNames);
  for (const sourceBoneName of sourceBoneNames) {
    const canonicalSourceBoneName = normalizeVmdSourceBoneName(sourceBoneName);
    if (isVmdSourceBoneNameAlias(sourceBoneName) && sourceBoneNameSet.has(canonicalSourceBoneName)) {
      state.entries.delete(sourceBoneName);
      continue;
    }
    if (!state.entries.has(sourceBoneName)) {
      state.entries.set(sourceBoneName, createDefaultAnimationMappingEntry(sourceBoneName, source, modelIsVrm, modelIsPmx));
    }
  }

  if (usesNormalizedVrmTargetNames(String(source?.kind || '').trim()) && modelIsVrm) {
    normalizeStateTargetBoneNames(instance.model, state);
  }

  return state;
}

/**
 * animation mapping を controller 用の解決済み配列へ変換します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} [source=instance?.animationSource] - animation source。
 * @returns {Array<object>} 解決済み mapping 配列。
 */
export function createResolvedAnimationBoneMappings(instance, source = instance?.animationSource) {
  const model = instance?.model || null;
  if (!model || !Array.isArray(model.bones)) {
    return [];
  }

  const state = ensureAnimationMappingState(instance, source);
  if (!state) {
    return [];
  }

  const resolvedMappings = [];
  const sourceKind = String(source?.kind || '').trim();
  const modelIsVrm = isVrmModel(model);
  const modelIsPmx = isPmxModel(model);
  const targetWorldRestRotationCache = new Map();
  for (const [sourceBoneName, entry] of state.entries) {
    if (shouldSkipAliasedSourceBoneEntry(state.entries, sourceBoneName)) {
      continue;
    }
    const targetBoneName = resolveAnimationMappingTargetBoneName(model, sourceKind, entry);
    if (!targetBoneName) {
      continue;
    }

    const targetBoneIndex = findBoneIndexByName(model, targetBoneName);
    if (!Number.isInteger(targetBoneIndex) || targetBoneIndex < 0) {
      continue;
    }

    if (sourceKind === VMD_SOURCE_KIND && modelIsVrm) {
      resolvedMappings.push(
        createResolvedVmdVrmBoneMapping(instance, sourceBoneName, targetBoneName, targetBoneIndex, entry),
      );
      continue;
    }
    if (sourceKind === VRMA_SOURCE_KIND && modelIsVrm) {
      resolvedMappings.push(
        createResolvedVrmaVrmBoneMapping(
          instance,
          source,
          sourceBoneName,
          targetBoneName,
          targetBoneIndex,
          entry,
          targetWorldRestRotationCache,
        ),
      );
      continue;
    }
    if (sourceKind === VRMA_SOURCE_KIND && modelIsPmx) {
      resolvedMappings.push(
        createResolvedVrmaPmxBoneMapping(
          instance,
          source,
          sourceBoneName,
          targetBoneName,
          targetBoneIndex,
          entry,
          targetWorldRestRotationCache,
        ),
      );
      continue;
    }
    resolvedMappings.push(
      createResolvedGenericBoneMapping(sourceKind, sourceBoneName, targetBoneName, targetBoneIndex, entry),
    );
  }

  return resolvedMappings;
}

/**
 * VRMA export 用の resolved mapping を返します。
 * PMX/PMD に VMD を書き出すときだけ rotationFlipAxes に XZ Flip を強制します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} [source=instance?.animationSource] - animation source。
 * @returns {Array<object>} VRMA export 用 resolved mapping。
 */
export function createVrmaExportResolvedAnimationBoneMappings(instance, source = instance?.animationSource) {
  const resolvedMappings = createResolvedAnimationBoneMappings(instance, source);
  const model = instance?.model || null;
  if (
    String(source?.kind || '').trim() !== VMD_SOURCE_KIND
    || !isPmxModel(model)
  ) {
    return resolvedMappings;
  }

  if (resolvedMappings.length > 0) {
    return resolvedMappings.map((mapping) => ({
      ...mapping,
      rotationFlipAxes: {
        x: true,
        y: false,
        z: true,
      },
    }));
  }

  const exportMappings = [];
  for (const channel of source?.clip?.channels || []) {
    if (String(channel?.target?.kind || '').trim() !== 'bone') {
      continue;
    }
    const sourceBoneName = String(channel?.target?.name || '').trim();
    if (!sourceBoneName) {
      continue;
    }
    exportMappings.push({
      sourceKind: VMD_SOURCE_KIND,
      sourceBoneName,
      targetBoneName: sourceBoneName,
      targetBoneIndex: model?.bones?.findIndex((bone) => String(bone?.name || '').trim() === sourceBoneName) ?? -1,
      rotationFlipAxes: {
        x: true,
        y: false,
        z: true,
      },
    });
  }

  return exportMappings;
}

/**
 * instance の animation mapping を controller へ反映します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} [source=instance?.animationSource] - animation source。
 * @returns {Array<object>} 解決済み mapping 配列。
 */
export function applyAnimationMappingToController(instance, source = instance?.animationSource) {
  const resolvedMappings = createResolvedAnimationBoneMappings(instance, source);
  instance?.animationController?.setBoneMappings?.(resolvedMappings);
  return resolvedMappings;
}

/**
 * 数値入力値を正規化します。
 * @param {HTMLInputElement} input - 数値入力。
 * @param {number} fallback - 既定値。
 * @returns {number} 正規化済み数値。
 */
function readNumberInputValue(input, fallback) {
  const value = Number.parseFloat(String(input?.value ?? ''));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * animation mapping タブを初期化します。
 * @param {object} options - 初期化オプション。
 * @param {function(): object} [options.getLangData] - ローカライズ辞書取得関数。
 * @param {function(): object|null} options.getModelManager - ModelManager 取得関数。
 * @param {function(): object|null} options.getSelection - selection 取得関数。
 * @param {function(): void} [options.refreshScene] - 再描画関数。
 * @returns {{sync: function(): void}|null} 初期化結果。
 */
export function setupAnimationMappingTab(options) {
  const documentObject = globalThis.document;
  const container = documentObject.getElementById('tab-animation-mapping');
  const status = documentObject.getElementById('animation-mapping-status');
  const grid = documentObject.getElementById('animation-mapping-grid');
  if (!container || !status || !grid) {
    return null;
  }
  let bulkControls = container.querySelector?.('.animation-mapping-bulk-controls') || null;
  if (!bulkControls) {
    bulkControls = document.createElement('div');
    bulkControls.className = 'animation-mapping-bulk-controls';
    grid.parentNode?.insertBefore?.(bulkControls, grid);
  }

  const getModelManager = typeof options?.getModelManager === 'function'
    ? options.getModelManager
    : () => null;
  const getSelection = typeof options?.getSelection === 'function'
    ? options.getSelection
    : () => null;
  const getLangData = typeof options?.getLangData === 'function'
    ? options.getLangData
    : () => ({});
  const refreshScene = typeof options?.refreshScene === 'function'
    ? options.refreshScene
    : null;

  /**
   * ローカライズ済み文字列を返します。
   * @param {string} key - 翻訳キー。
   * @param {string} fallback - 既定文字列。
   * @returns {string} ローカライズ済み文字列。
   */
  function t(key, fallback) {
    const langData = getLangData();
    return langData?.[key] || fallback || key;
  }

  /**
   * 状態文言を更新します。
   * @param {string} message - 表示文言。
   */
  function setStatus(message) {
    status.textContent = message;
  }

  /**
   * 空表示へ切り替えます。
   * @param {string} message - 表示文言。
   */
  function renderEmpty(message) {
    if (bulkControls) {
      bulkControls.innerHTML = '';
    }
    grid.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'animation-mapping-empty';
    empty.textContent = message;
    grid.appendChild(empty);
  }

  /**
   * 空状態を表示し、必要なら controller へ mapping を反映します。
   * @param {string} statusMessage - status 文言。
   * @param {string} emptyMessage - 空表示文言。
   * @param {object|null} [instance=null] - モデルインスタンス。
   * @param {object|null} [source=null] - animation source。
   */
  function renderEmptyState(statusMessage, emptyMessage, instance = null, source = null) {
    setStatus(statusMessage);
    renderEmpty(emptyMessage);
    if (instance) {
      applyAnimationMappingToController(instance, source);
    }
  }

  /**
   * target bone 重複選択を解消します。
   * @param {Map<string, object>} entries - mapping entries。
   * @param {string} sourceBoneName - 変更された source bone 名。
   * @param {string} targetBoneName - 変更後 target bone 名。
   */
  function clearDuplicateTargetSelection(entries, sourceBoneName, targetBoneName) {
    if (!targetBoneName) {
      return;
    }

    for (const [name, entry] of entries) {
      if (name === sourceBoneName) {
        continue;
      }
      if (String(entry?.targetBoneName || '').trim() === targetBoneName) {
        entry.targetBoneName = '';
      }
    }
  }

  /**
   * 1 行分の offset 入力 UI を構築します。
   * @param {string} label - 表示ラベル。
 * @param {Array<number>} values - 現在値。
 * @param {Array<number>} fallback - 既定値。
 * @param {function(number, number): void} onChanged - 変更時コールバック。
 * @param {boolean} [enabled=true] - UI を有効化するかどうか。
 * @returns {HTMLDivElement} 行要素。
 */
function buildOffsetRow(label, values, fallback, onChanged, enabled = true) {
  const row = document.createElement('div');
  row.className = 'animation-mapping-offset-row';

  const rowLabel = document.createElement('span');
  rowLabel.className = 'animation-mapping-offset-label';
  rowLabel.textContent = label;
  row.appendChild(rowLabel);

  ['X', 'Y', 'Z'].forEach((axisLabel, index) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.value = String(Number.isFinite(Number(values?.[index])) ? Number(values[index]) : fallback[index]);
    input.disabled = !enabled;
    input.setAttribute('aria-label', `${label} ${axisLabel}`);
    input.addEventListener('input', () => {
      onChanged(index, readNumberInputValue(input, fallback[index]));
    });
    input.addEventListener('change', () => {
      const nextValue = readNumberInputValue(input, fallback[index]);
      input.value = String(nextValue);
      onChanged(index, nextValue);
    });
    row.appendChild(input);
  });

  return row;
}

/**
 * 1 行分の回転反転入力 UI を構築します。
 * @param {{x: boolean, y: boolean, z: boolean}} values - 現在値。
 * @param {function('x'|'y'|'z', boolean): void} onChanged - 変更時コールバック。
 * @param {boolean} enabled - UI を有効化するかどうか。
 * @returns {HTMLDivElement} 行要素。
 */
function buildRotationFlipRow(values, onChanged, enabled) {
  const row = document.createElement('div');
  row.className = 'animation-mapping-offset-row';

  const rowLabel = document.createElement('span');
  rowLabel.className = 'animation-mapping-offset-label';
  rowLabel.textContent = 'F';
  row.appendChild(rowLabel);

  /** @type {Array<'x'|'y'|'z'>} */
  const axes = ['x', 'y', 'z'];
  axes.forEach((axis) => {
    const label = document.createElement('label');
    label.className = 'animation-mapping-flip-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(values?.[axis]);
    checkbox.disabled = !enabled;
    checkbox.setAttribute('aria-label', `Flip ${axis.toUpperCase()} rotation`);
    checkbox.addEventListener('change', () => {
      onChanged(axis, Boolean(checkbox.checked));
    });

    const text = document.createElement('span');
    text.textContent = axis.toUpperCase();

    label.appendChild(checkbox);
    label.appendChild(text);
    row.appendChild(label);
  });

  return row;
}

/**
 * 一括回転反転ボタン列を描画します。
 * @param {HTMLDivElement} target - 描画先。
 * @param {Map<string, object>} entries - mapping entries。
 * @param {string[]} sourceBoneNames - source bone 名一覧。
 * @param {boolean} enabled - UI を有効化するかどうか。
 * @param {object} activeInstance - 対象インスタンス。
 * @param {object|null} source - animation source。
 */
  function renderBulkRotationFlipControls(target, entries, sourceBoneNames, enabled, activeInstance, source) {
    target.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'animation-mapping-bulk-label';
    label.textContent = t('Flip All', 'Flip All');
    target.appendChild(label);

  /** @type {Array<'x'|'y'|'z'>} */
  const axes = ['x', 'y', 'z'];
  axes.forEach((axis) => {
    const allEnabled = sourceBoneNames.length > 0 && sourceBoneNames.every((sourceBoneName) => (
      Boolean(entries.get(sourceBoneName)?.rotationFlipAxes?.[axis])
    ));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'animation-mapping-bulk-button';
    button.textContent = `${axis.toUpperCase()} ${allEnabled ? t('Off', 'Off') : t('On', 'On')}`;
    button.disabled = !enabled;
    button.addEventListener('click', () => {
      if (!enabled) {
        return;
      }
      const nextValue = !allEnabled;
      for (const sourceBoneName of sourceBoneNames) {
        const entry = entries.get(sourceBoneName);
        if (!entry) {
          continue;
        }
        entry.rotationFlipAxes = normalizeRotationFlipAxes(entry.rotationFlipAxes);
        entry.rotationFlipAxes[axis] = nextValue;
      }
      applyAnimationMappingToController(activeInstance, source);
      refreshScene?.();
      sync();
    });
    target.appendChild(button);
  });
}

  /**
   * タブを再描画します。
   */
  function sync() {
    const modelManager = getModelManager();
    const selection = getSelection();
    const activeInstanceIndex = Number.isInteger(selection?.activeInstanceIndex) ? selection.activeInstanceIndex : -1;
    const activeInstance = modelManager?.instances?.[activeInstanceIndex] || null;

    if (!activeInstance) {
      renderEmptyState(t('No active model.', 'No active model.'), t('Select an active model to show animation mapping here.', 'アクティブモデルを選択すると、ここにアニメーションマッピングを表示します。'));
      return;
    }

    const model = activeInstance.model || null;
    if (!model) {
      renderEmptyState(t('No active model.', 'No active model.'), t('Select an active model to show animation mapping here.', 'アクティブモデルを選択すると、ここにアニメーションマッピングを表示します。'));
      return;
    }

    const source = activeInstance.animationSource || null;
    const sourceKind = String(source?.kind || '').trim();
    const isVrmModelActive = isVrmModel(model);
    const allowVmdVrmBulkRotationMapping = true;
    const allowVmdVrmRotationMapping = !(sourceKind === VMD_SOURCE_KIND && isVrmModelActive);
    const clip = getAnimationSourceClip(activeInstance, source);
    const sourceBoneNames = collectAnimationSourceBoneNames(clip);

    if (!source || !clip) {
      renderEmptyState(t('No animation source.', 'No animation source.'), t('Select an animation source to show mapping here.', 'アニメーション source を選択すると、ここにマッピングを表示します。'), activeInstance, source);
      return;
    }

    if (sourceBoneNames.length === 0) {
      renderEmptyState(t('No animated bones.', 'No animated bones.'), t('This animation source has no bone channels.', 'この animation source には bone channel がありません。'), activeInstance, source);
      return;
    }

    const state = ensureAnimationMappingState(activeInstance, source);
    const targetBoneNames = collectAnimationMappingTargetBoneNames(model, sourceKind);
    const visibleSourceBoneNames = sourceBoneNames.filter((sourceBoneName) => (
      !shouldSkipAliasedSourceBoneEntry(state.entries, sourceBoneName)
    ));

    renderBulkRotationFlipControls(
      bulkControls,
      state.entries,
      visibleSourceBoneNames,
      allowVmdVrmBulkRotationMapping,
      activeInstance,
      source,
    );

    grid.innerHTML = '';

    [t('Animation Bone', 'Animation Bone'), t('Target Bone', 'Target Bone'), t('Offsets', 'Offsets')].forEach((label) => {
      const header = document.createElement('div');
      header.className = 'animation-mapping-header';
      header.textContent = label;
      grid.appendChild(header);
    });

    for (const sourceBoneName of visibleSourceBoneNames) {
      const entry = getOrCreateAnimationMappingEntry(state.entries, sourceBoneName, source, isVrmModelActive, model);

      const sourceCell = document.createElement('div');
      sourceCell.className = 'animation-mapping-source';
      sourceCell.textContent = sourceBoneName;
      grid.appendChild(sourceCell);

      const targetCell = document.createElement('div');
      targetCell.className = 'animation-mapping-target';
      const select = document.createElement('select');
      select.className = 'animation-mapping-select';
      select.setAttribute('aria-label', `${sourceBoneName} target bone`);

      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = t('Unmapped', 'Unmapped');
      select.appendChild(emptyOption);

      for (const targetBoneName of targetBoneNames) {
        const option = document.createElement('option');
        option.value = targetBoneName;
        option.textContent = targetBoneName;
        select.appendChild(option);
      }

      select.value = String(entry.targetBoneName || '');
      select.addEventListener('change', () => {
        entry.targetBoneName = resolveAnimationMappingTargetBoneName(model, sourceKind, {
          targetBoneName: select.value || '',
        });
        clearDuplicateTargetSelection(state.entries, sourceBoneName, entry.targetBoneName);
        applyAnimationMappingToController(activeInstance, source);
        refreshScene?.();
        sync();
      });
      targetCell.appendChild(select);
      grid.appendChild(targetCell);

      const offsetCell = document.createElement('div');
      offsetCell.className = 'animation-mapping-offsets';
      offsetCell.appendChild(buildRotationFlipRow(
        normalizeRotationFlipAxes(entry.rotationFlipAxes),
        (axis, nextValue) => {
          entry.rotationFlipAxes = normalizeRotationFlipAxes(entry.rotationFlipAxes);
          entry.rotationFlipAxes[axis] = nextValue;
          applyAnimationMappingToController(activeInstance, source);
          refreshScene?.();
        },
        allowVmdVrmRotationMapping,
      ));
      offsetCell.appendChild(buildOffsetRow(
        'R',
        entry.rotationOffsetEuler,
        [0, 0, 0],
        (componentIndex, nextValue) => {
          entry.rotationOffsetEuler[componentIndex] = nextValue;
          applyAnimationMappingToController(activeInstance, source);
          refreshScene?.();
        },
        allowVmdVrmRotationMapping,
      ));
      offsetCell.appendChild(buildOffsetRow(
        'P',
        entry.translationOffset,
        [0, 0, 0],
        (componentIndex, nextValue) => {
          entry.translationOffset[componentIndex] = nextValue;
          applyAnimationMappingToController(activeInstance, source);
          refreshScene?.();
        },
      ));
      offsetCell.appendChild(buildOffsetRow(
        'S',
        entry.scaleOffset,
        [1, 1, 1],
        (componentIndex, nextValue) => {
          entry.scaleOffset[componentIndex] = nextValue;
          applyAnimationMappingToController(activeInstance, source);
          refreshScene?.();
        },
      ));
      grid.appendChild(offsetCell);
    }

    setStatus(`${t('Source', 'Source')}: ${String(source.name || source.kind || 'Animation')}`);
    applyAnimationMappingToController(activeInstance, source);
  }

  const controller = { sync };
  documentObject.addEventListener?.('openmmd-languagechange', sync);
  sync();
  return controller;
}
