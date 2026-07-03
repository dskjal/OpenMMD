import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hexToLinearRgba,
  hsvToLinearRgba,
  hsvToRgb,
  linearRgbaToHex,
  linearRgbaToHsv,
  linearRgbaToPerceptualRgba,
  perceptualRgbaToLinearRgba,
} from '../source/shared/color/color-utils.js';

function nearlyEqual(left, right, epsilon = 1e-4) {
  return Math.abs(left - right) <= epsilon;
}

test('linear and perceptual RGBA round-trip', () => {
  const input = [0.25, 0.5, 0.75, 0.8];
  const perceptual = linearRgbaToPerceptualRgba(input);
  const output = perceptualRgbaToLinearRgba(perceptual);

  assert.equal(output.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(nearlyEqual(output[i], input[i]));
  }
});

test('linear RGBA converts to 8-digit hex and back', () => {
  const input = [0.1, 0.2, 0.3, 0.4];
  const hex = linearRgbaToHex(input);
  const output = hexToLinearRgba(hex);

  assert.equal(hex.length, 9);
  for (let i = 0; i < 4; i++) {
    assert.ok(nearlyEqual(output[i], input[i], 0.03));
  }
});

test('HSV conversion keeps hue and value in expected ranges', () => {
  const perceptualRgb = hsvToRgb([210, 0.5, 0.75]);
  const linearRgba = perceptualRgbaToLinearRgba([perceptualRgb[0], perceptualRgb[1], perceptualRgb[2], 1.0]);
  const hsv = linearRgbaToHsv(linearRgba);

  assert.ok(nearlyEqual(hsv[0], 210, 1e-2));
  assert.ok(nearlyEqual(hsv[1], 0.5, 1e-2));
  assert.ok(nearlyEqual(hsv[2], 0.75, 1e-2));
});

test('HSV to linear RGBA preserves alpha', () => {
  const output = hsvToLinearRgba([120, 0.25, 0.5, 0.9]);

  assert.ok(output[3] === 0.9);
  assert.ok(output[0] >= 0 && output[0] <= 1);
  assert.ok(output[1] >= 0 && output[1] <= 1);
  assert.ok(output[2] >= 0 && output[2] <= 1);
});
