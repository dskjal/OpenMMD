import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampEnvironmentHdrIntensity,
  getEnvironmentHdrIntensityMax,
  syncEnvironmentHdrIntensityInputBounds,
} from '../source/shared/render/environment-hdr-utils.js';

test('environment HDR intensity max follows appState.dynamicRange', () => {
  assert.equal(getEnvironmentHdrIntensityMax({ dynamicRange: 6.5 }), 6.5);
  assert.equal(getEnvironmentHdrIntensityMax({ dynamicRange: 0 }), 0);
  assert.equal(getEnvironmentHdrIntensityMax({ dynamicRange: Number.NaN }), 10.0);
});

test('environment HDR intensity clamps against appState.dynamicRange', () => {
  const appState = { dynamicRange: 4.25 };

  assert.equal(clampEnvironmentHdrIntensity(2.5, appState), 2.5);
  assert.equal(clampEnvironmentHdrIntensity(9.0, appState), 4.25);
  assert.equal(clampEnvironmentHdrIntensity(-1.0, appState), 0);
  assert.equal(clampEnvironmentHdrIntensity('not-a-number', appState), 1.0);
});

test('environment HDR intensity bounds synchronize to inputs', () => {
  const rangeInput = createFakeInput();
  const valueInput = createFakeInput();

  syncEnvironmentHdrIntensityInputBounds(rangeInput, valueInput, 7.75);

  assert.equal(rangeInput.max, '7.75');
  assert.equal(valueInput.max, '7.75');
});

/**
 * Creates a fake input object for DOM-less tests.
 * @returns {object} Fake input.
 */
function createFakeInput() {
  return {
    max: '',
  };
}
