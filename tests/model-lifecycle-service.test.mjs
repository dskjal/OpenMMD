import assert from 'node:assert/strict';
import test from 'node:test';

import { createModelLifecycleService } from '../source/application/models/model-lifecycle-service.js';

test('model lifecycle service activates an instance and synchronizes dependent UI', () => {
  const calls = [];
  const selection = {
    activeInstanceIndex: 0,
    worldRotationUiState: {},
    selectedBoneIndex: 1,
    selectedTargetIndex: 2,
    selectedRigidbodyIndex: 3,
    lastSelectedBoneIndex: 4,
    prevEuler: [1, 2, 3],
  };
  const instances = [
    { model: { name: 'A' }, morphController: { id: 'a' } },
    { model: { name: 'B' }, morphController: { id: 'b' } },
  ];
  const playbackRuntimeService = {
    setActiveInstance(index) {
      calls.push(['setActiveInstance', index]);
    },
    getPlaybackRange() {
      return { start: 0, end: null };
    },
  };
  const service = createModelLifecycleService({
    selection,
    playbackRuntimeService,
    getActiveInstance() {
      return instances[selection.activeInstanceIndex] ?? null;
    },
    clearWorldRotationDisplay() {
      calls.push(['clearWorldRotationDisplay']);
    },
    updateModelListUi() {
      calls.push(['updateModelListUi']);
    },
    updateVmdListUI() {
      calls.push(['updateVmdListUI']);
    },
    updateActiveMorphIndices() {
      calls.push(['updateActiveMorphIndices']);
    },
    syncMaterialTabUi() {
      calls.push(['syncMaterialTabUi']);
    },
    syncAnimationMappingTabUi() {
      calls.push(['syncAnimationMappingTabUi']);
    },
    selectDefaultBoneForInstance(instance) {
      calls.push(['selectDefaultBoneForInstance', instance.model.name]);
    },
    renderMorphUi(model) {
      calls.push(['renderMorphUi', model.name]);
    },
  });

  service.activateInstance(1);

  assert.equal(selection.activeInstanceIndex, 1);
  assert.deepEqual(calls, [
    ['clearWorldRotationDisplay'],
    ['updateModelListUi'],
    ['updateVmdListUI'],
    ['updateActiveMorphIndices'],
    ['syncMaterialTabUi'],
    ['syncAnimationMappingTabUi'],
    ['selectDefaultBoneForInstance', 'B'],
    ['renderMorphUi', 'B'],
    ['setActiveInstance', 1],
  ]);
});
