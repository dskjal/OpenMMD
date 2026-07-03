import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_RIG_CIRCLE_DEFINITIONS, createCustomRigCircleVertices, getCustomRigBoneNames, getCustomRigCircleTargets } from '../source/core/model/custom-rig.js';
import { createManagedScene, installFileFetch } from './runtime-test-helpers.mjs';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { quat, vec3 } from '../source/lib/esm/index.js';
import { loadModelData } from '../source/core/model/model-scene.js';
import { pickCircularHandleHit } from '../source/core/selection/gizmo.js';

globalThis.GPUShaderStage ??= { VERTEX: 1 };
globalThis.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, VERTEX: 4 };

test('getCustomRigBoneNames returns the default custom rig bone names', () => {
  assert.deepEqual(getCustomRigBoneNames(), [
    '全ての親',
    'センター',
    '頭',
    '首',
    '下半身',
    '右腕',
    '右ひじ',
    '左腕',
    '左ひじ',
    'hips',
    'head',
    'leftUpperArm',
    'leftLowerArm',
    'rightUpperArm',
    'rightLowerArm',
  ]);
  assert.equal(CUSTOM_RIG_CIRCLE_DEFINITIONS.length, 16);
});

test('getCustomRigCircleTargets maps registered bones to local-space circles', () => {
  const model = {
    bones: [
      { name: '全ての親' },
      { name: 'センター' },
      { name: '下半身' },
      { name: '右腕' },
      { name: 'unused' },
    ],
  };
  const scene = {
    boneWorldPositions: [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
      [13, 14, 15],
    ],
    boneLocalTransforms: [
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      { worldRotation: quat.create(), localX: [0, 1, 0], localY: [-1, 0, 0], localZ: [0, 0, 1] },
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
    ],
    boneDebugLists: {
      customRigBoneIndexByName: new Map([
        ['全ての親', 0],
        ['センター', 1],
        ['下半身', 2],
        ['右腕', 3],
      ]),
    },
  };

  const targets = getCustomRigCircleTargets({ model, scene });

  assert.equal(targets.length, 4);
  assert.deepEqual(targets.map((target) => target.boneName), ['全ての親', 'センター', '下半身', '右腕']);
  assertVectorClose(targets[1].center, [4, 5, 6]);
  assert.deepEqual(targets[2].color, [0.5, 0, 0.5]);
  assertVectorClose(targets[3].center, [10, 11.1, 12]);
  assert.equal(targets[3].radius, 0.1);
  assert.deepEqual(targets[3].rotation, [0, 0, 90]);
});

test('getCustomRigCircleTargets returns no targets for hidden instances', () => {
  const model = {
    bones: [
      { name: '全ての親' },
    ],
  };
  const scene = {
    boneWorldPositions: [
      [1, 2, 3],
    ],
    boneLocalTransforms: [
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
    ],
    boneDebugLists: {
      customRigBoneIndexByName: new Map([
        ['全ての親', 0],
      ]),
    },
  };

  const targets = getCustomRigCircleTargets({ model, scene, visible: false });

  assert.deepEqual(targets, []);
});

test('Alicia_solid.pmx custom rig offsets for 右腕 and 右ひじ use local axes', async () => {
  await installFileFetch();
  const { model } = await loadModelData(null, 1, './test-data/Alicia_solid.pmx');
  const scene = createManagedScene(model);
  const rightArmIndex = model.bones.findIndex((bone) => bone.name === '右腕');
  assert.ok(rightArmIndex >= 0, 'expected 右腕 to exist in Alicia_solid.pmx');

  const targets = getCustomRigCircleTargets({ model, scene });
  for (const boneName of ['右腕', '右ひじ']) {
    const boneIndex = model.bones.findIndex((bone) => bone.name === boneName);
    const target = targets.find((entry) => entry.boneName === boneName);
    assert.ok(boneIndex >= 0, `expected ${boneName} to exist in Alicia_solid.pmx`);
    assert.ok(target, `expected custom rig target for ${boneName}`);

    const localTransform = scene.boneLocalTransforms[boneIndex];
    const position = scene.boneWorldPositions[boneIndex];
    const expectedOffset = transformLocalOffset(localTransform, [0.1, 0, 0]);
    const expectedCenter = [
      position[0] + expectedOffset[0],
      position[1] + expectedOffset[1],
      position[2] + expectedOffset[2],
    ];

    assertVectorClose(target.center, expectedCenter);
    assert.notDeepEqual(target.center, [
      position[0] + 1,
      position[1],
      position[2],
    ]);
  }
});

test('getCustomRigCircleTargets rotates both offset and circle plane in the posed local basis', () => {
  const worldRotation = quaternionFromEulerXYZ([0, Math.PI / 2, 0]);
  const model = {
    bones: [
      { name: '右腕' },
    ],
  };
  const scene = {
    boneWorldPositions: [
      [3, 4, 5],
    ],
    boneLocalTransforms: [
      {
        worldRotation,
        localX: new Float32Array([1, 0, 0]),
        localY: new Float32Array([0, 1, 0]),
        localZ: new Float32Array([0, 0, 1]),
      },
    ],
    boneDebugLists: {
      customRigBoneIndexByName: new Map([
        ['右腕', 0],
      ]),
    },
  };

  const targets = getCustomRigCircleTargets({ model, scene });
  assert.equal(targets.length, 1);

  const expectedOffset = transformLocalOffset(scene.boneLocalTransforms[0], [0.1, 0, 0]);
  assertVectorClose(targets[0].center, [
    3 + expectedOffset[0],
    4 + expectedOffset[1],
    5 + expectedOffset[2],
  ]);

  const expectedRotation = quat.multiply(
    quat.create(),
    createCircleBaseRotation(scene.boneLocalTransforms[0]),
    quaternionFromEulerXYZ([0, 0, Math.PI / 2]),
  );
  const expectedNormal = vec3.transformQuat(vec3.create(), [0, 1, 0], expectedRotation);
  assertVectorClose(targets[0].normal, expectedNormal);

  const wrongRotation = quat.multiply(
    quat.create(),
    quaternionFromEulerXYZ([0, 0, Math.PI / 2]),
    createCircleBaseRotation(scene.boneLocalTransforms[0]),
  );
  const wrongNormal = vec3.transformQuat(vec3.create(), [0, 1, 0], wrongRotation);
  assert.notDeepEqual(Array.from(targets[0].normal), Array.from(wrongNormal));
});

test('createCustomRigCircleVertices rotates the circle plane without moving its center', () => {
  const rotated = createCustomRigCircleVertices([0, 0, 0], [0, 0, 0], quaternionFromEulerXYZ([0, 0, Math.PI / 2]), 1, [1, 0, 0], 4);
  const unrotated = createCustomRigCircleVertices([0, 0, 0], [0, 0, 0], quaternionFromEulerXYZ([0, 0, 0]), 1, [1, 0, 0], 4);

  assertVectorClose(rotated.slice(0, 3), [0, 1, 0]);
  assertVectorClose(unrotated.slice(0, 3), [1, 0, 0]);
});

test('custom rig circles fall back to box hits when the view is edge-on', () => {
  const model = {
    bones: [
      { name: '全ての親' },
    ],
  };
  const scene = {
    boneWorldPositions: [
      [0, 0, 0],
    ],
    boneLocalTransforms: [
      { worldRotation: quat.create(), localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
    ],
    boneDebugLists: {
      customRigBoneIndexByName: new Map([
        ['全ての親', 0],
      ]),
    },
  };

  const target = getCustomRigCircleTargets({ model, scene })[0];
  const hit = pickCircularHandleHit(
    {
      start: [0.2, 0, 3],
      end: [0.2, 0, -3],
    },
    target.center,
    target.normal,
    'custom',
    target.radius,
    0.2,
    'custom-select',
  );

  assert.ok(hit);
  assert.equal(hit.dragKind, 'edge-on-ring');
  assert.equal(hit.axis, 'custom');
});

/**
 * ボーンの現在姿勢でオフセットを変換します。
 * @param {object} localTransform - ボーンのローカル変換状態。
 * @param {ArrayLike<number>} offset - ローカル座標のオフセット。
 * @returns {Array<number>} ワールド座標のオフセット。
 */
function transformLocalOffset(localTransform, offset) {
  const transformedOffset = vec3.transformQuat(vec3.create(), offset, createCircleBaseRotation(localTransform));
  return [transformedOffset[0], transformedOffset[1], transformedOffset[2]];
}

/**
 * カスタムリグ円の基底回転を計算します。
 * @param {object} localTransform - ボーンのローカル変換状態。
 * @returns {quat} 基底回転。
 */
function createCircleBaseRotation(localTransform) {
  const basisMat = [
    localTransform.localX?.[0] || 0, localTransform.localX?.[1] || 0, localTransform.localX?.[2] || 0,
    localTransform.localY?.[0] || 0, localTransform.localY?.[1] || 0, localTransform.localY?.[2] || 0,
    localTransform.localZ?.[0] || 0, localTransform.localZ?.[1] || 0, localTransform.localZ?.[2] || 0,
  ];
  const basisRotation = quat.fromMat3(quat.create(), basisMat);
  return quat.multiply(quat.create(), localTransform.worldRotation || quat.create(), basisRotation);
}


/**
 * 3D ベクトルを比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [tolerance=1e-6] - 許容誤差。
 */
function assertVectorClose(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `vector mismatch at ${i}: actual=${actual[i]} expected=${expected[i]}`);
  }
}
