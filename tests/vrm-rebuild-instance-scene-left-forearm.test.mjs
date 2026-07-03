import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import { quat } from '../source/lib/esm/index.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { createRuntimeIkSetup, createSceneState, loadModelDataFromFile } from '../source/core/model/model-scene.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  STORAGE: 8,
};
globalThis.GPUShaderStage ??= {
  VERTEX: 1,
  FRAGMENT: 2,
};
globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
};

test('rebuildInstanceScene keeps the VRM leftLowerArm worldRotation stable for AliciaSolid.vrm after runtime IK creation', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const device = createMockDevice();
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(device, model);
    const instance = { model, scene, pipelineResources: {} };
    scene.modelManager = manager;
    manager.instances = [instance];

    manager.recomputeBoneMatrices(model, scene);

    const allParentIndex = model.bones.findIndex((bone) => bone.name === '全ての親');
    assert.notEqual(allParentIndex, -1, '全ての親 bone should exist in AliciaSolid.vrm');

    const leftLowerArmBoneName = model.vrm?.humanoidBoneNameMap?.leftLowerArm;
    const leftForeArmIndex = model.bones.findIndex((bone) => bone.name === leftLowerArmBoneName);
    assert.notEqual(leftLowerArmBoneName, '', 'leftLowerArm humanoid mapping should exist in AliciaSolid.vrm');
    assert.notEqual(leftForeArmIndex, -1, 'leftLowerArm bone should exist in AliciaSolid.vrm');

    const allParentWorldPositionBefore = [...scene.boneWorldPositions[allParentIndex]];
    const leftForeArmWorldPositionBefore = [...scene.boneWorldPositions[leftForeArmIndex]];
    const allParentBefore = quat.clone(scene.boneLocalTransforms[allParentIndex].worldRotation);
    const before = quat.clone(scene.boneLocalTransforms[leftForeArmIndex].worldRotation);
    const previousBones = model.bones.slice();

    createRuntimeIkSetup(model, {
      setupBoneIndex: leftForeArmIndex,
    });
    manager.rebuildInstanceScene(instance, null, previousBones);

    const allParentAfter = instance.scene.boneLocalTransforms[allParentIndex].worldRotation;
    assertQuaternionClose(allParentAfter, allParentBefore);

    const after = instance.scene.boneLocalTransforms[leftForeArmIndex].worldRotation;
    assertQuaternionClose(after, before);
    assertVectorClose(instance.scene.boneWorldPositions[allParentIndex], allParentWorldPositionBefore);
    assertVectorClose(instance.scene.boneWorldPositions[leftForeArmIndex], leftForeArmWorldPositionBefore);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('UI から IK を作成しても 全ての親 の worldRotation は変化しない', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const device = createMockDevice();
    const modelManager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(device, model);
    const instance = { model, scene, pipelineResources: {} };
    scene.modelManager = modelManager;
    modelManager.instances = [instance];

    modelManager.recomputeBoneMatrices(model, scene);

    const allParentIndex = model.bones.findIndex((bone) => bone.name === '全ての親');
    assert.notEqual(allParentIndex, -1, '全ての親 bone should exist in AliciaSolid.vrm');
    assert.equal(allParentIndex, 0, '全ての親 should be the root bone in AliciaSolid.vrm');

    const leftLowerArmBoneName = model.vrm?.humanoidBoneNameMap?.leftLowerArm;
    const leftForeArmIndex = model.bones.findIndex((bone) => bone.name === leftLowerArmBoneName);
    assert.notEqual(leftLowerArmBoneName, '', 'leftLowerArm humanoid mapping should exist in AliciaSolid.vrm');
    assert.notEqual(leftForeArmIndex, -1, 'leftLowerArm bone should exist in AliciaSolid.vrm');

    const before = quat.clone(modelManager.instances[0].scene.boneLocalTransforms[0].worldRotation);
    const previousBones = model.bones.slice();

    createRuntimeIkSetup(model, {
      setupBoneIndex: leftForeArmIndex,
    });
    modelManager.rebuildInstanceScene(instance, null, previousBones);

    const after = modelManager.instances[0].scene.boneLocalTransforms[0].worldRotation;
    assertQuaternionClose(after, before);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('addModelFile と update を含むブラウザ寄りの経路でも clean state では 全ての親 の worldRotation は変化しない', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  globalThis.fetch = createFileFetch();

  try {
    const modelManager = new ModelManager(createMockDevice(), {}, 'bgra8unorm', 1, {});
    const instance = await modelManager.addModelFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const allParentIndex = findBoneIndexByNameOrThrow(instance.model, '全ての親');
    const leftForeArmIndex = findLeftLowerArmBoneIndexOrThrow(instance.model);
    const before = quat.clone(instance.scene.boneLocalTransforms[allParentIndex].worldRotation);
    const previousBones = instance.model.bones.slice();

    createRuntimeIkSetup(instance.model, {
      setupBoneIndex: leftForeArmIndex,
    });
    modelManager.rebuildInstanceScene(instance, null, previousBones);
    modelManager.update(null, { activeInstanceIndex: 0 }, 1, null, null);

    const after = instance.scene.boneLocalTransforms[allParentIndex].worldRotation;
    assertQuaternionClose(after, before);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('scene が保持していた VRM root baseRotation と model.bones の baseRotationQuaternion が rebuild 前にずれると 全ての親 の worldRotation は model 側へ再同期される', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const modelManager = new ModelManager(createMockDevice(), {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(modelManager.device, model);
    const instance = createRuntimeTestInstance(model, scene);
    scene.modelManager = modelManager;
    modelManager.instances = [instance];
    modelManager.recomputeBoneMatrices(model, scene);

    const allParentIndex = findBoneIndexByNameOrThrow(model, '全ての親');
    const leftForeArmIndex = findLeftLowerArmBoneIndexOrThrow(model);
    const before = quat.clone(scene.boneLocalTransforms[allParentIndex].worldRotation);
    assert.deepEqual(Array.from(before), [0, 0, 0, 1]);

    // scene 側だけを非 identity にして、rebuild が model 側の baseRotation を採ることを確認する。
    model.bones[allParentIndex].baseRotationQuaternion = [0, 0, 0, 1];

    const previousBones = model.bones.slice();
    createRuntimeIkSetup(model, {
      setupBoneIndex: leftForeArmIndex,
    });
    modelManager.rebuildInstanceScene(instance, null, previousBones);

    const after = instance.scene.boneLocalTransforms[allParentIndex].worldRotation;
    assert.deepEqual(Array.from(after), [0, 0, 0, 1]);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('root worldRotation は scene state だけでなく model.bones[全ての親].baseRotationQuaternion の影響を受ける', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const stable = await rebuildWithRootNormalizationState({
      sceneBaseRotation: [0, 0, 0, 1],
      modelBaseRotationQuaternion: [0, 0, 0, 1],
    });
    assert.deepEqual(Array.from(stable.beforeWorldRotation), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(stable.afterWorldRotation), [0, 0, 0, 1]);

    const flipped = await rebuildWithRootNormalizationState({
      sceneBaseRotation: [0, 1, 0, 0],
      modelBaseRotationQuaternion: [0, 0, 0, 1],
    });
    assert.deepEqual(Array.from(flipped.beforeWorldRotation), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(flipped.afterWorldRotation), [0, 0, 0, 1]);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

/**
 * ローカルファイルを読む File 互換オブジェクトを作成します。
 * @param {string} filePath - ファイルパス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} File 互換オブジェクト。
 */
function createFileLike(filePath) {
  return {
    name: filePath,
    async arrayBuffer() {
      const buffer = await fs.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

/**
 * ローカルファイルを返す fetch モックを作成します。
 * @returns {(input: string|URL) => Promise<object>} fetch 互換関数。
 */
function createFileFetch() {
  return async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(input, `file:///${process.cwd().replace(/\\/g, '/')}/`);
    const buffer = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async arrayBuffer() {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
      async text() {
        return buffer.toString('utf8');
      },
    };
  };
}

/**
 * テスト用の最小 instance を作成します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @returns {object} instance 互換オブジェクト。
 */
function createRuntimeTestInstance(model, scene) {
  return {
    model,
    scene,
    pipelineResources: {},
    morphController: {
      vmBuffer: { destroy() {} },
      update() {},
      resetPose() {},
      materialStates: [],
      modifiedMaterials: new Set(),
      previousModifiedMaterials: new Set(),
      dirty: false,
    },
    animationController: {
      jumped: false,
      currentFrame: 0,
      timelineFps: 30,
      update() {},
    },
    selectedTextureIndices: [],
    materialVisibility: [],
    ssssMaterialVisibility: [],
    materialCastShadow: [],
  };
}

/**
 * 左前腕ボーン index を返します。
 * @param {object} model - モデルデータ。
 * @returns {number} ボーン index。
 */
function findLeftLowerArmBoneIndexOrThrow(model) {
  const leftLowerArmBoneName = model.vrm?.humanoidBoneNameMap?.leftLowerArm;
  const leftForeArmIndex = model.bones.findIndex((bone) => bone.name === leftLowerArmBoneName);
  assert.notEqual(leftLowerArmBoneName, '', 'leftLowerArm humanoid mapping should exist in AliciaSolid.vrm');
  assert.notEqual(leftForeArmIndex, -1, 'leftLowerArm bone should exist in AliciaSolid.vrm');
  return leftForeArmIndex;
}

/**
 * ボーン名から index を取得します。
 * @param {object} model - モデルデータ。
 * @param {string} boneName - ボーン名。
 * @returns {number} ボーン index。
 */
function findBoneIndexByNameOrThrow(model, boneName) {
  const boneIndex = model.bones.findIndex((bone) => bone.name === boneName);
  assert.notEqual(boneIndex, -1, `${boneName} bone should exist in AliciaSolid.vrm`);
  return boneIndex;
}

/**
 * root baseRotation 関連 state を差し替えて rebuild 前後を比較します。
 * @param {{sceneBaseRotation: number[], modelBaseRotationQuaternion: number[]}} options - 差し替え値。
 * @returns {Promise<{beforeWorldRotation: quat, afterWorldRotation: quat}>} 比較結果。
 */
async function rebuildWithRootNormalizationState(options) {
  const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
  const modelManager = new ModelManager(createMockDevice(), {}, 'bgra8unorm', 1, {});
  const scene = createSceneState(modelManager.device, model);
  const instance = createRuntimeTestInstance(model, scene);
  scene.modelManager = modelManager;
  modelManager.instances = [instance];
  modelManager.recomputeBoneMatrices(model, scene);

  const allParentIndex = findBoneIndexByNameOrThrow(model, '全ての親');
  const leftForeArmIndex = findLeftLowerArmBoneIndexOrThrow(model);
  quat.copy(scene.boneLocalTransforms[allParentIndex].baseRotation, options.sceneBaseRotation);
  model.bones[allParentIndex].baseRotationQuaternion = [...options.modelBaseRotationQuaternion];
  modelManager.recomputeBoneMatrices(model, scene);

  const beforeWorldRotation = quat.clone(scene.boneLocalTransforms[allParentIndex].worldRotation);
  const previousBones = model.bones.slice();
  createRuntimeIkSetup(model, {
    setupBoneIndex: leftForeArmIndex,
  });
  modelManager.rebuildInstanceScene(instance, null, previousBones);

  return {
    beforeWorldRotation,
    afterWorldRotation: quat.clone(instance.scene.boneLocalTransforms[allParentIndex].worldRotation),
  };
}

/**
 * モック GPU デバイスを作成します。
 * @returns {object} モック GPU デバイス。
 */
function createMockDevice() {
  return {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    createTexture(desc) {
      return {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
    },
    createBindGroupLayout() {
      return {};
    },
    createPipelineLayout() {
      return {};
    },
    createRenderPipeline() {
      return {};
    },
    createSampler() {
      return {};
    },
    createShaderModule() {
      return {};
    },
    createBindGroup() {
      return {};
    },
    queue: {
      writeBuffer() {},
      writeTexture() {},
      copyExternalImageToTexture() {},
    },
  };
}

/**
 * クォータニオンを近似比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuaternionClose(actual, expected, epsilon = 1e-6) {
  for (let index = 0; index < 4; index += 1) {
    assert.ok(
      Math.abs(Number(actual[index]) - Number(expected[index])) <= epsilon,
      `quaternion mismatch at ${index}: actual=${actual[index]} expected=${expected[index]}`,
    );
  }
}

/**
 * ベクトルを近似比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertVectorClose(actual, expected, epsilon = 1e-6) {
  for (let index = 0; index < 3; index += 1) {
    assert.ok(
      Math.abs(Number(actual[index]) - Number(expected[index])) <= epsilon,
      `vector mismatch at ${index}: actual=${actual[index]} expected=${expected[index]}`,
    );
  }
}
