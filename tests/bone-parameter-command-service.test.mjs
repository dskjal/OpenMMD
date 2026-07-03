import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoneParameterCommandService } from '../source/application/editing/bone-parameter-command-service.js';

test('bone parameter command service applies local position changes to the active instance', () => {
  const calls = [];
  const instance = {
    model: {
      name: 'Alicia',
      bones: [
        { name: 'センター' },
      ],
    },
    scene: {},
  };
  const modelManager = {
    instances: [instance],
    setManualLocalPosition(targetInstance, boneIndex, value) {
      calls.push(['local-position', targetInstance, boneIndex, value]);
    },
    recomputeBoneMatrices(model, scene) {
      calls.push(['recompute', model, scene]);
    },
    writeBoneMatrices(scene) {
      calls.push(['write', scene]);
    },
  };
  const service = createBoneParameterCommandService({
    modelManager,
    getActiveInstance: () => instance,
  });

  service.applyPayload({
    targets: [
      {
        boneName: 'センター',
        kind: 'position',
        space: 'local',
        value: [1, 2, 3],
      },
    ],
  });

  assert.deepEqual(calls[0], ['local-position', instance, 0, [1, 2, 3]]);
  assert.equal(calls[1][0], 'recompute');
  assert.equal(calls[2][0], 'write');
});
