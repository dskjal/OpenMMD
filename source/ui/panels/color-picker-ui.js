import {
  clamp01,
  hexToLinearRgba,
  hsvToLinearRgba,
  hsvToRgb,
  linearRgbaToHex,
  linearRgbaToHsv,
  linearRgbaToPerceptualRgba,
  perceptualRgbToLinearRgb,
} from '../../shared/color/color-utils.js';
import {
  createColorTemperatureScale,
  estimateColorTemperatureFromLinearRgb,
  COLOR_TEMPERATURE_MAX_KELVIN,
  COLOR_TEMPERATURE_MIN_KELVIN,
  COLOR_TEMPERATURE_NEUTRAL_KELVIN,
} from '../../shared/color/color-temperature-utils.js';
import {
  bindLinkedNumericInputs,
  isNumericInputFocused,
  syncNumericInputValue,
} from '../../shared/ui/numeric-input-utils.js';

const DEFAULT_DIALOG_TITLE = 'Color Picker';
const WHEEL_SIZE = 220;
const WHEEL_RADIUS = WHEEL_SIZE / 2;
const DIALOG_GAP = 8;
const DIALOG_MARGIN = 12;
/** @type {object|null} */
let activeColorPickerContext = null;
/** @type {Document|null} */
let sharedColorPickerBindingsDocument = null;

/**
 * 色ピッカー UI の要素を収集します。
 * @param {object} [options={}] - 要素取得オプション。
 * @param {string} [options.triggerButtonId='light-color-swatch'] - 起動ボタンの id。
 * @param {string|null} [options.strengthRangeInputId='light-color-strength-range'] - 強度スライダーの id。
 * @param {string|null} [options.strengthValueInputId='light-color-strength-range'] - 強度数値入力の id。
 * @returns {object|null} 要素群。
 */
function getColorPickerElements(options = {}) {
  const {
    triggerButtonId = 'light-color-swatch',
    strengthRangeInputId = 'light-color-strength-range',
    strengthValueInputId = 'light-color-strength-range',
  } = options;
  const overlay = document.getElementById('color-picker-overlay');
  const dialog = document.getElementById('color-picker-dialog');
  const body = document.getElementById('color-picker-body');
  const triggerButton = document.getElementById(triggerButtonId);
  const strengthRangeInput = strengthRangeInputId ? document.getElementById(strengthRangeInputId) : null;
  const strengthValueInput = strengthValueInputId ? document.getElementById(strengthValueInputId) : null;
  const previewSwatch = document.getElementById('color-picker-preview');
  const wheelCanvas = document.getElementById('color-picker-wheel');
  const valueSlider = document.getElementById('color-picker-value-slider');
  const linearButton = document.getElementById('color-picker-linear');
  const perceptualButton = document.getElementById('color-picker-perceptual');
  const rgbButton = document.getElementById('color-picker-rgb');
  const hsvButton = document.getElementById('color-picker-hsv');
  const temperatureButton = document.getElementById('color-picker-temperature');
  const rgbFields = [
    document.getElementById('color-picker-rgb-red'),
    document.getElementById('color-picker-rgb-green'),
    document.getElementById('color-picker-rgb-blue'),
  ];
  const hsvFields = [
    document.getElementById('color-picker-hue'),
    document.getElementById('color-picker-saturation'),
    document.getElementById('color-picker-value'),
  ];
  const temperatureRangeInput = document.getElementById('color-picker-temperature-range');
  const temperatureValueInput = document.getElementById('color-picker-temperature-value');
  const alphaInput = document.getElementById('color-picker-alpha');
  const hexInput = document.getElementById('color-picker-hex');
  const eyedropperButton = document.getElementById('color-picker-eyedropper');

  if (!overlay || !dialog || !body || !triggerButton || !previewSwatch || !wheelCanvas || !valueSlider
    || !linearButton || !perceptualButton || !rgbButton || !hsvButton || !temperatureButton
    || !temperatureRangeInput || !temperatureValueInput || !alphaInput || !hexInput) {
    return null;
  }

  if (strengthRangeInputId && !strengthRangeInput) {
    return null;
  }
  if (strengthValueInputId && !strengthValueInput) {
    return null;
  }

  return {
    overlay,
    dialog,
    body,
    triggerButton,
    strengthRangeInput,
    strengthValueInput,
    previewSwatch,
    wheelCanvas,
    valueSlider,
    linearButton,
    perceptualButton,
    rgbButton,
    hsvButton,
    temperatureButton,
    rgbFields,
    hsvFields,
    temperatureRangeInput,
    temperatureValueInput,
    alphaInput,
    hexInput,
    eyedropperButton,
  };
}

/**
 * 値入力を読み取ります。
 * @param {HTMLInputElement|null} input - 数値入力。
 * @param {number} fallback - 失敗時の値。
 * @returns {number} 読み取った値。
 */
function readNumberValue(input, fallback) {
  if (!input || !('value' in input)) {
    return fallback;
  }
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 文字列を 0..1 の範囲へ収めます。
 * @param {string} value - 入力文字列。
 * @param {number} fallback - 失敗時の値。
 * @returns {number} 値。
 */
function parseClampedPercentage(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp01(parsed, fallback);
}

/**
 * HEX 入力として妥当かどうかを返します。
 * @param {string} value - 入力文字列。
 * @returns {boolean} 妥当性。
 */
function isValidHexInput(value) {
  const normalized = String(value || '').trim().replace(/^#/, '');
  return [3, 4, 6, 8].includes(normalized.length) && /^[0-9a-fA-F]+$/.test(normalized);
}

/**
 * 2 つの数値配列が近いかどうかを返します。
 * @param {number[]} left - 左辺。
 * @param {number[]} right - 右辺。
 * @param {number} [epsilon=1e-5] - 許容誤差。
 * @returns {boolean} 一致判定。
 */
function areColorsClose(left, right, epsilon = 1e-5) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (Math.abs((left[i] ?? 0) - (right[i] ?? 0)) > epsilon) {
      return false;
    }
  }
  return true;
}

/**
 * 値を範囲内へ収めます。
 * @param {number} value - 値。
 * @param {number} min - 最小値。
 * @param {number} max - 最大値。
 * @returns {number} 収めた値。
 */
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 色温度 range の表示値を Kelvin へ変換します。
 * @param {number} value - range の表示値。
 * @returns {number} Kelvin。
 */
function temperatureRangeValueToKelvin(value) {
  return COLOR_TEMPERATURE_MIN_KELVIN + COLOR_TEMPERATURE_MAX_KELVIN - value;
}

/**
 * Kelvin を色温度 range の表示値へ変換します。
 * @param {number} kelvin - Kelvin。
 * @returns {number} range の表示値。
 */
function kelvinToTemperatureRangeValue(kelvin) {
  return COLOR_TEMPERATURE_MIN_KELVIN + COLOR_TEMPERATURE_MAX_KELVIN - kelvin;
}

/**
 * RGBA の alpha 成分を範囲内へ収めます。
 * @param {number} value - 値。
 * @param {number} fallback - 失敗時の値。
 * @param {number} min - 最小値。
 * @param {number} max - 最大値。
 * @returns {number} 収めた値。
 */
function clampAlphaValue(value, fallback, min, max) {
  return Number.isFinite(value) ? clampNumber(value, min, max) : fallback;
}

/**
 * 線形 RGBA を alpha 上限付きで正規化します。
 * @param {ArrayLike<number>|null} color - 入力配列。
 * @param {number[]} [fallback=[0, 0, 0, 1]] - 変換失敗時の既定値。
 * @param {number} [alphaMin=0.0] - alpha の最小値。
 * @param {number} [alphaMax=1.0] - alpha の最大値。
 * @returns {number[]} 正規化済みの線形 RGBA。
 */
function normalizeLinearRgbaWithAlphaBounds(color, fallback = [0, 0, 0, 1], alphaMin = 0.0, alphaMax = 1.0) {
  return [
    clamp01(color?.[0], fallback[0]),
    clamp01(color?.[1], fallback[1]),
    clamp01(color?.[2], fallback[2]),
    clampAlphaValue(color?.[3], fallback[3], alphaMin, alphaMax),
  ];
}

/**
 * 共通のカラーピッカー DOM へ 1 回だけイベントを結線します。
 * @param {object} elements - 共通要素群。
 */
function bindSharedColorPickerBindings(elements) {
  if (sharedColorPickerBindingsDocument === document) {
    return;
  }

  sharedColorPickerBindingsDocument = document;

  elements.overlay.addEventListener('click', (event) => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    if (event.target === elements.overlay) {
      active.closeDialog();
    }
  });
  elements.linearButton.addEventListener('click', () => {
    const active = activeColorPickerContext;
    active?.setColorSpaceMode('linear');
  });
  elements.perceptualButton.addEventListener('click', () => {
    const active = activeColorPickerContext;
    active?.setColorSpaceMode('perceptual');
  });
  elements.rgbButton.addEventListener('click', () => {
    const active = activeColorPickerContext;
    active?.setChannelMode('rgb');
  });
  elements.hsvButton.addEventListener('click', () => {
    const active = activeColorPickerContext;
    active?.setChannelMode('hsv');
  });
  elements.temperatureButton.addEventListener('click', () => {
    const active = activeColorPickerContext;
    active?.setChannelMode('temperature');
  });
  elements.rgbFields.forEach((input) => {
    input?.addEventListener('input', (event) => {
      const active = activeColorPickerContext;
      active?.applyRgbInputs(event.target);
    });
    input?.addEventListener('blur', () => {
      const active = activeColorPickerContext;
      active?.applyRgbInputs();
    });
  });
  elements.hsvFields.forEach((input) => {
    input?.addEventListener('input', (event) => {
      const active = activeColorPickerContext;
      active?.applyHsvInputs(event.target);
    });
    input?.addEventListener('blur', () => {
      const active = activeColorPickerContext;
      active?.applyHsvInputs();
    });
  });
  elements.temperatureRangeInput.addEventListener('input', (event) => {
    const active = activeColorPickerContext;
    active?.applyTemperatureInputs(event.target);
  });
  elements.temperatureRangeInput.addEventListener('blur', () => {
    const active = activeColorPickerContext;
    if (isNumericInputFocused(elements.temperatureValueInput)) {
      return;
    }
    active?.applyTemperatureInputs(elements.temperatureRangeInput, null);
  });
  elements.temperatureValueInput.addEventListener('input', (event) => {
    const active = activeColorPickerContext;
    active?.applyTemperatureInputs(event.target);
  });
  elements.temperatureValueInput.addEventListener('blur', () => {
    const active = activeColorPickerContext;
    if (isNumericInputFocused(elements.temperatureRangeInput)) {
      return;
    }
    active?.applyTemperatureInputs(elements.temperatureValueInput, null);
  });
  elements.alphaInput.addEventListener('input', () => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    active.applyAlphaInput(elements.alphaInput);
  });
  elements.alphaInput.addEventListener('blur', () => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    active.applyAlphaInput(elements.alphaInput, null);
  });
  elements.hexInput.addEventListener('input', () => {
    const active = activeColorPickerContext;
    active?.applyHexInput();
  });
  elements.hexInput.addEventListener('blur', () => {
    const active = activeColorPickerContext;
    active?.applyHexInput(null);
  });
  elements.eyedropperButton?.addEventListener('click', () => {
    const active = activeColorPickerContext;
    void active?.pickColorFromEyeDropper();
  });
  elements.wheelCanvas.addEventListener('pointerdown', (event) => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    elements.wheelCanvas.setPointerCapture(event.pointerId);
    active.updateFromWheelPosition(event.clientX, event.clientY);
  });
  elements.wheelCanvas.addEventListener('pointermove', (event) => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    if (event.buttons === 0) {
      return;
    }
    active.updateFromWheelPosition(event.clientX, event.clientY);
  });
  elements.wheelCanvas.addEventListener('pointerup', (event) => {
    if (elements.wheelCanvas.hasPointerCapture(event.pointerId)) {
      elements.wheelCanvas.releasePointerCapture(event.pointerId);
    }
  });
  elements.valueSlider.addEventListener('input', () => {
    const active = activeColorPickerContext;
    active?.applyValueSlider();
  });
  window.addEventListener('keydown', (event) => {
    const active = activeColorPickerContext;
    if (!active || !active.isOpen()) {
      return;
    }
    if (event.key === 'Escape') {
      active.closeDialog();
    }
  });
}

/**
 * 色ピッカー UI を初期化します。
 * @param {object} options - 初期化オプション。
 * @param {object} options.state - 値を保持する state。
 * @param {string} options.propertyName - state 内の RGBA プロパティ名。
 * @param {Function} options.applyValue - 値反映関数。
 * @param {Function} [options.onChanged] - 値変更後の通知。
 * @param {string} [options.title='Color Picker'] - ダイアログタイトル。
 * @param {number} [options.strengthMin=0.0] - strength の最小値。
 * @param {number} [options.strengthMax=1.0] - strength の最大値。
 * @returns {object|null} 初期化結果。
 */
export function setupColorPickerUI(options = {}) {
  const {
    state,
    propertyName,
    applyValue,
    onChanged,
    title = DEFAULT_DIALOG_TITLE,
    allowAlpha = true,
    triggerButtonId = 'light-color-swatch',
    strengthRangeInputId = 'light-color-strength-range',
    strengthValueInputId = 'light-color-strength-range',
    strengthMin = 0.0,
    strengthMax = 1.0,
  } = options;

  const elements = getColorPickerElements({
    triggerButtonId,
    strengthRangeInputId: allowAlpha ? strengthRangeInputId : null,
    strengthValueInputId: allowAlpha ? strengthValueInputId : null,
  });
  if (!elements) {
    return null;
  }

  if (!state || typeof propertyName !== 'string' || typeof applyValue !== 'function') {
    return null;
  }

  bindSharedColorPickerBindings(elements);

  if (elements.eyedropperButton) {
    elements.eyedropperButton.disabled = typeof window === 'undefined' || typeof window.EyeDropper !== 'function';
  }

  const wheelCanvas = elements.wheelCanvas;
  wheelCanvas.width = WHEEL_SIZE;
  wheelCanvas.height = WHEEL_SIZE;
  const wheelContext = wheelCanvas.getContext('2d');

  let isOpen = false;
  let isMixed = false;
  let colorSpaceMode = 'perceptual';
  let channelMode = 'hsv';
  let lastFocusedElement = null;
  let eyedropperRestorePending = false;
  let currentLinearRgba = normalizeLinearRgbaWithAlphaBounds(state[propertyName], [1, 1, 1, 1], strengthMin, strengthMax);
  let currentColorTemperature = estimateColorTemperatureFromLinearRgb(currentLinearRgba);
  /** @type {object|null} */
  let controller = null;

  /**
   * state の現在値を返します。
   * @returns {number[]} 線形 RGBA。
   */
  function getCurrentColor() {
    const nextColor = normalizeLinearRgbaWithAlphaBounds(state[propertyName], currentLinearRgba, strengthMin, strengthMax);
    if (!areColorsClose(nextColor, currentLinearRgba)) {
      currentLinearRgba = nextColor;
    }
    return currentLinearRgba;
  }

  /**
   * スウォッチ背景を更新します。
   */
  function syncSwatchPreview() {
    const [red, green, blue, alpha] = linearRgbaToPerceptualRgba(getCurrentColor());
    const rgba = `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${allowAlpha ? alpha : 1.0})`;
    const checkerboard = 'linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666), linear-gradient(45deg, #666 25%, transparent 25%, transparent 75%, #666 75%, #666)';
    const fill = `linear-gradient(${rgba}, ${rgba})`;
    const mixedFill = 'linear-gradient(135deg, rgba(255, 255, 255, 0.18) 25%, rgba(255, 255, 255, 0.02) 25%, rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0.18) 75%, rgba(255, 255, 255, 0.02) 75%, rgba(255, 255, 255, 0.02) 100%)';
    if (elements.triggerButton) {
      if (isMixed) {
        elements.triggerButton.style.backgroundImage = mixedFill;
        elements.triggerButton.style.backgroundSize = '12px 12px';
        elements.triggerButton.style.backgroundPosition = '0 0';
        elements.triggerButton.style.backgroundRepeat = 'repeat';
        elements.triggerButton.style.backgroundColor = '#444';
      } else {
        elements.triggerButton.style.backgroundImage = allowAlpha ? `${fill}, ${checkerboard}` : fill;
        elements.triggerButton.style.backgroundSize = allowAlpha ? 'auto, 12px 12px, 12px 12px' : 'auto';
        elements.triggerButton.style.backgroundPosition = allowAlpha ? 'center, 0 0, 6px 6px' : 'center';
        elements.triggerButton.style.backgroundRepeat = allowAlpha ? 'no-repeat, repeat, repeat' : 'no-repeat';
        elements.triggerButton.style.backgroundColor = '#222';
      }
      elements.triggerButton.style.color = '#111';
    }
    if (elements.previewSwatch) {
      elements.previewSwatch.style.backgroundImage = allowAlpha ? `${fill}, ${checkerboard}` : fill;
      elements.previewSwatch.style.backgroundSize = allowAlpha ? 'auto, 12px 12px, 12px 12px' : 'auto';
      elements.previewSwatch.style.backgroundPosition = allowAlpha ? 'center, 0 0, 6px 6px' : 'center';
      elements.previewSwatch.style.backgroundRepeat = allowAlpha ? 'no-repeat, repeat, repeat' : 'no-repeat';
      elements.previewSwatch.style.backgroundColor = '#222';
      elements.previewSwatch.style.color = '#111';
    }
    syncStrengthInputs();
    elements.triggerButton.title = isMixed ? (title ? `${title}: Mixed` : 'Mixed') : `${title}: ${linearRgbaToHex(currentLinearRgba)}`;
  }

  /**
   * 強度入力を同期します。
   */
  function syncStrengthInputs() {
    const nextValue = String(currentLinearRgba[3].toFixed(3));
    syncNumericInputValue(elements.strengthRangeInput, currentLinearRgba[3], {
      force: false,
      format: (value) => String(Number(value).toFixed(3)),
    });
    syncNumericInputValue(elements.strengthValueInput, currentLinearRgba[3], {
      force: false,
      format: (value) => String(Number(value).toFixed(3)),
    });
  }

  /**
   * wheel の 1px を描画します。
   * @param {number} value - Value。
   * @param {number} x - X 座標。
   * @param {number} y - Y 座標。
   * @param {ImageData} imageData - 描画先。
   */
  function setWheelPixel(value, x, y, imageData) {
    const index = (y * WHEEL_SIZE + x) * 4;
    const dx = (x + 0.5 - WHEEL_RADIUS) / WHEEL_RADIUS;
    const dy = (y + 0.5 - WHEEL_RADIUS) / WHEEL_RADIUS;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 1.0) {
      imageData.data[index + 0] = 0;
      imageData.data[index + 1] = 0;
      imageData.data[index + 2] = 0;
      imageData.data[index + 3] = 0;
      return;
    }

    let hue = Math.atan2(dy, dx) * 180 / Math.PI;
    if (hue < 0) {
      hue += 360;
    }
    const saturation = distance;
    const rgb = hsvToRgb([hue, saturation, value]);
    imageData.data[index + 0] = Math.round(clamp01(rgb[0], 0.0) * 255);
    imageData.data[index + 1] = Math.round(clamp01(rgb[1], 0.0) * 255);
    imageData.data[index + 2] = Math.round(clamp01(rgb[2], 0.0) * 255);
    imageData.data[index + 3] = 255;
  }

  /**
   * カラーホイールを再描画します。
   * @param {number} hue - Hue。
   * @param {number} saturation - Saturation。
   * @param {number} value - Value。
   */
  function drawWheel(hue, saturation, value) {
    if (!wheelContext) {
      return;
    }
    const imageData = wheelContext.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    for (let y = 0; y < WHEEL_SIZE; y++) {
      for (let x = 0; x < WHEEL_SIZE; x++) {
        setWheelPixel(value, x, y, imageData);
      }
    }
    wheelContext.putImageData(imageData, 0, 0);

    wheelContext.save();
    wheelContext.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    wheelContext.lineWidth = 2;
    wheelContext.beginPath();
    wheelContext.arc(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_RADIUS - 1, 0, Math.PI * 2);
    wheelContext.stroke();
    const markerRadius = Math.max(3, WHEEL_SIZE * 0.03);
    const angle = hue * Math.PI / 180;
    const distance = saturation * (WHEEL_RADIUS - markerRadius - 2);
    const markerX = WHEEL_RADIUS + Math.cos(angle) * distance;
    const markerY = WHEEL_RADIUS + Math.sin(angle) * distance;
    wheelContext.fillStyle = 'rgba(255, 255, 255, 0.9)';
    wheelContext.beginPath();
    wheelContext.arc(markerX, markerY, markerRadius, 0, Math.PI * 2);
    wheelContext.fill();
    wheelContext.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    wheelContext.lineWidth = 1;
    wheelContext.stroke();
    wheelContext.restore();
  }

  /**
   * 値スライダーを更新します。
   * @param {number[]} linearRgba - 線形 RGBA。
   */
  function syncValueSlider(linearRgba) {
    const hsv = linearRgbaToHsv(linearRgba);
    const rgb = hsvToRgb([hsv[0], hsv[1], 1.0]);
    const topColor = `rgb(${Math.round(rgb[0] * 255)} ${Math.round(rgb[1] * 255)} ${Math.round(rgb[2] * 255)})`;
    elements.valueSlider.style.background = `linear-gradient(to top, ${topColor}, #000)`;
    elements.valueSlider.value = String(hsv[2].toFixed(3));
  }

  /**
   * RGB 入力群を同期します。
   * @param {number[]} linearRgba - 線形 RGBA。
   */
  function syncRgbInputs(linearRgba, preserveElement = null) {
    const displayRgba = colorSpaceMode === 'linear'
      ? linearRgba
      : linearRgbaToPerceptualRgba(linearRgba);
    elements.rgbFields.forEach((input, index) => {
      if (input && input !== preserveElement) {
        syncNumericInputValue(input, Math.round(clamp01(displayRgba[index], 0.0) * 255), {
          force: false,
          format: (value) => String(Math.round(value)),
        });
      }
    });
  }

  /**
   * HSV 入力群を同期します。
   * @param {number[]} linearRgba - 線形 RGBA。
   */
  function syncHsvInputs(linearRgba, preserveElement = null) {
    const [hue, saturation, value] = linearRgbaToHsv(linearRgba);
    if (elements.hsvFields[0] && elements.hsvFields[0] !== preserveElement) {
      syncNumericInputValue(elements.hsvFields[0], Math.round(hue), {
        force: false,
        format: (nextValue) => String(Math.round(nextValue)),
      });
    }
    if (elements.hsvFields[1] && elements.hsvFields[1] !== preserveElement) {
      syncNumericInputValue(elements.hsvFields[1], Math.round(saturation * 100), {
        force: false,
        format: (nextValue) => String(Math.round(nextValue)),
      });
    }
    if (elements.hsvFields[2] && elements.hsvFields[2] !== preserveElement) {
      syncNumericInputValue(elements.hsvFields[2], Math.round(value * 100), {
        force: false,
        format: (nextValue) => String(Math.round(nextValue)),
      });
    }
    if (elements.alphaInput !== preserveElement) {
      syncNumericInputValue(elements.alphaInput, currentLinearRgba[3], {
        force: false,
        format: (nextValue) => String(Number(nextValue).toFixed(3)),
      });
    }
  }

  /**
   * 色温度入力群を同期します。
   * @param {number[]} linearRgba - 線形 RGBA。
   * @param {HTMLInputElement|null} [preserveElement=null] - 同期時に維持する要素。
   */
  function syncTemperatureInputs(linearRgba, preserveElement = null) {
    const temperature = channelMode === 'temperature'
      ? currentColorTemperature
      : estimateColorTemperatureFromLinearRgb(linearRgba);
    const temperatureStops = [
      COLOR_TEMPERATURE_MIN_KELVIN,
      COLOR_TEMPERATURE_NEUTRAL_KELVIN,
      COLOR_TEMPERATURE_MAX_KELVIN,
    ].map((kelvin) => {
      const scale = createColorTemperatureScale(kelvin);
      const perceptual = linearRgbaToPerceptualRgba([scale[0], scale[1], scale[2], 1.0]);
      return `rgb(${Math.round(perceptual[0] * 255)} ${Math.round(perceptual[1] * 255)} ${Math.round(perceptual[2] * 255)})`;
    });
    if (elements.temperatureRangeInput && elements.temperatureRangeInput !== preserveElement) {
      syncNumericInputValue(elements.temperatureRangeInput, kelvinToTemperatureRangeValue(temperature), {
        force: false,
        format: (nextValue) => String(Math.round(nextValue)),
      });
      elements.temperatureRangeInput.style.background = `linear-gradient(to right, ${temperatureStops.join(', ')})`;
    }
    if (elements.temperatureValueInput && elements.temperatureValueInput !== preserveElement) {
      syncNumericInputValue(elements.temperatureValueInput, temperature, {
        force: false,
        format: (nextValue) => String(Math.round(nextValue)),
      });
    }
  }

  /**
   * HEX 入力を同期します。
   * @param {number[]} linearRgba - 線形 RGBA。
   * @param {HTMLInputElement|null} [preserveElement=null] - 同期時に維持する要素。
   */
  function syncHexInput(linearRgba, preserveElement = null) {
    if (elements.hexInput && elements.hexInput !== preserveElement) {
      elements.hexInput.value = linearRgbaToHex(linearRgba);
    }
  }

  /**
   * ダイアログの表示/非表示を切り替えます。
   * @param {boolean} visible - 可視状態。
   */
  function setDialogVisible(visible) {
    isOpen = visible;
    elements.overlay.hidden = !visible;
    if (!visible) {
      elements.dialog.style.left = '';
      elements.dialog.style.top = '';
      elements.dialog.style.right = '';
      elements.dialog.style.bottom = '';
      elements.dialog.style.transform = '';
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
      return;
    }
    elements.dialog.setAttribute('aria-label', title);
    elements.dialog.focus();
  }

  /**
   * ダイアログを起動ボタンの近くへ配置します。
   */
  function positionDialogNearTrigger() {
    const triggerRect = elements.triggerButton.getBoundingClientRect();
    const dialogRect = elements.dialog.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || triggerRect.width;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || triggerRect.height;

    let left = triggerRect.left;
    const maxLeft = Math.max(DIALOG_MARGIN, viewportWidth - dialogRect.width - DIALOG_MARGIN);
    left = clampNumber(left, DIALOG_MARGIN, maxLeft);

    let top = triggerRect.top - dialogRect.height - DIALOG_GAP;
    if (top < DIALOG_MARGIN) {
      top = triggerRect.bottom + DIALOG_GAP;
    }
    const maxTop = Math.max(DIALOG_MARGIN, viewportHeight - dialogRect.height - DIALOG_MARGIN);
    top = clampNumber(top, DIALOG_MARGIN, maxTop);

    elements.dialog.style.position = 'fixed';
    elements.dialog.style.left = `${Math.round(left)}px`;
    elements.dialog.style.top = `${Math.round(top)}px`;
    elements.dialog.style.right = 'auto';
    elements.dialog.style.bottom = 'auto';
    elements.dialog.style.transform = 'none';
  }

  /**
   * 色入力 UI を再描画します。
   */
  function syncDialogUi(preserveElement = null) {
    const linearRgba = getCurrentColor();
    const hsv = linearRgbaToHsv(linearRgba);

    elements.linearButton.classList.toggle('is-active', colorSpaceMode === 'linear');
    elements.perceptualButton.classList.toggle('is-active', colorSpaceMode === 'perceptual');
    elements.rgbButton.classList.toggle('is-active', channelMode === 'rgb');
    elements.hsvButton.classList.toggle('is-active', channelMode === 'hsv');
    elements.temperatureButton.classList.toggle('is-active', channelMode === 'temperature');
    elements.rgbFields.forEach((input) => {
      if (input) {
        input.closest('.color-picker-channel-group')?.toggleAttribute('hidden', channelMode !== 'rgb');
      }
    });
    elements.hsvFields.forEach((input) => {
      if (input) {
        input.closest('.color-picker-channel-group')?.toggleAttribute('hidden', channelMode !== 'hsv');
      }
    });
    elements.temperatureRangeInput.closest('.color-picker-temperature-row')?.toggleAttribute('hidden', channelMode !== 'temperature');
    elements.temperatureValueInput.closest('.color-picker-temperature-row')?.toggleAttribute('hidden', channelMode !== 'temperature');
    if (elements.alphaInput) {
      elements.alphaInput.closest('.color-picker-channel-group')?.toggleAttribute('hidden', !allowAlpha);
    }
    if (elements.body) {
      elements.body.classList.toggle('is-temperature-mode', channelMode === 'temperature');
    }
    elements.wheelCanvas.hidden = channelMode === 'temperature';
    elements.valueSlider.hidden = channelMode === 'temperature';

    syncSwatchPreview();
    drawWheel(hsv[0], hsv[1], hsv[2]);
    syncValueSlider(linearRgba);
    syncStrengthInputs();
    syncRgbInputs(linearRgba, preserveElement);
    syncHsvInputs(linearRgba, preserveElement);
    syncTemperatureInputs(linearRgba, preserveElement);
    syncHexInput(linearRgba, preserveElement);
    if (!allowAlpha && elements.alphaInput && elements.alphaInput !== preserveElement) {
      elements.alphaInput.value = '1.000';
    }
  }

  /**
   * 値を state へ反映します。
   * @param {number[]} nextColor - 線形 RGBA。
   * @param {object} [options={}] - 反映オプション。
   * @param {string|null} [options.source=null] - 変更元。
   */
  function commitColor(nextColor, preserveElement = null, options = {}) {
    const { source = null } = options;
    const normalized = normalizeLinearRgbaWithAlphaBounds(nextColor, currentLinearRgba, strengthMin, strengthMax);
    if (!allowAlpha) {
      normalized[3] = 1.0;
    }
    if (areColorsClose(normalized, currentLinearRgba)) {
      syncDialogUi(preserveElement);
      return;
    }
    currentLinearRgba = normalized;
    if (source !== 'temperature' && preserveElement !== elements.temperatureRangeInput && preserveElement !== elements.temperatureValueInput) {
      currentColorTemperature = estimateColorTemperatureFromLinearRgb(normalized);
    }
    applyValue([...normalized]);
    syncDialogUi(preserveElement);
    onChanged?.();
  }

  /**
   * RGB 入力の値を反映します。
   */
  function applyRgbInputs(preserveElement = null) {
    const red = clamp01(readNumberValue(elements.rgbFields[0], currentLinearRgba[0] * 255) / 255.0, currentLinearRgba[0]);
    const green = clamp01(readNumberValue(elements.rgbFields[1], currentLinearRgba[1] * 255) / 255.0, currentLinearRgba[1]);
    const blue = clamp01(readNumberValue(elements.rgbFields[2], currentLinearRgba[2] * 255) / 255.0, currentLinearRgba[2]);
    const alpha = allowAlpha
      ? clampAlphaValue(readNumberValue(elements.alphaInput, currentLinearRgba[3]), currentLinearRgba[3], strengthMin, strengthMax)
      : 1.0;
    const rgb = colorSpaceMode === 'linear'
      ? [red, green, blue]
      : perceptualRgbToLinearRgb([red, green, blue]);
    commitColor([rgb[0], rgb[1], rgb[2], alpha], preserveElement);
  }

  /**
   * HSV 入力の値を反映します。
   */
  function applyHsvInputs(preserveElement = null) {
    const hue = readNumberValue(elements.hsvFields[0], 0.0);
    const saturation = clamp01(readNumberValue(elements.hsvFields[1], 0.0) / 100.0, 0.0);
    const value = clamp01(readNumberValue(elements.hsvFields[2], 0.0) / 100.0, 0.0);
    const alpha = allowAlpha
      ? clampAlphaValue(readNumberValue(elements.alphaInput, currentLinearRgba[3]), currentLinearRgba[3], strengthMin, strengthMax)
      : 1.0;
    commitColor(hsvToLinearRgba([hue, saturation, value, alpha]), preserveElement);
  }

  /**
   * 色温度入力の値を反映します。
   */
  function applyTemperatureInputs(inputElement = elements.temperatureValueInput, preserveElement = inputElement) {
    const fallbackTemperature = estimateColorTemperatureFromLinearRgb(getCurrentColor());
    const isRangeInput = inputElement === elements.temperatureRangeInput;
    const inputTemperature = readNumberValue(inputElement, fallbackTemperature);
    const temperature = isRangeInput
      ? temperatureRangeValueToKelvin(inputTemperature)
      : inputTemperature;
    const nextTemperature = Math.round(clampNumber(
      temperature,
      COLOR_TEMPERATURE_MIN_KELVIN,
      COLOR_TEMPERATURE_MAX_KELVIN,
    ) / 100) * 100;
    currentColorTemperature = nextTemperature;
    const scale = createColorTemperatureScale(nextTemperature);
    commitColor([scale[0], scale[1], scale[2], currentLinearRgba[3]], preserveElement, { source: 'temperature' });
  }

  /**
   * Alpha 入力の値を反映します。
   * @param {HTMLInputElement|null} preserveElement - 同期時に維持する要素。
   */
  function applyAlphaInput(inputElement = elements.alphaInput, preserveElement = inputElement) {
    if (!allowAlpha) {
      return;
    }
    const nextAlpha = clampAlphaValue(readNumberValue(inputElement, currentLinearRgba[3]), currentLinearRgba[3], strengthMin, strengthMax);
    commitColor([currentLinearRgba[0], currentLinearRgba[1], currentLinearRgba[2], nextAlpha], preserveElement);
  }

  /**
   * 値スライダーの値を反映します。
   */
  function applyValueSlider() {
    if (!isOpen) {
      return;
    }
    const hsv = linearRgbaToHsv(getCurrentColor());
    const value = clamp01(readNumberValue(elements.valueSlider, hsv[2]), hsv[2]);
    commitColor(hsvToLinearRgba([hsv[0], hsv[1], value, hsv[3]]), elements.valueSlider);
  }

  /**
   * HEX 入力の値を反映します。
   * @param {HTMLInputElement|null} [preserveElement=elements.hexInput] - 同期時に維持する要素。
   */
  function applyHexInput(preserveElement = elements.hexInput) {
    if (!isValidHexInput(elements.hexInput.value)) {
      if (preserveElement === null) {
        syncHexInput(getCurrentColor());
      }
      return;
    }
    commitColor(hexToLinearRgba(elements.hexInput.value, currentLinearRgba), preserveElement);
  }

  /**
   * swatch のクリックを反映します。
   */
  function openDialog() {
    const previousActive = activeColorPickerContext;
    if (previousActive && previousActive !== controller && typeof previousActive.closeDialog === 'function') {
      previousActive.closeDialog();
    }
    lastFocusedElement = document.activeElement;
    activeColorPickerContext = controller;
    setDialogVisible(true);
    syncDialogUi();
    positionDialogNearTrigger();
  }

  /**
   * ダイアログを閉じます。
   */
  function closeDialog() {
    if (activeColorPickerContext === controller) {
      activeColorPickerContext = null;
    }
    setDialogVisible(false);
  }

  /**
   * カラー選択を wheel 座標から更新します。
   * @param {number} clientX - 画面 X。
   * @param {number} clientY - 画面 Y。
   */
  function updateFromWheelPosition(clientX, clientY) {
    const rect = wheelCanvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const centerX = rect.width * 0.5;
    const centerY = rect.height * 0.5;
    const dx = (x - centerX) / (rect.width * 0.5);
    const dy = (y - centerY) / (rect.height * 0.5);
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 1.0) {
      return;
    }
    let hue = Math.atan2(dy, dx) * 180 / Math.PI;
    if (hue < 0) {
      hue += 360;
    }
    const hsv = linearRgbaToHsv(getCurrentColor());
    commitColor(hsvToLinearRgba([hue, distance, hsv[2], hsv[3]]));
  }

  /**
   * EyeDropper を起動します。
   */
  async function pickColorFromEyeDropper() {
    if (typeof window === 'undefined' || typeof window.EyeDropper !== 'function') {
      return;
    }
    const wasOpen = isOpen;
    eyedropperRestorePending = wasOpen;
    if (wasOpen) {
      setDialogVisible(false);
    }

    try {
      const picker = new window.EyeDropper();
      const result = await picker.open();
      if (result?.sRGBHex) {
        commitColor(hexToLinearRgba(result.sRGBHex, currentLinearRgba));
      }
      if (eyedropperRestorePending) {
        setDialogVisible(true);
        syncDialogUi();
      }
    } catch (error) {
      if (eyedropperRestorePending) {
        setDialogVisible(true);
        syncDialogUi();
      }
      void error;
    } finally {
      eyedropperRestorePending = false;
    }
  }

  elements.triggerButton.addEventListener('click', openDialog);
  if (allowAlpha && (elements.strengthRangeInput || elements.strengthValueInput)) {
    bindLinkedNumericInputs({
      rangeInput: elements.strengthRangeInput,
      valueInput: elements.strengthValueInput,
      fallbackValue: strengthMin,
      getValue: () => currentLinearRgba[3],
      setValue: (nextValue) => {
        commitColor([currentLinearRgba[0], currentLinearRgba[1], currentLinearRgba[2], nextValue], elements.strengthValueInput || elements.strengthRangeInput);
      },
      sanitize: (value) => clampAlphaValue(value, currentLinearRgba[3], strengthMin, strengthMax),
      format: (value) => String(Number(value).toFixed(3)),
    });
  }

  syncSwatchPreview();
  syncDialogUi();

  controller = {
    setMixed(nextMixed) {
      isMixed = Boolean(nextMixed);
      syncSwatchPreview();
    },
    setColorSpaceMode(mode) {
      colorSpaceMode = mode;
      syncDialogUi();
    },
    setChannelMode(mode) {
      channelMode = mode;
      syncDialogUi();
    },
    isOpen() {
      return isOpen;
    },
    applyRgbInputs,
    applyHsvInputs,
    applyTemperatureInputs,
    applyAlphaInput,
    applyValueSlider,
    applyHexInput,
    updateFromWheelPosition,
    pickColorFromEyeDropper,
    closeDialog,
    refresh() {
      currentLinearRgba = normalizeLinearRgbaWithAlphaBounds(state[propertyName], currentLinearRgba, strengthMin, strengthMax);
      if (!allowAlpha) {
        currentLinearRgba[3] = 1.0;
      }
      if (channelMode !== 'temperature') {
        currentColorTemperature = estimateColorTemperatureFromLinearRgb(currentLinearRgba);
      }
      syncSwatchPreview();
      if (isOpen) {
        syncDialogUi();
      }
    },
    open: openDialog,
    close: closeDialog,
  };

  return controller;
}
