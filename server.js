import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MESSAGE_NAMESPACE = 'openmmd-api';
const COMMAND_RESULT_TIMEOUT_MS = 30000;

/**
 * Creates the default runtime snapshot.
 * @returns {object} Empty runtime snapshot.
 */
function createEmptyRuntimeSnapshot() {
  return {
    timestamp: null,
    activeInstanceIndex: -1,
    activeModelName: '',
    activeVmdName: '',
    modelNames: [],
    vmdNames: [],
    models: [],
  };
}

/**
 * Sends a server-sent event payload.
 * @param {import('http').ServerResponse} res - Response object.
 * @param {string} eventName - Event name.
 * @param {object} data - JSON-serializable payload.
 */
function sendServerSentEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Normalizes a command request body.
 * @param {unknown} body - Request body.
 * @returns {object|null} Normalized command record.
 */
function normalizeCommand(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const command = typeof body.command === 'string' ? body.command.trim() : '';
  if (!command) {
    return null;
  }

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const id = typeof body.id === 'string' && body.id.trim()
    ? body.id.trim()
    : randomUUID();

  return {
    namespace: MESSAGE_NAMESPACE,
    type: 'command',
    id,
    command,
    payload,
  };
}

/**
 * Formats an error payload for API responses.
 * @param {unknown} error - Error value.
 * @returns {{ message: string }} Normalized error payload.
 */
function toErrorPayload(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Creates an API error.
 * @param {number} status - HTTP status code.
 * @param {string} message - Error message.
 * @returns {Error & { status: number }} API error.
 */
function createApiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Creates a configured Express app and runtime snapshot store.
 * @returns {{app: import('express').Express, setRuntimeStateSnapshot: function, getRuntimeStateSnapshot: function}} App bundle.
 */
export function createApiApp() {
  const app = express();
  const pendingCommandResolvers = new Map();
  let runtimeStateSnapshot = createEmptyRuntimeSnapshot();
  let viewerConnection = null;

  /**
   * Stores the latest runtime snapshot.
   * @param {object} snapshot - Runtime snapshot.
   */
  function setRuntimeStateSnapshot(snapshot) {
    runtimeStateSnapshot = snapshot && typeof snapshot === 'object'
      ? snapshot
      : createEmptyRuntimeSnapshot();
  }

  /**
   * Returns the cached runtime snapshot.
   * @returns {object} Runtime snapshot.
   */
  function getRuntimeStateSnapshot() {
    return runtimeStateSnapshot;
  }

  /**
   * Returns true when a viewer connection is active.
   * @returns {boolean} Whether a viewer is connected.
   */
  function isViewerConnected() {
    return Boolean(viewerConnection?.res) && !viewerConnection.res.writableEnded && !viewerConnection.res.destroyed;
  }

  /**
   * Rejects all pending commands with a transport error.
   * @param {number} status - HTTP status code.
   * @param {string} message - Error message.
   */
  function rejectAllPendingCommands(status, message) {
    for (const [id, pending] of pendingCommandResolvers) {
      clearTimeout(pending.timeoutId);
      pendingCommandResolvers.delete(id);
      pending.reject(createApiError(status, message));
    }
  }

  /**
   * Closes the current viewer connection, if any.
   * @param {number} status - HTTP status code for pending commands.
   * @param {string} message - Error message for pending commands.
   */
  function closeViewerConnection(status, message) {
    if (!viewerConnection) {
      return;
    }

    const current = viewerConnection;
    viewerConnection = null;
    rejectAllPendingCommands(status, message);

    if (!current.res.writableEnded) {
      current.res.end();
    }
  }

  /**
   * Registers a promise for a command response.
   * @param {string} commandId - Command id.
   * @returns {Promise<object>} Response promise.
   */
  function waitForCommandResult(commandId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingCommandResolvers.delete(commandId);
        reject(createApiError(504, 'Timed out waiting for the viewer response.'));
      }, COMMAND_RESULT_TIMEOUT_MS);

      pendingCommandResolvers.set(commandId, {
        resolve(value) {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeoutId);
          reject(error);
        },
        timeoutId,
      });
    });
  }

  /**
   * Rejects a single pending command.
   * @param {string} commandId - Command id.
   * @param {number} status - HTTP status code.
   * @param {string} message - Error message.
   */
  function rejectPendingCommand(commandId, status, message) {
    const pending = pendingCommandResolvers.get(commandId);
    if (!pending) {
      return;
    }

    pendingCommandResolvers.delete(commandId);
    clearTimeout(pending.timeoutId);
    pending.reject(createApiError(status, message));
  }

  /**
   * Publishes a command to the active viewer.
   * @param {object} command - Normalized command record.
   */
  function publishCommand(command) {
    if (!isViewerConnected()) {
      throw createApiError(503, 'Viewer is not connected.');
    }

    sendServerSentEvent(viewerConnection.res, 'command', command);
  }

  /**
   * Resolves a viewer-reported command response.
   * @param {object} response - Command response.
   * @returns {boolean} True when the response matched a pending command.
   */
  function resolveCommandResponse(response) {
    const commandId = typeof response?.id === 'string' ? response.id.trim() : '';
    if (!commandId || !pendingCommandResolvers.has(commandId)) {
      return false;
    }

    const pending = pendingCommandResolvers.get(commandId);
    pendingCommandResolvers.delete(commandId);
    clearTimeout(pending.timeoutId);

    if (response.ok === true) {
      pending.resolve({
        ok: true,
        id: commandId,
        result: response.result,
      });
      return true;
    }

    pending.reject(createApiError(422, typeof response?.error?.message === 'string'
      ? response.error.message
      : 'Command execution failed.'));
    return true;
  }

  /**
   * Returns a model list payload.
   * @param {object} state - Runtime snapshot.
   * @returns {object} Response payload.
   */
  function createModelListPayload(state) {
    return {
      ok: true,
      models: Array.isArray(state.models)
        ? state.models.map((model) => ({
          instanceIndex: Number.isInteger(model.instanceIndex) ? model.instanceIndex : -1,
          modelName: typeof model.modelName === 'string' ? model.modelName : '',
          vmdName: typeof model.vmdName === 'string' ? model.vmdName : '',
          boneCount: Number.isInteger(model.boneCount) ? model.boneCount : Array.isArray(model.bones) ? model.bones.length : 0,
          isActive: Boolean(model.isActive),
        }))
        : [],
      modelNames: Array.isArray(state.modelNames)
        ? state.modelNames.filter((name) => typeof name === 'string')
        : [],
    };
  }

  /**
   * Returns the active model name payload.
   * @param {object} state - Runtime snapshot.
   * @returns {object} Response payload.
   */
  function createActiveModelNamePayload(state) {
    return {
      ok: true,
      activeInstanceIndex: Number.isInteger(state.activeInstanceIndex) ? state.activeInstanceIndex : -1,
      activeModelName: typeof state.activeModelName === 'string' ? state.activeModelName : '',
    };
  }

  /**
   * Returns a model bone payload.
   * @param {object} state - Runtime snapshot.
   * @param {string} modelName - Target model name.
   * @returns {object|null} Response payload or null when not found.
   */
  function createModelBonePayload(state, modelName) {
    const targetName = typeof modelName === 'string' ? modelName.trim() : '';
    if (!targetName || !state || !Array.isArray(state.models)) {
      return null;
    }

    const model = state.models.find((candidate) => (candidate.modelName || '') === targetName) || null;
    if (!model) {
      return null;
    }

    return {
      ok: true,
      instanceIndex: Number.isInteger(model.instanceIndex) ? model.instanceIndex : -1,
      modelName: typeof model.modelName === 'string' ? model.modelName : '',
      boneCount: Array.isArray(model.bones) ? model.bones.length : 0,
      bones: Array.isArray(model.bones)
        ? model.bones.map((bone) => ({
          index: Number.isInteger(bone.index) ? bone.index : -1,
          name: typeof bone.name === 'string' ? bone.name : '',
          local: {
            position: Array.isArray(bone.local?.position) ? bone.local.position : [0, 0, 0],
            rotation: Array.isArray(bone.local?.rotation) ? bone.local.rotation : [0, 0, 0, 1],
          },
          world: {
            position: Array.isArray(bone.world?.position) ? bone.world.position : [0, 0, 0],
            rotation: Array.isArray(bone.world?.rotation) ? bone.world.rotation : [0, 0, 0, 1],
          },
        }))
        : [],
    };
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256mb' }));
  app.use(express.static(rootDir, { extensions: ['html'] }));

  app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      viewerConnected: isViewerConnected(),
      pendingCommands: pendingCommandResolvers.size,
    });
  });

  app.get('/api/models', (req, res) => {
    res.json(createModelListPayload(runtimeStateSnapshot));
  });

  app.get('/api/active-model-name', (req, res) => {
    res.json(createActiveModelNamePayload(runtimeStateSnapshot));
  });

  app.get('/api/models/:modelName/bones', (req, res) => {
    const payload = createModelBonePayload(runtimeStateSnapshot, req.params.modelName);
    if (!payload) {
      res.status(404).json({
        ok: false,
        error: 'Model not found.',
      });
      return;
    }

    res.json(payload);
  });

  app.get('/api/events', (req, res) => {
    if (viewerConnection) {
      closeViewerConnection(503, 'A new viewer bridge replaced the existing connection.');
    }

    viewerConnection = {
      res,
    };

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    sendServerSentEvent(res, 'ready', {
      ok: true,
      timestamp: Date.now(),
    });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (viewerConnection && viewerConnection.res === res) {
        viewerConnection = null;
        rejectAllPendingCommands(503, 'Viewer disconnected.');
      }
    });
  });

  app.post('/api/command', async (req, res) => {
    const command = normalizeCommand(req.body);
    if (!command) {
      res.status(400).json({
        ok: false,
        error: 'Invalid command payload.',
      });
      return;
    }

    if (!isViewerConnected()) {
      res.status(503).json({
        ok: false,
        error: 'Viewer is not connected.',
      });
      return;
    }

    try {
      const resultPromise = waitForCommandResult(command.id);
      resultPromise.catch(() => {});
      publishCommand(command);
      const response = await resultPromise;
      res.json({
        ok: true,
        id: command.id,
        result: response.result,
      });
    } catch (error) {
      if (pendingCommandResolvers.has(command.id) && Number.isInteger(error?.status)) {
        rejectPendingCommand(command.id, error.status, error.message);
      }
      const status = Number.isInteger(error?.status) ? error.status : 500;
      res.status(status).json({
        ok: false,
        id: command.id,
        error: toErrorPayload(error),
      });
    }
  });

  app.post('/api/command-result', (req, res) => {
    const response = req.body;
    if (!response || typeof response !== 'object') {
      res.status(400).json({
        ok: false,
        error: 'Invalid command result payload.',
      });
      return;
    }

    if (response.namespace !== MESSAGE_NAMESPACE || response.type !== 'response') {
      res.status(400).json({
        ok: false,
        error: 'Invalid command result envelope.',
      });
      return;
    }

    if (!resolveCommandResponse(response)) {
      res.status(404).json({
        ok: false,
        error: 'Pending command not found.',
      });
      return;
    }

    res.json({
      ok: true,
    });
  });

  app.post('/api/runtime-state', (req, res) => {
    setRuntimeStateSnapshot(req.body);
    res.json({
      ok: true,
    });
  });

  return {
    app,
    setRuntimeStateSnapshot,
    getRuntimeStateSnapshot,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app } = createApiApp();
  app.listen(PORT, () => {
    console.log(`OpenMMD local API server listening on http://localhost:${PORT}`);
  });
}

export default {
  createApiApp,
};
