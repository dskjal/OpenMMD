import { buildViewerStateSnapshot } from '../../infrastructure/api/api-state.js';

const READY_POLL_INTERVAL_MS = 50;
const READY_TIMEOUT_MS = 30000;

/**
 * Creates the viewer state service.
 * @param {object} options - Service options.
 * @returns {object} Viewer state service.
 */
export function createViewerStateService(options = {}) {
  /**
   * Returns the current runtime object.
   * @returns {object|null} Runtime object.
   */
  function getRuntime() {
    const ports = typeof options.ports === 'function'
      ? options.ports()
      : options.ports ?? null;
    if (ports?.viewer) {
      return ports.viewer;
    }
    return typeof options.runtime === 'function'
      ? options.runtime()
      : options.runtime ?? null;
  }

  /**
   * Returns the current command registry.
   * @returns {object} Command registry.
   */
  function getCommands() {
    return typeof options.commands === 'function'
      ? options.commands() ?? {}
      : options.commands ?? {};
  }

  /**
   * Returns the current document object.
   * @returns {Document|null} Document object.
   */
  function getDocumentObject() {
    return typeof options.document === 'function'
      ? options.document()
      : options.document ?? null;
  }

  /**
   * Returns the timeout implementation.
   * @returns {(function(function, number): any)|null} Timeout function.
   */
  function getSetTimeoutImpl() {
    return typeof options.setTimeoutImpl === 'function'
      ? options.setTimeoutImpl
      : null;
  }

  /**
   * Returns the monotonic clock function.
   * @returns {(function(): number)|null} Clock function.
   */
  function getNowImpl() {
    return typeof options.nowImpl === 'function'
      ? options.nowImpl
      : null;
  }

  return {
    /**
     * Returns true when the runtime is ready for commands.
     * @param {object} [settings={}] - Readiness settings.
     * @param {boolean} [settings.needsPlayback=false] - Whether playback commands are required.
     * @returns {boolean} True when ready.
     */
    isReady(settings = {}) {
      const commands = getCommands();
      const hasCommonCommands = (
        typeof commands?.loadZipModel === 'function'
        && typeof commands?.loadVmd === 'function'
        && typeof commands?.setEnvironmentHdrPath === 'function'
        && typeof commands?.setEnvironmentHdrIntensity === 'function'
      );
      if (!hasCommonCommands) {
        return false;
      }

      if (!settings.needsPlayback) {
        return true;
      }

      return (
        typeof commands?.getPlaybackRange === 'function'
        && typeof commands?.getPlaybackController === 'function'
      );
    },
    /**
     * Waits for the runtime to become ready.
     * @param {object} [settings={}] - Readiness settings.
     * @param {boolean} [settings.needsPlayback=false] - Whether playback commands are required.
     * @returns {Promise<void>} Completion promise.
     */
    async waitUntilReady(settings = {}) {
      if (this.isReady(settings)) {
        return;
      }

      const setTimeoutImpl = getSetTimeoutImpl();
      const nowImpl = getNowImpl();
      if (typeof setTimeoutImpl !== 'function' || typeof nowImpl !== 'function') {
        throw new Error('Viewer state service requires injected timer adapters.');
      }

      const startedAt = nowImpl();
      while (nowImpl() - startedAt < READY_TIMEOUT_MS) {
        await new Promise((resolve) => {
          setTimeoutImpl(resolve, READY_POLL_INTERVAL_MS);
        });
        if (this.isReady(settings)) {
          return;
        }
      }

      throw new Error('OpenMMD runtime is not ready.');
    },
    /**
     * Returns a serializable viewer-state snapshot.
     * @returns {object} Viewer-state snapshot.
     */
    getViewerState() {
      const runtime = getRuntime();
      const commands = getCommands();
      const documentObject = getDocumentObject();
      if (!runtime) {
        return {
          modelNames: [],
          activeModelName: '',
          activeInstanceIndex: -1,
          isPlaying: false,
          currentFrame: 0,
          playbackRange: {
            start: 0,
            end: null,
          },
          fullscreen: false,
        };
      }

      const playbackController = commands?.getPlaybackController?.() ?? null;
      const playbackRange = commands?.getPlaybackRange?.() ?? { start: 0, end: null };
      const snapshot = buildViewerStateSnapshot(runtime);

      return {
        ...snapshot,
        isPlaying: Boolean(playbackController?.isPlaying),
        currentFrame: Number.isFinite(playbackController?.currentFrame) ? playbackController.currentFrame : 0,
        playbackRange: {
          start: Number.isFinite(playbackRange.start) ? playbackRange.start : 0,
          end: Number.isFinite(playbackRange.end) ? playbackRange.end : null,
        },
        fullscreen: Boolean(documentObject?.fullscreenElement),
      };
    },
  };
}
