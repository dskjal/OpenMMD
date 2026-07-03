import assert from 'node:assert/strict';
import test from 'node:test';

import { refreshSceneIkState } from '../source/core/model/model-scene.js';

test('refreshSceneIkState rebuilds scene IK caches from model IK data', () => {
  const model = {
    bones: [
      { name: '腰', parentIndex: -1 },
      { name: '左足', parentIndex: 0 },
      { name: '左ひざ', parentIndex: 1 },
      { name: '左足首', parentIndex: 2 },
      { name: '左足ＩＫ', parentIndex: 0 },
    ],
    ik: [{
      boneIndex: 4,
      targetBoneIndex: 3,
      enabled: false,
      loopCount: 20,
      limitAngle: 0.5,
      links: [
        {
          boneIndex: 1,
          hasLimit: false,
          minAngle: [-Math.PI, -Math.PI, -Math.PI],
          maxAngle: [Math.PI, Math.PI, Math.PI],
        },
        {
          boneIndex: 2,
          hasLimit: false,
          minAngle: [-Math.PI, -Math.PI, -Math.PI],
          maxAngle: [Math.PI, Math.PI, Math.PI],
        },
      ],
    }],
  };
  const scene = {};

  const ikState = refreshSceneIkState(scene, model);

  assert.equal(scene.ikChains.length, 1);
  assert.equal(scene.ikTargets.length, 1);
  assert.equal(ikState.ikChains.length, 1);
  assert.equal(scene.ikChains[0].enabled, false);
  assert.deepEqual(scene.ikTargets[0], {
    boneIndex: 4,
    effectorBoneIndex: 3,
  });
  assert.deepEqual(scene.ikChains[0].links.map((link) => link.boneIndex), [1, 2]);
  assert.equal(scene.ikChains[0].links[1].hasLimit, true);
  assert.deepEqual(scene.ikChains[0].links[1].minAngle, [-Math.PI, 0, 0]);
  assert.deepEqual(scene.ikChains[0].links[1].maxAngle, [-0.008, 0, 0]);
  assert.notStrictEqual(scene.ikChains[0].links[0], model.ik[0].links[0]);
});

test('refreshSceneIkState defaults enabled IK chains to true when the field is omitted', () => {
  const model = {
    bones: [
      { name: '腰', parentIndex: -1 },
      { name: '左足', parentIndex: 0 },
      { name: '左ひざ', parentIndex: 1 },
      { name: '左足首', parentIndex: 2 },
      { name: '左足ＩＫ', parentIndex: 0 },
    ],
    ik: [{
      boneIndex: 4,
      targetBoneIndex: 3,
      loopCount: 20,
      limitAngle: 0.5,
      links: [],
    }],
  };
  const scene = {};

  refreshSceneIkState(scene, model);

  assert.equal(scene.ikChains[0].enabled, true);
});

test('refreshSceneIkState keeps per-bone IK rotation lock state on model bones', () => {
  const model = {
    bones: [
      { name: 'root', parentIndex: -1, ikRotationLocks: { x: false, y: true, z: false } },
      { name: 'mid', parentIndex: 0, ikRotationLocks: { x: true, y: false, z: true } },
      { name: 'effector', parentIndex: 1, ikRotationLocks: { x: false, y: false, z: false } },
      { name: 'ik', parentIndex: -1, ikRotationLocks: { x: false, y: false, z: false } },
    ],
    ik: [{
      boneIndex: 3,
      targetBoneIndex: 2,
      links: [
        { boneIndex: 0, hasLimit: false, minAngle: [-Math.PI, -Math.PI, -Math.PI], maxAngle: [Math.PI, Math.PI, Math.PI] },
        { boneIndex: 1, hasLimit: false, minAngle: [-Math.PI, -Math.PI, -Math.PI], maxAngle: [Math.PI, Math.PI, Math.PI] },
      ],
    }],
  };

  refreshSceneIkState({}, model);

  assert.deepEqual(model.bones[0].ikRotationLocks, { x: false, y: true, z: false });
  assert.deepEqual(model.bones[1].ikRotationLocks, { x: true, y: false, z: true });
});
