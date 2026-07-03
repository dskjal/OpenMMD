import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeIkSetup,
  rebuildModelIkLinks,
  removeRuntimeIkSetup,
  resolveDefaultIkOperationParentBoneIndex,
  refreshSceneIkState,
  updateRuntimeIkTargetRestPosition,
} from '../source/core/model/model-scene.js';

/**
 * ランタイム IK テスト用のボーンを作成します。
 * @param {string} name - ボーン名。
 * @param {number} parentIndex - 親ボーン index。
 * @param {number[]} position - ボーン位置。
 * @param {number} transformLevel - 変形階層。
 * @returns {object} ボーンデータ。
 */
function createBone(name, parentIndex, position, transformLevel) {
  return {
    name,
    nameEn: '',
    parentIndex,
    transformLevel,
    type: 0,
    position: [...position],
    localX: [1, 0, 0],
    localY: [0, 1, 0],
    localZ: [0, 0, 1],
    flags: 0x0002 | 0x0004 | 0x0008,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    ikTargetIndex: -1,
  };
}

/**
 * ランタイム IK テスト用の PMX 風モデルを作成します。
 * @returns {object} モデルデータ。
 */
function createRuntimeIkTestModel() {
  const bones = [
    createBone('全ての親', -1, [0, 20, 0], 0),
    createBone('左足', 0, [0, 15, 0], 1),
    createBone('左ひざ', 1, [0, 10, 0], 2),
    createBone('左足首', 2, [0, 5, 0], 3),
    createBone('左つま先', 3, [0, 0, 0], 4),
    createBone('左腕', 0, [3, 16, 0], 1),
    createBone('左ひじ', 5, [5, 16, 0], 2),
    createBone('左手首', 6, [7, 16, 0], 3),
  ];
  return {
    magic: 'Pmx',
    bones,
    ik: [],
    iks: [],
    rigidBodies: [],
    joints: [],
    morphs: [],
    materials: [],
    textures: [],
    textureColorSpaces: [],
    customRigBones: [],
    bindBones: bones.map((bone) => ({
      position: [...bone.position],
      rotation: [0, 0, 0, 1],
    })),
    runtimeBoneBaseCount: bones.length,
  };
}

test('createRuntimeIkSetup creates a runtime IK bone under 全ての親 and targets the setup bone child', () => {
  const model = createRuntimeIkTestModel();

  const result = createRuntimeIkSetup(model, { setupBoneIndex: 2 });

  assert.equal(result.setupBoneIndex, 2);
  assert.equal(result.effectorBoneIndex, 3);
  assert.equal(model.bones.length, 9);
  assert.equal(model.ik.length, 1);
  assert.equal(model.iks.length, 1);
  assert.equal(result.ikBoneIndex, 8);
  assert.equal(model.bones[8].name, '左ひざIK');
  assert.equal(model.bones[8].parentIndex, 0);
  assert.deepEqual(model.bones[8].position, [0, 5, 0]);
  assert.deepEqual(model.bones[8].localZ, [0, 0, -1]);
  assert.deepEqual(model.bones[8].tailOffset, [0, 0, -0.1]);
  assert.equal(model.bones[8].runtimeGeneratedIkBone, true);
  assert.deepEqual(model.bones[8].ikRotationLocks, { x: false, y: false, z: false });
  assert.equal(model.ik[0].boneIndex, 8);
  assert.equal(model.ik[0].targetBoneIndex, 3);
  assert.equal(model.ik[0].loopCount, 400);
  assert.equal(model.ik[0].iteration, 400);
  assert.deepEqual(model.ik[0].links.map((link) => link.boneIndex), [2]);
  assert.equal(model.ik[0].runtimeSetupBoneIndex, 2);
});

test('createRuntimeIkSetup uses 全ての親 as the default parent for VRM models', () => {
  const model = {
    magic: 'Vrm',
    vrm: {
      humanoidBoneNameMap: {
        hips: 'Hips',
      },
    },
    bones: [
      createBone('全ての親', -1, [0, 20, 0], 0),
      createBone('Hips', 0, [0, 15, 0], 1),
      createBone('左足', 1, [0, 10, 0], 2),
      createBone('左ひざ', 2, [0, 5, 0], 3),
      createBone('左足首', 3, [0, 0, 0], 4),
    ],
    ik: [],
    iks: [],
    rigidBodies: [],
    joints: [],
    morphs: [],
    materials: [],
    textures: [],
    textureColorSpaces: [],
    customRigBones: [],
    bindBones: [],
    runtimeBoneBaseCount: 5,
  };

  const result = createRuntimeIkSetup(model, { setupBoneIndex: 3 });

  assert.equal(result.ikBoneIndex, 5);
  assert.equal(model.bones[result.ikBoneIndex].parentIndex, 0);
  assert.equal(model.bones[result.ikBoneIndex].name, '左ひざIK');
  assert.equal(model.ik[0].boneIndex, result.ikBoneIndex);
  assert.equal(model.ik[0].targetBoneIndex, 4);
});

test('createRuntimeIkSetup prefers the VRM humanoid leg chain child over helper children', () => {
  const model = {
    magic: 'Vrm',
    vrm: {
      humanoidBoneNameMap: {
        hips: 'Hips',
        leftUpperLeg: 'LeftUpperLeg',
        leftLowerLeg: 'LeftLowerLeg',
        leftFoot: 'LeftFoot',
      },
    },
    bones: [
      createBone('全ての親', -1, [0, 20, 0], 0),
      createBone('Hips', 0, [0, 15, 0], 1),
      createBone('LeftUpperLeg', 1, [0, 10, 0], 2),
      createBone('LegHelper', 2, [1, 9, 0], 3),
      createBone('LeftLowerLeg', 2, [0, 5, 0], 3),
      createBone('CoatHelper', 4, [1, 4, 0], 4),
      createBone('LeftFoot', 4, [0, 0, 0], 4),
    ],
    ik: [],
    iks: [],
    rigidBodies: [],
    joints: [],
    morphs: [],
    materials: [],
    textures: [],
    textureColorSpaces: [],
    customRigBones: [],
    bindBones: [],
    runtimeBoneBaseCount: 7,
  };
  model.bones[2].vrmHumanoidBoneName = 'leftUpperLeg';
  model.bones[4].vrmHumanoidBoneName = 'leftLowerLeg';
  model.bones[6].vrmHumanoidBoneName = 'leftFoot';

  const upperLegResult = createRuntimeIkSetup(model, { setupBoneIndex: 2 });
  const lowerLegResult = createRuntimeIkSetup(model, { setupBoneIndex: 4 });

  assert.equal(upperLegResult.effectorBoneIndex, 4);
  assert.equal(model.ik[upperLegResult.ikIndex].targetBoneIndex, 4);
  assert.deepEqual(model.bones[upperLegResult.ikBoneIndex].position, [0, 5, 0]);
  assert.equal(lowerLegResult.effectorBoneIndex, 6);
  assert.equal(model.ik[lowerLegResult.ikIndex].targetBoneIndex, 6);
  assert.deepEqual(model.bones[lowerLegResult.ikBoneIndex].position, [0, 0, 0]);
});

test('removeRuntimeIkSetup removes a middle runtime IK bone and reindexes the remaining runtime IK', () => {
  const model = createRuntimeIkTestModel();

  createRuntimeIkSetup(model, { setupBoneIndex: 2 });
  createRuntimeIkSetup(model, { setupBoneIndex: 6 });
  const removed = removeRuntimeIkSetup(model, { ikIndex: 0 });

  assert.equal(removed.setupBoneIndex, 2);
  assert.equal(model.bones.length, 9);
  assert.equal(model.ik.length, 1);
  assert.equal(model.iks.length, 1);
  assert.equal(model.ik[0].boneIndex, 8);
  assert.equal(model.bones[8].name, '左ひじIK');
  assert.equal(model.bones[8].runtimeIkSetupBoneIndex, 6);
  assert.equal(model.ik[0].runtimeSetupBoneIndex, 6);
  assert.deepEqual(model.ik[0].links.map((link) => link.boneIndex), [6]);
});

test('updateRuntimeIkTargetRestPosition moves the runtime IK bone rest pose to the new target bone position', () => {
  const model = createRuntimeIkTestModel();

  const result = createRuntimeIkSetup(model, { setupBoneIndex: 2 });
  const updated = updateRuntimeIkTargetRestPosition(model, {
    ikIndex: result.ikIndex,
    targetBoneIndex: 6,
  });

  assert.equal(updated.ikBoneIndex, result.ikBoneIndex);
  assert.equal(updated.setupBoneIndex, 2);
  assert.equal(updated.effectorBoneIndex, 6);
  assert.deepEqual(Array.from(updated.targetPosition), [5, 16, 0]);
  assert.deepEqual(Array.from(model.bones[result.ikBoneIndex].position), [5, 16, 0]);
  assert.deepEqual(model.bones[result.ikBoneIndex].tailOffset, [0, 0, -0.1]);
  assert.equal(model.bones[result.ikBoneIndex].runtimeIkEffectorBoneIndex, 6);
  assert.equal(model.ik[0].targetBoneIndex, 6);
  assert.deepEqual(Array.from(model.bindBones[result.ikBoneIndex].position), [5, 16, 0]);
});

test('refreshSceneIkState keeps runtime IK effector on the target bone and rebuildModelIkLinks uses target-bone ancestors', () => {
  const model = createRuntimeIkTestModel();
  const result = createRuntimeIkSetup(model, { setupBoneIndex: 2 });

  rebuildModelIkLinks(model, model.ik[result.ikIndex], 2);

  const scene = refreshSceneIkState({}, model);

  assert.equal(scene.ikChains[0].effectorBoneIndex, 3);
  assert.equal(scene.ikChains[0].rotationTargetBoneIndex, 3);
  assert.equal(scene.ikChains[0].runtimeGeneratedIk, true);
  assert.equal(scene.ikChains[0].distanceEpsilon, 1e-5);
  assert.equal(scene.ikTargets[0].effectorBoneIndex, 3);
  assert.deepEqual(scene.ikChains[0].links.map((link) => link.boneIndex), [1, 2]);
});

test('resolveDefaultIkOperationParentBoneIndex prefers VRM all-parent and glTF dummy bone', () => {
  const vrmModel = {
    magic: 'Vrm',
    vrm: {
      humanoidBoneNameMap: {
        hips: 'Hips',
      },
    },
    bones: [
      createBone('全ての親', -1, [0, 0, 0], 0),
      createBone('Hips', 0, [0, 10, 0], 1),
    ],
  };
  const gltfModel = {
    magic: 'Gltf',
    dummyBoneIndex: 0,
    bones: [
      createBone('Root', -1, [0, 0, 0], 0),
      createBone('Child', 0, [0, 1, 0], 1),
    ],
  };

  assert.equal(resolveDefaultIkOperationParentBoneIndex(vrmModel), 0);
  assert.equal(resolveDefaultIkOperationParentBoneIndex(gltfModel), 0);
});
