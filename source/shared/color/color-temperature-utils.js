const COLOR_TEMPERATURE_NEUTRAL_KELVIN = 6500;
const COLOR_TEMPERATURE_MIN_KELVIN = 1000;
const COLOR_TEMPERATURE_MAX_KELVIN = 40000;

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
 * 指定 Kelvin 値に対応する raw RGB を計算します。
 * @param {number} temperature - 色温度 (K)。
 * @returns {number[]} RGB 値。
 */
function computeRawColorTemperature(temperature) {
  const kelvin = temperature / 100.0;
  let red;
  let green;
  let blue;

  if (kelvin <= 66.0) {
    red = 255.0;
    green = 99.4708025861 * Math.log(kelvin) - 161.1195681661;
    blue = kelvin <= 19.0 ? 0.0 : 138.5177312231 * Math.log(kelvin - 10.0) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(kelvin - 60.0, -0.1332047592);
    green = 288.1221695283 * Math.pow(kelvin - 60.0, -0.0755148492);
    blue = 255.0;
  }

  return [
    clampNumber(red, 0.0, 255.0, 255.0),
    clampNumber(green, 0.0, 255.0, 255.0),
    clampNumber(blue, 0.0, 255.0, 255.0),
  ];
}

const COLOR_TEMPERATURE_NEUTRAL_RAW = computeRawColorTemperature(COLOR_TEMPERATURE_NEUTRAL_KELVIN);

/**
 * Kelvin 値から色温度補正係数を計算します。
 * @param {number} temperature - 色温度 (K)。
 * @returns {Float32Array} RGB 補正係数。
 */
export function createColorTemperatureScale(temperature) {
  const kelvin = clampNumber(
    temperature,
    COLOR_TEMPERATURE_MIN_KELVIN,
    COLOR_TEMPERATURE_MAX_KELVIN,
    COLOR_TEMPERATURE_NEUTRAL_KELVIN,
  );
  const raw = computeRawColorTemperature(kelvin);
  return new Float32Array([
    raw[0] / COLOR_TEMPERATURE_NEUTRAL_RAW[0],
    raw[1] / COLOR_TEMPERATURE_NEUTRAL_RAW[1],
    raw[2] / COLOR_TEMPERATURE_NEUTRAL_RAW[2],
  ]);
}

/**
 * 線形 RGB を白色点推定用に正規化します。
 * @param {ArrayLike<number>|null} color - 入力 RGB。
 * @param {number[]} [fallback=[0, 0, 0]] - 失敗時の既定値。
 * @returns {number[]} 正規化された RGB。
 */
function normalizeLinearRgb(color, fallback = [0, 0, 0]) {
  return [
    Math.max(0.0, Number.isFinite(color?.[0]) ? color[0] : fallback[0]),
    Math.max(0.0, Number.isFinite(color?.[1]) ? color[1] : fallback[1]),
    Math.max(0.0, Number.isFinite(color?.[2]) ? color[2] : fallback[2]),
  ];
}

/**
 * 指定した線形 RGB が最も中立に近づく Kelvin 値を推定します。
 * @param {ArrayLike<number>|null} color - 線形 RGB。
 * @returns {number} 推定された色温度 (K)。
 */
export function estimateColorTemperatureFromLinearRgb(color) {
  const linearRgb = normalizeLinearRgb(color);
  const brightness = (linearRgb[0] + linearRgb[1] + linearRgb[2]) / 3.0;
  if (!Number.isFinite(brightness) || brightness <= 1e-6) {
    return COLOR_TEMPERATURE_NEUTRAL_KELVIN;
  }

  let bestTemperature = COLOR_TEMPERATURE_NEUTRAL_KELVIN;
  let bestError = Number.POSITIVE_INFINITY;
  for (let temperature = COLOR_TEMPERATURE_MIN_KELVIN; temperature <= COLOR_TEMPERATURE_MAX_KELVIN; temperature += 100) {
    const scale = createColorTemperatureScale(temperature);
    const correctedRed = linearRgb[0] * scale[0];
    const correctedGreen = linearRgb[1] * scale[1];
    const correctedBlue = linearRgb[2] * scale[2];
    const correctedAverage = (correctedRed + correctedGreen + correctedBlue) / 3.0;
    if (!Number.isFinite(correctedAverage) || correctedAverage <= 1e-6) {
      continue;
    }

    const normalizedRed = correctedRed / correctedAverage;
    const normalizedGreen = correctedGreen / correctedAverage;
    const normalizedBlue = correctedBlue / correctedAverage;
    const error = (
      (normalizedRed - 1.0) * (normalizedRed - 1.0)
      + (normalizedGreen - 1.0) * (normalizedGreen - 1.0)
      + (normalizedBlue - 1.0) * (normalizedBlue - 1.0)
    );
    if (error < bestError) {
      bestError = error;
      bestTemperature = temperature;
    }
  }

  return bestTemperature;
}

export {
  COLOR_TEMPERATURE_MAX_KELVIN,
  COLOR_TEMPERATURE_MIN_KELVIN,
  COLOR_TEMPERATURE_NEUTRAL_KELVIN,
};
