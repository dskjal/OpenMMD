import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoneEditingService } from '../source/application/editing/bone-editing-service.js';

test('bone editing service reset helpers use partial manual reset APIs', () => {
  const calls = [];
  const instance = { id: 'model-0' };
  const modelManager = {
    resetManualTranslation: (...args) => {
      calls.push(['translation', ...args]);
    },
    resetManualRotation: (...args) => {
      calls.push(['rotation', ...args]);
    },
    resetManualTransform: () => {
      calls.push(['transform']);
    },
  };
  const service = createBoneEditingService({
    modelManager,
    getBoneEditTargets: () => [
      { instance, boneIndex: 2 },
      { instance, boneIndex: 5 },
    ],
  });

  assert.equal(service.resetBoneTranslation(), true);
  assert.equal(service.resetBoneRotation(), true);
  assert.deepEqual(calls, [
    ['translation', instance, 2],
    ['translation', instance, 5],
    ['rotation', instance, 2],
    ['rotation', instance, 5],
  ]);
});
