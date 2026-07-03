import assert from 'node:assert/strict';
import test from 'node:test';

import { quat, vec3 } from '../source/lib/esm/index.js';
import { getBoneInfoDisplayEulerXYZ, getBoneInfoDisplayLocalPosition, getBoneInfoDisplayValues, getBoneInfoDisplayWorldPosition, getEffectiveLocalRotation, getLocalPositionFromBoneInfoDisplayPosition, getLocalRotationFromBoneInfoDisplayRotation } from '../source/shared/bones/bone-display-utils.js';
import { selectPreferredElbowEulerY } from '../source/shared/bones/elbow-rotation-utils.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';

test('getEffectiveLocalRotation includes baseRotation for VRM all-parent style bones', () => {
  const baseRotation = quaternionFromEulerXYZ([0, Math.PI, 0]);
  const manualRotation = quaternionFromEulerXYZ([0, 0.25, 0]);
  const animationRotation = quaternionFromEulerXYZ([0.1, 0, -0.2]);
  const local = {
    baseRotation,
    manualRotation,
    rotation: animationRotation,
  };

  const actual = getEffectiveLocalRotation(local);
  const expected = quat.multiply(quat.create(), manualRotation, animationRotation);
  quat.multiply(expected, baseRotation, expected);
  quat.normalize(expected, expected);

  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6);
  }
});

test('getBoneInfoDisplayValues shows local rotation with baseRotation applied', () => {
  const baseRotation = quaternionFromEulerXYZ([0, Math.PI, 0]);
  const manualRotation = quaternionFromEulerXYZ([0, 0.25, 0]);
  const animationRotation = quaternionFromEulerXYZ([0.1, 0, -0.2]);
  const activeInstance = {
    model: {
      bindBones: [
        {
          rotation: quat.create(),
        },
      ],
      bones: [
        {
          name: '全ての親',
        },
      ],
    },
    scene: {
      boneLocalTransforms: [
        {
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          translation: vec3.create(),
          manualTranslation: vec3.create(),
          baseRotation,
          manualRotation,
          rotation: animationRotation,
        },
      ],
    },
  };

  const { rotation } = getBoneInfoDisplayValues(activeInstance, 0, false);
  const expected = quat.multiply(quat.create(), manualRotation, animationRotation);
  quat.multiply(expected, baseRotation, expected);
  quat.normalize(expected, expected);

  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(rotation[i] - expected[i]) < 1e-6);
  }
});

test('getBoneInfoDisplayLocalPosition returns raw local position for VRM hips', () => {
  const activeInstance = {
    model: {
      magic: 'Vrm',
      bindBones: [
        { rotation: quat.create() },
        { rotation: quat.create() },
      ],
      bones: [
        { name: '全ての親' },
        { name: 'Hips' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: vec3.fromValues(1, 0, 1),
          manualTranslation: vec3.create(),
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation: quat.create(),
        },
        {
          translation: vec3.fromValues(1, -1, 1),
          manualTranslation: vec3.create(),
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation: quat.create(),
        },
      ],
    },
  };

  const position = getBoneInfoDisplayLocalPosition(activeInstance, 1);
  assert.deepEqual(Array.from(position), [1, -1, 1]);

  const setterPosition = getLocalPositionFromBoneInfoDisplayPosition(activeInstance, 1, [1, -1, 1]);
  assert.deepEqual(Array.from(setterPosition), [1, -1, 1]);
});

test('getBoneInfoDisplayWorldPosition returns raw world position for VRM hips', () => {
  const hipsWorldMatrix = new Float32Array(16);
  hipsWorldMatrix[12] = 1;
  hipsWorldMatrix[13] = 0.9714602;
  hipsWorldMatrix[14] = 1;
  const activeInstance = {
    model: {
      magic: 'Vrm',
      bindBones: [
        { rotation: quat.create() },
        { rotation: quat.create() },
      ],
      bones: [
        { name: '全ての親', position: [0, 0, 0] },
        { name: 'Hips', position: [0, 1.9714602, 0] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    animationSource: {
      clip: {
        timelineFps: 30,
        metadata: {
          sourceFormat: 'vrma',
        },
        channels: [
          {
            target: { kind: 'bone', name: '全ての親', path: 'translation' },
            sampler: { keyframes: [{ time: 0, value: [1, 0, 1] }] },
          },
        ],
      },
    },
    animationController: {
      currentFrame: 0,
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: vec3.fromValues(1, 0, 1),
          manualTranslation: vec3.create(),
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation: quat.create(),
        },
        {
          translation: vec3.create(),
          manualTranslation: vec3.create(),
          worldMatrix: hipsWorldMatrix,
          worldRotation: quat.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation: quat.create(),
        },
      ],
    },
  };

  assert.deepEqual(
    Array.from(getBoneInfoDisplayWorldPosition(activeInstance, 1)).map((value) => Number(value.toFixed(6))),
    [1, 0.97146, 1],
  );
});

test('getBoneInfoDisplayEulerXYZ projects VRM forearm names to a pure Y display rotation', () => {
  const rotation = quaternionFromEulerXYZ([0.35, 0.8, -0.4]);
  const activeInstance = {
    model: {
      magic: 'Vrm',
      bindBones: [
        {
          rotation: quat.create(),
        },
      ],
      bones: [
        {
          name: 'LeftForeArm',
          localZ: [0, 0, -1],
        },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftLowerArm: 'LeftForeArm',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          translation: vec3.create(),
          manualTranslation: vec3.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation,
          localZ: [0, 0, -1],
        },
      ],
    },
  };

  const actual = getBoneInfoDisplayEulerXYZ(activeInstance, 0, false, [0, 0, 0]);
  const expectedY = selectPreferredElbowEulerY(rotation, activeInstance.scene.boneLocalTransforms[0], [0, 0, 0], activeInstance.model.bones[0]);

  assert.ok(Math.abs(actual[0]) < 1e-6, `expected X to be projected away, got ${actual[0]}`);
  assert.ok(Math.abs(actual[2]) < 1e-6, `expected Z to be projected away, got ${actual[2]}`);
  assert.ok(Math.abs(actual[1]) > 1e-3, `expected Y to remain non-zero, got ${actual[1]}`);
  assert.ok(Math.abs(actual[1] - expectedY) < 1e-6, `expected Y ${expectedY}, got ${actual[1]}`);
});

test('bone info local display rotation round-trips through the bind-basis inverse conversion', () => {
  const displayRotation = quaternionFromEulerXYZ([0.25, -0.4, 0.35]);
  const basisRotation = quaternionFromEulerXYZ([0.3, 0.2, -0.5]);
  const activeInstance = {
    model: {
      bindBones: [
        {
          rotation: basisRotation,
        },
      ],
      bones: [
        {
          name: '右手首',
        },
      ],
    },
    scene: {
      boneLocalTransforms: [
        {
          worldMatrix: new Float32Array(16),
          worldRotation: quat.create(),
          translation: vec3.create(),
          manualTranslation: vec3.create(),
          baseRotation: quat.create(),
          manualRotation: quat.create(),
          rotation: getLocalRotationFromBoneInfoDisplayRotation({
            model: {
              bindBones: [
                {
                  rotation: basisRotation,
                },
              ],
            },
          }, 0, displayRotation),
        },
      ],
    },
  };

  const { rotation } = getBoneInfoDisplayValues(activeInstance, 0, false);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(rotation[i] - displayRotation[i]) < 1e-6);
  }
});
