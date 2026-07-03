import { quat, vec3 } from '../../lib/esm/index.js';
import { quaternionToEulerForBone } from '../math/math-utils.js';
import { selectPreferredElbowEulerY } from './elbow-rotation-utils.js';
import { getBone, getPreferredRotationAxisFromBoneName } from '../../core/model/model-scene.js';

/**
 * baseRotation を含む実効ローカル回転を返します。
 * @param {object} local - ボーンのローカル変換状態。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} 実効ローカル回転。
 */
export function getEffectiveLocalRotation(local, out = quat.create()) {
  quat.multiply(out, local?.manualRotation || quat.create(), local?.rotation || quat.create());
  quat.multiply(out, local?.baseRotation || quat.create(), out);
  quat.normalize(out, out);
  return out;
}

/**
 * ボーン情報 UI に表示するローカル位置を返します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 対象ボーン番号。
 * @param {vec3} [out=vec3.create()] - 出力先。
 * @returns {vec3} 表示用ローカル位置。
 */
export function getBoneInfoDisplayLocalPosition(activeInstance, selectedBoneIndex, out = vec3.create()) {
  const local = activeInstance?.scene?.boneLocalTransforms?.[selectedBoneIndex] || null;
  vec3.add(out, local?.translation || vec3.create(), local?.manualTranslation || vec3.create());
  return out;
}

/**
 * ボーン情報 UI に表示するワールド位置を返します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 対象ボーン番号。
 * @param {vec3} [out=vec3.create()] - 出力先。
 * @returns {vec3} 表示用ワールド位置。
 */
export function getBoneInfoDisplayWorldPosition(activeInstance, selectedBoneIndex, out = vec3.create()) {
  const local = activeInstance?.scene?.boneLocalTransforms?.[selectedBoneIndex] || null;
  const worldPosition = activeInstance?.scene?.boneWorldPositions?.[selectedBoneIndex] || null;
  vec3.set(
    out,
    Number(local?.worldMatrix?.[12] ?? worldPosition?.[0]) || 0,
    Number(local?.worldMatrix?.[13] ?? worldPosition?.[1]) || 0,
    Number(local?.worldMatrix?.[14] ?? worldPosition?.[2]) || 0,
  );
  return out;
}

/**
 * ボーン情報 UI に表示する位置と回転を返します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 選択中ボーン番号。
 * @param {boolean} [useWorldCoordinate=false] - ワールド表示なら true。
 * @returns {{position: vec3, rotation: quat}} 表示値。
 */
export function getBoneInfoDisplayValues(activeInstance, selectedBoneIndex, useWorldCoordinate = false) {
  const local = activeInstance.scene.boneLocalTransforms[selectedBoneIndex];
  const bindBone = activeInstance.model.bindBones[selectedBoneIndex];

  if (useWorldCoordinate) {
    return {
      position: getBoneInfoDisplayWorldPosition(activeInstance, selectedBoneIndex),
      rotation: quat.clone(local.worldRotation),
    };
  }

  const position = getBoneInfoDisplayLocalPosition(activeInstance, selectedBoneIndex);

  let rotation = getEffectiveLocalRotation(local);
  const basis = bindBone.rotation;
  if (basis) {
    const invBasis = quat.invert(quat.create(), basis);
    quat.multiply(rotation, invBasis, rotation);
    quat.multiply(rotation, rotation, basis);
  }
  return { position, rotation };
}

/**
 * ボーン情報 UI のローカル表示位置を、setter 用の raw local position へ戻します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 対象ボーン番号。
 * @param {vec3|ArrayLike<number>} displayPosition - ボーン情報 UI に表示するローカル位置。
 * @param {vec3} [out=vec3.create()] - 出力先。
 * @returns {vec3} setter 用 raw local position。
 */
export function getLocalPositionFromBoneInfoDisplayPosition(activeInstance, selectedBoneIndex, displayPosition, out = vec3.create()) {
  vec3.set(
    out,
    Number(displayPosition?.[0]) || 0,
    Number(displayPosition?.[1]) || 0,
    Number(displayPosition?.[2]) || 0,
  );
  return out;
}

/**
 * ボーン情報 UI のローカル表示回転を、setter 用の実効ローカル回転へ戻します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 対象ボーン番号。
 * @param {quat|ArrayLike<number>} displayRotation - ボーン情報 UI に表示する基底での回転。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} setter 用の実効ローカル回転。
 */
export function getLocalRotationFromBoneInfoDisplayRotation(activeInstance, selectedBoneIndex, displayRotation, out = quat.create()) {
  quat.copy(out, displayRotation);
  const basis = activeInstance?.model?.bindBones?.[selectedBoneIndex]?.rotation;
  if (basis) {
    const invBasis = quat.invert(quat.create(), basis);
    quat.multiply(out, basis, out);
    quat.multiply(out, out, invBasis);
  }
  quat.normalize(out, out);
  return out;
}

/**
 * ボーン情報 UI に表示する Euler 回転を返します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {number} selectedBoneIndex - 選択中ボーン番号。
 * @param {boolean} [useWorldCoordinate=false] - ワールド表示なら true。
 * @param {Array<number>|null} [prevEuler=null] - 前回 Euler 値。
 * @returns {Array<number>} 表示 Euler 回転。
 */
export function getBoneInfoDisplayEulerXYZ(activeInstance, selectedBoneIndex, useWorldCoordinate = false, prevEuler = null) {
  const displayValues = getBoneInfoDisplayValues(activeInstance, selectedBoneIndex, useWorldCoordinate);
  const bone = getBone(activeInstance.model, selectedBoneIndex);
  const local = activeInstance.scene.boneLocalTransforms[selectedBoneIndex];
  const boneName = bone?.name || '';
  if (shouldProjectElbowLikeRotation(boneName, activeInstance?.model)) {
    return [0, selectPreferredElbowEulerY(displayValues.rotation, local, prevEuler, bone), 0];
  }

  return quaternionToEulerForBone(displayValues.rotation, boneName, prevEuler);
}

/**
 * 肘系ボーンとして Y 軸投影するかどうかを返します。
 * VRM 英語名の ForeArm / LowerArm も対象に含めます。
 * @param {string} boneName - ボーン名。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {boolean} 投影するなら true。
 */
function shouldProjectElbowLikeRotation(boneName, model) {
  const normalizedName = String(boneName || '').trim();
  if (!normalizedName) {
    return false;
  }

  if (normalizedName.includes('肘') || normalizedName.includes('ひじ')) {
    return true;
  }

  const preferredAxis = getPreferredRotationAxisFromBoneName(normalizedName, model);
  if (preferredAxis !== 'y') {
    return false;
  }

  return normalizedName.includes('ForeArm')
    || normalizedName.includes('LowerArm');
}
