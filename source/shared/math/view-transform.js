export const VIEW_TRANSFORM_STANDARD = 'standard';
export const VIEW_TRANSFORM_ACES_20 = 'aces-2.0';
export const DISPLAY_COLOR_SPACE_SRGB = 'srgb';
export const DISPLAY_COLOR_SPACE_DISPLAY_P3 = 'display-p3';
export const ACES_LUT_SIZE = 65;

const LUT_SHAPER_EPSILON = 1e-5;
const LUT_VALUE_SCALE = 255;
const SRGB_TO_XYZ_D65 = Object.freeze([
  0.41239079926595934, 0.35758433938387796, 0.1804807884018343,
  0.21263900587151027, 0.7151686787677559, 0.07219231536073371,
  0.01933081871559185, 0.11919477979462599, 0.9505321522496607,
]);
const XYZ_D65_TO_DISPLAY_P3 = Object.freeze([
  2.493496911941425, -0.9313836179191239, -0.40271078445071684,
  -0.8294889695615747, 1.7626640603183463, 0.023624685841943577,
  0.03584583024378447, -0.07617238926804182, 0.9568845240076872,
]);
const ACES_INPUT_MAT = Object.freeze([
  0.59719, 0.35458, 0.04823,
  0.07600, 0.90834, 0.01566,
  0.02840, 0.13383, 0.83777,
]);
const ACES_OUTPUT_MAT = Object.freeze([
  1.60475, -0.53108, -0.07367,
  -0.10208, 1.10813, -0.00605,
  -0.00327, -0.07276, 1.07602,
]);

/**
 * View Transform 値を正規化します。
 * @param {string|undefined|null} value - 入力値。
 * @returns {'standard'|'aces-2.0'} 正規化済み値。
 */
export function normalizeViewTransform(value) {
  return String(value || VIEW_TRANSFORM_STANDARD).toLowerCase() === VIEW_TRANSFORM_ACES_20
    ? VIEW_TRANSFORM_ACES_20
    : VIEW_TRANSFORM_STANDARD;
}

/**
 * Display 色空間値を正規化します。
 * @param {string|undefined|null} value - 入力値。
 * @returns {'srgb'|'display-p3'} 正規化済み値。
 */
export function normalizeDisplayColorSpace(value) {
  return String(value || DISPLAY_COLOR_SPACE_SRGB).toLowerCase() === DISPLAY_COLOR_SPACE_DISPLAY_P3
    ? DISPLAY_COLOR_SPACE_DISPLAY_P3
    : DISPLAY_COLOR_SPACE_SRGB;
}

/**
 * WebGPU canvas configure 用 colorSpace を返します。
 * @param {string|undefined|null} value - 表示色空間。
 * @returns {'srgb'|'display-p3'} WebGPU 用 colorSpace。
 */
export function getGpuCanvasColorSpace(value) {
  return normalizeDisplayColorSpace(value);
}

/**
 * UI から shader uniform へ渡す view transform の数値表現を返します。
 * @param {string|undefined|null} value - view transform。
 * @returns {number} uniform 値。
 */
export function getViewTransformModeValue(value) {
  return normalizeViewTransform(value) === VIEW_TRANSFORM_ACES_20 ? 1.0 : 0.0;
}

/**
 * UI から shader uniform へ渡す display 色空間の数値表現を返します。
 * @param {string|undefined|null} value - display 色空間。
 * @returns {number} uniform 値。
 */
export function getDisplayColorSpaceModeValue(value) {
  return normalizeDisplayColorSpace(value) === DISPLAY_COLOR_SPACE_DISPLAY_P3 ? 1.0 : 0.0;
}

/**
 * ACES 風 LUT データを生成します。
 * @param {number} size - LUT 辺長。
 * @param {string} displayColorSpace - 出力 display 色空間。
 * @returns {Uint8Array} rgba8unorm 用 LUT データ。
 */
export function createAcesLutData(size = ACES_LUT_SIZE, displayColorSpace = DISPLAY_COLOR_SPACE_SRGB) {
  const lutSize = Math.max(2, Math.round(size || ACES_LUT_SIZE));
  const gamut = normalizeDisplayColorSpace(displayColorSpace);
  const data = new Uint8Array(lutSize * lutSize * lutSize * 4);
  let offset = 0;

  for (let blue = 0; blue < lutSize; blue++) {
    for (let green = 0; green < lutSize; green++) {
      for (let red = 0; red < lutSize; red++) {
        const linearColor = [
          lutCoordToLinear(red / (lutSize - 1)),
          lutCoordToLinear(green / (lutSize - 1)),
          lutCoordToLinear(blue / (lutSize - 1)),
        ];
        let mappedColor = applyAcesApproximation(linearColor);
        if (gamut === DISPLAY_COLOR_SPACE_DISPLAY_P3) {
          mappedColor = convertLinearSrgbToDisplayP3(mappedColor);
        }
        const encoded = mappedColor.map(encodeSrgbLike);
        data[offset++] = floatToUnorm8(encoded[0]);
        data[offset++] = floatToUnorm8(encoded[1]);
        data[offset++] = floatToUnorm8(encoded[2]);
        data[offset++] = LUT_VALUE_SCALE;
      }
    }
  }

  return data;
}

/**
 * scene-linear sRGB を Display P3 linear へ変換します。
 * @param {ArrayLike<number>} color - 入力色。
 * @returns {number[]} 変換後の色。
 */
export function convertLinearSrgbToDisplayP3(color) {
  const xyz = multiplyMatrix3Vec3(SRGB_TO_XYZ_D65, color);
  return multiplyMatrix3Vec3(XYZ_D65_TO_DISPLAY_P3, xyz);
}

/**
 * sRGB/Display-P3 共通の OETF でエンコードします。
 * @param {number} value - linear 値。
 * @returns {number} encode 後の値。
 */
export function encodeSrgbLike(value) {
  const linear = clamp01(value);
  if (linear <= 0.0031308) {
    return linear * 12.92;
  }
  return 1.055 * Math.pow(linear, 1.0 / 2.4) - 0.055;
}

/**
 * LUT shaper 用に HDR linear 値を [0, 1] へ圧縮します。
 * @param {number} value - linear 値。
 * @returns {number} LUT 座標。
 */
export function linearToLutCoord(value) {
  const linear = Math.max(0.0, Number(value) || 0.0);
  return linear / (1.0 + linear);
}

/**
 * LUT 座標から shaper を逆変換して linear 値へ戻します。
 * @param {number} value - LUT 座標。
 * @returns {number} linear 値。
 */
export function lutCoordToLinear(value) {
  const coord = Math.min(1.0 - LUT_SHAPER_EPSILON, Math.max(0.0, Number(value) || 0.0));
  return coord / Math.max(LUT_SHAPER_EPSILON, 1.0 - coord);
}

/**
 * ACES 風トーンマップを適用します。
 * @param {ArrayLike<number>} color - scene-linear sRGB。
 * @returns {number[]} tone map 後の linear sRGB。
 */
export function applyAcesApproximation(color) {
  const acesColor = multiplyMatrix3Vec3(ACES_INPUT_MAT, color);
  const fitted = [
    rrtAndOdtFit(acesColor[0]),
    rrtAndOdtFit(acesColor[1]),
    rrtAndOdtFit(acesColor[2]),
  ];
  const mapped = multiplyMatrix3Vec3(ACES_OUTPUT_MAT, fitted);
  return [
    clamp01(mapped[0]),
    clamp01(mapped[1]),
    clamp01(mapped[2]),
  ];
}

/**
 * 0..1 浮動小数を rgba8unorm 用へ変換します。
 * @param {number} value - 入力値。
 * @returns {number} 8-bit unorm 値。
 */
export function floatToUnorm8(value) {
  return Math.round(clamp01(value) * LUT_VALUE_SCALE);
}

/**
 * 3x3 行列と vec3 を乗算します。
 * @param {ArrayLike<number>} matrix - 行列。
 * @param {ArrayLike<number>} vector - ベクトル。
 * @returns {number[]} 乗算結果。
 */
function multiplyMatrix3Vec3(matrix, vector) {
  return [
    matrix[0] * (vector[0] ?? 0.0) + matrix[1] * (vector[1] ?? 0.0) + matrix[2] * (vector[2] ?? 0.0),
    matrix[3] * (vector[0] ?? 0.0) + matrix[4] * (vector[1] ?? 0.0) + matrix[5] * (vector[2] ?? 0.0),
    matrix[6] * (vector[0] ?? 0.0) + matrix[7] * (vector[1] ?? 0.0) + matrix[8] * (vector[2] ?? 0.0),
  ];
}

/**
 * ACES fitted curve を 1 チャンネルへ適用します。
 * @param {number} value - 入力値。
 * @returns {number} 出力値。
 */
function rrtAndOdtFit(value) {
  const numerator = value * (value + 0.0245786) - 0.000090537;
  const denominator = value * (0.983729 * value + 0.4329510) + 0.238081;
  return numerator / Math.max(LUT_SHAPER_EPSILON, denominator);
}

/**
 * 値を 0..1 に収めます。
 * @param {number} value - 入力値。
 * @returns {number} clamp 後の値。
 */
function clamp01(value) {
  return Math.min(1.0, Math.max(0.0, Number(value) || 0.0));
}
