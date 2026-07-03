import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeModelInstance } from '../source/core/model/runtime-model.js';
import { createMockDevice } from './runtime-test-helpers.mjs';

test('createRuntimeModelInstance initializes the shared instance shape and auto-binds default glTF source', () => {
  const model = {
    magic: 'Glb',
    name: 'Plane',
    bones: [],
    materials: [],
    morphs: [],
    ik: [],
    vertices: [],
    gltfAnimationSources: [
      {
        kind: 'gltf',
        name: 'Idle',
        clip: {
          name: 'Idle',
          channels: [],
          metadata: {
            sourceFormat: 'gltf',
          },
        },
      },
    ],
  };
  const device = createMockDevice();
  const instance = createRuntimeModelInstance({
    model,
    device,
  });

  assert.equal(instance.model, model);
  assert.equal(instance.animationSourceType, 'gltf');
  assert.equal(instance.animationSourceName, 'Idle');
  assert.equal(instance.animationSource?.clip?.name, 'Idle');
  assert.equal(instance.materialVisibility.length, 0);
  assert.ok(instance.animationMappingBySourceKey instanceof Map);
});
