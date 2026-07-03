import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadDefaults,
  resetDefaultsForTests,
} from '../source/infrastructure/config/defaults/defaults-manager.js';
import {
  readGridOverlayUIInitialValues,
  setupGridOverlayUI,
} from '../source/ui/renderer-ui.js';

function createFakeElement(initialValue = '0') {
  const listeners = new Map();
  return {
    checked: false,
    disabled: false,
    min: '',
    max: '',
    step: '',
    value: String(initialValue),
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatch(type) {
      for (const handler of listeners.get(type) || []) {
        handler({ target: this });
      }
    },
  };
}

function installFakeDocument(initialValues = {}) {
  const elements = new Map();
  const ids = [
    'showGridXZ',
    'showGridXY',
    'showGridYZ',
    'gridSizeRange',
    'gridSizeValue',
    'gridCountRange',
    'gridCountValue',
    'gridThicknessRange',
    'gridThicknessValue',
  ];
  for (const id of ids) {
    elements.set(id, createFakeElement(initialValues[id] ?? '0'));
  }

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    },
  };

  return {
    elements,
    restore() {
      globalThis.document = previousDocument;
    },
  };
}

test('grid overlay UI uses defaults.json instead of the HTML seed values', async () => {
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  const dom = installFakeDocument({
    showGridXZ: '0',
    gridSizeRange: '4.5',
    gridSizeValue: '4.5',
    gridCountRange: '12',
    gridCountValue: '12',
    gridThicknessRange: '2.25',
    gridThicknessValue: '2.25',
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

    const initialValues = readGridOverlayUIInitialValues();
    assert.deepEqual(initialValues, parsedDefaults.gridOverlay);

    let refreshCount = 0;

    setupGridOverlayUI({
      selection: {
        showGridXZElement: dom.elements.get('showGridXZ'),
        showGridXYElement: dom.elements.get('showGridXY'),
        showGridYZElement: dom.elements.get('showGridYZ'),
        gridSizeRangeElement: dom.elements.get('gridSizeRange'),
        gridSizeValueElement: dom.elements.get('gridSizeValue'),
        gridCountRangeElement: dom.elements.get('gridCountRange'),
        gridCountValueElement: dom.elements.get('gridCountValue'),
        gridThicknessRangeElement: dom.elements.get('gridThicknessRange'),
        gridThicknessValueElement: dom.elements.get('gridThicknessValue'),
      },
      state: initialValues,
      refreshScene() {
        refreshCount += 1;
      },
      onChanged() {},
    });

    assert.equal(initialValues.size, parsedDefaults.gridOverlay.size);
    assert.equal(initialValues.count, parsedDefaults.gridOverlay.count);
    assert.equal(initialValues.thickness, parsedDefaults.gridOverlay.thickness);
    assert.equal(dom.elements.get('gridSizeRange').value, String(parsedDefaults.gridOverlay.size));
    assert.equal(dom.elements.get('gridSizeValue').value, String(parsedDefaults.gridOverlay.size));
    assert.equal(dom.elements.get('gridCountRange').value, String(parsedDefaults.gridOverlay.count));
    assert.equal(dom.elements.get('gridCountValue').value, String(parsedDefaults.gridOverlay.count));
    assert.equal(dom.elements.get('gridThicknessRange').value, String(parsedDefaults.gridOverlay.thickness));
    assert.equal(dom.elements.get('gridThicknessValue').value, String(parsedDefaults.gridOverlay.thickness));

    const gridThicknessRange = dom.elements.get('gridThicknessRange');
    gridThicknessRange.value = '3.5';
    gridThicknessRange.dispatch('input');

    assert.equal(initialValues.thickness, 3.5);
    assert.equal(gridThicknessRange.value, '3.5');
    assert.equal(dom.elements.get('gridThicknessValue').value, '3.5');
    assert.ok(refreshCount >= 1);
  } finally {
    dom.restore();
  }
});
