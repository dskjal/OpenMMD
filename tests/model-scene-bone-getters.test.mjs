import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { findBoneIndexByName, getBone, getBoneByName, loadModelDataFromFile } from '../source/core/model/model-scene.js';

test('getBone returns null for invalid bone indices', () => {
  const model = {
    bones: [
      { name: 'Root' },
      { name: 'Arm' },
    ],
  };

  assert.equal(getBone(model, -1), null);
  assert.equal(getBone(model, 2), null);
  assert.equal(getBone(null, 0), null);
});

test('findBoneIndexByName trims the requested name', () => {
  const model = {
    bones: [
      { name: 'Root' },
      { name: 'Arm' },
      { name: 'Hand' },
    ],
  };

  assert.equal(findBoneIndexByName(model, ' Arm '), 1);
  assert.equal(findBoneIndexByName(model, 'Missing'), -1);
  assert.equal(findBoneIndexByName(model, ''), -1);
});

test('getBoneByName returns the matching bone object', () => {
  const bone = { name: 'Hand', parentIndex: 1 };
  const model = {
    bones: [
      { name: 'Root' },
      { name: 'Arm' },
      bone,
    ],
  };

  assert.equal(getBoneByName(model, 'Hand'), bone);
  assert.equal(getBoneByName(model, ' Hand '), bone);
  assert.equal(getBoneByName(model, 'Missing'), null);
});

test('VRM humanoid bone names resolve to the actual bone names first', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalAlert = globalThis.alert;
  const alerts = [];
  globalThis.self = globalThis;
  globalThis.createImageBitmap = createImageBitmapMock;
  globalThis.alert = (message) => {
    alerts.push(message);
  };

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const model = loaded.model;
    assert.equal(model.bones[0]?.name, '全ての親');
    assert.equal(findBoneIndexByName(model, '全ての親'), 0);
    assert.equal(getBoneByName(model, '全ての親')?.name, '全ての親');
    assert.notEqual(findBoneIndexByName(model, '下半身'), -1);
    assert.equal(getBoneByName(model, '下半身')?.name, '下半身');
    const hipsIndex = findBoneIndexByName(model, 'hips');
    const hipsBone = getBoneByName(model, 'hips');
    const lowerBodyBone = getBoneByName(model, '下半身');
    const actualHipsIndex = findBoneIndexByName(model, 'Hips');

    assert.equal(model.vrm?.humanoidBoneNameMap?.hips, 'Hips');
    assert.equal(hipsIndex, actualHipsIndex);
    assert.equal(hipsBone?.name, 'Hips');
    assert.equal(model.bones[hipsIndex]?.parentIndex, 0);
    assert.equal(lowerBodyBone?.parentIndex, hipsIndex);

    const leftLowerArmBoneName = model.vrm?.humanoidBoneNameMap?.leftLowerArm;
    const leftLowerLegBoneName = model.vrm?.humanoidBoneNameMap?.leftLowerLeg;
    const leftFootBoneName = model.vrm?.humanoidBoneNameMap?.leftFoot;
    const leftLowerArm = model.bones.find((bone) => bone.name === leftLowerArmBoneName);
    const leftLowerLeg = model.bones.find((bone) => bone.name === leftLowerLegBoneName);
    const leftFoot = model.bones.find((bone) => bone.name === leftFootBoneName);

    assert.ok(leftLowerArm, 'VRM leftLowerArm bone should exist');
    assert.ok(leftLowerLeg, 'VRM leftLowerLeg bone should exist');
    assert.ok(leftFoot, 'VRM leftFoot bone should exist');
    assert.deepEqual(leftLowerArm.rotationLocks, { x: true, y: false, z: true });
    assert.deepEqual(leftLowerLeg.rotationLocks, { x: false, y: true, z: true });
    assert.deepEqual(leftFoot.rotationLocks, { x: false, y: true, z: true });

    assert.equal(alerts.length, 0);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.alert = originalAlert;
  }
});

test('missing VRM humanoid mapping falls back to normal bone name search and alerts once', () => {
  const originalAlert = globalThis.alert;
  const alerts = [];
  globalThis.alert = (message) => {
    alerts.push(message);
  };

  try {
    const model = {
      magic: 'Vrm',
      vrm: {
        humanoidBoneMapMissing: true,
        humanoidBoneMapMissingNotified: false,
      },
      bones: [
        { name: 'Root' },
        { name: 'Hips' },
      ],
    };

    assert.equal(findBoneIndexByName(model, 'Hips'), 1);
    assert.equal(alerts.length, 1);
    assert.equal(model.vrm.humanoidBoneMapMissingNotified, true);
  } finally {
    globalThis.alert = originalAlert;
  }
});

/**
 * Creates a File-like object backed by a local file.
 * @param {string} path - File path.
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} File-like object.
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
 * Creates a minimal createImageBitmap mock for texture loading during tests.
 * @param {Blob} blob - Texture blob.
 * @returns {Promise<object>} ImageBitmap-like object.
 */
async function createImageBitmapMock(blob) {
  return {
    width: 1,
    height: 1,
    source: blob,
  };
}
