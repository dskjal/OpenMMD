import { createViewerStateService } from '../viewer/viewer-state-service.js';
import {
  MESSAGE_NAMESPACE,
  base64ToUint8Array,
  deserializeFilePayload,
  serializeBlobPayload,
} from './openmmd-bridge-protocol.js';

const STATE_SYNC_INTERVAL_MS = 1000;
const SERVER_COMMAND_STREAM_PATH = './api/events';
const SERVER_COMMAND_RESULT_PATH = './api/command-result';
const RUNTIME_STATE_PATH = './api/runtime-state';

/**
 * Resolves browser adapters used by the bridge.
 * @param {object} [options={}] - Bridge options.
 * @returns {object} Normalized environment adapters.
 */
function resolveBridgeEnvironment(options = {}) {
  const windowObject = options.windowObject
    ?? options.window
    ?? globalThis.window
    ?? null;
  const documentObject = options.documentObject
    ?? options.document
    ?? windowObject?.document
    ?? globalThis.document
    ?? null;
  const fetchImpl = options.fetchImpl
    ?? options.fetch
    ?? globalThis.fetch
    ?? null;
  const eventSourceFactory = typeof options.eventSourceFactory === 'function'
    ? options.eventSourceFactory
    : typeof (options.EventSource ?? globalThis.EventSource) === 'function'
      ? (url) => new (options.EventSource ?? globalThis.EventSource)(url)
      : null;
  const setIntervalImpl = options.setIntervalImpl
    ?? windowObject?.setInterval?.bind(windowObject)
    ?? globalThis.setInterval?.bind(globalThis)
    ?? null;
  const setTimeoutImpl = options.setTimeoutImpl
    ?? windowObject?.setTimeout?.bind(windowObject)
    ?? globalThis.setTimeout?.bind(globalThis)
    ?? null;
  const clearIntervalImpl = options.clearIntervalImpl
    ?? windowObject?.clearInterval?.bind(windowObject)
    ?? globalThis.clearInterval?.bind(globalThis)
    ?? null;
  const nowImpl = options.nowImpl
    ?? globalThis.performance?.now?.bind(globalThis.performance)
    ?? Date.now;
  const addWindowEventListener = options.addWindowEventListener
    ?? windowObject?.addEventListener?.bind(windowObject)
    ?? null;
  const removeWindowEventListener = options.removeWindowEventListener
    ?? windowObject?.removeEventListener?.bind(windowObject)
    ?? null;
  const locationOrigin = options.locationOrigin
    ?? windowObject?.location?.origin
    ?? globalThis.location?.origin
    ?? '';

  return {
    windowObject,
    documentObject,
    fetchImpl,
    eventSourceFactory,
    setIntervalImpl,
    setTimeoutImpl,
    clearIntervalImpl,
    nowImpl,
    addWindowEventListener,
    removeWindowEventListener,
    locationOrigin,
  };
}

/**
 * Resolves the base URL for API requests.
 * @param {object} [options={}] - Bridge options.
 * @returns {string} Absolute base URL.
 */
function resolveBridgeBaseUrl(options = {}) {
  const environment = resolveBridgeEnvironment(options);
  return environment.documentObject?.baseURI
    ?? environment.windowObject?.location?.href
    ?? (environment.locationOrigin ? `${environment.locationOrigin}/` : '')
    ?? '';
}

/**
 * Resolves an API URL relative to the current document.
 * @param {string} path - Relative API path.
 * @param {object} [options={}] - Bridge options.
 * @returns {string} Absolute request URL.
 */
function resolveBridgeUrl(path, options = {}) {
  const baseUrl = resolveBridgeBaseUrl(options);
  if (!baseUrl) {
    return path;
  }
  return new URL(path, baseUrl).href;
}

/**
 * Returns the runtime used by the bridge.
 * @param {object} [options={}] - Bridge options.
 * @returns {object|null} Runtime object.
 */
function resolveBridgeRuntime(options = {}) {
  const ports = typeof options.ports === 'function' ? options.ports() : options.ports;
  const runtime = typeof options.runtime === 'function' ? options.runtime() : options.runtime;
  const appContext = typeof options.appContext === 'function' ? options.appContext() : options.appContext;
  const appFacade = typeof options.appFacade === 'function' ? options.appFacade() : options.appFacade;
  const viewerPort = ports?.viewer
    ?? appContext?.ports?.viewer
    ?? appFacade?.ports?.viewer
    ?? null;
  return runtime
    ?? viewerPort
    ?? appContext?.runtime
    ?? appFacade?.runtime
    ?? globalThis.window
    ?? null;
}

/**
 * Returns the command registry used by the bridge.
 * @param {object} [options={}] - Bridge options.
 * @returns {object} Command registry.
 */
function resolveBridgeCommands(options = {}) {
  const commands = typeof options.commands === 'function' ? options.commands() : options.commands;
  const appContext = typeof options.appContext === 'function' ? options.appContext() : options.appContext;
  const appFacade = typeof options.appFacade === 'function' ? options.appFacade() : options.appFacade;
  return commands
    ?? appContext?.commands
    ?? appFacade?.commands
    ?? {};
}

/**
 * Returns the viewer state service used by the bridge.
 * @param {object} [options={}] - Bridge options.
 * @returns {object} Viewer state service.
 */
function resolveViewerStateService(options = {}) {
  const viewerStateService = typeof options.viewerStateService === 'function'
    ? options.viewerStateService()
    : options.viewerStateService;
  if (viewerStateService) {
    return viewerStateService;
  }
  return createViewerStateService({
    ports: () => {
      const ports = typeof options.ports === 'function' ? options.ports() : options.ports;
      if (ports) {
        return ports;
      }
      const appContext = typeof options.appContext === 'function' ? options.appContext() : options.appContext;
      const appFacade = typeof options.appFacade === 'function' ? options.appFacade() : options.appFacade;
      return appContext?.ports ?? appFacade?.ports ?? null;
    },
    runtime: () => resolveBridgeRuntime(options),
    commands: () => resolveBridgeCommands(options),
    document: () => resolveBridgeEnvironment(options).documentObject,
    setTimeoutImpl: (...args) => resolveBridgeEnvironment(options).setTimeoutImpl?.(...args),
    nowImpl: () => resolveBridgeEnvironment(options).nowImpl?.(),
  });
}

/**
 * Serializes a command result for server transport.
 * @param {string} command - Command name.
 * @param {object} result - Command result.
 * @returns {Promise<object>} JSON-safe result.
 */
async function serializeCommandResult(command, result) {
  if (command === 'export-video' && result && typeof result === 'object' && result.blob instanceof Blob) {
    return {
      ...result,
      blob: await serializeBlobPayload(
        result.blob,
        typeof result.filename === 'string' ? result.filename : '',
        typeof result.mimeType === 'string' ? result.mimeType : '',
      ),
    };
  }

  return result;
}

/**
 * Sends a command result to the local HTTP server.
 * @param {object} response - Result envelope.
 * @returns {Promise<void>} Completion promise.
 */
async function postCommandResult(response, options = {}) {
  const { fetchImpl } = resolveBridgeEnvironment(options);
  if (typeof fetchImpl !== 'function') {
    return;
  }

  try {
    await fetchImpl(resolveBridgeUrl(SERVER_COMMAND_RESULT_PATH, options), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
      cache: 'no-store',
    });
  } catch {
    // Ignore bridge sync failures when the local server is unavailable.
  }
}

/**
 * Builds a File object from a payload if necessary.
 * @param {object} payload - Command payload.
 * @returns {File|null} File instance.
 */
function resolvePayloadFile(payload) {
  return deserializeFilePayload(payload);
}

/**
 * Publishes the current viewer state to the local HTTP server.
 * @param {object} snapshot - Serializable viewer snapshot.
 * @returns {Promise<void>} Completion promise.
 */
async function syncRuntimeState(snapshot, options = {}) {
  const { fetchImpl } = resolveBridgeEnvironment(options);
  if (typeof fetchImpl !== 'function') {
    return;
  }

  try {
    await fetchImpl(resolveBridgeUrl(RUNTIME_STATE_PATH, options), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
      cache: 'no-store',
    });
  } catch {
    // Ignore sync failures when the local server is unavailable.
  }
}

/**
 * Returns true when the command needs playback primitives.
 * @param {string} command - Command name.
 * @returns {boolean} True when playback commands are required.
 */
function commandNeedsPlayback(command) {
  return [
    'unload-model',
    'assign-vmd',
    'toggle-playback',
    'play',
    'pause',
    'rewind',
    'go-to-end',
    'seek-frame',
    'step-frame',
    'step-keyframe',
    'set-playback-range',
    'reset-physics',
    'select-model',
    'export-video',
    'get-state',
  ].includes(command);
}

/**
 * Executes a command request.
 * @param {object} message - Normalized command request.
 * @param {object} options - Execution options.
 * @param {function} [options.loadZipArchive] - ZIP loader helper.
 * @returns {Promise<object>} Command result.
 */
async function executeBridgeCommand(message, options = {}) {
  const runtime = resolveBridgeRuntime(options);
  const commands = resolveBridgeCommands(options);
  const viewerStateService = resolveViewerStateService(options);
  const commandSurface = { ...commands };
  const command = typeof message.command === 'string' ? message.command : '';
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

  await viewerStateService.waitUntilReady({ needsPlayback: commandNeedsPlayback(command) });

  switch (command) {
    case 'ping':
      return { pong: true };
    case 'load-zip': {
      const file = resolvePayloadFile(payload);
      if (!file) {
        throw new Error('load-zip requires payload.file or payload.fileData.');
      }
      if (typeof options.loadZipArchive !== 'function') {
        throw new Error('ZIP loader helper is missing.');
      }
      const archive = await options.loadZipArchive(file);
      await commandSurface.loadZipModel?.(archive.files);
      return { loaded: 'zip', fileName: file.name };
    }
    case 'load-vmd': {
      const file = resolvePayloadFile(payload);
      if (!file) {
        throw new Error('load-vmd requires payload.file or payload.fileData.');
      }
      const result = await commandSurface.loadVmd?.(file);
      const lowerFileName = String(file.name || '').toLowerCase();
      return {
        loaded: lowerFileName.endsWith('.vpd')
          ? 'vpd'
          : lowerFileName.endsWith('.vrma')
            ? 'vrma'
            : 'vmd',
        fileName: file.name,
        applied: Boolean(result?.applied ?? true),
      };
    }
    case 'load-environment-hdr': {
      const file = resolvePayloadFile(payload);
      if (file) {
        if (typeof commandSurface.loadEnvironmentHdrFile !== 'function') {
          throw new Error('load-environment-hdr requires a viewer environment loader.');
        }
        await commandSurface.loadEnvironmentHdrFile(file);
        return { loaded: 'hdr', fileName: file.name };
      }

      const hdrPath = typeof payload.path === 'string' && payload.path.trim()
        ? payload.path.trim()
        : typeof payload.hdrPath === 'string' && payload.hdrPath.trim()
          ? payload.hdrPath.trim()
          : '';
      if (!hdrPath) {
        throw new Error('load-environment-hdr requires payload.file, payload.fileData, or payload.path.');
      }
      if (typeof commandSurface.setEnvironmentHdrPath !== 'function') {
        throw new Error('load-environment-hdr requires a viewer environment loader.');
      }
      await commandSurface.setEnvironmentHdrPath(hdrPath);
      return { loaded: 'hdr', fileName: hdrPath };
    }
    case 'set-environment-hdr-intensity': {
      const intensity = Number(
        payload.intensity !== undefined
          ? payload.intensity
          : payload.value,
      );
      if (!Number.isFinite(intensity)) {
        throw new Error('set-environment-hdr-intensity requires payload.intensity.');
      }
      if (typeof commandSurface.setEnvironmentHdrIntensity !== 'function') {
        throw new Error('set-environment-hdr-intensity requires a viewer environment setter.');
      }
      commandSurface.setEnvironmentHdrIntensity(intensity);
      return viewerStateService.getViewerState();
    }
    case 'unload-model':
      if (typeof commands.removeActiveModel !== 'function') {
        throw new Error('unload-model requires application commands.removeActiveModel.');
      }
      commands.removeActiveModel();
      return viewerStateService.getViewerState();
    case 'toggle-playback':
      commandSurface.togglePlayback?.();
      return viewerStateService.getViewerState();
    case 'play':
      commandSurface.play?.();
      return viewerStateService.getViewerState();
    case 'pause':
      commandSurface.pause?.();
      return viewerStateService.getViewerState();
    case 'rewind':
      commandSurface.rewind?.();
      return viewerStateService.getViewerState();
    case 'go-to-end':
      commandSurface.goToEnd?.();
      return viewerStateService.getViewerState();
    case 'seek-frame': {
      const frame = Number(payload.frame);
      if (!Number.isFinite(frame)) {
        throw new Error('seek-frame requires payload.frame.');
      }
      commandSurface.seek?.(frame, {
        keepManualValues: payload.keepManualValues === true,
      });
      commands.syncBgmPlayback?.(true);
      return viewerStateService.getViewerState();
    }
    case 'step-frame': {
      const delta = Number(payload.delta);
      if (!Number.isFinite(delta)) {
        throw new Error('step-frame requires payload.delta.');
      }
      commandSurface.stepFrame?.(delta, {
        keepManualValues: payload.keepManualValues === true,
      });
      commands.syncBgmPlayback?.(true);
      return viewerStateService.getViewerState();
    }
    case 'step-keyframe': {
      const direction = Number(payload.direction);
      if (!Number.isFinite(direction)) {
        throw new Error('step-keyframe requires payload.direction.');
      }
      commandSurface.stepKeyframe?.(direction, {
        keepManualValues: payload.keepManualValues === true,
      });
      commands.syncBgmPlayback?.(true);
      return viewerStateService.getViewerState();
    }
    case 'set-playback-range': {
      const start = Number(payload.start);
      const end = payload.end === null || payload.end === undefined ? null : Number(payload.end);
      if (!Number.isFinite(start)) {
        throw new Error('set-playback-range requires payload.start.');
      }
      if (end !== null && !Number.isFinite(end)) {
        throw new Error('set-playback-range requires payload.end to be a number or null.');
      }
      commandSurface.setPlaybackRange?.(start, end);
      commands.syncBgmPlayback?.(true);
      return viewerStateService.getViewerState();
    }
    case 'assign-vmd': {
      const vmdName = typeof payload.vmdName === 'string' ? payload.vmdName : '';
      if (!vmdName) {
        throw new Error('assign-vmd requires payload.vmdName.');
      }

      const vmd = runtime?.vmdManager?.vmds?.get(vmdName)
        ?? runtime?.vmdManager?.getAnimationSource?.('vmd', vmdName)?.data
        ?? null;
      if (!vmd) {
        throw new Error(`VMD not found: ${vmdName}`);
      }

      if (typeof commands.assignVmdToActiveInstance !== 'function') {
        throw new Error('assign-vmd requires application commands.assignVmdToActiveInstance.');
      }
      commands.assignVmdToActiveInstance(vmd, vmdName);
      return viewerStateService.getViewerState();
    }
    case 'export-video': {
      if (typeof commandSurface.exportVideo !== 'function') {
        throw new Error('export-video requires a video export manager.');
      }

      const playbackRange = commandSurface.getPlaybackRange?.() ?? { start: 0, end: null };
      return commandSurface.exportVideo({
        format: payload.format,
        codec: payload.codec,
        width: payload.width,
        height: payload.height,
        quality: payload.quality,
        exportFps: payload.exportFps,
        startFrame: Number.isFinite(payload.startFrame) ? payload.startFrame : playbackRange.start,
        endFrame: Number.isFinite(payload.endFrame) ? payload.endFrame : playbackRange.end,
        includeAudio: payload.includeAudio === true,
        transparentBackground: payload.transparentBackground === true,
      });
    }
    case 'set-bone-params': {
      const targets = Array.isArray(payload.targets) ? payload.targets : null;
      if (!targets || targets.length === 0) {
        throw new Error('set-bone-params requires payload.targets.');
      }

      if (typeof commands.setBoneParams !== 'function') {
        throw new Error('set-bone-params requires application commands.setBoneParams.');
      }
      commands.setBoneParams(payload);
      return viewerStateService.getViewerState();
    }
    case 'reset-physics':
      if (typeof commands.resetPhysics !== 'function') {
        throw new Error('reset-physics requires application commands.resetPhysics.');
      }
      commands.resetPhysics();
      return viewerStateService.getViewerState();
    case 'enter-fullscreen':
      await commands.enterFullscreen?.();
      return viewerStateService.getViewerState();
    case 'exit-fullscreen':
      await commands.exitFullscreen?.();
      return viewerStateService.getViewerState();
    case 'select-model': {
      const index = Number.parseInt(String(payload.index), 10);
      if (!Number.isInteger(index)) {
        throw new Error('select-model requires payload.index.');
      }
      const instances = runtime?.modelManager?.instances ?? [];
      if (index < 0 || index >= instances.length) {
        throw new Error('select-model index is out of range.');
      }
      if (typeof commands.selectModel === 'function') {
        commands.selectModel(index);
      } else if (typeof commands.activateInstance === 'function') {
        commands.activateInstance(index);
      } else {
        throw new Error('select-model requires application commands.selectModel.');
      }
      return viewerStateService.getViewerState();
    }
    case 'get-state':
      return viewerStateService.getViewerState();
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Starts the server-backed bridge.
 * @param {object} options - Bridge options.
 * @returns {{dispose: function}} Bridge control object.
 */
function setupOpenMmdServerBridge(options) {
  let syncTimer = null;
  let disposed = false;
  let eventSource = null;
  let commandQueue = Promise.resolve();

  /**
   * Queues a command for serial execution.
   * @param {object} command - Normalized command record.
   */
  function queueCommand(command) {
    commandQueue = commandQueue
      .then(() => handleServerCommand(command))
      .catch(() => {});
  }

  /**
   * Handles a command from the server event stream.
   * @param {object} command - Normalized command record.
   * @returns {Promise<void>} Completion promise.
   */
  async function handleServerCommand(command) {
    if (disposed || !command || typeof command !== 'object') {
      return;
    }
    if (command.namespace !== MESSAGE_NAMESPACE || command.type !== 'command') {
      return;
    }

    const response = {
      namespace: MESSAGE_NAMESPACE,
      type: 'response',
      id: typeof command.id === 'string' ? command.id : null,
    };

    try {
      const result = await executeBridgeCommand(command, options);
      response.ok = true;
      response.result = await serializeCommandResult(command.command, result);
    } catch (error) {
      response.ok = false;
      response.error = {
        message: error instanceof Error ? error.message : String(error),
      };
    }

    await postCommandResult(response, options);
    void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);
  }

  /**
   * Handles a server event.
   * @param {MessageEvent} event - EventSource message event.
   */
  function handleCommandEvent(event) {
    if (disposed) {
      return;
    }

    try {
      queueCommand(JSON.parse(event.data));
    } catch {
      // Ignore malformed command payloads from the server.
    }
  }

  /**
   * Starts the EventSource connection.
   */
  function connectServerStream() {
    const { eventSourceFactory } = resolveBridgeEnvironment(options);
    if (typeof eventSourceFactory !== 'function') {
      throw new Error('Server bridge requires EventSource support.');
    }

    eventSource = eventSourceFactory(resolveBridgeUrl(SERVER_COMMAND_STREAM_PATH, options));
    eventSource.addEventListener('ready', () => {
      void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);
    });
    eventSource.addEventListener('command', handleCommandEvent);
    eventSource.addEventListener('error', () => {
      // EventSource reconnects automatically; keep the bridge alive.
    });
  }

  connectServerStream();
  syncTimer = resolveBridgeEnvironment(options).setIntervalImpl?.(() => {
    void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);
  }, STATE_SYNC_INTERVAL_MS);
  void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);

  return {
    dispose() {
      disposed = true;
      if (syncTimer !== null) {
        resolveBridgeEnvironment(options).clearIntervalImpl?.(syncTimer);
      }
      if (eventSource) {
        eventSource.close();
      }
    },
  };
}

/**
 * Starts the legacy postMessage bridge.
 * @param {object} options - Bridge options.
 * @returns {{dispose: function}} Bridge control object.
 */
function setupOpenMmdPostMessageBridge(options) {
  let syncTimer = null;

  /**
   * Handles a single message event.
   * @param {MessageEvent} event - Message event.
   * @returns {Promise<void>} Completion promise.
   */
  async function handleMessage(event) {
    if (event.origin !== resolveBridgeEnvironment(options).locationOrigin) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.namespace !== MESSAGE_NAMESPACE || data.type !== 'command') {
      return;
    }

    const response = {
      namespace: MESSAGE_NAMESPACE,
      type: 'response',
      id: typeof data.id === 'string' ? data.id : null,
    };

    try {
      const result = await executeBridgeCommand(data, options);
      void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);
      response.ok = true;
      response.result = result;
    } catch (error) {
      response.ok = false;
      response.error = {
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage(response, event.origin);
    }
  }

  resolveBridgeEnvironment(options).addWindowEventListener?.('message', handleMessage);
  syncTimer = resolveBridgeEnvironment(options).setIntervalImpl?.(() => {
    void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);
  }, STATE_SYNC_INTERVAL_MS);
  void syncRuntimeState(resolveViewerStateService(options).getViewerState(), options);

  return {
    dispose() {
      if (syncTimer !== null) {
        resolveBridgeEnvironment(options).clearIntervalImpl?.(syncTimer);
      }
      resolveBridgeEnvironment(options).removeWindowEventListener?.('message', handleMessage);
    },
  };
}

/**
 * Creates the OpenMMD command bridge.
 * @param {object} options - Bridge options.
 * @returns {{executeCommand: function(object, object=): Promise<object>, install: function(object=): {dispose: function}}} Bridge API.
 */
export function createApiBridge(options = {}) {
  /**
   * Executes a command with merged bridge options.
   * @param {object} message - Normalized command request.
   * @param {object} [extraOptions={}] - Per-call bridge overrides.
   * @returns {Promise<object>} Command result.
   */
  async function executeCommand(message, extraOptions = {}) {
    return executeBridgeCommand(message, {
      ...options,
      ...extraOptions,
    });
  }

  /**
   * Installs the selected transport.
   * @param {object} [extraOptions={}] - Per-install bridge overrides.
   * @returns {{dispose: function}} Bridge control object.
   */
  function install(extraOptions = {}) {
    const installOptions = {
      ...options,
      ...extraOptions,
    };
    if (installOptions.transport === 'none') {
      return {
        dispose() {},
      };
    }
    if (installOptions.transport === 'postMessage') {
      return setupOpenMmdPostMessageBridge(installOptions);
    }
    return setupOpenMmdServerBridge(installOptions);
  }

  return {
    executeCommand,
    install,
  };
}
