import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';
import { solveIk, worldDeltaToLocalDelta } from '../source/core/physics/ik.js';
import { mat4 } from '../source/lib/esm/index.js';

test('"左足ＩＫを上に動かすと左ひざが有意に回転する"', async () => {
  installFileFetch();

  const loader = new PMXLoader();
  const model = await loader.load('./test-data/Alicia_solid.pmx');
  const scene = createScene(model);

  recomputeBoneMatrices(model, scene);

  const leftLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '左足ＩＫ');
  const leftKneeIndex = model.bones.findIndex((bone) => bone.name === '左ひざ');

  assert.notEqual(leftKneeIndex, -1, '左ひざボーンが見つからない');
  assert.ok(leftLegIk, '左足ＩＫが見つからない');

  const localDelta = worldDeltaToLocalDelta(scene, model, leftLegIk.boneIndex, [0, 2, 0]);
  const ikControl = scene.boneLocalTransforms[leftLegIk.boneIndex];
  ikControl.translation[0] += localDelta[0];
  ikControl.translation[1] += localDelta[1];
  ikControl.translation[2] += localDelta[2];

  solveIk(model, scene, () => recomputeBoneMatrices(model, scene), markDirty);

  const kneeRotation = scene.boneLocalTransforms[leftKneeIndex].rotation;
  const kneeXAxisAngle = 2 * Math.atan2(Math.abs(kneeRotation[0]), Math.abs(kneeRotation[3]));

  assert.ok(
    kneeXAxisAngle > 0.05,
    `左足ＩＫを上に動かしても左ひざが十分に回転しない: angle=${kneeXAxisAngle}`,
  );
});

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
 * Marks a local transform as dirty in IK tests.
 * @param {object} local - Local transform state.
 */
function markDirty(local) {
  local.localDirty = true;
  local.worldDirty = true;
}

function createScene(model) {
  return {
    boneCount: model.bones.length,
    boneLocalTransforms: model.bones.map(() => ({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      worldMatrix: new Float32Array(16),
      skinMatrix: new Float32Array(16),
      worldRotation: [0, 0, 0, 1],
    })),
    boneWorldPositions: Array.from({ length: model.bones.length }, () => [0, 0, 0]),
    inverseBindMatrices: model.bones.map((bone) => mat4Translation(-bone.position[0], -bone.position[1], -bone.position[2])),
    ikChains: (model.ik || []).map((ik) => ({
      targetBoneIndex: ik.boneIndex,
      effectorBoneIndex: ik.targetBoneIndex,
      loopCount: ik.loopCount,
      limitAngle: ik.limitAngle,
      links: ik.links.map((link) => ({
        boneIndex: link.boneIndex,
        hasLimit: link.hasLimit,
        minAngle: link.minAngle || [-Math.PI, -Math.PI, -Math.PI],
        maxAngle: link.maxAngle || [Math.PI, Math.PI, Math.PI],
      })),
    })),
  };
}

function recomputeBoneMatrices(model, scene) {
  for (let i = 0; i < scene.boneCount; i++) {
    const bone = model.bones[i];
    const local = scene.boneLocalTransforms[i];
    const parent = bone.parentIndex !== -1 ? model.bones[bone.parentIndex] : null;
    const relativePosition = parent
      ? [
          bone.position[0] - parent.position[0],
          bone.position[1] - parent.position[1],
          bone.position[2] - parent.position[2],
        ]
      : [...bone.position];

    let matrix = mat4Translation(relativePosition[0], relativePosition[1], relativePosition[2]);
    matrix = mat4Multiply(matrix, mat4Translation(local.translation[0], local.translation[1], local.translation[2]));
    matrix = mat4Multiply(matrix, quatToMat4(local.rotation));
    matrix = mat4Multiply(matrix, mat4Scale(local.scale[0], local.scale[1], local.scale[2]));

    local.worldMatrix = bone.parentIndex !== -1 && bone.parentIndex < scene.boneCount
      ? mat4Multiply(scene.boneLocalTransforms[bone.parentIndex].worldMatrix, matrix)
      : matrix;
    local.worldRotation = bone.parentIndex !== -1 && bone.parentIndex < scene.boneCount
      ? quatMultiply(scene.boneLocalTransforms[bone.parentIndex].worldRotation, local.rotation)
      : [...local.rotation];

    local.skinMatrix = mat4Multiply(local.worldMatrix, scene.inverseBindMatrices[i]);
    scene.boneWorldPositions[i][0] = local.worldMatrix[12];
    scene.boneWorldPositions[i][1] = local.worldMatrix[13];
    scene.boneWorldPositions[i][2] = local.worldMatrix[14];
  }
}

function mat4Multiply(a, b) {
  const out = mat4.create();
  mat4.multiply(out, a, b);
  return out;
}

function mat4Translation(x, y, z) {
  const out = mat4.create();
  mat4.fromTranslation(out, [x, y, z]);
  return out;
}

function mat4Scale(x, y, z) {
  const out = mat4.create();
  mat4.fromScaling(out, [x, y, z]);
  return out;
}

function quatToMat4(rotation) {
  const out = mat4.create();
  mat4.fromQuat(out, rotation);
  return out;
}

function quatMultiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
