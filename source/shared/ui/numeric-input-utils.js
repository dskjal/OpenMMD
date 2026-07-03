/**
 * Returns whether an input element is currently being edited.
 * @param {HTMLInputElement|null} input - Input element.
 * @returns {boolean} True when focused.
 */
export function isNumericInputFocused(input) {
  if (!input) {
    return false;
  }
  if (typeof input.matches === 'function') {
    try {
      if (input.matches(':focus') || input.matches(':focus-within')) {
        return true;
      }
    } catch {
      // Ignore selector support gaps in tests.
    }
  }
  return typeof document !== 'undefined' && document.activeElement === input;
}

/**
 * Reads a numeric input value and falls back when parsing fails.
 * @param {HTMLInputElement|null} input - Input element.
 * @param {number} fallback - Fallback value.
 * @param {(value: string) => number} [parse=Number.parseFloat] - Parser.
 * @returns {number} Parsed value.
 */
export function readNumericInputValue(input, fallback, parse = Number.parseFloat) {
  if (!input || !('value' in input)) {
    return fallback;
  }
  const parsed = parse(String(input.value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Writes a numeric value to an input unless the user is editing it.
 * @param {HTMLInputElement|null} input - Input element.
 * @param {number} value - Value to write.
 * @param {object} [options={}] - Formatting options.
 * @param {(value: number) => string} [options.format=String] - String formatter.
 * @param {boolean} [options.force=false] - Whether to write while focused.
 */
export function syncNumericInputValue(input, value, options = {}) {
  if (!input) {
    return;
  }

  const {
    format = (nextValue) => String(nextValue),
    force = false,
  } = options;

  if (!force && isNumericInputFocused(input)) {
    return;
  }

  const nextValue = format(value);
  if (input.value !== nextValue) {
    input.value = nextValue;
  }
}

/**
 * Returns whether a commit should be skipped because focus is moving to a sibling input.
 * @param {Event|undefined|null} event - Blur or change event.
 * @param {HTMLInputElement|null} siblingInput - Sibling input in the same binding.
 * @returns {boolean} True when the sibling is receiving focus.
 */
export function shouldSkipNumericInputCommit(event, siblingInput) {
  if (!siblingInput) {
    return false;
  }

  if (event?.relatedTarget === siblingInput) {
    return true;
  }

  return isNumericInputFocused(siblingInput);
}

/**
 * Binds a numeric input or a linked range/value pair.
 * The live parser updates internal state immediately, while the committed
 * display is only rewritten once editing ends.
 * @param {object} options - Binding options.
 * @param {HTMLInputElement|null} [options.rangeInput=null] - Range input.
 * @param {HTMLInputElement|null} [options.valueInput=null] - Number input.
 * @param {(value: string) => number} [options.parse=Number.parseFloat] - Input parser.
 * @param {(value: number) => number} [options.sanitize=(value) => value] - Sanitizer.
 * @param {boolean} [options.sanitizeOnInput=true] - Whether live input should be sanitized before state updates.
 * @param {{forceValue?: boolean, forceRange?: boolean}} [options.inputSync] - Synchronization behavior for live input updates.
 * @param {(value: number) => string} [options.format=String] - Formatter.
 * @param {number|function(): number} options.fallbackValue - Fallback value.
 * @param {(value: number) => void} options.setValue - State setter.
 * @param {function(): number} [options.getValue] - State getter for commit fallback.
 * @returns {{syncFromValue:function(number=, object=): number, commitValueInput:function(): number, commitRangeInput:function(): number}} Binding helpers.
 */
export function bindLinkedNumericInputs(options) {
  const {
    rangeInput = null,
    valueInput = null,
    parse = Number.parseFloat,
    sanitize = (value) => value,
    sanitizeOnInput = true,
    inputSync = null,
    format = (value) => String(value),
    fallbackValue,
    setValue,
    getValue = null,
  } = options;

  if (typeof setValue !== 'function') {
    throw new TypeError('setValue must be a function.');
  }

  const liveInputSync = {
    forceValue: false,
    forceRange: true,
    ...(inputSync ?? {}),
  };
  const resolveFallbackValue = () => (typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue);
  const resolveCurrentValue = () => {
    if (typeof getValue === 'function') {
      const currentValue = getValue();
      return Number.isFinite(currentValue) ? currentValue : sanitize(resolveFallbackValue());
    }
    return sanitize(resolveFallbackValue());
  };

  /**
   * Synchronizes both inputs from a canonical value.
   * @param {number} [value=resolveCurrentValue()] - Canonical value.
   * @param {object} [syncOptions={}] - Synchronization options.
   * @param {boolean} [syncOptions.forceValue=false] - Force writing the value input.
   * @param {boolean} [syncOptions.forceRange=false] - Force writing the range input.
   * @returns {number} The canonical value.
   */
  function syncFromValue(value = resolveCurrentValue(), syncOptions = {}) {
    const {
      forceValue = false,
      forceRange = false,
    } = syncOptions;

    syncNumericInputValue(rangeInput, value, { format, force: forceRange });
    syncNumericInputValue(valueInput, value, { format, force: forceValue });
    return value;
  }

  /**
   * Applies the current text of an input to state.
   * @param {HTMLInputElement|null} sourceInput - Source input.
   * @param {object} [inputOptions={}] - Options.
   * @param {boolean} [inputOptions.commit=false] - Whether the edit is being committed.
   * @returns {number} Canonical numeric value.
   */
  function applyInputValue(sourceInput, inputOptions = {}) {
    if (!sourceInput || !('value' in sourceInput)) {
      return syncFromValue();
    }

    const { commit = false } = inputOptions;
    const parsed = parse(String(sourceInput.value ?? ''));

    if (!Number.isFinite(parsed)) {
      if (commit) {
        return syncFromValue(resolveCurrentValue(), { forceValue: true, forceRange: true });
      }
      return resolveCurrentValue();
    }

    const nextValue = commit || sanitizeOnInput ? sanitize(parsed) : parsed;
    setValue(nextValue);
    if (commit) {
      return syncFromValue(nextValue, { forceValue: true, forceRange: true });
    }
    return syncFromValue(nextValue, liveInputSync);
  }

  /**
   * Commits the value input.
   * @returns {number} Canonical numeric value.
   */
  function commitValueInput() {
    return applyInputValue(valueInput, { commit: true });
  }

  /**
   * Commits the range input.
   * @returns {number} Canonical numeric value.
   */
  function commitRangeInput() {
    return applyInputValue(rangeInput, { commit: true });
  }

  if (rangeInput) {
    rangeInput.addEventListener('input', (event) => {
      applyInputValue(event.target, { commit: false });
    });
    rangeInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, valueInput)) {
        return;
      }
      commitRangeInput();
    });
    rangeInput.addEventListener('blur', (event) => {
      if (shouldSkipNumericInputCommit(event, valueInput)) {
        return;
      }
      commitRangeInput();
    });
  }

  if (valueInput) {
    valueInput.addEventListener('input', (event) => {
      applyInputValue(event.target, { commit: false });
    });
    valueInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, rangeInput)) {
        return;
      }
      commitValueInput();
    });
    valueInput.addEventListener('blur', (event) => {
      if (shouldSkipNumericInputCommit(event, rangeInput)) {
        return;
      }
      commitValueInput();
    });
    valueInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        commitValueInput();
      }
    });
  }

  return {
    syncFromValue,
    commitValueInput,
    commitRangeInput,
  };
}
