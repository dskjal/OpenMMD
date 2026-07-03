import {
  normalizeEmissiveTextureReference,
  normalizeToonTextureReference,
  resolveMaterialEmissiveTextureReference,
  resolveMaterialToonTextureReference,
} from '../gpu/material-resources.js';
import { getDefaultsSnapshot } from '../config/defaults/defaults-manager.js';

export const MODEL_SETTINGS_TYPE = 'model';
export const MODEL_SETTINGS_ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'type',
  'targetModel',
  'bones',
  'materials',
]);
export const MATERIAL_ENTRY_ALLOWED_KEYS = Object.freeze([
  'name',
  'shader',
  'visibility',
  'raster',
  'toonTexture',
  'diffuse',
  'metallic',
  'roughness',
  'emissive',
]);
export const BONE_ENTRY_ALLOWED_KEYS = Object.freeze([
  'name',
  'ikRotationLocks',
]);

/**
 * 数値をクランプします。
 * @param {number} value - Input value.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} Clamped value.
 */
export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 文字列を正規化します。
 * @param {unknown} value - Input value.
 * @returns {string} Normalized string.
 */
export function normalizeString(value) {
  return String(value ?? '').trim();
}

/**
 * RGBA 配列を正規化します。
 * @param {unknown} value - Input value.
 * @returns {number[]|null} RGBA color.
 */
export function normalizeColor4(value) {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const normalized = value.map((component) => Number(component));
  if (normalized.some((component) => !Number.isFinite(component))) {
    return null;
  }
  return [
    clampNumber(normalized[0], 0, 1),
    clampNumber(normalized[1], 0, 1),
    clampNumber(normalized[2], 0, 1),
    clampNumber(normalized[3], 0, 1),
  ];
}

/**
 * RGB 配列を正規化します。
 * @param {unknown} value - Input value.
 * @returns {number[]|null} RGB color.
 */
export function normalizeColor3(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  const normalized = value.map((component) => Number(component));
  if (normalized.some((component) => !Number.isFinite(component))) {
    return null;
  }
  return [
    clampNumber(normalized[0], 0, 1),
    clampNumber(normalized[1], 0, 1),
    clampNumber(normalized[2], 0, 1),
  ];
}

/**
 * テクスチャ参照を複製します。
 * @param {object|null|undefined} reference - Texture reference.
 * @returns {object|null} Cloned reference.
 */
export function cloneTextureReference(reference) {
  if (!reference || typeof reference !== 'object') {
    return null;
  }
  if (reference.kind === 'none') {
    return { kind: 'none' };
  }
  if (reference.kind === 'internal') {
    return { kind: 'internal', toonIndex: reference.toonIndex };
  }
  if (reference.kind === 'path') {
    return {
      kind: 'path',
      path: reference.path,
      colorSpace: reference.colorSpace || 'gamma-2.2',
    };
  }
  return null;
}

/**
 * emissive source を正規化します。
 * @param {unknown} value - Input value.
 * @returns {'color'|'texture'|null} Normalized source.
 */
export function normalizeEmissiveSource(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'color' || normalized === 'texture') {
    return normalized;
  }
  return null;
}

/**
 * material defaults を canonical schema 形へ変換します。
 * @returns {object} Material defaults.
 */
export function getCanonicalMaterialDefaults() {
  const defaults = getDefaultsSnapshot('material');
  const roughness = Number.isFinite(defaults.roughness) ? defaults.roughness : 1;
  const metallic = Number.isFinite(defaults.metalic) ? defaults.metalic : 0;
  const emissiveColor = normalizeColor3(defaults.emissive) || [0, 0, 0];
  const emissiveStrength = Number.isFinite(defaults.emissiveStrength) ? defaults.emissiveStrength : 0;
  const emissiveSource = normalizeEmissiveSource(defaults.emissiveSource) || 'color';
  return {
    visibility: {
      visible: defaults.visible !== false,
      ssss: Boolean(defaults.ssss),
      castShadow: defaults.castShadow !== false,
      receiveShadow: defaults.receiveShadow !== false,
    },
    raster: {
      noCull: Boolean(defaults.noCull),
      hasEdge: Boolean(defaults.hasEdge),
    },
    metallic,
    roughness,
    emissive: {
      source: emissiveSource,
      color: emissiveColor,
      strength: emissiveStrength,
      texture: { kind: 'none' },
    },
  };
}

/**
 * export 用 material entry を構築します。
 * @param {object} instance - Target instance.
 * @param {number} index - Material index.
 * @param {object} shaderNameResolver - Shader resolver options.
 * @param {function(string, Array<object>): string} shaderNameResolver.resolveShaderLabelForExport - Export resolver.
 * @param {Array<object>} shaderNameResolver.shaderDefinitions - Shader definitions.
 * @returns {object} Canonical material entry.
 */
export function buildCanonicalMaterialEntry(instance, index, shaderNameResolver) {
  const modelMaterial = instance?.model?.materials?.[index] ?? null;
  const materialName = normalizeString(modelMaterial?.name) || `Material ${index}`;
  const diffuse = normalizeColor4(modelMaterial?.diffuse) || [1, 1, 1, 1];
  const emissiveColor = normalizeColor3(modelMaterial?.emissive) || [0, 0, 0];
  const toonTexture = normalizeToonTextureReference(modelMaterial?.toonTexture)
    || resolveMaterialToonTextureReference(instance?.modelPath ?? '', instance?.model ?? null, modelMaterial)
    || { kind: 'none' };
  const emissiveTexture = normalizeEmissiveTextureReference(modelMaterial?.emissiveTexture)
    || resolveMaterialEmissiveTextureReference(instance?.modelPath ?? '', instance?.model ?? null, modelMaterial)
    || { kind: 'none' };
  return {
    name: materialName,
    shader: shaderNameResolver.resolveShaderLabelForExport(
      modelMaterial?.shaderName,
      shaderNameResolver.shaderDefinitions,
    ),
    visibility: {
      visible: instance?.materialVisibility?.[index] !== false,
      ssss: instance?.ssssMaterialVisibility?.[index] !== false,
      castShadow: instance?.materialCastShadow?.[index] !== false,
      receiveShadow: modelMaterial?.receiveShadow !== false,
    },
    raster: {
      noCull: Boolean(modelMaterial?.noCull),
      hasEdge: Boolean(modelMaterial?.hasEdge),
    },
    toonTexture,
    diffuse,
    metallic: Number.isFinite(modelMaterial?.metalic) ? modelMaterial.metalic : 0,
    roughness: Number.isFinite(modelMaterial?.roughness) ? modelMaterial.roughness : 1,
    emissive: {
      source: normalizeEmissiveSource(modelMaterial?.emissiveSource) || 'color',
      color: emissiveColor,
      strength: Number.isFinite(modelMaterial?.emissiveStrength) ? modelMaterial.emissiveStrength : 0,
      texture: emissiveTexture,
    },
  };
}
