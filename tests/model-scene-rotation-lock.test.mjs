import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInitialRotationLocksFromBoneName,
  getPreferredRotationAxisFromBoneName,
} from '../source/core/model/model-scene.js';

test('getPreferredRotationAxisFromBoneName resolves elbow, thumb, knee, and toe axes', () => {
  assert.equal(getPreferredRotationAxisFromBoneName('左ひじ'), 'y');
  assert.equal(getPreferredRotationAxisFromBoneName('右親指1'), 'y');
  assert.equal(getPreferredRotationAxisFromBoneName('左膝'), 'x');
  assert.equal(getPreferredRotationAxisFromBoneName('右つま先'), 'x');
  assert.equal(getPreferredRotationAxisFromBoneName('頭'), null);
});

test('getInitialRotationLocksFromBoneName unlocks only the preferred axis', () => {
  assert.deepEqual(getInitialRotationLocksFromBoneName('左ひじ'), { x: true, y: false, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('右親指1'), { x: true, y: false, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('左膝'), { x: false, y: true, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('右つま先'), { x: false, y: true, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('頭'), { x: false, y: false, z: false });
});

test('VRM humanoid names resolve preferred axes through the VRM map', () => {
  const model = {
    magic: 'Vrm',
    vrm: {
      humanoidBoneNameMap: {
        leftLowerArm: 'LeftLowerArm',
        leftLowerLeg: 'LeftLowerLeg',
        leftIndexProximal: 'LeftIndexProximal',
        head: 'Head',
      },
    },
  };

  assert.equal(getPreferredRotationAxisFromBoneName('LeftLowerArm', model), 'y');
  assert.equal(getPreferredRotationAxisFromBoneName('LeftLowerLeg', model), 'x');
  assert.equal(getPreferredRotationAxisFromBoneName('LeftIndexProximal', model), 'z');
  assert.deepEqual(getInitialRotationLocksFromBoneName('LeftLowerArm', model), { x: true, y: false, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('LeftLowerLeg', model), { x: false, y: true, z: true });
  assert.deepEqual(getInitialRotationLocksFromBoneName('LeftIndexProximal', model), { x: true, y: true, z: false });
  assert.deepEqual(getInitialRotationLocksFromBoneName('Head', model), { x: false, y: false, z: false });
});
