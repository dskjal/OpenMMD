import { parseJsonObjectDocument, isSettingsType } from '../config/json-document-utils.js';
import {
  BONE_ENTRY_ALLOWED_KEYS,
  buildCanonicalMaterialEntry,
  MATERIAL_ENTRY_ALLOWED_KEYS,
  MODEL_SETTINGS_ALLOWED_TOP_LEVEL_KEYS,
  MODEL_SETTINGS_TYPE,
  normalizeColor3,
  normalizeColor4,
  normalizeEmissiveSource,
  normalizeString,
  clampNumber,
  cloneTextureReference,
} from './model-settings-schema.js';
import {
  normalizeEmissiveTextureReference,
  normalizeToonTextureReference,
} from '../gpu/material-resources.js';

/**
 * Model settings JSON text を解析します。
 * @param {string} text - JSON text.
 * @returns {object} Parsed data.
 */
export function parseModelSettingsJsonText(text) {
  return parseJsonObjectDocument(text, 'Model settings JSON must be an object.');
}

/**
 * document が model settings かどうかを返します。
 * @param {object|null|undefined} data - Parsed data.
 * @returns {boolean} True when the type matches.
 */
export function isModelSettingsObject(data) {
  return isSettingsType(data, MODEL_SETTINGS_TYPE);
}

/**
 * object の未知キーを検査します。
 * @param {object} target - Target object.
 * @param {string[]} allowedKeys - Allowed keys.
 * @param {string} context - Error context.
 */
function assertNoUnknownKeys(target, allowedKeys, context) {
  for (const key of Object.keys(target || {})) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${context} contains an unknown key: ${key}`);
    }
  }
}

/**
 * strict boolean を解釈します。
 * @param {unknown} value - Input value.
 * @param {string} context - Error context.
 * @returns {boolean} Parsed boolean.
 */
function parseStrictBoolean(value, context) {
  if (typeof value !== 'boolean') {
    throw new Error(`${context} must be a boolean.`);
  }
  return value;
}

/**
 * strict number を解釈します。
 * @param {unknown} value - Input value.
 * @param {string} context - Error context.
 * @param {number} [min=-Infinity] - Lower bound.
 * @param {number} [max=Infinity] - Upper bound.
 * @returns {number} Parsed number.
 */
function parseStrictNumber(value, context, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${context} must be a finite number.`);
  }
  return clampNumber(parsed, min, max);
}

/**
 * strict string を解釈します。
 * @param {unknown} value - Input value.
 * @param {string} context - Error context.
 * @returns {string} Parsed string.
 */
function parseStrictString(value, context) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return normalized;
}

/**
 * ikRotationLocks を正規化します。
 * @param {object} value - Input value.
 * @param {string} context - Error context.
 * @returns {object} Normalized value.
 */
function parseIkRotationLocks(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  assertNoUnknownKeys(value, ['x', 'y', 'z'], context);
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(value, 'x')) {
    normalized.x = parseStrictBoolean(value.x, `${context}.x`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'y')) {
    normalized.y = parseStrictBoolean(value.y, `${context}.y`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'z')) {
    normalized.z = parseStrictBoolean(value.z, `${context}.z`);
  }
  return normalized;
}

/**
 * visibility object を正規化します。
 * @param {object} value - Input value.
 * @param {string} context - Error context.
 * @returns {object} Normalized value.
 */
function parseVisibility(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  assertNoUnknownKeys(value, ['visible', 'ssss', 'castShadow', 'receiveShadow'], context);
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(value, 'visible')) {
    normalized.visible = parseStrictBoolean(value.visible, `${context}.visible`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'ssss')) {
    normalized.ssss = parseStrictBoolean(value.ssss, `${context}.ssss`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'castShadow')) {
    normalized.castShadow = parseStrictBoolean(value.castShadow, `${context}.castShadow`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'receiveShadow')) {
    normalized.receiveShadow = parseStrictBoolean(value.receiveShadow, `${context}.receiveShadow`);
  }
  return normalized;
}

/**
 * raster object を正規化します。
 * @param {object} value - Input value.
 * @param {string} context - Error context.
 * @returns {object} Normalized value.
 */
function parseRaster(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  assertNoUnknownKeys(value, ['noCull', 'hasEdge'], context);
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(value, 'noCull')) {
    normalized.noCull = parseStrictBoolean(value.noCull, `${context}.noCull`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'hasEdge')) {
    normalized.hasEdge = parseStrictBoolean(value.hasEdge, `${context}.hasEdge`);
  }
  return normalized;
}

/**
 * emissive object を正規化します。
 * @param {object} value - Input value.
 * @param {string} context - Error context.
 * @returns {object} Normalized value.
 */
function parseEmissive(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  assertNoUnknownKeys(value, ['source', 'color', 'strength', 'texture'], context);
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(value, 'source')) {
    const source = normalizeEmissiveSource(value.source);
    if (!source) {
      throw new Error(`${context}.source must be "color" or "texture".`);
    }
    normalized.source = source;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'color')) {
    const color = normalizeColor3(value.color);
    if (!color) {
      throw new Error(`${context}.color must be an RGB array in 0..1.`);
    }
    normalized.color = color;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'strength')) {
    normalized.strength = parseStrictNumber(value.strength, `${context}.strength`, 0);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'texture')) {
    const texture = normalizeEmissiveTextureReference(value.texture);
    if (!texture) {
      throw new Error(`${context}.texture is invalid.`);
    }
    normalized.texture = texture;
  }
  return normalized;
}

/**
 * material entry を正規化します。
 * @param {object} value - Input value.
 * @param {number} index - Entry index.
 * @returns {object} Normalized entry.
 */
function parseMaterialEntry(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`materials[${index}] must be an object.`);
  }
  assertNoUnknownKeys(value, MATERIAL_ENTRY_ALLOWED_KEYS, `materials[${index}]`);
  const normalized = {
    name: parseStrictString(value.name, `materials[${index}].name`),
  };
  if (Object.prototype.hasOwnProperty.call(value, 'shader')) {
    normalized.shader = parseStrictString(value.shader, `materials[${index}].shader`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'visibility')) {
    normalized.visibility = parseVisibility(value.visibility, `materials[${index}].visibility`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'raster')) {
    normalized.raster = parseRaster(value.raster, `materials[${index}].raster`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'toonTexture')) {
    const toonTexture = normalizeToonTextureReference(value.toonTexture);
    if (!toonTexture) {
      throw new Error(`materials[${index}].toonTexture is invalid.`);
    }
    normalized.toonTexture = toonTexture;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'diffuse')) {
    const diffuse = normalizeColor4(value.diffuse);
    if (!diffuse) {
      throw new Error(`materials[${index}].diffuse must be an RGBA array in 0..1.`);
    }
    normalized.diffuse = diffuse;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'metallic')) {
    normalized.metallic = parseStrictNumber(value.metallic, `materials[${index}].metallic`, 0, 1);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'roughness')) {
    normalized.roughness = parseStrictNumber(value.roughness, `materials[${index}].roughness`, 0, 1);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'emissive')) {
    normalized.emissive = parseEmissive(value.emissive, `materials[${index}].emissive`);
  }
  return normalized;
}

/**
 * bone entry を正規化します。
 * @param {object} value - Input value.
 * @param {number} index - Entry index.
 * @returns {object} Normalized entry.
 */
function parseBoneEntry(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`bones[${index}] must be an object.`);
  }
  assertNoUnknownKeys(value, BONE_ENTRY_ALLOWED_KEYS, `bones[${index}]`);
  const normalized = {
    name: parseStrictString(value.name, `bones[${index}].name`),
  };
  if (Object.prototype.hasOwnProperty.call(value, 'ikRotationLocks')) {
    normalized.ikRotationLocks = parseIkRotationLocks(value.ikRotationLocks, `bones[${index}].ikRotationLocks`);
  }
  return normalized;
}

/**
 * model settings data を strict canonical schema として検証・正規化します。
 * @param {object} data - Parsed data.
 * @returns {object} Normalized data.
 */
export function validateModelSettingsData(data) {
  if (!isModelSettingsObject(data)) {
    throw new Error('Model settings JSON type must be "model".');
  }
  assertNoUnknownKeys(data, MODEL_SETTINGS_ALLOWED_TOP_LEVEL_KEYS, 'model settings');
  if (!data.targetModel || typeof data.targetModel !== 'object' || Array.isArray(data.targetModel)) {
    throw new Error('targetModel must be an object.');
  }
  assertNoUnknownKeys(data.targetModel, ['name'], 'targetModel');
  const normalized = {
    type: MODEL_SETTINGS_TYPE,
    targetModel: {
      name: parseStrictString(data.targetModel.name, 'targetModel.name'),
    },
    bones: [],
    materials: [],
  };

  if (data.bones !== undefined) {
    if (!Array.isArray(data.bones)) {
      throw new Error('bones must be an array.');
    }
    normalized.bones = data.bones.map((entry, index) => parseBoneEntry(entry, index));
  }

  if (data.materials !== undefined) {
    if (!Array.isArray(data.materials)) {
      throw new Error('materials must be an array.');
    }
    normalized.materials = data.materials.map((entry, index) => parseMaterialEntry(entry, index));
  }

  return normalized;
}

/**
 * model settings export data を構築します。
 * @param {object|null} instance - Target instance.
 * @param {object} options - Build options.
 * @param {Array<object>} [options.shaderDefinitions=[]] - Shader definitions.
 * @param {function(string, Array<object>): string} options.resolveShaderLabelForExport - Shader export resolver.
 * @returns {object} Canonical model settings data.
 */
export function buildModelSettingsData(instance, options = {}) {
  const model = instance?.model ?? null;
  const materials = Array.isArray(model?.materials) ? model.materials : [];
  const bones = Array.isArray(model?.bones) ? model.bones : [];
  const shaderDefinitions = Array.isArray(options.shaderDefinitions) ? options.shaderDefinitions : [];
  const exported = {
    type: MODEL_SETTINGS_TYPE,
    targetModel: {
      name: normalizeString(model?.name),
    },
    bones: [],
    materials: [],
  };

  for (let index = 0; index < materials.length; index += 1) {
    exported.materials.push(buildCanonicalMaterialEntry(instance, index, {
      shaderDefinitions,
      resolveShaderLabelForExport: options.resolveShaderLabelForExport,
    }));
  }

  for (let index = 0; index < bones.length; index += 1) {
    const currentLocks = bones[index]?.ikRotationLocks || {};
    if (!currentLocks.x && !currentLocks.y && !currentLocks.z) {
      continue;
    }
    exported.bones.push({
      name: normalizeString(bones[index]?.name) || `Bone ${index}`,
      ikRotationLocks: {
        x: Boolean(currentLocks.x),
        y: Boolean(currentLocks.y),
        z: Boolean(currentLocks.z),
      },
    });
  }

  if (exported.bones.length === 0) {
    delete exported.bones;
  }

  return exported;
}

/**
 * companion shader file 値を収集します。
 * @param {object} data - Parsed model settings data.
 * @returns {string[]} Shader names.
 */
export function collectModelShaderSelectValues(data) {
  const normalized = validateModelSettingsData(data);
  const values = [];
  const seen = new Set();
  for (const entry of normalized.materials) {
    const shader = normalizeString(entry.shader);
    if (!shader || seen.has(shader)) {
      continue;
    }
    seen.add(shader);
    values.push(shader);
  }
  return values;
}
