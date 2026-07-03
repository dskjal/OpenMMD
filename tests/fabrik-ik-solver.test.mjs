import assert from 'node:assert/strict';
import test from 'node:test';

import { solveIk } from '../source/core/physics/ik.js';
import { mat4, quat, vec3 } from '../source/lib/esm/index.js';

test('unconstrained 2-link IK reaches a reachable target with the default FABRIK path', () => {
  const { model, scene, recompute } = createSimpleChainScene();
  scene.boneLocalTransforms[3].translation = [3, -8, 0];

  recompute();
  const initialDistance = vec3.distance(scene.boneWorldPositions[2], [3, -8, 0]);
  solveIk(model, scene, recompute, markDirty);
  recompute();

  const solvedDistance = vec3.distance(scene.boneWorldPositions[2], [3, -8, 0]);
  assert.ok(solvedDistance < initialDistance * 0.5, `reachable target was not approached enough: ${solvedDistance}`);
  assert.ok(scene.boneWorldPositions[2][0] > 2.5, `effector did not swing toward the target on X: ${scene.boneWorldPositions[2][0]}`);
});

test('unconstrained 2-link IK keeps segment lengths and stretches toward unreachable targets', () => {
  const { model, scene, recompute } = createSimpleChainScene();
  scene.boneLocalTransforms[3].translation = [20, 0, 0];

  recompute();
  solveIk(model, scene, recompute, markDirty);
  recompute();

  assertVec3Close(scene.boneWorldPositions[2], [10, 0, 0], 1e-3);
  assert.ok(Math.abs(vec3.distance(scene.boneWorldPositions[0], scene.boneWorldPositions[1]) - 5) <= 1e-3);
  assert.ok(Math.abs(vec3.distance(scene.boneWorldPositions[1], scene.boneWorldPositions[2]) - 5) <= 1e-3);
});

test('IK-only rotation locks produce the same solve result as equivalent normal rotation locks', () => {
  const withNormalLocks = solveSimpleChainWithLocks({
    targetTranslation: [3, -8, 0],
    rotationLocks: [
      { x: false, y: true, z: true },
      { x: false, y: true, z: true },
    ],
  });
  const withIkLocks = solveSimpleChainWithLocks({
    targetTranslation: [3, -8, 0],
    ikRotationLocks: [
      { x: false, y: true, z: true },
      { x: false, y: true, z: true },
    ],
  });

  assertQuatClose(withNormalLocks.rotations[0], withIkLocks.rotations[0], 1e-5);
  assertQuatClose(withNormalLocks.rotations[1], withIkLocks.rotations[1], 1e-5);
  assertVec3Close(withNormalLocks.effectorPosition, withIkLocks.effectorPosition, 1e-5);
});

test('IK solver combines normal rotation locks with IK-only rotation locks', () => {
  const withCombinedLocks = solveSimpleChainWithLocks({
    targetTranslation: [3, -8, 0],
    rotationLocks: [
      { x: false, y: true, z: false },
      { x: false, y: true, z: false },
    ],
    ikRotationLocks: [
      { x: false, y: false, z: true },
      { x: false, y: false, z: true },
    ],
  });
  const withEquivalentNormalLocks = solveSimpleChainWithLocks({
    targetTranslation: [3, -8, 0],
    rotationLocks: [
      { x: false, y: true, z: true },
      { x: false, y: true, z: true },
    ],
  });

  assertQuatClose(withCombinedLocks.rotations[0], withEquivalentNormalLocks.rotations[0], 1e-5);
  assertQuatClose(withCombinedLocks.rotations[1], withEquivalentNormalLocks.rotations[1], 1e-5);
  assertVec3Close(withCombinedLocks.effectorPosition, withEquivalentNormalLocks.effectorPosition, 1e-5);
});

test('hair FABRIK chains keep their twist reference when a segment flips 180 degrees', () => {
  const { model, scene, recompute } = createSimpleChainScene({
    ikBoneName: '右髪ＩＫ',
    targetTranslation: [0, 20, 0],
  });

  recompute();
  solveIk(model, scene, recompute, markDirty);
  recompute();

  const rotatedXAxis = rotateVectorByQuaternion([1, 0, 0], scene.boneLocalTransforms[0].rotation);
  assert.ok(rotatedXAxis[0] > 0.9, `hair chain lost its twist reference: x=${rotatedXAxis[0]}`);
});

test('non-hair FABRIK chains keep the legacy orthogonal-axis fallback', () => {
  const { model, scene, recompute } = createSimpleChainScene({
    ikBoneName: 'generic IK',
    targetTranslation: [0, 20, 0],
  });

  recompute();
  solveIk(model, scene, recompute, markDirty);
  recompute();

  const rotatedXAxis = rotateVectorByQuaternion([1, 0, 0], scene.boneLocalTransforms[0].rotation);
  assert.ok(rotatedXAxis[0] < -0.9, `generic chain no longer uses the legacy fallback: x=${rotatedXAxis[0]}`);
});

test('FABRIK normalizes PMX-style reverse link order before solving', () => {
  const forward = solveSimpleChain({
    targetTranslation: [3, -8, 0],
    links: [
      { boneIndex: 0, hasLimit: false },
      { boneIndex: 1, hasLimit: false },
    ],
  });
  const reversed = solveSimpleChain({
    targetTranslation: [3, -8, 0],
    links: [
      { boneIndex: 1, hasLimit: false },
      { boneIndex: 0, hasLimit: false },
    ],
  });

  assertVec3Close(reversed.effectorPosition, forward.effectorPosition, 1e-5);
  assertQuatClose(reversed.rotations[0], forward.rotations[0], 1e-5);
  assertQuatClose(reversed.rotations[1], forward.rotations[1], 1e-5);
});

/**
 * Creates a simple IK scene for FABRIK tests.
 * @param {object} [options={}] - Scene options.
 * @param {string} [options.ikBoneName='target'] - IK target bone name.
 * @param {ArrayLike<number>|null} [options.targetTranslation=null] - Initial target translation.
 * @returns {{model: object, scene: object, recompute: function}} Test model and scene.
 */
function createSimpleChainScene(options = {}) {
  const model = {
    bones: [
      { name: 'root', parentIndex: -1, position: [0, 0, 0], rotationLocks: { x: false, y: false, z: false }, ikRotationLocks: { x: false, y: false, z: false } },
      { name: 'mid', parentIndex: 0, position: [0, -5, 0], rotationLocks: { x: false, y: false, z: false }, ikRotationLocks: { x: false, y: false, z: false } },
      { name: 'effector', parentIndex: 1, position: [0, -10, 0], rotationLocks: { x: false, y: false, z: false }, ikRotationLocks: { x: false, y: false, z: false } },
      { name: options.ikBoneName || 'target', parentIndex: -1, position: [0, 0, 0], rotationLocks: { x: false, y: false, z: false }, ikRotationLocks: { x: false, y: false, z: false } },
    ],
  };

  const scene = {
    boneCount: model.bones.length,
    boneLocalTransforms: Array.from({ length: model.bones.length }, () => ({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      worldMatrix: mat4.create(),
      worldRotation: [0, 0, 0, 1],
      localDirty: true,
      worldDirty: true,
    })),
    boneWorldPositions: Array.from({ length: model.bones.length }, () => vec3.create()),
    ikChains: [{
      targetBoneIndex: 3,
      effectorBoneIndex: 2,
      loopCount: 16,
      limitAngle: Math.PI,
      links: [
        { boneIndex: 0, hasLimit: false },
        { boneIndex: 1, hasLimit: false },
      ],
    }],
  };

  if (Array.isArray(options.targetTranslation)) {
    scene.boneLocalTransforms[3].translation = [...options.targetTranslation];
  }

  return {
    model,
    scene,
    recompute: () => recomputeSimpleScene(model, scene),
  };
}

/**
 * IK テスト用の dirty flag を立てます。
 * @param {object} local - ローカル変換。
 */
function markDirty(local) {
  local.localDirty = true;
  local.worldDirty = true;
}

/**
 * 指定ロック条件で簡易 IK チェーンを解きます。
 * @param {object} options - 実行オプション。
 * @param {ArrayLike<number>} options.targetTranslation - ターゲット平行移動。
 * @param {Array<object>} [options.rotationLocks=[]] - 通常回転ロック。
 * @param {Array<object>} [options.ikRotationLocks=[]] - IK 専用回転ロック。
 * @returns {{rotations: Array<ArrayLike<number>>, effectorPosition: ArrayLike<number>}} 解結果。
 */
function solveSimpleChainWithLocks(options) {
  const { model, scene, recompute } = createSimpleChainScene();
  scene.boneLocalTransforms[3].translation = [...options.targetTranslation];

  const normalLocks = Array.isArray(options.rotationLocks) ? options.rotationLocks : [];
  const ikLocks = Array.isArray(options.ikRotationLocks) ? options.ikRotationLocks : [];
  for (let index = 0; index < 2; index += 1) {
    if (normalLocks[index]) {
      model.bones[index].rotationLocks = { ...model.bones[index].rotationLocks, ...normalLocks[index] };
    }
    if (ikLocks[index]) {
      model.bones[index].ikRotationLocks = { ...model.bones[index].ikRotationLocks, ...ikLocks[index] };
    }
  }

  recompute();
  solveIk(model, scene, recompute, markDirty);
  recompute();

  return {
    rotations: [
      [...scene.boneLocalTransforms[0].rotation],
      [...scene.boneLocalTransforms[1].rotation],
    ],
    effectorPosition: [...scene.boneWorldPositions[2]],
  };
}

/**
 * Solves a simple chain with optional custom links.
 * @param {object} options - Solve options.
 * @param {ArrayLike<number>} options.targetTranslation - Target translation.
 * @param {Array<object>} options.links - IK links.
 * @returns {{rotations: Array<ArrayLike<number>>, effectorPosition: ArrayLike<number>}} Solve result.
 */
function solveSimpleChain(options) {
  const { model, scene, recompute } = createSimpleChainScene();
  scene.boneLocalTransforms[3].translation = [...options.targetTranslation];
  scene.ikChains[0].links = options.links.map((link) => ({ ...link }));

  recompute();
  solveIk(model, scene, recompute, markDirty);
  recompute();

  return {
    rotations: [
      [...scene.boneLocalTransforms[0].rotation],
      [...scene.boneLocalTransforms[1].rotation],
    ],
    effectorPosition: [...scene.boneWorldPositions[2]],
  };
}

/**
 * Rotates a vector by a quaternion.
 * @param {ArrayLike<number>} vector - Vector to rotate.
 * @param {ArrayLike<number>} rotation - Quaternion rotation.
 * @returns {number[]} Rotated vector.
 */
function rotateVectorByQuaternion(vector, rotation) {
  const rotated = vec3.create();
  vec3.transformQuat(rotated, vector, rotation);
  return Array.from(rotated);
}

function recomputeSimpleScene(model, scene) {
  for (let i = 0; i < scene.boneCount; i += 1) {
    const bone = model.bones[i];
    const local = scene.boneLocalTransforms[i];
    const parent = bone.parentIndex !== -1 ? scene.boneLocalTransforms[bone.parentIndex] : null;

    const relativePosition = bone.parentIndex !== -1
      ? vec3.sub(vec3.create(), bone.position, model.bones[bone.parentIndex].position)
      : vec3.clone(bone.position);

    const matrix = mat4.create();
    mat4.fromRotationTranslationScale(
      matrix,
      local.rotation,
      vec3.add(vec3.create(), relativePosition, local.translation),
      local.scale,
    );

    if (parent) {
      mat4.multiply(local.worldMatrix, parent.worldMatrix, matrix);
      quat.multiply(local.worldRotation, parent.worldRotation, local.rotation);
    } else {
      mat4.copy(local.worldMatrix, matrix);
      quat.copy(local.worldRotation, local.rotation);
    }

    mat4.getTranslation(scene.boneWorldPositions[i], local.worldMatrix);
  }
}

/**
 * 3 要素ベクトルを近似比較します。
 * @param {ArrayLike<number>} actual - 実測値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} epsilon - 許容誤差。
 */
function assertVec3Close(actual, expected, epsilon) {
  for (let i = 0; i < 3; i += 1) {
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
 * @param {number} epsilon - 許容誤差。
 */
function assertQuatClose(actual, expected, epsilon) {
  for (let i = 0; i < 4; i += 1) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `quat mismatch at ${i}: actual=${actual[i]} expected=${expected[i]}`,
    );
  }
}
