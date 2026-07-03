import TGA from '../../lib/tga.js';
import { parseDDS } from '../loaders/dds-loader.js';
import { getDefaultsSnapshot } from '../config/defaults/defaults-manager.js';

const INTERNAL_TOON_TEXTURE_COUNT = 10;
const DEFAULT_INTERNAL_TOON_TEXTURE_CACHE = new Map();
const DEFAULT_TEXTURE_COLOR_SPACE = 'gamma-2.2';
const MATERIAL_UNIFORM_FLOAT_COUNT = 56;
const SRGB_TEXTURE_FORMATS = new Map([
  ['rgba8unorm', 'rgba8unorm-srgb'],
  ['bc1-rgba-unorm', 'bc1-rgba-unorm-srgb'],
  ['bc2-rgba-unorm', 'bc2-rgba-unorm-srgb'],
  ['bc3-rgba-unorm', 'bc3-rgba-unorm-srgb'],
  ['bc7-rgba-unorm', 'bc7-rgba-unorm-srgb'],
]);

/**
 * 材質 roughness の既定値を返します。
 * @returns {number} roughness 既定値。
 */
function getDefaultMaterialRoughness() {
  const defaults = getDefaultsSnapshot('material');
  return Number.isFinite(defaults.roughness) ? defaults.roughness : 1;
}

/**
 * MToon 設定を GPU 用の既定形へ正規化します。
 * @param {object|null|undefined} mtoon - MToon 設定。
 * @returns {object} 正規化済み MToon。
 */
function normalizeMtoonSettings(mtoon) {
  return {
    enabled: Boolean(mtoon?.enabled),
    transparentWithZWrite: Boolean(mtoon?.transparentWithZWrite),
    hasShadeMultiplyTexture: Boolean(mtoon?.hasShadeMultiplyTexture),
    shadeColor: cloneColor3(mtoon?.shadeColor, [1, 1, 1]),
    shadeShift: Number.isFinite(Number(mtoon?.shadeShift)) ? Number(mtoon.shadeShift) : 0,
    shadeToony: Number.isFinite(Number(mtoon?.shadeToony)) ? Number(mtoon.shadeToony) : 0.9,
    receiveShadowRate: Number.isFinite(Number(mtoon?.receiveShadowRate)) ? Number(mtoon.receiveShadowRate) : 1,
    shadingGradeRate: Number.isFinite(Number(mtoon?.shadingGradeRate)) ? Number(mtoon.shadingGradeRate) : 1,
    lightColorAttenuation: Number.isFinite(Number(mtoon?.lightColorAttenuation)) ? Number(mtoon.lightColorAttenuation) : 0,
    indirectLightIntensity: Number.isFinite(Number(mtoon?.indirectLightIntensity)) ? Number(mtoon.indirectLightIntensity) : 0.9,
    rimLightingMix: Number.isFinite(Number(mtoon?.rimLightingMix)) ? Number(mtoon.rimLightingMix) : 1,
    outlineWidth: Number.isFinite(Number(mtoon?.outlineWidth)) ? Number(mtoon.outlineWidth) : 0,
    outlineScaledMaxDistance: Number.isFinite(Number(mtoon?.outlineScaledMaxDistance)) ? Number(mtoon.outlineScaledMaxDistance) : 1,
    outlineLightingMix: Number.isFinite(Number(mtoon?.outlineLightingMix)) ? Number(mtoon.outlineLightingMix) : 1,
    outlineWidthMode: Number.isFinite(Number(mtoon?.outlineWidthMode)) ? Number(mtoon.outlineWidthMode) : 0,
    outlineColorMode: Number.isFinite(Number(mtoon?.outlineColorMode)) ? Number(mtoon.outlineColorMode) : 0,
    outlineColor: cloneColor3(mtoon?.outlineColor, [0, 0, 0]),
    rimColor: cloneColor3(mtoon?.rimColor, [0, 0, 0]),
    renderQueueOffsetNumber: Number.isFinite(Number(mtoon?.renderQueueOffsetNumber)) ? Number(mtoon.renderQueueOffsetNumber) : 0,
  };
}

/**
 * RGB を複製します。
 * @param {Array<number>|undefined|null} value - 元配列。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} 複製結果。
 */
function cloneColor3(value, fallback) {
  return Array.isArray(value) ? [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2]] : [...fallback];
}

/**
 * マテリアル uniform を書き込みます。
 * @param {Float32Array} materialData - 書き込み先。
 * @param {object} material - モデル材質。
 * @param {boolean} hasToonTexture - toon テクスチャ有無。
 * @param {boolean} hasEmissiveTexture - emissive テクスチャ有無。
 * @param {number} sphereMode - sphere mode。
 * @param {string} alphaMode - alpha mode。
 * @param {number} skinMask - skin mask 値。
 */
function fillMaterialUniformData(materialData, material, hasToonTexture, hasEmissiveTexture, sphereMode, alphaMode, skinMask) {
  const mtoon = normalizeMtoonSettings(material?.mtoon);
  materialData.fill(0);
  materialData.set(material.diffuse, 0);
  materialData.set(material.ambient, 4);
  materialData[7] = sphereMode;
  materialData.set(material.specular, 8);
  materialData[11] = material.shininess;
  materialData[12] = material.receiveShadow ? 1.0 : 0.0;
  materialData[13] = material.hasEdge ? 1.0 : 0.0;
  materialData[14] = alphaMode === 'cutout' ? 1.0 : 0.0;
  materialData[15] = hasToonTexture ? 1.0 : 0.0;
  materialData[16] = skinMask;
  materialData[17] = Number.isFinite(material.metalic) ? material.metalic : 0.0;
  materialData[18] = Number.isFinite(material.roughness) ? material.roughness : getDefaultMaterialRoughness();
  materialData[19] = String(material?.emissiveSource || 'color').trim().toLowerCase() === 'texture' ? 1.0 : 0.0;
  materialData.set(Array.isArray(material.emissive) ? material.emissive : [0.0, 0.0, 0.0], 20);
  materialData[23] = Number.isFinite(material.emissiveStrength) ? material.emissiveStrength : 0.0;
  materialData[24] = hasEmissiveTexture ? 1.0 : 0.0;
  materialData[25] = mtoon.enabled ? 1.0 : 0.0;
  materialData[26] = mtoon.transparentWithZWrite ? 1.0 : 0.0;
  materialData[27] = mtoon.outlineWidthMode;
  materialData.set(mtoon.shadeColor, 28);
  materialData[31] = 1.0;
  materialData[32] = mtoon.shadeShift;
  materialData[33] = mtoon.shadeToony;
  materialData[34] = mtoon.receiveShadowRate;
  materialData[35] = mtoon.shadingGradeRate;
  materialData[36] = mtoon.lightColorAttenuation;
  materialData[37] = mtoon.indirectLightIntensity;
  materialData[38] = mtoon.rimLightingMix;
  materialData[39] = mtoon.outlineLightingMix;
  materialData.set(mtoon.rimColor, 40);
  materialData[43] = 1.0;
  materialData.set(mtoon.outlineColor, 44);
  materialData[47] = 1.0;
  materialData[52] = mtoon.hasShadeMultiplyTexture ? 1.0 : 0.0;
}

/**
 * MToon の追加パラメータを補完します。
 * @param {Float32Array} materialData - 書き込み先。
 * @param {object} material - モデル材質。
 */
function fillMaterialUniformMtoonTail(materialData, material) {
  const mtoon = normalizeMtoonSettings(material?.mtoon);
  materialData[48] = mtoon.outlineWidth;
  materialData[49] = mtoon.outlineScaledMaxDistance;
  materialData[50] = mtoon.outlineColorMode;
  materialData[51] = mtoon.renderQueueOffsetNumber;
}

/**
 * 1x1 の白テクスチャを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {GPUTexture} 空テクスチャ。
 */
export function createEmptyTexture(device) {
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}

/**
 * 指定パスの画像を GPU テクスチャへ変換します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} path - 画像パス。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @returns {Promise<TextureResource|null>} GPU テクスチャと alpha 情報。
 */
export async function loadTextureFromPath(device, path, fileProvider, textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE) {
  return await loadTextureAtPath(device, path, fileProvider, textureColorSpace);
}

/**
 * Returns true when the image-like source has a non-empty size.
 * @param {object|null|undefined} source - Source to validate.
 * @returns {boolean} True when width and height are positive.
 */
function hasValidTextureSize(source) {
  const width = Number(source?.width);
  const height = Number(source?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

/**
 * toon テクスチャ参照を正規化します。
 * @param {object|string|null|undefined} reference - toon 参照。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|{kind: 'none'}|null} 正規化結果。
 */
export function normalizeToonTextureReference(reference) {
  if (typeof reference === 'string') {
    const path = String(reference).trim();
    if (!path) {
      return null;
    }
    if (path.toLowerCase() === 'none') {
      return { kind: 'none' };
    }
    return path
      ? { kind: 'path', path, colorSpace: DEFAULT_TEXTURE_COLOR_SPACE }
      : null;
  }

  if (!reference || typeof reference !== 'object') {
    return null;
  }

  const kind = String(reference.kind || '').trim().toLowerCase();
  if (kind === 'none') {
    return { kind: 'none' };
  }
  if (kind === 'internal') {
    const toonIndex = Number(reference.toonIndex);
    return Number.isInteger(toonIndex) && toonIndex >= 0
      ? { kind: 'internal', toonIndex }
      : null;
  }

  if (Number.isInteger(Number(reference.toonIndex)) && Number(reference.toonIndex) >= 0) {
    return {
      kind: 'internal',
      toonIndex: Number(reference.toonIndex),
    };
  }

  if (kind === 'path' || typeof reference.path === 'string') {
    const path = String(reference.path || '').trim();
    if (!path) {
      return null;
    }
    return {
      kind: 'path',
      path,
      colorSpace: normalizeTextureColorSpace(reference.colorSpace),
    };
  }

  return null;
}

/**
 * VRM shadeMultiplyTexture 参照を正規化します。
 * @param {object|string|null|undefined} reference - shadeMultiplyTexture 参照。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|{kind: 'none'}|null} 正規化結果。
 */
export function normalizeShadeMultiplyTextureReference(reference) {
  return normalizeToonTextureReference(reference);
}

/**
 * emissive テクスチャ参照を正規化します。
 * @param {object|string|null|undefined} reference - emissive 参照。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|{kind: 'none'}|null} 正規化結果。
 */
export function normalizeEmissiveTextureReference(reference) {
  return normalizeToonTextureReference(reference);
}

/**
 * Material の toon 参照を解決します。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {object} material - マテリアル。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|null} 解決済み参照。
 */
export function resolveMaterialToonTextureReference(modelPath, model, material) {
  const overrideReference = normalizeToonTextureReference(material?.toonTexture);
  if (overrideReference) {
    if (overrideReference.kind === 'none') {
      return null;
    }
    return overrideReference;
  }

  if (!shouldResolveLegacyMmdToonTexture(model)) {
    return null;
  }

  const textureColorSpaces = Array.isArray(model?.textureColorSpaces) ? model.textureColorSpaces : [];
  if (material?.toonMode === 0) {
    if (Number.isInteger(material.toonIndex) && material.toonIndex < 0) {
      const derivedToonIndex = Number(material.textureIndex) + material.toonIndex;
      const derivedToonPath = getTextureSourcePath(model, derivedToonIndex);
      if (isToonTexturePath(derivedToonPath)) {
        return {
          kind: 'path',
          path: derivedToonPath,
          colorSpace: normalizeTextureColorSpace(textureColorSpaces[derivedToonIndex]),
        };
      }
      return null;
    }

    if (Number.isInteger(material.toonIndex)) {
      const toonPath = getTextureSourcePath(model, material.toonIndex);
      if (!toonPath) {
        return null;
      }
      return {
        kind: 'path',
        path: toonPath,
        colorSpace: normalizeTextureColorSpace(textureColorSpaces[material.toonIndex]),
      };
    }
  }

  if (material?.toonMode === 1) {
    if (Number.isInteger(material.toonIndex) && material.toonIndex !== 255) {
      return {
        kind: 'internal',
        toonIndex: material.toonIndex,
      };
    }

    const texturePath = getTextureSourcePath(model, material.textureIndex);
    const adjacentToonPath = resolveAdjacentToonTexturePath(modelPath, texturePath);
    if (adjacentToonPath) {
      return {
        kind: 'path',
        path: adjacentToonPath,
        colorSpace: normalizeTextureColorSpace(textureColorSpaces[material.textureIndex]),
      };
    }
  }

  return null;
}

/**
 * モデルに MMD 互換 toon フォールバックを適用するかを返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {boolean} 適用する場合は true。
 */
function shouldResolveLegacyMmdToonTexture(model) {
  const magic = String(model?.magic || '').trim();
  return magic !== 'Gltf' && magic !== 'Vrm';
}

/**
 * Material の shadeMultiplyTexture 参照を解決します。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {object} material - マテリアル。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|null} 解決済み参照。
 */
export function resolveMaterialShadeMultiplyTextureReference(modelPath, model, material) {
  const overrideReference = normalizeShadeMultiplyTextureReference(material?.shadeMultiplyTexture);
  if (overrideReference) {
    if (overrideReference.kind === 'none') {
      return null;
    }
    return overrideReference;
  }

  return null;
}

/**
 * Material の emissive テクスチャ参照を解決します。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {object} material - マテリアル。
 * @returns {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace: 'gamma-2.2'|'none'}|null} 解決済み参照。
 */
export function resolveMaterialEmissiveTextureReference(modelPath, model, material) {
  const overrideReference = normalizeEmissiveTextureReference(material?.emissiveTexture);
  if (overrideReference) {
    if (overrideReference.kind === 'none') {
      return null;
    }
    return overrideReference;
  }

  const sourceMode = String(material?.emissiveSource || '').trim().toLowerCase();
  if (sourceMode !== 'texture') {
    return null;
  }

  return null;
}

/**
 * モデルが使用している全 texture 候補を収集します。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {Array<TextureResource|null>} textureResources - 画像リソース。
 * @returns {Array<object>} texture 候補一覧。
 */
export function collectModelTextureCandidates(modelPath, model, textureResources = []) {
  const candidates = [];
  const seen = new Set();
  const displayTextures = Array.isArray(model?.textures) ? model.textures : [];
  const sourceTextures = Array.isArray(model?.textureSources) && model.textureSources.length > 0
    ? model.textureSources
    : displayTextures;
  const textureColorSpaces = Array.isArray(model?.textureColorSpaces) ? model.textureColorSpaces : [];
  const modelName = String(model?.name || '').trim();

  for (let textureIndex = 0; textureIndex < sourceTextures.length; textureIndex++) {
    const texturePath = String(sourceTextures[textureIndex] || '').replace(/\\/g, '/').trim();
    if (!texturePath) {
      continue;
    }

    const normalizedKey = `${String(modelPath || '').trim()}::${texturePath}`;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    const textureResource = textureIndex >= 0 ? textureResources[textureIndex] || null : null;
    const textureColorSpace = normalizeTextureColorSpace(textureColorSpaces[textureIndex]);
    const displayPath = String(displayTextures[textureIndex] || texturePath).replace(/\\/g, '/').trim();
    const textureReference = {
      kind: 'path',
      path: texturePath,
      colorSpace: textureColorSpace,
    };
    candidates.push({
      kind: 'model-texture',
      label: getTextureDisplayName(displayPath, textureIndex),
      modelName,
      modelPath: String(modelPath || '').trim(),
      textureIndex,
      texturePath,
      textureDisplayPath: displayPath,
      textureColorSpace,
      previewUrl: String(textureResource?.previewUrl || '').trim(),
      textureReference,
      toonTexture: textureReference,
    });
  }

  return candidates;
}

/**
 * モデルが使用している toon テクスチャ候補を収集します。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {Array<TextureResource|null>} textureResources - 画像リソース。
 * @returns {Array<object>} toon 候補一覧。
 */
export function collectModelToonTextureCandidates(modelPath, model, textureResources = []) {
  const candidates = [];
  const seen = new Set();
  const displayTextures = Array.isArray(model?.textures) ? model.textures : [];
  const sourceTextures = Array.isArray(model?.textureSources) && model.textureSources.length > 0
    ? model.textureSources
    : displayTextures;
  const textureColorSpaces = Array.isArray(model?.textureColorSpaces) ? model.textureColorSpaces : [];
  const modelName = String(model?.name || '').trim();
  const textureIndexByPath = new Map();

  for (let textureIndex = 0; textureIndex < sourceTextures.length; textureIndex++) {
    const texturePath = String(sourceTextures[textureIndex] || '').replace(/\\/g, '/').trim();
    if (!texturePath) {
      continue;
    }
    textureIndexByPath.set(texturePath, textureIndex);
  }

  for (let materialIndex = 0; materialIndex < (Array.isArray(model?.materials) ? model.materials.length : 0); materialIndex++) {
    const material = model.materials[materialIndex];
    const toonReference = resolveMaterialToonTextureReference(modelPath, model, material);
    if (!toonReference || toonReference.kind !== 'path') {
      continue;
    }

    const texturePath = String(toonReference.path || '').replace(/\\/g, '/').trim();
    if (!texturePath) {
      continue;
    }

    const normalizedKey = `${String(modelPath || '').trim()}::${texturePath}`;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    const textureIndex = textureIndexByPath.has(texturePath) ? textureIndexByPath.get(texturePath) : -1;
    const textureResource = textureIndex >= 0 ? textureResources[textureIndex] || null : null;
    const displayPath = textureIndex >= 0
      ? String(displayTextures[textureIndex] || texturePath).replace(/\\/g, '/').trim()
      : texturePath;
    candidates.push({
      kind: 'model-texture',
      label: getTextureDisplayName(displayPath, textureIndex >= 0 ? textureIndex : materialIndex),
      modelName,
      modelPath: String(modelPath || '').trim(),
      textureIndex,
      texturePath,
      textureDisplayPath: displayPath,
      textureColorSpace: textureIndex >= 0
        ? normalizeTextureColorSpace(textureColorSpaces[textureIndex])
        : normalizeTextureColorSpace(toonReference.colorSpace),
      previewUrl: String(textureResource?.previewUrl || '').trim(),
      toonTexture: {
        kind: 'path',
        path: texturePath,
        colorSpace: textureIndex >= 0
          ? normalizeTextureColorSpace(textureColorSpaces[textureIndex])
          : normalizeTextureColorSpace(toonReference.colorSpace),
      },
    });
  }

  return candidates;
}

/**
 * モデルが使用している texture 候補を収集します。
 * @param {Array<object>} instances - モデルインスタンス一覧。
 * @param {number} activeInstanceIndex - アクティブインスタンス index。
 * @returns {{activeModelCandidates: Array<object>, otherModelCandidates: Array<object>, candidates: Array<object>}} 候補一覧。
 */
export function collectTextureCandidates(instances, activeInstanceIndex = -1) {
  const activeModelCandidates = [];
  const otherModelCandidates = [];
  const seen = new Set();

  if (Array.isArray(instances)) {
    const activeInstance = Number.isInteger(activeInstanceIndex) ? instances[activeInstanceIndex] : null;
    if (activeInstance) {
      const cachedCandidates = Array.isArray(activeInstance?.pipelineResources?.textureCandidates)
        ? activeInstance.pipelineResources.textureCandidates
        : collectModelTextureCandidates(activeInstance.modelPath || '', activeInstance.model, activeInstance.pipelineResources?.textureResources || []);
      for (const candidate of cachedCandidates) {
        const normalizedPath = String(candidate?.texturePath || candidate?.toonTexture?.path || '').replace(/\\/g, '/').trim();
        if (!normalizedPath) {
          continue;
        }
        const normalizedKey = `${String(activeInstance.modelPath || '').trim()}::${normalizedPath}`;
        if (seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        activeModelCandidates.push({
          ...candidate,
          group: 'active-model',
          label: String(candidate?.label || normalizedPath),
        });
      }
    }

    for (let index = 0; index < instances.length; index++) {
      if (index === activeInstanceIndex) {
        continue;
      }
      const instance = instances[index];
      const model = instance?.model ?? null;
      const modelPath = String(instance?.modelPath || '').trim();
      const modelName = String(model?.name || '').trim() || `Model ${index}`;
      const cachedCandidates = Array.isArray(instance?.pipelineResources?.textureCandidates)
        ? instance.pipelineResources.textureCandidates
        : collectModelTextureCandidates(modelPath, model, instance?.pipelineResources?.textureResources || []);
      for (const candidate of cachedCandidates) {
        const normalizedPath = String(candidate?.texturePath || candidate?.toonTexture?.path || '').replace(/\\/g, '/').trim();
        if (!normalizedPath) {
          continue;
        }
        const normalizedKey = `${modelPath}::${normalizedPath}`;
        if (seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        otherModelCandidates.push({
          ...candidate,
          group: 'other-model',
          label: `${modelName} / ${String(candidate?.label || normalizedPath)}`,
        });
      }
    }
  }

  return {
    activeModelCandidates,
    otherModelCandidates,
    candidates: [...activeModelCandidates, ...otherModelCandidates],
  };
}

/**
 * toon テクスチャ候補を収集します。
 * @param {Array<object>} instances - モデルインスタンス一覧。
 * @param {number} activeInstanceIndex - アクティブインスタンス index。
 * @returns {{activeModelCandidates: Array<object>, otherModelCandidates: Array<object>, defaultCandidates: Array<object>, candidates: Array<object>}} 候補一覧。
 */
export function collectToonTextureCandidates(instances, activeInstanceIndex = -1) {
  const activeModelCandidates = [];
  const otherModelCandidates = [];
  const defaultCandidates = [];
  const seen = new Set();

  if (Array.isArray(instances)) {
    const activeInstance = Number.isInteger(activeInstanceIndex) ? instances[activeInstanceIndex] : null;
    if (activeInstance) {
      const cachedCandidates = Array.isArray(activeInstance?.pipelineResources?.toonTextureCandidates)
        ? activeInstance.pipelineResources.toonTextureCandidates
        : collectModelToonTextureCandidates(activeInstance.modelPath || '', activeInstance.model, activeInstance.pipelineResources?.textureResources || []);
      for (const candidate of cachedCandidates) {
        const normalizedPath = String(candidate?.texturePath || candidate?.toonTexture?.path || '').replace(/\\/g, '/').trim();
        if (!normalizedPath) {
          continue;
        }
        const normalizedKey = `${String(activeInstance.modelPath || '').trim()}::${normalizedPath}`;
        if (seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        activeModelCandidates.push({
          ...candidate,
          group: 'active-model',
          label: String(candidate?.label || normalizedPath),
        });
      }
    }

    for (let index = 0; index < instances.length; index++) {
      if (index === activeInstanceIndex) {
        continue;
      }
      const instance = instances[index];
      const model = instance?.model ?? null;
      const modelPath = String(instance?.modelPath || '').trim();
      const modelName = String(model?.name || '').trim() || `Model ${index}`;
      const cachedCandidates = Array.isArray(instance?.pipelineResources?.toonTextureCandidates)
        ? instance.pipelineResources.toonTextureCandidates
        : collectModelToonTextureCandidates(modelPath, model, instance?.pipelineResources?.textureResources || []);
      for (const candidate of cachedCandidates) {
        const normalizedPath = String(candidate?.texturePath || candidate?.toonTexture?.path || '').replace(/\\/g, '/').trim();
        if (!normalizedPath) {
          continue;
        }
        const normalizedKey = `${modelPath}::${normalizedPath}`;
        if (seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        otherModelCandidates.push({
          ...candidate,
          group: 'other-model',
          label: `${modelName} / ${String(candidate?.label || normalizedPath)}`,
        });
      }
    }
  }

  for (let toonIndex = 0; toonIndex < INTERNAL_TOON_TEXTURE_COUNT; toonIndex++) {
    const toonPath = getSharedInternalToonTexturePath(toonIndex);
    if (!toonPath) {
      continue;
    }
    const normalizedKey = `default::${toonPath}`;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    defaultCandidates.push({
      kind: 'internal',
      group: 'default',
      label: getTextureDisplayName(toonPath, toonIndex),
      previewUrl: toonPath,
      toonTexture: {
        kind: 'internal',
        toonIndex,
      },
      toonIndex,
      texturePath: toonPath,
    });
  }

  return {
    activeModelCandidates,
    otherModelCandidates,
    defaultCandidates,
    candidates: [...activeModelCandidates, ...otherModelCandidates, ...defaultCandidates],
  };
}

/**
 * マテリアル関連 GPU リソースを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} modelPath - モデルパス。
 * @param {object} model - モデルデータ。
 * @param {GPUBindGroupLayout} matBindGroupLayout - マテリアル bind group layout。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @param {Array<string>|null} [textureColorSpaces=null] - texture index ごとの色空間設定。
 * @returns {Promise<{materials: Array<object>, textureResources: Array<TextureResource|null>}>} マテリアルと texture リソース。
 */
export async function createMaterialResources(
  device,
  modelPath,
  model,
  matBindGroupLayout,
  fileProvider,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
  textureColorSpaces = null,
  textureCache = null,
) {
  const materials = [];
  const resolvedTextureCache = textureCache instanceof Map ? textureCache : new Map();
  const emptyTexture = createEmptyTexture(device);

  const textureResources = await Promise.all(
    Array.from({ length: model.textures?.length || 0 }, (_, textureIndex) => (
      loadTextureResource(
        device,
        modelPath,
        model,
        textureIndex,
        resolvedTextureCache,
        fileProvider,
        getTextureColorSpace(textureColorSpaces, textureIndex),
      )
    )),
  );

  const textureResults = await Promise.all(
    model.materials.map((material) => loadTextureResource(
      device,
      modelPath,
      model,
      material.textureIndex,
      resolvedTextureCache,
      fileProvider,
      getTextureColorSpace(textureColorSpaces, material.textureIndex),
    )),
  );
  const toonResults = await Promise.all(
    model.materials.map((material) => loadToonTexture(
      device,
      modelPath,
      model,
      material,
      resolvedTextureCache,
      fileProvider,
      internalToonTextureCache,
      textureColorSpaces,
    )),
  );
  const shadeMultiplyResults = await Promise.all(
    model.materials.map((material) => loadShadeMultiplyTexture(
      device,
      modelPath,
      model,
      material,
      resolvedTextureCache,
      fileProvider,
    )),
  );
  const emissiveResults = await Promise.all(
    model.materials.map((material) => loadTextureResourceFromReference(
      device,
      modelPath,
      resolveMaterialEmissiveTextureReference(modelPath, model, material),
      resolvedTextureCache,
      fileProvider,
      internalToonTextureCache,
    )),
  );
  const sphereResults = await Promise.all(
    model.materials.map((material) => loadSphereTexture(
      device,
      modelPath,
      model,
      material.sphereIndex,
      resolvedTextureCache,
      fileProvider,
      getTextureColorSpace(textureColorSpaces, material.sphereIndex),
    )),
  );
  const textureCandidates = collectModelTextureCandidates(modelPath, model, textureResources);
  const toonTextureCandidates = collectModelToonTextureCandidates(modelPath, model, textureResources);

  let indexOffset = 0;
  for (let i = 0; i < model.materials.length; i++) {
    const material = model.materials[i];
    const { texture: sphereTexture, isSphere } = sphereResults[i];
    const baseTexture = ((textureResources[material.textureIndex] || textureResults[i])?.texture || emptyTexture);
    const toonTexture = toonResults[i] || emptyTexture;
    const resolvedSphereTexture = sphereTexture || emptyTexture;
    const hasEmissiveTexture = Boolean(emissiveResults[i]?.texture);
    const emissiveTexture = emissiveResults[i]?.texture || emptyTexture;
    const shadeMultiplyTexture = shadeMultiplyResults[i] || emptyTexture;
    let sphereMode = material.sphereMode || 0;
    if (isSphere && sphereMode === 0) {
      sphereMode = 1;
    }

    const alphaMode = resolveAlphaMode(material?.alphaMode, textureResults[i]?.alphaMode);
    const hasToonTexture = toonResults[i] !== null;
    const hasShadeMultiplyTexture = shadeMultiplyResults[i] !== null;

    const materialBuffer = device.createBuffer({
      size: MATERIAL_UNIFORM_FLOAT_COUNT * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const materialData = new Float32Array(MATERIAL_UNIFORM_FLOAT_COUNT);
    fillMaterialUniformData(materialData, material, hasToonTexture, hasEmissiveTexture, sphereMode, alphaMode, 1.0);
    fillMaterialUniformMtoonTail(materialData, material);
    device.queue.writeBuffer(materialBuffer, 0, materialData);

    const bindGroup = createMaterialBindGroup(
      device,
      matBindGroupLayout,
      materialBuffer,
      baseTexture,
      toonTexture,
      resolvedSphereTexture,
      emissiveTexture,
      shadeMultiplyTexture,
    );

    materials.push({
      bindGroup,
      buffer: materialBuffer,
      baseTexture,
      toonTexture,
      sphereTexture: resolvedSphereTexture,
      emissiveTexture,
      shadeMultiplyTexture,
      sortIndex: Number.isFinite(material.sortIndex) ? material.sortIndex : i,
      indexCount: material.indexCount,
      indexOffset,
      shaderName: typeof material.shaderName === 'string' && material.shaderName ? material.shaderName : '',
      alpha: material.diffuse[3],
      noCull: !!material.noCull,
      hasEdge: !!material.hasEdge,
      receiveShadow: !!material.receiveShadow,
      hasToonTexture,
      hasShadeMultiplyTexture,
      sphereMode,
      alphaMode,
      hasAlphaTexture: alphaMode !== 'opaque',
      hasEmissiveTexture,
      emissiveSource: String(material?.emissiveSource || 'color').trim().toLowerCase() === 'texture' ? 'texture' : 'color',
      sortCenter: computeMaterialSortCenter(model, indexOffset, material.indexCount),
    });
    indexOffset += material.indexCount;
  }

  return { materials, textureResources, textureCandidates, toonTextureCandidates, textureCache: resolvedTextureCache, emptyTexture };
}

/**
 * モデルテクスチャをロードします。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} modelPath - モデルパス。
 * @param {object} model - モデルデータ。
 * @param {number} textureIndex - テクスチャ番号。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @returns {Promise<GPUTexture|null>} テクスチャ。
 */
export async function loadTexture(
  device,
  modelPath,
  model,
  textureIndex,
  textureCache,
  fileProvider,
  textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE,
) {
  const resource = await loadTextureResource(device, modelPath, model, textureIndex, textureCache, fileProvider, textureColorSpace);
  return resource?.texture ?? null;
}

/**
 * モデルテクスチャをロードし、alpha 有無も返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} modelPath - モデルパス。
 * @param {object} model - モデルデータ。
 * @param {number} textureIndex - テクスチャ番号。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @returns {Promise<TextureResource|null>} テクスチャと alpha 情報。
 */
export async function loadTextureResource(
  device,
  modelPath,
  model,
  textureIndex,
  textureCache,
  fileProvider,
  textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE,
) {
  const textureSourcePath = getTextureSourcePath(model, textureIndex);
  if (textureIndex < 0 || !textureSourcePath) {
    return null;
  }
  const cacheKey = getTextureCacheKey(textureSourcePath, textureColorSpace);
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  const textureResource = await loadTextureAtPath(
    device,
    resolveTextureReferencePath(modelPath, textureSourcePath),
    fileProvider,
    textureColorSpace,
  );
  if (textureResource) {
    textureCache.set(cacheKey, textureResource);
  }
  return textureResource;
}

/**
 * マテリアルが参照する面の重心を求めます。
 * @param {object} model - モデルデータ。
 * @param {number} indexOffset - 面インデックスの開始位置。
 * @param {number} indexCount - 面インデックス数。
 * @returns {number[]} モデル空間の重心。
 */
function computeMaterialSortCenter(model, indexOffset, indexCount) {
  if (!model.vertices || !model.indices || indexCount <= 0) {
    return [0, 0, 0];
  }

  const stride = 27;
  const end = indexOffset + indexCount;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;

  for (let i = indexOffset; i < end; i++) {
    const vertexIndex = model.indices[i];
    const base = vertexIndex * stride;
    sumX += model.vertices[base + 0];
    sumY += model.vertices[base + 1];
    sumZ += model.vertices[base + 2];
    count++;
  }

  if (count === 0) {
    return [0, 0, 0];
  }

  return [sumX / count, sumY / count, sumZ / count];
}

/**
 * スフィアテクスチャをロードします。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} modelPath - モデルパス。
 * @param {object} model - モデルデータ。
 * @param {number} textureIndex - テクスチャ番号。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @returns {Promise<{texture: GPUTexture|null, isSphere: boolean}>} 結果。
 */
export async function loadSphereTexture(
  device,
  modelPath,
  model,
  textureIndex,
  textureCache,
  fileProvider,
  textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE,
) {
  const textureSourcePath = getTextureSourcePath(model, textureIndex);
  if (textureIndex < 0 || !textureSourcePath) {
    return { texture: null, isSphere: false };
  }

  const baseName = textureSourcePath.split('.').slice(0, -1).join('.');
  const isSphere = baseName.endsWith('_s') || baseName.endsWith('_S');
  const resource = await loadTextureResource(device, modelPath, model, textureIndex, textureCache, fileProvider, textureColorSpace);
  return {
    texture: resource?.texture ?? null,
    isSphere,
  };
}

/**
 * テクスチャ参照を直接ロードします。
 * @param {GPUDevice} device - GPU デバイス。
 * @param {string} modelPath - モデル基準パス。
 * @param {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace?: 'gamma-2.2'|'none'}|null} reference - テクスチャ参照。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @returns {Promise<GPUTexture|null>} テクスチャ。
 */
export async function loadTextureFromReference(
  device,
  modelPath,
  reference,
  textureCache,
  fileProvider,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
) {
  const resource = await loadTextureResourceFromReference(
    device,
    modelPath,
    reference,
    textureCache,
    fileProvider,
    internalToonTextureCache,
  );
  return resource?.texture ?? null;
}

/**
 * テクスチャ参照を直接ロードし、resource を返します。
 * @param {GPUDevice} device - GPU デバイス。
 * @param {string} modelPath - モデル基準パス。
 * @param {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace?: 'gamma-2.2'|'none'}|null} reference - テクスチャ参照。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @returns {Promise<TextureResource|null>} テクスチャ resource。
 */
export async function loadTextureResourceFromReference(
  device,
  modelPath,
  reference,
  textureCache,
  fileProvider,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
) {
  if (!reference) {
    return null;
  }
  if (reference.kind === 'internal') {
    return await loadSharedInternalToonTextureResource(device, reference.toonIndex, internalToonTextureCache);
  }
  if (reference.kind === 'path') {
    const colorSpace = reference.colorSpace || DEFAULT_TEXTURE_COLOR_SPACE;
    const resolvedPath = resolveTextureReferencePath(modelPath, reference.path);
    const cacheKey = getTextureCacheKey(resolvedPath, colorSpace);
    if (textureCache.has(cacheKey)) {
      return textureCache.get(cacheKey) ?? null;
    }

    const resource = await loadTextureFromPath(device, resolvedPath, fileProvider, colorSpace);
    if (resource) {
      textureCache.set(cacheKey, resource);
    }
    return resource ?? null;
  }
  return null;
}

/**
 * VRM shadeMultiplyTexture をロードします。
 * @param {GPUDevice} device - GPU デバイス。
 * @param {string} modelPath - モデル基準パス。
 * @param {object} model - モデルデータ。
 * @param {object} material - マテリアル。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @returns {Promise<GPUTexture|null>} テクスチャ。
 */
async function loadShadeMultiplyTexture(device, modelPath, model, material, textureCache, fileProvider) {
  const shadeReference = resolveMaterialShadeMultiplyTextureReference(modelPath, model, material);
  return await loadTextureFromReference(device, modelPath, shadeReference, textureCache, fileProvider);
}

/**
 * Toon テクスチャをロードします。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} modelPath - モデルパス。
 * @param {object} model - モデルデータ。
 * @param {object} material - マテリアル。
 * @param {Map<string, TextureResource>} textureCache - キャッシュ。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @param {Array<string>|null} [textureColorSpaces=null] - texture index ごとの色空間設定。
 * @returns {Promise<GPUTexture|null>} テクスチャ。
 */
export async function loadToonTexture(
  device,
  modelPath,
  model,
  material,
  textureCache,
  fileProvider,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
  textureColorSpaces = null,
) {
  const toonReference = resolveMaterialToonTextureReference(modelPath, model, material);
  return await loadTextureFromReference(device, modelPath, toonReference, textureCache, fileProvider, internalToonTextureCache);
}

/**
 * 内部 toon テクスチャを先読みします。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @returns {Promise<Map<string, TextureResource>>} 先読み後のキャッシュ。
 */
export async function preloadInternalToonTextures(
  device,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
) {
  await Promise.all(
    Array.from({ length: INTERNAL_TOON_TEXTURE_COUNT }, (_, toonIndex) => (
      loadSharedInternalToonTexture(device, toonIndex, internalToonTextureCache)
    )),
  );
  return internalToonTextureCache;
}

/**
 * 指定パスの画像を GPU テクスチャ化します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {string} path - 画像パス。
 * @param {object|null} fileProvider - ZIP 内ファイルプロバイダー。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @returns {Promise<TextureResource|null>} GPU テクスチャと alpha 情報。
 */
async function loadTextureAtPath(device, path, fileProvider, textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE) {
  try {
    const normalizedPath = path.replace(/\\/g, '/').trim();
    let blob;
    if (isDataUri(normalizedPath)) {
      const response = await fetch(normalizedPath);
      if (!response.ok) {
        return null;
      }
      blob = await response.blob();
    } else if (fileProvider) {
      blob = await readFileProviderBlob(fileProvider, normalizedPath);
      if (!blob) {
        return null;
      }
    } else {
      const response = await fetch(normalizedPath);
      if (!response.ok) {
        return null;
      }
      blob = await response.blob();
    }

    let source;
    if (normalizedPath.toLowerCase().endsWith('.tga')) {
      const arrayBuffer = await blob.arrayBuffer();
      const tga = new TGA();
      try {
        tga.load(new Uint8Array(arrayBuffer));
        const result = tga.getImageData();
        if (!hasValidTextureSize(result)) {
          console.warn('Skipping empty TGA texture:', normalizedPath);
          return null;
        }
        const alphaMode = imageDataAlphaMode(result.data);
        const imageData = new ImageData(result.data, result.width, result.height);
        return createTextureResourceFromImageData(
          device,
          imageData,
          alphaMode,
          textureColorSpace,
          createPreviewUrlFromSource(imageData),
        );
      } catch (error) {
        console.error('TGA decode failed:', normalizedPath, error);
        return null;
      }
    } else if (normalizedPath.toLowerCase().endsWith('.dds')) {
      const arrayBuffer = await blob.arrayBuffer();
      try {
        const dds = parseDDS(arrayBuffer);
        if (!hasValidTextureSize(dds) || !Array.isArray(dds.mipmaps) || dds.mipmaps.length === 0) {
          console.warn('Skipping empty DDS texture:', normalizedPath);
          return null;
        }
        const format = resolveTextureFormat(dds.format, textureColorSpace);
        const texture = device.createTexture({
          size: [dds.width, dds.height],
          format,
          mipLevelCount: dds.mipmaps.length,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        for (let i = 0; i < dds.mipmaps.length; i++) {
          const mip = dds.mipmaps[i];
          const blockBytes = dds.format === 'bc1-rgba-unorm' ? 8 : 16;
          device.queue.writeTexture(
            { texture, mipLevel: i },
            mip.data,
            { bytesPerRow: Math.max(1, Math.ceil(mip.width / 4)) * blockBytes },
            [mip.width, mip.height],
          );
        }
        return {
          texture,
          alphaMode: ddsFormatAlphaMode(dds.format),
          colorSpace: textureColorSpace,
          previewUrl: '',
        };
      } catch (error) {
        console.error('DDS decode failed:', normalizedPath, error);
        return null;
      }
    } else {
      source = await createImageBitmap(blob);
    }

    if (!hasValidTextureSize(source)) {
      console.warn('Skipping empty texture image:', normalizedPath);
      return null;
    }

    return createTextureResourceFromSource(
      device,
      source,
      await sourceAlphaMode(source),
      textureColorSpace,
      createPreviewUrlFromSource(source),
    );
  } catch (error) {
    console.error('Texture load failed:', path, error);
    return null;
  }
}

/**
 * fileProvider から Blob を読み込みます。
 * @param {object} fileProvider - ZIP 内ファイルプロバイダーまたは ZIP エントリ一覧。
 * @param {string} path - 読み込み対象パス。
 * @returns {Promise<Blob|null>} 読み込み結果。
 */
async function readFileProviderBlob(fileProvider, path) {
  const providerPath = String(path || '').startsWith('./') ? String(path || '').substring(2) : String(path || '');
  if (!providerPath) {
    return null;
  }

  if (typeof fileProvider?.getFile === 'function') {
    return await fileProvider.getFile(providerPath);
  }

  if (typeof fileProvider?.async === 'function') {
    return await fileProvider.async('blob');
  }

  if (fileProvider && typeof fileProvider === 'object') {
    const entry = findZipFileEntry(fileProvider, providerPath);
    if (entry && typeof entry.async === 'function') {
      return await entry.async('blob');
    }
  }

  return null;
}

/**
 * ZIP エントリ一覧からファイルを探します。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 検索対象パス。
 * @returns {object|null} ZIP エントリ。
 */
function findZipFileEntry(zipFiles, path) {
  const normalizedPath = String(path || '').replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return null;
  }

  if (zipFiles[normalizedPath]) {
    return zipFiles[normalizedPath];
  }

  const lowerPath = normalizedPath.toLowerCase();
  const exactMatchKey = Object.keys(zipFiles).find((key) => String(key || '').replace(/\\/g, '/').trim().toLowerCase() === lowerPath);
  if (exactMatchKey) {
    return zipFiles[exactMatchKey];
  }

  const basename = normalizedPath.split('/').pop()?.toLowerCase() || '';
  if (!basename) {
    return null;
  }

  const basenameMatchKey = Object.keys(zipFiles).find((key) => String(key || '').split('/').pop()?.toLowerCase() === basename);
  return basenameMatchKey ? zipFiles[basenameMatchKey] : null;
}

/**
 * data URI かどうかを判定します。
 * @param {string} value - 判定対象文字列。
 * @returns {boolean} data URI なら true。
 */
function isDataUri(value) {
  return typeof value === 'string' && /^data:/i.test(value);
}

/**
 * テクスチャリソース。
 * @typedef {object} TextureResource
 * @property {GPUTexture} texture - GPU テクスチャ。
 * @property {'opaque'|'cutout'|'transparent'} alphaMode - 画像の alpha 判定。
 * @property {'gamma-2.2'|'none'} colorSpace - 変換モード。
 * @property {string} [previewUrl] - サムネイル用 data URL。
 */

/**
 * 画像ソースから GPU テクスチャを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {ImageBitmap} source - 画像ソース。
 * @param {'opaque'|'cutout'|'transparent'} alphaMode - 画像の alpha 判定。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @param {string} [previewUrl=''] - サムネイル URL。
 * @returns {TextureResource|null} テクスチャリソース。
 */
function createTextureResourceFromSource(device, source, alphaMode, textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE, previewUrl = '') {
  if (!hasValidTextureSize(source)) {
    return null;
  }

  const texture = device.createTexture({
    size: [source.width, source.height],
    format: resolveTextureFormat('rgba8unorm', textureColorSpace),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source }, { texture }, [source.width, source.height]);
  return { texture, alphaMode, colorSpace: textureColorSpace, previewUrl };
}

/**
 * RGBA ピクセルデータから GPU テクスチャを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {ImageData} source - RGBA 画像データ。
 * @param {'opaque'|'cutout'|'transparent'} alphaMode - 画像の alpha 判定。
 * @param {'gamma-2.2'|'none'} [textureColorSpace='gamma-2.2'] - 変換モード。
 * @param {string} [previewUrl=''] - サムネイル URL。
 * @returns {TextureResource|null} テクスチャリソース。
 */
function createTextureResourceFromImageData(device, source, alphaMode, textureColorSpace = DEFAULT_TEXTURE_COLOR_SPACE, previewUrl = '') {
  if (!hasValidTextureSize(source)) {
    return null;
  }

  const texture = device.createTexture({
    size: [source.width, source.height],
    format: resolveTextureFormat('rgba8unorm', textureColorSpace),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.writeTexture(
    { texture },
    source.data,
    { bytesPerRow: source.width * 4 },
    [source.width, source.height],
  );
  return { texture, alphaMode, colorSpace: textureColorSpace, previewUrl };
}

/**
 * 材質 bind group を組み立てます。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUBindGroupLayout} matBindGroupLayout - マテリアル bind group layout。
 * @param {GPUBuffer} materialBuffer - マテリアル uniform buffer。
 * @param {GPUTexture} baseTexture - base texture。
 * @param {GPUTexture} toonTexture - toon texture。
 * @param {GPUTexture} sphereTexture - sphere texture。
 * @param {GPUTexture} emissiveTexture - emissive texture。
 * @param {GPUTexture} shadeMultiplyTexture - shade multiply texture。
 * @returns {GPUBindGroup} bind group。
 */
export function createMaterialBindGroup(
  device,
  matBindGroupLayout,
  materialBuffer,
  baseTexture,
  toonTexture,
  sphereTexture,
  emissiveTexture,
  shadeMultiplyTexture,
) {
  return device.createBindGroup({
    layout: matBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: materialBuffer } },
      { binding: 1, resource: baseTexture.createView() },
      { binding: 2, resource: toonTexture.createView() },
      { binding: 3, resource: sphereTexture.createView() },
      { binding: 4, resource: emissiveTexture.createView() },
      { binding: 5, resource: shadeMultiplyTexture.createView() },
    ],
  });
}

/**
 * ImageData の alpha チャンネルを分類します。
 * @param {Uint8ClampedArray} data - RGBA ピクセルデータ。
 * @returns {'opaque'|'cutout'|'transparent'} alpha 判定。
 */
function imageDataAlphaMode(data) {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) {
      hasAlpha = true;
      continue;
    }
    if (data[i] < 255) {
      return 'transparent';
    }
    hasAlpha = true;
  }
  return hasAlpha ? 'cutout' : 'opaque';
}

/**
 * 画像ソースの alpha を分類します。
 * @param {ImageBitmap} source - 画像ソース。
 * @returns {Promise<'opaque'|'cutout'|'transparent'>} alpha 判定。
 */
async function sourceAlphaMode(source) {
  if (typeof source.width !== 'number' || typeof source.height !== 'number') {
    return 'opaque';
  }

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(source.width, source.height)
    : typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;
  if (!canvas) {
    return 'opaque';
  }
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return 'opaque';
  }

  context.clearRect(0, 0, source.width, source.height);
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, source.width, source.height);
  return imageDataAlphaMode(imageData.data);
}

/**
 * 画像ソースからサムネイル用 data URL を作成します。
 * @param {ImageBitmap|ImageData} source - 画像ソース。
 * @returns {string} data URL。
 */
function createPreviewUrlFromSource(source) {
  if (typeof document === 'undefined' || !source || typeof source.width !== 'number' || typeof source.height !== 'number') {
    return '';
  }

  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }

  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    context.putImageData(source, 0, 0);
  } else {
    context.drawImage(source, 0, 0);
  }

  try {
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Preview generation failed:', error);
    return '';
  }
}

/**
 * テクスチャパスの表示名を返します。
 * @param {string} texturePath - テクスチャパス。
 * @param {number} textureIndex - texture index。
 * @returns {string} 表示名。
 */
function getTextureDisplayName(texturePath, textureIndex) {
  const normalizedPath = String(texturePath || '').replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return `Texture ${textureIndex}`;
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
}

/**
 * DDS フォーマットの alpha を分類します。
 * @param {string} format - DDS フォーマット。
 * @returns {'opaque'|'cutout'|'transparent'} alpha 判定。
 */
function ddsFormatAlphaMode(format) {
  if (format === 'bc2-rgba-unorm' || format === 'bc3-rgba-unorm' || format === 'bc7-rgba-unorm') {
    return 'transparent';
  }
  if (format === 'bc1-rgba-unorm') {
    return 'cutout';
  }
  return 'opaque';
}

/**
 * glTF/PMX 材質の alpha モードをまとめます。
 * @param {string|undefined|null} materialAlphaMode - 材質由来の alpha モード。
 * @param {string|undefined|null} textureAlphaMode - テクスチャ由来の alpha モード。
 * @returns {'opaque'|'cutout'|'transparent'} 正規化済み alpha モード。
 */
function resolveAlphaMode(materialAlphaMode, textureAlphaMode) {
  const normalizedMaterialMode = normalizeAlphaMode(materialAlphaMode);
  const normalizedTextureMode = normalizeAlphaMode(textureAlphaMode);
  return normalizedTextureMode !== 'opaque' ? normalizedTextureMode : normalizedMaterialMode;
}

/**
 * alpha モード名を正規化します。
 * @param {string|undefined|null} alphaMode - 元の alpha モード。
 * @returns {'opaque'|'cutout'|'transparent'} 正規化済み alpha モード。
 */
function normalizeAlphaMode(alphaMode) {
  const lower = String(alphaMode || '').toLowerCase();
  if (lower === 'cutout' || lower === 'mask') {
    return 'cutout';
  }
  if (lower === 'transparent' || lower === 'blend') {
    return 'transparent';
  }
  return 'opaque';
}

/**
 * texture cache のキーを作成します。
 * @param {string} texturePath - テクスチャパス。
 * @param {'gamma-2.2'|'none'} textureColorSpace - 変換モード。
 * @returns {string} キャッシュキー。
 */
function getTextureCacheKey(texturePath, textureColorSpace) {
  return `${textureColorSpace}:${texturePath}`;
}

/**
 * モデルの texture source パスを返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} textureIndex - texture index。
 * @returns {string} texture source パス。
 */
function getTextureSourcePath(model, textureIndex) {
  const textureSources = Array.isArray(model?.textureSources) ? model.textureSources : [];
  const sourcePath = String(textureSources[textureIndex] || '').trim();
  if (sourcePath) {
    return sourcePath;
  }

  return String(model?.textures?.[textureIndex] || '').trim();
}

/**
 * texture index に対する色空間を返します。
 * @param {Array<string>|null} textureColorSpaces - 色空間一覧。
 * @param {number} textureIndex - texture index。
 * @returns {'gamma-2.2'|'none'} 変換モード。
 */
function getTextureColorSpace(textureColorSpaces, textureIndex) {
  const value = textureColorSpaces?.[textureIndex];
  return normalizeTextureColorSpace(value);
}

/**
 * texture color space を正規化します。
 * @param {string|undefined|null} textureColorSpace - 入力値。
 * @returns {'gamma-2.2'|'none'} 正規化済み値。
 */
function normalizeTextureColorSpace(textureColorSpace) {
  return String(textureColorSpace || DEFAULT_TEXTURE_COLOR_SPACE).toLowerCase() === 'none'
    ? 'none'
    : DEFAULT_TEXTURE_COLOR_SPACE;
}

/**
 * 色空間に応じた texture format を返します。
 * @param {string} baseFormat - 元の format。
 * @param {'gamma-2.2'|'none'} textureColorSpace - 変換モード。
 * @returns {string} texture format。
 */
function resolveTextureFormat(baseFormat, textureColorSpace) {
  if (textureColorSpace === 'none') {
    return baseFormat;
  }
  return SRGB_TEXTURE_FORMATS.get(baseFormat) || `${baseFormat}-srgb`;
}

/**
 * テクスチャ参照を解決します。
 * @param {string} modelPath - モデル基準パス。
 * @param {string} texturePath - テクスチャパス。
 * @returns {string} 解決済みパス。
 */
function resolveTextureReferencePath(modelPath, texturePath) {
  const normalizedPath = String(texturePath || '').replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return normalizedPath;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalizedPath) || normalizedPath.startsWith('/')) {
    return normalizedPath;
  }
  return `${modelPath}${normalizedPath}`;
}

/**
 * テクスチャと同じ場所にある同名 BMP の toon パスを解決します。
 * @param {string} modelPath - モデル基準パス。
 * @param {string} texturePath - 元のテクスチャパス。
 * @returns {string} 解決済み BMP パス。
 */
function resolveAdjacentToonTexturePath(modelPath, texturePath) {
  const resolvedTexturePath = resolveTextureReferencePath(modelPath, texturePath);
  if (!resolvedTexturePath) {
    return '';
  }

  const dotIndex = resolvedTexturePath.lastIndexOf('.');
  const basePath = dotIndex >= 0 ? resolvedTexturePath.slice(0, dotIndex) : resolvedTexturePath;
  return `${basePath}.bmp`;
}

/**
 * toon 用 texture かどうかを判定します。
 * @param {string} texturePath - テクスチャパス。
 * @returns {boolean} toon 用なら true。
 */
function isToonTexturePath(texturePath) {
  const normalizedPath = String(texturePath || '').replace(/\\/g, '/').trim().toLowerCase();
  if (!normalizedPath) {
    return false;
  }
  return normalizedPath.split('/').some((segment) => segment.includes('toon'));
}

/**
 * 共有内部 toon テクスチャのパスを返します。
 * @param {number} toonIndex - toon インデックス。
 * @returns {string} 内部 toon パス。
 */
function getSharedInternalToonTexturePath(toonIndex) {
  if (!Number.isInteger(toonIndex) || toonIndex < 0 || toonIndex >= INTERNAL_TOON_TEXTURE_COUNT) {
    return '';
  }

  const toonNumber = toonIndex + 1;
  return `toon-textures/toon${String(toonNumber).padStart(2, '0')}.bmp`;
}

/**
 * 共有内部 toon テクスチャを読み込みます。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {number} toonIndex - toon インデックス。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @returns {Promise<GPUTexture|null>} テクスチャ。
 */
async function loadSharedInternalToonTexture(
  device,
  toonIndex,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
) {
  const resource = await loadSharedInternalToonTextureResource(device, toonIndex, internalToonTextureCache);
  return resource?.texture ?? null;
}

/**
 * 共有内部 toon テクスチャ resource を読み込みます。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {number} toonIndex - toon インデックス。
 * @param {Map<string, TextureResource>} [internalToonTextureCache=DEFAULT_INTERNAL_TOON_TEXTURE_CACHE] - 共有内部 toon キャッシュ。
 * @returns {Promise<TextureResource|null>} テクスチャ resource。
 */
async function loadSharedInternalToonTextureResource(
  device,
  toonIndex,
  internalToonTextureCache = DEFAULT_INTERNAL_TOON_TEXTURE_CACHE,
) {
  const toonPath = getSharedInternalToonTexturePath(toonIndex);
  if (!toonPath) {
    return null;
  }

  const cachedToon = internalToonTextureCache.get(toonPath);
  if (cachedToon) {
    return cachedToon;
  }

  const internalToonResource = await loadTextureAtPath(device, toonPath, null);
  if (internalToonResource) {
    internalToonTextureCache.set(toonPath, internalToonResource);
    return internalToonResource;
  }

  return null;
}
