import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMD Loader Test: miku_v2.pmd', async () => {
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

  assert.ok(model.magic==='Pmd', 'Should magic is Pmd');
  assert.ok(model.version===1, 'Should version is 1');
  assert.ok(model.name==='初音ミク', 'Should have model name');
  assert.ok(model.vertices.length > 0, 'Should have vertices');
  assert.ok(model.indices.length > 0, 'Should have indices');
  assert.ok(model.materials.length > 0, 'Should have materials');
  assert.ok(Array.isArray(model.bones), 'Should have bones array');
  assert.ok(Array.isArray(model.iks), 'Should have IK array');

  console.log(`Model "${model.name}" loaded.`);
  console.log(`Model "${model.comment}" loaded.`);
  console.log(` - Vertices: ${model.vertices.length/27}`);
  console.log(` - Materials: ${model.materials.length}`);
  console.log(` - Bones: ${model.bones.length}`);
  console.log(` - IKs: ${model.iks.length}`);
});
