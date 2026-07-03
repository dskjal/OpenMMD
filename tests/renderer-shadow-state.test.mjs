import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createShadowState,
  syncShadowUniforms,
} from '../source/infrastructure/gpu/renderer-shadow-state.js';
import { GLOBAL_UNIFORM_OFFSETS } from '../source/infrastructure/gpu/renderer-gpu.js';

function roundValues(values) {
  return values.map((value) => Number(value.toFixed(3)));
}

test('createShadowState keeps edge size and opacity separate', () => {
  const state = createShadowState({
    edgeOpacity: 0.75,
    shadowPower: 2.5,
    shadowBias: 0.012,
    shadowStrength: 0.9,
  });

  assert.equal(state.shadowEdgeSize, 0.08);
  assert.equal(state.edgeShadowEdgeSize, 0.002);
  assert.equal(state.shadowEdgeOpacity, 0.75);
  assert.equal(state.shadowPower, 2.5);
  assert.equal(state.shadowBias, 0.012);
  assert.equal(state.shadowStrength, 0.9);
});

test('syncShadowUniforms writes both shadow parameter buffers', () => {
  const uniformData = new Float32Array(136);
  const edgeUniformData = new Float32Array(136);
  const writes = [];
  const globalResources = {
    uniformData,
    edgeUniformData,
    uniformBuffer: { name: 'uniform' },
    edgeUniformBuffer: { name: 'edge' },
    dynamicRange: 6.5,
    gridThickness: 2.25,
  };
  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({
          buffer: buffer.name,
          offset,
          shadowParams: roundValues(Array.from(data.slice(GLOBAL_UNIFORM_OFFSETS.shadowParams, GLOBAL_UNIFORM_OFFSETS.shadowParams + 4))),
          shadowPowerParams: roundValues(Array.from(data.slice(GLOBAL_UNIFORM_OFFSETS.shadowPowerParams, GLOBAL_UNIFORM_OFFSETS.shadowPowerParams + 4))),
        });
      },
    },
  };

  syncShadowUniforms(globalResources, device, {
    shadowEdgeSize: 0.08,
    edgeShadowEdgeSize: 0.002,
    shadowEdgeOpacity: 0.6,
    shadowPower: 3.0,
    shadowBias: 0.01,
    shadowStrength: 0.9,
  });

  assert.deepEqual(roundValues(Array.from(uniformData.slice(GLOBAL_UNIFORM_OFFSETS.shadowParams, GLOBAL_UNIFORM_OFFSETS.shadowParams + 4))), [0.08, 0.6, 0.01, 0.9]);
  assert.deepEqual(roundValues(Array.from(edgeUniformData.slice(GLOBAL_UNIFORM_OFFSETS.shadowParams, GLOBAL_UNIFORM_OFFSETS.shadowParams + 4))), [0.002, 0.6, 0.01, 0.9]);
  assert.deepEqual(roundValues(Array.from(uniformData.slice(GLOBAL_UNIFORM_OFFSETS.shadowPowerParams, GLOBAL_UNIFORM_OFFSETS.shadowPowerParams + 4))), [3.0, 6.5, 2.25, 0.0]);
  assert.deepEqual(roundValues(Array.from(edgeUniformData.slice(GLOBAL_UNIFORM_OFFSETS.shadowPowerParams, GLOBAL_UNIFORM_OFFSETS.shadowPowerParams + 4))), [3.0, 6.5, 2.25, 0.0]);
  assert.deepEqual(writes, [
    { buffer: 'uniform', offset: 0, shadowParams: [0.08, 0.6, 0.01, 0.9], shadowPowerParams: [3.0, 6.5, 2.25, 0.0] },
    { buffer: 'edge', offset: 0, shadowParams: [0.002, 0.6, 0.01, 0.9], shadowPowerParams: [3.0, 6.5, 2.25, 0.0] },
  ]);
});
