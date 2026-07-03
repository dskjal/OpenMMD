import assert from 'node:assert/strict';
import test from 'node:test';

import { setupPostEffectUI } from '../source/ui/renderer-ui.js';

function createFakeElement() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    attributes,
    checked: false,
    disabled: false,
    max: '',
    value: '0',
    focused: false,
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatch(type, eventInit = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({
          key: '',
          preventDefault() {},
          stopPropagation() {},
          target: this,
          ...eventInit,
        });
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    matches(selector) {
      return selector === ':focus' ? this.focused : false;
    },
  };
}

function installFakeDocument() {
  const ids = [
    'bloom-enabled',
    'dof-enabled',
    'color-temperature',
    'color-temperature-pick',
    'bloom-threshold',
    'gamma',
    'chromatic-aberration',
    'film-grain-amount',
    'film-grain-animation-mode-always',
    'film-grain-animation-mode-timeline',
    'bloom-blur-amount',
    'bloom-alpha',
    'bloom-shadow-multiplier',
    'ambient-occlusion-enabled',
    'ambient-occlusion-radius',
    'ambient-occlusion-bias',
    'ambient-occlusion-intensity',
    'ambient-occlusion-blur-amount',
    'ambient-occlusion-sample-count',
    'contact-shadow-enabled',
    'contact-shadow-length',
    'contact-shadow-thickness',
    'contact-shadow-intensity',
    'contact-shadow-blur-amount',
    'contact-shadow-step-count',
    'dof-algorithm',
    'dof-f-stop',
    'sss-enabled',
    'sss-radius',
    'sss-depth-threshold',
    'sss-normal-threshold',
    'sss-strength',
  ];
  const elements = new Map(ids.map((id) => [id, createFakeElement()]));
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

test('post effect UI keeps bloom alpha editable and commits on blur', () => {
  const dom = installFakeDocument();
  try {
    const state = {
      environmentHdrIntensityMax: 4.25,
      postEffects: {
        bloomEnabled: false,
        dofEnabled: false,
        colorTemperature: 6500,
        gamma: 1.0,
        chromaticAberration: 0.0,
        filmGrainAmount: 0.0,
        filmGrainAnimationMode: 'timeline',
        bloomThreshold: 8.0,
        bloomBlurAmount: 2.0,
        bloomAlpha: 1.0,
        bloomShadowMultiplier: 0.0,
        gltfLightStrength: 1.0,
        ambientOcclusionEnabled: false,
        ambientOcclusionRadius: 0.4,
        ambientOcclusionBias: 0.02,
        ambientOcclusionIntensity: 1.0,
        ambientOcclusionBlurAmount: 1.0,
        ambientOcclusionSampleCount: 12,
        contactShadowEnabled: false,
        contactShadowLength: 0.08,
        contactShadowThickness: 0.01,
        contactShadowIntensity: 0.55,
        contactShadowBlurAmount: 1.0,
        contactShadowStepCount: 8,
        dofBlurAmount: 2.0,
        dofAlgorithm: 'fast',
        dofFStop: 2.8,
        dofFocusPoint: [0.0, 0.0, 0.0],
        sssEnabled: false,
        sssRadius: 1.5,
        sssDepthThreshold: 0.01,
        sssNormalThreshold: 0.2,
        sssStrength: 0.2,
      },
    };
    let changedCount = 0;

    setupPostEffectUI({
      state,
      onChanged() {
        changedCount += 1;
      },
    });

    const bloomThresholdRange = dom.elements.get('bloom-threshold');
    const bloomAlphaRange = dom.elements.get('bloom-alpha');
    const bloomShadowMultiplierRange = dom.elements.get('bloom-shadow-multiplier');

    assert.equal(state.postEffects.bloomThreshold, 4.25);
    assert.equal(bloomThresholdRange.max, '4.25');
    assert.equal(bloomThresholdRange.value, '4.25');

    bloomAlphaRange.focused = true;
    bloomAlphaRange.value = '1.5';
    bloomAlphaRange.dispatch('input');

    assert.equal(state.postEffects.bloomAlpha, 1);
    assert.equal(bloomAlphaRange.value, '1');
    assert.equal(state.postEffects.gltfLightStrength, 1);
    assert.ok(changedCount >= 1);

    bloomAlphaRange.dispatch('blur');

    assert.equal(bloomAlphaRange.value, '1');
    assert.ok(changedCount >= 2);

    bloomShadowMultiplierRange.value = '0.6';
    bloomShadowMultiplierRange.dispatch('input');

    assert.equal(state.postEffects.bloomShadowMultiplier, 0.6);
    assert.equal(bloomShadowMultiplierRange.value, '0.6');
    assert.ok(changedCount >= 3);

    const ambientOcclusionIntensityRange = dom.elements.get('ambient-occlusion-intensity');
    ambientOcclusionIntensityRange.value = '8';
    ambientOcclusionIntensityRange.dispatch('input');

    assert.equal(state.postEffects.ambientOcclusionIntensity, 8);
    assert.equal(ambientOcclusionIntensityRange.value, '8');
    assert.ok(changedCount >= 4);
  } finally {
    dom.restore();
  }
});

test('post effect UI wires the viewport color temperature pick button', () => {
  const dom = installFakeDocument();
  try {
    const state = {
      environmentHdrIntensityMax: 4.25,
      postEffects: {
        bloomEnabled: false,
        dofEnabled: false,
        colorTemperature: 6500,
        gamma: 1.0,
        chromaticAberration: 0.0,
        filmGrainAmount: 0.0,
        filmGrainAnimationMode: 'timeline',
        bloomThreshold: 0.98,
        bloomBlurAmount: 2.0,
        bloomAlpha: 1.0,
        bloomShadowMultiplier: 0.0,
        gltfLightStrength: 1.0,
        ambientOcclusionEnabled: false,
        ambientOcclusionRadius: 0.4,
        ambientOcclusionBias: 0.02,
        ambientOcclusionIntensity: 1.0,
        ambientOcclusionBlurAmount: 1.0,
        ambientOcclusionSampleCount: 12,
        contactShadowEnabled: false,
        contactShadowLength: 0.08,
        contactShadowThickness: 0.01,
        contactShadowIntensity: 0.55,
        contactShadowBlurAmount: 1.0,
        contactShadowStepCount: 8,
        dofBlurAmount: 2.0,
        dofAlgorithm: 'fast',
        dofFStop: 2.8,
        dofFocusPoint: [0.0, 0.0, 0.0],
        sssEnabled: false,
        sssRadius: 1.5,
        sssDepthThreshold: 0.01,
        sssNormalThreshold: 0.2,
        sssStrength: 0.2,
      },
    };
    let pickToggleCount = 0;

    setupPostEffectUI({
      state,
      onChanged() {},
      onColorTemperaturePickToggle() {
        pickToggleCount += 1;
      },
    });

    dom.elements.get('color-temperature-pick').dispatch('click');

    assert.equal(pickToggleCount, 1);
  } finally {
    dom.restore();
  }
});

test('post effect UI exposes a force-sync handle for color temperature', () => {
  const dom = installFakeDocument();
  try {
    const state = {
      environmentHdrIntensityMax: 4.25,
      postEffects: {
        bloomEnabled: false,
        dofEnabled: false,
        colorTemperature: 6500,
        gamma: 1.0,
        chromaticAberration: 0.0,
        filmGrainAmount: 0.0,
        filmGrainAnimationMode: 'timeline',
        bloomThreshold: 0.98,
        bloomBlurAmount: 2.0,
        bloomAlpha: 1.0,
        bloomShadowMultiplier: 0.0,
        gltfLightStrength: 1.0,
        ambientOcclusionEnabled: false,
        ambientOcclusionRadius: 0.4,
        ambientOcclusionBias: 0.02,
        ambientOcclusionIntensity: 1.0,
        ambientOcclusionBlurAmount: 1.0,
        ambientOcclusionSampleCount: 12,
        contactShadowEnabled: false,
        contactShadowLength: 0.08,
        contactShadowThickness: 0.01,
        contactShadowIntensity: 0.55,
        contactShadowBlurAmount: 1.0,
        contactShadowStepCount: 8,
        dofBlurAmount: 2.0,
        dofAlgorithm: 'fast',
        dofFStop: 2.8,
        dofFocusPoint: [0.0, 0.0, 0.0],
        sssEnabled: false,
        sssRadius: 1.5,
        sssDepthThreshold: 0.01,
        sssNormalThreshold: 0.2,
        sssStrength: 0.2,
      },
    };

    const ui = setupPostEffectUI({
      state,
      onChanged() {},
    });

    const rangeInput = dom.elements.get('color-temperature');

    assert.equal(typeof ui.syncColorTemperatureInput, 'function');

    rangeInput.focused = true;
    rangeInput.value = '6800';

    ui.syncColorTemperatureInput(7200);
    assert.equal(rangeInput.value, '6800');

    ui.syncColorTemperatureInput(7200, true);
    assert.equal(rangeInput.value, '7200');
  } finally {
    dom.restore();
  }
});

test('post effect UI defers color temperature sanitize until commit', () => {
  const dom = installFakeDocument();
  try {
    const state = {
      environmentHdrIntensityMax: 4.25,
      postEffects: {
        bloomEnabled: false,
        dofEnabled: false,
        colorTemperature: 6500,
        gamma: 1.0,
        chromaticAberration: 0.0,
        filmGrainAmount: 0.0,
        filmGrainAnimationMode: 'timeline',
        bloomThreshold: 0.98,
        bloomBlurAmount: 2.0,
        bloomAlpha: 1.0,
        bloomShadowMultiplier: 0.0,
        gltfLightStrength: 1.0,
        ambientOcclusionEnabled: false,
        ambientOcclusionRadius: 0.4,
        ambientOcclusionBias: 0.02,
        ambientOcclusionIntensity: 1.0,
        ambientOcclusionBlurAmount: 1.0,
        ambientOcclusionSampleCount: 12,
        contactShadowEnabled: false,
        contactShadowLength: 0.08,
        contactShadowThickness: 0.01,
        contactShadowIntensity: 0.55,
        contactShadowBlurAmount: 1.0,
        contactShadowStepCount: 8,
        dofBlurAmount: 2.0,
        dofAlgorithm: 'fast',
        dofFStop: 2.8,
        dofFocusPoint: [0.0, 0.0, 0.0],
        sssEnabled: false,
        sssRadius: 1.5,
        sssDepthThreshold: 0.01,
        sssNormalThreshold: 0.2,
        sssStrength: 0.2,
      },
    };
    let changedCount = 0;

    setupPostEffectUI({
      state,
      onChanged() {
        changedCount += 1;
      },
    });

    const colorTemperatureRange = dom.elements.get('color-temperature');

    assert.equal(colorTemperatureRange.hasAttribute('defer-number-input-sync'), true);

    colorTemperatureRange.focused = true;
    colorTemperatureRange.value = '50000';
    colorTemperatureRange.dispatch('input');

    assert.equal(state.postEffects.colorTemperature, 50000);
    assert.equal(colorTemperatureRange.value, '50000');
    assert.ok(changedCount >= 1);

    colorTemperatureRange.focused = false;
    colorTemperatureRange.dispatch('change');

    assert.equal(state.postEffects.colorTemperature, 40000);
    assert.equal(colorTemperatureRange.value, '40000');

    colorTemperatureRange.value = '500';
    colorTemperatureRange.dispatch('input');

    assert.equal(state.postEffects.colorTemperature, 500);
    assert.equal(colorTemperatureRange.value, '500');

    colorTemperatureRange.dispatch('change');

    assert.equal(state.postEffects.colorTemperature, 1000);
    assert.equal(colorTemperatureRange.value, '1000');
  } finally {
    dom.restore();
  }
});
