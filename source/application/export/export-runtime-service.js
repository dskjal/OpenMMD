/**
 * Creates a runtime helper for video export operations.
 * @param {object} options - Service options.
 * @returns {object} Export runtime service.
 */
export function createExportRuntimeService(options) {
  const selectionOverlayPort = options.selectionOverlayPort ?? null;
  /**
   * Returns the active playback controller.
   * @returns {object|null} Playback controller.
   */
  function getPlaybackController() {
    return options.playbackRuntimeService?.getPlaybackController?.() ?? null;
  }

  /**
   * Returns the current playback range.
   * @returns {{start: number, end: number|null}} Playback range.
   */
  function getPlaybackRange() {
    return options.playbackRuntimeService?.getPlaybackRange?.() ?? { start: 0, end: null };
  }

  /**
   * Returns the active model instance.
   * @returns {object|null} Active instance.
   */
  function getActiveInstance() {
    return options.getActiveInstance?.() ?? null;
  }

  /**
   * Returns the current frame.
   * @returns {number} Current frame.
   */
  function getCurrentFrame() {
    return options.playbackRuntimeService?.getCurrentFrame?.(getActiveInstance()) ?? 0;
  }

  /**
   * Returns the maximum exportable frame for the active context.
   * @returns {number} Max frame.
   */
  function getMaxFrame() {
    return options.playbackRuntimeService?.getMaxFrame?.(getActiveInstance()) ?? 0;
  }

  /**
   * Seeks playback to a frame while preserving manual edits.
   * @param {number} frame - Target frame.
   */
  function seek(frame) {
    options.playbackRuntimeService?.seek?.(frame, { keepManualValues: true });
  }

  /**
   * Stops playback.
   */
  function stop() {
    options.playbackRuntimeService?.stop?.();
  }

  /**
   * Starts playback.
   */
  function play() {
    options.playbackRuntimeService?.play?.();
  }

  /**
   * Refreshes the current scene.
   * @param {number} step - Physics / animation step.
   */
  function refreshFrame(step) {
    options.refreshScene?.({ step });
  }

  /**
   * Waits for the next animation frame.
   * @returns {Promise<void>} Wait promise.
   */
  function waitForNextFrame() {
    const requestAnimationFrame = options.requestAnimationFrame
      ?? globalThis.window?.requestAnimationFrame
      ?? null;
    if (typeof requestAnimationFrame !== 'function') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  /**
   * Waits until pending GPU work has completed.
   * @returns {Promise<void>} Wait promise.
   */
  function waitForGpuIdle() {
    return options.waitForGpuIdle?.() ?? Promise.resolve();
  }

  /**
   * Captures the current export-relevant UI and playback state.
   * @returns {object} State snapshot.
   */
  function snapshotExportState() {
    const playbackController = getPlaybackController();
    return {
      renderingFPS: options.rendererState?.renderingFPS,
      internalResolution: options.rendererState?.internalResolution,
      needsResize: options.rendererState?.needsResize,
      showCascadeShadowMaps: options.rendererState?.showCascadeShadowMaps,
      transparentVideoExportBackground: Boolean(options.rendererState?.transparentVideoExportBackground),
      ...selectionOverlayPort?.getState?.(),
      currentFrame: Number.isFinite(playbackController?.currentFrame) ? playbackController.currentFrame : 0,
      wasPlaying: Boolean(playbackController?.isPlaying),
      canvasWidth: options.canvas?.width ?? 0,
      canvasHeight: options.canvas?.height ?? 0,
    };
  }

  /**
   * Applies temporary export state.
   * @param {number} width - Export width.
   * @param {number} height - Export height.
   * @param {boolean} [transparentBackground=false] - 背景透過出力かどうか。
   */
  function prepareExportState(width, height, transparentBackground = false) {
    const rendererState = options.rendererState;
    if (!rendererState) {
      return;
    }

    rendererState.isVideoExporting = true;
    rendererState.transparentVideoExportBackground = transparentBackground === true;
    rendererState.renderingFPS = 0;
    rendererState.showCascadeShadowMaps = false;
    rendererState.needsResize = true;
    rendererState.internalResolution = `${width}x${height}`;

    selectionOverlayPort?.applyState?.({
      showBones: false,
      showPhysics: false,
      showGridXZ: false,
      showGridXY: false,
      showGridYZ: false,
      hideIkBones: true,
    });

    stop();
    options.canvasTargets?.resize?.(rendererState.msaaSampleCount, rendererState.internalResolution);
    refreshFrame(0);
  }

  /**
   * Restores export state after capture completes.
   * @param {object} snapshot - Previously captured snapshot.
   */
  function restoreExportState(snapshot) {
    const rendererState = options.rendererState;
    if (!rendererState) {
      return;
    }

    rendererState.isVideoExporting = false;
    rendererState.transparentVideoExportBackground = snapshot.transparentVideoExportBackground === true;
    rendererState.renderingFPS = snapshot.renderingFPS;
    rendererState.internalResolution = snapshot.internalResolution;
    rendererState.showCascadeShadowMaps = snapshot.showCascadeShadowMaps;
    rendererState.needsResize = true;
    options.canvasTargets?.resize?.(rendererState.msaaSampleCount, rendererState.internalResolution);

    selectionOverlayPort?.applyState?.({
      showBones: snapshot.showBones,
      showBoneAxes: snapshot.showBoneAxes,
      showPhysics: snapshot.showPhysics,
      disablePhysics: snapshot.disablePhysics,
      hideIkBones: snapshot.hideIkBones,
      hideSpringBones: snapshot.hideSpringBones,
      showGridXZ: snapshot.showGridXZ,
      showGridXY: snapshot.showGridXY,
      showGridYZ: snapshot.showGridYZ,
    });

    seek(snapshot.currentFrame);
    if (snapshot.wasPlaying) {
      play();
    } else {
      stop();
    }
    refreshFrame(0);
  }

  return {
    getActiveInstance,
    getPlaybackController,
    getPlaybackRange,
    getCurrentFrame,
    getMaxFrame,
    seek,
    stop,
    play,
    refreshFrame,
    waitForNextFrame,
    waitForGpuIdle,
    snapshotExportState,
    prepareExportState,
    restoreExportState,
  };
}
