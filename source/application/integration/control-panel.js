import {
  serializeFilePayload,
} from './openmmd-bridge-protocol.js';
import { createViewerCommandClient } from './viewer-command-client.js';

const VIEWER_WINDOW_NAME = 'openmmd-viewer';

/**
 * Resolves a URL relative to the current page.
 * @param {object} windowObject - Window-like object.
 * @param {object} documentObject - Document-like object.
 * @param {string} path - Relative path.
 * @returns {string} Absolute URL when possible, otherwise the original path.
 */
function resolveControlPanelUrl(windowObject, documentObject, path) {
  const baseUrl = documentObject?.baseURI
    ?? windowObject?.location?.href
    ?? (windowObject?.location?.origin ? `${windowObject.location.origin}/` : '')
    ?? '';

  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl).href;
}

/**
 * Creates the control-panel application.
 * @param {object} [options={}] - Bootstrap options.
 * @returns {object} Control-panel application.
 */
export function createControlPanelApp(options = {}) {
  const windowObject = options.windowObject ?? globalThis.window ?? null;
  const documentObject = options.documentObject ?? globalThis.document ?? null;
  const eventSourceFactory = options.eventSourceFactory ?? ((url) => new EventSource(url));
  const origin = options.origin ?? windowObject?.location?.origin ?? '';
  const logger = options.logger ?? null;
  let sseConnection = null;
  let installed = false;
  const listenerDisposers = [];

  /**
   * Writes a log line.
   * @param {string} message - Log text.
   */
  function appendLog(message) {
    logger?.(message);
    const log = documentObject?.getElementById?.('command-log');
    if (!log) {
      return;
    }

    const time = new Date().toLocaleTimeString();
    log.textContent = `[${time}] ${message}\n${log.textContent}`.slice(0, 5000);
  }

  /**
   * Updates the viewer status label.
   * @param {string} text - Status text.
   */
  function setViewerStatus(text) {
    const status = documentObject?.getElementById?.('viewer-status');
    if (status) {
      status.textContent = text;
    }
  }

  /**
   * Updates the SSE status label.
   * @param {string} text - Status text.
   */
  function setStreamStatus(text) {
    const status = documentObject?.getElementById?.('stream-status');
    if (status) {
      status.textContent = text;
    }
  }

  const viewerCommandClient = createViewerCommandClient({
    windowObject,
    origin,
    openViewerWindow: options.openViewerWindow ?? (() => windowObject?.open?.(resolveControlPanelUrl(windowObject, documentObject, './'), VIEWER_WINDOW_NAME) ?? null),
    onViewerStatusChanged: setViewerStatus,
    onViewerOpened: () => appendLog('Viewer window opened.'),
    onViewerBlocked: () => appendLog('Viewer window could not be opened.'),
    onResponse: (response) => {
      if (response.ok) {
        appendLog(`Response: ${response.id || 'no-id'} ok`);
      } else {
        appendLog(`Response: ${response.id || 'no-id'} error: ${response.error?.message || 'unknown error'}`);
      }
    },
  });

  /**
   * Adds an event listener with automatic disposal.
   * @param {EventTarget|null} target - Event target.
   * @param {string} type - Event type.
   * @param {Function} handler - Listener.
   */
  function addDisposableListener(target, type, handler) {
    if (!target?.addEventListener) {
      return;
    }
    target.addEventListener(type, handler);
    listenerDisposers.push(() => {
      target.removeEventListener?.(type, handler);
    });
  }

  /**
   * Handles a viewer response.
   * @param {object} response - Viewer response.
   */
  function handleViewerResponse(response) {
    viewerCommandClient.handleViewerResponse(response);
  }

  /**
   * Handles a command published by the HTTP API server.
   * @param {object} command - Command record.
   * @returns {Promise<void>} Completion promise.
   */
  async function handleServerCommand(command) {
    if (!command || typeof command !== 'object') {
      return;
    }

    try {
      await viewerCommandClient.forwardServerCommand(command);
      appendLog(`Server command forwarded: ${command.command}`);
    } catch (error) {
      appendLog(`Forward failed for ${command.command}: ${error.message}`);
    }
  }

  /**
   * Sends a command to the viewer from a user action.
   * @param {string} command - Command name.
   * @param {object} [payload={}] - Payload object.
   * @returns {Promise<void>} Completion promise.
   */
  async function runUserCommand(command, payload = {}) {
    try {
      await viewerCommandClient.sendCommand(command, payload);
      appendLog(`Sent: ${command}`);
    } catch (error) {
      appendLog(`Send failed for ${command}: ${error.message}`);
    } finally {
      await viewerCommandClient.flushPendingCommands();
    }
  }

  /**
   * Reads a file input and sends it as a load command.
   * @param {HTMLInputElement} input - File input.
   * @param {string} command - Command name.
   * @returns {Promise<void>} Completion promise.
   */
  async function handleFileInput(input, command) {
    const file = input?.files && input.files[0] ? input.files[0] : null;
    if (!file) {
      return;
    }

    const serializedFile = await serializeFilePayload(file);
    await runUserCommand(command, serializedFile);
    input.value = '';
  }

  /**
    * Connects the server-sent event stream.
   */
  function connectServerEvents() {
    sseConnection?.close?.();
    sseConnection = eventSourceFactory(resolveControlPanelUrl(windowObject, documentObject, './api/events'));
    setStreamStatus('connecting');

    addDisposableListener(sseConnection, 'ready', () => {
      setStreamStatus('open');
      appendLog('Server event stream ready.');
    });

    addDisposableListener(sseConnection, 'command', async (event) => {
      try {
        const command = JSON.parse(event.data);
        await handleServerCommand(command);
      } catch (error) {
        appendLog(`Failed to parse server command: ${error.message}`);
      }
    });

    addDisposableListener(sseConnection, 'error', () => {
      setStreamStatus('closed');
    });
  }

  /**
   * Returns a DOM element by id.
   * @param {string} id - Element id.
   * @returns {HTMLElement|null} DOM element.
   */
  function getElement(id) {
    return documentObject?.getElementById?.(id) ?? null;
  }

  /**
   * Binds UI controls.
   */
  function setupUi() {
    addDisposableListener(getElement('open-viewer'), 'click', () => {
      viewerCommandClient.openViewerWindow();
      viewerCommandClient.flushPendingCommands();
    });

    addDisposableListener(getElement('refresh-queue'), 'click', () => {
      viewerCommandClient.openViewerWindow();
      viewerCommandClient.flushPendingCommands();
    });

    addDisposableListener(getElement('load-zip'), 'change', async (event) => {
      await handleFileInput(event.target, 'load-zip');
      await viewerCommandClient.flushPendingCommands();
    });

    addDisposableListener(getElement('load-vmd'), 'change', async (event) => {
      await handleFileInput(event.target, 'load-vmd');
      await viewerCommandClient.flushPendingCommands();
    });

    addDisposableListener(getElement('toggle-playback'), 'click', async () => {
      await runUserCommand('toggle-playback');
    });

    addDisposableListener(getElement('play'), 'click', async () => {
      await runUserCommand('play');
    });

    addDisposableListener(getElement('pause'), 'click', async () => {
      await runUserCommand('pause');
    });

    addDisposableListener(getElement('rewind'), 'click', async () => {
      await runUserCommand('rewind');
    });

    addDisposableListener(getElement('step-back'), 'click', async () => {
      await runUserCommand('step-frame', { delta: -1 });
    });

    addDisposableListener(getElement('step-forward'), 'click', async () => {
      await runUserCommand('step-frame', { delta: 1 });
    });

    addDisposableListener(getElement('go-end'), 'click', async () => {
      await runUserCommand('go-to-end');
    });

    addDisposableListener(getElement('reset-physics'), 'click', async () => {
      await runUserCommand('reset-physics');
    });

    addDisposableListener(getElement('enter-fullscreen'), 'click', async () => {
      await runUserCommand('enter-fullscreen');
    });

    addDisposableListener(getElement('exit-fullscreen'), 'click', async () => {
      await runUserCommand('exit-fullscreen');
    });

    addDisposableListener(getElement('seek-submit'), 'click', async () => {
      const frameInput = getElement('seek-frame');
      const frame = Number(frameInput?.value);
      await runUserCommand('seek-frame', { frame });
    });
  }

  return {
    viewerCommandClient,
    handleViewerResponse,
    connectServerEvents,
    setupUi,
    /**
     * Installs the control-panel runtime.
     * @returns {object} Installed app.
     */
    install() {
      if (installed) {
        return this;
      }
      installed = true;

      addDisposableListener(windowObject, 'message', (event) => {
        handleViewerResponse(event?.data ?? event);
      });
      addDisposableListener(windowObject, 'beforeunload', () => {
        sseConnection?.close?.();
      });

      setupUi();
      connectServerEvents();
      return this;
    },
    /**
     * Disposes the control-panel runtime.
     */
    dispose() {
      while (listenerDisposers.length > 0) {
        const disposeListener = listenerDisposers.pop();
        disposeListener?.();
      }
      sseConnection?.close?.();
      sseConnection = null;
      installed = false;
    },
  };
}

/**
 * Bootstraps the control-panel application.
 * @param {object} [options={}] - Bootstrap options.
 * @returns {object} Installed control-panel application.
 */
export function bootstrapControlPanel(options = {}) {
  return createControlPanelApp(options).install();
}
