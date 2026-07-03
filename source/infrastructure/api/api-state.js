import { quat } from '../../lib/esm/index.js';
import { getBone } from '../../core/model/model-scene.js';
import { getBoneInfoDisplayLocalPosition, getBoneInfoDisplayWorldPosition } from '../../shared/bones/bone-display-utils.js';

/**
 * Coerces a numeric component while preserving zero.
 * @param {unknown} value - Input component.
 * @param {number} fallback - Fallback value.
 * @returns {number} Numeric value.
 */
function coerceNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Clones a vec3-like value into a plain array.
 * @param {ArrayLike<number>|null|undefined} value - Input vector.
 * @returns {number[]} Plain vec3 array.
 */
function cloneVec3(value) {
  return [
    coerceNumber(value?.[0], 0),
    coerceNumber(value?.[1], 0),
    coerceNumber(value?.[2], 0),
  ];
}

/**
 * Clones a quat-like value into a plain array.
 * @param {ArrayLike<number>|null|undefined} value - Input quaternion.
 * @returns {number[]} Plain quaternion array.
 */
function cloneQuat(value) {
  return [
    coerceNumber(value?.[0], 0),
    coerceNumber(value?.[1], 0),
    coerceNumber(value?.[2], 0),
    coerceNumber(value?.[3], 1),
  ];
}

/**
 * Returns the active instance index from the runtime.
 * @param {object} runtime - Viewer runtime.
 * @returns {number} Active instance index.
 */
export function getActiveInstanceIndex(runtime) {
  const instances = Array.isArray(runtime?.modelManager?.instances)
    ? runtime.modelManager.instances
    : [];

  if (Number.isInteger(runtime?.selection?.activeInstanceIndex)) {
    const selectedIndex = runtime.selection.activeInstanceIndex;
    if (selectedIndex >= 0 && selectedIndex < instances.length) {
      return selectedIndex;
    }
  }

  const activeInstance = runtime?.getActiveInstance?.() ?? null;
  return activeInstance ? instances.indexOf(activeInstance) : -1;
}

/**
 * Builds a serializable snapshot for a single bone.
 * @param {object} instance - Model instance.
 * @param {number} boneIndex - Bone index.
 * @returns {object} Bone snapshot.
 */
export function buildBoneSnapshot(instance, boneIndex) {
  const model = instance?.model ?? null;
  const scene = instance?.scene ?? null;
  const bone = getBone(model, boneIndex);
  const local = Array.isArray(scene?.boneLocalTransforms) ? scene.boneLocalTransforms[boneIndex] ?? null : null;
  const localPosition = cloneVec3(getBoneInfoDisplayLocalPosition(instance, boneIndex));

  const localRotation = quat.multiply(
    quat.create(),
    cloneQuat(local?.manualRotation),
    cloneQuat(local?.rotation),
  );

  return {
    index: boneIndex,
    name: bone?.name || '',
    local: {
      position: localPosition,
      rotation: cloneQuat(localRotation),
    },
    world: {
      position: cloneVec3(getBoneInfoDisplayWorldPosition(instance, boneIndex)),
      rotation: cloneQuat(local?.worldRotation),
    },
  };
}

/**
 * Builds a serializable snapshot for a single model instance.
 * @param {object} instance - Model instance.
 * @param {number} instanceIndex - Instance index.
 * @param {boolean} isActive - Whether the instance is active.
 * @returns {object} Model snapshot.
 */
export function buildModelSnapshot(instance, instanceIndex, isActive) {
  const model = instance?.model ?? null;
  const bones = Array.isArray(model?.bones)
    ? model.bones.map((_, boneIndex) => buildBoneSnapshot(instance, boneIndex))
    : [];

  return {
    instanceIndex,
    modelName: model?.name || '',
    vmdName: instance?.vmdName || instance?.animationSourceName || '',
    boneCount: bones.length,
    isActive: Boolean(isActive),
    bones,
  };
}

/**
 * Builds a viewer runtime snapshot that can be published over HTTP.
 * @param {object} runtime - Viewer runtime.
 * @returns {object} Runtime snapshot.
 */
export function buildViewerStateSnapshot(runtime) {
  const instances = Array.isArray(runtime?.modelManager?.instances)
    ? runtime.modelManager.instances
    : [];
  const activeInstanceIndex = getActiveInstanceIndex(runtime);
  const activeInstance = activeInstanceIndex >= 0 ? instances[activeInstanceIndex] ?? null : null;
  const models = instances.map((instance, index) => buildModelSnapshot(instance, index, index === activeInstanceIndex));
  const postEffects = runtime?.rendererState?.postEffects ?? runtime?.postEffects ?? null;
  const legacyEnabled = postEffects?.enabled;
  const bloomEnabled = postEffects?.bloomEnabled !== undefined
    ? Boolean(postEffects.bloomEnabled)
    : Boolean(legacyEnabled);
  const dofEnabled = postEffects?.dofEnabled !== undefined
    ? Boolean(postEffects.dofEnabled)
    : Boolean(legacyEnabled);
  const ambientOcclusionEnabled = Boolean(postEffects?.ambientOcclusionEnabled);
  const contactShadowEnabled = Boolean(postEffects?.contactShadowEnabled);
  const rendererState = runtime?.rendererState ?? null;
  const environmentHdrPath = typeof rendererState?.environmentHdrPath === 'string'
    ? rendererState.environmentHdrPath
    : '';
  const environmentHdrName = typeof rendererState?.environmentHdrName === 'string' && rendererState.environmentHdrName
    ? rendererState.environmentHdrName
    : environmentHdrPath.split(/[\\/]/).pop() || '';
  const environmentHdrIntensity = Number.isFinite(rendererState?.environmentHdrIntensity)
    ? rendererState.environmentHdrIntensity
    : 1.0;
  const environmentHdrLoaded = Boolean(rendererState?.environmentHdrLoaded);

  return {
    timestamp: Date.now(),
    activeInstanceIndex,
    activeModelName: activeInstance?.model?.name || '',
    activeVmdName: activeInstance?.vmdName || activeInstance?.animationSourceName || '',
    modelNames: models.map((model) => model.modelName),
    vmdNames: Array.from(runtime?.vmdManager?.vmds?.keys?.() ?? runtime?.vmdManager?.sources?.keys?.() ?? []),
    models,
    postEffects: {
      bloomEnabled,
      dofEnabled,
      ambientOcclusionEnabled,
      ambientOcclusionRadius: Number(postEffects?.ambientOcclusionRadius ?? 0.4),
      ambientOcclusionBias: Number(postEffects?.ambientOcclusionBias ?? 0.02),
      ambientOcclusionIntensity: Number(postEffects?.ambientOcclusionIntensity ?? 1.0),
      ambientOcclusionBlurAmount: Number(postEffects?.ambientOcclusionBlurAmount ?? 1.0),
      ambientOcclusionSampleCount: Number(postEffects?.ambientOcclusionSampleCount ?? 12),
      contactShadowEnabled,
      contactShadowLength: Number(postEffects?.contactShadowLength ?? 0.08),
      contactShadowThickness: Number(postEffects?.contactShadowThickness ?? 0.01),
      contactShadowIntensity: Number(postEffects?.contactShadowIntensity ?? 0.55),
      contactShadowBlurAmount: Number(postEffects?.contactShadowBlurAmount ?? 1.0),
      contactShadowStepCount: Number(postEffects?.contactShadowStepCount ?? 8),
      enabled: Boolean(bloomEnabled || dofEnabled),
    },
    environmentHdrPath,
    environmentHdrName,
    environmentHdrIntensity,
    environmentHdrLoaded,
  };
}
