import { shouldSkipNumericInputCommit } from '../shared/ui/numeric-input-utils.js';

const BUTTON_TEMPLATE = document.createElement('template');
BUTTON_TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      min-width: 0;
      vertical-align: middle;
    }

    button {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid var(--openmmd-button-border-color, #ccc);
      border-radius: var(--openmmd-button-radius, 4px);
      background: var(--openmmd-button-background, #fff);
      color: var(--openmmd-button-color, inherit);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: var(--openmmd-button-padding, 4px 10px);
      font: inherit;
      line-height: 1.2;
      white-space: var(--openmmd-button-white-space, nowrap);
      overflow-wrap: var(--openmmd-button-overflow-wrap, normal);
      word-break: var(--openmmd-button-word-break, normal);
      text-align: var(--openmmd-button-text-align, center);
    }

    button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    :host([variant="icon"]) button {
      width: var(--openmmd-icon-button-size, 30px);
      height: var(--openmmd-icon-button-size, 30px);
      padding: 0;
    }

    :host([variant="toolbar"]) button {
      padding: var(--openmmd-toolbar-button-padding, 5px);
    }

    :host([variant="text-small"]) button {
      padding: 2px 6px;
      font-size: 0.8em;
    }

    ::slotted(img) {
      width: var(--openmmd-button-icon-size, 18px);
      height: var(--openmmd-button-icon-size, 18px);
      display: block;
      object-fit: contain;
      pointer-events: none;
    }
  </style>
  <button part="button" type="button">
    <slot></slot>
  </button>
`;

const NUMBER_CONTROL_TEMPLATE = document.createElement('template');
NUMBER_CONTROL_TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      min-width: 0;
      vertical-align: middle;
    }

    input {
      width: var(--openmmd-number-width, 100%);
      min-width: var(--openmmd-number-min-width, 0);
      box-sizing: border-box;
      text-align: right;
      font: inherit;
      padding: var(--openmmd-number-padding, 4px 8px);
      line-height: 1.2;
    }
  </style>
  <input part="input" type="number">
`;

const RANGE_NUMBER_CONTROL_TEMPLATE = document.createElement('template');
RANGE_NUMBER_CONTROL_TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      min-width: 0;
      vertical-align: middle;
      width: var(--openmmd-range-number-width, 100%);
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--openmmd-range-number-gap, 6px);
      width: 100%;
      min-width: 0;
    }

    input[type="range"] {
      flex: var(--openmmd-range-flex, 1 1 auto);
      min-width: 0;
      accent-color: var(--primary-color, #5cb8d7);
      background: white;
    }

    input[type="number"] {
      flex: var(--openmmd-number-flex, 0 0 auto);
      width: var(--openmmd-range-number-value-width, 76px);
      min-width: var(--openmmd-range-number-value-min-width, 60px);
      box-sizing: border-box;
      text-align: right;
      font: inherit;
      padding: var(--openmmd-number-padding, 4px 8px);
      line-height: 1.2;
    }
  </style>
  <div class="row" part="row">
    <input part="range" type="range">
    <input part="number" type="number">
  </div>
`;

const RANGE_CONTROL_TEMPLATE = document.createElement('template');
RANGE_CONTROL_TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      min-width: 0;
      vertical-align: middle;
      width: var(--openmmd-range-width, 100%);
    }

    input[type="range"] {
      width: 100%;
      min-width: 0;
      accent-color: var(--primary-color, #5cb8d7);
      background: white;
    }
  </style>
  <input part="range" type="range">
`;

/**
 * 値属性の変更時に内部入力へ反映する基底クラスです。
 * @abstract
 */
class OpenMmdFormAssociatedElement extends HTMLElement {
  static get observedAttributes() {
    return ['disabled', 'max', 'min', 'placeholder', 'step', 'value'];
  }

  constructor() {
    super();
    this._syncingValue = false;
  }

  /**
   * 値を読み書きする代表入力を返します。
   * @returns {HTMLInputElement|null}
   */
  getPrimaryInput() {
    return null;
  }

  /**
   * 値を同期する入力一覧を返します。
   * @returns {HTMLInputElement[]}
   */
  getValueInputs() {
    const input = this.getPrimaryInput();
    return input ? [input] : [];
  }

  /**
   * 属性変更を内部入力へ反映します。
   * @param {string} name
   * @param {string|null} _oldValue
   * @param {string|null} newValue
   */
  attributeChangedCallback(name, _oldValue, newValue) {
    const inputs = this.getValueInputs();
    if (inputs.length === 0) {
      return;
    }

    if (name === 'disabled') {
      const disabled = this.disabled;
      inputs.forEach((input) => {
        input.disabled = disabled;
      });
      return;
    }

    if (name === 'value') {
      this._writeValueToInputs(newValue ?? '');
      return;
    }

    inputs.forEach((input) => {
      if (newValue === null) {
        input.removeAttribute(name);
      } else {
        input.setAttribute(name, newValue);
      }
    });
  }

  /**
   * 現在値を返します。
   * @returns {string}
   */
  get value() {
    return this.getAttribute('value') ?? '';
  }

  /**
   * 現在値を設定します。
   * @param {string|number|null|undefined} nextValue
   */
  set value(nextValue) {
    const normalizedValue = nextValue == null ? '' : String(nextValue);
    if (this.getAttribute('value') !== normalizedValue) {
      this.setAttribute('value', normalizedValue);
    } else {
      this._writeValueToInputs(normalizedValue);
    }
  }

  /**
   * 無効状態を返します。
   * @returns {boolean}
   */
  get disabled() {
    return this.hasAttribute('disabled');
  }

  /**
   * 無効状態を設定します。
   * @param {boolean} nextDisabled
   */
  set disabled(nextDisabled) {
    this.toggleAttribute('disabled', Boolean(nextDisabled));
  }

  /**
   * 数値系属性を返します。
   * @param {'min'|'max'|'step'} name
   * @returns {string}
   */
  _getNumericAttribute(name) {
    return this.getAttribute(name) ?? '';
  }

  /**
   * 数値系属性を設定します。
   * @param {'min'|'max'|'step'} name
   * @param {string|number|null|undefined} nextValue
   */
  _setNumericAttribute(name, nextValue) {
    if (nextValue == null || nextValue === '') {
      this.removeAttribute(name);
      return;
    }
    this.setAttribute(name, String(nextValue));
  }

  get min() {
    return this._getNumericAttribute('min');
  }

  set min(nextValue) {
    this._setNumericAttribute('min', nextValue);
  }

  get max() {
    return this._getNumericAttribute('max');
  }

  set max(nextValue) {
    this._setNumericAttribute('max', nextValue);
  }

  get step() {
    return this._getNumericAttribute('step');
  }

  set step(nextValue) {
    this._setNumericAttribute('step', nextValue);
  }

  get placeholder() {
    return this.getAttribute('placeholder') ?? '';
  }

  set placeholder(nextValue) {
    if (nextValue == null || nextValue === '') {
      this.removeAttribute('placeholder');
      return;
    }
    this.setAttribute('placeholder', String(nextValue));
  }

  /**
   * フォーカスを内部入力へ移します。
   */
  focus() {
    this.getPrimaryInput()?.focus();
  }

  /**
   * 内部入力群へ value を反映します。
   * @param {string} nextValue
   */
  _writeValueToInputs(nextValue) {
    this._syncingValue = true;
    try {
      this.getValueInputs().forEach((input) => {
        if (input.value !== nextValue) {
          input.value = nextValue;
        }
      });
    } finally {
      this._syncingValue = false;
    }
  }

  /**
   * host の value と input/change イベントを同期します。
   * @param {string} nextValue
   * @param {'input'|'change'} eventType
   */
  _commitValue(nextValue, eventType) {
    this.value = nextValue;
    if (this._syncingValue) {
      return;
    }
    this.dispatchEvent(new Event(eventType, { bubbles: true, composed: true }));
  }
}

/**
 * 共通ボタン要素です。
 */
class OpenMmdButtonElement extends HTMLElement {
  static get observedAttributes() {
    return ['aria-label', 'disabled', 'title', 'type'];
  }

  constructor() {
    super();
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(BUTTON_TEMPLATE.content.cloneNode(true));
    this._button = shadowRoot.querySelector('button');
    this._button.addEventListener('click', (event) => {
      if (this.disabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  }

  connectedCallback() {
    this._syncAttributes();
  }

  attributeChangedCallback() {
    this._syncAttributes();
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(nextDisabled) {
    this.toggleAttribute('disabled', Boolean(nextDisabled));
  }

  get type() {
    return this.getAttribute('type') ?? 'button';
  }

  set type(nextType) {
    this.setAttribute('type', nextType || 'button');
  }

  focus() {
    this._button?.focus();
  }

  _syncAttributes() {
    if (!this._button) {
      return;
    }
    this._button.disabled = this.disabled;
    this._button.type = this.type;
    if (this.hasAttribute('aria-label')) {
      this._button.setAttribute('aria-label', this.getAttribute('aria-label') || '');
    } else {
      this._button.removeAttribute('aria-label');
    }
    if (this.hasAttribute('title')) {
      this._button.title = this.getAttribute('title') || '';
    } else {
      this._button.removeAttribute('title');
    }
  }
}

/**
 * 単独の number 入力です。
 */
class OpenMmdNumberControlElement extends OpenMmdFormAssociatedElement {
  constructor() {
    super();
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(NUMBER_CONTROL_TEMPLATE.content.cloneNode(true));
    this._input = shadowRoot.querySelector('input');
    this._input.addEventListener('input', () => {
      this._commitValue(this._input.value, 'input');
    });
    this._input.addEventListener('change', () => {
      this._commitValue(this._input.value, 'change');
    });
  }

  connectedCallback() {
    this._writeValueToInputs(this.value);
    this.attributeChangedCallback('disabled', null, this.getAttribute('disabled'));
    this.attributeChangedCallback('min', null, this.getAttribute('min'));
    this.attributeChangedCallback('max', null, this.getAttribute('max'));
    this.attributeChangedCallback('step', null, this.getAttribute('step'));
    this.attributeChangedCallback('placeholder', null, this.getAttribute('placeholder'));
  }

  getPrimaryInput() {
    return this._input;
  }
}

/**
 * range と number を内部で同期する入力です。
 */
class OpenMmdRangeNumberControlElement extends OpenMmdFormAssociatedElement {
  constructor() {
    super();
    this._pendingDeferredNumberCommit = false;
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(RANGE_NUMBER_CONTROL_TEMPLATE.content.cloneNode(true));
    this._rangeInput = shadowRoot.querySelector('input[type="range"]');
    this._numberInput = shadowRoot.querySelector('input[type="number"]');

    this._rangeInput.addEventListener('input', () => {
      this._pendingDeferredNumberCommit = false;
      this._numberInput.value = this._rangeInput.value;
      this._commitValue(this._rangeInput.value, 'input');
    });
    this._rangeInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, this._numberInput)) {
        return;
      }
      this._pendingDeferredNumberCommit = false;
      this._numberInput.value = this._rangeInput.value;
      this._commitValue(this._rangeInput.value, 'change');
    });
    this._numberInput.addEventListener('input', () => {
      if (this.deferNumberInputSync) {
        this._pendingDeferredNumberCommit = true;
        this._commitValue(this._numberInput.value, 'input');
        return;
      }
      this._pendingDeferredNumberCommit = false;
      this._rangeInput.value = this._numberInput.value;
      this._commitValue(this._numberInput.value, 'input');
    });
    this._numberInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, this._rangeInput)) {
        return;
      }
      this._commitNumberValue('change');
    });
    this._numberInput.addEventListener('blur', (event) => {
      if (shouldSkipNumericInputCommit(event, this._rangeInput)) {
        return;
      }
      if (!this.deferNumberInputSync) {
        return;
      }
      this._commitNumberValue('change');
    });
    this._numberInput.addEventListener('keydown', (event) => {
      if (!this.deferNumberInputSync || event.key !== 'Enter') {
        return;
      }
      this._commitNumberValue('change');
    });
  }

  connectedCallback() {
    this._writeValueToInputs(this.value);
    this.attributeChangedCallback('disabled', null, this.getAttribute('disabled'));
    this.attributeChangedCallback('min', null, this.getAttribute('min'));
    this.attributeChangedCallback('max', null, this.getAttribute('max'));
    this.attributeChangedCallback('step', null, this.getAttribute('step'));
    this.attributeChangedCallback('placeholder', null, this.getAttribute('placeholder'));
  }

  getPrimaryInput() {
    return this._numberInput;
  }

  getValueInputs() {
    return [this._rangeInput, this._numberInput];
  }

  /**
   * Returns whether range sync should wait until the number edit is committed.
   * @returns {boolean}
   */
  get deferNumberInputSync() {
    return this.hasAttribute('defer-number-input-sync');
  }

  /**
   * Commits the current number value.
   * @param {'change'} eventType - Host event type.
   */
  _commitNumberValue(eventType) {
    if (this.deferNumberInputSync && !this._pendingDeferredNumberCommit) {
      return;
    }
    this._pendingDeferredNumberCommit = false;
    this._rangeInput.value = this._numberInput.value;
    this._commitValue(this._numberInput.value, eventType);
  }
}

/**
 * 単独の range 入力です。
 */
class OpenMmdRangeControlElement extends OpenMmdFormAssociatedElement {
  constructor() {
    super();
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(RANGE_CONTROL_TEMPLATE.content.cloneNode(true));
    this._input = shadowRoot.querySelector('input');
    this._input.addEventListener('input', () => {
      this._commitValue(this._input.value, 'input');
    });
    this._input.addEventListener('change', () => {
      this._commitValue(this._input.value, 'change');
    });
  }

  connectedCallback() {
    this._writeValueToInputs(this.value);
    this.attributeChangedCallback('disabled', null, this.getAttribute('disabled'));
    this.attributeChangedCallback('min', null, this.getAttribute('min'));
    this.attributeChangedCallback('max', null, this.getAttribute('max'));
    this.attributeChangedCallback('step', null, this.getAttribute('step'));
  }

  getPrimaryInput() {
    return this._input;
  }
}

if (typeof window !== 'undefined' && window.customElements) {
  if (!window.customElements.get('openmmd-button')) {
    window.customElements.define('openmmd-button', OpenMmdButtonElement);
  }
  if (!window.customElements.get('openmmd-number-control')) {
    window.customElements.define('openmmd-number-control', OpenMmdNumberControlElement);
  }
  if (!window.customElements.get('openmmd-range-control')) {
    window.customElements.define('openmmd-range-control', OpenMmdRangeControlElement);
  }
  if (!window.customElements.get('openmmd-range-number-control')) {
    window.customElements.define('openmmd-range-number-control', OpenMmdRangeNumberControlElement);
  }
}
