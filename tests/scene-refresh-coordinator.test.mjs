import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneRefreshCoordinator } from '../source/application/scene/scene-refresh-coordinator.js';

test('scene refresh coordinator applies scene updates in the expected order', () => {
  const calls = [];
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: Math.PI / 4,
    clipPlanes: { near: 0.1, far: 1000 },
  };
  const activeInstance = {
    animationController: {
      currentFrame: 12,
    },
  };
  const coordinator = createSceneRefreshCoordinator({
    camera,
    playbackRuntimeService: {
      syncTimelineUi() {
        calls.push('timeline');
      },
    },
    getBgmManager() {
      return {
        syncFromActivePlayback() {
          calls.push('bgm');
        },
      };
    },
    bgmManager: {
      syncFromActivePlayback() {
        calls.push('legacy-bgm');
      },
    },
    getActiveInstance() {
      return activeInstance;
    },
    cameraService: {
      applyMotionFromActiveInstance(instance) {
        calls.push(`camera-motion:${instance === activeInstance}`);
      },
    },
    lightService: {
      applyMotionFromActiveInstance(instance) {
        calls.push(`light-motion:${instance === activeInstance}`);
      },
    },
    updateSceneState(step) {
      calls.push(`update:${step}`);
    },
    syncInspectorUi() {
      calls.push('inspector');
    },
  });

  coordinator.refreshScene({ step: 0 });

  assert.deepEqual(calls, [
    'camera-motion:true',
    'light-motion:true',
    'update:0',
    'bgm',
    'inspector',
    'timeline',
  ]);
});
