import {
  createEmptyVmdDocument,
  ensureAnimationClip,
  formatVmdExportWarnings,
  serializeAnimationClipToVmd,
  syncVmdAnimationClip,
} from '../../core/animation/animation-clip.js';
import { applyAnimationMappingToController } from '../../core/animation/animation-mapper.js';
import { refreshSceneIkState } from '../../core/model/model-scene.js';
import { VMDLoader } from '../../infrastructure/loaders/vmd-loader.js';
import { VMDWriter } from '../../infrastructure/loaders/vmd-writer.js';
import { VRMALoader } from '../../infrastructure/loaders/vrma-loader.js';
import { VRMAWriter } from '../../infrastructure/loaders/vrma-writer.js';
import {
  denormalizeVmdFromInternalUnits,
  normalizeVmdToInternalUnits,
} from '../../infrastructure/units/unit-conversion.js';

/**
 * VMD source を構築します。
 * @param {string} name - source 名。
 * @param {object|null} data - VMD データ。
 * @returns {object} 共通 animation source。
 */
export function createVmdAnimationSource(name, data = null, clip = null, options = {}) {
  const animationClip = clip || (data ? ensureAnimationClip(data) : null);
  return {
    kind: 'vmd',
    name: String(name || '').trim() || null,
    data: data || null,
    clip: animationClip,
    targetType: String(options?.targetType || 'model').trim() || 'model',
  };
}

/**
 * animation source を正規化します。
 * @param {object|null} source - 入力 source。
 * @returns {object|null} 正規化済み source。
 */
export function normalizeAnimationSource(source) {
  if (!source) {
    return null;
  }

  const kind = String(source.kind || '').trim();
  if (kind === 'vmd') {
    return createVmdAnimationSource(source.name, source.data || null, source.clip || null, {
      targetType: source.targetType,
    });
  }

  return {
    ...source,
    kind: kind || 'gltf',
    name: String(source.name || '').trim() || null,
    clip: source.clip || null,
    targetType: String(source.targetType || 'model').trim() || 'model',
  };
}

/**
 * File から animation source を読み込みます。
 * @param {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} file - 入力ファイル。
 * @returns {Promise<object>} animation source。
 */
export async function loadAnimationSourceFromFile(file) {
  const fileName = String(file?.name || '');
  if (fileName.toLowerCase().endsWith('.vrma')) {
    const loader = new VRMALoader();
    const buffer = await file.arrayBuffer();
    return normalizeAnimationSource(await loader.parse(buffer, fileName));
  }

  const loader = new VMDLoader();
  const buffer = await file.arrayBuffer();
  const vmdData = normalizeVmdToInternalUnits(loader.parse(buffer));
  return createVmdAnimationSource(fileName, vmdData);
}

/**
 * ZIP から animation source 群を読み込みます。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<object[]>} animation source 一覧。
 */
export async function loadAnimationSourcesFromZip(zipFiles) {
  const sources = [];
  const vmdLoader = new VMDLoader();

  for (const [path, file] of Object.entries(zipFiles || {})) {
    const lowerPath = String(path || '').toLowerCase();
    const name = String(path || '').split('/').pop();
    if (lowerPath.endsWith('.vmd')) {
      const buffer = await file.async('arraybuffer');
      const vmdData = normalizeVmdToInternalUnits(vmdLoader.parse(buffer));
      sources.push(createVmdAnimationSource(name, vmdData));
      continue;
    }
    if (lowerPath.endsWith('.vrma')) {
      const buffer = await file.async('arraybuffer');
      const source = await new VRMALoader().parse(buffer, name);
      sources.push(normalizeAnimationSource(source));
    }
  }

  return sources;
}

/**
 * instance に保持されている状態から animation source を再構築します。
 * @param {object|null} instance - モデルインスタンス。
 * @returns {object|null} animation source。
 */
export function deriveAnimationSourceFromRuntimeInstance(instance) {
  if (!instance) {
    return null;
  }

  if (instance.animationSource) {
    return normalizeAnimationSource(instance.animationSource);
  }

  if (instance.animationSourceKind === 'vmd' || instance.animationSourceType === 'vmd' || instance.vmd) {
    return createVmdAnimationSource(instance.vmdName || instance.animationSourceName, instance.vmd || null, null, {
      targetType: 'model',
    });
  }
  return null;
}

/**
 * 読み込んだ VMD ドキュメントを編集単位ごとの source 群へ分割します。
 * @param {string} name - 元ファイル名。
 * @param {object|null} vmdData - 読み込んだ VMD データ。
 * @returns {object[]} 分割済み animation source 一覧。
 */
export function splitVmdDocumentIntoAnimationSources(name, vmdData) {
  if (!vmdData || typeof vmdData !== 'object') {
    return [];
  }

  const modelName = String(vmdData.modelName || 'Default');
  const signature = String(vmdData.signature || 'Vocaloid Motion Data 0002');
  const baseName = String(name || '').trim() || 'animation.vmd';
  const sources = [];

  const groups = [
    {
      targetType: 'model',
      boneKeyframes: Array.isArray(vmdData.boneKeyframes) ? vmdData.boneKeyframes : [],
      faceKeyframes: Array.isArray(vmdData.faceKeyframes) ? vmdData.faceKeyframes : [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: [],
    },
    {
      targetType: 'camera',
      boneKeyframes: [],
      faceKeyframes: [],
      cameraKeyframes: Array.isArray(vmdData.cameraKeyframes) ? vmdData.cameraKeyframes : [],
      lightKeyframes: [],
      selfShadowKeyframes: [],
    },
    {
      targetType: 'light',
      boneKeyframes: [],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: Array.isArray(vmdData.lightKeyframes) ? vmdData.lightKeyframes : [],
      selfShadowKeyframes: [],
    },
    {
      targetType: 'shadow',
      boneKeyframes: [],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: Array.isArray(vmdData.selfShadowKeyframes) ? vmdData.selfShadowKeyframes : [],
    },
  ];

  for (const group of groups) {
    const hasContent = group.boneKeyframes.length > 0
      || group.faceKeyframes.length > 0
      || group.cameraKeyframes.length > 0
      || group.lightKeyframes.length > 0
      || group.selfShadowKeyframes.length > 0;
    if (!hasContent) {
      continue;
    }

    const partialVmd = createEmptyVmdDocument(modelName);
    partialVmd.signature = signature;
    partialVmd.modelName = modelName;
    partialVmd.boneKeyframes = group.boneKeyframes.map((keyframe) => ({ ...keyframe }));
    partialVmd.motions = partialVmd.boneKeyframes;
    partialVmd.faceKeyframes = group.faceKeyframes.map((keyframe) => ({ ...keyframe }));
    partialVmd.morphs = partialVmd.faceKeyframes;
    partialVmd.faces = partialVmd.faceKeyframes;
    partialVmd.cameraKeyframes = group.cameraKeyframes.map((keyframe) => ({ ...keyframe }));
    partialVmd.lightKeyframes = group.lightKeyframes.map((keyframe) => ({ ...keyframe }));
    partialVmd.selfShadowKeyframes = group.selfShadowKeyframes.map((keyframe) => ({ ...keyframe }));
    syncVmdAnimationClip(partialVmd);
    sources.push(createVmdAnimationSource(baseName, partialVmd, null, {
      targetType: group.targetType,
    }));
  }

  return sources;
}

/**
 * VMD source の legacy raw document を clip から再構成します。
 * @param {object|null} source - animation source。
 * @returns {object|null} 同期済み source。
 */
export function syncLegacyVmdDataFromAnimationSource(source) {
  if (String(source?.kind || '').trim() !== 'vmd' || !source?.clip) {
    return source;
  }

  const exportResult = serializeAnimationClipToVmd(source.clip);
  const serializedVmd = exportResult?.vmd || null;
  if (!serializedVmd) {
    source.data = null;
    return source;
  }

  let vmd = source.data && typeof source.data === 'object'
    ? source.data
    : null;
  if (!vmd) {
    vmd = serializedVmd;
  } else {
    vmd.signature = serializedVmd.signature;
    vmd.modelName = serializedVmd.modelName;
    vmd.boneKeyframes = serializedVmd.boneKeyframes;
    vmd.motions = serializedVmd.motions || serializedVmd.boneKeyframes;
    vmd.faceKeyframes = serializedVmd.faceKeyframes;
    vmd.morphs = serializedVmd.morphs || serializedVmd.faceKeyframes;
    vmd.faces = serializedVmd.faces || serializedVmd.faceKeyframes;
    vmd.cameraKeyframes = serializedVmd.cameraKeyframes;
    vmd.lightKeyframes = serializedVmd.lightKeyframes;
    vmd.selfShadowKeyframes = serializedVmd.selfShadowKeyframes;
  }
  vmd.animationClip = source.clip;
  source.data = vmd;
  return source;
}

/**
 * animation source を指定 instance へ割り当てます。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} source - animation source。
 * @param {object} [options={}] - 割り当てオプション。
 * @param {boolean} [options.syncVrmaIkState=true] - VRMA 時の IK state を同期するなら true。
 * @returns {object|null} 正規化済み animation source。
 */
export function assignAnimationSourceToRuntimeInstance(instance, source, options = {}) {
  const inst = instance || null;
  if (!inst) {
    return null;
  }

  const normalizedSource = normalizeAnimationSource(source);
  if (options.syncVrmaIkState !== false) {
    syncVrmaIkState(inst, normalizedSource);
  }

  if (!normalizedSource) {
    inst.vmd = null;
    inst.vmdName = null;
    inst.animationSource = null;
    inst.animationSourceName = null;
    inst.animationSourceKind = null;
    inst.animationSourceType = null;
    inst.animationController?.setAnimationSource?.(null);
    inst.animationController?.setAnimationClip?.(null);
    applyAnimationMappingToController(inst, null);
    return null;
  }

  inst.animationSource = normalizedSource;
  inst.animationSourceName = normalizedSource.name || null;
  inst.animationSourceKind = normalizedSource.kind || 'gltf';
  inst.animationSourceType = inst.animationSourceKind;

  if (normalizedSource.kind === 'vmd') {
    if (!normalizedSource.data && normalizedSource.clip) {
      syncLegacyVmdDataFromAnimationSource(normalizedSource);
    }
    inst.vmd = normalizedSource.data || null;
    inst.vmdName = normalizedSource.name || null;
    inst.animationController?.setAnimationSource?.(normalizedSource);
    if (!inst.animationController?.setAnimationSource) {
      inst.animationController?.setVmd?.(inst.vmd);
    }
  } else {
    inst.vmd = null;
    inst.vmdName = null;
    inst.animationController?.setAnimationSource?.(normalizedSource);
    if (!inst.animationController?.setAnimationSource) {
      inst.animationController?.setAnimationClip?.(normalizedSource.clip || null);
    }
  }

  applyAnimationMappingToController(inst, normalizedSource);
  return normalizedSource;
}

/**
 * instance の現在 source を再反映します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object} [options={}] - 再反映オプション。
 * @returns {object|null} 再反映した source。
 */
export function rebindAnimationSourceToRuntimeInstance(instance, options = {}) {
  return assignAnimationSourceToRuntimeInstance(
    instance,
    deriveAnimationSourceFromRuntimeInstance(instance),
    options,
  );
}

/**
 * VRMA 適用時の IK state を同期します。
 * @param {object|null} instance - モデルインスタンス。
 * @param {object|null} source - 次の animation source。
 */
export function syncVrmaIkState(instance, source) {
  const inst = instance || null;
  if (!Array.isArray(inst?.model?.ik)) {
    return;
  }

  const nextSourceKind = String(source?.kind || '').trim();
  const shouldDisableIk = nextSourceKind === 'vrma' && source?.preserveIkEnabled !== true;
  if (shouldDisableIk) {
    if (!Array.isArray(inst._vrmaStoredIkEnabledStates)) {
      inst._vrmaStoredIkEnabledStates = inst.model.ik.map((ik) => ik?.enabled !== false);
    }
    for (const ik of inst.model.ik) {
      if (ik) {
        ik.enabled = false;
      }
    }
    refreshSceneIkState(inst.scene, inst.model);
    return;
  }

  if (!Array.isArray(inst._vrmaStoredIkEnabledStates)) {
    return;
  }

  for (let index = 0; index < inst.model.ik.length; index++) {
    const ik = inst.model.ik[index];
    if (ik) {
      ik.enabled = inst._vrmaStoredIkEnabledStates[index] !== false;
    }
  }
  inst._vrmaStoredIkEnabledStates = null;
  refreshSceneIkState(inst.scene, inst.model);
}

/**
 * VMD データをバッファへ書き出します。
 * @param {object} data - VMD データ。
 * @returns {{buffer: ArrayBuffer, warnings: object[]}} 書き出し結果。
 */
export function exportAnimationDataAsVmdBuffer(data) {
  const writer = new VMDWriter();
  const buffer = writer.write(denormalizeVmdFromInternalUnits(data));
  return {
    buffer,
    warnings: writer.lastWarnings || [],
  };
}

/**
 * VRMA データをバッファへ書き出します。
 * @param {object} options - 書き出しオプション。
 * @returns {Promise<{buffer: ArrayBuffer, warnings: object[], filename: string}>} 書き出し結果。
 */
export async function exportRuntimeAnimationAsVrma(options) {
  const writer = new VRMAWriter();
  const buffer = await writer.write(options?.source || options?.instance?.animationSource || null, options || {});
  return {
    buffer,
    warnings: writer.lastWarnings || [],
    filename: String(options?.filename || `${options?.instance?.model?.name || 'animation'}.vrma`),
  };
}

/**
 * VMD warning 一覧を整形します。
 * @param {Array<{name: string, warnings: object[]}>} warningResults - warning 一覧。
 * @returns {string} 表示用メッセージ。
 */
export function formatAnimationExportWarnings(warningResults) {
  return formatVmdExportWarnings(warningResults);
}
