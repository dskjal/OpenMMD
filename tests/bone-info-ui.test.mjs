import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearBoneInfoUiState,
  createBoneInfoUiState,
  setBoneInfoUiState,
  syncBoneInfoUiState,
} from '../source/ui/panels/bone-info-ui.js';

test('bone info ui keeps the last displayed values while editing the same bone', () => {
  const state = createBoneInfoUiState();

  const first = syncBoneInfoUiState(state, {
    boneIndex: 3,
    mode: 'local',
    editing: false,
    position: [1, 2, 3],
    rotation: [10, 20, 30],
  });
  assert.deepEqual(first.position, [1, 2, 3]);
  assert.deepEqual(first.rotation, [10, 20, 30]);

  const editing = syncBoneInfoUiState(state, {
    boneIndex: 3,
    mode: 'local',
    editing: true,
    position: [4, 5, 6],
    rotation: [40, 50, 60],
  });
  assert.deepEqual(editing.position, [1, 2, 3]);
  assert.deepEqual(editing.rotation, [10, 20, 30]);

  const next = syncBoneInfoUiState(state, {
    boneIndex: 3,
    mode: 'local',
    editing: false,
    position: [4, 5, 6],
    rotation: [40, 50, 60],
  });
  assert.deepEqual(next.position, [4, 5, 6]);
  assert.deepEqual(next.rotation, [40, 50, 60]);
});

test('bone info ui refreshes its cache when bone or mode changes', () => {
  const state = createBoneInfoUiState();

  syncBoneInfoUiState(state, {
    boneIndex: 1,
    mode: 'local',
    editing: false,
    position: [1, 1, 1],
    rotation: [1, 2, 3],
  });

  const world = syncBoneInfoUiState(state, {
    boneIndex: 1,
    mode: 'world',
    editing: true,
    position: [9, 8, 7],
    rotation: [90, 80, 70],
  });
  assert.deepEqual(world.position, [9, 8, 7]);
  assert.deepEqual(world.rotation, [90, 80, 70]);

  const anotherBone = syncBoneInfoUiState(state, {
    boneIndex: 2,
    mode: 'world',
    editing: true,
    position: [6, 5, 4],
    rotation: [60, 50, 40],
  });
  assert.deepEqual(anotherBone.position, [6, 5, 4]);
  assert.deepEqual(anotherBone.rotation, [60, 50, 40]);
});

test('bone info ui clears its cache', () => {
  const state = createBoneInfoUiState();

  syncBoneInfoUiState(state, {
    boneIndex: 1,
    mode: 'local',
    editing: false,
    position: [1, 2, 3],
    rotation: [4, 5, 6],
  });

  clearBoneInfoUiState(state);

  assert.equal(state.boneIndex, -1);
  assert.equal(state.mode, 'local');
  assert.equal(state.position, null);
  assert.equal(state.rotation, null);
});

test('bone info ui uses the explicit cache values while editing the same bone', () => {
  const state = createBoneInfoUiState();

  setBoneInfoUiState(state, 4, 'world', [1.5, 2.5, 3.5], [15, 25, 35]);
  const editing = syncBoneInfoUiState(state, {
    boneIndex: 4,
    mode: 'world',
    editing: true,
    position: [9, 8, 7],
    rotation: [90, 80, 70],
  });

  assert.deepEqual(editing.position, [1.5, 2.5, 3.5]);
  assert.deepEqual(editing.rotation, [15, 25, 35]);
});
