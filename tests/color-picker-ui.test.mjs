import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { setupColorPickerUI } from '../source/ui/panels/color-picker-ui.js';

function createFakeClassList() {
  return {
    _values: new Set(),
    add(value) {
      this._values.add(value);
    },
    remove(value) {
      this._values.delete(value);
    },
    toggle(value, force) {
      if (force === undefined) {
        if (this._values.has(value)) {
          this._values.delete(value);
          return false;
        }
        this._values.add(value);
        return true;
      }
      if (force) {
        this._values.add(value);
      } else {
        this._values.delete(value);
      }
      return Boolean(force);
    },
    contains(value) {
      return this._values.has(value);
    },
  };
}

function createFakeGroup() {
  return {
    hidden: false,
    toggleAttribute(name, force) {
      if (name === 'hidden') {
        this.hidden = !force;
      }
    },
  };
}

function createFakeElement(tagName = 'div') {
  const listeners = new Map();
  const group = createFakeGroup();
  return {
    tagName,
    hidden: false,
    disabled: false,
    value: '',
    title: '',
    style: {},
    attributes: {},
    listeners,
    classList: createFakeClassList(),
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatch(type, event = {}) {
      if (type === 'blur' && globalThis.document?.activeElement === this) {
        globalThis.document.activeElement = null;
      }
      if (type === 'focus' && globalThis.document) {
        globalThis.document.activeElement = this;
      }
      for (const handler of listeners.get(type) || []) {
        handler({ target: this, ...event });
      }
    },
    closest() {
      return group;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      if (globalThis.document) {
        globalThis.document.activeElement = this;
      }
      this.focused = true;
    },
    blur() {
      if (globalThis.document?.activeElement === this) {
        globalThis.document.activeElement = null;
      }
      this.focused = false;
    },
    matches(selector) {
      if (selector === ':focus') {
        return globalThis.document?.activeElement === this;
      }
      return false;
    },
    getBoundingClientRect() {
      return this.rect || { left: 0, top: 0, width: 220, height: 220, right: 220, bottom: 220 };
    },
    setPointerCapture() {},
    hasPointerCapture() {
      return false;
    },
    releasePointerCapture() {},
    getContext() {
      return {
        createImageData(width, height) {
          return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData() {},
        save() {},
        restore() {},
        beginPath() {},
        arc() {},
        stroke() {},
        fill() {},
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
      };
    },
  };
}

function installFakeDom(options = {}) {
  const {
    triggerRect = { left: 100, top: 400, width: 24, height: 24, right: 124, bottom: 424 },
    dialogRect = { left: 0, top: 0, width: 600, height: 420, right: 600, bottom: 420 },
    viewportWidth = 1280,
    viewportHeight = 720,
  } = options;
  const ids = [
    'color-picker-overlay',
    'color-picker-dialog',
    'color-picker-body',
    'color-picker-preview',
    'color-picker-wheel',
    'color-picker-value-slider',
    'color-picker-linear',
    'color-picker-perceptual',
    'color-picker-rgb',
    'color-picker-hsv',
    'color-picker-temperature',
    'color-picker-rgb-red',
    'color-picker-rgb-green',
    'color-picker-rgb-blue',
    'color-picker-hue',
    'color-picker-saturation',
    'color-picker-value',
    'color-picker-temperature-row',
    'color-picker-temperature-range',
    'color-picker-temperature-value',
    'color-picker-alpha',
    'color-picker-hex',
    'color-picker-eyedropper',
    'light-color-swatch',
    'light-color-strength-range',
    'material-diffuse-swatch',
    'material-emissive-swatch',
  ];
  const elements = new Map(ids.map((id) => [id, createFakeElement()]));
  elements.get('light-color-swatch').rect = triggerRect;
  elements.get('material-diffuse-swatch').rect = triggerRect;
  elements.get('material-emissive-swatch').rect = triggerRect;
  elements.get('color-picker-dialog').rect = dialogRect;
  elements.get('color-picker-temperature-range').min = '1000';
  elements.get('color-picker-temperature-range').max = '40000';
  elements.get('color-picker-temperature-value').min = '1000';
  elements.get('color-picker-temperature-value').max = '40000';

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    activeElement: null,
    documentElement: {
      clientWidth: viewportWidth,
      clientHeight: viewportHeight,
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    },
  };
  globalThis.window = {
    listeners: new Map(),
    innerWidth: viewportWidth,
    innerHeight: viewportHeight,
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    },
  };

  return {
    elements,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

test('shared color picker keeps emissive edits isolated from light color', () => {
  const dom = installFakeDom();
  try {
    const lightState = { lightColor: [1, 1, 1, 1] };
    const emissiveState = { emissiveColor: [0.25, 0.5, 0.75, 1] };

    setupColorPickerUI({
      state: lightState,
      propertyName: 'lightColor',
      applyValue(nextValue) {
        lightState.lightColor = nextValue;
      },
      title: 'Light Color',
    });
    setupColorPickerUI({
      state: emissiveState,
      propertyName: 'emissiveColor',
      allowAlpha: false,
      triggerButtonId: 'material-emissive-swatch',
      applyValue(nextValue) {
        emissiveState.emissiveColor = nextValue;
      },
      title: 'Emissive',
    });

    dom.elements.get('material-emissive-swatch').dispatch('click');
    dom.elements.get('color-picker-rgb-red').value = '0';
    dom.elements.get('color-picker-rgb-red').dispatch('input');

    assert.equal(emissiveState.emissiveColor[0] >= 0 && emissiveState.emissiveColor[0] < 0.01, true);
    assert.deepEqual(lightState.lightColor, [1, 1, 1, 1]);
  } finally {
    dom.restore();
  }
});

test('light color strength accepts values above one', () => {
  const dom = installFakeDom();
  try {
    const lightState = { lightColor: [1, 1, 1, 1] };

    setupColorPickerUI({
      state: lightState,
      propertyName: 'lightColor',
      strengthMin: 0.0,
      strengthMax: 10.0,
      applyValue(nextValue) {
        lightState.lightColor = nextValue;
      },
      title: 'Light Color',
    });

    dom.elements.get('light-color-swatch').dispatch('click');
    dom.elements.get('light-color-strength-range').value = '2.5';
    dom.elements.get('light-color-strength-range').dispatch('input');
    dom.elements.get('light-color-strength-range').value = '12';
    dom.elements.get('light-color-strength-range').dispatch('input');

    assert.equal(lightState.lightColor[3], 10);
    assert.equal(dom.elements.get('light-color-strength-range').value, '10.000');
  } finally {
    dom.restore();
  }
});

test('light color picker can avoid writing to external strength inputs', () => {
  const dom = installFakeDom();
  try {
    const lightState = { lightColor: [1, 1, 1, 1] };
    dom.elements.get('light-color-strength-range').value = '2.000';

    const picker = setupColorPickerUI({
      state: lightState,
      propertyName: 'lightColor',
      strengthRangeInputId: null,
      strengthValueInputId: null,
      strengthMin: 0.0,
      strengthMax: 10.0,
      applyValue(nextValue) {
        lightState.lightColor = nextValue;
      },
      title: 'Light Color',
    });

    lightState.lightColor = [0.5, 0.5, 0.5, 5.0];
    picker.refresh();

    assert.equal(dom.elements.get('light-color-strength-range').value, '2.000');
  } finally {
    dom.restore();
  }
});

test('shared color picker can edit diffuse without affecting emissive', () => {
  const dom = installFakeDom();
  try {
    const diffuseState = { diffuseColor: [0.4, 0.5, 0.6, 1] };
    const emissiveState = { emissiveColor: [0.1, 0.2, 0.3, 1] };

    const diffusePicker = setupColorPickerUI({
      state: diffuseState,
      propertyName: 'diffuseColor',
      allowAlpha: false,
      triggerButtonId: 'material-diffuse-swatch',
      applyValue(nextValue) {
        diffuseState.diffuseColor = nextValue;
      },
      title: 'Diffuse',
    });
    const emissivePicker = setupColorPickerUI({
      state: emissiveState,
      propertyName: 'emissiveColor',
      allowAlpha: false,
      triggerButtonId: 'material-emissive-swatch',
      applyValue(nextValue) {
        emissiveState.emissiveColor = nextValue;
      },
      title: 'Emissive',
    });

    diffuseState.diffuseColor = [0.0, 1.0, 0.0, 1.0];
    diffusePicker.refresh();

    assert.equal(dom.elements.get('material-diffuse-swatch').title.startsWith('Diffuse:'), true);
    assert.deepEqual(emissiveState.emissiveColor, [0.1, 0.2, 0.3, 1]);
  } finally {
    dom.restore();
  }
});

test('color picker sanitizes rgb, hsv, and hex inputs on blur', () => {
  const dom = installFakeDom();
  try {
    const state = { lightColor: [0.2, 0.4, 0.6, 1] };

    setupColorPickerUI({
      state,
      propertyName: 'lightColor',
      applyValue(nextValue) {
        state.lightColor = nextValue;
      },
      title: 'Light Color',
    });

    dom.elements.get('light-color-swatch').dispatch('click');

    const redInput = dom.elements.get('color-picker-rgb-red');
    redInput.value = '300';
    redInput.dispatch('input');
    assert.equal(redInput.value, '300');
    redInput.dispatch('blur');
    assert.equal(redInput.value, '255');

    const saturationInput = dom.elements.get('color-picker-saturation');
    saturationInput.value = '150';
    saturationInput.dispatch('input');
    assert.equal(saturationInput.value, '150');
    saturationInput.dispatch('blur');
    assert.equal(saturationInput.value, '100');

    const hexInput = dom.elements.get('color-picker-hex');
    hexInput.value = '#abc';
    hexInput.dispatch('input');
    assert.equal(hexInput.value, '#abc');
    hexInput.dispatch('blur');
    assert.equal(hexInput.value, '#AABBCCFF');

    hexInput.value = '#12';
    hexInput.dispatch('input');
    assert.equal(hexInput.value, '#12');
    hexInput.dispatch('blur');
    assert.equal(hexInput.value, '#AABBCCFF');
  } finally {
    dom.restore();
  }
});

test('color picker temperature mode updates the picked color and clamps the kelvin range', () => {
  const dom = installFakeDom();
  try {
    const state = { lightColor: [1, 1, 1, 1] };

    setupColorPickerUI({
      state,
      propertyName: 'lightColor',
      applyValue(nextValue) {
        state.lightColor = nextValue;
      },
      title: 'Light Color',
    });

    dom.elements.get('light-color-swatch').dispatch('click');
    dom.elements.get('color-picker-temperature').dispatch('click');

    const temperatureRange = dom.elements.get('color-picker-temperature-range');
    const temperatureValue = dom.elements.get('color-picker-temperature-value');
    const wheel = dom.elements.get('color-picker-wheel');
    const body = dom.elements.get('color-picker-body');

    assert.equal(body.classList.contains('is-temperature-mode'), true);
    assert.equal(wheel.hidden, true);
    assert.equal(temperatureRange.min, '1000');
    assert.equal(temperatureRange.max, '40000');
    assert.equal(temperatureValue.min, '1000');
    assert.equal(temperatureValue.max, '40000');

    temperatureRange.value = '40000';
    temperatureRange.dispatch('input');
    temperatureRange.dispatch('blur');

    assert.equal(temperatureRange.value, '40000');
    assert.equal(temperatureValue.value, '1000');
    assert.equal(state.lightColor[0] > state.lightColor[2], true);

    temperatureValue.focus();
    temperatureRange.dispatch('blur');

    assert.equal(temperatureRange.value, '40000');
    assert.equal(temperatureValue.value, '1000');

    temperatureValue.value = '3000';
    temperatureValue.dispatch('input');

    assert.equal(temperatureValue.value, '3000');
    assert.equal(temperatureRange.value, '38000');
    assert.equal(state.lightColor[0] > state.lightColor[2], true);

    temperatureValue.dispatch('blur');

    assert.equal(temperatureRange.value, '38000');
    assert.equal(temperatureValue.value, '3000');

    temperatureRange.value = '1000';
    temperatureRange.dispatch('input');
    temperatureRange.dispatch('blur');

    assert.equal(state.lightColor[3], 1);
    assert.equal(temperatureRange.value, '1000');
    assert.equal(temperatureValue.value, '40000');
  } finally {
    dom.restore();
  }
});

test('color picker opens above the clicked swatch without backdrop blur', () => {
  const dom = installFakeDom({
    triggerRect: { left: 180, top: 460, width: 24, height: 24, right: 204, bottom: 484 },
    dialogRect: { left: 0, top: 0, width: 600, height: 320, right: 600, bottom: 320 },
    viewportWidth: 1280,
    viewportHeight: 900,
  });
  try {
    setupColorPickerUI({
      state: { lightColor: [1, 1, 1, 1] },
      propertyName: 'lightColor',
      applyValue() {},
      title: 'Light Color',
    });

    dom.elements.get('light-color-swatch').dispatch('click');

    const dialog = dom.elements.get('color-picker-dialog');
    assert.equal(dom.elements.get('color-picker-overlay').hidden, false);
    assert.equal(dialog.style.position, 'fixed');
    assert.equal(dialog.style.left, '180px');
    assert.equal(dialog.style.top, '132px');
    assert.equal(dialog.style.transform, 'none');
  } finally {
    dom.restore();
  }
});

test('color picker flips below when there is not enough room above', () => {
  const dom = installFakeDom({
    triggerRect: { left: 40, top: 18, width: 24, height: 24, right: 64, bottom: 42 },
    dialogRect: { left: 0, top: 0, width: 600, height: 320, right: 600, bottom: 320 },
    viewportWidth: 800,
    viewportHeight: 600,
  });
  try {
    setupColorPickerUI({
      state: { lightColor: [1, 1, 1, 1] },
      propertyName: 'lightColor',
      applyValue() {},
      title: 'Light Color',
    });

    dom.elements.get('light-color-swatch').dispatch('click');

    const dialog = dom.elements.get('color-picker-dialog');
    assert.equal(dialog.style.top, '50px');
    assert.equal(dialog.style.left, '40px');
  } finally {
    dom.restore();
  }
});

test('color picker overlay style does not blur the viewport background', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const overlayMatch = html.match(/\.color-picker-overlay\s*\{[\s\S]*?\}/);
  assert.ok(overlayMatch);
  assert.equal(overlayMatch[0].includes('backdrop-filter'), false);
  assert.equal(overlayMatch[0].includes('background: transparent;'), true);
});
