const DISPLAY_PRESET_COOKIE_NAME = 'openmmd-display-preset';
const DISPLAY_PRESET_SDR = 'sdr';
const DISPLAY_PRESET_HDR = 'hdr';
const DISPLAY_PRESET_VALUES = Object.freeze({
  [DISPLAY_PRESET_SDR]: Object.freeze({
    viewTransform: 'standard',
    shaderName: 'mmd-shader.wgsl',
    gamma: 1.0,
    gltfLightStrength: 1.0,
    shadowPower: 1.0,
    environmentHdrIntensity: 0.0,
  }),
  [DISPLAY_PRESET_HDR]: Object.freeze({
    viewTransform: 'aces-2.0',
    shaderName: 'mtoon-shader.wgsl',
    gamma: 0.2,
    gltfLightStrength: 4.0,
    shadowPower: 1.5,
    environmentHdrIntensity: 1.0,
  }),
});

/**
 * 表示プリセット値を正規化します。
 * @param {string|undefined|null} value - 入力値。
 * @returns {'sdr'|'hdr'} 正規化済み値。
 */
export function normalizeDisplayPreset(value) {
  return String(value || DISPLAY_PRESET_SDR).trim().toLowerCase() === DISPLAY_PRESET_HDR
    ? DISPLAY_PRESET_HDR
    : DISPLAY_PRESET_SDR;
}

/**
 * 表示プリセットの基本値を返します。
 * @param {string|undefined|null} value - 入力値。
 * @returns {{viewTransform: 'standard'|'aces-2.0', shaderName: string, gamma: number, gltfLightStrength: number, shadowPower: number, environmentHdrIntensity: number}} プリセット値。
 */
export function getDisplayPresetValues(value) {
  return DISPLAY_PRESET_VALUES[normalizeDisplayPreset(value)];
}

/**
 * 現在値を考慮してプリセット適用後の値を返します。
 * @param {string|undefined|null} value - 入力値。
 * @param {{gltfLightStrength?: number, shadowPower?: number, environmentHdrIntensity?: number}} [currentValues={}] - 現在値。
 * @returns {{preset: 'sdr'|'hdr', viewTransform: 'standard'|'aces-2.0', shaderName: string, gamma: number, gltfLightStrength: number, shadowPower: number, environmentHdrIntensity: number}} 適用結果。
 */
export function getAppliedDisplayPresetValues(value, currentValues = {}) {
  const preset = normalizeDisplayPreset(value);
  const baseValues = DISPLAY_PRESET_VALUES[preset];
  const currentGltfLightStrength = Number(currentValues.gltfLightStrength);
  const currentShadowPower = Number(currentValues.shadowPower);
  const currentEnvironmentHdrIntensity = Number(currentValues.environmentHdrIntensity);
  const gltfLightStrength = preset === DISPLAY_PRESET_HDR
    ? (Number.isFinite(currentGltfLightStrength) && currentGltfLightStrength > 1.0
      ? currentGltfLightStrength
      : baseValues.gltfLightStrength)
    : baseValues.gltfLightStrength;
  const shadowPower = preset === DISPLAY_PRESET_HDR
    ? (Number.isFinite(currentShadowPower) && currentShadowPower > 1.0
      ? currentShadowPower
      : baseValues.shadowPower)
    : baseValues.shadowPower;
  const environmentHdrIntensity = preset === DISPLAY_PRESET_HDR
    ? (Number.isFinite(currentEnvironmentHdrIntensity) && currentEnvironmentHdrIntensity > 0.0
      ? currentEnvironmentHdrIntensity
      : baseValues.environmentHdrIntensity)
    : baseValues.environmentHdrIntensity;

  return {
    preset,
    viewTransform: baseValues.viewTransform,
    shaderName: baseValues.shaderName,
    gamma: baseValues.gamma,
    gltfLightStrength,
    shadowPower,
    environmentHdrIntensity,
  };
}

/**
 * UI 設定 JSON で使用するプリセット値を返します。
 * @param {string|undefined|null} value - 入力値。
 * @returns {object} UI 設定データ。
 */
export function createDisplayPresetUiSettings(value) {
  const preset = normalizeDisplayPreset(value);
  const appliedValues = getAppliedDisplayPresetValues(preset);
  return {
    type: 'ui',
    'display-preset-selector': preset,
    'view-transform-selector': appliedValues.viewTransform,
    gamma: appliedValues.gamma,
    'light-color-strength-range': appliedValues.gltfLightStrength,
    'shadow-power': appliedValues.shadowPower,
  };
}

/**
 * Cookie 文字列から値を取り出します。
 * @param {string} cookieText - cookie 文字列。
 * @param {string} name - cookie 名。
 * @returns {string|null} 値。
 */
export function readCookieValue(cookieText, name) {
  const targetName = String(name || '').trim();
  if (!targetName) {
    return null;
  }

  const pairs = String(cookieText || '').split(';');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    if (key !== targetName) {
      continue;
    }

    const rawValue = pair.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch (error) {
      return rawValue;
    }
  }

  return null;
}

/**
 * Cookie を書き込みます。
 * @param {Document|null} doc - 書き込み先 document。
 * @param {string} name - cookie 名。
 * @param {string} value - cookie 値。
 * @param {{maxAge?: number, path?: string, sameSite?: 'Lax'|'Strict'|'None'}} [options={}] - cookie オプション。
 * @returns {string} 書き込み文字列。
 */
export function writeCookieValue(doc, name, value, options = {}) {
  const targetDocument = doc || globalThis.document || null;
  const cookieName = String(name || '').trim();
  if (!targetDocument || !cookieName) {
    return '';
  }

  const cookieParts = [
    `${cookieName}=${encodeURIComponent(String(value ?? ''))}`,
    `Path=${options.path || '/'}`,
  ];
  if (Number.isFinite(options.maxAge)) {
    cookieParts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.sameSite) {
    cookieParts.push(`SameSite=${options.sameSite}`);
  }

  const cookieText = cookieParts.join('; ');
  targetDocument.cookie = cookieText;
  return cookieText;
}

/**
 * 表示プリセット cookie を読み取ります。
 * @param {Document|null} [doc=globalThis.document] - document。
 * @returns {'sdr'|'hdr'} 読み取ったプリセット。
 */
export function readDisplayPresetCookie(doc = globalThis.document || null) {
  const cookieText = doc?.cookie || '';
  return normalizeDisplayPreset(readCookieValue(cookieText, DISPLAY_PRESET_COOKIE_NAME));
}

/**
 * 表示プリセット cookie を保存します。
 * @param {Document|null} [doc=globalThis.document] - document。
 * @param {string} value - 保存するプリセット。
 * @returns {string} cookie 書き込み文字列。
 */
export function writeDisplayPresetCookie(doc = globalThis.document || null, value) {
  return writeCookieValue(doc, DISPLAY_PRESET_COOKIE_NAME, normalizeDisplayPreset(value), {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'Lax',
  });
}
