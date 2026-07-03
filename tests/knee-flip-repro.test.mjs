import assert from 'node:assert/strict';
import test from 'node:test';
import { solveIk } from '../source/core/physics/ik.js';
import { quat, vec3, mat4 } from '../source/lib/esm/index.js';

test('Knee flip reproduction test', () => {
  // Setup a simple leg chain: Thigh (0, 10, 0) -> Knee (0, 5, 0) -> Ankle (0, 0, 0)
  // Target is at (0, 0.5, 0)
  
  const model = {
    bones: [
      { name: '腰', parentIndex: -1, position: [0, 10, 0] },
      { name: '左足', parentIndex: 0, position: [0, 10, 0] },
      { name: '左ひざ', parentIndex: 1, position: [0, 5, 0] },
      { name: '左足首', parentIndex: 2, position: [0, 0, 0] },
      { name: '左足ＩＫ', parentIndex: 0, position: [0, 0, 0] },
    ]
  };

  const scene = {
    boneCount: 5,
    boneLocalTransforms: Array.from({ length: 5 }, () => ({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      worldMatrix: mat4.create(),
      worldRotation: [0, 0, 0, 1],
      localDirty: true
    })),
    boneWorldPositions: Array.from({ length: 5 }, () => vec3.create()),
    ikChains: [{
      targetBoneIndex: 4,
      effectorBoneIndex: 3,
      loopCount: 20,
      limitAngle: 0.5,
      links: [
        { boneIndex: 1, hasLimit: false }, // Thigh
        { 
          boneIndex: 2, 
          hasLimit: true, 
          minAngle: [-Math.PI, 0, 0], 
          maxAngle: [-0.008, 0, 0] 
        }, // Knee
      ]
    }]
  };

  function recompute() {
    for (let i = 0; i < scene.boneCount; i++) {
      const bone = model.bones[i];
      const local = scene.boneLocalTransforms[i];
      const parent = bone.parentIndex !== -1 ? scene.boneLocalTransforms[bone.parentIndex] : null;
      
      const relPos = bone.parentIndex !== -1 
        ? vec3.sub(vec3.create(), bone.position, model.bones[bone.parentIndex].position)
        : vec3.clone(bone.position);
      
      const matrix = mat4.create();
      mat4.fromRotationTranslationScale(matrix, local.rotation, vec3.add(vec3.create(), relPos, local.translation), local.scale);
      
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

  // Move IK target EXACTLY to Thigh (0, 10, 0)
  scene.boneLocalTransforms[4].translation = [0, 10.0, 0];
  scene.ikChains[0].links[1].minAngle[0] = -Math.PI;
  
  // Initial state: straight leg
  recompute();
  
  console.log(`Initial target pos: ${scene.boneWorldPositions[4]}`);
  console.log(`Initial effector pos: ${scene.boneWorldPositions[3]}`);

  // Solve IK with many iterations
  scene.ikChains[0].loopCount = 200;
  solveIk(model, scene, recompute, markDirty);

  const kneeRot = scene.boneLocalTransforms[2].rotation;
  const twistX = kneeRot[0];
  const twistW = kneeRot[3];
  const twistLength = Math.hypot(twistX, twistW);
  const angle = -2 * Math.atan2(twistX / twistLength, twistW / twistLength);
  
  console.log(`Knee angle after IK: ${angle} rad (${angle * 180 / Math.PI} deg)`);

  assert.ok(angle < -0.01, `Knee should bend backwards, but got ${angle}`);
});

/**
 * Marks a local transform as dirty in IK tests.
 * @param {object} local - Local transform state.
 */
function markDirty(local) {
  local.localDirty = true;
  local.worldDirty = true;
}
