import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDisplayPresetUiSettings,
  getAppliedDisplayPresetValues,
  normalizeDisplayPreset,
  readDisplayPresetCookie,
  writeDisplayPresetCookie,
} from '../source/shared/render/display-preset.js';

test('display preset helpers normalize values and preserve HDR overrides', () => {
  assert.equal(normalizeDisplayPreset('HDR'), 'hdr');
  assert.equal(normalizeDisplayPreset('unknown'), 'sdr');

  const hdrDefaults = getAppliedDisplayPresetValues('hdr', {
    gltfLightStrength: 0.5,
    shadowPower: 1.0,
    environmentHdrIntensity: 0.0,
  });
  assert.equal(hdrDefaults.viewTransform, 'aces-2.0');
  assert.equal(hdrDefaults.shaderName, 'mtoon-shader.wgsl');
  assert.equal(hdrDefaults.gamma, 0.2);
  assert.equal(hdrDefaults.gltfLightStrength, 4.0);
  assert.equal(hdrDefaults.shadowPower, 1.5);
  assert.equal(hdrDefaults.environmentHdrIntensity, 1.0);

  const hdrPreserved = getAppliedDisplayPresetValues('hdr', {
    gltfLightStrength: 1.25,
    shadowPower: 3.0,
    environmentHdrIntensity: 0.25,
  });
  assert.equal(hdrPreserved.gltfLightStrength, 1.25);
  assert.equal(hdrPreserved.shadowPower, 3.0);
  assert.equal(hdrPreserved.environmentHdrIntensity, 0.25);

  const sdrValues = getAppliedDisplayPresetValues('sdr', {
    gltfLightStrength: 4.0,
    shadowPower: 9.0,
    environmentHdrIntensity: 0.75,
  });
  assert.equal(sdrValues.viewTransform, 'standard');
  assert.equal(sdrValues.shaderName, 'mmd-shader.wgsl');
  assert.equal(sdrValues.gamma, 1.0);
  assert.equal(sdrValues.gltfLightStrength, 1.0);
  assert.equal(sdrValues.shadowPower, 1.0);
  assert.equal(sdrValues.environmentHdrIntensity, 0.0);

  const uiSettings = createDisplayPresetUiSettings('hdr');
  assert.equal(uiSettings.type, 'ui');
  assert.equal(uiSettings['display-preset-selector'], 'hdr');
  assert.equal(uiSettings['view-transform-selector'], 'aces-2.0');
  assert.equal(uiSettings['light-color-strength-range'], 4);
  assert.equal(uiSettings['shadow-power'], 1.5);
});

test('display preset cookie helpers round-trip the saved preset', () => {
  const fakeDocument = { cookie: '' };
  assert.equal(readDisplayPresetCookie(fakeDocument), 'sdr');

  const written = writeDisplayPresetCookie(fakeDocument, 'hdr');
  assert.equal(written.includes('openmmd-display-preset=hdr'), true);
  assert.equal(readDisplayPresetCookie(fakeDocument), 'hdr');
});
