import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { solveIk } from '../source/core/physics/ik.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { createSceneState, loadModelData } from '../source/core/model/model-scene.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  STORAGE: 8,
};
globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('Alicia_solid.pmx のセンターを動かすと右足首の Y が不自然に持ち上がらない', async () => {
  installFileFetch();

  const loaded = await loadModelData(null, 1, './test-data/Alicia_solid.pmx');
  const model = loaded.model;
  const device = createMockDevice();
  const scene = createSceneState(device, model);
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const instance = { model, scene };

  scene.modelManager = manager;
  manager.instances = [instance];

  manager.recomputeBoneMatrices(model, scene);

  const centerIndex = model.bones.findIndex((bone) => bone.name === 'センター');
  const rightAnkleIndex = model.bones.findIndex((bone) => bone.name === '右足首');

  assert.notEqual(centerIndex, -1, 'センターボーンが見つからない');
  assert.notEqual(rightAnkleIndex, -1, '右足首ボーンが見つからない');

  const targetPosition = [0, 0.3, 0];

  manager.setManualWorldPosition(instance, centerIndex, targetPosition);
  manager.recomputeBoneMatrices(model, scene);

  solveIk(
    model,
    scene,
    () => manager.recomputeBoneMatrices(model, scene),
    manager.markBoneLocalTransformDirty.bind(manager),
  );
  manager.recomputeBoneMatrices(model, scene);

  assertVec3Close(scene.boneWorldPositions[centerIndex], targetPosition);
  assertVec3Close(
    scene.boneWorldPositions[rightAnkleIndex],
    [-0.07669015973806381, 0.1081681102514267, -0.029084915295243263],
    0.02,
  );
});

test('Alicia_solid.pmx の右ひざを全軸回転ロックすると 右足ＩＫ を上げても右ひざ回転は変化しない', async () => {
  installFileFetch();

  const loaded = await loadModelData(null, 1, './test-data/Alicia_solid.pmx');
  const model = loaded.model;
  const device = createMockDevice();
  const scene = createSceneState(device, model);
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const instance = { model, scene };

  scene.modelManager = manager;
  manager.instances = [instance];

  manager.recomputeBoneMatrices(model, scene);

  const rightLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '右足ＩＫ');
  const rightKneeIndex = model.bones.findIndex((bone) => bone.name === '右ひざ');

  assert.ok(rightLegIk, '右足ＩＫが見つからない');
  assert.notEqual(rightKneeIndex, -1, '右ひざボーンが見つからない');

  model.bones[rightKneeIndex].rotationLocks = { x: true, y: true, z: true };
  const initialRotation = [...scene.boneLocalTransforms[rightKneeIndex].rotation];
  const targetPosition = [...scene.boneWorldPositions[rightLegIk.boneIndex]];
  targetPosition[1] += 2.0;

  manager.setManualWorldPosition(instance, rightLegIk.boneIndex, targetPosition);
  manager.recomputeBoneMatrices(model, scene);
  solveIk(
    model,
    scene,
    () => manager.recomputeBoneMatrices(model, scene),
    manager.markBoneLocalTransformDirty.bind(manager),
  );
  manager.recomputeBoneMatrices(model, scene);

  assertQuatClose(scene.boneLocalTransforms[rightKneeIndex].rotation, initialRotation, 1e-6);
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
  for (let i = 0; i < 3; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `vec3 mismatch at ${i}: actual=${actual[i]} expected=${expected[i]}`,
    );
  }
}

/**
 * クォータニオンを近似比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuatClose(actual, expected, epsilon = 1e-6) {
  for (let i = 0; i < 4; i += 1) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `quat mismatch at ${i}: actual=${actual[i]} expected=${expected[i]}`,
    );
  }
}
