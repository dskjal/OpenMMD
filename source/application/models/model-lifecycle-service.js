import {
  resolveDefaultSelectedBoneIndex,
  resetSelectionForInstanceChange,
  setSingleBoneSelection,
} from '../../core/selection/renderer-selection.js';

/**
 * Removes a model instance and synchronizes dependent UI/runtime state.
 * @param {object} options - Removal options.
 * @param {object} options.modelManager - Model manager.
 * @param {object} options.physicsEngine - Physics engine.
 * @param {object} options.vmdManager - VMD manager.
 * @param {object} options.selection - Selection state.
 * @param {function(): void} [options.refreshScene] - Scene refresh callback.
 * @param {function(object, object): void} [options.renderMorphUi] - Morph UI render callback.
 * @param {function(): void} [options.clearMorphUi] - Morph UI clear callback.
 * @param {function(): void} [options.syncMaterialTabUi] - Material sync callback.
 * @param {object} options.playbackRuntimeService - Playback runtime service.
 * @param {function(): void} [options.updateActiveMorphIndices] - Morph sync callback.
 * @param {function(object, object, object=): void} [options.updateModelListUI] - Model list update callback.
 * @param {function(object, object, object, object=): void} [options.updateVmdListUI] - VMD list update callback.
 * @param {function(): object} [options.getLangData] - Language data getter.
 * @param {function(): void} [options.syncAnimationMappingTabUi] - Animation mapping sync callback.
 * @param {number} index - Model index.
 */
export function removeModelAtIndex(options, index) {
  const {
    modelManager,
    physicsEngine,
    vmdManager,
    selection,
    refreshScene,
    renderMorphUi,
    clearMorphUi,
    syncMaterialTabUi,
    playbackRuntimeService,
    updateActiveMorphIndices,
    updateModelListUI: refreshModelListUI,
    updateVmdListUI: refreshVmdListUI,
    getLangData,
    syncAnimationMappingTabUi,
  } = options;

  if (!Number.isInteger(index) || index < 0 || index >= modelManager.instances.length) {
    return;
  }

  const previousActiveIndex = selection.activeInstanceIndex;
  const previousActiveInstance = modelManager.instances[previousActiveIndex] ?? null;

  modelManager.removeModel(index, physicsEngine);

  if (modelManager.instances.length === 0) {
    selection.activeInstanceIndex = -1;
  } else if (previousActiveIndex < 0) {
    selection.activeInstanceIndex = Math.min(index, modelManager.instances.length - 1);
  } else if (index < previousActiveIndex) {
    selection.activeInstanceIndex = previousActiveIndex - 1;
  } else if (index === previousActiveIndex) {
    selection.activeInstanceIndex = Math.min(index, modelManager.instances.length - 1);
  }

  const nextActiveInstance = modelManager.instances[selection.activeInstanceIndex] ?? null;
  const activeChanged = nextActiveInstance !== previousActiveInstance;

  if (activeChanged) {
    resetSelectionForInstanceChange(selection);

    if (nextActiveInstance) {
      const defaultBoneIndex = resolveDefaultSelectedBoneIndex(nextActiveInstance?.model);
      if (defaultBoneIndex !== -1) {
        setSingleBoneSelection(selection, defaultBoneIndex);
      }
      renderMorphUi?.(nextActiveInstance.model, nextActiveInstance.morphController);
    } else {
      clearMorphUi?.();
    }
  }

  refreshModelListUI?.(modelManager, selection, getLangData?.());
  refreshVmdListUI?.(vmdManager, modelManager, selection, getLangData?.());
  updateActiveMorphIndices?.();
  syncMaterialTabUi?.();
  options.syncTimelineRuntimeState?.() ?? playbackRuntimeService?.syncTimelineRuntimeState?.();
  syncAnimationMappingTabUi?.();
  refreshScene?.();
}

/**
 * Creates the model lifecycle service.
 * @param {object} options - Service options.
 * @returns {object} Model lifecycle service.
 */
export function createModelLifecycleService(options) {
  /**
   * Synchronizes timeline-related UI after lifecycle changes.
   */
  function syncTimelineRuntimeState() {
    options.syncTimelineRuntimeState?.() ?? options.playbackRuntimeService?.syncTimelineRuntimeState?.();
  }

  /**
   * Assigns a matching VMD source to a newly loaded model instance.
   * @param {object|null} instance - Model instance.
   */
  function autoAssignMatchingVmd(instance) {
    const modelName = String(instance?.model?.name || '');
    if (!options.playbackRuntimeService || !modelName) {
      return;
    }

    const vmdMatch = Array.from(options.vmdManager?.vmds?.keys?.() ?? [])
      .find((name) => name.includes(modelName));
    if (!vmdMatch) {
      return;
    }

    options.playbackRuntimeService.assignAnimationSourceToInstance?.(instance, {
      kind: 'vmd',
      name: vmdMatch,
      data: options.vmdManager.vmds.get(vmdMatch),
    });
  }

  /**
   * Runs common post-load UI synchronization.
   * @param {object|null} instance - Loaded instance.
   */
  function finalizeLoadedModelInstance(instance) {
    if (!instance) {
      return;
    }
    options.syncAnimationMappingTabUi?.();
    syncTimelineRuntimeState();
  }

  /**
   * Synchronizes UI after the active instance changes.
   * @param {object|null} instance - Active instance.
   */
  function syncActiveInstanceUi(instance) {
    options.updateModelListUi?.();
    options.updateVmdListUI?.();
    options.updateActiveMorphIndices?.();
    options.syncMaterialTabUi?.();
    options.syncAnimationMappingTabUi?.();
    if (!instance) {
      return;
    }
    options.selectDefaultBoneForInstance?.(instance);
    options.renderMorphUi?.(instance.model, instance.morphController);
  }

  return {
    syncTimelineRuntimeState,
    finalizeLoadedModelInstance,
    /**
     * Loads a bundled or ZIP-contained model.
     * @param {object} [params={}] - Load parameters.
     * @param {object|null} [params.zipFiles=null] - ZIP entries.
     * @param {string} [params.modelPath=''] - Base model path.
     * @param {string} [params.modelFile=''] - Model file name.
     * @returns {Promise<object>} Loaded instance.
     */
    async addModel({ zipFiles = null, modelPath = '', modelFile = '' } = {}) {
      const instance = await options.modelManager.addModel(
        zipFiles,
        options.unitScale,
        modelPath,
        modelFile,
      );
      options.physicsEngine?.addModel?.(instance.model, instance.scene);
      autoAssignMatchingVmd(instance);

      options.selection.activeInstanceIndex = options.modelManager.instances.length - 1;
      resetSelectionForInstanceChange(options.selection);
      syncActiveInstanceUi(instance);
      finalizeLoadedModelInstance(instance);
      return instance;
    },
    /**
     * Loads a model from a file object.
     * @param {File} file - Model file.
     * @returns {Promise<object>} Loaded instance.
     */
    async addModelFromFile(file) {
      const instance = await options.modelManager.addModelFile(file, options.unitScale);
      if (instance.model?.rigidBodies?.length > 0) {
        options.physicsEngine?.addModel?.(instance.model, instance.scene);
      }
      autoAssignMatchingVmd(instance);

      options.selection.activeInstanceIndex = options.modelManager.instances.length - 1;
      resetSelectionForInstanceChange(options.selection);
      syncActiveInstanceUi(instance);
      finalizeLoadedModelInstance(instance);
      return instance;
    },
    /**
     * Activates a model instance.
     * @param {number} index - Instance index.
     */
    activateInstance(index) {
      if (options.selection.activeInstanceIndex === index) {
        return;
      }

      options.selection.activeInstanceIndex = index;
      options.clearWorldRotationDisplay?.();
      resetSelectionForInstanceChange(options.selection);

      const instance = options.getActiveInstance?.() ?? null;
      syncActiveInstanceUi(instance);

      options.playbackRuntimeService?.setActiveInstance?.(index);
    },
    /**
     * Removes the active model instance.
     */
    removeActiveModel() {
      this.removeModelAtIndex(options.selection.activeInstanceIndex);
    },
    /**
     * Removes a model instance by index.
     * @param {number} index - Model index.
     */
    removeModelAtIndex(index) {
      removeModelAtIndex({
        modelManager: options.modelManager,
        physicsEngine: options.physicsEngine,
        vmdManager: options.vmdManager,
        selection: options.selection,
        refreshScene: options.refreshScene,
        renderMorphUi: options.renderMorphUi,
        clearMorphUi: options.clearMorphUi,
        syncMaterialTabUi: options.syncMaterialTabUi,
        playbackRuntimeService: options.playbackRuntimeService,
        updateActiveMorphIndices: options.updateActiveMorphIndices,
        updateModelListUI: options.updateModelListUI,
        updateVmdListUI: options.updateVmdListUI,
        getLangData: options.getLangData,
        syncTimelineRuntimeState: options.syncTimelineRuntimeState,
        syncAnimationMappingTabUi: options.syncAnimationMappingTabUi,
      }, index);
    },
    /**
     * Updates model visibility.
     * @param {number} index - Model index.
     * @param {boolean} [visible] - Explicit visibility state.
     */
    setModelVisibility(index, visible) {
      if (!Number.isInteger(index) || index < 0 || index >= options.modelManager.instances.length) {
        return;
      }
      const instance = options.modelManager.instances[index] ?? null;
      if (!instance) {
        return;
      }

      if (typeof visible === 'boolean') {
        instance.visible = visible;
      } else {
        options.modelManager.toggleInstanceVisible?.(instance);
      }
      options.updateModelListUi?.();
      options.refreshScene?.();
    },
  };
}
