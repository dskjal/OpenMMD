import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoneEditingService } from '../source/application/editing/bone-editing-service.js';
import { createBoneInspectorState } from '../source/application/editing/bone-inspector-state.js';

test('bone editing service updates display caches from current input values', () => {
  const inspectorState = createBoneInspectorState();
  inspectorState.useWorldCoordinate = true;
  const boneInfoCalls = [];
  const worldRotationCalls = [];
  const service = createBoneEditingService({
    selection: {},
    inspectorState,
    setBoneInfoUiState: (...args) => {
      boneInfoCalls.push(args);
    },
    setWorldRotationDisplay: (...args) => {
      worldRotationCalls.push(args);
    },
  });

  service.syncBoneInputDisplayCaches(4, 1, 2, 3, Math.PI / 6, Math.PI / 4, Math.PI / 3);

  assert.equal(boneInfoCalls.length, 1);
  assert.deepEqual(boneInfoCalls[0].slice(0, 4), [
    inspectorState.boneInfoUiState,
    4,
    'world',
    [1, 2, 3],
  ]);
  assert.ok(Math.abs(boneInfoCalls[0][4][0] - 30) < 1e-9);
  assert.ok(Math.abs(boneInfoCalls[0][4][1] - 45) < 1e-9);
  assert.ok(Math.abs(boneInfoCalls[0][4][2] - 60) < 1e-9);
  assert.deepEqual(inspectorState.prevEuler, [Math.PI / 6, Math.PI / 4, Math.PI / 3]);
  assert.deepEqual(worldRotationCalls[0], [
    inspectorState.worldRotationUiState,
    4,
    [Math.PI / 6, Math.PI / 4, Math.PI / 3],
  ]);
});

test('bone editing service skips world rotation cache in local mode', () => {
  const inspectorState = createBoneInspectorState();
  inspectorState.useWorldCoordinate = false;
  const worldRotationCalls = [];
  const service = createBoneEditingService({
    selection: {},
    inspectorState,
    setBoneInfoUiState: () => {},
    setWorldRotationDisplay: (...args) => {
      worldRotationCalls.push(args);
    },
  });

  service.syncBoneInputDisplayCaches(2, 0, 0, 0, 0.1, 0.2, 0.3);

  assert.equal(worldRotationCalls.length, 0);
});
