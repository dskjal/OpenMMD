/**
 * 被写界深度の物理寄り計算ヘルパーです。
 * OpenMMD のワールド単位は glTF と揃えた実寸スケールとして扱い、焦点距離と CoC を求めます。
 */

export const DOF_WORLD_UNITS_PER_METER = 1;
export const DOF_SENSOR_HEIGHT_MM = 24;
export const DOF_DEFAULT_FOV_Y = 45 * Math.PI / 180;
export const DOF_DEFAULT_NEAR_PLANE = 0.1;
export const DOF_DEFAULT_FAR_PLANE = 1000.0;
export const DOF_ALGORITHM_OPTIONS = Object.freeze({
  FAST: 'fast',
  DEPTH_AWARE_GATHER: 'depth-aware-gather',
  THIN_LENS_MULTISAMPLE: 'thin-lens-multisample',
});
export const DOF_DEFAULT_ALGORITHM = DOF_ALGORITHM_OPTIONS.FAST;
export const DOF_ALGORITHM_IDS = Object.freeze({
  [DOF_ALGORITHM_OPTIONS.FAST]: 0,
  [DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER]: 1,
  [DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE]: 2,
});
export const DOF_UNIFORM_FLOAT_COUNT = 16;
export const DOF_UNIFORM_OFFSETS = {
  focusDistanceWorld: 0,
  sceneScale: 1,
  focalLengthMm: 2,
  fStop: 3,
  blurAmount: 4,
  nearPlane: 5,
  farPlane: 6,
  sensorToPixelScale: 7,
  algorithm: 8,
  sampleCount: 9,
  maxBlurRadius: 10,
  cocBlendScale: 11,
};

const DOF_ALGORITHM_CONFIGS = Object.freeze({
  [DOF_ALGORITHM_OPTIONS.FAST]: Object.freeze({
    id: DOF_ALGORITHM_IDS[DOF_ALGORITHM_OPTIONS.FAST],
    sampleCount: 16,
    maxBlurRadius: 48,
    cocBlendScale: 4,
  }),
  [DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER]: Object.freeze({
    id: DOF_ALGORITHM_IDS[DOF_ALGORITHM_OPTIONS.DEPTH_AWARE_GATHER],
    sampleCount: 24,
    maxBlurRadius: 56,
    cocBlendScale: 3,
  }),
  [DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE]: Object.freeze({
    id: DOF_ALGORITHM_IDS[DOF_ALGORITHM_OPTIONS.THIN_LENS_MULTISAMPLE],
    sampleCount: 32,
    maxBlurRadius: 64,
    cocBlendScale: 2.5,
  }),
});

/**
 * 入力値を有限値で返します。
 * @param {number} value - 入力値。
 * @param {number} fallback - 無効値のときに返す値。
 * @returns {number} 有限値。
 */
function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 値を範囲内に丸めます。
 * @param {number} value - 入力値。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @returns {number} 丸め後の値。
 */
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * DOF アルゴリズム名を正規化します。
 * @param {string} value - 入力値。
 * @returns {string} 正規化されたアルゴリズム名。
 */
export function normalizeDofAlgorithm(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DOF_ALGORITHM_CONFIGS[normalized] ? normalized : DOF_DEFAULT_ALGORITHM;
}

/**
 * DOF アルゴリズムごとの GPU 設定を返します。
 * @param {string} algorithm - アルゴリズム名。
 * @returns {{id: number, sampleCount: number, maxBlurRadius: number, cocBlendScale: number}} GPU 設定。
 */
export function getDofAlgorithmConfig(algorithm) {
  const normalized = normalizeDofAlgorithm(algorithm);
  return DOF_ALGORITHM_CONFIGS[normalized];
}

/**
 * 画角から焦点距離を求めます。
 * @param {number} fovY - 縦 FOV (ラジアン)。
 * @param {number} [sensorHeightMm=DOF_SENSOR_HEIGHT_MM] - センサー高さ (mm)。
 * @returns {number} 焦点距離 (mm)。
 */
export function computeDofFocalLengthMm(fovY, sensorHeightMm = DOF_SENSOR_HEIGHT_MM) {
  const safeFovY = clampNumber(toFiniteNumber(fovY, DOF_DEFAULT_FOV_Y), 0.0001, Math.PI - 0.0001);
  const safeSensorHeightMm = Math.max(0.0001, toFiniteNumber(sensorHeightMm, DOF_SENSOR_HEIGHT_MM));
  return safeSensorHeightMm / (2 * Math.tan(safeFovY * 0.5));
}

/**
 * センサー高さを画面ピクセルへ換算する係数を求めます。
 * @param {number} canvasHeight - 画面高さ (px)。
 * @param {number} [sensorHeightMm=DOF_SENSOR_HEIGHT_MM] - センサー高さ (mm)。
 * @returns {number} センサー 1 mm あたりのピクセル数。
 */
export function computeDofSensorToPixelScale(canvasHeight, sensorHeightMm = DOF_SENSOR_HEIGHT_MM) {
  const safeCanvasHeight = Math.max(1, toFiniteNumber(canvasHeight, 1));
  const safeSensorHeightMm = Math.max(0.0001, toFiniteNumber(sensorHeightMm, DOF_SENSOR_HEIGHT_MM));
  return (safeCanvasHeight * 1000.0) / safeSensorHeightMm;
}

/**
 * 物理式ベースの circle of confusion を画面ピクセル単位で求めます。
 * @param {object} options - 計算オプション。
 * @param {number} options.focusDistanceWorld - 焦点距離のワールド単位値。
 * @param {number} options.depthWorld - 対象深度のワールド単位値。
 * @param {number} [options.sceneScale=DOF_WORLD_UNITS_PER_METER] - 1 m あたりのワールド単位。
 * @param {number} [options.fovY=DOF_DEFAULT_FOV_Y] - 縦 FOV (ラジアン)。
 * @param {number} [options.canvasHeight=1] - 画面高さ (px)。
 * @param {number} [options.sensorHeightMm=DOF_SENSOR_HEIGHT_MM] - センサー高さ (mm)。
 * @param {number} [options.fStop=2.8] - F 値。
 * @param {number} [options.blurAmount=1.0] - 演出用の倍率。
 * @returns {number} CoC の見かけ半径 (px)。
 */
export function computeDofCircleOfConfusionPixels(options = {}) {
  const sceneScale = Math.max(0.0001, toFiniteNumber(options.sceneScale, DOF_WORLD_UNITS_PER_METER));
  const sensorHeightMm = Math.max(0.0001, toFiniteNumber(options.sensorHeightMm, DOF_SENSOR_HEIGHT_MM));
  const focalLengthMm = computeDofFocalLengthMm(options.fovY, sensorHeightMm);
  const focalLengthMeters = focalLengthMm / 1000.0;
  const focusDistanceMeters = Math.max(0.0001, toFiniteNumber(options.focusDistanceWorld, 0.0001) / sceneScale);
  const depthMeters = Math.max(0.0001, toFiniteNumber(options.depthWorld, 0.0001) / sceneScale);
  const fStop = Math.max(0.1, toFiniteNumber(options.fStop, 2.8));
  const blurAmount = Math.max(0.0, toFiniteNumber(options.blurAmount, 1.0));
  const numerator = focalLengthMeters * focalLengthMeters * Math.abs(depthMeters - focusDistanceMeters);
  const denominator = Math.max(
    0.000001,
    fStop * depthMeters * Math.max(0.000001, focusDistanceMeters - focalLengthMeters),
  );
  const cocMeters = numerator / denominator;
  return cocMeters * computeDofSensorToPixelScale(options.canvasHeight, sensorHeightMm) * blurAmount;
}

/**
 * DOF 用の uniform 配列を作成します。
 * @param {object} options - 計算オプション。
 * @param {number} options.focusDistanceWorld - 焦点距離のワールド単位値。
 * @param {number} [options.sceneScale=DOF_WORLD_UNITS_PER_METER] - 1 m あたりのワールド単位。
 * @param {number} [options.fovY=DOF_DEFAULT_FOV_Y] - 縦 FOV (ラジアン)。
 * @param {number} [options.canvasHeight=1] - 画面高さ (px)。
 * @param {number} [options.sensorHeightMm=DOF_SENSOR_HEIGHT_MM] - センサー高さ (mm)。
 * @param {number} [options.fStop=2.8] - F 値。
 * @param {number} [options.blurAmount=1.0] - 演出用の倍率。
 * @param {number} [options.nearPlane=DOF_DEFAULT_NEAR_PLANE] - 近クリップ。
 * @param {number} [options.farPlane=DOF_DEFAULT_FAR_PLANE] - 遠クリップ。
 * @param {Float32Array} [out=new Float32Array(DOF_UNIFORM_FLOAT_COUNT)] - 出力先。
 * @returns {Float32Array} DOF uniform 配列。
 */
export function createDofUniformData(options = {}, out = new Float32Array(DOF_UNIFORM_FLOAT_COUNT)) {
  const focusDistanceWorld = toFiniteNumber(options.focusDistanceWorld, 1.0);
  const sceneScale = Math.max(0.0001, toFiniteNumber(options.sceneScale, DOF_WORLD_UNITS_PER_METER));
  const sensorHeightMm = Math.max(0.0001, toFiniteNumber(options.sensorHeightMm, DOF_SENSOR_HEIGHT_MM));
  const focalLengthMm = computeDofFocalLengthMm(options.fovY, sensorHeightMm);
  const algorithmConfig = getDofAlgorithmConfig(options.dofAlgorithm);
  out[DOF_UNIFORM_OFFSETS.focusDistanceWorld] = focusDistanceWorld;
  out[DOF_UNIFORM_OFFSETS.sceneScale] = sceneScale;
  out[DOF_UNIFORM_OFFSETS.focalLengthMm] = focalLengthMm;
  out[DOF_UNIFORM_OFFSETS.fStop] = Math.max(0.1, toFiniteNumber(options.fStop, 2.8));
  out[DOF_UNIFORM_OFFSETS.blurAmount] = Math.max(0.0, toFiniteNumber(options.blurAmount, 1.0));
  out[DOF_UNIFORM_OFFSETS.nearPlane] = Math.max(0.0001, toFiniteNumber(options.nearPlane, DOF_DEFAULT_NEAR_PLANE));
  out[DOF_UNIFORM_OFFSETS.farPlane] = Math.max(
    out[DOF_UNIFORM_OFFSETS.nearPlane] + 0.0001,
    toFiniteNumber(options.farPlane, DOF_DEFAULT_FAR_PLANE),
  );
  out[DOF_UNIFORM_OFFSETS.sensorToPixelScale] = computeDofSensorToPixelScale(options.canvasHeight, sensorHeightMm);
  out[DOF_UNIFORM_OFFSETS.algorithm] = algorithmConfig.id;
  out[DOF_UNIFORM_OFFSETS.sampleCount] = algorithmConfig.sampleCount;
  out[DOF_UNIFORM_OFFSETS.maxBlurRadius] = algorithmConfig.maxBlurRadius;
  out[DOF_UNIFORM_OFFSETS.cocBlendScale] = algorithmConfig.cocBlendScale;
  out[12] = 0.0;
  out[13] = 0.0;
  out[14] = 0.0;
  out[15] = 0.0;
  return out;
}
