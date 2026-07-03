import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createColorTemperatureScale,
  estimateColorTemperatureFromLinearRgb,
} from '../source/infrastructure/gpu/renderer-gpu.js';

test('createColorTemperatureScale keeps 6500K neutral', () => {
  const scale = createColorTemperatureScale(6500);

  assert.ok(Math.abs(scale[0] - 1.0) < 0.0001);
  assert.ok(Math.abs(scale[1] - 1.0) < 0.0001);
  assert.ok(Math.abs(scale[2] - 1.0) < 0.0001);
});

test('createColorTemperatureScale warms low temperatures and cools high temperatures', () => {
  const warmScale = createColorTemperatureScale(3000);
  const coolScale = createColorTemperatureScale(10000);

  assert.ok(warmScale[0] > warmScale[2]);
  assert.ok(coolScale[2] > coolScale[0]);
});

test('estimateColorTemperatureFromLinearRgb keeps neutral samples near 6500K', () => {
  const estimated = estimateColorTemperatureFromLinearRgb([1.0, 1.0, 1.0]);

  assert.ok(Math.abs(estimated - 6500) <= 100);
});

test('estimateColorTemperatureFromLinearRgb pushes warm samples toward higher kelvin and cool samples toward lower kelvin', () => {
  const warmEstimate = estimateColorTemperatureFromLinearRgb([1.2, 1.0, 0.8]);
  const coolEstimate = estimateColorTemperatureFromLinearRgb([0.8, 1.0, 1.2]);

  assert.ok(warmEstimate > 6500);
  assert.ok(coolEstimate < 6500);
});
