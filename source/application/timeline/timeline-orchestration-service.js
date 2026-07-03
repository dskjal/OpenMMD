/**
 * Creates the timeline orchestration service.
 * @param {object} options - Service options.
 * @returns {object} Timeline orchestration service.
 */
export function createTimelineOrchestrationService(options) {
  /**
   * Returns the current timeline manager.
   * @returns {object|null} Timeline manager.
   */
  function getTimelineManager() {
    return options.getTimelineManager?.() ?? options.timelineManager ?? null;
  }

  /**
   * Returns the current BGM manager.
   * @returns {object|null} BGM manager.
   */
  function getBgmManager() {
    return options.getBgmManager?.() ?? options.bgmManager ?? null;
  }

  /**
   * Normalizes animation selection info from the UI.
   * @param {object} [selectionInfo={}] - Raw selection info.
   * @returns {{kind: string, targetType: string, name: string, index: number|null}} Normalized selection info.
   */
  function normalizeAnimationSelectionInfo(selectionInfo = {}) {
    const indexValue = selectionInfo?.index;
    const parsedIndex = indexValue === null || indexValue === undefined || indexValue === ''
      ? null
      : Number.parseInt(String(indexValue), 10);
    return {
      kind: String(selectionInfo?.kind || '').trim(),
      targetType: String(selectionInfo?.targetType || 'model').trim() || 'model',
      name: String(selectionInfo?.name || '').trim(),
      index: Number.isInteger(parsedIndex) ? parsedIndex : null,
    };
  }

  /**
   * Formats animation selection info as a list value.
   * @param {object} selectionInfo - Normalized selection info.
   * @returns {string} Serialized list value.
   */
  function formatAnimationSelectionValue(selectionInfo) {
    const info = normalizeAnimationSelectionInfo(selectionInfo);
    if (!info.kind) {
      return '';
    }
    const suffix = info.kind === 'gltf' && info.index !== null
      ? String(info.index)
      : info.name;
    return `${info.kind}:${info.targetType}:${suffix}`;
  }

  /**
   * Synchronizes BGM with the active playback state.
   * @param {boolean} [forceSeek=false] - Whether to force seek.
   */
  function syncBgmPlayback(forceSeek = false) {
    getBgmManager()?.syncFromActivePlayback?.({ forceSeek });
  }

  /**
   * Runs common side effects after a timeline mutation.
   * @param {object} [settings={}] - Side-effect settings.
   * @param {boolean} [settings.syncBgm=false] - Whether to sync BGM.
   * @param {boolean} [settings.refreshScene=false] - Whether to refresh the scene.
   * @param {boolean} [settings.refreshVmdList=false] - Whether to refresh the animation list UI.
   */
  function runTimelineSideEffects(settings = {}) {
    if (settings.refreshVmdList) {
      options.updateVmdListUI?.();
    }
    options.updateActiveMorphIndices?.();
    options.syncAnimationMappingTabUi?.();
    options.syncPlaybackRangeUi?.();
    if (settings.syncBgm) {
      syncBgmPlayback(true);
    }
    if (settings.refreshScene) {
      options.refreshScene?.(settings.refreshSceneOptions);
    }
  }

  return {
    normalizeAnimationSelectionInfo,
    formatAnimationSelectionValue,
    syncBgmPlayback,
    /**
     * Returns the current playback range.
     * @returns {{start: number, end: number|null}|undefined} Playback range.
     */
    getPlaybackRange() {
      return getTimelineManager()?.getPlaybackRange?.();
    },
    /**
     * Returns the current playback controller.
     * @returns {object|null|undefined} Playback controller.
     */
    getPlaybackController() {
      return getTimelineManager()?.getPlaybackController?.();
    },
    /**
     * Returns the current frame for the active playback context.
     * @returns {number} Current frame.
     */
    getCurrentFrame() {
      const playbackController = getTimelineManager()?.getPlaybackController?.() ?? null;
      if (Number.isFinite(playbackController?.currentFrame)) {
        return playbackController.currentFrame;
      }
      const activeInstance = options.getActiveInstance?.()
        ?? options.modelManager?.instances?.[options.selection?.activeInstanceIndex]
        ?? null;
      return activeInstance?.animationController?.currentFrame ?? 0;
    },
    /**
     * Returns a scene animation source.
     * @param {'camera'|'light'|'shadow'} targetType - Scene animation type.
     * @returns {object|null} Scene animation source.
     */
    getSceneAnimationSource(targetType) {
      return getTimelineManager()?.getSceneAnimationSource?.(targetType) || null;
    },
    /**
     * Toggles playback.
     */
    togglePlayback() {
      getTimelineManager()?.togglePlayback?.();
      syncBgmPlayback(true);
      options.refreshScene?.({ step: 0 });
    },
    /**
     * Starts playback.
     */
    play() {
      getTimelineManager()?.play?.();
      syncBgmPlayback(true);
    },
    /**
     * Pauses playback.
     */
    pause() {
      getTimelineManager()?.stop?.();
      syncBgmPlayback(true);
    },
    /**
     * Rewinds playback.
     */
    rewind() {
      getTimelineManager()?.rewind?.();
      syncBgmPlayback(true);
    },
    /**
     * Moves to the playback end.
     */
    goToEnd() {
      getTimelineManager()?.goToEnd?.();
      syncBgmPlayback(true);
    },
    /**
     * Seeks to a frame.
     * @param {...unknown} args - Seek arguments.
     */
    seek(...args) {
      return getTimelineManager()?.seek?.(...args);
    },
    /**
     * Steps frames.
     * @param {...unknown} args - Step arguments.
     */
    stepFrame(...args) {
      getTimelineManager()?.stepFrame?.(...args);
      syncBgmPlayback(true);
    },
    /**
     * Steps keyframes.
     * @param {...unknown} args - Step arguments.
     */
    stepKeyframe(...args) {
      getTimelineManager()?.stepKeyframe?.(...args);
      syncBgmPlayback(true);
    },
    /**
     * Sets the playback range.
     * @param {...unknown} args - Range arguments.
     */
    setPlaybackRange(...args) {
      return getTimelineManager()?.setPlaybackRange?.(...args);
    },
    /**
     * Registers a bone keyframe on the active animation source.
     * @param {...unknown} args - Registration arguments.
     * @returns {boolean} True when registered.
     */
    registerBoneKeyframe(...args) {
      const timelineManager = getTimelineManager();
      if (!timelineManager?.registerBoneKeyframe) {
        return false;
      }
      timelineManager.registerBoneKeyframe(...args);
      runTimelineSideEffects();
      return true;
    },
    /**
     * Registers a camera keyframe on the scene animation source.
     * @param {...unknown} args - Registration arguments.
     * @returns {boolean} True when registered.
     */
    registerCameraKeyframe(...args) {
      const timelineManager = getTimelineManager();
      if (!timelineManager?.registerCameraKeyframe) {
        return false;
      }
      timelineManager.registerCameraKeyframe(...args);
      runTimelineSideEffects({ syncBgm: true });
      return true;
    },
    /**
     * Registers a light keyframe on the scene animation source.
     * @param {...unknown} args - Registration arguments.
     * @returns {boolean} True when registered.
     */
    registerLightKeyframe(...args) {
      const timelineManager = getTimelineManager();
      if (!timelineManager?.registerLightKeyframe) {
        return false;
      }
      timelineManager.registerLightKeyframe(...args);
      runTimelineSideEffects({ syncBgm: true });
      return true;
    },
    /**
     * Assigns a VMD to the active instance.
     * @param {...unknown} args - Assignment arguments.
     */
    assignVmdToActiveInstance(...args) {
      getTimelineManager()?.assignVmdToActiveInstance?.(...args);
      runTimelineSideEffects();
    },
    /**
     * Assigns an animation source to the active instance.
     * @param {...unknown} args - Assignment arguments.
     */
    assignAnimationSourceToActiveInstance(...args) {
      getTimelineManager()?.assignAnimationSourceToActiveInstance?.(...args);
      runTimelineSideEffects();
    },
    /**
     * Selects an animation source for the active context.
     * @param {object} selectionInfo - Animation selection info.
     * @returns {object} Normalized selection info.
     */
    selectAnimationSource(selectionInfo) {
      const info = normalizeAnimationSelectionInfo(selectionInfo);
      if (options.vmdManager) {
        options.vmdManager.selectedListValue = formatAnimationSelectionValue(info);
      }

      const timelineManager = getTimelineManager();
      if (!timelineManager) {
        return info;
      }

      if (!info.kind) {
        this.assignAnimationSourceToActiveInstance(null);
      } else if (info.kind === 'vmd' && info.targetType !== 'model') {
        const source = options.vmdManager?.getSceneVmdSource?.(info.targetType, info.name) || null;
        timelineManager.assignSceneAnimationSource?.(info.targetType, source);
        runTimelineSideEffects({ syncBgm: true });
      } else if (info.kind === 'vmd') {
        const vmd = options.vmdManager?.vmds?.get?.(info.name) || null;
        this.assignAnimationSourceToActiveInstance(vmd ? {
          kind: 'vmd',
          name: info.name,
          data: vmd,
          targetType: 'model',
        } : null);
      } else if (info.kind === 'vrma') {
        const vrma = options.vmdManager?.vrmas?.get?.(info.name) || null;
        this.assignAnimationSourceToActiveInstance(vrma ? {
          ...vrma,
          kind: 'vrma',
          name: info.name,
          targetType: 'model',
        } : null);
      } else if (info.kind === 'gltf') {
        const activeInstance = options.getActiveInstance?.()
          ?? options.modelManager?.instances?.[options.selection?.activeInstanceIndex]
          ?? null;
        const source = info.index !== null
          ? activeInstance?.gltfAnimationSources?.[info.index] || null
          : null;
        this.assignAnimationSourceToActiveInstance(source);
      }

      runTimelineSideEffects({ syncBgm: true });
      return info;
    },
    /**
     * Removes an animation source.
     * @param {object} selectionInfo - Animation selection info.
     * @returns {boolean} True when removed.
     */
    removeAnimationSource(selectionInfo) {
      const info = normalizeAnimationSelectionInfo(selectionInfo);
      if (!info.name || (info.kind !== 'vmd' && info.kind !== 'vrma')) {
        return false;
      }

      const removed = options.vmdManager?.removeAnimation?.(info.kind, info.name, info.targetType) ?? false;
      if (!removed) {
        return false;
      }

      const timelineManager = getTimelineManager();
      if (info.targetType === 'model') {
        timelineManager?.assignAnimationSourceToActiveInstance?.(null);
      } else {
        timelineManager?.assignSceneAnimationSource?.(info.targetType, null);
      }

      if (options.vmdManager && options.vmdManager.selectedListValue === formatAnimationSelectionValue(info)) {
        options.vmdManager.selectedListValue = '';
      }

      runTimelineSideEffects({ refreshVmdList: true, refreshScene: true });
      return true;
    },
    /**
     * Deletes the selected keyframes.
     * @returns {boolean} True when something changed.
     */
    deleteSelectedKeyframes() {
      return getTimelineManager()?.deleteSelectedKeyframes?.() ?? false;
    },
    /**
     * Registers a morph keyframe.
     * @param {string} name - Morph name.
     * @param {number} weight - Morph weight.
     * @returns {unknown} Handler result.
     */
    registerMorphKeyframe(name, weight) {
      const result = getTimelineManager()?.registerMorphKeyframe?.(name, weight);
      options.updateActiveMorphIndices?.();
      return result;
    },
  };
}
