import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDrawLightOverlay } from '../source/infrastructure/gpu/render-loop.js';

test('shouldDrawLightOverlay hides the UI light during video export', () => {
  assert.equal(shouldDrawLightOverlay({ isVideoExporting: true }), false);
  assert.equal(shouldDrawLightOverlay({ isVideoExporting: false }), true);
  assert.equal(shouldDrawLightOverlay({}), true);
  assert.equal(shouldDrawLightOverlay(null), true);
});
