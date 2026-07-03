import { findBoneIndexByName } from '../../core/model/model-scene.js';
import { quaternionFromEulerXYZ } from '../../shared/math/math-utils.js';

/**
 * Creates a command service for integration-driven bone parameter updates.
 * @param {object} options - Service options.
 * @returns {{applyPayload: function}} Bone parameter command service.
 */
export function createBoneParameterCommandService(options) {
  /**
   * Resolves the target model instance from the payload.
   * @param {object} payload - Command payload.
   * @returns {object|null} Target instance.
   */
  function resolveTargetInstance(payload) {
    const instances = Array.isArray(options.modelManager?.instances)
      ? options.modelManager.instances
      : [];
    if (instances.length === 0) {
      throw new Error('set-bone-params requires a loaded model.');
    }

    const modelName = typeof payload?.modelName === 'string' ? payload.modelName : '';
    if (!modelName) {
      const activeInstance = options.getActiveInstance?.() ?? null;
      if (!activeInstance) {
        throw new Error('set-bone-params requires an active model.');
      }
      return activeInstance;
    }

    const instance = instances.find((candidate) => candidate?.model?.name === modelName) || null;
    if (!instance) {
      throw new Error(`Model not found: ${modelName}`);
    }
    return instance;
  }

  /**
   * Applies a single target entry to a model instance.
   * @param {object} instance - Target instance.
   * @param {object} target - Target payload entry.
   */
  function applyTarget(instance, target) {
    const boneName = typeof target?.boneName === 'string' ? target.boneName : '';
    if (!boneName) {
      throw new Error('set-bone-params requires target.boneName.');
    }

    const boneIndex = findBoneIndexByName(instance.model, boneName);
    if (boneIndex < 0) {
      throw new Error(`Bone not found: ${boneName}`);
    }

    const space = typeof target?.space === 'string' ? target.space : '';
    const kind = typeof target?.kind === 'string' ? target.kind : '';
    if (space !== 'local' && space !== 'world') {
      throw new Error(`set-bone-params invalid space for bone ${boneName}: ${space}`);
    }

    if (kind === 'position') {
      const value = Array.isArray(target?.value) ? target.value.map(Number) : [];
      if (value.length < 3 || value.some((component) => !Number.isFinite(component))) {
        throw new Error(`target.value for bone ${boneName} must be a 3-element array.`);
      }
      if (space === 'world') {
        options.modelManager.setManualWorldPosition(instance, boneIndex, value);
      } else {
        options.modelManager.setManualLocalPosition(instance, boneIndex, value);
      }
      return;
    }

    if (kind === 'rotationEuler') {
      const eulerDeg = Array.isArray(target?.value) ? target.value.map(Number) : [];
      if (eulerDeg.length < 3 || eulerDeg.some((component) => !Number.isFinite(component))) {
        throw new Error(`target.value for bone ${boneName} must be a 3-element array.`);
      }
      const eulerRad = eulerDeg.map((value) => value * Math.PI / 180);
      if (space === 'world') {
        options.modelManager.setManualWorldRotationEuler(instance, boneIndex, eulerRad);
      } else {
        options.modelManager.setManualLocalRotationQuaternion(instance, boneIndex, quaternionFromEulerXYZ(eulerRad));
      }
      return;
    }

    if (kind === 'rotationQuaternion') {
      const value = Array.isArray(target?.value) ? target.value.map(Number) : [];
      if (value.length < 4 || value.some((component) => !Number.isFinite(component))) {
        throw new Error(`target.value for bone ${boneName} must be a 4-element array.`);
      }
      if (space === 'world') {
        options.modelManager.setManualWorldRotationQuaternion(instance, boneIndex, value);
      } else {
        options.modelManager.setManualLocalRotationQuaternion(instance, boneIndex, value);
      }
      return;
    }

    throw new Error(`set-bone-params invalid kind for bone ${boneName}: ${kind}`);
  }

  return {
    /**
     * Applies a set-bone-params payload.
     * @param {object} payload - Command payload.
     */
    applyPayload(payload) {
      const targets = Array.isArray(payload?.targets) ? payload.targets : [];
      if (targets.length === 0) {
        throw new Error('set-bone-params requires payload.targets.');
      }

      const instance = resolveTargetInstance(payload);
      for (const target of targets) {
        applyTarget(instance, target);
      }

      options.modelManager.recomputeBoneMatrices?.(instance.model, instance.scene);
      options.modelManager.writeBoneMatrices?.(instance.scene);
    },
  };
}
