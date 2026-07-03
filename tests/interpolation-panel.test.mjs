import assert from 'node:assert/strict';
import test from 'node:test';
import { InterpolationPanel } from '../source/ui/panels/interpolation-panel.js';

function createStubElement() {
  return {
    style: {},
    value: '0',
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
  };
}

function createCanvasContext() {
  return {
    clearRect() {},
    scale() {},
    stroke() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    arc() {},
    fill() {}
  };
}

function setupDom() {
  const elements = new Map();
  const container = createStubElement();
  const canvas = {
    ...createStubElement(),
    getContext() {
      return createCanvasContext();
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 128, height: 128 };
    },
    width: 0,
    height: 0
  };

  elements.set('interpolation-editor', container);
  elements.set('interpolation-canvas', canvas);
  elements.set('interpolation-target', createStubElement());
  elements.set('interpolation-linear', createStubElement());
  elements.set('interpolation-copy', createStubElement());
  elements.set('interpolation-paste', createStubElement());

  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {}
  };

  return elements;
}

test('InterpolationPanel serializes all channels when "all" is selected', () => {
  const elements = setupDom();
  const panel = new InterpolationPanel({ onChanged() {} });
  const targetSelector = elements.get('interpolation-target');

  targetSelector.value = '4';
  targetSelector.listeners.get('change')({ target: targetSelector });
  panel.setValues(12, 34, 56, 78);

  const serialized = panel.getInterpolationArray();
  assert.deepEqual(Array.from(serialized.slice(0, 16)), [
    12, 12, 12, 12,
    34, 34, 34, 34,
    56, 56, 56, 56,
    78, 78, 78, 78
  ]);
});

test('InterpolationPanel switches to "all" when loaded interpolation is uniform', () => {
  setupDom();
  const panel = new InterpolationPanel({ onChanged() {} });
  const interp = new Uint8Array(64);
  for (let i = 0; i < 4; i++) {
    interp[i] = 20;
    interp[4 + i] = 20;
    interp[8 + i] = 107;
    interp[12 + i] = 107;
  }

  panel.setFromInterpolationArray(interp);

  assert.equal(panel.currentParamIndex, 4);
  assert.equal(panel.targetSelector.value, '4');
});
