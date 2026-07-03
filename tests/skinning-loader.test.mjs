import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';

test('PMX Skinning Loader Test', async () => {
  installFileFetch();

  const loader = new PMXLoader();
  const model = await loader.load('./test-data/Alicia_solid.pmx');

  assert.ok(model.vertices instanceof Float32Array, 'vertices should be a Float32Array');
  
  // stride = 27 (pos:3, norm:3, uv:2, boneIndex:4, boneWeight:4, weightType:1, sdefC:3, sdefR0:3, sdefR1:3, edgeScale:1)
  const vertexCount = model.vertices.length / 27;
  console.log(`Loaded ${vertexCount} vertices`);

  for (let i = 0; i < Math.min(100, vertexCount); i++) { // 最初の100頂点をサンプリング
    const vOffset = i * 27;
    const weights = [
      model.vertices[vOffset + 12],
      model.vertices[vOffset + 13],
      model.vertices[vOffset + 14],
      model.vertices[vOffset + 15]
    ];
    
    const weightSum = weights.reduce((a, b) => a + b, 0);
    
    // ウェイト合計はほぼ 1.0 になるはず
    assert.ok(Math.abs(weightSum - 1.0) < 0.01, `Vertex ${i} weight sum is not 1.0: ${weightSum}`);
    
    // インデックスの整合性チェック
    for (let j = 0; j < 4; j++) {
      const boneIndex = model.vertices[vOffset + 8 + j];
      assert.ok(boneIndex >= -1 && boneIndex < model.bones.length, `Vertex ${i} has invalid bone index: ${boneIndex}`);
    }
  }

  console.log('Skinning loader test passed!');
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
