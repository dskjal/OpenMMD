import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quaternionFromEulerXYZ,
  quaternionFromEulerYXZ,
} from '../source/shared/math/math-utils.js';
import {
  createWorldRotationUiState,
  setWorldRotationDisplay,
  syncWorldRotationDisplay,
} from '../source/ui/panels/world-rotation-ui.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function toDegree(value) {
  return Math.round(value * DEG);
}

test('world rotation UI keeps Y and Z stable when X changes during editing', () => {
  const state = createWorldRotationUiState();
  const boneIndex = 0;
  const baseEuler = [10 * RAD, 20 * RAD, 30 * RAD];
  const updatedEuler = [25 * RAD, 20 * RAD, 30 * RAD];
  const updatedRotation = quaternionFromEulerXYZ(updatedEuler);

  setWorldRotationDisplay(state, boneIndex, baseEuler);
  const stableAfter = syncWorldRotationDisplay(state, boneIndex, updatedRotation, true, baseEuler);

  assert.equal(toDegree(stableAfter[0]), 10);
  assert.equal(toDegree(stableAfter[1]), 20);
  assert.equal(toDegree(stableAfter[2]), 30);
});

test('world rotation UI uses YXZ for torso bones and XYZ for arm bones', () => {
  const torsoState = createWorldRotationUiState();
  const torsoEuler = [12 * RAD, -18 * RAD, 25 * RAD];
  const torsoRotation = quaternionFromEulerYXZ(torsoEuler);
  const torsoAfter = syncWorldRotationDisplay(torsoState, 0, torsoRotation, false, null, '上半身');

  assert.ok(Math.abs(torsoAfter[0] - torsoEuler[0]) <= 1e-6);
  assert.ok(Math.abs(torsoAfter[1] - torsoEuler[1]) <= 1e-6);
  assert.ok(Math.abs(torsoAfter[2] - torsoEuler[2]) <= 1e-6);

  const armState = createWorldRotationUiState();
  const armEuler = [7 * RAD, 22 * RAD, -14 * RAD];
  const armRotation = quaternionFromEulerXYZ(armEuler);
  const armAfter = syncWorldRotationDisplay(armState, 1, armRotation, false, null, '左腕');

  assert.ok(Math.abs(armAfter[0] - armEuler[0]) <= 1e-6);
  assert.ok(Math.abs(armAfter[1] - armEuler[1]) <= 1e-6);
  assert.ok(Math.abs(armAfter[2] - armEuler[2]) <= 1e-6);
});
