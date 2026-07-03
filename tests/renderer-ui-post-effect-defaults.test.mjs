import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadDefaults,
  resetDefaultsForTests,
} from '../source/infrastructure/config/defaults/defaults-manager.js';
import { readPostEffectUIInitialValues } from '../source/ui/renderer-ui.js';

function createFakeInput(value, checked = false) {
  return {
    checked,
    value: String(value),
  };
}

function installFakeDocument() {
  const elements = new Map([
    ['bloom-enabled', createFakeInput('', true)],
    ['dof-enabled', createFakeInput('', true)],
    ['color-temperature', createFakeInput('9000')],
    ['gamma', createFakeInput('2.4')],
    ['chromatic-aberration', createFakeInput('0.5')],
    ['film-grain-amount', createFakeInput('0.9')],
    ['film-grain-animation-mode-always', createFakeInput('', true)],
    ['bloom-threshold', createFakeInput('0.1')],
    ['bloom-blur-amount', createFakeInput('7.5')],
    ['bloom-alpha', createFakeInput('0.2')],
    ['bloom-shadow-multiplier', createFakeInput('0.8')],
    ['light-color-strength-range', createFakeInput('10.0')],
    ['ambient-occlusion-blur-amount', createFakeInput('3.0')],
    ['contact-shadow-blur-amount', createFakeInput('2.5')],
    ['dof-algorithm', createFakeInput('thin-lens-multisample')],
    ['dof-f-stop', createFakeInput('8.0')],
    ['sss-enabled', createFakeInput('', true)],
    ['sss-radius', createFakeInput('4.0')],
    ['sss-depth-threshold', createFakeInput('0.05')],
    ['sss-normal-threshold', createFakeInput('0.8')],
    ['sss-strength', createFakeInput('0.9')],
  ]);
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  return {
    restore() {
      globalThis.document = previousDocument;
    },
  };
}

test('post effect UI initial values use defaults.json instead of the HTML seed values', async () => {
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  const dom = installFakeDocument();
  const originalFetch = globalThis.fetch;

  try {
    resetDefaultsForTests();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(defaultsText),
    });
    await loadDefaults();

    const initialValues = readPostEffectUIInitialValues();
    assert.equal(initialValues.bloomEnabled, parsedDefaults.postEffectUi.bloomEnabled);
    assert.equal(initialValues.dofEnabled, parsedDefaults.postEffectUi.dofEnabled);
    assert.equal(initialValues.colorTemperature, parsedDefaults.postEffectUi.colorTemperature);
    assert.equal(initialValues.filmGrainAnimationMode, parsedDefaults.postEffectUi.filmGrainAnimationMode);
    assert.equal(initialValues.dofAlgorithm, parsedDefaults.postEffectUi.dofAlgorithm);
    assert.equal(initialValues.sssEnabled, parsedDefaults.postEffectUi.sssEnabled);
    assert.deepEqual(initialValues.dofFocusPoint, parsedDefaults.postEffectUi.dofFocusPoint);
  } finally {
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});
