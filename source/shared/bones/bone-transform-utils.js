import { mat4, quat, vec3 } from '../../lib/esm/index.js';

/**
 * ボーンの親ワールド行列を返します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @returns {mat4} 親のワールド行列、ルートなら単位行列。
 */
export function getParentWorldMatrix(scene, bone) {
  if (!bone || bone.parentIndex === -1) {
    return mat4.create();
  }

  return scene.boneLocalTransforms[bone.parentIndex].worldMatrix;
}

/**
 * ボーンの継承移動量を返します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @returns {vec3} 継承移動量。
 */
export function getInheritedTranslation(scene, bone) {
  const inherited = vec3.create();
  if (!bone || (bone.flags & 0x0200) === 0 || bone.inheritParentIndex === -1 || bone.parentIndex === bone.inheritParentIndex) {
    return inherited;
  }

  const inheritBone = scene.boneLocalTransforms[bone.inheritParentIndex];
  if (!inheritBone) {
    return inherited;
  }

  inherited[0] = inheritBone.translation[0] * bone.inheritInfluence;
  inherited[1] = inheritBone.translation[1] * bone.inheritInfluence;
  inherited[2] = inheritBone.translation[2] * bone.inheritInfluence;
  return inherited;
}

/**
 * ボーンの継承回転量を返します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @returns {quat} 継承回転量。
 */
export function getInheritedRotation(scene, bone) {
  const inherited = quat.create();
  if (!bone || (bone.flags & 0x0100) === 0 || bone.inheritParentIndex === -1 || bone.parentIndex === bone.inheritParentIndex) {
    return inherited;
  }

  const inheritBone = scene.boneLocalTransforms[bone.inheritParentIndex];
  if (!inheritBone) {
    return inherited;
  }

  quat.slerp(inherited, inherited, inheritBone.rotation, bone.inheritInfluence);
  return inherited;
}

/**
 * Child の参照先を解決します。
 * @param {object} scene - シーン状態。
 * @param {object} local - ローカル変換状態。
 * @returns {{instance: object, local: object}|null} 解決結果。
 */
export function resolveChildTarget(scene, local) {
  const instances = Array.isArray(scene?.modelManager?.instances) ? scene.modelManager.instances : null;
  if (!instances || !Number.isInteger(local?.childSourceInstanceIndex) || !Number.isInteger(local?.childSourceBoneIndex)) {
    return null;
  }

  const instance = instances[local.childSourceInstanceIndex] ?? null;
  const childLocal = instance?.scene?.boneLocalTransforms?.[local.childSourceBoneIndex] ?? null;
  if (!instance || !childLocal) {
    return null;
  }

  return { instance, local: childLocal };
}

/**
 * Child の world 補正を返します。
 * @param {object} scene - シーン状態。
 * @param {object} local - ローカル変換状態。
 * @param {vec3} [outPosition=vec3.create()] - 出力位置。
 * @param {quat} [outRotation=quat.create()] - 出力回転。
 * @param {boolean} [respectInverseEnabled=true] - 逆補正の有効/無効を反映するなら true。
 * @returns {boolean} 有効なら true。
 */
export function getChildWorldOffset(
  scene,
  local,
  outPosition = vec3.create(),
  outRotation = quat.create(),
  respectInverseEnabled = true,
) {
  const tempMatA = mat4.create();
  const tempMatB = mat4.create();
  const influence = Number.isFinite(local?.childInfluence) ? Math.min(1, Math.max(0, local.childInfluence)) : 1;
  if (!local?.childEnabled || influence <= 0) {
    return false;
  }

  const target = resolveChildTarget(scene, local);
  if (!target) {
    return false;
  }

  const targetWorldPosition = target.instance?.scene?.boneWorldPositions?.[local.childSourceBoneIndex];
  const targetWorldRotation = target.local.worldRotation;
  if (!targetWorldPosition || !targetWorldRotation) {
    return false;
  }

  const useInverse = !respectInverseEnabled || local.childInverseEnabled;
  const inversePosition = useInverse ? local.childInversePosition : _zeroVec3;
  const inverseRotation = useInverse ? local.childInverseRotation : _identityQuat;

  mat4.fromRotationTranslation(tempMatA, targetWorldRotation, targetWorldPosition);
  mat4.fromRotationTranslation(tempMatB, inverseRotation, inversePosition);
  if (!mat4.invert(tempMatB, tempMatB)) {
    return false;
  }
  mat4.multiply(tempMatA, tempMatA, tempMatB);
  mat4.getTranslation(outPosition, tempMatA);
  mat4.getRotation(outRotation, tempMatA);

  if (influence !== 1) {
    outPosition[0] *= influence;
    outPosition[1] *= influence;
    outPosition[2] *= influence;
    quat.slerp(outRotation, _identityQuat, outRotation, influence);
  }
  quat.normalize(outRotation, outRotation);
  return true;
}

/**
 * Child world 補正を考慮した回転を返します。
 * @param {object} scene - シーン状態。
 * @param {object} local - ローカル変換状態。
 * @param {quat} [out=quat.create()] - 出力回転。
 * @returns {quat} 補正回転。
 */
export function getChildInfluenceRotation(scene, local, out = quat.create()) {
  getChildWorldOffset(scene, local, _zeroVec3, out);
  return out;
}

/**
 * Child の差分変換を既存 world 行列へ適用します。
 * @param {mat4} worldMatrix - 適用対象の world 行列。
 * @param {ArrayLike<number>} childPosition - Child 差分位置。
 * @param {quat|ArrayLike<number>} childRotation - Child 差分回転。
 * @param {mat4} [out=worldMatrix] - 出力先。
 * @returns {mat4} Child 差分適用後の world 行列。
 */
export function applyChildWorldOffsetToMatrix(worldMatrix, childPosition, childRotation, out = worldMatrix) {
  const childMatrix = mat4.create();
  mat4.fromRotationTranslation(childMatrix, childRotation, childPosition);
  mat4.multiply(out, childMatrix, worldMatrix);
  return out;
}

const _zeroVec3 = vec3.fromValues(0, 0, 0);
const _identityQuat = quat.fromValues(0, 0, 0, 1);

/**
 * ワールド位置入力から manualTranslation を算出します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @param {object} local - ローカル変換状態。
 * @param {ArrayLike<number>} targetPosition - 目標ワールド位置。
 * @param {vec3} [out=vec3.create()] - 出力先。
 * @returns {vec3} manualTranslation。
 */
export function getManualTranslationFromWorldPosition(scene, bone, local, targetPosition, out = vec3.create()) {
  const parentWorld = getParentWorldMatrix(scene, bone);
  const invParentWorld = mat4.invert(mat4.create(), parentWorld);
  const localTarget = invParentWorld
    ? vec3.transformMat4(vec3.create(), targetPosition, invParentWorld)
    : vec3.clone(targetPosition);
  const inheritedTranslation = getInheritedTranslation(scene, bone);

  out[0] = localTarget[0] - local.baseTranslation[0] - local.translation[0] - inheritedTranslation[0];
  out[1] = localTarget[1] - local.baseTranslation[1] - local.translation[1] - inheritedTranslation[1];
  out[2] = localTarget[2] - local.baseTranslation[2] - local.translation[2] - inheritedTranslation[2];
  return out;
}

/**
 * Child の補正を加えたワールド位置から manualTranslation を算出します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @param {object} local - ローカル変換状態。
 * @param {ArrayLike<number>} targetPosition - 目標ワールド位置。
 * @param {vec3} [out=vec3.create()] - 出力先。
 * @returns {vec3} manualTranslation。
 */
export function getManualTranslationFromChildWorldPosition(scene, bone, local, targetPosition, out = vec3.create()) {
  const adjustedTarget = vec3.clone(targetPosition);
  const childOffset = vec3.create();
  const childRotation = quat.create();
  if (getChildWorldOffset(scene, local, childOffset, childRotation)) {
    const invChildRotation = quat.invert(quat.create(), childRotation);
    adjustedTarget[0] -= childOffset[0];
    adjustedTarget[1] -= childOffset[1];
    adjustedTarget[2] -= childOffset[2];
    vec3.transformQuat(adjustedTarget, adjustedTarget, invChildRotation);
  }
  return getManualTranslationFromWorldPosition(scene, bone, local, adjustedTarget, out);
}

/**
 * @deprecated Use getManualTranslationFromWorldPosition().
 */
export const getManualTranslationFromGlobalPosition = getManualTranslationFromWorldPosition;

/**
 * ワールド回転入力から manualRotation を算出します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @param {object} local - ローカル変換状態。
 * @param {quat} targetRotation - 目標ワールド回転。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} manualRotation。
 */
export function getManualRotationFromWorldRotation(scene, bone, local, targetRotation, out = quat.create()) {
  const parentWorldRotation = bone.parentIndex !== -1
    ? scene.boneLocalTransforms[bone.parentIndex].worldRotation
    : quat.create();
  const invParentWorldRotation = quat.invert(quat.create(), parentWorldRotation);
  const inheritedRotation = getInheritedRotation(scene, bone);
  const invInheritedRotation = quat.invert(quat.create(), inheritedRotation);
  // world へは parent -> inherited -> base -> manual -> animation の順で積む。
  const invBaseRotation = quat.invert(quat.create(), local.baseRotation || quat.create());
  const invAnimRotation = quat.invert(quat.create(), local.rotation);

  quat.multiply(out, invInheritedRotation, invParentWorldRotation);
  quat.multiply(out, out, targetRotation);
  quat.multiply(out, out, invAnimRotation);
  quat.multiply(out, invBaseRotation, out);
  quat.normalize(out, out);

  return out;
}

/**
 * Child の補正を加えたワールド回転から manualRotation を算出します。
 * @param {object} scene - シーン状態。
 * @param {object} bone - ボーン。
 * @param {object} local - ローカル変換状態。
 * @param {quat} targetRotation - 目標ワールド回転。
 * @param {quat} [out=quat.create()] - 出力先。
 * @returns {quat} manualRotation。
 */
export function getManualRotationFromChildWorldRotation(scene, bone, local, targetRotation, out = quat.create()) {
  const adjustedTarget = quat.clone(targetRotation);
  const childOffset = quat.create();
  getChildWorldOffset(scene, local, vec3.create(), childOffset);
  const invChildRotation = quat.invert(quat.create(), childOffset);
  quat.multiply(adjustedTarget, invChildRotation, adjustedTarget);
  quat.normalize(adjustedTarget, adjustedTarget);
  return getManualRotationFromWorldRotation(scene, bone, local, adjustedTarget, out);
}

/**
 * @deprecated Use getManualRotationFromWorldRotation().
 */
export const getManualRotationFromGlobalRotation = getManualRotationFromWorldRotation;
