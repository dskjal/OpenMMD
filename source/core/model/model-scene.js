import { mat4, quat, vec3 } from '../../lib/esm/index.js';
import { createVrmSpringBoneState } from '../physics/vrm-springbone.js';
import { PMXLoader } from '../../infrastructure/loaders/pmx-loader.js';
import { PMDLoader } from '../../infrastructure/loaders/pmd-loader.js';
import { GLTFModelLoader } from '../../infrastructure/loaders/gltf-loader.js';
import { VRMModelLoader } from '../../infrastructure/loaders/vrm-loader.js';
import { getCustomRigBoneNames } from './custom-rig.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';
import { createAabb, expandAabbWithPoint, getAabbSize, mat4Translation } from '../../shared/math/math-utils.js';
import { scaleModel } from '../../infrastructure/gpu/renderer-resources.js';
import { resolvePreferredChildBoneIndex, resolvePreferredTailBoneIndex } from '../../shared/bones/vrm-child-bone-utils.js';

const BONE_LINE_STRIDE = 24;
const INDICATOR_BUFFER_SIZE = 2000 * BONE_LINE_STRIDE;
const BONE_LOCAL_AXIS_EPSILON = 1e-6;
const DEFAULT_MMD_LENGTH_TO_METERS_SCALE = 0.07876027287775755;
const VRM_HUMANOID_BONE_MAP_ALERT_MESSAGE = 'VRM の humanoid ボーン対応情報を取得できませんでした。通常のボーン名検索に切り替えます。';
const VRM_HUMANOID_PREFERRED_AXIS_MAP = Object.freeze({
  leftLowerArm: 'y',
  rightLowerArm: 'y',
  leftThumbMetacarpal: 'y',
  leftThumbProximal: 'y',
  leftThumbDistal: 'y',
  rightThumbMetacarpal: 'y',
  rightThumbProximal: 'y',
  rightThumbDistal: 'y',
  leftIndexProximal: 'z',
  leftIndexIntermediate: 'z',
  leftIndexDistal: 'z',
  leftMiddleProximal: 'z',
  leftMiddleIntermediate: 'z',
  leftMiddleDistal: 'z',
  leftRingProximal: 'z',
  leftRingIntermediate: 'z',
  leftRingDistal: 'z',
  leftLittleProximal: 'z',
  leftLittleIntermediate: 'z',
  leftLittleDistal: 'z',
  rightIndexProximal: 'z',
  rightIndexIntermediate: 'z',
  rightIndexDistal: 'z',
  rightMiddleProximal: 'z',
  rightMiddleIntermediate: 'z',
  rightMiddleDistal: 'z',
  rightRingProximal: 'z',
  rightRingIntermediate: 'z',
  rightRingDistal: 'z',
  rightLittleProximal: 'z',
  rightLittleIntermediate: 'z',
  rightLittleDistal: 'z',
  leftLowerLeg: 'x',
  rightLowerLeg: 'x',
  leftFoot: 'x',
  rightFoot: 'x',
  leftToes: 'x',
  rightToes: 'x',
});

/**
 * モデルからボーンを index で取得します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - ボーン index。
 * @returns {object|null} ボーン。
 */
export function getBone(model, boneIndex) {
  if (!Array.isArray(model?.bones) || !Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= model.bones.length) {
    return null;
  }

  return model.bones[boneIndex] ?? null;
}

/**
 * モデルからボーン名で index を取得します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {string} boneName - ボーン名。
 * @returns {number} ボーン index。見つからない場合は -1。
 */
export function findBoneIndexByName(model, boneName) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName || !Array.isArray(model?.bones)) {
    return -1;
  }

  const vrmBoneIndex = findBoneIndexByVrmHumanoidName(model, normalizedBoneName);
  if (vrmBoneIndex >= 0) {
    return vrmBoneIndex;
  }

  notifyMissingVrmHumanoidBoneMap(model);
  return model.bones.findIndex((bone) => String(bone?.name || '').trim() === normalizedBoneName);
}

/**
 * モデルからボーン名でボーンを取得します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {string} boneName - ボーン名。
 * @returns {object|null} ボーン。
 */
export function getBoneByName(model, boneName) {
  const boneIndex = findBoneIndexByName(model, boneName);
  return boneIndex >= 0 ? getBone(model, boneIndex) : null;
}

/**
 * VRM humanoid ボーン名から実際の bone index を取得します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {string} boneName - VRM humanoid ボーン名。
 * @returns {number} bone index。見つからない場合は -1。
 */
function findBoneIndexByVrmHumanoidName(model, boneName) {
  const resolvedBoneName = String(model?.vrm?.humanoidBoneNameMap?.[boneName] || '').trim();
  if (!resolvedBoneName) {
    return -1;
  }

  return model.bones.findIndex((bone) => String(bone?.name || '').trim() === resolvedBoneName);
}

/**
 * VRM の実ボーン名から humanoid 名を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {string} boneName - 実ボーン名。
 * @returns {string} humanoid 名。見つからない場合は空文字。
 */
export function findVrmHumanoidBoneNameByBoneName(model, boneName) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName || model?.magic !== 'Vrm') {
    return '';
  }

  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap;
  if (!humanoidBoneNameMap || typeof humanoidBoneNameMap !== 'object') {
    return '';
  }

  for (const [humanoidBoneName, resolvedBoneName] of Object.entries(humanoidBoneNameMap)) {
    if (String(resolvedBoneName || '').trim() === normalizedBoneName) {
      return String(humanoidBoneName || '').trim();
    }
  }

  return '';
}

/**
 * VRM humanoid ボーン対応情報が無い場合に通知します。
 * @param {object|null|undefined} model - モデルデータ。
 */
function notifyMissingVrmHumanoidBoneMap(model) {
  if (model?.magic !== 'Vrm') {
    return;
  }

  if (!model?.vrm?.humanoidBoneMapMissing || model.vrm.humanoidBoneMapMissingNotified) {
    return;
  }

  model.vrm.humanoidBoneMapMissingNotified = true;
  if (typeof alert === 'function') {
    alert(VRM_HUMANOID_BONE_MAP_ALERT_MESSAGE);
  }
}

/**
 * モデルデータをロードします。
 * @param {object|null} zipFiles - ZIP 内ファイル一覧。
 * @param {number} unitScale - 単位スケール。
 * @param {string} modelFile - モデルファイル名。
 * @returns {Promise<{model: object, fileProvider: object|null}>} モデルとファイルプロバイダー。
 */
export async function loadModelData(zipFiles, unitScale, modelFile) {
  if (zipFiles) {
    return await loadModelDataFromZip(zipFiles, unitScale, modelFile);
  }

  const model = await loadModelDataFromPath(modelFile);
  return finalizeLoadedModel(model, unitScale);
}

/**
 * 単体ファイル入力からモデルを読み込みます。
 * @param {{name: string, arrayBuffer?: function(): Promise<ArrayBuffer>, text?: function(): Promise<string>}} file - 読み込み対象。
 * @param {number} unitScale - 単位スケール。
 * @returns {Promise<{model: object, fileProvider: object|null}>} モデルとファイルプロバイダー。
 */
export async function loadModelDataFromFile(file, unitScale) {
  if (!file || typeof file.name !== 'string') {
    throw new Error('Invalid model file.');
  }

  const lowerName = file.name.toLowerCase();
  let model;

  if (lowerName.endsWith('.vrm')) {
    const loader = new VRMModelLoader();
    model = await loader.parse(await readFileArrayBuffer(file), file.name, null);
  } else if (lowerName.endsWith('.glb')) {
    const loader = new GLTFModelLoader();
    model = await loader.parse(await readFileArrayBuffer(file), file.name, null);
  } else if (lowerName.endsWith('.gltf')) {
    const loader = new GLTFModelLoader();
    model = await loader.parse(await readFileText(file), file.name, null);
  } else if (lowerName.endsWith('.pmx')) {
    const loader = new PMXLoader();
    model = await loader.parse(await readFileArrayBuffer(file));
  } else if (lowerName.endsWith('.pmd')) {
    const loader = new PMDLoader();
    model = loader.parse(await readFileArrayBuffer(file));
  } else {
    throw new Error(`Unsupported model file: ${file.name}`);
  }

  return finalizeLoadedModel(model, unitScale);
}

/**
 * ZIP 内ファイル群からモデルを読み込みます。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @param {number} unitScale - 単位スケール。
 * @param {string} modelFile - モデルファイル名。
 * @returns {Promise<{model: object, fileProvider: object|null}>} モデルとファイルプロバイダー。
 */
async function loadModelDataFromZip(zipFiles, unitScale, modelFile) {
  const lowerFile = modelFile.toLowerCase();
  const fileProvider = createZipFileProvider(zipFiles, modelFile);
  const entry = getZipEntry(zipFiles, modelFile);
  if (!entry) {
    throw new Error(`Model file not found in ZIP: ${modelFile}`);
  }
  let model;

  if (lowerFile.endsWith('.vrm')) {
    const loader = new VRMModelLoader();
    model = await loader.parse(await entry.async('arraybuffer'), modelFile, fileProvider);
  } else if (lowerFile.endsWith('.glb')) {
    const loader = new GLTFModelLoader();
    model = await loader.parse(await entry.async('arraybuffer'), modelFile, fileProvider);
  } else if (lowerFile.endsWith('.gltf')) {
    const loader = new GLTFModelLoader();
    model = await loader.parse(await entry.async('text'), modelFile, fileProvider);
  } else if (lowerFile.endsWith('.pmx')) {
    const loader = new PMXLoader();
    model = await loader.parse(await entry.async('arraybuffer'));
  } else {
    const loader = new PMDLoader();
    model = loader.parse(await entry.async('arraybuffer'));
  }

  return finalizeLoadedModel(model, unitScale, fileProvider);
}

/**
 * ファイルパスからモデルを読み込みます。
 * @param {string} modelFile - モデルファイル名。
 * @returns {Promise<object>} モデルデータ。
 */
async function loadModelDataFromPath(modelFile) {
  const lowerFile = modelFile.toLowerCase();
  if (lowerFile.endsWith('.vrm')) {
    const loader = new VRMModelLoader();
    return await loader.load(modelFile, null);
  }
  if (lowerFile.endsWith('.glb') || lowerFile.endsWith('.gltf')) {
    const loader = new GLTFModelLoader();
    return await loader.load(modelFile, null);
  }

  const isPmx = lowerFile.endsWith('.pmx');
  const loader = isPmx ? new PMXLoader() : new PMDLoader();
  return isPmx ? await loader.load(modelFile) : loader.load(modelFile);
}

/**
 * 読み込んだモデルを実行時形式へ正規化します。
 * @param {object} model - モデルデータ。
 * @param {number} unitScale - 単位スケール。
 * @param {object|null} [fileProvider=null] - ファイルプロバイダー。
 * @returns {{model: object, fileProvider: object|null}} 正規化結果。
 */
function finalizeLoadedModel(model, unitScale, fileProvider = null) {
  initializeModelBoneReferences(model);
  normalizeModelIkChains(model);
  normalizeModelPhysics(model);
  inferMissingBoneLocalAxes(model);
  for (const bone of model.bones) {
    initializeBoneRotationLocks(model, bone);
  }
  applyVrmDefaultIkChains(model);

  model.customRigBones = getCustomRigBoneNames();
  model.textureColorSpaces = normalizeTextureColorSpaces(model.textureColorSpaces, model.textures);

  scaleModel(model, resolveModelUnitScale(model) * unitScale);
  model.shadowBoundsMargin = computeShadowBoundsMargin(model);
  refreshModelBindBones(model);
  model.runtimeBoneBaseCount = model.bones.length;

  return { model, fileProvider };
}

/**
 * モデル形式ごとの内部単位スケールを返します。
 * @param {object} model - モデルデータ。
 * @returns {number} スケール倍率。
 */
function resolveModelUnitScale(model) {
  if (model?.magic !== 'Pmd' && model?.magic !== 'Pmx') {
    return 1.0;
  }

  return resolveMmdLengthToMetersScale();
}

/**
 * MMD 長さを meter に変換する係数を返します。
 * @param {object|null|undefined} [appStateDefaults=getDefaultsSnapshot('appState')] - appState defaults。
 * @returns {number} 係数。
 */
export function resolveMmdLengthToMetersScale(appStateDefaults = getDefaultsSnapshot('appState')) {
  const scale = Number(appStateDefaults?.mmdLengthToMetersScale);
  return Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_MMD_LENGTH_TO_METERS_SCALE;
}

/**
 * texture color space 配列を正規化します。
 * @param {Array<string>|null|undefined} textureColorSpaces - 元の配列。
 * @param {Array<string>|null|undefined} textures - texture 一覧。
 * @returns {Array<'gamma-2.2'|'none'>} 正規化済み配列。
 */
function normalizeTextureColorSpaces(textureColorSpaces, textures) {
  const textureCount = Array.isArray(textures) ? textures.length : 0;
  return Array.from({ length: textureCount }, (_, index) => (
    String(textureColorSpaces?.[index] || 'gamma-2.2').toLowerCase() === 'none' ? 'none' : 'gamma-2.2'
  ));
}

/**
 * File 互換オブジェクトから ArrayBuffer を読み込みます。
 * @param {{arrayBuffer?: function(): Promise<ArrayBuffer>}} file - File 互換オブジェクト。
 * @returns {Promise<ArrayBuffer>} ArrayBuffer。
 */
async function readFileArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return await file.arrayBuffer();
  }

  throw new Error('File does not support arrayBuffer().');
}

/**
 * File 互換オブジェクトから文字列を読み込みます。
 * @param {{text?: function(): Promise<string>}} file - File 互換オブジェクト。
 * @returns {Promise<string>} テキスト。
 */
async function readFileText(file) {
  if (typeof file.text === 'function') {
    return await file.text();
  }

  const buffer = await readFileArrayBuffer(file);
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * ZIP ファイル提供用オブジェクトを作成します。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @param {string} modelFile - モデルファイル名。
 * @returns {{getFile: function(string): Promise<(Blob|null)>, listFiles: function(): string[]}} ファイルプロバイダー。
 */
function createZipFileProvider(zipFiles, modelFile) {
  const baseDir = getDirectoryPath(modelFile);
  return {
    getFile: async (path) => {
      const resolvedPath = resolveZipPath(baseDir, path);
      const entry = getZipEntry(zipFiles, resolvedPath)
        || getZipEntry(zipFiles, path)
        || getZipEntryByBasename(zipFiles, resolvedPath)
        || getZipEntryByBasename(zipFiles, path);
      if (!entry) {
        return null;
      }
      return await entry.async('blob');
    },
    listFiles: () => Object.keys(zipFiles || {}),
  };
}

/**
 * ZIP ファイル一覧からエントリを探します。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 検索パス。
 * @returns {object|null} ZIP エントリ。
 */
function getZipEntry(zipFiles, path) {
  if (!zipFiles || !path) {
    return null;
  }

  const normalizedPath = normalizePath(path);
  if (zipFiles[normalizedPath]) {
    return zipFiles[normalizedPath];
  }
  if (zipFiles[path]) {
    return zipFiles[path];
  }

  const lowerPath = normalizedPath.toLowerCase();
  const matchKey = Object.keys(zipFiles).find((key) => normalizePath(key).toLowerCase() === lowerPath);
  return matchKey ? zipFiles[matchKey] : null;
}

/**
 * ZIP 内ファイルから basename 一致するエントリを探します。
 * exact path が見つからないときの補助解決に使います。
 * @param {object} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 検索対象パス。
 * @returns {object|null} ZIP エントリ。
 */
function getZipEntryByBasename(zipFiles, path) {
  if (!zipFiles || !path) {
    return null;
  }

  const basename = getZipPathBasename(path).toLowerCase();
  if (!basename) {
    return null;
  }

  const matchKey = Object.keys(zipFiles).find((key) => getZipPathBasename(key).toLowerCase() === basename);
  return matchKey ? zipFiles[matchKey] : null;
}

/**
 * ZIP 用の相対パスを正規化します。
 * @param {string} baseDir - 基準ディレクトリ。
 * @param {string} path - 相対パス。
 * @returns {string} 正規化済みパス。
 */
function resolveZipPath(baseDir, path) {
  const normalizedBaseDir = normalizePath(baseDir || '');
  const normalizedPath = normalizePath(path || '');
  if (!normalizedPath) {
    return normalizedBaseDir;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalizedPath) || normalizedPath.startsWith('/')) {
    return normalizedPath;
  }

  const joinedBase = normalizedBaseDir && !normalizedBaseDir.endsWith('/')
    ? `${normalizedBaseDir}/`
    : normalizedBaseDir;
  return normalizeZipSegments(`${joinedBase}${normalizedPath}`);
}

/**
 * パスの basename を取得します。
 * @param {string} path - パス。
 * @returns {string} basename。
 */
function getZipPathBasename(path) {
  const normalized = normalizePath(path);
  const lastIndex = normalized.lastIndexOf('/');
  return lastIndex === -1 ? normalized : normalized.substring(lastIndex + 1);
}

/**
 * ZIP パスのセグメントを正規化します。
 * @param {string} path - パス。
 * @returns {string} 正規化済みパス。
 */
function normalizeZipSegments(path) {
  const segments = normalizePath(path).split('/');
  const stack = [];
  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}

/**
 * ファイル名からディレクトリを取得します。
 * @param {string} path - パス。
 * @returns {string} ディレクトリ。
 */
function getDirectoryPath(path) {
  const normalized = normalizePath(path);
  const lastIndex = normalized.lastIndexOf('/');
  return lastIndex === -1 ? '' : normalized.substring(0, lastIndex + 1);
}

/**
 * パス区切りを正規化します。
 * @param {string} path - パス。
 * @returns {string} 正規化済みパス。
 */
function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/');
}

/**
 * ローカル座標軸が未定義のボーンへ、仕様に従って基底を補完します。
 * @param {object} model - モデルデータ。
 */
function inferMissingBoneLocalAxes(model) {
  for (let i = 0; i < model.bones.length; i++) {
    const bone = getBone(model, i);
    if (!bone) {
      continue;
    }
    if (Array.isArray(bone.localX) && Array.isArray(bone.localY) && Array.isArray(bone.localZ)) {
      continue;
    }

    const parent = bone.parentIndex >= 0 ? getBone(model, bone.parentIndex) : null;
    const direction = parent ? vec3.sub(vec3.create(), bone.position, parent.position) : null;
    const basis = inferBoneLocalBasis(bone.name, direction);
    bone.localX = basis.localX;
    bone.localY = basis.localY;
    bone.localZ = basis.localZ;
  }
}

/**
 * ボーン名から補完用の軸種別を返します。
 * @param {string} boneName - ボーン名。
 * @returns {'x'|'y'|'z'} 軸種別。
 */
function getInferredLocalAxisKind(boneName) {
  const name = String(boneName || '');
  if (
    name.includes('下半身')
    || name.includes('上半身')
    || name.includes('上半身2')
    || name.includes('首')
    || name.includes('頭')
    || name.includes('腰')
    || name.includes('胸')
    || name.includes('足首')
    || name.includes('つま先')
    || name.includes('足')
    || name.includes('膝')
    || name.includes('ひざ')
  ) {
    return 'y';
  }

  if (
    name.includes('腕')
    || name.includes('ひじ')
    || name.includes('肘')
    || name.includes('手首')
    || name.includes('手')
    || name.includes('指')
    || name.includes('捩')
    || name.includes('捻')
  ) {
    return 'x';
  }

  return 'z';
}

/**
 * 補完用のローカル基底を作成します。
 * @param {string} boneName - ボーン名。
 * @param {Array<number>|null} direction - 親へ向かう方向。
 * @returns {{localX: Array<number>, localY: Array<number>, localZ: Array<number>}} ローカル基底。
 */
function inferBoneLocalBasis(boneName, direction) {
  const primary = normalizeVec3OrFallback(direction, null);
  if (!primary) {
    return {
      localX: [1, 0, 0],
      localY: [0, 1, 0],
      localZ: [0, 0, 1],
    };
  }

  const axisKind = getInferredLocalAxisKind(boneName);
  if (axisKind === 'y') {
    return buildYAxisBasis(primary);
  }

  if (axisKind === 'x') {
    return buildXAxisBasis(primary);
  }

  return buildZAxisBasis(primary);
}

/**
 * MMD 系ボーン名から回転ロックの基準軸を返します。
 * @param {string} boneName - ボーン名。
 * @returns {'x'|'y'|'z'|null} 基準軸。該当しない場合は null。
 */
function getPreferredRotationAxisFromMmdBoneName(boneName) {
  const name = String(boneName || '').trim();
  if (!name) {
    return null;
  }

  if (name.includes('ひじ') || name.includes('肘')) {
    return 'y';
  }
  if (name.includes('右手捩') || name.includes('左手捩') || name.includes('右腕捩') || name.includes('左腕捩')) {
    return 'x';
  }
  if (!name.includes('親指') && name.includes('指')) {
    return 'z';
  }
  if (name.includes('親指1') || name.includes('親指１') || name.includes('親指2') || name.includes('親指２')) {
    return 'y';
  }
  if (name.includes('ひざ') || name.includes('膝')) {
    return 'x';
  }
  if (name.includes('つま先')) {
    return 'x';
  }

  return null;
}

/**
 * VRM humanoid ボーン名から回転ロックの基準軸を返します。
 * @param {string} boneName - humanoid ボーン名。
 * @returns {'x'|'y'|'z'|null} 基準軸。該当しない場合は null。
 */
function getPreferredRotationAxisFromVrmHumanoidBoneName(boneName) {
  const name = String(boneName || '').trim();
  if (!name) {
    return null;
  }

  return VRM_HUMANOID_PREFERRED_AXIS_MAP[name] || null;
}

/**
 * ボーン名から回転ロックの基準軸を返します。
 * VRM モデルの場合は humanoid 名を経由して解決します。
 * @param {string} boneName - ボーン名。
 * @param {object|null|undefined} [model=null] - モデルデータ。
 * @returns {'x'|'y'|'z'|null} 基準軸。該当しない場合は null。
 */
export function getPreferredRotationAxisFromBoneName(boneName, model = null) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName) {
    return null;
  }

  if (model?.magic === 'Vrm') {
    const vrmHumanoidBoneName = findVrmHumanoidBoneNameByBoneName(model, normalizedBoneName) || normalizedBoneName;
    const vrmPreferredAxis = getPreferredRotationAxisFromVrmHumanoidBoneName(vrmHumanoidBoneName);
    if (vrmPreferredAxis) {
      return vrmPreferredAxis;
    }
  }

  return getPreferredRotationAxisFromMmdBoneName(normalizedBoneName);
}

/**
 * ボーン名から初期回転ロック状態を返します。
 * @param {string} boneName - ボーン名。
 * @param {object|null|undefined} [model=null] - モデルデータ。
 * @returns {{x: boolean, y: boolean, z: boolean}} 初期ロック状態。
 */
export function getInitialRotationLocksFromBoneName(boneName, model = null) {
  const preferredAxis = getPreferredRotationAxisFromBoneName(boneName, model);
  if (!preferredAxis) {
    return { x: false, y: false, z: false };
  }

  return {
    x: preferredAxis !== 'x',
    y: preferredAxis !== 'y',
    z: preferredAxis !== 'z',
  };
}

/**
 * ボーン名に応じて回転ロックを初期化します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {object} bone - ボーン。
 */
function initializeBoneRotationLocks(model, bone) {
  if (!bone) {
    return;
  }

  const vrmHumanoidBoneName = findVrmHumanoidBoneNameByBoneName(model, bone.name);
  bone.vrmHumanoidBoneName = vrmHumanoidBoneName || '';
  const baseRotationLocks = getInitialRotationLocksFromBoneName(vrmHumanoidBoneName || bone?.name, model);
  const rotationLocks = bone.rotationLocks || {};
  bone.rotationLocks = {
    x: Boolean(rotationLocks.x ?? baseRotationLocks.x),
    y: Boolean(rotationLocks.y ?? baseRotationLocks.y),
    z: Boolean(rotationLocks.z ?? baseRotationLocks.z),
  };
  const ikRotationLocks = bone.ikRotationLocks || {};
  bone.ikRotationLocks = {
    x: Boolean(ikRotationLocks.x),
    y: Boolean(ikRotationLocks.y),
    z: Boolean(ikRotationLocks.z),
  };
}

/**
 * ボーンのローカル基底用に、優先軸へ一致する単位ベクトルを返します。
 * @param {Array<number>|null} vector - 入力ベクトル。
 * @param {Array<number>|null} fallback - 代替ベクトル。
 * @returns {Array<number>|null} 正規化済みベクトル。
 */
function normalizeVec3OrFallback(vector, fallback) {
  if (vector && typeof vector.length === 'number' && vector.length >= 3) {
    const length = vec3.length(vector);
    if (length > BONE_LOCAL_AXIS_EPSILON) {
      return vec3.scale(vec3.create(), vector, 1 / length);
    }
  }

  if (fallback && typeof fallback.length === 'number' && fallback.length >= 3) {
    const fallbackLength = vec3.length(fallback);
    if (fallbackLength > BONE_LOCAL_AXIS_EPSILON) {
      return vec3.scale(vec3.create(), fallback, 1 / fallbackLength);
    }
  }

  return null;
}

/**
 * Y 軸方向のボーン用基底を作成します。
 * @param {Array<number>} localY - 主軸。
 * @returns {{localX: Array<number>, localY: Array<number>, localZ: Array<number>}} ローカル基底。
 */
function buildYAxisBasis(localY) {
  const xReference = localY[1] >= 0 ? [1, 0, 0] : [-1, 0, 0];
  const zFallback = localY[1] >= 0 ? [0, 0, 1] : [0, 0, -1];
  const localZ = normalizeVec3OrFallback(vec3.cross(vec3.create(), localY, xReference), vec3.cross(vec3.create(), localY, zFallback)) || zFallback;
  const localX = normalizeVec3OrFallback(vec3.cross(vec3.create(), localY, localZ), [1, 0, 0]) || [1, 0, 0];
  return { localX, localY, localZ };
}

/**
 * X 軸方向のボーン用基底を作成します。
 * @param {Array<number>} localX - 主軸。
 * @returns {{localX: Array<number>, localY: Array<number>, localZ: Array<number>}} ローカル基底。
 */
function buildXAxisBasis(localX) {
  const yReference = localX[0] >= 0 ? [0, 1, 0] : [0, -1, 0];
  const zFallback = localX[0] >= 0 ? [0, 0, 1] : [0, 0, -1];
  const localZ = normalizeVec3OrFallback(vec3.cross(vec3.create(), localX, yReference), vec3.cross(vec3.create(), localX, zFallback)) || zFallback;
  const localY = normalizeVec3OrFallback(vec3.cross(vec3.create(), localZ, localX), [0, 1, 0]) || [0, 1, 0];
  return { localX, localY, localZ };
}

/**
 * Z 軸方向のボーン用基底を作成します。
 * @param {Array<number>} localZ - 主軸。
 * @returns {{localX: Array<number>, localY: Array<number>, localZ: Array<number>}} ローカル基底。
 */
function buildZAxisBasis(localZ) {
  const yReference = localZ[2] >= 0 ? [0, 1, 0] : [0, -1, 0];
  const xFallback = localZ[2] >= 0 ? [1, 0, 0] : [-1, 0, 0];
  const localX = normalizeVec3OrFallback(vec3.cross(vec3.create(), yReference, localZ), vec3.cross(vec3.create(), xFallback, localZ)) || xFallback;
  const localY = normalizeVec3OrFallback(vec3.cross(vec3.create(), localZ, localX), [0, 1, 0]) || [0, 1, 0];
  return { localX, localY, localZ };
}

/**
 * モデルのシャドウ用マージンを見積もります。
 * @param {object} model - モデルデータ。
 * @returns {number} 追加マージン。
 */
function computeShadowBoundsMargin(model) {
  const aabb = createAabb();
  const stride = 27;

  if (model.vertices) {
    for (let i = 0; i < model.vertices.length; i += stride) {
      expandAabbWithPoint(aabb, [
        model.vertices[i + 0],
        model.vertices[i + 1],
        model.vertices[i + 2],
      ]);
    }
  }

  for (const bone of model.bones) {
    expandAabbWithPoint(aabb, bone.position);
  }

  if (!Number.isFinite(aabb.min[0])) {
    return 1.0;
  }

  const size = getAabbSize(aabb);
  const maxSize = Math.max(size[0], size[1], size[2]);
  return Math.max(maxSize * 0.5, 1.0);
}

/**
 * モデルデータにボーンの参照フラグを付与します。
 * @param {object} model - モデルデータ。
 */
export function initializeModelBoneReferences(model) {
  const boneReferencedByRigidBody = new Uint8Array(model.bones.length);
  for (const rb of model.rigidBodies) {
    if (rb.boneIndex >= 0 && rb.boneIndex < model.bones.length && (rb.physicsMode === 1 /* Physics */ || rb.physicsMode === 2 /* Physics + bone */ )) {
      boneReferencedByRigidBody[rb.boneIndex] = 1;
    }
  }
  model.boneReferencedByRigidBody = boneReferencedByRigidBody;

  // PMD モデルはファイル形式にボーンフラグを持たないため、ボーンタイプに基づいて合成します。
  if (model.magic === 'Pmd') {
    for (const bone of model.bones) {
      let flags = 0x0002; // Rotatable (PMD のボーンは基本的に回転可能)
      if (bone.type === 1 || bone.type === 2) { // 1: 回転と移動, 2: IK
        flags |= 0x0004; // Translatable
      }
      if (bone.type !== 7) { // 7: 非表示
        flags |= 0x0008; // Is visible
      }
      bone.flags = flags;
    }
  }
}

/**
 * PMD の IK 情報を PMX に近い内部表現へ正規化します。
 * @param {object} model - モデルデータ。
 */
export function normalizeModelIkChains(model) {
  if (!model || model.magic !== 'Pmd' || !Array.isArray(model.ik)) {
    return;
  }

  for (let i = 0; i < model.ik.length; i++) {
    const ik = model.ik[i];
    if (!ik || !Array.isArray(ik.links)) {
      continue;
    }

    const normalizedLinks = [...ik.links].reverse().map((link) => ({
      boneIndex: link.boneIndex,
      hasLimit: !!link.hasLimit,
      minAngle: Array.isArray(link.minAngle) ? [...link.minAngle] : [-Math.PI, -Math.PI, -Math.PI],
      maxAngle: Array.isArray(link.maxAngle) ? [...link.maxAngle] : [Math.PI, Math.PI, Math.PI],
    }));

    for (const link of normalizedLinks) {
      const bone = getBone(model, link.boneIndex);
      if (!bone || !isPmdKneeBone(bone.name)) {
        continue;
      }

      // PMD の膝は X 軸のみ回転させ、負方向に折れる範囲へ制限する。
      link.hasLimit = true;
      link.minAngle = [-Math.PI, 0, 0];
      link.maxAngle = [-0.008, 0, 0];
    }

    ik.links = normalizedLinks;
    ik.childBoneIndices = normalizedLinks.map((link) => link.boneIndex);
    if (typeof ik.loopCount !== 'number' && typeof ik.iteration === 'number') {
      ik.loopCount = ik.iteration;
    }
    if (typeof ik.limitAngle !== 'number' && typeof ik.limitation === 'number') {
      ik.limitAngle = ik.limitation;
    }
  }
}

/**
 * PMD の物理情報を PMX に近い内部表現へ正規化します。
 * @param {object} model - モデルデータ。
 */
export function normalizeModelPhysics(model) {
  if (!model) {
    return;
  }

  const rigidBodies = Array.isArray(model.rigidBodies) ? model.rigidBodies : [];
  if (model.magic === 'Pmd') {
    for (const rigidBody of rigidBodies) {
      if (!rigidBody) {
        continue;
      }

      if (typeof rigidBody.nameEn !== 'string') {
        rigidBody.nameEn = '';
      }
      if (typeof rigidBody.physicsMode !== 'number') {
        rigidBody.physicsMode = 1;
      }
      if (typeof rigidBody.groupId !== 'number') {
        rigidBody.groupId = 0;
      }
      if (typeof rigidBody.collisionMask !== 'number') {
        rigidBody.collisionMask = 0xFFFF;
      }
    }

    const joints = Array.isArray(model.joints) ? model.joints : [];
    for (const joint of joints) {
      if (!joint) {
        continue;
      }

      if (typeof joint.nameEn !== 'string') {
        joint.nameEn = '';
      }
      if (typeof joint.type !== 'number') {
        joint.type = 0;
      }
      if (!Array.isArray(joint.position)) {
        joint.position = [0, 0, 0];
      }
      if (!Array.isArray(joint.rotation)) {
        joint.rotation = [0, 0, 0];
      }
      if (!Array.isArray(joint.posMin)) {
        joint.posMin = [0, 0, 0];
      }
      if (!Array.isArray(joint.posMax)) {
        joint.posMax = [0, 0, 0];
      }
      if (!Array.isArray(joint.rotMin)) {
        joint.rotMin = [0, 0, 0];
      }
      if (!Array.isArray(joint.rotMax)) {
        joint.rotMax = [0, 0, 0];
      }
      if (!Array.isArray(joint.posSpring)) {
        joint.posSpring = [0, 0, 0];
      }
      if (!Array.isArray(joint.rotSpring)) {
        joint.rotSpring = [0, 0, 0];
      }
    }
  }

  overrideChainedPhysicsModes(model, rigidBodies);
}

/**
 * VRM 読み込み時の既定 IK を追加します。
 * @param {object|null|undefined} model - モデルデータ。
 */
function applyVrmDefaultIkChains(model) {
  if (model?.magic !== 'Vrm' || !Array.isArray(model?.bones) || !model.vrm || typeof model.vrm !== 'object') {
    return;
  }

  const specs = [
    {
      setupBoneName: 'rightLowerLeg',
      ikBoneName: '右足ＩＫ',
      chainLength: 2,
      loopCount: 200,
      limitAngle: Math.PI / 4,
    },
    {
      setupBoneName: 'leftLowerLeg',
      ikBoneName: '左足ＩＫ',
      chainLength: 2,
      loopCount: 200,
      limitAngle: Math.PI / 4,
    },
    {
      setupBoneName: 'rightFoot',
      ikBoneName: '右つま先ＩＫ',
      parentIkBoneName: '右足ＩＫ',
      chainLength: 1,
      loopCount: 10,
      limitAngle: Math.PI / 4,
    },
    {
      setupBoneName: 'leftFoot',
      ikBoneName: '左つま先ＩＫ',
      parentIkBoneName: '左足ＩＫ',
      chainLength: 1,
      loopCount: 10,
      limitAngle: Math.PI / 4,
    },
  ];

  const createdIkBoneIndicesByName = new Map();
  const createdIkBoneIndices = [];
  for (const spec of specs) {
    const setupBoneIndex = findBoneIndexByVrmHumanoidName(model, spec.setupBoneName);
    if (setupBoneIndex < 0) {
      continue;
    }

    const effectorBoneIndex = resolveRuntimeIkEffectorBoneIndex(model, setupBoneIndex);
    if (effectorBoneIndex < 0) {
      continue;
    }

    const targetBone = getBone(model, effectorBoneIndex);
    const parentBoneIndex = spec.parentIkBoneName
      ? createdIkBoneIndicesByName.get(spec.parentIkBoneName) ?? -1
      : resolveDefaultIkOperationParentBoneIndex(model);
    if (spec.parentIkBoneName && parentBoneIndex < 0) {
      continue;
    }
    const parentBone = getBone(model, parentBoneIndex);
    const defaultBasis = buildZAxisBasis([0, 0, -1]);
    const ikBone = {
      name: spec.ikBoneName,
      nameEn: '',
      parentIndex: parentBone ? parentBoneIndex : -1,
      transformLevel: parentBone ? (Number(parentBone.transformLevel) || 0) + 1 : 0,
      type: 0,
      position: Array.isArray(targetBone?.position) ? [...targetBone.position] : [0, 0, 0],
      localX: [...defaultBasis.localX],
      localY: [...defaultBasis.localY],
      localZ: [...defaultBasis.localZ],
      flags: 0x0002 | 0x0008,
      inheritParentIndex: -1,
      inheritInfluence: 0,
      ikTargetIndex: -1,
      tailOffset: [...DEFAULT_RUNTIME_IK_TAIL_OFFSET],
      gltfNodeIndex: -1,
    };
    ikBone.flags |= 0x0004;
    ikBone.rotationLocks = { x: false, y: false, z: false };
    const ikEntry = {
      targetBoneIndex: effectorBoneIndex,
      chainLength: 0,
      loopCount: spec.loopCount,
      limitAngle: spec.limitAngle,
      iteration: spec.loopCount,
      limitation: spec.limitAngle,
      links: [],
      childBoneIndices: [],
    };
    const { ikBoneIndex, ikIndex } = appendIkSetupToModel(model, {
      ikBone,
      ikEntry,
      chainCount: spec.chainLength,
    });
    createdIkBoneIndicesByName.set(spec.ikBoneName, ikBoneIndex);
    const createdIk = model.ik[ikIndex];
    createdIk.loopCount = spec.loopCount;
    createdIk.limitAngle = spec.limitAngle;
    createdIk.iteration = spec.loopCount;
    createdIk.limitation = spec.limitAngle;
    syncModelIkEntryAliases(model, ikIndex, createdIk);
    createdIkBoneIndices.push(ikBoneIndex);
  }

  if (Array.isArray(model.displayFrames) && model.displayFrames.length > 0) {
    const restFrame = model.displayFrames.find((displayFrame) => (
      String(displayFrame?.nameEn || '').trim().toLowerCase() === 'rest'
      || String(displayFrame?.name || '').trim() === 'その他'
    ));
    if (restFrame) {
      const existingBoneIndices = new Set();
      for (const frameEntry of Array.isArray(restFrame.frames) ? restFrame.frames : []) {
        if (frameEntry?.type === 0 && Number.isInteger(frameEntry.index)) {
          existingBoneIndices.add(frameEntry.index);
        }
      }
      if (!Array.isArray(restFrame.frames)) {
        restFrame.frames = [];
      }
      for (const ikBoneIndex of createdIkBoneIndices) {
        if (existingBoneIndices.has(ikBoneIndex)) {
          continue;
        }
        const bone = getBone(model, ikBoneIndex);
        if (bone && ['右足ＩＫ', '左足ＩＫ', '右つま先ＩＫ', '左つま先ＩＫ'].includes(String(bone.name || '').trim())) {
          restFrame.frames.push({ type: 0, index: ikBoneIndex });
        }
      }
    }
  }
}

/**
 * 親子剛体の連続する physicsMode=2 を補正します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>} rigidBodies - 剛体配列。
 */
function overrideChainedPhysicsModes(model, rigidBodies) {
  if (!Array.isArray(rigidBodies) || rigidBodies.length === 0) {
    return;
  }

  for (let rigidBodyIndex = 0; rigidBodyIndex < rigidBodies.length; rigidBodyIndex++) {
    const rigidBody = rigidBodies[rigidBodyIndex];
    if (!rigidBody || rigidBody.physicsMode !== 2) {
      continue;
    }

    const parentBodyInfo = findParentPhysicsRigidBody(model, rigidBodies, rigidBodyIndex);
    if (!parentBodyInfo) {
      continue;
    }

    rigidBody.physicsMode = 1;
    console.info(
      `[OpenMMD] physicsMode override: model="${model.name || ''}", rigidBodyIndex=${rigidBodyIndex}, rigidBody="${rigidBody.name || ''}", ` +
      `boneIndex=${rigidBody.boneIndex}, parentRigidBodyIndex=${parentBodyInfo.index}, parentRigidBody="${parentBodyInfo.rigidBody.name || ''}", ` +
      `parentBoneIndex=${parentBodyInfo.rigidBody.boneIndex}, parentPhysicsMode=${parentBodyInfo.rigidBody.physicsMode}, from=2, to=1`
    );
  }
}

const DEFAULT_RUNTIME_IK_LOOP_COUNT = 400;
const DEFAULT_RUNTIME_IK_LIMIT_ANGLE = Math.PI / 4;
const DEFAULT_RUNTIME_IK_DISTANCE_EPSILON = 1e-5;
const DEFAULT_RUNTIME_IK_BONE_FLAGS = 0x0002 | 0x0004 | 0x0008;
const DEFAULT_RUNTIME_IK_TAIL_OFFSET = Object.freeze([0, 0, -0.1]);

/**
 * ボーンの bind pose 情報を複製します。
 * @param {object} bone - ボーン。
 * @returns {{position: Array<number>, rotation: quat}} bind pose 情報。
 */
function createBindBoneSnapshot(bone) {
  const lx = bone.localX || [1, 0, 0];
  const ly = bone.localY || [0, 1, 0];
  const lz = bone.localZ || [0, 0, 1];
  const matrix = [lx[0], lx[1], lx[2], ly[0], ly[1], ly[2], lz[0], lz[1], lz[2]];
  const rotation = createBoneRestRotationQuaternion(bone, matrix);
  return {
    position: vec3.clone(bone.position),
    rotation,
  };
}

/**
 * bind bone 配列を現在のボーン一覧から再構築します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {Array<object>} 再構築済み bind bone 配列。
 */
export function refreshModelBindBones(model) {
  if (!Array.isArray(model?.bones)) {
    return [];
  }

  model.bindBones = model.bones.map((bone) => createBindBoneSnapshot(bone));
  return model.bindBones;
}

/**
 * IK リンク 1 件を正規化して複製します。
 * @param {object} model - モデルデータ。
 * @param {object|null|undefined} link - 元リンク。
 * @param {number} boneIndex - 対象ボーン index。
 * @returns {object} 正規化済みリンク。
 */
export function createModelIkLink(model, link, boneIndex) {
  const normalizedLink = {
    boneIndex,
    hasLimit: Boolean(link?.hasLimit),
    minAngle: Array.isArray(link?.minAngle) ? [...link.minAngle] : Array.isArray(link?.limitMin) ? [...link.limitMin] : [-Math.PI, -Math.PI, -Math.PI],
    maxAngle: Array.isArray(link?.maxAngle) ? [...link.maxAngle] : Array.isArray(link?.limitMax) ? [...link.limitMax] : [Math.PI, Math.PI, Math.PI],
  };

  const bone = getBone(model, normalizedLink.boneIndex);
  applyKneeLikeIkLinkConstraint(model, bone, normalizedLink);

  return normalizedLink;
}

/**
 * ターゲットボーンの親チェーンを根元から並べた一覧を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} targetBoneIndex - ターゲットボーン index。
 * @returns {Array<number>} 親チェーンのボーン index 一覧。
 */
export function getIkParentChainBoneIndices(model, targetBoneIndex) {
  const chain = [];
  if (!Number.isInteger(targetBoneIndex) || targetBoneIndex < 0) {
    return chain;
  }

  let currentIndex = getBone(model, targetBoneIndex)?.parentIndex ?? -1;
  while (Number.isInteger(currentIndex) && currentIndex >= 0) {
    chain.unshift(currentIndex);
    currentIndex = getBone(model, currentIndex)?.parentIndex ?? -1;
  }
  return chain;
}

/**
 * IK のリンク列をターゲットボーンとチェーン数から再構築します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {object|null|undefined} ik - IK エントリ。
 * @param {number} chainCount - 目標チェーン数。
 * @returns {Array<object>} 再構築済みリンク列。
 */
export function rebuildModelIkLinks(model, ik, chainCount) {
  if (!ik) {
    return [];
  }

  const normalizedChainCount = Math.max(1, Math.min(10, Number.isFinite(chainCount) ? Math.round(chainCount) : 1));
  const chainSourceBoneIndex = resolveIkLinkChainSourceBoneIndex(ik);
  const ancestorChain = getIkParentChainBoneIndices(model, chainSourceBoneIndex);
  const nextBoneIndices = ancestorChain.slice(Math.max(0, ancestorChain.length - normalizedChainCount));
  const previousLinks = new Map();
  for (const link of Array.isArray(ik.links) ? ik.links : []) {
    if (Number.isInteger(link?.boneIndex) && link.boneIndex >= 0 && !previousLinks.has(link.boneIndex)) {
      previousLinks.set(link.boneIndex, link);
    }
  }

  const nextLinks = nextBoneIndices.map((boneIndex) => (
    createModelIkLink(model, previousLinks.get(boneIndex), boneIndex)
  ));
  ik.links = nextLinks;
  ik.childBoneIndices = nextLinks.map((link) => link.boneIndex);
  ik.chainLength = nextLinks.length;
  return nextLinks;
}

/**
 * IK のリンク再構築に使う基準ボーン index を返します。
 * @param {object|null|undefined} ik - IK エントリ。
 * @returns {number} 基準ボーン index。該当なしの場合は -1。
 */
function resolveIkLinkChainSourceBoneIndex(ik) {
  return Number.isInteger(ik?.targetBoneIndex) ? ik.targetBoneIndex : -1;
}

/**
 * IK エントリ配列 alias を同期します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} ikIndex - IK index。
 * @param {object} sourceIk - 正規系の IK エントリ。
 */
export function syncModelIkEntryAliases(model, ikIndex, sourceIk) {
  for (const key of ['ik', 'iks']) {
    const ikList = Array.isArray(model?.[key]) ? model[key] : null;
    if (!ikList || (ikList === model.ik && key === 'iks')) {
      continue;
    }
    const targetIk = ikList[ikIndex];
    if (targetIk && targetIk !== sourceIk) {
      Object.assign(targetIk, sourceIk);
      if (Array.isArray(sourceIk.links)) {
        targetIk.links = sourceIk.links.map((link) => ({
          boneIndex: link.boneIndex,
          hasLimit: Boolean(link.hasLimit),
          minAngle: [...link.minAngle],
          maxAngle: [...link.maxAngle],
        }));
      }
      targetIk.childBoneIndices = Array.isArray(sourceIk.childBoneIndices) ? [...sourceIk.childBoneIndices] : [];
    }
  }
}

/**
 * モデルが保持する IK 配列一覧を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {Array<Array<object>>} IK 配列一覧。
 */
function getModelIkLists(model) {
  const lists = [];
  for (const key of ['ik', 'iks']) {
    const list = Array.isArray(model?.[key]) ? model[key] : null;
    if (list && !lists.includes(list)) {
      lists.push(list);
    }
  }
  return lists;
}

/**
 * IK エントリを複製します。
 * @param {object} ik - IK エントリ。
 * @returns {object} 複製済み IK エントリ。
 */
function cloneModelIkEntry(ik) {
  return {
    ...ik,
    links: Array.isArray(ik?.links) ? ik.links.map((link) => ({
      boneIndex: link.boneIndex,
      hasLimit: Boolean(link.hasLimit),
      minAngle: Array.isArray(link.minAngle) ? [...link.minAngle] : [-Math.PI, -Math.PI, -Math.PI],
      maxAngle: Array.isArray(link.maxAngle) ? [...link.maxAngle] : [Math.PI, Math.PI, Math.PI],
    })) : [],
    childBoneIndices: Array.isArray(ik?.childBoneIndices) ? [...ik.childBoneIndices] : [],
  };
}

/**
 * 現在のボーン一覧から派生 state を更新します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {object|null|undefined} 更新後モデル。
 */
export function refreshModelBoneDerivedState(model) {
  if (!model || !Array.isArray(model.bones)) {
    return model;
  }

  initializeModelBoneReferences(model);
  inferMissingBoneLocalAxes(model);
  for (const bone of model.bones) {
    initializeBoneRotationLocks(model, bone);
  }
  model.customRigBones = getCustomRigBoneNames();
  refreshModelBindBones(model);
  return model;
}

/**
 * ランタイム追加ボーンの基準 index を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {number} 基準 index。
 */
function getRuntimeBoneBaseCount(model) {
  if (Number.isInteger(model?.runtimeBoneBaseCount) && model.runtimeBoneBaseCount >= 0) {
    return model.runtimeBoneBaseCount;
  }
  return Array.isArray(model?.bones) ? model.bones.length : 0;
}

/**
 * 新規 IK 操作ボーン名を返します。
 * @param {object} model - モデルデータ。
 * @param {string} setupBoneName - 設定元ボーン名。
 * @returns {string} 一意化済みボーン名。
 */
function createUniqueRuntimeIkBoneName(model, setupBoneName) {
  const baseName = `${String(setupBoneName || 'Bone').trim() || 'Bone'}IK`;
  const existingNames = new Set((model.bones || []).map((bone) => String(bone?.name || '').trim()));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName}${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}${suffix}`;
}

/**
 * IK 操作ボーンと IK エントリをモデルへ追加します。
 * @param {object} model - モデルデータ。
 * @param {object} options - 追加オプション。
 * @param {object} options.ikBone - 追加する IK 操作ボーン。
 * @param {object} options.ikEntry - 追加する IK エントリ。
 * @param {number} options.chainCount - IK チェーン長。
 * @returns {{ikBoneIndex: number, ikIndex: number}} 追加結果。
 */
function appendIkSetupToModel(model, options) {
  const ikBone = options?.ikBone;
  const ikEntry = options?.ikEntry;
  const chainCount = Number.isFinite(options?.chainCount) ? Math.max(1, Math.round(options.chainCount)) : 1;
  if (!model || !Array.isArray(model.bones) || !ikBone || !ikEntry) {
    throw new Error('Invalid IK setup definition.');
  }

  model.bones.push(ikBone);
  const ikBoneIndex = model.bones.length - 1;
  initializeBoneRotationLocks(model, ikBone);

  const normalizedIkEntry = {
    ...ikEntry,
    boneIndex: ikBoneIndex,
    links: Array.isArray(ikEntry.links) ? ikEntry.links.map((link) => ({
      boneIndex: link.boneIndex,
      hasLimit: Boolean(link.hasLimit),
      minAngle: Array.isArray(link.minAngle) ? [...link.minAngle] : [-Math.PI, -Math.PI, -Math.PI],
      maxAngle: Array.isArray(link.maxAngle) ? [...link.maxAngle] : [Math.PI, Math.PI, Math.PI],
    })) : [],
    childBoneIndices: Array.isArray(ikEntry.childBoneIndices) ? [...ikEntry.childBoneIndices] : [],
  };
  rebuildModelIkLinks(model, normalizedIkEntry, chainCount);

  const ikLists = getModelIkLists(model);
  if (ikLists.length === 0) {
    model.ik = [normalizedIkEntry];
    model.iks = model.ik;
  } else {
    for (let listIndex = 0; listIndex < ikLists.length; listIndex += 1) {
      ikLists[listIndex].push(listIndex === 0 ? normalizedIkEntry : cloneModelIkEntry(normalizedIkEntry));
    }
  }

  return {
    ikBoneIndex,
    ikIndex: (model.ik?.length ?? 1) - 1,
  };
}

/**
 * ボーンの最初の子ボーン index を返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - 親ボーン index。
 * @returns {number} 子ボーン index。見つからない場合は -1。
 */
function findFirstChildBoneIndex(model, boneIndex) {
  return resolvePreferredChildBoneIndex(model, boneIndex);
}

/**
 * ボーンの tail 相当位置をモデル座標で返します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {number} boneIndex - ボーン index。
 * @returns {Array<number>|null} 位置。取得できない場合は null。
 */
function getModelBoneTailPosition(model, boneIndex) {
  const bone = getBone(model, boneIndex);
  if (!bone) {
    return null;
  }

  const tailBoneIndex = resolvePreferredTailBoneIndex(model, boneIndex);
  if (tailBoneIndex >= 0) {
    const tailBone = getBone(model, tailBoneIndex);
    if (tailBone) {
      return [...tailBone.position];
    }
  }
  if (Array.isArray(bone.tailOffset) && bone.tailOffset.length >= 3) {
    return [
      bone.position[0] + bone.tailOffset[0],
      bone.position[1] + bone.tailOffset[1],
      bone.position[2] + bone.tailOffset[2],
    ];
  }

  return null;
}

/**
 * IK effector にするボーン index を返します。
 * @param {object} model - モデルデータ。
 * @param {number} setupBoneIndex - 設定元ボーン index。
 * @returns {number} effector ボーン index。
 */
function resolveRuntimeIkEffectorBoneIndex(model, setupBoneIndex) {
  const childBoneIndex = findFirstChildBoneIndex(model, setupBoneIndex);
  if (childBoneIndex >= 0) {
    return childBoneIndex;
  }
  return setupBoneIndex;
}

/**
 * IK 操作ボーンの配置位置を返します。
 * @param {object} model - モデルデータ。
 * @param {number} setupBoneIndex - 設定元ボーン index。
 * @param {number} effectorBoneIndex - effector ボーン index。
 * @returns {Array<number>} 配置位置。
 */
function resolveRuntimeIkOperationBonePosition(model, setupBoneIndex, effectorBoneIndex) {
  if (effectorBoneIndex !== setupBoneIndex) {
    const effectorBone = getBone(model, effectorBoneIndex);
    if (effectorBone) {
      return [...effectorBone.position];
    }
  }

  const tailPosition = getModelBoneTailPosition(model, setupBoneIndex);
  if (tailPosition) {
    return tailPosition;
  }

  const setupBone = getBone(model, setupBoneIndex);
  if (!setupBone) {
    return [0, 0, 0];
  }

  return [
    setupBone.position[0] + DEFAULT_RUNTIME_IK_TAIL_OFFSET[0],
    setupBone.position[1] + DEFAULT_RUNTIME_IK_TAIL_OFFSET[1],
    setupBone.position[2] + DEFAULT_RUNTIME_IK_TAIL_OFFSET[2],
  ];
}

/**
 * IK 操作ボーンの親ボーン index をモデル種別から解決します。
 * @param {object|null|undefined} model - モデルデータ。
 * @returns {number} 親ボーン index。見つからない場合は -1。
 */
export function resolveDefaultIkOperationParentBoneIndex(model) {
  if (!Array.isArray(model?.bones) || model.bones.length === 0) {
    return -1;
  }

  if (model.magic === 'Pmx' || model.magic === 'Pmd') {
    const allParentIndex = findBoneIndexByName(model, '全ての親');
    if (allParentIndex >= 0) {
      return allParentIndex;
    }
  } else if (model.magic === 'Vrm') {
    const allParentIndex = findBoneIndexByName(model, '全ての親');
    if (allParentIndex >= 0) {
      return allParentIndex;
    }
  } else {
    const dummyBoneIndex = Number.isInteger(model.dummyBoneIndex) ? model.dummyBoneIndex : -1;
    if (dummyBoneIndex >= 0 && dummyBoneIndex < model.bones.length) {
      return dummyBoneIndex;
    }
  }

  return model.bones.findIndex((bone) => (bone?.parentIndex ?? -1) === -1);
}

/**
 * IK 操作ボーンをモデルへ追加します。
 * @param {object} model - モデルデータ。
 * @param {object} options - 作成オプション。
 * @param {number} options.setupBoneIndex - IK 設定元ボーン index。
 * @param {number} [options.parentBoneIndex] - IK 操作ボーンの親ボーン index。
 * @returns {{ikBoneIndex: number, ikIndex: number, effectorBoneIndex: number, setupBoneIndex: number}} 作成結果。
 */
export function createRuntimeIkSetup(model, options) {
  const setupBoneIndex = Number.isInteger(options?.setupBoneIndex) ? options.setupBoneIndex : -1;
  const setupBone = getBone(model, setupBoneIndex);
  if (!setupBone) {
    throw new Error(`IK setup bone not found: ${setupBoneIndex}`);
  }

  const existingIkIndex = Array.isArray(model?.ik)
    ? model.ik.findIndex((ik) => Number.isInteger(ik?.runtimeSetupBoneIndex) && ik.runtimeSetupBoneIndex === setupBoneIndex)
    : -1;
  if (existingIkIndex >= 0) {
    throw new Error(`IK already exists for setup bone: ${setupBoneIndex}`);
  }

  const effectorBoneIndex = resolveRuntimeIkEffectorBoneIndex(model, setupBoneIndex);
  const parentBoneIndex = Number.isInteger(options?.parentBoneIndex)
    ? options.parentBoneIndex
    : resolveDefaultIkOperationParentBoneIndex(model);
  const parentBone = getBone(model, parentBoneIndex);
  const defaultBasis = buildZAxisBasis([0, 0, -1]);
  const ikBone = {
    name: createUniqueRuntimeIkBoneName(model, setupBone.name),
    nameEn: '',
    parentIndex: parentBone ? parentBoneIndex : -1,
    transformLevel: parentBone ? (Number(parentBone.transformLevel) || 0) + 1 : 0,
    type: model.magic === 'Pmd' ? 2 : 0,
    position: resolveRuntimeIkOperationBonePosition(model, setupBoneIndex, effectorBoneIndex),
    localX: [...defaultBasis.localX],
    localY: [...defaultBasis.localY],
    localZ: [...defaultBasis.localZ],
    flags: DEFAULT_RUNTIME_IK_BONE_FLAGS,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    ikTargetIndex: -1,
    tailOffset: [...DEFAULT_RUNTIME_IK_TAIL_OFFSET],
    runtimeGeneratedIkBone: true,
    runtimeIkSetupBoneIndex: setupBoneIndex,
    runtimeIkEffectorBoneIndex: effectorBoneIndex,
  };

  const runtimeIk = {
    targetBoneIndex: effectorBoneIndex,
    chainLength: 0,
    loopCount: DEFAULT_RUNTIME_IK_LOOP_COUNT,
    limitAngle: DEFAULT_RUNTIME_IK_LIMIT_ANGLE,
    iteration: DEFAULT_RUNTIME_IK_LOOP_COUNT,
    limitation: DEFAULT_RUNTIME_IK_LIMIT_ANGLE,
    links: [],
    childBoneIndices: [],
    runtimeGeneratedIk: true,
    runtimeSetupBoneIndex: setupBoneIndex,
  };
  if (Number.isInteger(setupBone?.gltfNodeIndex)) {
    ikBone.gltfNodeIndex = -1;
  }

  if (!Number.isInteger(model.runtimeBoneBaseCount)) {
    model.runtimeBoneBaseCount = model.bones.length;
  }

  const { ikBoneIndex, ikIndex } = appendIkSetupToModel(model, {
    ikBone,
    ikEntry: runtimeIk,
    chainCount: 1,
  });
  model.ik[ikIndex].runtimeIkBoneIndex = ikBoneIndex;
  syncModelIkEntryAliases(model, ikIndex, model.ik[ikIndex]);

  refreshModelBoneDerivedState(model);

  return {
    ikBoneIndex,
    ikIndex,
    effectorBoneIndex,
    setupBoneIndex,
  };
}

/**
 * ランタイム生成ボーン削除後に IK/ボーン参照を詰め直します。
 * @param {object} model - モデルデータ。
 * @param {number} removedBoneIndex - 削除されたボーン index。
 */
function reindexRuntimeBoneReferences(model, removedBoneIndex) {
  for (const bone of model.bones) {
    if (!bone) {
      continue;
    }
    if (Number.isInteger(bone.parentIndex) && bone.parentIndex > removedBoneIndex) {
      bone.parentIndex -= 1;
    }
    if (Number.isInteger(bone.inheritParentIndex) && bone.inheritParentIndex > removedBoneIndex) {
      bone.inheritParentIndex -= 1;
    }
    if (Number.isInteger(bone.tailIndex) && bone.tailIndex > removedBoneIndex) {
      bone.tailIndex -= 1;
    }
    if (Number.isInteger(bone.runtimeIkSetupBoneIndex) && bone.runtimeIkSetupBoneIndex > removedBoneIndex) {
      bone.runtimeIkSetupBoneIndex -= 1;
    }
    if (Number.isInteger(bone.runtimeIkEffectorBoneIndex) && bone.runtimeIkEffectorBoneIndex > removedBoneIndex) {
      bone.runtimeIkEffectorBoneIndex -= 1;
    }
  }

  const primaryIkList = Array.isArray(model.ik) ? model.ik : [];
  for (let index = 0; index < primaryIkList.length; index += 1) {
    const ik = primaryIkList[index];
    if (!ik) {
      continue;
    }
    if (ik.boneIndex > removedBoneIndex) {
      ik.boneIndex -= 1;
    }
    if (ik.targetBoneIndex > removedBoneIndex) {
      ik.targetBoneIndex -= 1;
    }
    if (Number.isInteger(ik.runtimeSetupBoneIndex) && ik.runtimeSetupBoneIndex > removedBoneIndex) {
      ik.runtimeSetupBoneIndex -= 1;
    }
    if (Number.isInteger(ik.runtimeIkBoneIndex) && ik.runtimeIkBoneIndex > removedBoneIndex) {
      ik.runtimeIkBoneIndex -= 1;
    }
    if (Array.isArray(ik.links)) {
      for (const link of ik.links) {
        if (link.boneIndex > removedBoneIndex) {
          link.boneIndex -= 1;
        }
      }
    }
    if (Array.isArray(ik.childBoneIndices)) {
      ik.childBoneIndices = ik.childBoneIndices.map((boneIndex) => (
        boneIndex > removedBoneIndex ? boneIndex - 1 : boneIndex
      ));
    }
    syncModelIkEntryAliases(model, index, ik);
  }
}

/**
 * IK 操作ボーンと IK 定義を削除します。
 * @param {object} model - モデルデータ。
 * @param {object} options - 削除対象。
 * @param {number} [options.ikBoneIndex] - IK 操作ボーン index。
 * @param {number} [options.ikIndex] - IK index。
 * @returns {{removedIkBoneIndex: number, removedIkIndex: number, setupBoneIndex: number, effectorBoneIndex: number}} 削除結果。
 */
export function removeRuntimeIkSetup(model, options) {
  const ikList = Array.isArray(model?.ik) ? model.ik : [];
  let removedIkIndex = Number.isInteger(options?.ikIndex) ? options.ikIndex : -1;
  if (removedIkIndex < 0) {
    const ikBoneIndex = Number.isInteger(options?.ikBoneIndex) ? options.ikBoneIndex : -1;
    removedIkIndex = ikList.findIndex((ik) => ik?.boneIndex === ikBoneIndex);
  }
  if (removedIkIndex < 0 || removedIkIndex >= ikList.length) {
    throw new Error('IK entry not found.');
  }

  const ik = ikList[removedIkIndex];
  const removedIkBoneIndex = Number.isInteger(ik?.boneIndex) ? ik.boneIndex : -1;
  const setupBoneIndex = Number.isInteger(ik?.runtimeSetupBoneIndex)
    ? ik.runtimeSetupBoneIndex
    : Number.isInteger(model.bones?.[removedIkBoneIndex]?.runtimeIkSetupBoneIndex)
      ? model.bones[removedIkBoneIndex].runtimeIkSetupBoneIndex
      : -1;
  const effectorBoneIndex = Number.isInteger(ik?.targetBoneIndex) ? ik.targetBoneIndex : -1;

  const runtimeBoneBaseCount = getRuntimeBoneBaseCount(model);
  if (removedIkBoneIndex < runtimeBoneBaseCount) {
    throw new Error('Cannot remove non-runtime IK bone.');
  }

  for (const list of getModelIkLists(model)) {
    if (removedIkIndex >= 0 && removedIkIndex < list.length) {
      list.splice(removedIkIndex, 1);
    }
  }

  model.bones.splice(removedIkBoneIndex, 1);
  reindexRuntimeBoneReferences(model, removedIkBoneIndex);
  refreshModelBoneDerivedState(model);

  return {
    removedIkBoneIndex,
    removedIkIndex,
    setupBoneIndex,
    effectorBoneIndex: effectorBoneIndex > removedIkBoneIndex ? effectorBoneIndex - 1 : effectorBoneIndex,
  };
}

/**
 * ランタイム IK のターゲット変更に合わせて IK 操作ボーンの rest position を更新します。
 * @param {object} model - モデルデータ。
 * @param {object} options - 更新対象。
 * @param {number} options.ikIndex - IK index。
 * @param {number} options.targetBoneIndex - 新しいターゲットボーン index。
 * @returns {{ikBoneIndex: number, setupBoneIndex: number, effectorBoneIndex: number, targetPosition: Array<number>}} 更新結果。
 */
export function updateRuntimeIkTargetRestPosition(model, options) {
  const ikList = Array.isArray(model?.ik) ? model.ik : [];
  const ikIndex = Number.isInteger(options?.ikIndex) ? options.ikIndex : -1;
  if (ikIndex < 0 || ikIndex >= ikList.length) {
    throw new Error('IK entry not found.');
  }

  const ik = ikList[ikIndex];
  if (!ik?.runtimeGeneratedIk) {
    return {
      ikBoneIndex: Number.isInteger(ik?.boneIndex) ? ik.boneIndex : -1,
      setupBoneIndex: Number.isInteger(ik?.runtimeSetupBoneIndex) ? ik.runtimeSetupBoneIndex : -1,
      effectorBoneIndex: Number.isInteger(ik?.targetBoneIndex) ? ik.targetBoneIndex : -1,
      targetPosition: [],
    };
  }

  const targetBoneIndex = Number.isInteger(options?.targetBoneIndex) ? options.targetBoneIndex : -1;
  const targetBone = getBone(model, targetBoneIndex);
  if (!targetBone) {
    throw new Error(`IK target bone not found: ${targetBoneIndex}`);
  }

  const ikBoneIndex = Number.isInteger(ik?.boneIndex) ? ik.boneIndex : -1;
  const ikBone = getBone(model, ikBoneIndex);
  if (!ikBone) {
    throw new Error(`IK bone not found: ${ikBoneIndex}`);
  }

  const nextPosition = [...targetBone.position];
  ik.targetBoneIndex = targetBoneIndex;
  ikBone.position = nextPosition;
  ikBone.runtimeIkEffectorBoneIndex = targetBoneIndex;
  if (Array.isArray(ikBone.tailOffset) && ikBone.tailOffset.length >= 3) {
    ikBone.tailOffset = [...DEFAULT_RUNTIME_IK_TAIL_OFFSET];
  }

  refreshModelBoneDerivedState(model);

  return {
    ikBoneIndex,
    setupBoneIndex: Number.isInteger(ik?.runtimeSetupBoneIndex) ? ik.runtimeSetupBoneIndex : -1,
    effectorBoneIndex: targetBoneIndex,
    targetPosition: nextPosition,
  };
}

/**
 * シーン向けの IK リンクを複製します。
 * @param {object} model - モデルデータ。
 * @param {object|null|undefined} link - 元リンク。
 * @returns {object} 複製済みリンク。
 */
function cloneSceneIkLink(model, link) {
  const normalizedLink = {
    boneIndex: Number.isInteger(link?.boneIndex) ? link.boneIndex : -1,
    hasLimit: Boolean(link?.hasLimit),
    minAngle: Array.isArray(link?.minAngle) ? [...link.minAngle] : Array.isArray(link?.limitMin) ? [...link.limitMin] : [-Math.PI, -Math.PI, -Math.PI],
    maxAngle: Array.isArray(link?.maxAngle) ? [...link.maxAngle] : Array.isArray(link?.limitMax) ? [...link.limitMax] : [Math.PI, Math.PI, Math.PI],
  };

  const bone = getBone(model, normalizedLink.boneIndex);
  applyKneeLikeIkLinkConstraint(model, bone, normalizedLink);

  return normalizedLink;
}

/**
 * モデルの IK 定義をシーン用 state に変換します。
 * @param {object} model - モデルデータ。
 * @returns {{ikChains: Array<object>, ikTargets: Array<object>}} シーン向け IK state。
 */
function createSceneIkState(model) {
  const ikEntries = Array.isArray(model?.ik)
    ? model.ik
    : Array.isArray(model?.iks)
      ? model.iks
      : [];

  return {
    ikChains: ikEntries.map((ik) => ({
      targetBoneIndex: ik.boneIndex,
      effectorBoneIndex: resolveSceneIkEffectorBoneIndex(ik),
      rotationTargetBoneIndex: resolveSceneIkRotationTargetBoneIndex(ik),
      loopCount: ik.loopCount,
      limitAngle: ik.limitAngle,
      distanceEpsilon: resolveSceneIkDistanceEpsilon(ik),
      runtimeGeneratedIk: ik?.runtimeGeneratedIk === true,
      enabled: ik?.enabled !== false,
      links: Array.isArray(ik.links) ? ik.links.map((link) => cloneSceneIkLink(model, link)) : [],
    })),
    ikTargets: ikEntries.map((ik) => ({
      boneIndex: ik.boneIndex,
      effectorBoneIndex: resolveSceneIkEffectorBoneIndex(ik),
    })),
  };
}

/**
 * シーン IK の effector bone index を返します。
 * @param {object|null|undefined} ik - IK エントリ。
 * @returns {number} effector bone index。
 */
function resolveSceneIkEffectorBoneIndex(ik) {
  return Number.isInteger(ik?.targetBoneIndex) ? ik.targetBoneIndex : -1;
}

/**
 * シーン IK の回転ターゲット bone index を返します。
 * @param {object|null|undefined} ik - IK エントリ。
 * @returns {number} 回転ターゲット bone index。
 */
function resolveSceneIkRotationTargetBoneIndex(ik) {
  if (ik?.runtimeGeneratedIk === true && Number.isInteger(ik.targetBoneIndex) && ik.targetBoneIndex >= 0) {
    return ik.targetBoneIndex;
  }

  return -1;
}

/**
 * シーン IK の収束距離 epsilon を返します。
 * @param {object|null|undefined} ik - IK エントリ。
 * @returns {number} 距離 epsilon。
 */
function resolveSceneIkDistanceEpsilon(ik) {
  if (ik?.runtimeGeneratedIk === true) {
    return DEFAULT_RUNTIME_IK_DISTANCE_EPSILON;
  }

  return 0.01;
}

/**
 * シーンの IK state をモデル定義から再構築します。
 * @param {object} scene - シーン状態。
 * @param {object} model - モデルデータ。
 * @returns {{ikChains: Array<object>, ikTargets: Array<object>}} 再構築した IK state。
 */
export function refreshSceneIkState(scene, model) {
  const ikState = createSceneIkState(model);
  if (scene) {
    scene.ikChains = ikState.ikChains;
    scene.ikTargets = ikState.ikTargets;
  }
  return ikState;
}

/**
 * 指定剛体の親骨に紐づく物理剛体を返します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>} rigidBodies - 剛体配列。
 * @param {number} rigidBodyIndex - 対象剛体の index。
 * @returns {{index: number, rigidBody: object}|null} 親剛体情報。
 */
function findParentPhysicsRigidBody(model, rigidBodies, rigidBodyIndex) {
  const rigidBody = rigidBodies[rigidBodyIndex];
  const boneIndex = rigidBody?.boneIndex ?? -1;
  if (boneIndex < 0) {
    return null;
  }

  const parentBoneIndex = getBone(model, boneIndex)?.parentIndex ?? -1;
  if (parentBoneIndex < 0) {
    return null;
  }

  for (let index = 0; index < rigidBodies.length; index++) {
    const candidate = rigidBodies[index];
    if (!candidate || candidate.boneIndex !== parentBoneIndex) {
      continue;
    }
    if (candidate.physicsMode === 1 || candidate.physicsMode === 2) {
      return { index, rigidBody: candidate };
    }
  }

  return null;
}

/**
 * 膝ボーン名かどうかを判定します。
 * @param {string} name - ボーン名。
 * @returns {boolean} 膝ボーンなら true。
 */
function isPmdKneeBone(name) {
  return typeof name === 'string' && (name.includes('ひざ') || name.includes('膝') || name.toLowerCase().includes('knee'));
}

/**
 * IK リンクが膝相当の単軸制約を持つべきか判定します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {boolean} 膝相当なら true。
 */
function isKneeLikeIkLinkBone(model, bone) {
  if (!bone) {
    return false;
  }

  if (isPmdKneeBone(bone.name)) {
    return true;
  }

  if (model?.magic !== 'Vrm') {
    return false;
  }

  return bone.vrmHumanoidBoneName === 'leftLowerLeg' || bone.vrmHumanoidBoneName === 'rightLowerLeg';
}

/**
 * 膝相当の IK リンクへ単軸 X 制約を適用します。
 * @param {object|null|undefined} model - モデルデータ。
 * @param {object|null|undefined} bone - ボーン。
 * @param {object} link - IK リンク。
 */
function applyKneeLikeIkLinkConstraint(model, bone, link) {
  if (!isKneeLikeIkLinkBone(model, bone)) {
    return;
  }

  link.hasLimit = true;
  if (model?.magic === 'Vrm') {
    link.minAngle = [-Math.PI, 0, 0];
    link.maxAngle = [-0.008, 0, 0];
    return;
  }

  link.minAngle = [-Math.PI, 0, 0];
  link.maxAngle = [-0.008, 0, 0];
}

/**
 * モデルごとのシーン状態を構築します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} model - モデルデータ。
 * @returns {object} シーン状態。
 */
export function createSceneState(device, model) {
  const boneCount = model.bones.length;
  const boneDebugLists = createBoneDebugLists(model);
  const uiOverlay = createUiOverlayState(device, boneCount);
  const boneLocalTransforms = model.bones.map((bone, index) => createBoneLocalTransform(model, bone, index));
  const boneWorldPositions = Array.from({ length: boneCount }, () => [0, 0, 0]);
  const ikState = createSceneIkState(model);

  const boneMatricesBuffer = device.createBuffer({
    size: boneCount * 64,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const scene = {
    boneCount,
    boneDebugLists,
    uiOverlay,
    modelManager: null,
    boneLocalTransforms,
    boneMatricesBuffer,
    boneWorldPositions,
    sortedBoneIndices: model.bones
      .map((bone, index) => ({ index, level: bone.transformLevel }))
      .sort((a, b) => a.level - b.level || a.index - b.index)
      .map((item) => item.index),
    ikChains: ikState.ikChains,
    ikTargets: ikState.ikTargets,
    inverseBindMatrices: model.bones.map((bone) => mat4Translation(-bone.position[0], -bone.position[1], -bone.position[2])),
    vrmSpringBoneState: null,
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempQuat3: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
  scene.vrmSpringBoneState = createVrmSpringBoneState(model, scene);

  return scene;
}

/**
 * UI overlay 用の GPU バッファを構築します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {number} boneCount - ボーン数。
 * @returns {object} UI overlay 状態。
 */
function createUiOverlayState(device, boneCount) {
  return {
    boneLineVertexBuffer: device.createBuffer({
      size: Math.max(BONE_LINE_STRIDE, boneCount * 2 * BONE_LINE_STRIDE),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    boneLineVertexCount: 0,
    boneAxisVertexBuffer: device.createBuffer({
      size: Math.max(BONE_LINE_STRIDE * 3, boneCount * 6 * BONE_LINE_STRIDE),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    boneAxisVertexCount: 0,
    physicsWireframeVertexBuffer: device.createBuffer({
      size: 10 * 1024 * 1024,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    physicsWireframeVertexCount: 0,
    indicatorVertexBuffer: device.createBuffer({
      size: INDICATOR_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    indicatorVertexCount: 0,
    gizmoVertexBuffer: device.createBuffer({
      size: INDICATOR_BUFFER_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    gizmoVertexCount: 0,
  };
}

/**
 * ボーン描画とピック用の分類リストを作成します。
 * @param {object} model - モデルデータ。
 * @returns {object} ボーン分類キャッシュ。
 */
export function createBoneDebugLists(model) {
  const nonVisibleBoneIndices = [];
  const nonVisibleBoneIndexSet = new Set();
  const physicsReferencedBoneIndices = [];
  const physicsReferencedBoneIndexSet = new Set();
  const springBoneBoneIndices = [];
  const springBoneBoneIndexSet = new Set();
  const customRigBoneIndices = [];
  const customRigBoneIndexSet = new Set();
  const customRigBoneIndexByName = new Map();
  const customRigBoneNames = new Set(model.customRigBones || getCustomRigBoneNames());
  const boneReferencedByRigidBody = model.boneReferencedByRigidBody || new Uint8Array(model.bones.length);
  const springBoneReferencedBoneIndices = getSpringBoneReferencedBoneIndices(model);

  for (let i = 0; i < model.bones.length; i++) {
    const bone = getBone(model, i);
    if (!bone) {
      continue;
    }
    if ((bone.flags & 0x8) === 0) {
      nonVisibleBoneIndices.push(i);
      nonVisibleBoneIndexSet.add(i);
    }
    if (boneReferencedByRigidBody[i]) {
      physicsReferencedBoneIndices.push(i);
      physicsReferencedBoneIndexSet.add(i);
    }
    if (customRigBoneNames.has(bone.name)) {
      customRigBoneIndices.push(i);
      customRigBoneIndexSet.add(i);
      customRigBoneIndexByName.set(bone.name, i);
    }
  }

  for (const index of springBoneReferencedBoneIndices) {
    if (findVrmHumanoidBoneNameByBoneName(model, model.bones[index]?.name)) {
      continue;
    }
    if (springBoneBoneIndexSet.has(index)) {
      continue;
    }
    springBoneBoneIndexSet.add(index);
    springBoneBoneIndices.push(index);
  }

  const hiddenBoneIndexSet = new Set();
  for (const index of nonVisibleBoneIndices) {
    hiddenBoneIndexSet.add(index);
  }
  for (const index of physicsReferencedBoneIndices) {
    hiddenBoneIndexSet.add(index);
  }
  for (const index of customRigBoneIndices) {
    hiddenBoneIndexSet.add(index);
  }

  return {
    nonVisibleBoneIndices,
    nonVisibleBoneIndexSet,
    physicsReferencedBoneIndices,
    physicsReferencedBoneIndexSet,
    springBoneBoneIndices,
    springBoneBoneIndexSet,
    customRigBoneIndices,
    customRigBoneIndexSet,
    customRigBoneIndexByName,
    hiddenBoneIndexSet,
  };
}

/**
 * SpringBone で参照されているボーン index を収集します。
 * @param {object} model - モデルデータ。
 * @returns {Array<number>} SpringBone 参照ボーン index 一覧。
 */
function getSpringBoneReferencedBoneIndices(model) {
  const springBone = model?.vrm?.springBone || null;
  if (!springBone || !Array.isArray(springBone.springs)) {
    return [];
  }

  const boneIndices = [];
  const boneIndexSet = new Set();

  for (const collider of Array.isArray(springBone.colliders) ? springBone.colliders : []) {
    const boneIndex = Number.isInteger(collider?.boneIndex) ? collider.boneIndex : -1;
    if (boneIndex < 0 || boneIndex >= model.bones.length || boneIndexSet.has(boneIndex)) {
      continue;
    }
    boneIndexSet.add(boneIndex);
    boneIndices.push(boneIndex);
  }

  for (const spring of springBone.springs) {
    for (const joint of Array.isArray(spring?.joints) ? spring.joints : []) {
      const boneIndex = Number.isInteger(joint?.boneIndex) ? joint.boneIndex : -1;
      if (boneIndex < 0 || boneIndex >= model.bones.length || boneIndexSet.has(boneIndex)) {
        continue;
      }
      boneIndexSet.add(boneIndex);
      boneIndices.push(boneIndex);
    }
  }

  return boneIndices;
}

/**
 * ボーンのローカル変換状態を作成します。
 * @param {object} model - モデルデータ。
 * @param {object} bone - ボーン。
 * @param {number} index - ボーン番号。
 * @returns {object} ローカル変換状態。
 */
function createBoneLocalTransform(model, bone, index) {
  const lx = bone.localX || [1, 0, 0];
  const ly = bone.localY || [0, 1, 0];
  const lz = bone.localZ || [0, 0, 1];
  const matrix = [lx[0], lx[1], lx[2], ly[0], ly[1], ly[2], lz[0], lz[1], lz[2]];
  const baseRotation = normalizeBoneBaseRotationQuaternion(bone?.baseRotationQuaternion);
  const worldRotation = createBoneRestRotationQuaternion(bone, matrix);

  const baseTranslation = vec3.create();
  const parent = bone.parentIndex !== -1 ? getBone(model, bone.parentIndex) : null;
  if (parent) {
    vec3.set(
      baseTranslation,
      bone.position[0] - parent.position[0],
      bone.position[1] - parent.position[1],
      bone.position[2] - parent.position[2],
    );
  } else {
    vec3.set(baseTranslation, bone.position[0], bone.position[1], bone.position[2]);
  }

  const worldMatrix = mat4.create();
  mat4.fromRotationTranslation(worldMatrix, worldRotation, baseTranslation);

  let physicsMode = -1;
  if (model.rigidBodies) {
    const rigidBody = model.rigidBodies.find((body) => body.boneIndex === index);
    if (rigidBody) {
      physicsMode = rigidBody.physicsMode;
    }
  }

  return {
    translation: vec3.fromValues(0, 0, 0),
    rotation: quat.fromValues(0, 0, 0, 1),
    manualTranslation: vec3.fromValues(0, 0, 0),
    manualRotation: quat.fromValues(0, 0, 0, 1),
    childEnabled: false,
    childSourceInstanceIndex: -1,
    childSourceBoneIndex: -1,
    childInfluence: 1,
    childInverseEnabled: true,
    childInversePosition: vec3.fromValues(0, 0, 0),
    childInverseRotation: quat.fromValues(0, 0, 0, 1),
    childStoredTranslation: vec3.fromValues(0, 0, 0),
    childStoredRotation: quat.fromValues(0, 0, 0, 1),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix,
    skinMatrix: mat4.create(),
    worldRotation: quat.clone(worldRotation),
    baseRotation,
    localX: lx,
    localY: ly,
    localZ: lz,
    baseTranslation,
    localDirty: true,
    worldDirty: true,
    physicsMode,
  };
}

/**
 * ボーンの恒久基底回転を返します。
 * @param {ArrayLike<number>|null|undefined} value - 基底回転候補。
 * @returns {quat} 正規化済み基底回転。
 */
function normalizeBoneBaseRotationQuaternion(value) {
  if (!(Array.isArray(value) || ArrayBuffer.isView(value))) {
    return quat.fromValues(0, 0, 0, 1);
  }

  const normalized = quat.fromValues(
    Number(value[0]) || 0,
    Number(value[1]) || 0,
    Number(value[2]) || 0,
    Number.isFinite(Number(value[3])) ? Number(value[3]) : 1,
  );
  quat.normalize(normalized, normalized);
  return normalized;
}

/**
 * ボーンの rest 回転を返します。
 * @param {object|null|undefined} bone - ボーン。
 * @param {Array<number>} matrix - ローカル基底行列。
 * @returns {quat} rest 回転。
 */
function createBoneRestRotationQuaternion(bone, matrix) {
  const basisRotation = quat.create();
  quat.fromMat3(basisRotation, matrix);
  const baseRotation = normalizeBoneBaseRotationQuaternion(bone?.baseRotationQuaternion);
  const result = quat.create();
  quat.multiply(result, baseRotation, basisRotation);
  quat.normalize(result, result);
  return result;
}
