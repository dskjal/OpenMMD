import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMD Loader Physics Compatibility Test', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };

  const loader = new PMDLoader();
  const model = await loader.load('./test-data/miku_v2.pmd');

  assert.ok(Array.isArray(model.rigidBodies), 'model.rigidBodies should be an array');
  assert.ok(Array.isArray(model.joints), 'model.joints should be an array');
  console.log('Physics compatibility structures initialized.');
});
