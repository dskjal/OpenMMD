import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';

test('PMX Morph Loader Test', async () => {
  installFileFetch();

  const loader = new PMXLoader();
  const model = await loader.load('./test-data/Alicia_solid.pmx');

  assert.ok(Array.isArray(model.morphs), 'model.morphs should be an array');
  assert.ok(model.morphs.length > 0, 'model.morphs should not be empty');

  console.log(`Parsed ${model.morphs.length} morphs`);

  // Verify specific morphs often found in Miku models
  const blinkMorph = model.morphs.find(m => m.name === 'まばたき');
  if (blinkMorph) {
    assert.strictEqual(blinkMorph.type, 1, 'Blink morph should be a vertex morph (type 1)');
    assert.ok(blinkMorph.offsets.length > 0, 'Blink morph should have offsets');
    assert.ok(blinkMorph.offsets[0].index !== undefined, 'Morph offset should have a vertex index');
    assert.ok(Array.isArray(blinkMorph.offsets[0].position), 'Vertex morph offset should have a position array');
    console.log(`Found "まばたき" (blink) morph with ${blinkMorph.offsets.length} offsets`);
  } else {
    console.warn('Warning: "まばたき" morph not found in this model.');
  }

  const groupMorph = model.morphs.find(m => m.type === 0);
  if (groupMorph) {
    assert.ok(groupMorph.offsets.length > 0, 'Group morph should have offsets');
    assert.ok(groupMorph.offsets[0].index !== undefined, 'Group morph offset should have a morph index');
    assert.ok(groupMorph.offsets[0].influence !== undefined, 'Group morph offset should have influence');
    console.log(`Found group morph "${groupMorph.name}" with ${groupMorph.offsets.length} offsets`);
  }

  // Check some material morphs if present
  const materialMorph = model.morphs.find(m => m.type === 8);
  if (materialMorph) {
      assert.ok(materialMorph.offsets.length > 0, 'Material morph should have offsets');
      assert.ok(materialMorph.offsets[0].operationType !== undefined, 'Material morph should have operationType');
      console.log(`Found material morph "${materialMorph.name}"`);
  }

  console.log('Morph loader test passed!');
});

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
