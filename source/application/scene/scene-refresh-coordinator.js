import { applyCameraManualFov, applyCameraManualPose } from '../../core/scene/camera.js';

/**
 * Creates the scene refresh coordinator.
 * @param {object} options - Coordinator options.
 * @returns {{refreshScene: function, syncTimelineUi: function}} Scene refresh coordinator.
 */
export function createSceneRefreshCoordinator(options) {
  /**
   * Syncs timeline UI state from the shared timeline manager.
   */
  function syncTimelineUi() {
    options.playbackRuntimeService?.syncTimelineUi?.();
  }

  /**
   * Refreshes the runtime scene and dependent UI.
   * @param {object} [refreshOptions={}] - Refresh options.
   * @param {number} [refreshOptions.step=1] - Physics / playback step.
   */
  function refreshScene(refreshOptions = {}) {
    const step = Number.isFinite(refreshOptions?.step) ? refreshOptions.step : 1;
    const activeInstance = options.getActiveInstance?.() ?? null;
    const currentFrame = activeInstance?.animationController?.currentFrame ?? 0;

    options.cameraService?.applyMotionFromActiveInstance?.(activeInstance);
    options.lightService?.applyMotionFromActiveInstance?.(activeInstance);

    if (options.camera) {
      applyCameraManualFov(options.camera, currentFrame);
      applyCameraManualPose(options.camera, currentFrame);
    }

    options.updateSceneState?.(step);
    const bgmManager = options.getBgmManager?.() ?? options.bgmManager ?? null;
    bgmManager?.syncFromActivePlayback?.();
    options.syncInspectorUi?.();
    syncTimelineUi();
  }

  return {
    refreshScene,
    syncTimelineUi,
  };
}
