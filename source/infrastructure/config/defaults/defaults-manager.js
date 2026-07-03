const DEFAULTS_PATH = 'source/infrastructure/config/defaults/defaults.json';

const FALLBACK_DEFAULTS = Object.freeze({
  appState: Object.freeze({
    environmentHdrPath: 'test-data/sundowner_deck_1k.hdr',
    environmentHdrName: 'sundowner_deck_1k.hdr',
    environmentHdrIntensity: 1,
    environmentHdrLoaded: false,
    dynamicRange: 16,
    lightColor: Object.freeze([1, 1, 1, 1]),
    mmdLengthToMetersScale: 0.07876027287775755,
  }),
  camera: Object.freeze({
    center: Object.freeze([0, 1, 0]),
    distance: 3.04138126514911,
    clipPlanes: Object.freeze({
      near: 0.1,
      far: 1000,
    }),
    fovY: 0.7853981633974483,
    phi: 0.16514867741462683,
    roll: 0,
    theta: 0,
  }),
  gizmoState: Object.freeze({
    mode: null,
    axis: null,
    dragKind: null,
    isLightObject: false,
    boneIndex: -1,
    selectedBoneIndices: Object.freeze([]),
    startBoneStates: Object.freeze([]),
    startPosition: Object.freeze([0, 0, 0]),
    startManualRotation: Object.freeze([0, 0, 0, 1]),
    startManualTranslation: Object.freeze([0, 0, 0]),
    startLightRotation: Object.freeze([0, 0, 0, 1]),
    startLightPosition: Object.freeze([0, 0, 0]),
    startHitPoint: Object.freeze([0, 0, 0]),
    dragPlaneNormal: Object.freeze([0, 0, 0]),
    dragAxisWorld: Object.freeze([0, 0, 0]),
    edgeOnBasisX: Object.freeze([0, 0, 0]),
    edgeOnBasisY: Object.freeze([0, 0, 0]),
    edgeOnBasisZ: Object.freeze([0, 0, 0]),
    edgeOnHalfSizeX: 0,
    edgeOnHalfSizeY: 0,
    edgeOnHalfSizeZ: 0,
    edgeOnStartAngle: 0,
    isDragging: false,
  }),
  gridOverlay: Object.freeze({
    size: 0.5,
    count: 10,
    thickness: 2,
  }),
  lightObject: Object.freeze({
    direction: Object.freeze([-0.5, -1, -0.5]),
    position: Object.freeze([0.8, 1.8, 0.8]),
  }),
  material: Object.freeze({
    visible: true,
    ssss: false,
    receiveShadow: true,
    castShadow: true,
    noCull: false,
    metalic: 0,
    roughness: 1,
    emissiveSource: 'color',
    emissive: Object.freeze([0, 0, 0, 1]),
    emissiveStrength: 0,
  }),
  postEffectUi: Object.freeze({
    bloomEnabled: false,
    dofEnabled: false,
    colorTemperature: 6500,
    gamma: 1,
    chromaticAberration: 0,
    filmGrainAmount: 0,
    filmGrainAnimationMode: 'timeline',
    bloomThreshold: 0.98,
    bloomBlurAmount: 2,
    bloomAlpha: 1,
    bloomShadowMultiplier: 0,
    gltfLightStrength: 1,
    ambientOcclusionEnabled: false,
    ambientOcclusionRadius: 0.4,
    ambientOcclusionBias: 0.02,
    ambientOcclusionIntensity: 1,
    ambientOcclusionBlurAmount: 1,
    ambientOcclusionSampleCount: 12,
    contactShadowEnabled: false,
    contactShadowLength: 0.08,
    contactShadowThickness: 0.01,
    contactShadowIntensity: 0.55,
    contactShadowBlurAmount: 1,
    contactShadowStepCount: 8,
    dofBlurAmount: 2,
    dofAlgorithm: 'fast',
    dofFStop: 2.8,
    dofFocusPoint: Object.freeze([0, 0, 0]),
    sssEnabled: false,
    sssRadius: 1.5,
    sssDepthThreshold: 0.01,
    sssNormalThreshold: 0.2,
    sssStrength: 0.2,
  }),
  renderUi: Object.freeze({
    shadowPower: 1,
    shadowBias: 0.008,
    shadowStrength: 1,
    shadowMapSize: 1024,
    shadowFarAuto: true,
    shadowFar: 1000,
    ambientOcclusionEnabled: false,
    ambientOcclusionRadius: 0.4,
    ambientOcclusionBias: 0.02,
    ambientOcclusionIntensity: 1,
    ambientOcclusionBlurAmount: 1,
    ambientOcclusionSampleCount: 12,
    contactShadowEnabled: false,
    contactShadowLength: 0.08,
    contactShadowThickness: 0.01,
    contactShadowIntensity: 0.55,
    contactShadowBlurAmount: 1,
    contactShadowStepCount: 8,
    aaMethod: 'msaa4',
    renderingFPS: 60,
    viewTransform: 'standard',
    displayColorSpace: 'srgb',
    aspectRatio: '16:9',
    internalResolution: 'auto',
    edgeOpacity: 0.5,
  }),
  rendererShadowState: Object.freeze({
    shadowEdgeSize: 0.08,
    edgeShadowEdgeSize: 0.002,
    shadowEdgeOpacity: 0.5,
    shadowPower: 1,
    shadowBias: 0.008,
    shadowStrength: 1,
  }),
  shadowManager: Object.freeze({
    cascadeCount: 4,
    cameraNear: 0.1,
    cameraFar: 1000,
    autoFar: true,
    lambda: 0.75,
    shadowMapSize: 2048,
    padding: 0.5,
  }),
  worldRotationUi: Object.freeze({
    boneIndex: -1,
    euler: null,
  }),
});

let defaultsCache = cloneDefaults(FALLBACK_DEFAULTS);
let defaultsPromise = null;

/**
 * JSON 由来の既定値を読み込みます。
 * 失敗時は JS fallback を維持します。
 * @returns {Promise<object>} 既定値ルート。
 */
export async function loadDefaults() {
  if (defaultsPromise) {
    return defaultsPromise;
  }

  defaultsPromise = readDefaultsRoot()
    .then((loadedDefaults) => {
      defaultsCache = loadedDefaults;
      return defaultsCache;
    })
    .catch(() => useFallbackDefaults());

  return defaultsPromise;
}

/**
 * 現在の defaults を返します。
 * 未ロード時は fallback を返します。
 * @returns {object} defaults ルート。
 */
export function resolveDefaults() {
  return defaultsCache;
}

/**
 * テスト用に defaults キャッシュを初期状態へ戻します。
 * 本番コードからは呼ばないこと。
 * @returns {void}
 */
export function resetDefaultsForTests() {
  useFallbackDefaults();
  defaultsPromise = null;
}

/**
 * 指定 section の defaults を複製して返します。
 * @param {string} [sectionName=''] - section 名。
 * @returns {object} section の複製。
 */
export function getDefaultsSnapshot(sectionName = '') {
  const defaults = resolveDefaults();
  if (!sectionName) {
    return cloneDefaults(defaults);
  }

  const section = defaults[sectionName];
  if (section === undefined) {
    return {};
  }
  return cloneDefaults(section);
}

/**
 * defaults ルートを正規化します。
 * @param {object|null|undefined} value - 読み込んだ JSON。
 * @returns {object} 正規化後の defaults。
 */
function normalizeDefaultsRoot(value) {
  return normalizeValue(value, FALLBACK_DEFAULTS);
}

/**
 * defaults JSON を読み込んで正規化します。
 * @returns {Promise<object>} 正規化済みの defaults ルート。
 */
async function readDefaultsRoot() {
  if (typeof fetch !== 'function') {
    return useFallbackDefaults();
  }

  const response = await fetch(DEFAULTS_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load defaults JSON: ${response.status}`);
  }

  const parsed = await response.json();
  return normalizeDefaultsRoot(parsed);
}

/**
 * fallback defaults をキャッシュへ戻します。
 * @returns {object} fallback defaults。
 */
function useFallbackDefaults() {
  defaultsCache = cloneDefaults(FALLBACK_DEFAULTS);
  return defaultsCache;
}

/**
 * 既定値と同じ形へ正規化します。
 * @param {*} value - 入力値。
 * @param {*} fallback - fallback 値。
 * @returns {*} 正規化結果。
 */
function normalizeValue(value, fallback) {
  if (fallback === null) {
    return value === undefined ? null : value;
  }

  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) {
      return cloneDefaults(fallback);
    }
    return fallback.map((fallbackItem, index) => normalizeValue(value[index], fallbackItem));
  }

  if (isPlainObject(fallback)) {
    const source = isPlainObject(value) ? value : {};
    const result = {};
    for (const [key, fallbackValue] of Object.entries(fallback)) {
      result[key] = normalizeValue(source[key], fallbackValue);
    }
    return result;
  }

  switch (typeof fallback) {
    case 'number': {
      const nextValue = Number(value);
      return Number.isFinite(nextValue) ? nextValue : fallback;
    }
    case 'string':
      return typeof value === 'string' ? value : fallback;
    case 'boolean':
      return typeof value === 'boolean' ? value : fallback;
    default:
      return value === undefined ? fallback : value;
  }
}

/**
 * プレーンオブジェクトかどうかを判定します。
 * @param {*} value - 判定対象。
 * @returns {boolean} プレーンオブジェクトなら true。
 */
function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * 値を複製します。
 * @param {*} value - 対象値。
 * @returns {*} 複製結果。
 */
function cloneDefaults(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
