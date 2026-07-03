import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMD Loader: Materials and Textures', async () => {
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

  assert.ok(model.materials.length > 0, 'Should have materials');
  
  // Verify first material structure
  const mat = model.materials[0];
  assert.strictEqual(mat.diffuse.length, 4, 'Diffuse should be RGBA');
  assert.strictEqual(mat.specular.length, 3, 'Specular should be RGB');
  assert.strictEqual(mat.ambient.length, 3, 'Ambient should be RGB');
  assert.ok(model.textures.length > 0, 'Texture filename should be a string');
  
  console.log(`Parsed ${model.materials.length} materials.`);
  console.log(`First material: textureIndex="${mat.textureIndex}", textureName=${model.textures[mat.textureIndex]}, diffuse=${mat.diffuse}`);
  console.log(`textures: ${model.textures}`);
});
