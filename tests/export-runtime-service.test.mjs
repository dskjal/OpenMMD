import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportRuntimeService } from '../source/application/export/export-runtime-service.js';

test('export runtime service snapshots and restores playback-driven export state', () => {
  const calls = [];
  const overlayState = {
    showBones: true,
    showBoneAxes: false,
    showPhysics: true,
    disablePhysics: false,
    hideIkBones: false,
    hideSpringBones: false,
    showGridXZ: true,
    showGridXY: false,
    showGridYZ: true,
  };
  const selectionOverlayPort = {
    getState() {
      return { ...overlayState };
    },
    applyState(nextState) {
      calls.push(['overlay', nextState]);
      Object.assign(overlayState, nextState);
    },
  };
  const rendererState = {
    msaaSampleCount: 4,
    renderingFPS: 60,
    internalResolution: '1280x720',
    needsResize: false,
    showCascadeShadowMaps: true,
    isVideoExporting: false,
  };
  const playbackController = {
    currentFrame: 24,
    isPlaying: true,
  };
  const service = createExportRuntimeService({
    canvas: { width: 1280, height: 720 },
    canvasTargets: {
      resize(sampleCount, resolution) {
        calls.push(['resize', sampleCount, resolution]);
      },
    },
    rendererState,
    selectionOverlayPort,
    playbackRuntimeService: {
      getPlaybackController() {
        return playbackController;
      },
      getPlaybackRange() {
        return { start: 0, end: null };
      },
      stop() {
        calls.push(['stop']);
      },
      play() {
        calls.push(['play']);
      },
      seek(frame, options) {
        calls.push(['seek', frame, options]);
      },
      getCurrentFrame() {
        return playbackController.currentFrame;
      },
      getMaxFrame() {
        return 0;
      },
    },
    refreshScene({ step }) {
      calls.push(['refresh', step]);
    },
  });

  const snapshot = service.snapshotExportState();
  service.prepareExportState(1920, 1080);
  service.restoreExportState(snapshot);

  assert.equal(rendererState.isVideoExporting, false);
  assert.equal(rendererState.internalResolution, '1280x720');
  assert.equal(overlayState.showBones, true);
  assert.deepEqual(calls, [
    ['overlay', {
      showBones: false,
      showPhysics: false,
      showGridXZ: false,
      showGridXY: false,
      showGridYZ: false,
      hideIkBones: true,
    }],
    ['stop'],
    ['resize', 4, '1920x1080'],
    ['refresh', 0],
    ['resize', 4, '1280x720'],
    ['overlay', {
      showBones: true,
      showBoneAxes: false,
      showPhysics: true,
      disablePhysics: false,
      hideIkBones: false,
      hideSpringBones: false,
      showGridXZ: true,
      showGridXY: false,
      showGridYZ: true,
    }],
    ['seek', 24, { keepManualValues: true }],
    ['play'],
    ['refresh', 0],
  ]);
});
