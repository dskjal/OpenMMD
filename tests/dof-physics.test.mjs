import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOF_ALGORITHM_IDS,
  DOF_ALGORITHM_OPTIONS,
  computeDofCircleOfConfusionPixels,
  computeDofFocalLengthMm,
  createDofUniformData,
  DOF_DEFAULT_FAR_PLANE,
  DOF_DEFAULT_NEAR_PLANE,
  DOF_SENSOR_HEIGHT_MM,
  DOF_UNIFORM_OFFSETS,
  DOF_WORLD_UNITS_PER_METER,
  getDofAlgorithmConfig,
  normalizeDofAlgorithm,
} from '../source/shared/physics/dof-physics.js';

/**
 * 浮動小数の近似比較を行います。
 * @param {number} actual - 実値。
 * @param {number} expected - 期待値。
 * @param {number} [epsilon=1e-5] - 許容誤差。
 */
function assertApproximately(actual, expected, epsilon = 1e-5) {
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('computeDofFocalLengthMm derives focal length from fovY and sensor height', () => {
  const focalLengthMm = computeDofFocalLengthMm(45 * Math.PI / 180, DOF_SENSOR_HEIGHT_MM);
  assert.ok(Math.abs(focalLengthMm - 28.970562748) < 1e-6);
});

test('computeDofCircleOfConfusionPixels stays stable across scene scale changes', () => {
  const reference = computeDofCircleOfConfusionPixels({
    focusDistanceWorld: 20,
    depthWorld: 30,
    sceneScale: 10,
    fovY: 45 * Math.PI / 180,
    canvasHeight: 1080,
    sensorHeightMm: DOF_SENSOR_HEIGHT_MM,
    fStop: 2.8,
    blurAmount: 1.0,
  });
  const scaled = computeDofCircleOfConfusionPixels({
    focusDistanceWorld: 2,
    depthWorld: 3,
    sceneScale: 1,
    fovY: 45 * Math.PI / 180,
    canvasHeight: 1080,
    sensorHeightMm: DOF_SENSOR_HEIGHT_MM,
    fStop: 2.8,
    blurAmount: 1.0,
  });
  assert.ok(Math.abs(reference - scaled) < 1e-6);
});

test('createDofUniformData fills the packed uniform layout', () => {
  assert.equal(DOF_WORLD_UNITS_PER_METER, 1);
  const uniforms = createDofUniformData({
    focusDistanceWorld: 12,
    sceneScale: DOF_WORLD_UNITS_PER_METER,
    fovY: 45 * Math.PI / 180,
    canvasHeight: 1080,
    sensorHeightMm: DOF_SENSOR_HEIGHT_MM,
    dofAlgorithm: DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE,
    fStop: 2.8,
    blurAmount: 2.0,
    nearPlane: DOF_DEFAULT_NEAR_PLANE,
    farPlane: DOF_DEFAULT_FAR_PLANE,
  });

  assert.equal(uniforms[DOF_UNIFORM_OFFSETS.focusDistanceWorld], 12);
  assert.equal(uniforms[DOF_UNIFORM_OFFSETS.sceneScale], DOF_WORLD_UNITS_PER_METER);
  assert.ok(uniforms[DOF_UNIFORM_OFFSETS.focalLengthMm] > 0);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.fStop], 2.8);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.blurAmount], 2.0);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.nearPlane], DOF_DEFAULT_NEAR_PLANE);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.farPlane], DOF_DEFAULT_FAR_PLANE);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.sensorToPixelScale], 1080 * 1000 / DOF_SENSOR_HEIGHT_MM);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.algorithm], DOF_ALGORITHM_IDS[DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE]);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.sampleCount], 32);
  assertApproximately(uniforms[DOF_UNIFORM_OFFSETS.maxBlurRadius], 64);
});

test('normalizeDofAlgorithm falls back to fast for invalid values', () => {
  assert.equal(normalizeDofAlgorithm('depth-aware-gather'), DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER);
  assert.equal(normalizeDofAlgorithm('THIN-LENS-MULTISAMPLE'), DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE);
  assert.equal(normalizeDofAlgorithm('unknown'), DOF_ALGORITHM_OPTIONS.FAST);
});

test('getDofAlgorithmConfig returns per-algorithm quality presets', () => {
  const config = getDofAlgorithmConfig(DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER);
  assert.equal(config.id, DOF_ALGORITHM_IDS[DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER]);
  assert.equal(config.sampleCount, 24);
  assert.equal(config.maxBlurRadius, 56);
});
