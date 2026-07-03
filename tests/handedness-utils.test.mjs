import assert from 'node:assert/strict';
import test from 'node:test';

import {
  convertLeftHandedEulerToRightHanded,
  convertLeftHandedPositionToRightHanded,
  convertLeftHandedPositionToRightHandedForVRMA,
  convertLeftHandedQuaternionToRightHanded,
  convertModelToPositiveZFacing,
  markModelAsRightHanded,
} from '../source/infrastructure/loaders/handedness-utils.js';

test('convertLeftHandedPositionToRightHanded flips only Z', () => {
  assert.deepEqual(convertLeftHandedPositionToRightHanded([1, 2, 3]), [1, 2, -3]);
});

test('convertLeftHandedPositionToRightHandedForVRMA flips X and Z', () => {
  assert.deepEqual(convertLeftHandedPositionToRightHandedForVRMA([1, 2, 3]), [-1, 2, -3]);
});

test('convertLeftHandedQuaternionToRightHanded flips X and Y', () => {
  assert.deepEqual(convertLeftHandedQuaternionToRightHanded([1, 2, 3, 4]), [-1, -2, 3, 4]);
  assert.deepEqual(convertLeftHandedQuaternionToRightHanded([1, 2, 3, 0]), [-1, -2, 3, 0]);
});

test('convertLeftHandedEulerToRightHanded flips X and Y', () => {
  assert.deepEqual(convertLeftHandedEulerToRightHanded([1, 2, 3]), [-1, -2, 3]);
});

test('markModelAsRightHanded annotates the model asset context', () => {
  const model = {};
  const result = markModelAsRightHanded(model);

  assert.equal(result, model);
  assert.equal(model.gltfAssetContext?.sourceHandedness, 'right');
});

test('convertModelToPositiveZFacing mirrors model data to +Z', () => {
  const scene = {
    scale: { x: 1, y: 1, z: 1 },
    updateMatrixWorldCalled: false,
    updateMatrixWorld(flag) {
      this.updateMatrixWorldCalled = flag;
    },
  };
  const model = {
    vertices: new Float32Array([
      1, 2, 3,
      4, 5, 6,
      0, 0,
      0, 1, 2, 3,
      0.1, 0.2, 0.3, 0.4,
      1,
      7, 8, 9,
      10, 11, 12,
      13, 14, 15,
      1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
    bones: [
      {
        position: [1, 2, 3],
        tailOffset: [4, 5, 6],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
      },
    ],
    morphs: [
      {
        offsets: [
          { position: [1, 2, 3] },
          { translation: [4, 5, 6] },
          { rotation: [1, 2, 3, 4] },
        ],
      },
    ],
    rigidBodies: [
      {
        position: [1, 2, 3],
        rotation: [4, 5, 6],
      },
    ],
    joints: [
      {
        position: [1, 2, 3],
        rotation: [4, 5, 6],
      },
    ],
    vrm: {
      springBone: {
        colliders: [
          {
            shape: {
              offset: [1, 2, 3],
              tail: [4, 5, 6],
            },
          },
        ],
        springs: [
          {
            joints: [
              {
                gravityDir: [1, 2, 3],
              },
            ],
          },
        ],
      },
    },
    gltfAnimationSources: [
      {
        clip: {
          channels: [
            {
              target: {
                path: 'translation',
                bindTranslation: [1, 2, 3],
              },
              sampler: {
                keyframes: [
                  { value: [1, 2, 3] },
                ],
              },
            },
            {
              target: {
                path: 'rotation',
              },
              sampler: {
                keyframes: [
                  { value: [1, 2, 3, 4] },
                ],
              },
            },
          ],
        },
      },
    ],
    gltfAssetContext: {
      scene,
    },
  };

  const result = convertModelToPositiveZFacing(model);

  assert.equal(result, model);
  assert.deepEqual(Array.from(model.vertices.slice(0, 6)), [1, 2, -3, 4, 5, -6]);
  assert.deepEqual(Array.from(model.indices), [0, 2, 1]);
  assert.deepEqual(model.bones[0].position, [1, 2, -3]);
  assert.deepEqual(model.bones[0].tailOffset, [4, 5, -6]);
  assert.deepEqual(model.bones[0].localX, [1, 0, 0]);
  assert.deepEqual(model.bones[0].localY, [0, 1, 0]);
  assert.deepEqual(model.bones[0].localZ, [0, 0, 1]);
  assert.deepEqual(model.morphs[0].offsets[0].position, [1, 2, -3]);
  assert.deepEqual(model.morphs[0].offsets[1].translation, [4, 5, -6]);
  assert.deepEqual(model.morphs[0].offsets[2].rotation, [-1, -2, 3, 4]);
  assert.deepEqual(model.rigidBodies[0].position, [1, 2, -3]);
  assert.deepEqual(model.rigidBodies[0].rotation, [-4, -5, 6]);
  assert.deepEqual(model.joints[0].position, [1, 2, -3]);
  assert.deepEqual(model.joints[0].rotation, [-4, -5, 6]);
  assert.deepEqual(model.vrm.springBone.colliders[0].shape.offset, [1, 2, -3]);
  assert.deepEqual(model.vrm.springBone.colliders[0].shape.tail, [4, 5, -6]);
  assert.deepEqual(Array.from(model.vrm.springBone.springs[0].joints[0].gravityDir), [1, 2, -3]);
  assert.deepEqual(model.gltfAnimationSources[0].clip.channels[0].target.bindTranslation, [1, 2, -3]);
  assert.deepEqual(model.gltfAnimationSources[0].clip.channels[0].sampler.keyframes[0].value, [1, 2, -3]);
  assert.deepEqual(model.gltfAnimationSources[0].clip.channels[1].sampler.keyframes[0].value, [-1, -2, 3, 4]);
  assert.equal(model.gltfAssetContext.sourceHandedness, 'right');
  assert.equal(scene.scale.z, -1);
  assert.equal(scene.updateMatrixWorldCalled, true);
});
