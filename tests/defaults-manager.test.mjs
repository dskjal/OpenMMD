import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getDefaultsSnapshot,
  loadDefaults,
  resolveDefaults,
  resetDefaultsForTests,
} from '../source/infrastructure/config/defaults/defaults-manager.js';

test('getDefaultsSnapshot returns cloned section data', () => {
  const first = getDefaultsSnapshot('lightObject');
  first.position[0] = 999;

  const second = getDefaultsSnapshot('lightObject');
  assert.notEqual(second.position[0], 999);
  assert.deepEqual(second.position, [0.8, 1.8, 0.8]);
});

test('defaults cache starts from the fallback values aligned with defaults.json', async () => {
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  resetDefaultsForTests();

  const cachedDefaults = resolveDefaults();
  assert.equal(cachedDefaults.appState.dynamicRange, parsedDefaults.appState.dynamicRange);
  assert.equal(cachedDefaults.appState.mmdLengthToMetersScale, parsedDefaults.appState.mmdLengthToMetersScale);
  assert.equal(cachedDefaults.gridOverlay.thickness, parsedDefaults.gridOverlay.thickness);
});

test('loadDefaults reads the defaults JSON file', async () => {
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  const originalFetch = globalThis.fetch;

  try {
    resetDefaultsForTests();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(defaultsText),
    });

    await loadDefaults();
    const loadedDefaults = resolveDefaults();

    assert.equal(loadedDefaults.renderUi.aaMethod, parsedDefaults.renderUi.aaMethod);
    assert.equal(loadedDefaults.appState.environmentHdrName, parsedDefaults.appState.environmentHdrName);
    assert.equal(loadedDefaults.appState.dynamicRange, parsedDefaults.appState.dynamicRange);
    assert.equal(loadedDefaults.appState.mmdLengthToMetersScale, parsedDefaults.appState.mmdLengthToMetersScale);
    assert.equal(loadedDefaults.material.visible, true);
    assert.equal(loadedDefaults.material.roughness, 1);
    assert.equal(loadedDefaults.gridOverlay.thickness, parsedDefaults.gridOverlay.thickness);
    assert.deepEqual(getDefaultsSnapshot('camera').clipPlanes, parsedDefaults.camera.clipPlanes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadDefaults falls back when fetch is unavailable', async () => {
  resetDefaultsForTests();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = undefined;

    await loadDefaults();
    const loadedDefaults = resolveDefaults();

    assert.equal(loadedDefaults.appState.dynamicRange, 16);
    assert.equal(loadedDefaults.appState.mmdLengthToMetersScale, 0.07876027287775755);
    assert.equal(loadedDefaults.gridOverlay.thickness, 2);
    assert.equal(loadedDefaults.material.visible, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
