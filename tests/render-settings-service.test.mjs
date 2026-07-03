import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderSettingsService } from '../source/application/render/render-settings-service.js';

test('render settings service normalizes aspect ratio and emits resize notifications', () => {
  const notifications = [];
  const rendererState = {
    aspectRatio: 'wide',
    internalResolution: '123x456',
    needsResize: false,
  };
  const service = createRenderSettingsService({
    rendererState,
    renderAspectPresets: [
      { id: 'wide', label: 'Wide', defaultResolution: '1280x720' },
      { id: 'square', label: 'Square', defaultResolution: '1024x1024' },
    ],
    findAspectPreset(id) {
      return id === 'square'
        ? { id: 'square', label: 'Square', defaultResolution: '1024x1024' }
        : { id: 'wide', label: 'Wide', defaultResolution: '1280x720' };
    },
    getResolutionOptionsForAspect(id) {
      return id === 'square' ? ['1024x1024'] : ['1280x720', '1920x1080'];
    },
    onViewportLayoutChanged(aspectRatioId) {
      notifications.push(`layout:${aspectRatioId}`);
    },
    onRenderResolutionChanged(detail) {
      notifications.push(`resize:${detail.aspectRatio}:${detail.internalResolution}`);
    },
  });

  const result = service.applyAspectRatio('square');
  assert.deepEqual(result, {
    aspectRatio: 'square',
    internalResolution: '1024x1024',
  });
  service.applyInternalResolution('auto');
  assert.equal(rendererState.needsResize, true);
  assert.deepEqual(notifications, [
    'layout:square',
    'resize:square:1024x1024',
    'resize:square:auto',
  ]);
});
