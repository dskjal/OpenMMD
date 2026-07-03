import assert from 'node:assert/strict';
import test from 'node:test';

import { createInspectorSyncCoordinator } from '../source/application/scene/inspector-sync-coordinator.js';

test('inspector sync coordinator delegates empty-state synchronization when no active instance exists', () => {
  const calls = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById() {
      return null;
    },
  };
  const coordinator = createInspectorSyncCoordinator({
    camera: null,
    rendererState: {
      lightObject: null,
      postEffects: {},
      environmentHdrIntensityMax: 1,
    },
    cameraUiState: {
      viewShortcutButtons: {},
      positionInputs: [],
      rotationInputs: [],
      targetInputs: [],
      selectedModelIndex: -1,
    },
    lightUiState: {
      positionInputs: [],
      rotationInputs: [],
      prevEuler: [0, 0, 0],
    },
    selection: {},
    modelManager: { instances: [] },
    getLangData: () => ({}),
    getActiveInstance: () => null,
    timelineOrchestrationService: {
      getCurrentFrame: () => 0,
      getSceneAnimationSource: () => null,
    },
    cameraService: {},
    lightService: {},
    extractCameraKeyframesFromAnimationClip: () => [],
    extractLightKeyframesFromAnimationClip: () => [],
    getKeyframeBackgroundColor: () => '',
    getLightKeyframeBackgroundColor: () => '',
    setInputBackgroundColor() {},
    findBoneIndexByName: () => -1,
    getBone: () => null,
    clickedMousePositionUiState: {},
    cameraDebugUiState: {},
    syncBoneInspectorUi(instance) {
      calls.push(`bone-inspector:${instance}`);
    },
    syncBoneDebugUi() {
      calls.push('bone-debug');
    },
    syncAnimationDebugUi() {
      calls.push('animation-debug');
    },
    syncBloomShadowDebugUi() {
      calls.push('bloom-debug');
    },
    updateSelectedBoneLabel() {
      calls.push('selected-bone');
    },
    updateSelectedRigidbodyLabel() {
      calls.push('selected-rigidbody');
    },
    syncMorphSliders() {
      calls.push('morph');
    },
    activeMorphIndices: [],
  });

  try {
    coordinator.syncInspectorUi();

    assert.deepEqual(calls, [
      'bone-inspector:null',
      'bone-debug',
      'animation-debug',
      'bloom-debug',
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});
