import assert from 'node:assert/strict';
import test from 'node:test';

function normalizeAngle(angle, mid) {
  let normalized = angle;
  while (normalized > mid + Math.PI) normalized -= Math.PI * 2;
  while (normalized < mid - Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

test('Verify fixed logic handles -PI boundary correctly', () => {
  const minAngle = -Math.PI;
  const maxAngle = -0.008;
  const mid = (minAngle + maxAngle) / 2;
  
  const currentAngle = -3.14; // Near -PI
  const deltaAngle = -0.01;   // Move further negative -> -3.15
  
  const sum = currentAngle + deltaAngle;
  // Previously we used normalizeRadians(sum) here which flipped it to +3.13
  const normalizedSum = normalizeAngle(sum, mid);
  const nextAngle = clamp(normalizedSum, minAngle, maxAngle);
  
  console.log(`current=${currentAngle}`);
  console.log(`delta=${deltaAngle}`);
  console.log(`sum=${sum}`);
  console.log(`normalizedSum=${normalizedSum}`);
  console.log(`nextAngle=${nextAngle}`);
  
  assert.ok(nextAngle <= maxAngle && nextAngle >= minAngle, `Expected nextAngle within range, got ${nextAngle}`);
  assert.ok(nextAngle < -3.1, `Expected nextAngle to be near -PI, but got ${nextAngle}`);
});
