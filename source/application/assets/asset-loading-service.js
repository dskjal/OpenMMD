import {
  collectPlayableAudioFilesFromZipFiles,
  collectVpdFilesFromZipFiles,
  isVpdFileName,
} from '../../infrastructure/io/file-loading.js';
import { VPDLoader } from '../../infrastructure/loaders/vpd-loader.js';
import { normalizeVpdToInternalUnits } from '../../infrastructure/units/unit-conversion.js';
import {
  applyVpdPoseToInstance,
  findVpdTargetInstance,
} from '../../infrastructure/animation/vpd-utils.js';

/**
 * Creates the asset loading service.
 * @param {object} options - Service options.
 * @returns {object} Asset loading service.
 */
export function createAssetLoadingService(options) {
  /**
   * Parses and applies a VPD file.
   * @param {File} file - VPD file.
   * @param {object} [settings={}] - Apply settings.
   * @returns {Promise<object>} Apply result.
   */
  async function loadVpdFile(file, settings = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error('Invalid VPD file.');
    }

    const loader = new VPDLoader();
    const vpd = normalizeVpdToInternalUnits(loader.parse(await file.arrayBuffer()));
    const instances = Array.isArray(options.modelManager?.instances) ? options.modelManager.instances : [];
    let targetInstance = findVpdTargetInstance(instances, vpd.modelName);
    let usedActiveFallback = false;

    if (!targetInstance) {
      const activeInstance = options.getActiveInstance?.();
      if (!activeInstance) {
        throw new Error(`VPD "${file.name}" requires a loaded model or a matching model name.`);
      }

      const activeModelName = String(activeInstance?.model?.name || 'Active model');
      const targetLabel = String(vpd.modelName || '').trim();
      const confirmMessage = targetLabel
        ? `VPD model-name "${targetLabel}" was not found. Apply pose to the active model "${activeModelName}" instead?`
        : `VPD "${file.name}" does not specify a model name. Apply pose to the active model "${activeModelName}" instead?`;
      const confirmModelMismatch = settings.confirmModelMismatch ?? options.confirmModelMismatch;

      const confirmed = typeof confirmModelMismatch === 'function'
        ? Boolean(await confirmModelMismatch(confirmMessage, {
          fileName: file.name,
          modelName: vpd.modelName,
          activeModelName,
        }))
        : false;

      if (!confirmed) {
        return {
          applied: false,
          skippedReason: 'model-mismatch',
          fileName: file.name,
          modelName: vpd.modelName,
          targetModelName: activeModelName,
          appliedBones: 0,
          poseBoneCount: Array.isArray(vpd.bones) ? vpd.bones.length : 0,
          usedActiveFallback: false,
        };
      }

      targetInstance = activeInstance;
      usedActiveFallback = true;
    }

    const summary = applyVpdPoseToInstance(targetInstance, vpd, options.modelManager);
    if (summary.appliedBoneCount === 0) {
      return {
        applied: false,
        skippedReason: 'no-matching-bones',
        fileName: file.name,
        modelName: vpd.modelName,
        targetModelName: targetInstance?.model?.name || '',
        appliedBones: 0,
        poseBoneCount: summary.poseBoneCount,
        usedActiveFallback,
      };
    }

    const physicsEntry = options.physicsEngine?.models?.find((entry) => entry?.model === targetInstance?.model) ?? null;
    if (physicsEntry && typeof options.physicsEngine?.resetModel === 'function') {
      options.physicsEngine.resetModel(physicsEntry);
    }

    return {
      applied: true,
      fileName: file.name,
      modelName: vpd.modelName,
      targetModelName: targetInstance?.model?.name || '',
      appliedBones: summary.appliedBoneCount,
      poseBoneCount: summary.poseBoneCount,
      usedActiveFallback,
    };
  }

  return {
    /**
     * Applies a batch of VPD files.
     * @param {File[]} files - VPD files.
     * @param {object} [settings={}] - Apply settings.
     * @returns {Promise<object[]>} Apply results.
     */
    async applyVpdFiles(files, settings = {}) {
      const results = [];
      for (const file of Array.isArray(files) ? files : []) {
        if (file) {
          results.push(await loadVpdFile(file, settings));
        }
      }
      return results;
    },
    loadVpdFile,
    /**
     * Loads a VPD file and refreshes the scene when applied.
     * @param {File} file - VPD file.
     * @returns {Promise<object>} Apply result.
     */
    async loadVpd(file) {
      const result = await loadVpdFile(file);
      if (result?.applied) {
        options.refreshScene?.();
      }
      return result;
    },
    /**
     * Loads a model file via the model lifecycle service.
     * @param {File} file - Model file.
     * @returns {Promise<object>} Loaded instance.
     */
    async loadModelFile(file) {
      options.beforeLoadModelFile?.();
      return options.modelLifecycleService.addModelFromFile(file);
    },
    /**
     * Loads models and motions from ZIP-like entries.
     * @param {object} zipFiles - ZIP entries.
     * @returns {Promise<void>}
     */
    async loadZipModel(zipFiles) {
      const modelFiles = Object.keys(zipFiles).filter((filePath) => {
        const lower = filePath.toLowerCase();
        return (
          (lower.endsWith('.pmx') || lower.endsWith('.pmd') || lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.endsWith('.vrm'))
          && !lower.includes('__macosx')
        );
      });
      for (const modelFile of modelFiles) {
        await options.modelLifecycleService.addModel({
          zipFiles,
          modelPath: '',
          modelFile,
        });
      }

      await options.vmdManager.loadFromZip(zipFiles);
      const vpdFiles = await collectVpdFilesFromZipFiles(zipFiles);
      if (vpdFiles.length > 0) {
        await this.applyVpdFiles(vpdFiles);
      }
      options.updateVmdListUI?.();
      options.updateActiveMorphIndices?.();

      const bgmManager = options.getBgmManager?.() ?? null;
      if (bgmManager) {
        const audioFiles = await collectPlayableAudioFilesFromZipFiles(zipFiles);
        if (audioFiles.length === 1) {
          await bgmManager.loadFile(audioFiles[0]);
        } else if (audioFiles.length > 1) {
          await bgmManager.setCandidateFiles(audioFiles);
        }
      }

      options.modelLifecycleService.syncTimelineRuntimeState?.();
      options.refreshScene?.();
    },
    /**
     * Loads a VMD, VRMA, or VPD file.
     * @param {File} file - Animation or pose file.
     * @returns {Promise<object>} Load result.
     */
    async loadVmd(file) {
      const fileName = String(file?.name || '');
      const lowerFileName = fileName.toLowerCase();
      if (isVpdFileName(fileName)) {
        const result = await loadVpdFile(file);
        if (result?.applied) {
          options.refreshScene?.();
        }
        return result;
      }

      const loadedAnimation = await options.vmdManager.loadVmd(file);
      if (lowerFileName.endsWith('.vrma')) {
        const activeInstance = options.modelManager.instances[options.selection.activeInstanceIndex] || null;
        const autoAssignTarget = activeInstance?.model?.magic === 'Vrm'
          ? activeInstance
          : options.modelManager.instances.find((inst) => inst?.model?.magic === 'Vrm') || null;
        if (autoAssignTarget) {
          options.playbackRuntimeService?.assignAnimationSourceToInstance?.(autoAssignTarget, {
            ...(loadedAnimation || {}),
            kind: 'vrma',
            name: file.name,
          });
        }
      } else {
        const loadedSources = Array.isArray(loadedAnimation) ? loadedAnimation : [];
        const modelSource = loadedSources.find((source) => source?.targetType === 'model') || null;
        if (modelSource) {
          options.modelManager.instances.forEach((inst) => {
            if (!inst.vmd && inst.model.name && file.name.includes(inst.model.name)) {
              options.playbackRuntimeService?.assignAnimationSourceToInstance?.(inst, modelSource);
            }
          });
        }
        for (const targetType of ['camera', 'light', 'shadow']) {
          const sceneSource = loadedSources.find((source) => source?.targetType === targetType) || null;
          if (sceneSource) {
            options.playbackRuntimeService?.assignSceneAnimationSource?.(targetType, sceneSource);
            options.vmdManager.selectedListValue = `vmd:${targetType}:${sceneSource.name}`;
          }
        }
      }
      options.updateVmdListUI?.();
      options.updateActiveMorphIndices?.();
      options.modelLifecycleService.syncTimelineRuntimeState?.();
      return loadedAnimation;
    },
  };
}
