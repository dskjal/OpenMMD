import {
  AnimationClip as ThreeAnimationClip,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  NumberKeyframeTrack,
  PropertyBinding,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { quat } from '../../lib/esm/index.js';
import {
  createEmptyAnimationClip,
  sampleAnimationChannelValue,
} from '../../core/animation/animation-clip.js';

const DEFAULT_TIMELINE_FPS = 30;

/**
 * glTF AnimationClip 群を OpenMMD の animation source 配列へ変換します。
 * @param {object} gltf - Three.js が解釈した glTF。
 * @param {object} model - OpenMMD モデル。
 * @param {object|null} [options=null] - 変換オプション。
 * @returns {Array<object>} animation source 配列。
 */
export function createGltfAnimationSources(gltf, model, options = null) {
  const clips = Array.isArray(gltf?.animations) ? gltf.animations : [];
  if (clips.length === 0) {
    return [];
  }

  const normalizedOptions = options && typeof options === 'object' ? options : {};
  const boneNames = normalizedOptions.boneNames instanceof Set
    ? normalizedOptions.boneNames
    : new Set((model?.bones || []).map((bone) => String(bone?.name || '').trim()).filter(Boolean));
  const boneBindTranslations = normalizedOptions.boneBindTranslations instanceof Map
    ? normalizedOptions.boneBindTranslations
    : createBoneBindTranslationMap(model);
  const boneBindRotations = normalizedOptions.boneBindRotations instanceof Map
    ? normalizedOptions.boneBindRotations
    : createBoneBindRotationMap(model);
  const sources = [];

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const threeClip = clips[clipIndex];
    const clip = createEmptyAnimationClip({
      name: String(threeClip?.name || `Animation ${clipIndex + 1}`),
      timelineFps: DEFAULT_TIMELINE_FPS,
      metadata: {
        sourceFormat: 'gltf',
        clipIndex,
      },
    });

    let maxDuration = 0;
    for (const track of threeClip?.tracks || []) {
      const channel = convertThreeTrackToAnimationChannel(
        track,
        boneNames,
        boneBindTranslations,
        boneBindRotations,
        clip.timelineFps,
        normalizedOptions,
      );
      if (!channel) {
        continue;
      }

      clip.channels.push(channel);
      const channelDuration = getChannelDuration(channel);
      if (channelDuration > maxDuration) {
        maxDuration = channelDuration;
      }
    }

    clip.duration = maxDuration;
    sources.push({
      kind: 'gltf',
      name: clip.name,
      clipIndex,
      clip,
    });
  }

  return sources;
}

/**
 * animation source をディープコピーします。
 * @param {object|null} source - animation source。
 * @returns {object|null} コピー済み source。
 */
export function cloneAnimationSource(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  return {
    ...source,
    clip: cloneAnimationClip(source.clip),
  };
}

/**
 * animation clip をディープコピーします。
 * @param {object|null} clip - animation clip。
 * @returns {object|null} コピー済み clip。
 */
export function cloneAnimationClip(clip) {
  if (!clip || typeof clip !== 'object') {
    return null;
  }

  const cloned = createEmptyAnimationClip({
    name: String(clip.name || ''),
    timelineFps: Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : DEFAULT_TIMELINE_FPS,
    metadata: clip.metadata ? { ...clip.metadata } : {},
  });
  cloned.duration = Number.isFinite(clip.duration) ? clip.duration : 0;
  cloned.channels = Array.isArray(clip.channels)
    ? clip.channels.map(cloneAnimationChannel)
    : [];
  return cloned;
}

/**
 * glTF source 配列を Three.js AnimationClip 配列へ変換します。
 * @param {Array<object>} sources - animation source 配列。
 * @returns {Array<ThreeAnimationClip>} Three.js AnimationClip 配列。
 */
export function createThreeAnimationClipsFromSources(sources) {
  const result = [];
  for (const source of sources || []) {
    if (!source || !source.clip) {
      continue;
    }

    const clip = source.clip;
    if (!clip) {
      continue;
    }

    const tracks = [];
    for (const channel of clip.channels || []) {
      const track = createThreeTrackFromAnimationChannel(channel, clip.timelineFps);
      if (track) {
        tracks.push(track);
      }
    }

    result.push(new ThreeAnimationClip(
      String(source.name || clip.name || 'Animation'),
      Number.isFinite(clip.duration) ? clip.duration : -1,
      tracks,
    ));
  }
  return result;
}

/**
 * glTF animation source 群を GLB として書き出します。
 * @param {object} scene - Three.js scene。
 * @param {Array<object>} sources - animation source 配列。
 * @returns {Promise<ArrayBuffer>} GLB バッファ。
 */
export async function exportAnimationSourcesToGlb(scene, sources) {
  const exporter = new GLTFExporter();
  const animations = createThreeAnimationClipsFromSources(sources);
  const result = await exporter.parseAsync(scene, {
    binary: true,
    animations,
  });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLB export did not return ArrayBuffer.');
  }
  return result;
}

/**
 * animation clip のボーン TRS キーを追加または更新します。
 * @param {object} clip - animation clip。
 * @param {string} boneName - ボーン名。
 * @param {number} frameNum - フレーム番号。
 * @param {object} values - 登録値。
 * @param {ArrayLike<number>} [values.translation] - translation。
 * @param {ArrayLike<number>} [values.rotation] - rotation。
 * @param {ArrayLike<number>} [values.scale] - scale。
 * @param {ArrayLike<number>} [values.interpolation] - VMD 補間バイト列。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipBoneKeyframe(clip, boneName, frameNum, values) {
  if (!clip || !boneName) {
    return clip;
  }

  const timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : DEFAULT_TIMELINE_FPS;
  const time = frameNum / timelineFps;

  if (values.translation) {
    upsertClipChannelKeyframe(clip, {
      kind: 'bone',
      name: boneName,
      path: 'translation',
    }, {
      time,
      frameNum,
      value: Array.from(values.translation),
      vmdInterpolation: values.interpolation ? Array.from(values.interpolation) : undefined,
    }, [0, 0, 0]);
  }

  if (values.rotation) {
    upsertClipChannelKeyframe(clip, {
      kind: 'bone',
      name: boneName,
      path: 'rotation',
    }, {
      time,
      frameNum,
      value: Array.from(values.rotation),
      vmdInterpolation: values.interpolation ? Array.from(values.interpolation) : undefined,
    }, [0, 0, 0, 1]);
  }

  if (values.scale) {
    upsertClipChannelKeyframe(clip, {
      kind: 'bone',
      name: boneName,
      path: 'scale',
    }, {
      time,
      frameNum,
      value: Array.from(values.scale),
    }, [1, 1, 1]);
  }

  clip.duration = Math.max(Number(clip.duration) || 0, time);
  return clip;
}

/**
 * animation clip の morph キーを追加または更新します。
 * @param {object} clip - animation clip。
 * @param {string} morphName - モーフ名。
 * @param {number} frameNum - フレーム番号。
 * @param {number} weight - 重み。
 * @param {object} [options={}] - 追加 metadata。
 * @param {string} [options.vrmaExpressionName] - VRMA expression 名。
 * @param {'preset'|'custom'} [options.vrmaExpressionType] - VRMA expression 種別。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipMorphKeyframe(clip, morphName, frameNum, weight, options = {}) {
  if (!clip || !morphName) {
    return clip;
  }

  const timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : DEFAULT_TIMELINE_FPS;
  const time = frameNum / timelineFps;
  const target = {
    kind: 'morph',
    name: morphName,
    path: 'weights',
  };
  if (options.vrmaExpressionName) {
    target.vrmaExpressionName = String(options.vrmaExpressionName);
  }
  if (options.vrmaExpressionType === 'preset' || options.vrmaExpressionType === 'custom') {
    target.vrmaExpressionType = options.vrmaExpressionType;
  }
  upsertClipChannelKeyframe(clip, target, {
    time,
    frameNum,
    value: Number(weight) || 0,
  }, 0);
  clip.duration = Math.max(Number(clip.duration) || 0, time);
  return clip;
}

/**
 * animation clip の node TRS キーを追加または更新します。
 * @param {object} clip - animation clip。
 * @param {string} nodeName - node 名。
 * @param {number} frameNum - フレーム番号。
 * @param {object} values - 登録値。
 * @param {ArrayLike<number>} [values.translation] - translation。
 * @param {ArrayLike<number>} [values.rotation] - rotation。
 * @param {ArrayLike<number>} [values.scale] - scale。
 * @param {string} [values.role=''] - 補助 role。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipNodeKeyframe(clip, nodeName, frameNum, values) {
  if (!clip || !nodeName) {
    return clip;
  }

  const timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : DEFAULT_TIMELINE_FPS;
  const time = frameNum / timelineFps;
  const role = String(values?.role || '').trim();

  if (values.translation) {
    upsertClipChannelKeyframe(clip, {
      kind: 'node',
      name: nodeName,
      nodeName,
      path: 'translation',
      ...(role ? { role } : {}),
    }, {
      time,
      frameNum,
      value: Array.from(values.translation),
    }, [0, 0, 0]);
  }

  if (values.rotation) {
    upsertClipChannelKeyframe(clip, {
      kind: 'node',
      name: nodeName,
      nodeName,
      path: 'rotation',
      ...(role ? { role } : {}),
    }, {
      time,
      frameNum,
      value: Array.from(values.rotation),
    }, [0, 0, 0, 1]);
  }

  if (values.scale) {
    upsertClipChannelKeyframe(clip, {
      kind: 'node',
      name: nodeName,
      nodeName,
      path: 'scale',
      ...(role ? { role } : {}),
    }, {
      time,
      frameNum,
      value: Array.from(values.scale),
    }, [1, 1, 1]);
  }

  clip.duration = Math.max(Number(clip.duration) || 0, time);
  return clip;
}

/**
 * animation clip の animation pointer key を追加または更新します。
 * @param {object} clip - animation clip。
 * @param {string} pointer - glTF animation pointer。
 * @param {number} frameNum - フレーム番号。
 * @param {number|ArrayLike<number>} value - 登録値。
 * @param {object} [options={}] - 追加 metadata。
 * @param {'scalar'|'vec3'} [options.valueType='scalar'] - 値種別。
 * @param {string} [options.role=''] - 補助 role。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipPointerKeyframe(clip, pointer, frameNum, value, options = {}) {
  if (!clip || !pointer) {
    return clip;
  }

  const timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : DEFAULT_TIMELINE_FPS;
  const time = frameNum / timelineFps;
  const valueType = options?.valueType === 'vec3' ? 'vec3' : 'scalar';
  const fallbackValue = valueType === 'vec3' ? [0, 0, 0] : 0;
  upsertClipChannelKeyframe(clip, {
    kind: 'pointer',
    name: String(options?.role || pointer),
    path: 'value',
    pointer: String(pointer),
    valueType,
    ...(options?.role ? { role: String(options.role) } : {}),
  }, {
    time,
    frameNum,
    value: valueType === 'vec3'
      ? Array.from(value || [0, 0, 0]).slice(0, 3)
      : Number(value) || 0,
  }, fallbackValue);
  clip.duration = Math.max(Number(clip.duration) || 0, time);
  return clip;
}

/**
 * clip から指定フレームのボーン/モーフ key を削除します。
 * @param {object} clip - animation clip。
 * @param {Set<object>} selectedSources - タイムライン選択 source 集合。
 * @returns {boolean} 変更があったなら true。
 */
export function deleteAnimationClipKeyframes(clip, selectedSources) {
  if (!clip || !Array.isArray(clip.channels) || !(selectedSources instanceof Set) || selectedSources.size === 0) {
    return false;
  }

  let changed = false;
  for (const selected of selectedSources) {
    const target = selected?.target || null;
    const frameNum = Number.isFinite(selected?.frameNum) ? Math.round(selected.frameNum) : null;
    if (!target || frameNum === null) {
      continue;
    }

    const targetKind = String(target?.kind || '');
    const targetName = String(target?.sourceName || target?.name || '');
    const targetPath = String(target?.path || '');

    for (const channel of clip.channels) {
      if (String(channel?.target?.kind || '') !== targetKind) {
        continue;
      }
      if (String(channel?.target?.name || '') !== targetName) {
        continue;
      }
      if (targetPath && String(channel?.target?.path || '') !== targetPath) {
        continue;
      }

      const keyframes = channel?.sampler?.keyframes;
      if (!Array.isArray(keyframes)) {
        continue;
      }

      const nextKeyframes = keyframes.filter((keyframe) => {
        const keyframeFrame = Number.isFinite(keyframe?.frameNum)
          ? Math.round(keyframe.frameNum)
          : Math.round((Number(keyframe?.time) || 0) * (clip.timelineFps || DEFAULT_TIMELINE_FPS));
        return keyframeFrame !== frameNum;
      });
      if (nextKeyframes.length !== keyframes.length) {
        channel.sampler.keyframes = nextKeyframes;
        changed = true;
      }
    }
  }

  clip.channels = clip.channels.filter((channel) => Array.isArray(channel?.sampler?.keyframes) && channel.sampler.keyframes.length > 0);
  clip.duration = Math.max(0, ...clip.channels.map((channel) => getChannelDuration(channel)));
  return changed;
}

/**
 * clip channel をディープコピーします。
 * @param {object} channel - channel。
 * @returns {object} コピー済み channel。
 */
function cloneAnimationChannel(channel) {
  return {
    target: channel?.target ? { ...channel.target } : {},
    sampler: {
      interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
      keyframes: Array.isArray(channel?.sampler?.keyframes)
        ? channel.sampler.keyframes.map((keyframe) => cloneChannelKeyframe(keyframe))
        : [],
    },
  };
}

/**
 * モデルの bone 名ごとの bind pose translation を構築します。
 * @param {object} model - モデルデータ。
 * @returns {Map<string, Array<number>>} bone 名 -> bind pose translation。
 */
function createBoneBindTranslationMap(model) {
  const boneBindTranslations = new Map();
  if (!Array.isArray(model?.bones)) {
    return boneBindTranslations;
  }

  for (let index = 0; index < model.bones.length; index++) {
    const bone = model.bones[index];
    const boneName = String(bone?.name || '').trim();
    if (!boneName) {
      continue;
    }

    const parent = bone?.parentIndex >= 0 ? model.bones[bone.parentIndex] : null;
    const parentPosition = parent?.position || [0, 0, 0];
    const position = bone?.position || [0, 0, 0];
    boneBindTranslations.set(boneName, [
      (Number(position[0]) || 0) - (Number(parentPosition[0]) || 0),
      (Number(position[1]) || 0) - (Number(parentPosition[1]) || 0),
      (Number(position[2]) || 0) - (Number(parentPosition[2]) || 0),
    ]);
  }

  return boneBindTranslations;
}

/**
 * モデルの bone 名ごとの bind pose rotation を構築します。
 * @param {object} model - モデルデータ。
 * @returns {Map<string, Array<number>>} bone 名 -> bind pose rotation。
 */
function createBoneBindRotationMap(model) {
  const boneBindRotations = new Map();
  if (!Array.isArray(model?.bones)) {
    return boneBindRotations;
  }

  for (const bone of model.bones) {
    const boneName = String(bone?.name || '').trim();
    if (!boneName) {
      continue;
    }
    const bindRotation = Array.isArray(bone?.baseRotationQuaternion) || ArrayBuffer.isView(bone?.baseRotationQuaternion)
      ? Array.from(bone.baseRotationQuaternion)
      : [0, 0, 0, 1];
    boneBindRotations.set(boneName, normalizeQuaternion(bindRotation));
  }

  return boneBindRotations;
}

/**
 * translation 値から bind pose を差し引きます。
 * @param {ArrayLike<number>} value - 元 translation。
 * @param {ArrayLike<number>} bindTranslation - bind pose translation。
 * @returns {Array<number>} 差分 translation。
 */
function subtractTranslation(value, bindTranslation) {
  return [
    (Number(value?.[0]) || 0) - (Number(bindTranslation?.[0]) || 0),
    (Number(value?.[1]) || 0) - (Number(bindTranslation?.[1]) || 0),
    (Number(value?.[2]) || 0) - (Number(bindTranslation?.[2]) || 0),
  ];
}

/**
 * rotation 値から bind pose rotation を差し引きます。
 * @param {ArrayLike<number>} value - 元 rotation。
 * @param {ArrayLike<number>} bindRotation - bind pose rotation。
 * @returns {Array<number>} 差分 rotation。
 */
function subtractRotation(value, bindRotation) {
  const input = normalizeQuaternion(value);
  const bind = normalizeQuaternion(bindRotation);
  const inverseBind = quat.create();
  const result = quat.create();
  quat.invert(inverseBind, bind);
  quat.multiply(result, inverseBind, input);
  quat.normalize(result, result);
  return Array.from(result);
}

/**
 * bind pose rotation を加算して絶対 rotation に戻します。
 * @param {ArrayLike<number>} value - 差分 rotation。
 * @param {ArrayLike<number>} bindRotation - bind pose rotation。
 * @returns {Array<number>} 絶対 rotation。
 */
function addRotation(value, bindRotation) {
  const input = normalizeQuaternion(value);
  const bind = normalizeQuaternion(bindRotation);
  const result = quat.create();
  quat.multiply(result, bind, input);
  quat.normalize(result, result);
  return Array.from(result);
}

/**
 * clip keyframe をディープコピーします。
 * @param {object} keyframe - keyframe。
 * @returns {object} コピー済み keyframe。
 */
function cloneChannelKeyframe(keyframe) {
  const cloned = {
    time: Number(keyframe?.time) || 0,
    frameNum: Number.isFinite(keyframe?.frameNum) ? Number(keyframe.frameNum) : undefined,
    value: cloneValue(keyframe?.value),
  };
  if (keyframe?.vmdInterpolation !== undefined) {
    cloned.vmdInterpolation = cloneValue(keyframe.vmdInterpolation);
  }
  if (keyframe?.inTangent !== undefined) {
    cloned.inTangent = cloneValue(keyframe.inTangent);
  }
  if (keyframe?.outTangent !== undefined) {
    cloned.outTangent = cloneValue(keyframe.outTangent);
  }
  return cloned;
}

/**
 * Three.js track を OpenMMD channel へ変換します。
 * @param {object} track - Three.js keyframe track。
 * @param {Set<string>} boneNames - モデル bone 名集合。
 * @param {Map<string, Array<number>>} boneBindTranslations - bone 名ごとの bind pose translation。
 * @param {Map<string, Array<number>>} boneBindRotations - bone 名ごとの bind pose rotation。
 * @param {number} timelineFps - タイムライン FPS。
 * @param {object|null} options - 変換オプション。
 * @returns {object|null} 変換済み channel。
 */
function convertThreeTrackToAnimationChannel(track, boneNames, boneBindTranslations, boneBindRotations, timelineFps, options = null) {
  const parsed = parseThreeTrackBinding(track?.name || '');
  if (!parsed) {
    return null;
  }

  const targetPath = mapThreePropertyToTargetPath(parsed.propertyName);
  if (!targetPath) {
    return null;
  }

  const normalizedOptions = options && typeof options === 'object' ? options : {};
  const resolvedTargetName = typeof normalizedOptions.resolveBoneTargetName === 'function'
    ? String(normalizedOptions.resolveBoneTargetName(parsed.nodeName, parsed) || '').trim()
    : '';
  const targetKind = targetPath === 'weights'
    ? 'morph'
    : ((resolvedTargetName && boneNames.has(resolvedTargetName)) || boneNames.has(parsed.nodeName) ? 'bone' : 'node');
  const targetName = targetPath === 'weights'
    ? String(parsed.propertyIndex || '').trim()
    : String(resolvedTargetName || parsed.nodeName || '').trim();
  if (!targetName) {
    return null;
  }

  const bindTranslation = targetKind === 'bone' && targetPath === 'translation'
    ? boneBindTranslations.get(targetName) || null
    : null;
  const bindRotation = targetKind === 'bone' && targetPath === 'rotation'
    ? boneBindRotations.get(targetName) || null
    : null;
  const valueSize = getTrackValueSize(track, targetPath);
  const interpolation = mapThreeInterpolationToClip(track);
  const keyframes = [];

  for (let index = 0; index < track.times.length; index++) {
    const time = Number(track.times[index]) || 0;
    const value = readTrackValue(track.values, index, valueSize, targetPath);
    keyframes.push({
      time,
      frameNum: Math.round(time * timelineFps),
      value: bindTranslation
        ? subtractTranslation(value, bindTranslation)
        : bindRotation
          ? subtractRotation(value, bindRotation)
          : value,
    });
  }

  const target = {
    kind: targetKind,
    name: targetName,
    nodeName: String(parsed.nodeName || ''),
    path: targetPath,
    propertyIndex: parsed.propertyIndex ?? null,
    originalTrackName: String(track.name || ''),
  };
  if (bindTranslation) {
    target.bindTranslation = Array.from(bindTranslation);
  }
  if (bindRotation) {
    target.bindRotation = Array.from(bindRotation);
  }

  return {
    target,
    sampler: {
      interpolation,
      keyframes,
    },
  };
}

/**
 * channel を Three.js track へ変換します。
 * @param {object} channel - OpenMMD channel。
 * @param {number} timelineFps - タイムライン FPS。
 * @returns {object|null} Three.js keyframe track。
 */
function createThreeTrackFromAnimationChannel(channel, timelineFps) {
  const target = channel?.target || {};
  const path = String(target.path || '');
  const trackName = String(target.originalTrackName || createFallbackTrackName(target));
  if (!trackName) {
    return null;
  }

  const keyframes = Array.isArray(channel?.sampler?.keyframes) ? channel.sampler.keyframes : [];
  if (keyframes.length === 0) {
    return null;
  }

  const times = [];
  const values = [];
  const bindTranslation = path === 'translation' && Array.isArray(target.bindTranslation)
    ? target.bindTranslation
    : null;
  const bindRotation = path === 'rotation' && Array.isArray(target.bindRotation)
    ? target.bindRotation
    : null;
  for (const keyframe of keyframes) {
    const time = Number.isFinite(keyframe?.time)
      ? Number(keyframe.time)
      : (Number(keyframe?.frameNum) || 0) / (timelineFps || DEFAULT_TIMELINE_FPS);
    times.push(time);

    if (path === 'weights') {
      values.push(Number(keyframe?.value) || 0);
    } else {
      const value = Array.from(keyframe?.value || (path === 'rotation' ? [0, 0, 0, 1] : [0, 0, 0]));
      if (bindTranslation) {
        value[0] += Number(bindTranslation[0]) || 0;
        value[1] += Number(bindTranslation[1]) || 0;
        value[2] += Number(bindTranslation[2]) || 0;
      }
      const resolvedValue = bindRotation ? addRotation(value, bindRotation) : value;
      for (const component of resolvedValue) {
        values.push(Number(component) || 0);
      }
    }
  }

  const interpolation = mapClipInterpolationToThree(channel?.sampler?.interpolation);
  if (path === 'rotation') {
    return new QuaternionKeyframeTrack(trackName, times, values, interpolation);
  }
  if (path === 'translation' || path === 'scale') {
    return new VectorKeyframeTrack(trackName, times, values, interpolation);
  }
  if (path === 'weights') {
    return new NumberKeyframeTrack(trackName, times, values, interpolation);
  }
  return null;
}

/**
 * clip channel に key を追加または更新します。
 * @param {object} clip - animation clip。
 * @param {object} target - channel target。
 * @param {object} nextKeyframe - 追加/更新する keyframe。
 * @param {number|Array<number>} fallbackValue - 既定値。
 */
function upsertClipChannelKeyframe(clip, target, nextKeyframe, fallbackValue) {
  let channel = (clip.channels || []).find((item) => isSameChannelTarget(item?.target, target)) || null;
  if (!channel) {
    const originalTrackName = createFallbackTrackName(target);
    channel = {
      target: {
        ...target,
        nodeName: String(target.name || ''),
        originalTrackName,
      },
      sampler: {
        interpolation: nextKeyframe?.vmdInterpolation ? 'VMD_BEZIER' : 'LINEAR',
        keyframes: [],
      },
    };
    clip.channels.push(channel);
  }
  if (nextKeyframe?.vmdInterpolation) {
    channel.sampler.interpolation = 'VMD_BEZIER';
  }

  const keyframes = channel.sampler.keyframes;
  const existing = keyframes.find((item) => Math.round(Number(item.frameNum) || 0) === nextKeyframe.frameNum) || null;
  if (existing) {
    existing.time = nextKeyframe.time;
    existing.frameNum = nextKeyframe.frameNum;
    existing.value = cloneValue(nextKeyframe.value);
    if (nextKeyframe?.vmdInterpolation !== undefined) {
      existing.vmdInterpolation = cloneValue(nextKeyframe.vmdInterpolation);
    }
    return;
  }

  const previousValue = sampleAnimationChannelValue(channel, nextKeyframe.time);
  keyframes.push({
    time: nextKeyframe.time,
    frameNum: nextKeyframe.frameNum,
    value: cloneValue(previousValue ?? fallbackValue),
  });
  keyframes.sort((left, right) => left.time - right.time);
  const inserted = keyframes.find((item) => Math.round(Number(item.frameNum) || 0) === nextKeyframe.frameNum);
  if (inserted) {
    inserted.value = cloneValue(nextKeyframe.value);
    if (nextKeyframe?.vmdInterpolation !== undefined) {
      inserted.vmdInterpolation = cloneValue(nextKeyframe.vmdInterpolation);
    }
  }
}

/**
 * track binding 名を分解します。
 * @param {string} trackName - Three.js track 名。
 * @returns {{nodeName: string, propertyName: string, propertyIndex: (string|number|null)}|null} 分解結果。
 */
function parseThreeTrackBinding(trackName) {
  if (!trackName) {
    return null;
  }

  try {
    const parsed = PropertyBinding.parseTrackName(trackName);
    return {
      nodeName: String(parsed?.nodeName || ''),
      propertyName: String(parsed?.propertyName || ''),
      propertyIndex: parsed?.propertyIndex ?? null,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Three.js property 名を OpenMMD path へ変換します。
 * @param {string} propertyName - Three.js property 名。
 * @returns {'translation'|'rotation'|'scale'|'weights'|''} OpenMMD path。
 */
function mapThreePropertyToTargetPath(propertyName) {
  if (propertyName === 'position') {
    return 'translation';
  }
  if (propertyName === 'quaternion') {
    return 'rotation';
  }
  if (propertyName === 'scale') {
    return 'scale';
  }
  if (propertyName === 'morphTargetInfluences') {
    return 'weights';
  }
  return '';
}

/**
 * Three.js track の補間モードを OpenMMD sampler 名へ変換します。
 * @param {object} track - Three.js keyframe track。
 * @returns {'LINEAR'|'STEP'|'CUBICSPLINE'} OpenMMD interpolation。
 */
function mapThreeInterpolationToClip(track) {
  const interpolation = typeof track?.getInterpolation === 'function'
    ? track.getInterpolation()
    : InterpolateLinear;
  if (interpolation === InterpolateDiscrete) {
    return 'STEP';
  }
  if (interpolation === InterpolateSmooth) {
    return 'CUBICSPLINE';
  }
  return 'LINEAR';
}

/**
 * OpenMMD sampler 補間名を Three.js 補間定数へ変換します。
 * @param {string} interpolation - OpenMMD interpolation。
 * @returns {number} Three.js interpolation 定数。
 */
function mapClipInterpolationToThree(interpolation) {
  const normalized = String(interpolation || 'LINEAR').toUpperCase();
  if (normalized === 'STEP') {
    return InterpolateDiscrete;
  }
  if (normalized === 'CUBICSPLINE') {
    return InterpolateSmooth;
  }
  return InterpolateLinear;
}

/**
 * track の value サイズを返します。
 * @param {object} track - Three.js track。
 * @param {string} targetPath - OpenMMD path。
 * @returns {number} value サイズ。
 */
function getTrackValueSize(track, targetPath) {
  if (targetPath === 'rotation') {
    return 4;
  }
  if (targetPath === 'weights') {
    return 1;
  }
  return 3;
}

/**
 * Three.js track values 配列から 1 keyframe 分を読み取ります。
 * @param {ArrayLike<number>} values - values 配列。
 * @param {number} index - keyframe 番号。
 * @param {number} valueSize - 1 key の値サイズ。
 * @param {string} targetPath - OpenMMD path。
 * @returns {number|Array<number>} 変換値。
 */
function readTrackValue(values, index, valueSize, targetPath) {
  const offset = index * valueSize;
  if (targetPath === 'weights') {
    return Number(values[offset]) || 0;
  }

  const result = [];
  for (let component = 0; component < valueSize; component++) {
    result.push(Number(values[offset + component]) || 0);
  }
  return result;
}

/**
 * target から fallback の track 名を生成します。
 * @param {object} target - channel target。
 * @returns {string} Three.js track 名。
 */
function createFallbackTrackName(target) {
  const nodeName = String(target?.nodeName || target?.name || '').trim();
  const path = String(target?.path || '');
  if (!nodeName) {
    return '';
  }
  if (path === 'translation') {
    return `${nodeName}.position`;
  }
  if (path === 'rotation') {
    return `${nodeName}.quaternion`;
  }
  if (path === 'scale') {
    return `${nodeName}.scale`;
  }
  if (path === 'weights') {
    const propertyIndex = target?.propertyIndex ?? target?.name ?? '';
    return `${nodeName}.morphTargetInfluences[${propertyIndex}]`;
  }
  return '';
}

/**
 * channel target の同一性を判定します。
 * @param {object|null} left - 左 target。
 * @param {object|null} right - 右 target。
 * @returns {boolean} 同一なら true。
 */
function isSameChannelTarget(left, right) {
  return String(left?.kind || '') === String(right?.kind || '')
    && String(left?.name || '') === String(right?.name || '')
    && String(left?.path || '') === String(right?.path || '');
}

/**
 * 値を複製します。
 * @param {number|ArrayLike<number>} value - 対象値。
 * @returns {number|Array<number>} 複製値。
 */
function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (value && typeof value === 'object' && typeof value.length === 'number') {
    return Array.from(value);
  }
  return Number(value) || 0;
}

/**
 * quaternion 値を正規化します。
 * @param {ArrayLike<number>|null|undefined} value - 入力 quaternion。
 * @returns {number[]} 正規化済み quaternion。
 */
function normalizeQuaternion(value) {
  const normalized = quat.fromValues(
    Number(value?.[0]) || 0,
    Number(value?.[1]) || 0,
    Number(value?.[2]) || 0,
    Number.isFinite(Number(value?.[3])) ? Number(value[3]) : 1,
  );
  quat.normalize(normalized, normalized);
  return Array.from(normalized);
}

/**
 * channel の duration を返します。
 * @param {object} channel - channel。
 * @returns {number} duration。
 */
function getChannelDuration(channel) {
  const keyframes = channel?.sampler?.keyframes;
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return 0;
  }
  return Number(keyframes[keyframes.length - 1].time) || 0;
}
