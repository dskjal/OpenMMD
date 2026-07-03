import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearBoneSelection,
  clearLightSelection,
  getSelectedBoneIndices,
  setMultiBoneSelection,
  setLightSelection,
  setSingleBoneSelection,
  toggleBoneSelection,
  resolveActiveBoneContext,
  resolveSelectedBoneContext,
  resolveSelectedBoneIndex,
  resetSelectionForInstanceChange,
} from '../source/core/selection/renderer-selection.js';

test('resetSelectionForInstanceChange clears bone selection state', () => {
  const selection = {
    selectedBoneIndex: 3,
    selectedTargetIndex: 2,
    selectedRigidbodyIndex: 1,
    selectedLight: true,
  };

  resetSelectionForInstanceChange(selection);

  assert.equal(selection.selectedBoneIndex, -1);
  assert.equal(selection.selectedTargetIndex, -1);
  assert.equal(selection.selectedRigidbodyIndex, -1);
  assert.equal(selection.selectedLight, false);
});

test('single and multi bone selection helpers keep active selection in sync', () => {
  const selection = {
    selectedBoneIndex: -1,
    selectedBoneIndices: [],
    activeBoneIndex: -1,
  };

  setSingleBoneSelection(selection, 4);
  assert.equal(selection.selectedBoneIndex, 4);
  assert.equal(selection.activeBoneIndex, 4);
  assert.deepEqual(selection.selectedBoneIndices, [4]);

  setMultiBoneSelection(selection, [4, 7, 4, 9]);
  assert.equal(selection.selectedBoneIndex, -1);
  assert.equal(selection.activeBoneIndex, -1);
  assert.deepEqual(selection.selectedBoneIndices, [4, 7, 9]);

  toggleBoneSelection(selection, 7);
  assert.equal(selection.selectedBoneIndex, 9);
  assert.equal(selection.activeBoneIndex, 9);
  assert.deepEqual(selection.selectedBoneIndices, [4, 9]);

  clearBoneSelection(selection);
  assert.equal(selection.selectedBoneIndex, -1);
  assert.equal(selection.activeBoneIndex, -1);
  assert.deepEqual(selection.selectedBoneIndices, []);
});

test('light selection helpers clear bone selection state', () => {
  const selection = {
    selectedBoneIndex: 5,
    selectedBoneIndices: [5],
    activeBoneIndex: 5,
    selectedTargetIndex: 3,
    selectedRigidbodyIndex: 2,
    selectedLight: false,
  };

  setLightSelection(selection);
  assert.equal(selection.selectedLight, true);
  assert.equal(selection.selectedBoneIndex, -1);
  assert.equal(selection.activeBoneIndex, -1);
  assert.deepEqual(selection.selectedBoneIndices, []);
  assert.equal(selection.selectedTargetIndex, -1);
  assert.equal(selection.selectedRigidbodyIndex, -1);

  clearLightSelection(selection);
  assert.equal(selection.selectedLight, false);
});

test('resolveSelectedBoneContext falls back to IK target bone index', () => {
  const modelManager = {
    instances: [
      {
        scene: {
          ikTargets: [
            { boneIndex: 1 },
          ],
          boneLocalTransforms: [
            { id: 'root-local' },
            { id: 'target-local' },
          ],
        },
        model: {
          bones: [
            { name: 'Root' },
            { name: 'Target' },
          ],
          bindBones: [
            { name: 'RootBind' },
            { name: 'TargetBind' },
          ],
        },
      },
    ],
  };
  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: 0,
  };

  const context = resolveSelectedBoneContext(modelManager, selection);

  assert.equal(context?.selectedBoneIndex, 1);
  assert.equal(context?.bone.name, 'Target');
  assert.equal(context?.local.id, 'target-local');
  assert.equal(context?.bindBone.name, 'TargetBind');
});

test('resolveActiveBoneContext exposes a boneIndex alias for active bone selection', () => {
  const modelManager = {
    instances: [
      {
        scene: {
          boneLocalTransforms: [
            { id: 'root-local' },
            { id: 'active-local' },
          ],
        },
        model: {
          bones: [
            { name: 'Root' },
            { name: 'Active' },
          ],
          bindBones: [
            { name: 'RootBind' },
            { name: 'ActiveBind' },
          ],
        },
      },
    ],
  };
  const selection = {
    activeInstanceIndex: 0,
    activeBoneIndex: 1,
  };

  const context = resolveActiveBoneContext(modelManager, selection);

  assert.equal(context?.activeBoneIndex, 1);
  assert.equal(context?.boneIndex, 1);
  assert.equal(context?.bone.name, 'Active');
  assert.equal(context?.local.id, 'active-local');
  assert.equal(context?.bindBone.name, 'ActiveBind');
});

test('resolveSelectedBoneIndex falls back to IK target bone index', () => {
  const instance = {
    scene: {
      ikTargets: [
        { boneIndex: 1 },
      ],
    },
  };
  const selection = {
    selectedBoneIndex: -1,
    selectedTargetIndex: 0,
  };

  assert.equal(resolveSelectedBoneIndex(instance, selection), 1);
});

test('getSelectedBoneIndices recovers single selection when the index array is empty', () => {
  const selection = {
    selectedBoneIndex: 3,
    selectedBoneIndices: [],
    activeBoneIndex: -1,
    selectedTargetIndex: -1,
  };

  assert.deepEqual(getSelectedBoneIndices(selection, null), [3]);
});
