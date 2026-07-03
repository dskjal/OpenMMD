import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { solveIk } from '../source/core/physics/ik.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import {
  createRuntimeIkSetup,
  createSceneState,
  loadModelData,
  rebuildModelIkLinks,
  refreshSceneIkState,
} from '../source/core/model/model-scene.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  STORAGE: 8,
};
globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('miku_v2.pmd の右ひじ runtime IK は chainCount=2 で 右ひじIK と 右手首 の位置が一致する', async () => {
  installFileFetch();

  const { model } = await loadModelData(null, 1, './test-data/miku_v2.pmd');
  const device = createMockDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const setupBoneIndex = model.bones.findIndex((bone) => bone.name === '右ひじ');
  const twistBoneIndex = model.bones.findIndex((bone) => bone.name === '右手捩');

  assert.notEqual(setupBoneIndex, -1, '右ひじボーンが見つからない');
  assert.notEqual(twistBoneIndex, -1, '右手捩ボーンが見つからない');

  const runtimeIk = createRuntimeIkSetup(model, { setupBoneIndex });
  const ik = model.ik[runtimeIk.ikIndex];
  const scene = createSceneState(device, model);
  const instance = { model, scene };

  scene.modelManager = manager;
  manager.instances = [instance];

  rebuildModelIkLinks(model, ik, 2);
  refreshSceneIkState(scene, model);
  manager.recomputeBoneMatrices(model, scene);

  const runtimeChain = scene.ikChains.find((chain) => chain.targetBoneIndex === runtimeIk.ikBoneIndex);
  assert.ok(runtimeChain, 'runtime IK chainが見つからない');
  assert.equal(runtimeChain.effectorBoneIndex, twistBoneIndex);
  assert.equal(runtimeChain.rotationTargetBoneIndex, twistBoneIndex);
  assert.deepEqual(
    runtimeChain.links.map((link) => model.bones[link.boneIndex]?.name),
    ['右腕捩', '右ひじ'],
  );

  const ikTargetWorldPosition = [-0.1, 1.7, 0.3];
  manager.setManualWorldPosition(instance, runtimeIk.ikBoneIndex, ikTargetWorldPosition);
  manager.recomputeBoneMatrices(model, scene);
  solveIk(
    model,
    scene,
    () => manager.recomputeBoneMatrices(model, scene),
    manager.markBoneLocalTransformDirty.bind(manager),
  );
  manager.recomputeBoneMatrices(model, scene);

  assertVec3Close(scene.boneWorldPositions[runtimeIk.ikBoneIndex], ikTargetWorldPosition, 0.05);
  assertRotated(scene.boneLocalTransforms[setupBoneIndex].rotation, '右ひじに回転が入っていない');
});

/**
 * Local file fetch を有効化します。
 */
function installFileFetch() {
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
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
    createBindGroupLayout() {
      return {};
    },
    queue: {
      writeBuffer() {},
    },
  };
}

/**
 * 3 要素ベクトルを近似比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertVec3Close(actual, expected, epsilon = 1e-6) {
  for (let index = 0; index < 3; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= epsilon,
      `vec3 mismatch at ${index}: actual=${actual[index]} expected=${expected[index]}`,
    );
  }
}

/**
 * 回転が identity から変化したことを検証します。
 * @param {ArrayLike<number>} rotation - 対象クォータニオン。
 * @param {string} message - 失敗メッセージ。
 */
function assertRotated(rotation, message) {
  const differs = Math.abs(rotation[0]) > 0.01
    || Math.abs(rotation[1]) > 0.01
    || Math.abs(rotation[2]) > 0.01
    || Math.abs(rotation[3] - 1.0) > 0.01;
  assert.ok(differs, message);
}
