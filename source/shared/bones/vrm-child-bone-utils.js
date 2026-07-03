/**
 * VRM humanoid の脚・足チェーンで優先する child humanoid 名を返します。
 * @param {string} humanoidBoneName - 現在ボーンの humanoid 名。
 * @returns {string} 優先 child humanoid 名。対象外の場合は空文字。
 */
export function getPreferredVrmChildHumanoidBoneName(humanoidBoneName) {
  switch (String(humanoidBoneName || '').trim()) {
    case 'leftUpperLeg':
      return 'leftLowerLeg';
    case 'rightUpperLeg':
      return 'rightLowerLeg';
    case 'leftLowerLeg':
      return 'leftFoot';
    case 'rightLowerLeg':
      return 'rightFoot';
    case 'leftFoot':
      return 'leftToes';
    case 'rightFoot':
      return 'rightToes';
    default:
      return '';
  }
}

/**
 * ボーン index から VRM humanoid 名を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - ボーン index。
 * @returns {string} humanoid 名。見つからない場合は空文字。
 */
export function getVrmHumanoidBoneNameByBoneIndex(model, boneIndex) {
  if (model?.magic !== 'Vrm' || !Array.isArray(model?.bones) || !Number.isInteger(boneIndex)) {
    return '';
  }

  const bone = model.bones[boneIndex] || null;
  const directHumanoidBoneName = String(bone?.vrmHumanoidBoneName || '').trim();
  if (directHumanoidBoneName) {
    return directHumanoidBoneName;
  }

  const normalizedBoneName = String(bone?.name || '').trim();
  if (!normalizedBoneName) {
    return '';
  }

  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap;
  if (!humanoidBoneNameMap || typeof humanoidBoneNameMap !== 'object') {
    return '';
  }

  for (const [humanoidBoneName, resolvedBoneName] of Object.entries(humanoidBoneNameMap)) {
    if (String(resolvedBoneName || '').trim() === normalizedBoneName) {
      return String(humanoidBoneName || '').trim();
    }
  }

  return '';
}

/**
 * 指定ボーンの子ボーン index 一覧を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - 親ボーン index。
 * @param {number} [resolvedBoneCount=-1] - 解決済みボーン数。
 * @returns {Array<number>} 子ボーン index 一覧。
 */
export function collectChildBoneIndices(model, boneIndex, resolvedBoneCount = -1) {
  if (!Array.isArray(model?.bones) || !Number.isInteger(boneIndex) || boneIndex < 0) {
    return [];
  }

  const boneCount = resolvedBoneCount >= 0 ? resolvedBoneCount : model.bones.length;
  const childBoneIndices = [];
  for (let index = 0; index < boneCount; index += 1) {
    if (model.bones[index]?.parentIndex === boneIndex) {
      childBoneIndices.push(index);
    }
  }
  return childBoneIndices;
}

/**
 * VRM humanoid 本線で期待する child ボーン index を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - 親ボーン index。
 * @param {number} [resolvedBoneCount=-1] - 解決済みボーン数。
 * @returns {number} 期待 child ボーン index。見つからない場合は -1。
 */
export function resolveExpectedVrmHumanoidChildBoneIndex(model, boneIndex, resolvedBoneCount = -1) {
  const preferredHumanoidChildName = getPreferredVrmChildHumanoidBoneName(
    getVrmHumanoidBoneNameByBoneIndex(model, boneIndex),
  );
  if (!preferredHumanoidChildName) {
    return -1;
  }

  const childBoneIndices = collectChildBoneIndices(model, boneIndex, resolvedBoneCount);
  if (childBoneIndices.length === 0) {
    return -1;
  }

  for (const childBoneIndex of childBoneIndices) {
    if (getVrmHumanoidBoneNameByBoneIndex(model, childBoneIndex) === preferredHumanoidChildName) {
      return childBoneIndex;
    }
  }

  const resolvedBoneName = String(model?.vrm?.humanoidBoneNameMap?.[preferredHumanoidChildName] || '').trim();
  if (!resolvedBoneName) {
    return -1;
  }

  return childBoneIndices.find((childBoneIndex) => (
    String(model?.bones?.[childBoneIndex]?.name || '').trim() === resolvedBoneName
  )) ?? -1;
}

/**
 * 優先 child ボーン index を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - 親ボーン index。
 * @param {number} [resolvedBoneCount=-1] - 解決済みボーン数。
 * @returns {number} child ボーン index。見つからない場合は -1。
 */
export function resolvePreferredChildBoneIndex(model, boneIndex, resolvedBoneCount = -1) {
  const expectedChildBoneIndex = resolveExpectedVrmHumanoidChildBoneIndex(model, boneIndex, resolvedBoneCount);
  if (expectedChildBoneIndex >= 0) {
    return expectedChildBoneIndex;
  }

  const childBoneIndices = collectChildBoneIndices(model, boneIndex, resolvedBoneCount);
  return childBoneIndices.length > 0 ? childBoneIndices[0] : -1;
}

/**
 * tail 側として優先すべきボーン index を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - 親ボーン index。
 * @param {number} [resolvedBoneCount=-1] - 解決済みボーン数。
 * @returns {number} tail 側ボーン index。解決できない場合は -1。
 */
export function resolvePreferredTailBoneIndex(model, boneIndex, resolvedBoneCount = -1) {
  if (!Array.isArray(model?.bones) || !Number.isInteger(boneIndex) || boneIndex < 0) {
    return -1;
  }

  const boneCount = resolvedBoneCount >= 0 ? resolvedBoneCount : model.bones.length;
  const expectedChildBoneIndex = resolveExpectedVrmHumanoidChildBoneIndex(model, boneIndex, boneCount);
  if (expectedChildBoneIndex >= 0) {
    return expectedChildBoneIndex;
  }

  const bone = model.bones[boneIndex] || null;
  if (Number.isInteger(bone?.tailIndex) && bone.tailIndex >= 0 && bone.tailIndex < boneCount) {
    return bone.tailIndex;
  }
  if (Array.isArray(bone?.tailOffset)) {
    return -1;
  }

  return resolvePreferredChildBoneIndex(model, boneIndex, boneCount);
}
