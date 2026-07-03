import assert from 'node:assert/strict';
import test from 'node:test';

import { quat } from '../source/lib/esm/index.js';
import { AnimationController } from '../source/core/animation/animation.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';

function createRotationClip(sourceFormat, sourceBoneName, rotationEulerDegrees) {
  const rotationQuaternion = quaternionFromEulerXYZ(rotationEulerDegrees.map((value) => value * Math.PI / 180));
  return {
    rotationQuaternion,
    clip: {
      name: 'debug-clip',
      timelineFps: 30,
      metadata: {
        sourceFormat,
      },
      channels: [
        {
          target: {
            kind: 'bone',
            name: sourceBoneName,
            path: 'rotation',
          },
          sampler: {
            interpolation: 'LINEAR',
            keyframes: [
              {
                time: 0,
                frameNum: 0,
                value: Array.from(quat.create()),
              },
              {
                time: 1,
                frameNum: 30,
                value: Array.from(rotationQuaternion),
              },
            ],
          },
        },
      ],
    },
  };
}

test('AnimationController.getAnimationDebugRotations samples VMD raw rotation as Euler', () => {
  const controller = new AnimationController({ bones: [] }, { setWeight() {} });
  const { clip, rotationQuaternion } = createRotationClip('vmd', '右腕', [15, 30, -45]);
  controller.setAnimationClip(clip);
  controller.setBoneMappings([
    {
      sourceKind: 'vmd',
      sourceBoneName: '右腕',
      targetBoneName: '右腕',
      targetBoneIndex: 0,
    },
  ]);
  controller.seek(30);

  const entries = controller.getAnimationDebugRotations();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceBoneName, '右腕');
  assert.equal(entries[0].targetBoneName, '右腕');
  const roundTrippedQuaternion = quaternionFromEulerXYZ(entries[0].euler);
  assert.ok(Math.abs(quat.dot(roundTrippedQuaternion, rotationQuaternion)) > 1 - 1e-6);
});

test('AnimationController.getAnimationDebugRotations preserves VRMA source and target names', () => {
  const controller = new AnimationController({ bones: [] }, { setWeight() {} });
  const { clip, rotationQuaternion } = createRotationClip('vrma', 'leftUpperArm', [0, 90, 0]);
  controller.setAnimationClip(clip);
  controller.setBoneMappings([
    {
      sourceKind: 'vrma',
      sourceBoneName: 'leftUpperArm',
      targetBoneName: '左腕',
      targetBoneIndex: 0,
    },
  ]);
  controller.seek(30);

  const entries = controller.getAnimationDebugRotations();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceBoneName, 'leftUpperArm');
  assert.equal(entries[0].targetBoneName, '左腕');
  const roundTrippedQuaternion = quaternionFromEulerXYZ(entries[0].euler);
  assert.ok(Math.abs(quat.dot(roundTrippedQuaternion, rotationQuaternion)) > 1 - 1e-6);
});
