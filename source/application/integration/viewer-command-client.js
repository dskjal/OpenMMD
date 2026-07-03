import {
  MESSAGE_NAMESPACE,
  deserializeFilePayload,
} from './openmmd-bridge-protocol.js';

/**
 * Creates a client that sends commands to the viewer window.
 * @param {object} options - Client options.
 * @returns {object} Viewer command client.
 */
export function createViewerCommandClient(options = {}) {
  let viewerWindow = null;
  let commandCounter = 0;
  const pendingCommands = [];
  const pendingResponses = new Map();
  const windowObject = options.windowObject ?? globalThis.window ?? null;
  const origin = options.origin ?? windowObject?.location?.origin ?? '';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;

  /**
   * Returns a new command id.
   * @returns {string} Unique id.
   */
  function createCommandId() {
    commandCounter += 1;
    return `cmd-${Date.now()}-${commandCounter}`;
  }

  /**
   * Returns the current viewer window if available.
   * @returns {Window|null} Viewer window or null.
   */
  function getViewerWindow() {
    if (viewerWindow && !viewerWindow.closed) {
      return viewerWindow;
    }
    viewerWindow = null;
    return null;
  }

  /**
   * Opens or focuses the viewer window.
   * @returns {Window|null} Viewer window or null.
   */
  function openViewerWindow() {
    const current = getViewerWindow();
    if (current) {
      current.focus?.();
      options.onViewerStatusChanged?.('open');
      return current;
    }

    viewerWindow = options.openViewerWindow?.() ?? null;
    if (viewerWindow) {
      viewerWindow.focus?.();
      options.onViewerStatusChanged?.('open');
      options.onViewerOpened?.();
    } else {
      options.onViewerStatusChanged?.('blocked');
      options.onViewerBlocked?.();
    }
    return viewerWindow;
  }

  /**
   * Sends a command to the viewer.
   * @param {string} command - Command name.
   * @param {object} [payload={}] - Command payload.
   * @param {object} [sendOptions={}] - Send options.
   * @returns {Promise<object|null>} Viewer response.
   */
  async function sendCommand(command, payload = {}, sendOptions = {}) {
    const shouldOpenViewer = sendOptions.openViewer !== false;
    const viewer = shouldOpenViewer ? openViewerWindow() : getViewerWindow();
    if (!viewer) {
      pendingCommands.push({ command, payload });
      return null;
    }

    const id = createCommandId();
    const message = {
      namespace: MESSAGE_NAMESPACE,
      type: 'command',
      id,
      command,
      payload,
    };

    const responsePromise = new Promise((resolve, reject) => {
      const timeoutId = windowObject?.setTimeout?.(() => {
        if (pendingResponses.has(id)) {
          pendingResponses.delete(id);
          reject(new Error(`Timed out waiting for ${command}.`));
        }
      }, timeoutMs);

      pendingResponses.set(id, {
        resolve(value) {
          if (timeoutId !== undefined) {
            windowObject?.clearTimeout?.(timeoutId);
          }
          resolve(value);
        },
        reject(error) {
          if (timeoutId !== undefined) {
            windowObject?.clearTimeout?.(timeoutId);
          }
          reject(error);
        },
      });
    });

    viewer.postMessage(message, origin);
    return responsePromise;
  }

  /**
   * Flushes queued commands once the viewer is available.
   * @returns {Promise<void>} Completion promise.
   */
  async function flushPendingCommands() {
    if (!getViewerWindow()) {
      return;
    }

    while (pendingCommands.length > 0) {
      const item = pendingCommands.shift();
      await sendCommand(item.command, item.payload);
    }
  }

  /**
   * Handles a viewer response message.
   * @param {object} response - Response payload.
   */
  function handleViewerResponse(response) {
    if (!response || typeof response !== 'object') {
      return;
    }
    if (response.namespace !== MESSAGE_NAMESPACE || response.type !== 'response') {
      return;
    }

    if (response.id && pendingResponses.has(response.id)) {
      const pending = pendingResponses.get(response.id);
      pendingResponses.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result || null);
      } else {
        pending.reject(new Error(response.error?.message || 'Command failed.'));
      }
    }

    options.onResponse?.(response);
  }

  /**
   * Forwards a server command payload to the viewer.
   * @param {object} command - Command record.
   * @returns {Promise<void>} Completion promise.
   */
  async function forwardServerCommand(command) {
    if (!command || typeof command !== 'object') {
      return;
    }

    const payload = { ...(command.payload || {}) };
    if (payload.fileName && payload.fileData) {
      const file = deserializeFilePayload(payload);
      if (file) {
        payload.file = file;
      }
    }

    await sendCommand(command.command, payload, { openViewer: false });
  }

  return {
    getViewerWindow,
    openViewerWindow,
    sendCommand,
    flushPendingCommands,
    handleViewerResponse,
    forwardServerCommand,
  };
}
