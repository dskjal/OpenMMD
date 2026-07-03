/**
 * 値を指定範囲に収めます。
 * @param {number} value - 入力値。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @param {number} fallback - 非数時の既定値。
 * @returns {number} 収めた値。
 */
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * 値を 0..1 に収めます。
 * @param {number} value - 入力値。
 * @param {number} [fallback=0] - 非数時の既定値。
 * @returns {number} 収めた値。
 */
export function clamp01(value, fallback = 0) {
  return clampNumber(value, 0.0, 1.0, fallback);
}

/**
 * 線形色を UI 表示向けの sRGB へ変換します。
 * @param {number} value - 線形値。
 * @returns {number} sRGB 値。
 */
export function linearToPerceptualChannel(value) {
  const linear = clamp01(value, 0.0);
  if (linear <= 0.0031308) {
    return 12.92 * linear;
  }
  return 1.055 * Math.pow(linear, 1.0 / 2.4) - 0.055;
}

/**
 * UI 表示向けの sRGB を線形色へ変換します。
 * @param {number} value - sRGB 値。
 * @returns {number} 線形値。
 */
export function perceptualToLinearChannel(value) {
  const srgb = clamp01(value, 0.0);
  if (srgb <= 0.04045) {
    return srgb / 12.92;
  }
  return Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/**
 * 3 成分を複製します。
 * @param {ArrayLike<number>|null} color - 入力配列。
 * @param {number[]} fallback - 既定値。
 * @returns {number[]} 3 成分配列。
 */
function cloneRgb(color, fallback) {
  return [
    clamp01(color?.[0], fallback[0]),
    clamp01(color?.[1], fallback[1]),
    clamp01(color?.[2], fallback[2]),
  ];
}

/**
 * 4 成分の線形 RGBA を正規化します。
 * @param {ArrayLike<number>|null} color - 入力配列。
 * @param {number[]} [fallback=[0, 0, 0, 1]] - 既定値。
 * @returns {number[]} 正規化された線形 RGBA。
 */
export function normalizeLinearRgba(color, fallback = [0, 0, 0, 1]) {
  return [
    clamp01(color?.[0], fallback[0]),
    clamp01(color?.[1], fallback[1]),
    clamp01(color?.[2], fallback[2]),
    clamp01(color?.[3], fallback[3]),
  ];
}

/**
 * 線形 RGB を UI 表示向け RGB に変換します。
 * @param {ArrayLike<number>|null} color - 線形 RGB。
 * @returns {number[]} sRGB。
 */
export function linearRgbToPerceptualRgb(color) {
  const rgb = cloneRgb(color, [0, 0, 0]);
  return rgb.map((value) => linearToPerceptualChannel(value));
}

/**
 * UI 表示向け RGB を線形 RGB に変換します。
 * @param {ArrayLike<number>|null} color - sRGB。
 * @returns {number[]} 線形 RGB。
 */
export function perceptualRgbToLinearRgb(color) {
  const rgb = cloneRgb(color, [0, 0, 0]);
  return rgb.map((value) => perceptualToLinearChannel(value));
}

/**
 * 線形 RGBA を UI 表示向け RGBA に変換します。
 * @param {ArrayLike<number>|null} color - 線形 RGBA。
 * @returns {number[]} sRGBA。
 */
export function linearRgbaToPerceptualRgba(color) {
  const rgba = normalizeLinearRgba(color);
  return [
    linearToPerceptualChannel(rgba[0]),
    linearToPerceptualChannel(rgba[1]),
    linearToPerceptualChannel(rgba[2]),
    rgba[3],
  ];
}

/**
 * UI 表示向け RGBA を線形 RGBA に変換します。
 * @param {ArrayLike<number>|null} color - sRGBA。
 * @returns {number[]} 線形 RGBA。
 */
export function perceptualRgbaToLinearRgba(color) {
  const rgba = normalizeLinearRgba(color);
  return [
    perceptualToLinearChannel(rgba[0]),
    perceptualToLinearChannel(rgba[1]),
    perceptualToLinearChannel(rgba[2]),
    rgba[3],
  ];
}

/**
 * RGB から HSV を計算します。
 * @param {ArrayLike<number>|null} color - RGB。
 * @returns {number[]} HSV。Hue は 0..360。
 */
export function rgbToHsv(color) {
  const rgb = cloneRgb(color, [0, 0, 0]);
  const red = rgb[0];
  const green = rgb[1];
  const blue = rgb[2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * (((blue - red) / delta) + 2);
    } else {
      hue = 60 * (((red - green) / delta) + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }
  const saturation = max <= 0 ? 0 : delta / max;
  return [hue, saturation, max];
}

/**
 * HSV から RGB を計算します。
 * @param {ArrayLike<number>|null} color - HSV。Hue は 0..360。
 * @returns {number[]} RGB。
 */
export function hsvToRgb(color) {
  const hue = Number.isFinite(color?.[0]) ? color[0] : 0.0;
  const saturation = clamp01(color?.[1], 0.0);
  const value = clamp01(color?.[2], 0.0);
  const chroma = value * saturation;
  const huePrime = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  const match = value - chroma;
  return [red + match, green + match, blue + match];
}

/**
 * 線形 RGBA を HSV へ変換します。
 * @param {ArrayLike<number>|null} color - 線形 RGBA。
 * @returns {number[]} HSVA。
 */
export function linearRgbaToHsv(color) {
  const rgba = normalizeLinearRgba(color);
  const rgb = linearRgbToPerceptualRgb(rgba);
  const hsv = rgbToHsv(rgb);
  return [hsv[0], hsv[1], hsv[2], rgba[3]];
}

/**
 * HSVA を線形 RGBA へ変換します。
 * @param {ArrayLike<number>|null} color - HSVA。Hue は 0..360。
 * @returns {number[]} 線形 RGBA。
 */
export function hsvToLinearRgba(color) {
  const hsv = [
    Number.isFinite(color?.[0]) ? color[0] : 0.0,
    clamp01(color?.[1], 0.0),
    clamp01(color?.[2], 0.0),
    clamp01(color?.[3], 1.0),
  ];
  const rgb = hsvToRgb(hsv);
  const linearRgb = perceptualRgbToLinearRgb(rgb);
  return [linearRgb[0], linearRgb[1], linearRgb[2], hsv[3]];
}

/**
 * 16 進カラー文字列を正規化します。
 * @param {string} value - 文字列。
 * @returns {string} 正規化結果。
 */
function normalizeHexString(value) {
  return String(value || '').trim().replace(/^#/, '').toLowerCase();
}

/**
 * 16 進文字列を 0..1 に変換します。
 * @param {string} value - 2 文字の 16 進数。
 * @returns {number} 変換値。
 */
function parseHexByte(value) {
  return Number.parseInt(value, 16) / 255;
}

/**
 * 16 進カラー文字列を sRGBA へ変換します。
 * @param {string} value - 16 進カラー文字列。
 * @param {number[]} [fallback=[0, 0, 0, 1]] - 変換失敗時の既定値。
 * @returns {number[]} sRGBA。
 */
export function hexToPerceptualRgba(value, fallback = [0, 0, 0, 1]) {
  const normalized = normalizeHexString(value);
  if (normalized.length === 3 || normalized.length === 4) {
    const red = parseHexByte(normalized[0] + normalized[0]);
    const green = parseHexByte(normalized[1] + normalized[1]);
    const blue = parseHexByte(normalized[2] + normalized[2]);
    const alpha = normalized.length === 4 ? parseHexByte(normalized[3] + normalized[3]) : 1.0;
    return [red, green, blue, alpha];
  }

  if (normalized.length === 6 || normalized.length === 8) {
    const red = parseHexByte(normalized.slice(0, 2));
    const green = parseHexByte(normalized.slice(2, 4));
    const blue = parseHexByte(normalized.slice(4, 6));
    const alpha = normalized.length === 8 ? parseHexByte(normalized.slice(6, 8)) : 1.0;
    return [red, green, blue, alpha];
  }

  return normalizeLinearRgba(fallback);
}

/**
 * 16 進カラー文字列を線形 RGBA へ変換します。
 * @param {string} value - 16 進カラー文字列。
 * @param {number[]} [fallback=[0, 0, 0, 1]] - 変換失敗時の既定値。
 * @returns {number[]} 線形 RGBA。
 */
export function hexToLinearRgba(value, fallback = [0, 0, 0, 1]) {
  return perceptualRgbaToLinearRgba(hexToPerceptualRgba(value, fallback));
}

/**
 * 線形 RGBA を 16 進カラー文字列へ変換します。
 * @param {ArrayLike<number>|null} color - 線形 RGBA。
 * @returns {string} 16 進カラー文字列。
 */
export function linearRgbaToHex(color) {
  const rgba = linearRgbaToPerceptualRgba(color);
  const toHex = (value) => Math.round(clamp01(value, 0.0) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`;
}

