import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadDefaults,
  resetDefaultsForTests,
} from '../source/infrastructure/config/defaults/defaults-manager.js';
import { readRenderUIInitialValues } from '../source/ui/renderer-ui.js';

function createFakeInput(value) {
  return {
    checked: false,
    value: String(value),
  };
}

function installFakeDocument(values) {
  const elements = new Map([
    ['shadow-bias', createFakeInput(values.shadowBias)],
    ['shadow-map-size', createFakeInput(values.shadowMapSize)],
    ['resolution-selector', createFakeInput(values.internalResolution)],
    ['aa-method', createFakeInput(values.aaMethod)],
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

test('render UI initial values use defaults.json instead of the HTML seed values', async () => {
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  const dom = installFakeDocument({
    shadowBias: '0.001',
    shadowMapSize: '4096',
    internalResolution: '1280x720',
    aaMethod: 'none',
  });
  const originalFetch = globalThis.fetch;

  try {
    resetDefaultsForTests();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(defaultsText),
    });
    await loadDefaults();

    const initialValues = readRenderUIInitialValues();
    assert.equal(initialValues.shadowBias, parsedDefaults.renderUi.shadowBias);
    assert.equal(initialValues.shadowMapSize, parsedDefaults.renderUi.shadowMapSize);
    assert.equal(initialValues.internalResolution, parsedDefaults.renderUi.internalResolution);
    assert.equal(initialValues.aaMethod, parsedDefaults.renderUi.aaMethod);
    assert.equal(initialValues.msaaSampleCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});
