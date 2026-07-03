import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { buildViewerStateSnapshot } from '../source/infrastructure/api/api-state.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { mat4, quat, vec3 } from '../source/lib/esm/index.js';

globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('Alicia_solid.pmx 右腕の World Rotation を設定して snapshot から読み出せる', async () => {
  installFileFetch();

  const loader = new PMXLoader();
  const model = await loader.load('./test-data/Alicia_solid.pmx');
  const scene = createScene(model);
  const instance = { model, scene };
  const manager = new ModelManager(createDevice(), {}, 'bgra8unorm', 1, {});

  manager.recomputeBoneMatrices(model, scene);

  const boneIndex = model.bones.findIndex((bone) => bone.name === '右腕');
  assert.notEqual(boneIndex, -1, '右腕ボーンが見つからない');

  const targetEuler = [0.35, -0.2, 0.15];
  const targetRotation = quaternionFromEulerXYZ(targetEuler);

  manager.setManualWorldRotationEuler(instance, boneIndex, targetEuler);
  manager.recomputeBoneMatrices(model, scene);

  const snapshot = buildViewerStateSnapshot({
    selection: { activeInstanceIndex: 0 },
    modelManager: { instances: [instance] },
    vmdManager: { vmds: new Map() },
  });

  const readRotation = snapshot.models[0].bones[boneIndex].world.rotation;
  assertQuatEquivalent(readRotation, targetRotation);
});

/**
 * Installs a fetch stub for loading fixture files from the local workspace.
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
 * Creates the minimal scene state needed by ModelManager.recomputeBoneMatrices().
 * @param {object} model - Loaded PMX model.
 * @returns {object} Scene state.
 */
function createScene(model) {
  const boneCount = model.bones.length;
  const boneLocalTransforms = model.bones.map((bone, index) => createLocalTransform(model, bone, index));

  return {
    boneCount,
    boneLocalTransforms,
    boneWorldPositions: Array.from({ length: boneCount }, () => vec3.create()),
    sortedBoneIndices: model.bones
      .map((bone, index) => ({ index, level: bone.transformLevel ?? index }))
      .sort((a, b) => a.level - b.level || a.index - b.index)
      .map((item) => item.index),
    inverseBindMatrices: model.bones.map((bone) => mat4FromTranslation(-bone.position[0], -bone.position[1], -bone.position[2])),
    boneMatricesBuffer: createBuffer(),
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
}

/**
 * Creates a local transform record for a bone.
 * @param {object} model - Loaded PMX model.
 * @param {object} bone - Bone data.
 * @param {number} index - Bone index.
 * @returns {object} Local transform.
 */
function createLocalTransform(model, bone, index) {
  const parent = bone.parentIndex !== -1 ? model.bones[bone.parentIndex] ?? null : null;
  const baseTranslation = parent
    ? vec3.fromValues(
      bone.position[0] - parent.position[0],
      bone.position[1] - parent.position[1],
      bone.position[2] - parent.position[2],
    )
    : vec3.fromValues(bone.position[0], bone.position[1], bone.position[2]);

  return {
    translation: vec3.create(),
    rotation: quat.create(),
    manualTranslation: vec3.create(),
    manualRotation: quat.fromValues(0, 0, 0, 1),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix: mat4.create(),
    skinMatrix: mat4.create(),
    worldRotation: quat.create(),
    localX: bone.localX,
    localY: bone.localY,
    localZ: bone.localZ,
    baseTranslation,
    localDirty: true,
    worldDirty: true,
    physicsMode: -1,
    physicsDriven: false,
  };
}

/**
 * Creates a dummy buffer handle for scene state.
 * @returns {{size: number, destroy(): void}} Buffer stub.
 */
function createBuffer(size = 4096) {
  return {
    size,
    destroy() {},
  };
}

/**
 * Creates a minimal WebGPU device stub for ModelManager.
 * @returns {object} Device stub.
 */
function createDevice() {
  return {
    createBindGroupLayout() {
      return {};
    },
    queue: {
      writeBuffer() {},
    },
  };
}

/**
 * Builds a translation matrix.
 * @param {number} x - X translation.
 * @param {number} y - Y translation.
 * @param {number} z - Z translation.
 * @returns {mat4} Translation matrix.
 */
function mat4FromTranslation(x, y, z) {
  const out = mat4.create();
  mat4.fromTranslation(out, [x, y, z]);
  return out;
}

/**
 * Compares two quaternions, accepting the sign ambiguity of quaternion representations.
 * @param {ArrayLike<number>} actual - Actual quaternion.
 * @param {ArrayLike<number>} expected - Expected quaternion.
 */
function assertQuatEquivalent(actual, expected) {
  const directMatch = quaternionDistance(actual, expected) <= 1e-6;
  const invertedMatch = quaternionDistance(actual, [-expected[0], -expected[1], -expected[2], -expected[3]]) <= 1e-6;
  assert.ok(directMatch || invertedMatch, `quaternion mismatch: actual=${Array.from(actual)} expected=${Array.from(expected)}`);
}

/**
 * Computes the absolute component distance between two quaternions.
 * @param {ArrayLike<number>} a - Left quaternion.
 * @param {ArrayLike<number>} b - Right quaternion.
 * @returns {number} Maximum absolute component difference.
 */
function quaternionDistance(a, b) {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}
