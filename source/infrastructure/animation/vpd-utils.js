/**
 * Normalizes a VPD lookup string.
 * @param {string} value - Input string.
 * @returns {string} Normalized string.
 */
export function normalizeVpdLookupName(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/');
  return normalized.toLowerCase();
}

/**
 * Returns name variants that should be considered equivalent for VPD matching.
 * @param {string} value - Input string.
 * @returns {string[]} Candidate variants.
 */
function getNameVariants(value) {
  const normalized = normalizeVpdLookupName(value);
  if (!normalized) {
    return [];
  }

  const variants = new Set([normalized]);
  const lastSlashIndex = normalized.lastIndexOf('/');
  const basename = lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
  variants.add(basename);

  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex > 0) {
    variants.add(basename.slice(0, dotIndex));
  }

  return Array.from(variants);
}

/**
 * Returns true when two VPD lookup strings should be treated as equivalent.
 * @param {string} left - Left value.
 * @param {string} right - Right value.
 * @returns {boolean} Equivalent or not.
 */
function namesMatch(left, right) {
  const leftVariants = getNameVariants(left);
  const rightVariants = new Set(getNameVariants(right));
  return leftVariants.some((variant) => rightVariants.has(variant));
}

/**
 * Finds the best model instance target for a VPD model name.
 * @param {Array<object>} instances - Loaded model instances.
 * @param {string} modelName - VPD model name.
 * @returns {object|null} Matched model instance or null.
 */
export function findVpdTargetInstance(instances, modelName) {
  const targetName = String(modelName || '').trim();
  if (!targetName || !Array.isArray(instances)) {
    return null;
  }

  for (const instance of instances) {
    const model = instance?.model ?? null;
    const modelPath = instance?.modelPath ?? '';
    if (namesMatch(targetName, model?.name) || namesMatch(targetName, modelPath)) {
      return instance;
    }
  }

  return null;
}

/**
 * Applies a VPD pose to a model instance.
 * @param {object} instance - Target model instance.
 * @param {object} pose - Parsed VPD pose data.
 * @param {object} modelManager - Model manager with manual transform helpers.
 * @returns {{appliedBoneCount: number, poseBoneCount: number}} Apply summary.
 */
export function applyVpdPoseToInstance(instance, pose, modelManager) {
  const poseBones = Array.isArray(pose?.bones) ? pose.bones : [];
  if (!instance || poseBones.length === 0) {
    return {
      appliedBoneCount: 0,
      poseBoneCount: poseBones.length,
    };
  }

  const bones = Array.isArray(instance?.model?.bones) ? instance.model.bones : [];
  const matchedBoneIndices = poseBones
    .map((poseBone, index) => ({
      poseBone,
      index,
      boneIndex: bones.findIndex((bone) => namesMatch(String(poseBone?.name || '').trim(), bone?.name)),
    }))
    .filter((entry) => entry.boneIndex >= 0);

  if (matchedBoneIndices.length === 0) {
    return {
      appliedBoneCount: 0,
      poseBoneCount: poseBones.length,
    };
  }

  if (modelManager?.resetAllManualTransforms) {
    modelManager.resetAllManualTransforms(instance);
  }

  let appliedBoneCount = 0;

  for (const { poseBone, boneIndex } of matchedBoneIndices) {
    if (Array.isArray(poseBone.position) && modelManager?.setManualLocalPosition) {
      modelManager.setManualLocalPosition(instance, boneIndex, poseBone.position);
    }
    if (Array.isArray(poseBone.rotation) && modelManager?.setManualLocalRotationQuaternion) {
      modelManager.setManualLocalRotationQuaternion(instance, boneIndex, poseBone.rotation);
    }
    appliedBoneCount += 1;
  }

  if (modelManager?.recomputeBoneMatrices && instance?.model && instance?.scene) {
    modelManager.recomputeBoneMatrices(instance.model, instance.scene);
  }

  return {
    appliedBoneCount,
    poseBoneCount: poseBones.length,
  };
}
