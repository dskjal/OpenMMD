/**
 * HDR 環境光強度の上限値を解決します。
 *
 * @param {object|number|null|undefined} appStateOrMax - appState の既定値、または上限値。
 * @returns {number} 強度上限値。
 */
export function getEnvironmentHdrIntensityMax(appStateOrMax) {
  if (Number.isFinite(Number(appStateOrMax))) {
    return Math.max(0, Number(appStateOrMax));
  }

  const dynamicRange = Number(appStateOrMax?.dynamicRange);
  return Number.isFinite(dynamicRange) && dynamicRange >= 0 ? dynamicRange : 10.0;
}

/**
 * HDR 環境光強度を上限内へクランプします。
 *
 * @param {number} value - 入力値。
 * @param {object|number|null|undefined} appStateOrMax - appState の既定値、または上限値。
 * @returns {number} クランプ後の値。
 */
export function clampEnvironmentHdrIntensity(value, appStateOrMax) {
  const parsedValue = Number(value);
  const max = getEnvironmentHdrIntensityMax(appStateOrMax);

  if (!Number.isFinite(parsedValue)) {
    return 1.0;
  }

  return Math.min(max, Math.max(0.0, parsedValue));
}

/**
 * HDR 環境光強度入力の max 属性を同期します。
 *
 * @param {HTMLInputElement|null} rangeInput - range 入力。
 * @param {HTMLInputElement|null} valueInput - number 入力。
 * @param {number} max - 上限値。
 * @returns {void}
 */
export function syncEnvironmentHdrIntensityInputBounds(rangeInput, valueInput, max) {
  const maxString = String(max);
  if (rangeInput) {
    rangeInput.max = maxString;
  }
  if (valueInput) {
    valueInput.max = maxString;
  }
}
