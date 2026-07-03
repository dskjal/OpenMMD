import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { quat, vec3 } from '../source/lib/esm/index.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { VPDLoader } from '../source/infrastructure/loaders/vpd-loader.js';
import { VPDWriter, buildVpdPoseData } from '../source/infrastructure/loaders/vpd-writer.js';

/**
 * 浮動小数の比較を行います。
 * @param {number} actual - 実際の値。
 * @param {number} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

/**
 * クォータニオンを比較します。
 * @param {ArrayLike<number>} actual - 実際の値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuatClose(actual, expected, epsilon = 1e-6) {
  for (let i = 0; i < 4; i++) {
    assertClose(actual[i], expected[i], epsilon);
  }
}

/**
 * 3 要素ベクトルを比較します。
 * @param {ArrayLike<number>} actual - 実際の値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertVec3Close(actual, expected, epsilon = 1e-6) {
  for (let i = 0; i < 3; i++) {
    assertClose(actual[i], expected[i], epsilon);
  }
}

test('VPDWriter round-trips the sample pose fixture', async () => {
  const bytes = await fs.readFile('./test-data/test.vpd');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const loader = new VPDLoader();
  const source = loader.parse(buffer);
  const writer = new VPDWriter();
  const roundTripped = loader.parse(writer.write({
    modelName: source.modelName.replace(/\.osm$/iu, ''),
    bones: source.bones,
  }));

  assert.equal(roundTripped.signature, source.signature);
  assert.equal(roundTripped.modelName, source.modelName);
  assert.equal(roundTripped.boneCount, source.boneCount);
  assert.equal(roundTripped.bones.length, source.bones.length);

  for (let i = 0; i < source.bones.length; i++) {
    assert.equal(roundTripped.bones[i].name, source.bones[i].name);
    assertVec3Close(roundTripped.bones[i].position, source.bones[i].position);
    assertQuatClose(roundTripped.bones[i].rotation, source.bones[i].rotation);
  }
});

test('VPDWriter exports only the selected bones with the combined animation and manual pose', () => {
  const instance = createInstance();
  const selectedBoneIndices = [2, 0];
  const vpdData = buildVpdPoseData(instance, selectedBoneIndices);
  const writer = new VPDWriter();
  const loader = new VPDLoader();
  const parsed = loader.parse(writer.write(vpdData));

  assert.equal(vpdData.modelName, 'Export Model');
  assert.equal(vpdData.bones.length, 2);
  assert.equal(vpdData.bones[0].name, 'Leaf');
  assert.equal(vpdData.bones[1].name, 'Root');
  assert.equal(parsed.modelName, 'Export Model.osm');
  assert.equal(parsed.boneCount, 2);
  assert.equal(parsed.bones[0].name, 'Leaf');
  assert.equal(parsed.bones[1].name, 'Root');

  const expectedLeafRotation = quat.multiply(
    quat.create(),
    instance.scene.boneLocalTransforms[2].manualRotation,
    instance.scene.boneLocalTransforms[2].rotation,
  );
  const expectedRootRotation = quat.multiply(
    quat.create(),
    instance.scene.boneLocalTransforms[0].manualRotation,
    instance.scene.boneLocalTransforms[0].rotation,
  );
  const expectedLeafPosition = vec3.add(
    vec3.create(),
    instance.scene.boneLocalTransforms[2].translation,
    instance.scene.boneLocalTransforms[2].manualTranslation,
  );
  const expectedRootPosition = vec3.add(
    vec3.create(),
    instance.scene.boneLocalTransforms[0].translation,
    instance.scene.boneLocalTransforms[0].manualTranslation,
  );

  assertVec3Close(vpdData.bones[0].position, expectedLeafPosition);
  assertVec3Close(vpdData.bones[1].position, expectedRootPosition);
  assertQuatClose(vpdData.bones[0].rotation, expectedLeafRotation);
  assertQuatClose(vpdData.bones[1].rotation, expectedRootRotation);
  assertVec3Close(parsed.bones[0].position, expectedLeafPosition);
  assertVec3Close(parsed.bones[1].position, expectedRootPosition);
  assertQuatClose(parsed.bones[0].rotation, expectedLeafRotation);
  assertQuatClose(parsed.bones[1].rotation, expectedRootRotation);
});

/**
 * テスト用モデルインスタンスを作成します。
 * @returns {object} モデルインスタンス。
 */
function createInstance() {
  const model = {
    name: 'Export Model',
    bones: [
      { name: 'Root' },
      { name: 'Middle' },
      { name: 'Leaf' },
    ],
  };

  const scene = {
    boneLocalTransforms: [
      createLocalTransform([1, 2, 3], [0.1, -0.2, 0.3], [4, 5, 6], [0.4, 0.5, -0.6]),
      createLocalTransform([-2, 0, 1], [0, 0.25, 0], [0.5, -0.5, 0.25], [0, 0.1, 0]),
      createLocalTransform([7, 8, 9], [-0.3, 0.2, 0.1], [-1, 2, -3], [0.2, -0.4, 0.6]),
    ],
  };

  return { model, scene };
}

/**
 * テスト用ローカルトランスフォームを作成します。
 * @param {Array<number>} translation - アニメーション位置。
 * @param {Array<number>} rotationEuler - アニメーション回転。
 * @param {Array<number>} manualTranslation - manual 位置。
 * @param {Array<number>} manualRotationEuler - manual 回転。
 * @returns {object} ローカルトランスフォーム。
 */
function createLocalTransform(translation, rotationEuler, manualTranslation, manualRotationEuler) {
  return {
    translation: vec3.fromValues(translation[0], translation[1], translation[2]),
    rotation: quaternionFromEulerXYZ(rotationEuler),
    manualTranslation: vec3.fromValues(manualTranslation[0], manualTranslation[1], manualTranslation[2]),
    manualRotation: quaternionFromEulerXYZ(manualRotationEuler),
  };
}
