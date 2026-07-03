import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoneEditingService } from '../source/application/editing/bone-editing-service.js';

test('bone editing service applies IK iteration count to loopCount and iteration', () => {
  const ik = {
    boneIndex: 3,
    targetBoneIndex: 5,
    links: [{}],
    loopCount: 1,
    iteration: 1,
  };
  const instance = {
    model: {
      ik: [ik],
    },
    scene: {},
  };
  const refreshCalls = [];
  const aliasCalls = [];
  const service = createBoneEditingService({
    modelManager: {},
    selection: {},
    resolveActiveBoneContext: () => ({
      instance,
      activeBoneIndex: 3,
      bone: {},
    }),
    syncModelIkEntryAliases: (...args) => {
      aliasCalls.push(args);
    },
    refreshSceneIkState: (...args) => {
      refreshCalls.push(args);
    },
  });

  const applied = service.applyIkIterationCount(7.4);

  assert.equal(applied, true);
  assert.equal(ik.loopCount, 7);
  assert.equal(ik.iteration, 7);
  assert.equal(aliasCalls.length, 1);
  assert.deepEqual(aliasCalls[0], [instance.model, 0, ik]);
  assert.equal(refreshCalls.length, 1);
  assert.deepEqual(refreshCalls[0], [instance.scene, instance.model]);
});
