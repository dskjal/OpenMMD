import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACES_LUT_SIZE,
  applyAcesApproximation,
  createAcesLutData,
  DISPLAY_COLOR_SPACE_DISPLAY_P3,
  DISPLAY_COLOR_SPACE_SRGB,
  encodeSrgbLike,
  linearToLutCoord,
  lutCoordToLinear,
  normalizeDisplayColorSpace,
  normalizeViewTransform,
  VIEW_TRANSFORM_ACES_20,
  VIEW_TRANSFORM_STANDARD,
} from '../source/shared/math/view-transform.js';

test('normalize helpers clamp unknown values to defaults', () => {
  assert.equal(normalizeViewTransform('ACES-2.0'), VIEW_TRANSFORM_ACES_20);
  assert.equal(normalizeViewTransform('unknown'), VIEW_TRANSFORM_STANDARD);
  assert.equal(normalizeDisplayColorSpace('display-p3'), DISPLAY_COLOR_SPACE_DISPLAY_P3);
  assert.equal(normalizeDisplayColorSpace('unknown'), DISPLAY_COLOR_SPACE_SRGB);
});

test('lut shaper round-trips representative linear values', () => {
  for (const value of [0.0, 0.18, 1.0, 4.0, 16.0]) {
    const coord = linearToLutCoord(value);
    const roundTripped = lutCoordToLinear(coord);
    assert.ok(Math.abs(roundTripped - value) < Math.max(0.002, value * 0.002));
  }
});

test('ACES LUT data is generated for both output gamuts', () => {
  const srgbLut = createAcesLutData(ACES_LUT_SIZE, DISPLAY_COLOR_SPACE_SRGB);
  const displayP3Lut = createAcesLutData(ACES_LUT_SIZE, DISPLAY_COLOR_SPACE_DISPLAY_P3);
  const sampleOffset = Math.floor(srgbLut.length / 2);

  assert.equal(srgbLut.length, ACES_LUT_SIZE * ACES_LUT_SIZE * ACES_LUT_SIZE * 4);
  assert.equal(displayP3Lut.length, srgbLut.length);
  assert.notDeepEqual(
    Array.from(displayP3Lut.slice(sampleOffset, sampleOffset + 24)),
    Array.from(srgbLut.slice(sampleOffset, sampleOffset + 24)),
  );
});

test('ACES approximation compresses bright highlights into display range', () => {
  const mapped = applyAcesApproximation([8.0, 4.0, 2.0]);

  assert.ok(mapped.every((value) => value >= 0.0 && value <= 1.0));
  assert.ok(mapped[0] >= mapped[1]);
  assert.ok(mapped[1] >= mapped[2]);
});

test('display encoding keeps values inside unit interval', () => {
  assert.equal(encodeSrgbLike(-1.0), 0.0);
  assert.ok(Math.abs(encodeSrgbLike(2.0) - 1.0) < 1e-12);
  assert.ok(encodeSrgbLike(0.18) > 0.18);
});
