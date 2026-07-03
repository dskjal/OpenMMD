import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { solveIk } from '../source/core/physics/ik.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { createSceneState, loadModelDataFromFile } from '../source/core/model/model-scene.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  STORAGE: 8,
};
globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('AliciaSolid.vrm の自動生成 左足ＩＫ を上に動かすと LeftLeg が有意に曲がる', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const device = createMockDevice();
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(device, model);
    const instance = { model, scene };

    scene.modelManager = manager;
    manager.instances = [instance];
    manager.recomputeBoneMatrices(model, scene);

    const leftLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '左足ＩＫ');
    const leftLowerLegIndex = model.bones.findIndex((bone) => bone.name === model.vrm?.humanoidBoneNameMap?.leftLowerLeg);

    assert.ok(leftLegIk, '左足ＩＫが見つからない');
    assert.notEqual(leftLowerLegIndex, -1, 'LeftLeg ボーンが見つからない');
    assert.equal(leftLegIk.links[1]?.hasLimit, true, 'LeftLeg link は膝制約を持つ必要がある');
    assert.deepEqual(leftLegIk.links[1].minAngle, [-Math.PI, 0, 0]);
    assert.deepEqual(leftLegIk.links[1].maxAngle, [-0.008, 0, 0]);

    const ikTargetWorldPosition = [...scene.boneWorldPositions[leftLegIk.boneIndex]];
    ikTargetWorldPosition[1] += 0.2;
    const initialKneeWorldPosition = [...scene.boneWorldPositions[leftLowerLegIndex]];
    manager.setManualWorldPosition(instance, leftLegIk.boneIndex, ikTargetWorldPosition);
    manager.recomputeBoneMatrices(model, scene);

    solveIk(
      model,
      scene,
      () => manager.recomputeBoneMatrices(model, scene),
      manager.markBoneLocalTransformDirty.bind(manager),
    );
    manager.recomputeBoneMatrices(model, scene);

    const kneeRotation = scene.boneLocalTransforms[leftLowerLegIndex].rotation;
    const kneeXAxisAngle = 2 * Math.atan2(Math.abs(kneeRotation[0]), Math.abs(kneeRotation[3]));
    const solvedKneeWorldPosition = scene.boneWorldPositions[leftLowerLegIndex];

    assert.ok(
      Math.abs(kneeXAxisAngle) > 0.05,
      `左足ＩＫを上に動かしても LeftLeg が十分に曲がらない: angle=${kneeXAxisAngle}`,
    );
    assert.ok(
      solvedKneeWorldPosition[2] > initialKneeWorldPosition[2] + 0.05,
      `左ひざが前方(+Z)ではなく後方へ曲がっている: initialZ=${initialKneeWorldPosition[2]} solvedZ=${solvedKneeWorldPosition[2]}`,
    );
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

/**
 * ローカルファイルを読む File 互換オブジェクトを作成します。
 * @param {string} path - ファイルパス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} File 互換オブジェクト。
 */
function createFileLike(path) {
  return {
    name: path,
    async arrayBuffer() {
      const buffer = await fs.readFile(path);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
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
