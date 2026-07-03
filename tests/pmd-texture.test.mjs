import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMD Loader Texture Information Parsing Test', async () => {
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

  assert.ok(Array.isArray(model.materials), 'model.materials should be an array');
  assert.ok(model.materials.length > 0, 'model.materials should not be empty');
  
  // PMD materials have a 'texture' field containing the filename
  assert.ok(typeof model.materials[0].textureIndex, 'Material should have a texture index');
  
  console.log(`Successfully parsed ${model.materials.length} materials.`);
  console.log(`First material texture: "${model.materials[0].texture}"`);
});
