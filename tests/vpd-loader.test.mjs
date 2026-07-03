import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { VPDLoader } from '../source/infrastructure/loaders/vpd-loader.js';

/**
 * Asserts that two floating-point values are close enough.
 * @param {number} actual - Actual value.
 * @param {number} expected - Expected value.
 * @param {number} [epsilon=1e-6] - Allowed error.
 */
function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
}

test('VPD Loader parses the sample pose fixture', async () => {
  const bytes = await fs.readFile('./test-data/test.vpd');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const loader = new VPDLoader();
  const vpd = loader.parse(buffer);

  assert.equal(vpd.signature, 'Vocaloid Pose Data file');
  assert.equal(vpd.modelName, '初音ミク.osm');
  assert.equal(vpd.boneCount, 2);
  assert.equal(vpd.bones.length, 2);
  assert.equal(vpd.bones[0].name, '右足ＩＫ');
  assertClose(vpd.bones[0].position[0], 0);
  assertClose(vpd.bones[0].position[1], 3.45);
  assertClose(vpd.bones[0].position[2], 0);
  assertClose(vpd.bones[0].rotation[0], 0);
  assertClose(vpd.bones[0].rotation[1], 0);
  assertClose(vpd.bones[0].rotation[2], 0);
  assertClose(vpd.bones[0].rotation[3], 1);
  assert.equal(vpd.bones[1].name, '右ひじ');
  assertClose(vpd.bones[1].position[0], 0);
  assertClose(vpd.bones[1].position[1], 0);
  assertClose(vpd.bones[1].position[2], 0);
  assertClose(vpd.bones[1].rotation[0], -0.254777);
  assertClose(vpd.bones[1].rotation[1], 0.400929);
  assertClose(vpd.bones[1].rotation[2], 0.000063);
  assertClose(vpd.bones[1].rotation[3], 0.879969);
  assert.equal(vpd.readBytes, buffer.byteLength);
});
