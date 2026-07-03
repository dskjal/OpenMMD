import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoneEditingService } from '../source/application/editing/bone-editing-service.js';

test('bone editing service builds VPD export payload from selected bones', () => {
  const instance = {
    model: { name: 'Hero' },
  };
  const service = createBoneEditingService({
    selection: {},
    getActiveInstance: () => instance,
    getSelectedBoneIndices: () => [2],
    buildVpdPoseData: () => ({
      modelName: 'Hero',
      bones: [{ name: 'Center' }],
    }),
    denormalizeVpdFromInternalUnits: (value) => value,
    vpdWriter: {
      write: () => new ArrayBuffer(8),
    },
    createVpdDownloadName: (name) => `${name}.vpd`,
  });

  const result = service.buildSelectedBoneVpdExport();
  assert.equal(result.fileName, 'Hero.vpd');
  assert.equal(result.buffer.byteLength, 8);
});

test('bone editing service handles timeline bone selection and exposes interpolation', () => {
  const selection = {
    selectedTargetIndex: 4,
    selectedRigidbodyIndex: 9,
  };
  const activeInstance = {
    model: {
      bones: [{ name: 'Center' }],
    },
  };
  const selectedIndices = [];
  const service = createBoneEditingService({
    selection,
    getActiveInstance: () => activeInstance,
    setSingleBoneSelection: (_selection, boneIndex) => {
      selectedIndices.push(boneIndex);
    },
    getSelectedTimelineEntries: () => [{ id: 'only-entry' }],
  });

  const result = service.handleTimelineBoneSelection(
    { category: 'bone', label: 'Center' },
    { source: { interpolation: [1, 2, 3, 4] } },
  );

  assert.equal(result.shouldRefresh, true);
  assert.deepEqual(result.interpolation, [1, 2, 3, 4]);
  assert.deepEqual(selectedIndices, [0]);
  assert.equal(selection.selectedTargetIndex, -1);
  assert.equal(selection.selectedRigidbodyIndex, -1);
});
