import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { VRMALoader } from '../source/infrastructure/loaders/vrma-loader.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { createSceneState, loadModelDataFromFile } from '../source/core/model/model-scene.js';
import { assignAnimationSourceToRuntimeInstance } from '../source/application/animation/runtime-animation.js';
import { createRuntimeModelInstance } from '../source/core/model/runtime-model.js';
import { createFileLike, createMockDevice } from './runtime-test-helpers.mjs';

/**
 * クォータニオンが期待値と一致することを符号違い込みで確認します。
 * @param {ArrayLike<number>} actual - 実値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuaternionClose(actual, expected, epsilon = 1e-6) {
  const directDiff = Math.max(
    Math.abs(actual[0] - expected[0]),
    Math.abs(actual[1] - expected[1]),
    Math.abs(actual[2] - expected[2]),
    Math.abs(actual[3] - expected[3]),
  );
  const flippedDiff = Math.max(
    Math.abs(actual[0] + expected[0]),
    Math.abs(actual[1] + expected[1]),
    Math.abs(actual[2] + expected[2]),
    Math.abs(actual[3] + expected[3]),
  );
  assert.ok(
    Math.min(directDiff, flippedDiff) <= epsilon,
    `expected quaternion ${Array.from(actual)} to be close to ${Array.from(expected)}`,
  );
}

test('AliciaSolid.vrm に rotation-test.vrma を適用すると右足の UpperLeg / LowerLeg 回転が正しい向きで適用される', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const vrmaBuffer = await fs.readFile('./test-data/rotation-test.vrma');
    const source = await new VRMALoader().parse(
      vrmaBuffer.buffer.slice(vrmaBuffer.byteOffset, vrmaBuffer.byteOffset + vrmaBuffer.byteLength),
      'rotation-test.vrma',
    );

    const device = createMockDevice();
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(device, model);
    const instance = createRuntimeModelInstance({
      model,
      device,
      scene,
      modelManager: manager,
    });
    assignAnimationSourceToRuntimeInstance(instance, source, { syncVrmaIkState: false });

    manager.instances = [instance];

    instance.animationController.currentFrame = 120;
    instance.animationController.update(
      0,
      scene.boneLocalTransforms,
      manager.markBoneLocalTransformDirty.bind(manager),
    );
    manager.recomputeBoneMatrices(model, scene);

    assertQuaternionClose(getBoneLocalRotationByHumanoidName(model, scene, 'leftUpperLeg'), [
      -0.42969635128974915,
      -2.065251084467604e-16,
      3.7565246913118244e-8,
      0.9029734134674072,
    ]);
    assertQuaternionClose(getBoneLocalRotationByHumanoidName(model, scene, 'leftLowerLeg'), [
      0.3857380151748657,
      5.72387596304777e-15,
      -9.21575221509578e-17,
      0.9226083755493164,
    ]);
    assertQuaternionClose(getBoneLocalRotationByHumanoidName(model, scene, 'rightUpperLeg'), [
      -0.42969635128974915,
      -2.065251084467604e-16,
      3.7565246913118244e-8,
      0.9029734134674072,
    ]);
    assertQuaternionClose(getBoneLocalRotationByHumanoidName(model, scene, 'rightLowerLeg'), [
      0.3857380151748657,
      5.723875539531296e-15,
      1.6841989135851537e-15,
      0.9226083755493164,
    ]);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('AliciaSolid.vrm に VRMA_07.vrma の frame 0 を適用しても脚ボーンが縮まらない', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const vrmaBuffer = await fs.readFile('./models/@vrma-test/VRMA_07.vrma');
    const source = await new VRMALoader().parse(
      vrmaBuffer.buffer.slice(vrmaBuffer.byteOffset, vrmaBuffer.byteOffset + vrmaBuffer.byteLength),
      'VRMA_07.vrma',
    );

    const device = createMockDevice();
    const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
    const scene = createSceneState(device, model);
    const instance = createRuntimeModelInstance({
      model,
      device,
      scene,
      modelManager: manager,
    });
    assignAnimationSourceToRuntimeInstance(instance, source, { syncVrmaIkState: false });

    manager.instances = [instance];

    instance.animationController.currentFrame = 0;
    instance.animationController.update(
      0,
      scene.boneLocalTransforms,
      manager.markBoneLocalTransformDirty.bind(manager),
    );
    manager.recomputeBoneMatrices(model, scene);

    assert.ok(
      distanceBetween(
        getBoneWorldPositionByHumanoidName(model, scene, 'leftLowerLeg'),
        getBoneWorldPositionByHumanoidName(model, scene, 'leftUpperLeg'),
      ) > 0.1,
      'leftLowerLeg should keep a non-zero distance from leftUpperLeg',
    );
    assert.ok(
      distanceBetween(
        getBoneWorldPositionByHumanoidName(model, scene, 'rightLowerLeg'),
        getBoneWorldPositionByHumanoidName(model, scene, 'rightUpperLeg'),
      ) > 0.1,
      'rightLowerLeg should keep a non-zero distance from rightUpperLeg',
    );
    assert.ok(
      distanceBetween(
        getBoneWorldPositionByHumanoidName(model, scene, 'head'),
        getBoneWorldPositionByHumanoidName(model, scene, 'neck'),
      ) > 0.05,
      'head should keep a non-zero distance from neck',
    );
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

/**
 * humanoid 名に対応する bone の local rotation を返します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @returns {Array<number>} local rotation quaternion。
 */
function getBoneLocalRotationByHumanoidName(model, scene, humanoidBoneName) {
  const boneName = model.vrm?.humanoidBoneNameMap?.[humanoidBoneName];
  const boneIndex = model.bones.findIndex((bone) => bone.name === boneName);
  assert.notEqual(boneIndex, -1, `missing humanoid bone: ${humanoidBoneName}`);
  return Array.from(scene.boneLocalTransforms[boneIndex].rotation);
}

/**
 * humanoid 名に対応する bone の world position を返します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {string} humanoidBoneName - VRM humanoid 名。
 * @returns {Array<number>} world position。
 */
function getBoneWorldPositionByHumanoidName(model, scene, humanoidBoneName) {
  const boneName = model.vrm?.humanoidBoneNameMap?.[humanoidBoneName];
  const boneIndex = model.bones.findIndex((bone) => bone.name === boneName);
  assert.notEqual(boneIndex, -1, `missing humanoid bone: ${humanoidBoneName}`);
  return Array.from(scene.boneWorldPositions[boneIndex]);
}

/**
 * 2 点間の距離を返します。
 * @param {ArrayLike<number>} left - 左辺。
 * @param {ArrayLike<number>} right - 右辺。
 * @returns {number} 距離。
 */
function distanceBetween(left, right) {
  return Math.hypot(
    (Number(left?.[0]) || 0) - (Number(right?.[0]) || 0),
    (Number(left?.[1]) || 0) - (Number(right?.[1]) || 0),
    (Number(left?.[2]) || 0) - (Number(right?.[2]) || 0),
  );
}

