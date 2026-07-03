import assert from 'node:assert/strict';
import test from 'node:test';

import {
  denormalizeVmdFromInternalUnits,
  denormalizeVpdFromInternalUnits,
  normalizeVmdToInternalUnits,
  normalizeVpdToInternalUnits,
} from '../source/infrastructure/units/unit-conversion.js';

test('normalizeVmdToInternalUnits converts MMD translations to meters', () => {
  const source = {
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'Model',
    boneKeyframes: [
      {
        boneName: 'Center',
        frameNum: 0,
        position: [10, 20, 30],
        rotation: [0, 0, 0, 1],
        interpolation: new Uint8Array(64),
      },
    ],
    cameraKeyframes: [
      {
        frameNum: 0,
        distance: 40,
        target: [50, 60, 70],
        rotation: [0, 0, 0],
        interpolation: new Uint8Array(24),
        fov: 45,
        perspective: 1,
      },
    ],
    lightKeyframes: [
      {
        frameNum: 0,
        color: [1, 1, 1],
        position: [80, 90, 100],
        direction: [0, -1, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
    faceKeyframes: [],
    selfShadowKeyframes: [],
  };

  const normalized = normalizeVmdToInternalUnits(source);
  assert.deepEqual(normalized.boneKeyframes[0].position, [1, 2, 3]);
  assert.equal(normalized.cameraKeyframes[0].distance, 4);
  assert.deepEqual(normalized.cameraKeyframes[0].target, [5, 6, 7]);
  assert.equal(normalized.lightKeyframes[0].position, null);
  assert.equal(normalized.lightKeyframes[0].keyedPosition, false);
  assert.deepEqual(Array.from(normalized.lightKeyframes[0].direction), [0, -1, 0]);
  assert.deepEqual(Array.from(normalized.lightKeyframes[0].rotation), [0, 0, 0, 1]);
  assert.deepEqual(
    normalized.animationClip.channels.find((channel) => channel.target.name === 'Center' && channel.target.path === 'translation').sampler.keyframes[0].value,
    [1, 2, 3],
  );
});

test('denormalizeVmdFromInternalUnits restores MMD translations', () => {
  const source = normalizeVmdToInternalUnits({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'Model',
    boneKeyframes: [
      {
        boneName: 'Center',
        frameNum: 0,
        position: [10, 20, 30],
        rotation: [0, 0, 0, 1],
        interpolation: new Uint8Array(64),
      },
    ],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [],
    selfShadowKeyframes: [],
  });

  const denormalized = denormalizeVmdFromInternalUnits(source);
  assert.deepEqual(denormalized.boneKeyframes[0].position, [10, 20, 30]);
});

test('normalizeVpdToInternalUnits converts pose translations to meters', () => {
  const source = {
    modelName: 'Model',
    bones: [
      { name: 'Root', position: [10, 20, 30], rotation: [0, 0, 0, 1] },
    ],
  };

  const normalized = normalizeVpdToInternalUnits(source);
  assert.deepEqual(normalized.bones[0].position, [1, 2, 3]);

  const denormalized = denormalizeVpdFromInternalUnits(normalized);
  assert.deepEqual(denormalized.bones[0].position, [10, 20, 30]);
});
