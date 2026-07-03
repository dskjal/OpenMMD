import assert from 'node:assert/strict';
import test from 'node:test';

import { replaceShaderAcrossInstances } from '../source/core/model/model-manager.js';

test('replaceShaderAcrossInstances updates only materials that use the source shader', async () => {
  const calls = [];
  const modelManager = {
    instances: [
      {
        model: {
          materials: [
            { shaderName: 'mmd-shader.wgsl' },
            { shaderName: 'custom.wgsl' },
          ],
        },
      },
      {
        model: {
          materials: [
            { shaderName: 'mmd-shader.wgsl' },
            { shaderName: 'mmd-shader.wgsl' },
            { shaderName: 'mtoon-shader.wgsl' },
          ],
        },
      },
      {
        model: {
          materials: [
            { shaderName: 'gltf-shader.wgsl' },
          ],
        },
      },
    ],
    async updateMaterialShader(instance, selectedIndices, shaderName) {
      calls.push({
        instance,
        selectedIndices: selectedIndices.slice(),
        shaderName,
      });
    },
  };

  const updatedCount = await replaceShaderAcrossInstances(modelManager, 'mmd-shader.wgsl', 'mtoon-shader.wgsl');

  assert.equal(updatedCount, 2);
  assert.deepEqual(calls.map((call) => call.selectedIndices), [[0], [0, 1]]);
  assert.deepEqual(calls.map((call) => call.shaderName), ['mtoon-shader.wgsl', 'mtoon-shader.wgsl']);
});
