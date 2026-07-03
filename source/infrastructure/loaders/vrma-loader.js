import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createGltfAnimationSources,
} from '../animation/gltf-animation.js';
import { syncVrmaAuxiliaryMetadataFromChannels } from '../../core/animation/animation-clip.js';

const DEFAULT_TIMELINE_FPS = 30;
const VRMA_NON_ANIMATABLE_PRESET_EXPRESSIONS = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);

/**
 * VRMA ファイルを OpenMMD の animation source へ変換します。
 */
export class VRMALoader {
  constructor() {
    this.loader = new GLTFLoader();
  }

  /**
   * VRMA を URL から読み込みます。
   * @param {string} url - 読み込み先。
   * @returns {Promise<object>} 変換済み animation source。
   */
  async load(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load VRMA: ${response.status} ${response.statusText}`);
    }
    return await this.parse(await response.arrayBuffer(), url);
  }

  /**
   * VRMA バイナリを変換します。
   * @param {ArrayBuffer} input - VRMA バイナリ。
   * @param {string} [sourcePath=''] - 元ファイル名または URL。
   * @returns {Promise<object>} 変換済み animation source。
   */
  async parse(input, sourcePath = '') {
    if (!(input instanceof ArrayBuffer)) {
      throw new Error('VRMA loader expects an ArrayBuffer.');
    }

    const gltfJson = parseGlbJson(input);
    const extension = gltfJson?.extensions?.VRMC_vrm_animation;
    if (!extension || typeof extension !== 'object') {
      throw new Error('VRMA file does not contain VRMC_vrm_animation.');
    }

    const humanBones = extension?.humanoid?.humanBones;
    if (!humanBones || typeof humanBones !== 'object') {
      throw new Error('VRMA humanoid definition is missing.');
    }

    const gltf = await parseThreeGltf(this.loader, input, '');
    const nodeNameToHumanBoneName = buildNodeNameToHumanBoneNameMap(gltfJson?.nodes, humanBones);
    const expressionDefinitions = buildExpressionDefinitions(extension?.expressions, gltfJson?.nodes);
    const boneNames = buildBoneNodeNames(gltfJson?.nodes, nodeNameToHumanBoneName, expressionDefinitions);
    const boneBindTranslations = buildHumanBoneBindTranslationMap(gltfJson?.nodes, humanBones);
    const boneBindRotations = buildHumanBoneBindRotationMap(gltfJson?.nodes, humanBones);
    const humanBoneRestRotations = buildHumanBoneRestRotationMap(gltfJson?.nodes, humanBones);
    const sources = createGltfAnimationSources(gltf, null, {
      boneNames,
      boneBindTranslations,
      boneBindRotations,
      resolveBoneTargetName(nodeName) {
        return nodeNameToHumanBoneName.get(String(nodeName || '').trim()) || '';
      },
    });

    const source = sources[0] || null;
    if (!source?.clip) {
      throw new Error('VRMA file does not contain a readable animation.');
    }

    source.clip.metadata = {
      ...(source.clip.metadata || {}),
      sourceFormat: 'vrma',
      vrmAnimation: {
        humanBones: Object.fromEntries(humanBones ? Object.entries(humanBones).map(([name, value]) => [name, Number(value?.node)]) : []),
        humanBoneRestRotations,
        expressions: Object.fromEntries(Array.from(expressionDefinitions.entries(), ([expressionName, definition]) => ([
          expressionName,
          {
            ...definition,
          },
        ]))),
      },
    };
    source.clip.channels = normalizeVrmaClipChannels(source.clip.channels, expressionDefinitions, boneNames);
    appendVrmaPointerChannels(source.clip, gltfJson);
    appendOpenMmdBoneChannels(source.clip, extension?.openMmdBoneChannels);
    syncVrmaAuxiliaryMetadataFromChannels(source.clip);
    source.kind = 'vrma';
    source.name = String(sourcePath ? getFileNameFromPath(sourcePath) : source.name || 'animation.vrma');
    source.clip.name = String(source.clip.name || removeExtension(source.name) || 'VRMA Animation');
    source.clip.timelineFps = DEFAULT_TIMELINE_FPS;
    return source;
  }
}

/**
 * VRMA expression 定義を構築します。
 * @param {object|null|undefined} expressions - VRMA expressions 定義。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @returns {Map<string, object>} expression 名 -> 定義。
 */
function buildExpressionDefinitions(expressions, nodes) {
  const result = new Map();
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const sections = [
    ['preset', expressions?.preset],
    ['custom', expressions?.custom],
  ];
  for (const [expressionType, section] of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }
    for (const [expressionName, entry] of Object.entries(section)) {
      const normalizedExpressionName = String(expressionName || '').trim();
      const nodeIndex = Number(entry?.node);
      if (!normalizedExpressionName || !Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeList.length) {
        continue;
      }
      const nodeName = String(nodeList[nodeIndex]?.name || '').trim();
      if (!nodeName) {
        continue;
      }
      result.set(normalizedExpressionName, {
        expressionName: normalizedExpressionName,
        expressionType,
        nodeIndex,
        nodeName,
        isAnimatable: !(expressionType === 'preset' && VRMA_NON_ANIMATABLE_PRESET_EXPRESSIONS.has(normalizedExpressionName)),
      });
    }
  }
  return result;
}

/**
 * VRMA clip channels を bone/morph 向けの内部表現へ正規化します。
 * @param {Array<object>|null|undefined} channels - 元 channel 一覧。
 * @param {Map<string, object>} expressionDefinitions - expression 定義。
 * @param {Set<string>} boneNames - humanoid bone 名集合。
 * @returns {Array<object>} 正規化済み channel 一覧。
 */
function normalizeVrmaClipChannels(channels, expressionDefinitions, boneNames) {
  const expressionDefinitionByNodeName = new Map();
  for (const definition of expressionDefinitions.values()) {
    expressionDefinitionByNodeName.set(String(definition?.nodeName || '').trim(), definition);
  }

  const normalizedChannels = [];
  for (const channel of channels || []) {
    const targetName = String(channel?.target?.name || '').trim();
    if (channel?.target?.kind === 'bone' && boneNames.has(targetName)) {
      normalizedChannels.push(channel);
      continue;
    }

    if (channel?.target?.kind === 'node' && boneNames.has(targetName)) {
      normalizedChannels.push({
        ...channel,
        target: {
          ...(channel?.target || {}),
          kind: 'bone',
          name: targetName,
          nodeName: targetName,
        },
      });
      continue;
    }

    if (channel?.target?.kind !== 'node') {
      continue;
    }
    const definition = expressionDefinitionByNodeName.get(targetName) || null;
    if (!definition || String(channel?.target?.path || '') !== 'translation') {
      continue;
    }
    normalizedChannels.push(convertExpressionTranslationChannelToMorphChannel(channel, definition));
  }
  return normalizedChannels;
}

/**
 * VRMA scene 中の bone node 名一覧を構築します。
 * humanBones に載っている humanoid bone と、expression / camera / light 以外の node を含めます。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @param {Map<string, string>} nodeNameToHumanBoneName - node 名 -> humanoid 名。
 * @param {Map<string, object>} expressionDefinitions - expression 定義。
 * @returns {Set<string>} bone node 名集合。
 */
function buildBoneNodeNames(nodes, nodeNameToHumanBoneName, expressionDefinitions) {
  const result = new Set(nodeNameToHumanBoneName.keys());
  for (const humanBoneName of nodeNameToHumanBoneName.values()) {
    const normalizedHumanBoneName = String(humanBoneName || '').trim();
    if (normalizedHumanBoneName) {
      result.add(normalizedHumanBoneName);
    }
  }
  const expressionNodeNames = new Set();
  for (const definition of expressionDefinitions.values()) {
    const nodeName = String(definition?.nodeName || '').trim();
    if (nodeName) {
      expressionNodeNames.add(nodeName);
    }
  }

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const nodeName = String(node?.name || '').trim();
    if (!nodeName) {
      continue;
    }
    if (nodeName === 'OMMD_CameraTarget' || nodeName === 'OMMD_CameraOrbit' || nodeName === 'OMMD_Camera' || nodeName === 'OMMD_DirectionalLight') {
      continue;
    }
    if (expressionNodeNames.has(nodeName)) {
      continue;
    }
    result.add(nodeName);
  }

  return result;
}

/**
 * VRMA 拡張に退避した OpenMMD 独自 bone channel を clip へ復元します。
 * @param {object} clip - 対象 clip。
 * @param {Array<object>|null|undefined} channels - 退避 channel 一覧。
 */
function appendOpenMmdBoneChannels(clip, channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return;
  }

  const existingTargets = new Set(
    Array.isArray(clip?.channels)
      ? clip.channels
        .filter((channel) => String(channel?.target?.kind || '').trim() === 'bone')
        .map((channel) => `${String(channel?.target?.name || '').trim()}:${String(channel?.target?.path || '').trim()}`)
      : [],
  );

  for (const channel of channels) {
    if (String(channel?.target?.kind || '').trim() !== 'bone') {
      continue;
    }
    const targetName = String(channel?.target?.name || '').trim();
    const targetPath = String(channel?.target?.path || '').trim();
    if (!targetName || !targetPath) {
      continue;
    }
    const targetKey = `${targetName}:${targetPath}`;
    if (existingTargets.has(targetKey)) {
      continue;
    }
    clip.channels.push(cloneOpenMmdBoneChannel(channel));
    existingTargets.add(targetKey);
  }
}

/**
 * channel を再利用可能な形で複製します。
 * @param {object} channel - 元 channel。
 * @returns {object} 複製 channel。
 */
function cloneOpenMmdBoneChannel(channel) {
  return {
    target: {
      ...(channel?.target || {}),
    },
    sampler: {
      interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
      keyframes: Array.isArray(channel?.sampler?.keyframes)
        ? channel.sampler.keyframes.map((keyframe) => ({
          time: Number(keyframe?.time) || 0,
          frameNum: Number.isFinite(keyframe?.frameNum) ? Number(keyframe.frameNum) : undefined,
          value: Array.isArray(keyframe?.value) || ArrayBuffer.isView(keyframe?.value)
            ? Array.from(keyframe.value)
            : Number(keyframe?.value) || 0,
        }))
        : [],
    },
  };
}

/**
 * GLB JSON から OpenMMD 独自の camera/light pointer channel を追加します。
 * @param {object} clip - 追加先 clip。
 * @param {object} gltfJson - glTF JSON。
 */
function appendVrmaPointerChannels(clip, gltfJson) {
  const animations = Array.isArray(gltfJson?.animations) ? gltfJson.animations : [];
  const animation = animations[0];
  if (!animation || !Array.isArray(animation.channels) || !Array.isArray(animation.samplers)) {
    return;
  }

  const nodes = Array.isArray(gltfJson?.nodes) ? gltfJson.nodes : [];
  const bufferBytes = readGlbBinaryChunk(gltfJson.__glbInput || null);
  if (!bufferBytes) {
    return;
  }

  for (const channel of animation.channels) {
    const samplerIndex = Number(channel?.sampler);
    const sampler = Number.isInteger(samplerIndex) ? animation.samplers[samplerIndex] : null;
    if (!sampler) {
      continue;
    }

    const pointer = String(channel?.target?.extensions?.KHR_animation_pointer?.pointer || '').trim();
    if (pointer) {
      const pointerChannel = createPointerChannelFromAnimationSampler(pointer, sampler, gltfJson, bufferBytes, clip.timelineFps || DEFAULT_TIMELINE_FPS);
      if (pointerChannel) {
        clip.channels.push(pointerChannel);
      }
      continue;
    }

    const nodeIndex = Number(channel?.target?.node);
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      continue;
    }
    const nodeName = String(nodes[nodeIndex]?.name || '').trim();
    const path = String(channel?.target?.path || '').trim();
    if (!nodeName || (nodeName !== 'OMMD_CameraTarget' && nodeName !== 'OMMD_CameraOrbit' && nodeName !== 'OMMD_Camera' && nodeName !== 'OMMD_DirectionalLight')) {
      continue;
    }
    const keyframes = readSamplerKeyframes(sampler, gltfJson, bufferBytes, clip.timelineFps || DEFAULT_TIMELINE_FPS);
    if (keyframes.length === 0) {
      continue;
    }
    clip.channels.push({
      target: {
        kind: 'node',
        name: nodeName,
        nodeName,
        path,
        role: nodeName === 'OMMD_CameraTarget'
          ? 'camera-target'
          : nodeName === 'OMMD_CameraOrbit'
            ? 'camera-orbit'
            : nodeName === 'OMMD_Camera'
              ? 'camera'
              : 'light',
        originalTrackName: `${nodeName}.${path === 'translation' ? 'position' : path === 'rotation' ? 'quaternion' : path}`,
      },
      sampler: {
        interpolation: String(sampler?.interpolation || 'LINEAR'),
        keyframes,
      },
    });
  }
}

/**
 * expression node の translation channel を morph weight channel へ変換します。
 * @param {object} channel - 元 channel。
 * @param {object} definition - expression 定義。
 * @returns {object} morph channel。
 */
function convertExpressionTranslationChannelToMorphChannel(channel, definition) {
  return {
    target: {
      kind: 'morph',
      name: String(definition.expressionName || ''),
      path: 'weights',
      vrmaExpressionName: String(definition.expressionName || ''),
      vrmaExpressionType: String(definition.expressionType || 'custom'),
      nodeName: String(definition.nodeName || ''),
      originalTrackName: String(channel?.target?.originalTrackName || ''),
    },
    sampler: {
      interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
      keyframes: Array.isArray(channel?.sampler?.keyframes)
        ? channel.sampler.keyframes.map((keyframe) => ({
          time: Number(keyframe?.time) || 0,
          frameNum: Number.isFinite(keyframe?.frameNum) ? Number(keyframe.frameNum) : undefined,
          value: clampExpressionWeight(keyframe?.value?.[0]),
        }))
        : [],
    },
  };
}

/**
 * expression weight を [0, 1] に clamp します。
 * @param {number|null|undefined} value - 入力値。
 * @returns {number} clamp 済み weight。
 */
function clampExpressionWeight(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/**
 * Humanoid node 名から humanoid 名への対応表を構築します。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @param {object|null|undefined} humanBones - humanoid 定義。
 * @returns {Map<string, string>} node 名 -> humanoid 名。
 */
function buildNodeNameToHumanBoneNameMap(nodes, humanBones) {
  const result = new Map();
  const nodeList = Array.isArray(nodes) ? nodes : [];
  for (const [humanBoneName, entry] of Object.entries(humanBones || {})) {
    const nodeIndex = Number(entry?.node);
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeList.length) {
      continue;
    }
    const nodeName = String(nodeList[nodeIndex]?.name || '').trim();
    if (!nodeName) {
      continue;
    }
    result.set(nodeName, humanBoneName);
  }
  return result;
}

/**
 * Humanoid ごとの bind translation を構築します。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @param {object|null|undefined} humanBones - humanoid 定義。
 * @returns {Map<string, Array<number>>} humanoid 名 -> bind translation。
 */
function buildHumanBoneBindTranslationMap(nodes, humanBones) {
  const result = new Map();
  const nodeList = Array.isArray(nodes) ? nodes : [];
  for (const [humanBoneName, entry] of Object.entries(humanBones || {})) {
    const nodeIndex = Number(entry?.node);
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeList.length) {
      continue;
    }
    const translation = Array.isArray(nodeList[nodeIndex]?.translation)
      ? nodeList[nodeIndex].translation
      : [0, 0, 0];
    result.set(humanBoneName, [
      Number(translation[0]) || 0,
      Number(translation[1]) || 0,
      Number(translation[2]) || 0,
    ]);
  }
  return result;
}

/**
 * Humanoid ごとの bind rotation を構築します。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @param {object|null|undefined} humanBones - humanoid 定義。
 * @returns {Map<string, Array<number>>} humanoid 名 -> bind rotation。
 */
function buildHumanBoneBindRotationMap(nodes, humanBones) {
  const result = new Map();
  const nodeList = Array.isArray(nodes) ? nodes : [];
  for (const [humanBoneName, entry] of Object.entries(humanBones || {})) {
    const nodeIndex = Number(entry?.node);
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeList.length) {
      continue;
    }
    const rotation = Array.isArray(nodeList[nodeIndex]?.rotation)
      ? nodeList[nodeIndex].rotation
      : [0, 0, 0, 1];
    result.set(humanBoneName, [
      Number(rotation[0]) || 0,
      Number(rotation[1]) || 0,
      Number(rotation[2]) || 0,
      Number.isFinite(Number(rotation[3])) ? Number(rotation[3]) : 1,
    ]);
  }
  return result;
}

/**
 * Humanoid ごとの rest rotation を構築します。
 * @param {Array<object>|null|undefined} nodes - glTF nodes。
 * @param {object|null|undefined} humanBones - humanoid 定義。
 * @returns {object} humanoid 名 -> rest rotation 情報。
 */
function buildHumanBoneRestRotationMap(nodes, humanBones) {
  const result = {};
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const parentIndexByNodeIndex = buildParentIndexByNodeIndex(nodeList);
  const worldRotationCache = new Map();

  for (const [humanBoneName, entry] of Object.entries(humanBones || {})) {
    const nodeIndex = Number(entry?.node);
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeList.length) {
      continue;
    }

    const localRotation = readNodeRotation(nodeList[nodeIndex]);
    const worldRotation = computeNodeWorldRotation(nodeIndex, nodeList, parentIndexByNodeIndex, worldRotationCache);
    result[humanBoneName] = {
      localRotation,
      worldRotation,
    };
  }

  return result;
}

/**
 * node index ごとの parent index を構築します。
 * @param {Array<object>} nodes - glTF nodes。
 * @returns {Map<number, number>} child index -> parent index。
 */
function buildParentIndexByNodeIndex(nodes) {
  const result = new Map();
  for (let parentIndex = 0; parentIndex < nodes.length; parentIndex++) {
    const children = Array.isArray(nodes[parentIndex]?.children) ? nodes[parentIndex].children : [];
    for (const childIndex of children) {
      if (Number.isInteger(childIndex) && childIndex >= 0 && childIndex < nodes.length) {
        result.set(childIndex, parentIndex);
      }
    }
  }
  return result;
}

/**
 * node の local rotation を正規化して返します。
 * @param {object|null|undefined} node - glTF node。
 * @returns {number[]} 回転 quaternion。
 */
function readNodeRotation(node) {
  const rotation = Array.isArray(node?.rotation) ? node.rotation : [0, 0, 0, 1];
  return [
    Number(rotation[0]) || 0,
    Number(rotation[1]) || 0,
    Number(rotation[2]) || 0,
    Number.isFinite(Number(rotation[3])) ? Number(rotation[3]) : 1,
  ];
}

/**
 * node の world rest rotation を返します。
 * @param {number} nodeIndex - node index。
 * @param {Array<object>} nodes - glTF nodes。
 * @param {Map<number, number>} parentIndexByNodeIndex - parent 対応表。
 * @param {Map<number, number[]>} cache - 計算キャッシュ。
 * @returns {number[]} world rotation。
 */
function computeNodeWorldRotation(nodeIndex, nodes, parentIndexByNodeIndex, cache) {
  if (cache.has(nodeIndex)) {
    return Array.from(cache.get(nodeIndex));
  }

  const localRotation = readNodeRotation(nodes[nodeIndex]);
  const parentIndex = parentIndexByNodeIndex.get(nodeIndex);
  if (!Number.isInteger(parentIndex)) {
    cache.set(nodeIndex, localRotation);
    return Array.from(localRotation);
  }

  const parentRotation = computeNodeWorldRotation(parentIndex, nodes, parentIndexByNodeIndex, cache);
  const worldRotation = multiplyQuaternions(parentRotation, localRotation);
  cache.set(nodeIndex, worldRotation);
  return Array.from(worldRotation);
}

/**
 * 2 つの quaternion を乗算します。
 * @param {ArrayLike<number>} left - 左オペランド。
 * @param {ArrayLike<number>} right - 右オペランド。
 * @returns {number[]} 乗算結果。
 */
function multiplyQuaternions(left, right) {
  const lx = Number(left?.[0]) || 0;
  const ly = Number(left?.[1]) || 0;
  const lz = Number(left?.[2]) || 0;
  const lw = Number.isFinite(Number(left?.[3])) ? Number(left[3]) : 1;
  const rx = Number(right?.[0]) || 0;
  const ry = Number(right?.[1]) || 0;
  const rz = Number(right?.[2]) || 0;
  const rw = Number.isFinite(Number(right?.[3])) ? Number(right[3]) : 1;
  return normalizeQuaternion([
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]);
}

/**
 * quaternion を正規化します。
 * @param {ArrayLike<number>} value - 入力 quaternion。
 * @returns {number[]} 正規化済み quaternion。
 */
function normalizeQuaternion(value) {
  const x = Number(value?.[0]) || 0;
  const y = Number(value?.[1]) || 0;
  const z = Number(value?.[2]) || 0;
  const w = Number.isFinite(Number(value?.[3])) ? Number(value[3]) : 1;
  const length = Math.hypot(x, y, z, w);
  if (length <= 1e-8) {
    return [0, 0, 0, 1];
  }
  return [x / length, y / length, z / length, w / length];
}

/**
 * Three.js 側で glTF を非同期パースします。
 * @param {GLTFLoader} loader - Three.js GLTFLoader。
 * @param {ArrayBuffer|string} input - 入力データ。
 * @param {string} resourcePath - 外部資源の基準パス。
 * @returns {Promise<object>} Three.js の glTF 解析結果。
 */
function parseThreeGltf(loader, input, resourcePath) {
  return new Promise((resolve, reject) => {
    loader.parse(input, resourcePath, resolve, reject);
  });
}

/**
 * GLB の JSON チャンクを解析します。
 * @param {ArrayBuffer} input - GLB バイナリ。
 * @returns {object} glTF JSON。
 */
function parseGlbJson(input) {
  const view = new DataView(input);
  if (readAscii(input, 0, 4) !== 'glTF') {
    throw new Error('VRMA file is not a GLB container.');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error(`Unsupported VRMA GLB version: ${view.getUint32(4, true)}`);
  }
  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = readAscii(input, 16, 4);
  if (jsonChunkType !== 'JSON') {
    throw new Error('VRMA GLB JSON chunk is missing.');
  }
  const json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(input, 20, jsonChunkLength)).trimEnd());
  Object.defineProperty(json, '__glbInput', {
    value: input,
    enumerable: false,
  });
  return json;
}

function readGlbBinaryChunk(input) {
  if (!(input instanceof ArrayBuffer)) {
    return null;
  }
  const view = new DataView(input);
  let offset = 12;
  while (offset + 8 <= input.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = readAscii(input, offset + 4, 4);
    if (chunkType === 'BIN\0') {
      return new Uint8Array(input, offset + 8, chunkLength);
    }
    offset += 8 + chunkLength;
  }
  return null;
}

function createPointerChannelFromAnimationSampler(pointer, sampler, gltfJson, bufferBytes, timelineFps) {
  const keyframes = readSamplerKeyframes(sampler, gltfJson, bufferBytes, timelineFps);
  if (keyframes.length === 0) {
    return null;
  }
  return {
    target: {
      kind: 'pointer',
      name: pointer.includes('/color') ? 'light-color' : 'camera-fov',
      path: 'value',
      pointer,
      role: pointer.includes('/color') ? 'light-color' : 'camera-fov',
      valueType: pointer.includes('/color') ? 'vec3' : 'scalar',
    },
    sampler: {
      interpolation: String(sampler?.interpolation || 'LINEAR'),
      keyframes,
    },
  };
}

function readSamplerKeyframes(sampler, gltfJson, bufferBytes, timelineFps) {
  const inputValues = readAccessorValues(gltfJson, bufferBytes, Number(sampler?.input));
  const outputValues = readAccessorValues(gltfJson, bufferBytes, Number(sampler?.output));
  if (!inputValues || !outputValues || inputValues.length === 0) {
    return [];
  }
  const valueSize = outputValues.length / inputValues.length;
  const result = [];
  for (let index = 0; index < inputValues.length; index++) {
    const time = Number(inputValues[index]) || 0;
    const frameNum = Math.round(time * timelineFps);
    const offset = index * valueSize;
    const rawValue = valueSize === 1
      ? Number(outputValues[offset]) || 0
      : Array.from(outputValues.slice(offset, offset + valueSize));
    result.push({
      time,
      frameNum,
      value: rawValue,
    });
  }
  return result;
}

function readAccessorValues(gltfJson, bufferBytes, accessorIndex) {
  const accessors = Array.isArray(gltfJson?.accessors) ? gltfJson.accessors : [];
  const bufferViews = Array.isArray(gltfJson?.bufferViews) ? gltfJson.bufferViews : [];
  if (!Number.isInteger(accessorIndex) || accessorIndex < 0 || accessorIndex >= accessors.length) {
    return null;
  }
  const accessor = accessors[accessorIndex];
  const bufferViewIndex = Number(accessor?.bufferView);
  if (!Number.isInteger(bufferViewIndex) || bufferViewIndex < 0 || bufferViewIndex >= bufferViews.length) {
    return null;
  }
  const bufferView = bufferViews[bufferViewIndex];
  const byteOffset = (Number(bufferView?.byteOffset) || 0) + (Number(accessor?.byteOffset) || 0);
  const count = Number(accessor?.count) || 0;
  const componentType = Number(accessor?.componentType);
  const type = String(accessor?.type || 'SCALAR');
  const componentCount = type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 1;
  if (componentType !== 5126 || count <= 0) {
    return null;
  }
  const length = count * componentCount;
  return new Float32Array(bufferBytes.buffer, bufferBytes.byteOffset + byteOffset, length);
}

/**
 * ArrayBuffer から ASCII を読み込みます。
 * @param {ArrayBuffer} input - バイナリ。
 * @param {number} offset - 開始位置。
 * @param {number} length - 長さ。
 * @returns {string} ASCII 文字列。
 */
function readAscii(input, offset, length) {
  return new TextDecoder('ascii').decode(new Uint8Array(input, offset, length));
}

/**
 * パスからファイル名を抽出します。
 * @param {string} value - パス。
 * @returns {string} ファイル名。
 */
function getFileNameFromPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
}

/**
 * 拡張子を除去します。
 * @param {string} value - ファイル名。
 * @returns {string} 拡張子を除いた名前。
 */
function removeExtension(value) {
  const normalized = String(value || '');
  const lastDotIndex = normalized.lastIndexOf('.');
  return lastDotIndex > 0 ? normalized.slice(0, lastDotIndex) : normalized;
}
