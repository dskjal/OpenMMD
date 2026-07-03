import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyUiSettingsJsonData,
  buildUiSettingsJsonData,
  loadUiSettingsFile,
  parseUiSettingsJsonText,
} from '../source/infrastructure/config/ui-settings-loader.js';

test('buildUiSettingsJsonData serializes every configured section', () => {
  const data = buildUiSettingsJsonData({
    uiSettingsPort: {
      readAnimationState: () => ({ playbackRange: { start: 12, end: 48 } }),
      readShortcutState: () => ({ showBones: true, gridSize: 2.5 }),
      readVideoExportState: () => ({ format: 'webm', codec: 'vp9' }),
      readRenderState: () => ({ displayPreset: 'hdr', aaMethod: 'msaa4' }),
      readPostEffectState: () => ({ bloomEnabled: true, gamma: 1.2 }),
      readCameraState: () => ({ modelName: 'Alicia', boneName: 'Head' }),
      readLightState: () => ({ gltfLightStrength: 1.8 }),
    },
  });

  assert.deepEqual(data, {
    type: 'ui',
    animation: { playbackRange: { start: 12, end: 48 } },
    shortcuts: { showBones: true, gridSize: 2.5 },
    videoExport: { format: 'webm', codec: 'vp9' },
    render: { displayPreset: 'hdr', aaMethod: 'msaa4' },
    postEffect: { bloomEnabled: true, gamma: 1.2 },
    camera: { modelName: 'Alicia', boneName: 'Head' },
    light: { gltfLightStrength: 1.8 },
  });
});

test('loadUiSettingsFile applies ui settings sections from the sample JSON in schema order', async () => {
  const applied = [];
  const sampleText = await readFile(new URL('../test-data/ui.json', import.meta.url), 'utf8');

  const result = await loadUiSettingsFile({
    text: async () => sampleText,
  }, {
    uiSettingsPort: {
      applyAnimationState: (value) => applied.push(['animation', value]),
      applyShortcutState: (value) => applied.push(['shortcuts', value]),
      applyVideoExportState: async (value) => applied.push(['videoExport', value]),
      applyRenderState: async (value) => applied.push(['render', value]),
      applyPostEffectState: (value) => applied.push(['postEffect', value]),
      applyCameraState: (value) => applied.push(['camera', value]),
      applyLightState: (value) => applied.push(['light', value]),
    },
  });

  assert.equal(result.applied, true);
  assert.deepEqual(result.appliedKeys, [
    'animation',
    'shortcuts',
    'videoExport',
    'render',
    'postEffect',
    'camera',
    'light',
  ]);
  assert.equal(applied.length, 7);
  assert.deepEqual(applied[0][1], { playbackRange: { start: 0, end: 240 } });
  assert.deepEqual(applied[3][1], {
    displayPreset: 'hdr',
    renderingFps: 60,
    viewTransform: 'aces-2.0',
    displayColorSpace: 'display-p3',
    aspectRatio: '16:9',
    internalResolution: '1920x1080',
    aaMethod: 'msaa4',
    environmentHdrIntensity: 1.4,
    shadowBias: 0.0002,
    shadowPower: 2.5,
    shadowStrength: 0.85,
    shadowEdgeOpacity: 0.4,
    showCascadeShadowMaps: false,
    showBloomShadowDebug: false,
    bloomShadowDebugMode: 0,
    shadowMapSize: 4096,
    shadowFarAuto: true,
    shadowFar: 60,
    ambientOcclusionEnabled: true,
    ambientOcclusionRadius: 0.4,
    ambientOcclusionBias: 0.02,
    ambientOcclusionIntensity: 1.2,
    ambientOcclusionBlurAmount: 1.5,
    ambientOcclusionSampleCount: 12,
    contactShadowEnabled: true,
    contactShadowLength: 0.08,
    contactShadowThickness: 0.01,
    contactShadowIntensity: 0.55,
    contactShadowBlurAmount: 1,
    contactShadowStepCount: 8,
  });
});

test('applyUiSettingsJsonData ignores model settings', async () => {
  let called = false;
  const result = await applyUiSettingsJsonData({
    type: 'model',
    shader: 'ignored',
  }, {
    uiSettingsPort: {
      applyRenderState: () => {
        called = true;
      },
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.skippedReason, 'unsupported-type');
  assert.equal(called, false);
});

test('parseUiSettingsJsonText rejects non-object payloads', () => {
  assert.throws(() => parseUiSettingsJsonText('[]'));
  assert.throws(() => parseUiSettingsJsonText('null'));
});
