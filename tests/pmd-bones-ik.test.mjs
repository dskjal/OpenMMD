import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMD Loader Bones and IK Parsing Test', async () => {
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

  assert.ok(Array.isArray(model.bones), 'model.bones should be an array');
  assert.ok(model.bones.length > 0, 'model.bones should not be empty');
  assert.ok(model.bones[0].name, 'Bones should have names');

  assert.ok(Array.isArray(model.iks), 'model.iks should be an array');
  // miku_v2.pmd should have IK chains (e.g. for legs)
  assert.ok(model.iks.length > 0, 'model.iks should not be empty');
  
  console.log(`Successfully parsed ${model.bones.length} bones and ${model.iks.length} IK chains.`);
});
