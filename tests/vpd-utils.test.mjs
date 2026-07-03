import assert from 'node:assert/strict';
import test from 'node:test';

import { applyVpdPoseToInstance, findVpdTargetInstance } from '../source/infrastructure/animation/vpd-utils.js';

test('findVpdTargetInstance matches model names with and without extensions', () => {
  const instance = {
    model: {
      name: '初音ミク',
      bones: [],
    },
    modelPath: 'assets/初音ミク.osm',
  };

  assert.equal(findVpdTargetInstance([instance], '初音ミク.osm'), instance);
  assert.equal(findVpdTargetInstance([instance], 'assets/初音ミク'), instance);
  assert.equal(findVpdTargetInstance([instance], 'Missing'), null);
});

test('applyVpdPoseToInstance resets the current pose and applies matching bones', () => {
  const calls = [];
  const instance = {
    model: {
      name: '初音ミク',
      bones: [
        { name: '右足ＩＫ' },
        { name: '右ひじ' },
        { name: '未使用ボーン' },
      ],
    },
    scene: {},
  };

  const modelManager = {
    resetAllManualTransforms(targetInstance) {
      calls.push(['reset', targetInstance?.model?.name || '']);
    },
    setManualLocalPosition(targetInstance, boneIndex, position) {
      calls.push(['position', boneIndex, Array.from(position)]);
    },
    setManualLocalRotationQuaternion(targetInstance, boneIndex, rotation) {
      calls.push(['rotation', boneIndex, Array.from(rotation)]);
    },
    recomputeBoneMatrices(model, scene) {
      calls.push(['recompute', model?.name || '', scene === instance.scene]);
    },
  };

  const summary = applyVpdPoseToInstance(instance, {
    bones: [
      {
        name: '右足ＩＫ',
        position: [0, 3.45, 0],
        rotation: [0, 0, 0, 1],
      },
      {
        name: '右ひじ',
        position: [0, 0, 0],
        rotation: [0.254777, -0.400929, 0.000063, 0.879969],
      },
    ],
  }, modelManager);

  assert.equal(summary.appliedBoneCount, 2);
  assert.equal(summary.poseBoneCount, 2);
  assert.deepEqual(calls, [
    ['reset', '初音ミク'],
    ['position', 0, [0, 3.45, 0]],
    ['rotation', 0, [0, 0, 0, 1]],
    ['position', 1, [0, 0, 0]],
    ['rotation', 1, [0.254777, -0.400929, 0.000063, 0.879969]],
    ['recompute', '初音ミク', true],
  ]);
});
