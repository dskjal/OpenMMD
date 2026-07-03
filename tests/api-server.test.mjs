import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

const serverModule = await import('../server.js');
const { createApiApp } = serverModule.default ?? serverModule;

/**
 * Starts the API server on an ephemeral port.
 * @param {import('express').Express} app - Express app.
 * @returns {Promise<{server: import('http').Server, baseUrl: string}>} Server handle.
 */
async function startServer(app) {
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

/**
 * Waits for a specific server-sent event.
 * @param {Response} response - Event stream response.
 * @param {string} targetEventName - Event name to match.
 * @param {boolean} [autoCancel=true] - Whether to close the stream after the event is found.
 * @returns {Promise<object|{payload: object, close: function}>} Parsed event payload or a close handle.
 */
async function waitForServerSentEvent(response, targetEventName, autoCancel = true) {
  assert.ok(response.body, 'event stream should provide a body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex === -1) {
          break;
        }

        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        let eventName = '';
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        if (eventName === targetEventName) {
          const payload = JSON.parse(dataLines.join('\n'));
          if (!autoCancel) {
            return {
              payload,
              close: async () => {
                await reader.cancel().catch(() => {});
              },
            };
          }
          return payload;
        }
      }
    }
  } finally {
    if (autoCancel) {
      await reader.cancel().catch(() => {});
    }
  }

  throw new Error(`Timed out waiting for ${targetEventName}.`);
}

test('POST /api/command returns 503 when the viewer is not connected', { timeout: 5000 }, async () => {
  const { app } = createApiApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'ping',
      }),
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'Viewer is not connected.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP GET APIs return cached model and bone data', { timeout: 5000 }, async () => {
  const { app } = createApiApp();
  const { server, baseUrl } = await startServer(app);

  const snapshot = {
    timestamp: 123,
    activeInstanceIndex: 1,
    activeModelName: 'Model B',
    activeVmdName: 'Walk',
    modelNames: ['Model A', 'Model B'],
    vmdNames: ['Walk'],
    models: [
      {
        instanceIndex: 0,
        modelName: 'Model A',
        vmdName: '',
        boneCount: 1,
        isActive: false,
        bones: [
          {
            index: 0,
            name: 'Root',
            local: {
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
            },
            world: {
              position: [4, 5, 6],
              rotation: [0, 0, 0, 1],
            },
          },
        ],
      },
      {
        instanceIndex: 1,
        modelName: 'Model B',
        vmdName: 'Walk',
        boneCount: 2,
        isActive: true,
        bones: [
          {
            index: 0,
            name: 'Root',
            local: {
              position: [7, 8, 9],
              rotation: [0, 0, 0, 1],
            },
            world: {
              position: [10, 11, 12],
              rotation: [0, 0, 1, 0],
            },
          },
          {
            index: 1,
            name: 'Arm',
            local: {
              position: [13, 14, 15],
              rotation: [0, 1, 0, 0],
            },
            world: {
              position: [16, 17, 18],
              rotation: [0, 1, 0, 0],
            },
          },
        ],
      },
    ],
  };

  try {
    const syncResponse = await fetch(`${baseUrl}/api/runtime-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
    });
    assert.equal(syncResponse.status, 200);

    const modelsResponse = await fetch(`${baseUrl}/api/models`);
    assert.equal(modelsResponse.status, 200);
    const modelsPayload = await modelsResponse.json();
    assert.deepEqual(modelsPayload.modelNames, ['Model A', 'Model B']);
    assert.equal(modelsPayload.models[1].boneCount, 2);
    assert.equal(modelsPayload.models[1].isActive, true);

    const activeResponse = await fetch(`${baseUrl}/api/active-model-name`);
    assert.equal(activeResponse.status, 200);
    const activePayload = await activeResponse.json();
    assert.equal(activePayload.activeModelName, 'Model B');
    assert.equal(activePayload.activeInstanceIndex, 1);

    const bonesResponse = await fetch(`${baseUrl}/api/models/${encodeURIComponent('Model B')}/bones`);
    assert.equal(bonesResponse.status, 200);
    const bonesPayload = await bonesResponse.json();
    assert.equal(bonesPayload.modelName, 'Model B');
    assert.equal(bonesPayload.instanceIndex, 1);
    assert.equal(bonesPayload.bones.length, 2);
    assert.deepEqual(bonesPayload.bones[1].world.position, [16, 17, 18]);

    const missingResponse = await fetch(`${baseUrl}/api/models/${encodeURIComponent('Missing')}/bones`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/command waits for the viewer response and returns the command result', { timeout: 5000 }, async () => {
  const { app } = createApiApp();
  const { server, baseUrl } = await startServer(app);

  try {
    const eventStream = await fetch(`${baseUrl}/api/events`);
    const commandResponsePromise = fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'ping',
      }),
    });

    const commandEvent = await waitForServerSentEvent(eventStream, 'command', false);
    assert.equal(commandEvent.payload.command, 'ping');
    assert.ok(commandEvent.payload.id);

    const resultResponse = await fetch(`${baseUrl}/api/command-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        namespace: 'openmmd-api',
        type: 'response',
        id: commandEvent.payload.id,
        ok: true,
        result: {
          pong: true,
        },
      }),
    });
    assert.equal(resultResponse.status, 200);

    const commandResponse = await commandResponsePromise;
    assert.equal(commandResponse.status, 200);
    assert.deepEqual(await commandResponse.json(), {
      ok: true,
      id: commandEvent.payload.id,
      result: {
        pong: true,
      },
    });

    await commandEvent.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
