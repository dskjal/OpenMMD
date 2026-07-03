import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadModelData } from '../source/core/model/model-scene.js';

test('PMD physicsMode override demotes chained rigid bodies', async () => {
  installFileFetch();

  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logs.push(args.map((value) => String(value)).join(' '));
  };

  try {
    const { model } = await loadModelData(null, 1, './test-data/miku_v2.pmd');

    const tieModes = getRigidBodyModes(model, 'ネクタイ');
    assert.deepEqual(
      tieModes,
      [
        { name: 'ネクタイ1', mode: 2 },
        { name: 'ネクタイ2', mode: 1 },
        { name: 'ネクタイ3', mode: 1 },
      ],
    );

    assert.equal(logs.length, 2, 'Two chained necktie rigid bodies should be overridden');
    assert.ok(logs.every((line) => line.includes('physicsMode override')), 'Each override should be logged');
    assert.ok(logs.some((line) => line.includes('ネクタイ2')), 'Override log should mention ネクタイ2');
    assert.ok(logs.some((line) => line.includes('ネクタイ3')), 'Override log should mention ネクタイ3');
  } finally {
    console.info = originalInfo;
  }
});

/**
 * Installs a fetch implementation that reads local files from the workspace.
 */
function installFileFetch() {
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
}

/**
 * Collects rigid body modes whose names match the prefix.
 *
 * @param {object} model Model data.
 * @param {string} prefix Rigid body name prefix.
 * @returns {Array<{name: string, mode: number}>} Matching rigid bodies.
 */
function getRigidBodyModes(model, prefix) {
  return model.rigidBodies
    .filter((rigidBody) => rigidBody.name.startsWith(prefix))
    .map((rigidBody) => ({ name: rigidBody.name, mode: rigidBody.physicsMode }));
}
