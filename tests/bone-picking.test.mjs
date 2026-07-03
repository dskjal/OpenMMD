import assert from 'node:assert/strict';
import test from 'node:test';

import { getBoneTailPosition } from '../source/core/selection/bone-picking.js';

test('getBoneTailPosition overrides wrong VRM leg and foot tailIndex values with humanoid chain children', () => {
  const model = {
    magic: 'Vrm',
    vrm: {
      humanoidBoneNameMap: {
        leftUpperLeg: 'LeftUpperLeg',
        leftLowerLeg: 'LeftLowerLeg',
        leftFoot: 'LeftFoot',
        leftToes: 'LeftToes',
        rightUpperLeg: 'RightUpperLeg',
        rightLowerLeg: 'RightLowerLeg',
        rightFoot: 'RightFoot',
        rightToes: 'RightToes',
      },
    },
    bones: [
      { name: 'LeftUpperLeg', vrmHumanoidBoneName: 'leftUpperLeg', parentIndex: -1, tailIndex: 1 },
      { name: 'LeftLegHelper', parentIndex: 0 },
      { name: 'LeftLowerLeg', vrmHumanoidBoneName: 'leftLowerLeg', parentIndex: 0, tailIndex: 3 },
      { name: 'LeftLowerLegTwist', parentIndex: 2 },
      { name: 'LeftFoot', vrmHumanoidBoneName: 'leftFoot', parentIndex: 2, tailIndex: 5 },
      { name: 'LeftToesHelper', parentIndex: 4 },
      { name: 'LeftToes', vrmHumanoidBoneName: 'leftToes', parentIndex: 4 },
      { name: 'RightUpperLeg', vrmHumanoidBoneName: 'rightUpperLeg', parentIndex: -1, tailIndex: 8 },
      { name: 'RightLegHelper', parentIndex: 7 },
      { name: 'RightLowerLeg', vrmHumanoidBoneName: 'rightLowerLeg', parentIndex: 7, tailIndex: 10 },
      { name: 'RightLowerLegTwist', parentIndex: 7 },
      { name: 'RightFoot', vrmHumanoidBoneName: 'rightFoot', parentIndex: 9, tailIndex: 12 },
      { name: 'RightToesHelper', parentIndex: 11 },
      { name: 'RightToes', vrmHumanoidBoneName: 'rightToes', parentIndex: 11 },
    ],
  };
  const scene = {
    boneCount: model.bones.length,
    boneWorldPositions: [
      [0, 10, 0],
      [1, 9, 0],
      [0, 8, 0],
      [1, 7, 0],
      [0, 6, 0],
      [1, 5, 0],
      [0, 5, 0],
      [2, 10, 0],
      [3, 9, 0],
      [2, 8, 0],
      [3, 7, 0],
      [2, 6, 0],
      [3, 5, 0],
      [2, 5, 0],
    ],
  };

  assert.deepEqual(getBoneTailPosition(model, scene, 0), [0, 8, 0]);
  assert.deepEqual(getBoneTailPosition(model, scene, 2), [0, 6, 0]);
  assert.deepEqual(getBoneTailPosition(model, scene, 4), [0, 5, 0]);
  assert.deepEqual(getBoneTailPosition(model, scene, 7), [2, 8, 0]);
  assert.deepEqual(getBoneTailPosition(model, scene, 9), [2, 6, 0]);
  assert.deepEqual(getBoneTailPosition(model, scene, 11), [2, 5, 0]);
});

test('getBoneTailPosition falls back to the first child for non VRM models', () => {
  const model = {
    bones: [
      { name: 'Parent', parentIndex: -1 },
      { name: 'HelperChild', parentIndex: 0 },
      { name: 'TargetChild', parentIndex: 0 },
    ],
  };
  const scene = {
    boneCount: model.bones.length,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  };

  assert.deepEqual(getBoneTailPosition(model, scene, 0), [1, 0, 0]);
});
