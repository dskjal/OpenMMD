import assert from 'node:assert/strict';
import test from 'node:test';

import { bindLinkedNumericInputs, syncNumericInputValue } from '../source/shared/ui/numeric-input-utils.js';

/**
 * Creates a fake input element for numeric-input tests.
 * @returns {object} Fake input.
 */
function createFakeInput() {
  const listeners = new Map();
  return {
    value: '',
    focused: false,
    focusWithin: false,
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
    matches(selector) {
      if (selector === ':focus') {
        return this.focused;
      }
      if (selector === ':focus-within') {
        return this.focusWithin;
      }
      return false;
    },
  };
}

test('bindLinkedNumericInputs keeps intermediate text while editing and commits on blur', () => {
  const rangeInput = createFakeInput();
  const valueInput = createFakeInput();
  let state = 0;
  let changeCount = 0;

  bindLinkedNumericInputs({
    rangeInput,
    valueInput,
    fallbackValue: 0,
    getValue: () => state,
    setValue: (nextValue) => {
      state = Math.min(1, Math.max(0, nextValue));
      changeCount += 1;
    },
    sanitize: (value) => Math.min(1, Math.max(0, value)),
    format: (value) => String(value),
  });

  valueInput.focused = true;
  valueInput.value = '0.';
  valueInput.dispatch('input');

  assert.equal(state, 0);
  assert.equal(valueInput.value, '0.');
  assert.equal(rangeInput.value, '0');
  assert.equal(changeCount, 1);

  valueInput.focused = false;
  valueInput.dispatch('blur');

  assert.equal(valueInput.value, '0');
  assert.equal(rangeInput.value, '0');
  assert.equal(changeCount, 2);
});

test('bindLinkedNumericInputs clamps out-of-range text on blur', () => {
  const rangeInput = createFakeInput();
  const valueInput = createFakeInput();
  let state = 0;

  bindLinkedNumericInputs({
    rangeInput,
    valueInput,
    fallbackValue: 0,
    getValue: () => state,
    setValue: (nextValue) => {
      state = Math.min(1, Math.max(0, nextValue));
    },
    sanitize: (value) => Math.min(1, Math.max(0, value)),
    format: (value) => String(value),
  });

  valueInput.focused = true;
  valueInput.value = '1.5';
  valueInput.dispatch('input');

  assert.equal(state, 1);
  assert.equal(valueInput.value, '1.5');
  assert.equal(rangeInput.value, '1');

  valueInput.focused = false;
  valueInput.dispatch('blur');

  assert.equal(valueInput.value, '1');
  assert.equal(rangeInput.value, '1');
});

test('bindLinkedNumericInputs keeps sibling focus transitions from overwriting the clicked input', () => {
  const rangeInput = createFakeInput();
  const valueInput = createFakeInput();
  let state = 1;

  bindLinkedNumericInputs({
    rangeInput,
    valueInput,
    fallbackValue: 1,
    getValue: () => state,
    setValue: (nextValue) => {
      state = nextValue;
    },
    sanitize: (value) => Math.min(10, Math.max(0, value)),
    format: (value) => String(value),
  });

  valueInput.focused = true;
  valueInput.value = '2';
  valueInput.dispatch('input');

  assert.equal(state, 2);
  assert.equal(valueInput.value, '2');

  rangeInput.focused = true;
  rangeInput.value = '0.5';
  valueInput.focused = false;

  valueInput.dispatch('blur', { relatedTarget: rangeInput });
  valueInput.dispatch('change', { relatedTarget: rangeInput });

  assert.equal(state, 2);
  assert.equal(valueInput.value, '2');
  assert.equal(rangeInput.value, '0.5');
});

test('bindLinkedNumericInputs can defer sanitize until commit', () => {
  const rangeInput = createFakeInput();
  const valueInput = createFakeInput();
  let state = 6500;

  bindLinkedNumericInputs({
    rangeInput,
    valueInput,
    fallbackValue: 6500,
    getValue: () => state,
    setValue: (nextValue) => {
      state = nextValue;
    },
    sanitize: (value) => Math.min(40000, Math.max(1000, value)),
    sanitizeOnInput: false,
    inputSync: {
      forceValue: false,
      forceRange: false,
    },
    format: (value) => String(value),
  });

  valueInput.focused = true;
  valueInput.value = '50000';
  valueInput.dispatch('input');

  assert.equal(state, 50000);
  assert.equal(valueInput.value, '50000');
  assert.equal(rangeInput.value, '50000');

  valueInput.dispatch('keydown', { key: 'Enter' });

  assert.equal(state, 40000);
  assert.equal(valueInput.value, '40000');
  assert.equal(rangeInput.value, '40000');
});

test('syncNumericInputValue skips focused inputs unless forced', () => {
  const input = createFakeInput();
  input.focused = true;
  input.value = '1.5';

  syncNumericInputValue(input, 2, {
    format: (value) => String(value),
  });
  assert.equal(input.value, '1.5');

  syncNumericInputValue(input, 2, {
    format: (value) => String(value),
    force: true,
  });
  assert.equal(input.value, '2');
});

test('syncNumericInputValue skips focus-within numeric controls unless forced', () => {
  const input = createFakeInput();
  input.focusWithin = true;
  input.value = '1.5';

  syncNumericInputValue(input, 2, {
    format: (value) => String(value),
  });
  assert.equal(input.value, '1.5');

  syncNumericInputValue(input, 2, {
    format: (value) => String(value),
    force: true,
  });
  assert.equal(input.value, '2');
});
