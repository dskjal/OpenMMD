import assert from 'node:assert/strict';
import test from 'node:test';

import { scaleModel } from '../source/infrastructure/gpu/renderer-resources.js';

test('scaleModel scales morph positional offsets together with geometry', () => {
  const model = {
    vertices: new Float32Array(27),
    bones: [{ position: [10, 20, 30], tailOffset: [5, 6, 7] }],
    rigidBodies: [{ size: [1, 2, 3], position: [4, 5, 6] }],
    joints: [{ position: [7, 8, 9], posMin: [-1, -2, -3], posMax: [1, 2, 3] }],
    morphs: [
      {
        offsets: [
          { position: [10, 20, 30] },
          { translation: [40, 50, 60] },
        ],
      },
    ],
  };
  model.vertices[0] = 10;
  model.vertices[1] = 20;
  model.vertices[2] = 30;

  scaleModel(model, 0.1);

  assert.deepEqual(Array.from(model.vertices.slice(0, 3)), [1, 2, 3]);
  assert.deepEqual(model.bones[0].position, [1, 2, 3]);
  assert.deepEqual(model.bones[0].tailOffset, [0.5, 0.6000000000000001, 0.7000000000000001]);
  assert.deepEqual(model.rigidBodies[0].size, [0.1, 0.2, 0.30000000000000004]);
  assert.deepEqual(model.rigidBodies[0].position, [0.4, 0.5, 0.6000000000000001]);
  assert.deepEqual(model.joints[0].position, [0.7000000000000001, 0.8, 0.9]);
  assert.deepEqual(model.morphs[0].offsets[0].position, [1, 2, 3]);
  assert.deepEqual(model.morphs[0].offsets[1].translation, [4, 5, 6]);
});
