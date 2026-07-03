/**
 * Creates a playback runtime service that isolates direct timeline manager access.
 * @param {object} options - Service options.
 * @returns {object} Playback runtime service.
 */
export function createPlaybackRuntimeService(options) {
  /**
   * Returns the active timeline manager.
   * @returns {object|null} Timeline manager.
   */
  function getTimelineManager() {
    return options.getTimelineManager?.() ?? options.timelineManager ?? null;
  }

  /**
   * Returns the active playback range with normalized defaults.
   * @returns {{start: number, end: number|null}} Playback range.
   */
  function getNormalizedPlaybackRange() {
    const playbackRange = getTimelineManager()?.getPlaybackRange?.() ?? null;
    return {
      start: Number.isFinite(playbackRange?.start) ? playbackRange.start : 0,
      end: Number.isFinite(playbackRange?.end) ? playbackRange.end : null,
    };
  }

  /**
   * Synchronizes playback range UI.
   */
  function syncPlaybackRangeUi() {
    options.syncPlaybackRangeUi?.(getNormalizedPlaybackRange());
  }

  return {
    getTimelineManager,
    /**
     * Returns the current playback controller.
     * @returns {object|null} Playback controller.
     */
    getPlaybackController() {
      return getTimelineManager()?.getPlaybackController?.() ?? null;
    },
    /**
     * Returns the current playback range.
     * @returns {{start: number, end: number|null}|undefined} Playback range.
     */
    getPlaybackRange() {
      return getNormalizedPlaybackRange();
    },
    /**
     * Returns the active playback frame.
     * @param {object|null} [activeInstance=null] - Active instance fallback.
     * @returns {number} Current frame.
     */
    getCurrentFrame(activeInstance = null) {
      const playbackController = getTimelineManager()?.getPlaybackController?.() ?? null;
      if (Number.isFinite(playbackController?.currentFrame)) {
        return playbackController.currentFrame;
      }
      return activeInstance?.animationController?.currentFrame ?? 0;
    },
    /**
     * Builds a playback snapshot for model animation updates.
     * @param {number} [step=1] - Playback step.
     * @returns {object} Animation update state.
     */
    getAnimationUpdateState(step = 1) {
      const timelineManager = getTimelineManager();
      timelineManager?.advancePlayback?.(step);
      if (!timelineManager) {
        return {};
      }
      return {
        currentFrame: timelineManager.currentFrame,
        isPlaying: timelineManager.isPlaying,
        playbackRangeStart: timelineManager.playbackRangeStart,
        playbackRangeEnd: timelineManager.playbackRangeEnd,
        jumped: timelineManager.jumped,
        lastFrameTime: timelineManager.lastFrameTime,
        skipPlaybackAdvance: true,
      };
    },
    /**
     * Returns the maximum frame for the current playback context.
     * @param {object|null} [activeInstance=null] - Active instance fallback.
     * @returns {number} Max frame.
     */
    getMaxFrame(activeInstance = null) {
      const timelineMaxFrame = getTimelineManager()?.getMaxFrame?.();
      if (Number.isFinite(timelineMaxFrame)) {
        return timelineMaxFrame;
      }
      return activeInstance?.animationController?.maxFrame ?? 0;
    },
    /**
     * Starts playback.
     */
    play() {
      getTimelineManager()?.play?.();
    },
    /**
     * Stops playback.
     */
    stop() {
      getTimelineManager()?.stop?.();
    },
    /**
     * Seeks to a frame.
     * @param {number} frame - Target frame.
     * @param {object} [settings] - Seek settings.
     */
    seek(frame, settings) {
      getTimelineManager()?.seek?.(frame, settings);
    },
    /**
     * Rewinds playback.
     */
    rewind() {
      getTimelineManager()?.rewind?.();
    },
    /**
     * Moves to the playback end.
     */
    goToEnd() {
      getTimelineManager()?.goToEnd?.();
    },
    /**
     * Updates the active playback instance.
     * @param {number} index - Active instance index.
     */
    setActiveInstance(index) {
      getTimelineManager()?.setActiveInstance?.(index);
      syncPlaybackRangeUi();
      this.syncTimelineUi();
    },
    /**
     * Refreshes timeline UI state.
     */
    syncTimelineUi() {
      getTimelineManager()?.syncViewState?.();
    },
    /**
     * Rebuilds timeline sources after model or animation changes.
     */
    rebuildTimelineSource() {
      getTimelineManager()?.rebuildTimelineSource?.();
    },
    /**
     * Synchronizes timeline runtime state after a source or lifecycle change.
     */
    syncTimelineRuntimeState() {
      this.rebuildTimelineSource();
      syncPlaybackRangeUi();
      this.syncTimelineUi();
    },
    /**
     * Assigns an animation source to a model instance.
     * @param {object|null} instance - Target instance.
     * @param {object|null} source - Source to assign.
     */
    assignAnimationSourceToInstance(instance, source) {
      getTimelineManager()?.assignAnimationSourceToInstance?.(instance, source);
    },
    /**
     * Assigns a scene animation source.
     * @param {'camera'|'light'|'shadow'} targetType - Scene target type.
     * @param {object|null} source - Source to assign.
     */
    assignSceneAnimationSource(targetType, source) {
      getTimelineManager()?.assignSceneAnimationSource?.(targetType, source);
    },
  };
}
