import assert from 'node:assert/strict';
import test from 'node:test';
import { quaternionToEulerXYZ, quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { unwrapAngle } from '../source/shared/math/math-utils.js';

test('Reproduce Euler angle flip bug (XYZ order, Y-axis > 90deg)', () => {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  // Case 1: -80 degrees Y rotation
  const angleY1 = -80 * toRad;
  const q1 = quaternionFromEulerXYZ([0, angleY1, 0]);
  const euler1 = quaternionToEulerXYZ(q1);
  
  console.log(`Input: Y = -80 deg`);
  console.log(`Output: X=${(euler1[0]*toDeg).toFixed(1)}, Y=${(euler1[1]*toDeg).toFixed(1)}, Z=${(euler1[2]*toDeg).toFixed(1)}`);
  
  assert.equal(Math.round(euler1[1] * toDeg), -80, 'Should be -80 degrees');

  // Case 2: -100 degrees Y rotation
  // At Y = -100, the raw conversion (asin based) will return -80 for Y,
  // and flip X and Z by 180 degrees to represent the same orientation.
  const angleY2 = -100 * toRad;
  const q2 = quaternionFromEulerXYZ([0, angleY2, 0]);
  const euler2 = quaternionToEulerXYZ(q2);

  console.log(`Input: Y = -100 deg`);
  console.log(`Output: X=${(euler2[0]*toDeg).toFixed(1)}, Y=${(euler2[1]*toDeg).toFixed(1)}, Z=${(euler2[2]*toDeg).toFixed(1)}`);

  // Bug reproduction: Y returns to -80 instead of -100, X and Z are flipped to 180/-180
  assert.equal(Math.round(euler2[1] * toDeg), -80, 'Y axis flips back to -80 instead of -100');
  assert.ok(Math.abs(Math.round(euler2[0] * toDeg)) === 180, 'X axis should be flipped to 180');
  assert.ok(Math.abs(Math.round(euler2[2] * toDeg)) === 180, 'Z axis should be flipped to 180');
});

test('Verify quaternionToEulerXYZ fixes the flip bug when history is maintained', () => {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  // Initial state: -80 deg
  let prevEuler = [0, -80 * toRad, 0];

  // Target state: -100 deg
  const targetQ = quaternionFromEulerXYZ([0, -100 * toRad, 0]);
  
  // Use the new history-aware conversion
  const fixedEuler = quaternionToEulerXYZ(targetQ, prevEuler);

  console.log(`Input: -100 deg (via history)`);
  console.log(`Fixed Output: X=${(fixedEuler[0]*toDeg).toFixed(1)}, Y=${(fixedEuler[1]*toDeg).toFixed(1)}, Z=${(fixedEuler[2]*toDeg).toFixed(1)}`);

  assert.equal(Math.round(fixedEuler[1] * toDeg), -100, 'Fixed Y should be -100');
  assert.equal(Math.round(fixedEuler[0] * toDeg), 0, 'Fixed X should stay 0');
  assert.equal(Math.round(fixedEuler[2] * toDeg), 0, 'Fixed Z should stay 0');
});
