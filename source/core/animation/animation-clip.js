import { quat, vec3 } from '../../lib/esm/index.js';
import { quatSlerp, quaternionFromEulerXYZ, quaternionToEulerXYZ } from '../../shared/math/math-utils.js';

const VMD_TIMELINE_FPS = 30;
const DEFAULT_BONE_INTERPOLATION = createDefaultBoneInterpolation();
const VRMA_CAMERA_TARGET_NODE_NAME = 'OMMD_CameraTarget';
const VRMA_CAMERA_ORBIT_NODE_NAME = 'OMMD_CameraOrbit';
const VRMA_CAMERA_NODE_NAME = 'OMMD_Camera';
const VRMA_LIGHT_NODE_NAME = 'OMMD_DirectionalLight';
const VRMA_CAMERA_FOV_POINTER = '/cameras/0/perspective/yfov';
const VRMA_LIGHT_COLOR_POINTER = '/extensions/KHR_lights_punctual/lights/0/color';

/**
 * 汎用アニメーションクリップを作成します。
 * @param {object} [options={}] - 初期値。
 * @param {string} [options.name=''] - Clip 名。
 * @param {number} [options.timelineFps=30] - タイムライン FPS。
 * @param {object} [options.metadata={}] - 補助メタデータ。
 * @returns {object} アニメーションクリップ。
 */
export function createEmptyAnimationClip(options = {}) {
  return {
    name: String(options.name || ''),
    timelineFps: Number.isFinite(options.timelineFps) && options.timelineFps > 0 ? options.timelineFps : VMD_TIMELINE_FPS,
    duration: 0,
    channels: [],
    metadata: options.metadata ? { ...options.metadata } : {},
  };
}

/**
 * VMD 互換の空ドキュメントを作成します。
 * @param {string} [modelName='Default'] - モデル名。
 * @returns {object} VMD ドキュメント。
 */
export function createEmptyVmdDocument(modelName = 'Default') {
  const vmd = {
    signature: 'Vocaloid Motion Data 0002',
    modelName,
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [],
    selfShadowKeyframes: [],
  };
  vmd.animationClip = createAnimationClipFromVmd(vmd);
  return vmd;
}

/**
 * ソースから animation clip を取得します。
 * @param {object|null|undefined} source - クリップまたは VMD 互換ドキュメント。
 * @returns {object|null} animation clip。
 */
export function ensureAnimationClip(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  if (Array.isArray(source.channels)) {
    return source;
  }
  if (source.animationClip && Array.isArray(source.animationClip.channels)) {
    return source.animationClip;
  }
  if (
    Array.isArray(source.boneKeyframes)
    || Array.isArray(source.faceKeyframes)
    || Array.isArray(source.cameraKeyframes)
    || Array.isArray(source.lightKeyframes)
  ) {
    source.animationClip = createAnimationClipFromVmd(source);
    return source.animationClip;
  }
  return null;
}

/**
 * VMD ドキュメントから汎用 animation clip を構築します。
 * @param {object|null|undefined} vmd - VMD ドキュメント。
 * @returns {object} animation clip。
 */
export function createAnimationClipFromVmd(vmd) {
  const clip = createEmptyAnimationClip({
    name: String(vmd?.modelName || ''),
    timelineFps: VMD_TIMELINE_FPS,
    metadata: {
      sourceFormat: 'vmd',
      vmdSignature: String(vmd?.signature || 'Vocaloid Motion Data 0002'),
      modelName: String(vmd?.modelName || 'Default'),
      cameraKeyframes: Array.isArray(vmd?.cameraKeyframes) ? vmd.cameraKeyframes.map(cloneCameraKeyframe) : [],
      lightKeyframes: Array.isArray(vmd?.lightKeyframes) ? vmd.lightKeyframes.map(cloneLightKeyframe) : [],
      selfShadowKeyframes: Array.isArray(vmd?.selfShadowKeyframes) ? vmd.selfShadowKeyframes.map(cloneSelfShadowKeyframe) : [],
    },
  });
  const maxFrames = [];
  const boneGroups = groupVmdBoneKeyframes(vmd?.boneKeyframes || vmd?.motions || []);
  const morphGroups = groupVmdMorphKeyframes(vmd?.faceKeyframes || vmd?.morphs || vmd?.faces || []);

  boneGroups.forEach((keyframes, boneName) => {
    const translationSampler = {
      interpolation: 'VMD_BEZIER',
      keyframes: keyframes.map((keyframe) => {
        maxFrames.push(keyframe.frameNum);
        return {
          time: normalizeFrameToTime(keyframe.frameNum),
          frameNum: keyframe.frameNum,
          value: Array.from(keyframe.position || keyframe.location || [0, 0, 0]),
          vmdInterpolation: cloneByteArray(keyframe.interpolation, 64),
        };
      }),
    };
    const rotationSampler = {
      interpolation: 'VMD_BEZIER',
      keyframes: keyframes.map((keyframe) => ({
        time: normalizeFrameToTime(keyframe.frameNum),
        frameNum: keyframe.frameNum,
        value: Array.from(keyframe.rotation || [0, 0, 0, 1]),
        vmdInterpolation: cloneByteArray(keyframe.interpolation, 64),
      })),
    };

    clip.channels.push({
      target: {
        kind: 'bone',
        name: boneName,
        path: 'translation',
      },
      sampler: translationSampler,
    });
    clip.channels.push({
      target: {
        kind: 'bone',
        name: boneName,
        path: 'rotation',
      },
      sampler: rotationSampler,
    });
  });

  morphGroups.forEach((keyframes, morphName) => {
    clip.channels.push({
      target: {
        kind: 'morph',
        name: morphName,
        path: 'weights',
      },
      sampler: {
        interpolation: 'LINEAR',
        keyframes: keyframes.map((keyframe) => {
          maxFrames.push(keyframe.frameNum);
          return {
            time: normalizeFrameToTime(keyframe.frameNum),
            frameNum: keyframe.frameNum,
            value: Number(keyframe.weight) || 0,
          };
        }),
      },
    });
  });

  appendVmdAuxiliaryChannels(clip);

  for (const keyframe of clip.metadata.cameraKeyframes) {
    maxFrames.push(Number(keyframe.frameNum) || 0);
  }
  for (const keyframe of clip.metadata.lightKeyframes) {
    maxFrames.push(Number(keyframe.frameNum) || 0);
  }
  for (const keyframe of clip.metadata.selfShadowKeyframes) {
    maxFrames.push(Number(keyframe.frameNum) || 0);
  }
  clip.duration = (maxFrames.length > 0 ? Math.max(...maxFrames) : 0) / clip.timelineFps;
  return clip;
}

/**
 * VMD 互換ドキュメントを同期した clip 付きで返します。
 * @param {object} vmd - VMD ドキュメント。
 * @returns {object} 同期済みドキュメント。
 */
export function syncVmdAnimationClip(vmd) {
  if (!vmd || typeof vmd !== 'object') {
    return vmd;
  }
  vmd.animationClip = createAnimationClipFromVmd(vmd);
  return vmd;
}

/**
 * source を VMD 書き出し用データへ変換します。
 * @param {object} source - animation clip または VMD 互換ドキュメント。
 * @param {object} [options={}] - 変換オプション。
 * @param {number} [options.resampleFps=30] - リサンプル FPS。
 * @returns {{vmd: object, warnings: object[]}} 変換結果。
 */
export function serializeAnimationSourceToVmd(source, options = {}) {
  if (looksLikeVmdDocument(source) && !hasUnsupportedAnimationChannels(source)) {
    return {
      vmd: normalizeVmdForExport(source),
      warnings: [],
    };
  }

  const clip = ensureAnimationClip(source);
  if (!clip) {
    return {
      vmd: createEmptyVmdDocument('Default'),
      warnings: [{
        code: 'missing-animation-source',
        message: 'Animation source is missing or invalid.',
      }],
    };
  }

  return serializeAnimationClipToVmd(clip, options);
}

/**
 * clip を VMD 書き出し用データへ変換します。
 * @param {object} clip - animation clip。
 * @param {object} [options={}] - 変換オプション。
 * @param {number} [options.resampleFps=30] - リサンプル FPS。
 * @returns {{vmd: object, warnings: object[]}} 変換結果。
 */
export function serializeAnimationClipToVmd(clip, options = {}) {
  const resampleFps = Number.isFinite(options.resampleFps) && options.resampleFps > 0
    ? options.resampleFps
    : VMD_TIMELINE_FPS;
  const warnings = [];
  const vmd = createEmptyVmdDocument(String(clip?.metadata?.modelName || clip?.name || 'Default'));
  vmd.signature = String(clip?.metadata?.vmdSignature || 'Vocaloid Motion Data 0002');

  const boneGroups = new Map();
  const morphGroups = new Map();
  const channels = Array.isArray(clip?.channels) ? clip.channels : [];

  for (const channel of channels) {
    const target = channel?.target || {};
    const path = String(target.path || '');
    const kind = String(target.kind || '');
    const name = String(target.name || target.nodeName || '').trim();
    if (!name && kind !== 'camera' && kind !== 'light' && kind !== 'shadow') {
      warnings.push(createWarning('missing-target-name', target, 'Channel target name is missing.'));
      continue;
    }

    if (kind === 'bone') {
      if (path === 'translation' || path === 'rotation' || path === 'scale') {
        if (!boneGroups.has(name)) {
          boneGroups.set(name, {});
        }
        boneGroups.get(name)[path] = channel;
        continue;
      }
      warnings.push(createWarning('unsupported-bone-path', target, `Bone path '${path}' is not supported by VMD export.`));
      continue;
    }

    if (kind === 'morph') {
      if (path === 'weights') {
        morphGroups.set(name, channel);
        continue;
      }
      warnings.push(createWarning('unsupported-morph-path', target, `Morph path '${path}' is not supported by VMD export.`));
      continue;
    }

    warnings.push(createWarning('unsupported-target-kind', target, `Target kind '${kind || 'unknown'}' is not supported by VMD export.`));
  }

  boneGroups.forEach((group, boneName) => {
    const scaleChannel = group.scale || null;
    if (scaleChannel) {
      warnings.push(createWarning(
        'unsupported-scale-channel',
        scaleChannel.target,
        `Scale animation for '${boneName}' is not supported by VMD export and will be skipped.`,
      ));
    }

    const translationChannel = group.translation || null;
    const rotationChannel = group.rotation || null;
    if (!translationChannel && !rotationChannel) {
      return;
    }

    const shouldResample = shouldResampleBoneGroup(translationChannel, rotationChannel);
    if (shouldResample) {
      warnings.push(createWarning(
        'resampled-bone-channel',
        translationChannel?.target || rotationChannel?.target || { kind: 'bone', name: boneName, path: 'translation' },
        `Bone animation for '${boneName}' uses non-VMD interpolation and was resampled at ${resampleFps} fps.`,
      ));
    }

    const frameNumbers = shouldResample
      ? collectResampleFramesForBoneGroup(translationChannel, rotationChannel, resampleFps)
      : collectExportFramesForBoneGroup(translationChannel, rotationChannel);

    for (const frameNum of frameNumbers) {
      const time = frameNum / resampleFps;
      const translationExact = getExactKeyframeAtFrame(translationChannel, frameNum, resampleFps);
      const rotationExact = getExactKeyframeAtFrame(rotationChannel, frameNum, resampleFps);
      const translationValue = translationExact
        ? translationExact.value
        : sampleAnimationChannelValue(translationChannel, time);
      const rotationValue = rotationExact
        ? rotationExact.value
        : sampleAnimationChannelValue(rotationChannel, time);
      const interpolation = cloneByteArray(
        translationExact?.vmdInterpolation || rotationExact?.vmdInterpolation,
        64,
        DEFAULT_BONE_INTERPOLATION,
      );

      vmd.boneKeyframes.push({
        boneName,
        frameNum,
        position: Array.from(translationValue || [0, 0, 0]),
        rotation: Array.from(rotationValue || [0, 0, 0, 1]),
        interpolation,
      });
    }
  });

  morphGroups.forEach((channel, morphName) => {
    const requiresResample = samplerRequiresResample(channel?.sampler);
    if (requiresResample) {
      warnings.push(createWarning(
        'resampled-morph-channel',
        channel?.target || { kind: 'morph', name: morphName, path: 'weights' },
        `Morph animation for '${morphName}' uses non-VMD interpolation and was resampled at ${resampleFps} fps.`,
      ));
    }
    const frameNumbers = requiresResample
      ? collectResampleFramesForChannel(channel, resampleFps)
      : collectExportFramesForChannel(channel, resampleFps);

    for (const frameNum of frameNumbers) {
      const time = frameNum / resampleFps;
      const exactKeyframe = getExactKeyframeAtFrame(channel, frameNum, resampleFps);
      const weight = exactKeyframe ? exactKeyframe.value : sampleAnimationChannelValue(channel, time);
      vmd.faceKeyframes.push({
        name: morphName,
        frameNum,
        weight: Number(weight) || 0,
      });
    }
  });

  vmd.cameraKeyframes = extractCameraKeyframesFromAnimationClip(clip);
  vmd.lightKeyframes = extractLightKeyframesFromAnimationClip(clip);
  vmd.selfShadowKeyframes = extractSelfShadowKeyframesFromAnimationClip(clip);
  vmd.boneKeyframes.sort((a, b) => a.frameNum - b.frameNum || compareStrings(a.boneName, b.boneName));
  vmd.faceKeyframes.sort((a, b) => a.frameNum - b.frameNum || compareStrings(a.name, b.name));

  return {
    vmd: syncVmdAnimationClip(vmd),
    warnings,
  };
}

/**
 * VRMA auxiliary channel から metadata.cameraKeyframes / lightKeyframes を同期します。
 * @param {object|null} clip - 対象 clip。
 * @returns {object|null} 同期済み clip。
 */
export function syncVrmaAuxiliaryMetadataFromChannels(clip) {
  if (!clip || !Array.isArray(clip.channels)) {
    return clip;
  }
  clip.metadata = clip.metadata && typeof clip.metadata === 'object' ? clip.metadata : {};
  clip.metadata.cameraKeyframes = extractCameraKeyframesFromAnimationClip(clip);
  clip.metadata.lightKeyframes = extractLightKeyframesFromAnimationClip(clip);
  clip.metadata.selfShadowKeyframes = extractSelfShadowKeyframesFromAnimationClip(clip);
  return clip;
}

/**
 * clip から camera keyframe を抽出します。
 * @param {object|null} clip - 対象 clip。
 * @returns {Array<object>} camera keyframe 列。
 */
export function extractCameraKeyframesFromAnimationClip(clip) {
  const keyframes = extractLogicalCameraKeyframesFromChannels(clip);
  if (keyframes.length > 0) {
    return keyframes;
  }
  if (Array.isArray(clip?.metadata?.cameraKeyframes)) {
    return clip.metadata.cameraKeyframes.map(cloneCameraKeyframe);
  }
  return [];
}

/**
 * clip から light keyframe を抽出します。
 * @param {object|null} clip - 対象 clip。
 * @returns {Array<object>} light keyframe 列。
 */
export function extractLightKeyframesFromAnimationClip(clip) {
  const keyframes = extractLogicalLightKeyframesFromChannels(clip);
  if (keyframes.length > 0) {
    return keyframes;
  }
  if (Array.isArray(clip?.metadata?.lightKeyframes)) {
    return clip.metadata.lightKeyframes.map(cloneLightKeyframe);
  }
  return [];
}

/**
 * clip から self-shadow keyframe を抽出します。
 * @param {object|null} clip - 対象 clip。
 * @returns {Array<object>} self-shadow keyframe 列。
 */
export function extractSelfShadowKeyframesFromAnimationClip(clip) {
  const keyframes = extractLogicalShadowKeyframesFromChannels(clip);
  if (keyframes.length > 0) {
    return keyframes;
  }
  if (Array.isArray(clip?.metadata?.selfShadowKeyframes)) {
    return clip.metadata.selfShadowKeyframes.map(cloneSelfShadowKeyframe);
  }
  return [];
}

/**
 * animation clip の camera key を追加または更新します。
 * @param {object} clip - animation clip。
 * @param {number} frameNum - フレーム番号。
 * @param {object} cameraKeyframe - camera keyframe の内容。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipCameraKeyframe(clip, frameNum, cameraKeyframe) {
  if (!clip) {
    return clip;
  }

  upsertAuxiliaryChannel(clip, {
    kind: 'camera',
    name: 'camera',
    path: 'target',
  }, Math.round(frameNum), Array.from(cameraKeyframe?.target || [0, 0, 0]).slice(0, 3));
  upsertAuxiliaryChannel(clip, {
    kind: 'camera',
    name: 'camera',
    path: 'rotation',
  }, Math.round(frameNum), Array.from(cameraKeyframe?.rotation || [0, 0, 0]).slice(0, 3));
  upsertAuxiliaryChannel(clip, {
    kind: 'camera',
    name: 'camera',
    path: 'distance',
  }, Math.round(frameNum), Number(cameraKeyframe?.distance) || 0);
  upsertAuxiliaryChannel(clip, {
    kind: 'camera',
    name: 'camera',
    path: 'fov',
  }, Math.round(frameNum), Number(cameraKeyframe?.fov) || 0);
  upsertAuxiliaryChannel(clip, {
    kind: 'camera',
    name: 'camera',
    path: 'perspective',
  }, Math.round(frameNum), Number.isFinite(Number(cameraKeyframe?.perspective)) ? Number(cameraKeyframe.perspective) : 1);
  clip.duration = Math.max(Number(clip.duration) || 0, Math.round(frameNum) / (Number(clip.timelineFps) || VMD_TIMELINE_FPS));
  return clip;
}

/**
 * animation clip の light key を追加または更新します。
 * @param {object} clip - animation clip。
 * @param {number} frameNum - フレーム番号。
 * @param {object} lightKeyframe - light keyframe の内容。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipLightKeyframe(clip, frameNum, lightKeyframe) {
  if (!clip) {
    return clip;
  }

  if (Array.isArray(lightKeyframe?.position) || ArrayBuffer.isView(lightKeyframe?.position)) {
    upsertAuxiliaryChannel(clip, {
      kind: 'light',
      name: 'light',
      path: 'position',
    }, Math.round(frameNum), Array.from(lightKeyframe.position).slice(0, 3));
  } else {
    removeAuxiliaryChannelKeyframe(clip, {
      kind: 'light',
      name: 'light',
      path: 'position',
    }, Math.round(frameNum));
  }
  if (Array.isArray(lightKeyframe?.rotation) || ArrayBuffer.isView(lightKeyframe?.rotation)) {
    upsertAuxiliaryChannel(clip, {
      kind: 'light',
      name: 'light',
      path: 'rotation',
    }, Math.round(frameNum), Array.from(lightKeyframe.rotation).slice(0, 4));
  }
  upsertAuxiliaryChannel(clip, {
    kind: 'light',
    name: 'light',
    path: 'color',
  }, Math.round(frameNum), Array.from(lightKeyframe?.color || [1, 1, 1]).slice(0, 3));
  clip.duration = Math.max(Number(clip.duration) || 0, Math.round(frameNum) / (Number(clip.timelineFps) || VMD_TIMELINE_FPS));
  return clip;
}

/**
 * animation clip の shadow key を追加または更新します。
 * @param {object} clip - animation clip。
 * @param {number} frameNum - フレーム番号。
 * @param {object} shadowKeyframe - shadow keyframe の内容。
 * @returns {object} 更新済み clip。
 */
export function upsertAnimationClipShadowKeyframe(clip, frameNum, shadowKeyframe) {
  if (!clip) {
    return clip;
  }

  upsertAuxiliaryChannel(clip, {
    kind: 'shadow',
    name: 'shadow',
    path: 'mode',
  }, Math.round(frameNum), Number(shadowKeyframe?.mode) || 0);
  upsertAuxiliaryChannel(clip, {
    kind: 'shadow',
    name: 'shadow',
    path: 'distance',
  }, Math.round(frameNum), Number(shadowKeyframe?.distance) || 0);
  clip.duration = Math.max(Number(clip.duration) || 0, Math.round(frameNum) / (Number(clip.timelineFps) || VMD_TIMELINE_FPS));
  return clip;
}

/**
 * clip から VRMA camera keyframe を抽出します。
 * @param {object|null} clip - 対象 clip。
 * @returns {Array<object>} camera keyframe 列。
 */
export function extractVrmaCameraKeyframesFromChannels(clip) {
  const logicalKeyframes = extractLogicalCameraKeyframesFromChannels(clip);
  if (logicalKeyframes.length > 0) {
    return logicalKeyframes;
  }
  const timelineFps = Number.isFinite(clip?.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : VMD_TIMELINE_FPS;
  const grouped = groupClipFramesByRole(clip, [
    `${VRMA_CAMERA_TARGET_NODE_NAME}:translation`,
    `${VRMA_CAMERA_ORBIT_NODE_NAME}:rotation`,
    `${VRMA_CAMERA_NODE_NAME}:translation`,
    VRMA_CAMERA_FOV_POINTER,
  ]);
  const frames = Array.from(grouped.keys()).sort((left, right) => left - right);
  const result = [];
  for (const frameNum of frames) {
    const entry = grouped.get(frameNum) || {};
    if (!entry.cameraTarget && !entry.cameraOrbit && !entry.cameraDistance && entry.cameraFovY == null) {
      continue;
    }
    const orbitEuler = Array.isArray(entry.cameraOrbit)
      ? quaternionToEulerXYZ(entry.cameraOrbit)
      : [0, 0, 0];
    const target = Array.isArray(entry.cameraTarget) ? entry.cameraTarget : [0, 0, 0];
    const cameraTranslation = Array.isArray(entry.cameraDistance) ? entry.cameraDistance : [0, 0, 0];
    result.push({
      frameNum,
      distance: Number(cameraTranslation[2]) || 0,
      target: Array.from(target),
      rotation: [
        -(Number(orbitEuler[0]) || 0),
        Number(orbitEuler[1]) || 0,
        Number(orbitEuler[2]) || 0,
      ],
      interpolation: cloneByteArray(entry.interpolation, 24, new Uint8Array(24)),
      fovInterpolation: null,
      fov: ((Number(entry.cameraFovY) || 0) * 180) / Math.PI,
      perspective: 1,
    });
  }
  return result;
}

/**
 * clip から VRMA light keyframe を抽出します。
 * @param {object|null} clip - 対象 clip。
 * @returns {Array<object>} light keyframe 列。
 */
export function extractVrmaLightKeyframesFromChannels(clip) {
  const logicalKeyframes = extractLogicalLightKeyframesFromChannels(clip);
  if (logicalKeyframes.length > 0) {
    return logicalKeyframes;
  }
  const grouped = groupClipFramesByRole(clip, [
    `${VRMA_LIGHT_NODE_NAME}:translation`,
    `${VRMA_LIGHT_NODE_NAME}:rotation`,
    VRMA_LIGHT_COLOR_POINTER,
  ]);
  const frames = Array.from(grouped.keys()).sort((left, right) => left - right);
  const result = [];
  for (const frameNum of frames) {
    const entry = grouped.get(frameNum) || {};
    if (!entry.lightPosition && !entry.lightRotation && !entry.lightColor) {
      continue;
    }
    const rotation = Array.isArray(entry.lightRotation) ? Array.from(entry.lightRotation) : [0, 0, 0, 1];
    const direction = vec3.transformQuat(vec3.create(), [0, -1, 0], rotation);
    result.push({
      frameNum,
      color: Array.isArray(entry.lightColor) ? Array.from(entry.lightColor) : [1, 1, 1],
      position: Array.isArray(entry.lightPosition) ? Array.from(entry.lightPosition) : null,
      direction: [direction[0], direction[1], direction[2]],
      rotation,
      keyedPosition: Array.isArray(entry.lightPosition),
      keyedRotation: Array.isArray(entry.lightRotation),
    });
  }
  return result;
}

/**
 * channel の現在値をサンプリングします。
 * @param {object|null|undefined} channel - 対象 channel。
 * @param {number} time - 秒。
 * @returns {number[]|number|null} 値。
 */
export function sampleAnimationChannelValue(channel, time) {
  if (!channel?.sampler || !Array.isArray(channel.sampler.keyframes) || channel.sampler.keyframes.length === 0) {
    return getDefaultValueForTarget(channel?.target || null);
  }
  const sampler = channel.sampler;
  const keyframes = sampler.keyframes;
  const kind = getValueKindForTarget(channel?.target || {});
  const t = Number.isFinite(time) ? time : 0;

  if (keyframes.length === 1 || t <= keyframes[0].time) {
    return cloneValue(keyframes[0].value, kind);
  }
  if (t >= keyframes[keyframes.length - 1].time) {
    return cloneValue(keyframes[keyframes.length - 1].value, kind);
  }

  let startIndex = 0;
  let endIndex = 1;
  for (let i = 1; i < keyframes.length; i++) {
    if (t <= keyframes[i].time) {
      startIndex = i - 1;
      endIndex = i;
      break;
    }
  }

  const start = keyframes[startIndex];
  const end = keyframes[endIndex];
  const duration = end.time - start.time;
  const localT = duration > 0 ? (t - start.time) / duration : 0;
  const interpolation = String(sampler.interpolation || 'LINEAR').toUpperCase();

  if (interpolation === 'STEP') {
    return cloneValue(start.value, kind);
  }
  if (interpolation === 'CUBICSPLINE') {
    return interpolateCubicSpline(kind, start, end, localT, duration);
  }
  if (interpolation === 'VMD_BEZIER') {
    return interpolateVmdBezier(channel?.target || {}, start, end, localT);
  }
  return interpolateLinear(kind, start.value, end.value, localT);
}

/**
 * export warning を UI 表示向け文字列へ整形します。
 * @param {Array<{name: string, warnings: object[]}>} results - ファイルごとの warning 一覧。
 * @returns {string} 表示メッセージ。
 */
export function formatVmdExportWarnings(results) {
  const sections = [];
  for (const result of results) {
    if (!Array.isArray(result?.warnings) || result.warnings.length === 0) {
      continue;
    }
    const lines = [`${result.name}:`];
    for (const warning of result.warnings) {
      lines.push(`- ${warning.message}`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

function looksLikeVmdDocument(source) {
  return Boolean(source)
    && typeof source === 'object'
    && (Array.isArray(source.boneKeyframes)
      || Array.isArray(source.faceKeyframes)
      || Array.isArray(source.cameraKeyframes)
      || Array.isArray(source.lightKeyframes)
      || Array.isArray(source.selfShadowKeyframes));
}

function hasUnsupportedAnimationChannels(source) {
  const clip = ensureAnimationClip(source);
  if (!clip) {
    return false;
  }
  return clip.channels.some((channel) => {
    const target = channel?.target || {};
    if (target.kind === 'bone' && target.path !== 'translation' && target.path !== 'rotation') {
      return true;
    }
    return target.kind !== 'bone' && target.kind !== 'morph';
  });
}

function normalizeVmdForExport(vmd) {
  return syncVmdAnimationClip({
    signature: String(vmd?.signature || 'Vocaloid Motion Data 0002'),
    modelName: String(vmd?.modelName || 'Default'),
    boneKeyframes: Array.isArray(vmd?.boneKeyframes) ? vmd.boneKeyframes.map(cloneBoneKeyframe) : [],
    faceKeyframes: Array.isArray(vmd?.faceKeyframes) ? vmd.faceKeyframes.map(cloneMorphKeyframe) : [],
    cameraKeyframes: Array.isArray(vmd?.cameraKeyframes) ? vmd.cameraKeyframes.map(cloneCameraKeyframe) : [],
    lightKeyframes: Array.isArray(vmd?.lightKeyframes) ? vmd.lightKeyframes.map(cloneLightKeyframe) : [],
    selfShadowKeyframes: Array.isArray(vmd?.selfShadowKeyframes) ? vmd.selfShadowKeyframes.map(cloneSelfShadowKeyframe) : [],
  });
}

function groupVmdBoneKeyframes(keyframes) {
  const groups = new Map();
  for (const keyframe of keyframes) {
    const name = String(keyframe?.boneName || '').trim();
    if (!name) {
      continue;
    }
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(cloneBoneKeyframe(keyframe));
  }
  groups.forEach((entries) => {
    entries.sort((a, b) => a.frameNum - b.frameNum);
  });
  return groups;
}

function groupVmdMorphKeyframes(keyframes) {
  const groups = new Map();
  for (const keyframe of keyframes) {
    const name = String(keyframe?.name || keyframe?.morphName || '').trim();
    if (!name) {
      continue;
    }
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(cloneMorphKeyframe(keyframe));
  }
  groups.forEach((entries) => {
    entries.sort((a, b) => a.frameNum - b.frameNum);
  });
  return groups;
}

function cloneBoneKeyframe(keyframe) {
  return {
    boneName: String(keyframe?.boneName || ''),
    frameNum: Number(keyframe?.frameNum) || 0,
    position: Array.from(keyframe?.position || keyframe?.location || [0, 0, 0]),
    rotation: Array.from(keyframe?.rotation || [0, 0, 0, 1]),
    interpolation: cloneByteArray(keyframe?.interpolation, 64, DEFAULT_BONE_INTERPOLATION),
  };
}

function cloneMorphKeyframe(keyframe) {
  return {
    name: String(keyframe?.name || keyframe?.morphName || ''),
    frameNum: Number(keyframe?.frameNum) || 0,
    weight: Number(keyframe?.weight) || 0,
  };
}

function cloneCameraKeyframe(keyframe) {
  return {
    frameNum: Number(keyframe?.frameNum) || 0,
    distance: Number(keyframe?.distance) || 0,
    target: Array.from(keyframe?.target || [0, 0, 0]),
    rotation: Array.from(keyframe?.rotation || [0, 0, 0]),
    interpolation: cloneByteArray(keyframe?.interpolation, 24, new Uint8Array(24)),
    fovInterpolation: keyframe?.fovInterpolation ? cloneByteArray(keyframe.fovInterpolation, keyframe.fovInterpolation.length) : null,
    fov: Number(keyframe?.fov) || 0,
    perspective: Number.isFinite(Number(keyframe?.perspective)) ? Number(keyframe.perspective) : 1,
  };
}

function cloneLightKeyframe(keyframe) {
  return {
    frameNum: Number(keyframe?.frameNum) || 0,
    color: Array.from(keyframe?.color || [1, 1, 1]),
    position: keyframe?.position ? Array.from(keyframe.position) : null,
    direction: keyframe?.direction ? Array.from(keyframe.direction) : null,
    rotation: keyframe?.rotation ? Array.from(keyframe.rotation) : null,
    keyedPosition: keyframe?.keyedPosition !== false,
    keyedRotation: keyframe?.keyedRotation !== false,
  };
}

function cloneSelfShadowKeyframe(keyframe) {
  return {
    frameNum: Number(keyframe?.frameNum) || 0,
    mode: Number(keyframe?.mode) || 0,
    distance: Number(keyframe?.distance) || 0,
  };
}

function appendVmdAuxiliaryChannels(clip) {
  appendLogicalCameraChannelsFromKeyframes(clip, clip?.metadata?.cameraKeyframes || []);
  appendLogicalLightChannelsFromKeyframes(clip, clip?.metadata?.lightKeyframes || []);
  appendLogicalShadowChannelsFromKeyframes(clip, clip?.metadata?.selfShadowKeyframes || []);
}

function appendLogicalCameraChannelsFromKeyframes(clip, keyframes) {
  for (const keyframe of keyframes || []) {
    upsertAuxiliaryChannel(clip, {
      kind: 'camera',
      name: 'camera',
      path: 'target',
    }, Number(keyframe?.frameNum) || 0, Array.from(keyframe?.target || [0, 0, 0]).slice(0, 3));
    upsertAuxiliaryChannel(clip, {
      kind: 'camera',
      name: 'camera',
      path: 'rotation',
    }, Number(keyframe?.frameNum) || 0, Array.from(keyframe?.rotation || [0, 0, 0]).slice(0, 3));
    upsertAuxiliaryChannel(clip, {
      kind: 'camera',
      name: 'camera',
      path: 'distance',
    }, Number(keyframe?.frameNum) || 0, Number(keyframe?.distance) || 0);
    upsertAuxiliaryChannel(clip, {
      kind: 'camera',
      name: 'camera',
      path: 'fov',
    }, Number(keyframe?.frameNum) || 0, Number(keyframe?.fov) || 0);
    upsertAuxiliaryChannel(clip, {
      kind: 'camera',
      name: 'camera',
      path: 'perspective',
    }, Number(keyframe?.frameNum) || 0, Number.isFinite(Number(keyframe?.perspective)) ? Number(keyframe.perspective) : 1);
  }
}

function appendLogicalLightChannelsFromKeyframes(clip, keyframes) {
  for (const keyframe of keyframes || []) {
    if (Array.isArray(keyframe?.position)) {
      upsertAuxiliaryChannel(clip, {
        kind: 'light',
        name: 'light',
        path: 'position',
      }, Number(keyframe?.frameNum) || 0, Array.from(keyframe.position).slice(0, 3));
    }
    if (Array.isArray(keyframe?.rotation)) {
      upsertAuxiliaryChannel(clip, {
        kind: 'light',
        name: 'light',
        path: 'rotation',
      }, Number(keyframe?.frameNum) || 0, Array.from(keyframe.rotation).slice(0, 4));
    }
    upsertAuxiliaryChannel(clip, {
      kind: 'light',
      name: 'light',
      path: 'color',
    }, Number(keyframe?.frameNum) || 0, Array.from(keyframe?.color || [1, 1, 1]).slice(0, 3));
  }
}

function appendLogicalShadowChannelsFromKeyframes(clip, keyframes) {
  for (const keyframe of keyframes || []) {
    upsertAuxiliaryChannel(clip, {
      kind: 'shadow',
      name: 'shadow',
      path: 'mode',
    }, Number(keyframe?.frameNum) || 0, Number(keyframe?.mode) || 0);
    upsertAuxiliaryChannel(clip, {
      kind: 'shadow',
      name: 'shadow',
      path: 'distance',
    }, Number(keyframe?.frameNum) || 0, Number(keyframe?.distance) || 0);
  }
}

function extractLogicalCameraKeyframesFromChannels(clip) {
  return extractLogicalAuxiliaryKeyframesFromChannels(clip, 'camera', (frameNum, entry) => {
    if (entry.target == null && entry.rotation == null && entry.distance == null && entry.fov == null && entry.perspective == null) {
      return null;
    }
    return {
      frameNum,
      distance: Number(entry.distance) || 0,
      target: Array.isArray(entry.target) ? entry.target : [0, 0, 0],
      rotation: Array.isArray(entry.rotation) ? entry.rotation : [0, 0, 0],
      interpolation: new Uint8Array(24),
      fovInterpolation: null,
      fov: Number(entry.fov) || 0,
      perspective: Number.isFinite(Number(entry.perspective)) ? Number(entry.perspective) : 1,
    };
  });
}

function extractLogicalLightKeyframesFromChannels(clip) {
  return extractLogicalAuxiliaryKeyframesFromChannels(clip, 'light', (frameNum, entry) => {
    if (entry.position == null && entry.rotation == null && entry.color == null) {
      return null;
    }
    const rotation = Array.isArray(entry.rotation) ? entry.rotation : [0, 0, 0, 1];
    const direction = vec3.transformQuat(vec3.create(), [0, -1, 0], rotation);
    return {
      frameNum,
      color: Array.isArray(entry.color) ? entry.color : [1, 1, 1],
      position: Array.isArray(entry.position) ? entry.position : null,
      direction: [direction[0], direction[1], direction[2]],
      rotation,
      keyedPosition: Array.isArray(entry.position),
      keyedRotation: Array.isArray(entry.rotation),
    };
  });
}

function extractLogicalShadowKeyframesFromChannels(clip) {
  return extractLogicalAuxiliaryKeyframesFromChannels(clip, 'shadow', (frameNum, entry) => {
    if (entry.mode == null && entry.distance == null) {
      return null;
    }
    return {
      frameNum,
      mode: Number(entry.mode) || 0,
      distance: Number(entry.distance) || 0,
    };
  });
}

function extractLogicalAuxiliaryKeyframesFromChannels(clip, targetKind, createEntry) {
  const grouped = new Map();
  const timelineFps = Number.isFinite(clip?.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : VMD_TIMELINE_FPS;
  for (const channel of clip?.channels || []) {
    const target = channel?.target || {};
    if (String(target.kind || '') !== targetKind) {
      continue;
    }
    const path = String(target.path || '').trim();
    for (const keyframe of channel?.sampler?.keyframes || []) {
      const frameNum = Number.isFinite(keyframe?.frameNum)
        ? Math.round(keyframe.frameNum)
        : Math.round((Number(keyframe?.time) || 0) * timelineFps);
      if (!grouped.has(frameNum)) {
        grouped.set(frameNum, {});
      }
      grouped.get(frameNum)[path] = Array.isArray(keyframe?.value) || ArrayBuffer.isView(keyframe?.value)
        ? Array.from(keyframe.value)
        : Number(keyframe?.value);
    }
  }

  return Array.from(grouped.keys())
    .sort((left, right) => left - right)
    .map((frameNum) => createEntry(frameNum, grouped.get(frameNum) || {}))
    .filter(Boolean);
}

function upsertAuxiliaryChannel(clip, target, frameNum, value) {
  if (!clip || !Array.isArray(clip.channels)) {
    return;
  }
  const time = frameNum / (Number(clip.timelineFps) || VMD_TIMELINE_FPS);
  let channel = clip.channels.find((item) => (
    String(item?.target?.kind || '') === String(target.kind || '')
    && String(item?.target?.name || '') === String(target.name || '')
    && String(item?.target?.path || '') === String(target.path || '')
    && String(item?.target?.pointer || '') === String(target.pointer || '')
  )) || null;
  if (!channel) {
    channel = {
      target: { ...target },
      sampler: {
        interpolation: 'LINEAR',
        keyframes: [],
      },
    };
    clip.channels.push(channel);
  }
  const nextValue = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : Number(value) || 0;
  const existing = channel.sampler.keyframes.find((keyframe) => Number(keyframe?.frameNum) === Number(frameNum)) || null;
  if (existing) {
    existing.time = time;
    existing.value = nextValue;
    return;
  }
  channel.sampler.keyframes.push({
    time,
    frameNum,
    value: nextValue,
  });
  channel.sampler.keyframes.sort((left, right) => left.time - right.time);
}

function removeAuxiliaryChannelKeyframe(clip, target, frameNum) {
  if (!clip || !Array.isArray(clip.channels)) {
    return;
  }

  for (const channel of clip.channels) {
    if (
      String(channel?.target?.kind || '') !== String(target.kind || '')
      || String(channel?.target?.name || '') !== String(target.name || '')
      || String(channel?.target?.path || '') !== String(target.path || '')
    ) {
      continue;
    }
    const nextKeyframes = Array.isArray(channel?.sampler?.keyframes)
      ? channel.sampler.keyframes.filter((keyframe) => Math.round(Number(keyframe?.frameNum) || 0) !== Math.round(frameNum))
      : [];
    channel.sampler.keyframes = nextKeyframes;
  }
  clip.channels = clip.channels.filter((channel) => Array.isArray(channel?.sampler?.keyframes) && channel.sampler.keyframes.length > 0);
}

function cloneByteArray(value, length, fallback = null) {
  if (value && typeof value.length === 'number') {
    const bytes = new Uint8Array(length ?? value.length);
    bytes.set(Array.from(value).slice(0, bytes.length));
    return bytes;
  }
  if (fallback && typeof fallback.length === 'number') {
    return new Uint8Array(fallback);
  }
  return length ? new Uint8Array(length) : new Uint8Array(0);
}

function createDefaultBoneInterpolation() {
  const interpolation = new Uint8Array(64);
  for (let i = 0; i < 4; i++) {
    interpolation[0 + i] = 20;
    interpolation[4 + i] = 20;
    interpolation[8 + i] = 107;
    interpolation[12 + i] = 107;
  }
  for (let row = 1; row < 4; row++) {
    for (let column = 0; column < 16; column++) {
      interpolation[row * 16 + column] = interpolation[column];
    }
  }
  return interpolation;
}

function groupClipFramesByRole(clip, _roles) {
  const grouped = new Map();
  const timelineFps = Number.isFinite(clip?.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : VMD_TIMELINE_FPS;
  for (const channel of clip?.channels || []) {
    const target = channel?.target || {};
    const name = String(target?.name || target?.nodeName || '').trim();
    const path = String(target?.path || '').trim();
    const pointer = String(target?.pointer || '').trim();
    let roleKey = '';
    if (target.kind === 'node') {
      roleKey = `${name}:${path}`;
    } else if (target.kind === 'pointer') {
      roleKey = pointer;
    } else {
      continue;
    }

    for (const keyframe of channel?.sampler?.keyframes || []) {
      const frameNum = Number.isFinite(keyframe?.frameNum)
        ? Math.round(keyframe.frameNum)
        : Math.round((Number(keyframe?.time) || 0) * timelineFps);
      if (!grouped.has(frameNum)) {
        grouped.set(frameNum, {});
      }
      const entry = grouped.get(frameNum);
      if (roleKey === `${VRMA_CAMERA_TARGET_NODE_NAME}:translation`) {
        entry.cameraTarget = Array.from(keyframe?.value || [0, 0, 0]);
      } else if (roleKey === `${VRMA_CAMERA_ORBIT_NODE_NAME}:rotation`) {
        entry.cameraOrbit = Array.from(keyframe?.value || [0, 0, 0, 1]);
      } else if (roleKey === `${VRMA_CAMERA_NODE_NAME}:translation`) {
        entry.cameraDistance = Array.from(keyframe?.value || [0, 0, 0]);
      } else if (roleKey === VRMA_CAMERA_FOV_POINTER) {
        entry.cameraFovY = Number(keyframe?.value) || 0;
      } else if (roleKey === `${VRMA_LIGHT_NODE_NAME}:translation`) {
        entry.lightPosition = Array.from(keyframe?.value || [0, 0, 0]);
      } else if (roleKey === `${VRMA_LIGHT_NODE_NAME}:rotation`) {
        entry.lightRotation = Array.from(keyframe?.value || [0, 0, 0, 1]);
      } else if (roleKey === VRMA_LIGHT_COLOR_POINTER) {
        entry.lightColor = Array.isArray(keyframe?.value) || ArrayBuffer.isView(keyframe?.value)
          ? Array.from(keyframe.value).slice(0, 3)
          : [1, 1, 1];
      }
    }
  }
  return grouped;
}

/**
 * camera keyframe を VRMA channel 値へ変換します。
 * @param {object} keyframe - camera keyframe。
 * @returns {{target: number[], orbit: number[], distance: number[], fovY: number}} 変換結果。
 */
export function convertCameraKeyframeToVrmaValues(keyframe) {
  const rotation = Array.isArray(keyframe?.rotation) ? keyframe.rotation : [0, 0, 0];
  return {
    target: Array.from(keyframe?.target || [0, 0, 0]).slice(0, 3),
    orbit: Array.from(quaternionFromEulerXYZ([
      -(Number(rotation[0]) || 0),
      Number(rotation[1]) || 0,
      Number(rotation[2]) || 0,
    ])),
    distance: [0, 0, Number(keyframe?.distance) || 0],
    fovY: ((Number(keyframe?.fov) || 0) * Math.PI) / 180,
  };
}

function normalizeFrameToTime(frameNum) {
  return (Number(frameNum) || 0) / VMD_TIMELINE_FPS;
}

function createWarning(code, target, message) {
  return {
    code,
    target: {
      kind: String(target?.kind || ''),
      name: String(target?.name || target?.nodeName || ''),
      path: String(target?.path || ''),
    },
    message,
  };
}

function shouldResampleBoneGroup(translationChannel, rotationChannel) {
  return samplerRequiresResample(translationChannel?.sampler)
    || samplerRequiresResample(rotationChannel?.sampler);
}

function samplerRequiresResample(sampler) {
  const interpolation = String(sampler?.interpolation || 'LINEAR').toUpperCase();
  return interpolation === 'STEP' || interpolation === 'CUBICSPLINE';
}

function collectExportFramesForBoneGroup(translationChannel, rotationChannel) {
  const frames = new Set();
  collectChannelFrames(translationChannel, frames);
  collectChannelFrames(rotationChannel, frames);
  if (frames.size === 0) {
    frames.add(0);
  }
  return Array.from(frames).sort((a, b) => a - b);
}

function collectResampleFramesForBoneGroup(translationChannel, rotationChannel, resampleFps) {
  const duration = Math.max(
    getChannelDuration(translationChannel),
    getChannelDuration(rotationChannel),
  );
  return collectResampleFramesFromDuration(duration, resampleFps);
}

function collectExportFramesForChannel(channel, resampleFps) {
  const frames = new Set();
  collectChannelFrames(channel, frames, resampleFps);
  if (frames.size === 0) {
    frames.add(0);
  }
  return Array.from(frames).sort((a, b) => a - b);
}

function collectResampleFramesForChannel(channel, resampleFps) {
  return collectResampleFramesFromDuration(getChannelDuration(channel), resampleFps);
}

function collectResampleFramesFromDuration(duration, resampleFps) {
  const maxFrame = Math.max(0, Math.round(duration * resampleFps));
  const frames = [];
  for (let frame = 0; frame <= maxFrame; frame++) {
    frames.push(frame);
  }
  return frames;
}

function collectChannelFrames(channel, frames, fps = VMD_TIMELINE_FPS) {
  if (!channel?.sampler?.keyframes) {
    return;
  }
  for (const keyframe of channel.sampler.keyframes) {
    if (Number.isFinite(keyframe?.frameNum)) {
      frames.add(Math.round(keyframe.frameNum));
      continue;
    }
    frames.add(Math.round((Number(keyframe?.time) || 0) * fps));
  }
}

function getChannelDuration(channel) {
  const keyframes = channel?.sampler?.keyframes;
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return 0;
  }
  return Number(keyframes[keyframes.length - 1].time) || 0;
}

function getExactKeyframeAtFrame(channel, frameNum, fps = VMD_TIMELINE_FPS) {
  const keyframes = channel?.sampler?.keyframes;
  if (!Array.isArray(keyframes)) {
    return null;
  }
  for (const keyframe of keyframes) {
    const keyframeFrame = Number.isFinite(keyframe?.frameNum)
      ? Math.round(keyframe.frameNum)
      : Math.round((Number(keyframe?.time) || 0) * fps);
    if (keyframeFrame === frameNum) {
      return keyframe;
    }
  }
  return null;
}

function getDefaultValueForTarget(target) {
  const kind = getValueKindForTarget(target || {});
  if (kind === 'quat') {
    return [0, 0, 0, 1];
  }
  if (kind === 'vec3') {
    if (target?.path === 'scale') {
      return [1, 1, 1];
    }
    if (target?.kind === 'light' && target?.path === 'color') {
      return [1, 1, 1];
    }
    return [0, 0, 0];
  }
  return 0;
}

function getValueKindForTarget(target) {
  const targetKind = String(target?.kind || '');
  const path = String(target?.path || '');
  if (targetKind === 'camera' && path === 'rotation') {
    return 'vec3';
  }
  if (targetKind === 'camera' && path === 'target') {
    return 'vec3';
  }
  if (targetKind === 'light' && path === 'color') {
    return 'vec3';
  }
  if (targetKind === 'light' && path === 'position') {
    return 'vec3';
  }
  if (targetKind === 'light' && path === 'rotation') {
    return 'quat';
  }
  if (path === 'rotation') {
    return 'quat';
  }
  if (path === 'translation' || path === 'scale') {
    return 'vec3';
  }
  return 'scalar';
}

function cloneValue(value, kind) {
  if (kind === 'scalar') {
    return Number(value) || 0;
  }
  return Array.from(value || getDefaultValueForTarget({ path: kind === 'quat' ? 'rotation' : 'translation' }));
}

function interpolateLinear(kind, startValue, endValue, t) {
  if (kind === 'scalar') {
    const start = Number(startValue) || 0;
    const end = Number(endValue) || 0;
    return start + (end - start) * t;
  }
  if (kind === 'quat') {
    const result = quat.create();
    quatSlerp(startValue || [0, 0, 0, 1], endValue || [0, 0, 0, 1], t, result);
    return Array.from(result);
  }
  const result = vec3.create();
  vec3.lerp(result, startValue || [0, 0, 0], endValue || [0, 0, 0], t);
  return Array.from(result);
}

function interpolateCubicSpline(kind, start, end, t, duration) {
  if (kind === 'scalar') {
    return cubicHermiteScalar(
      Number(start.value) || 0,
      Number(start.outTangent) || 0,
      Number(end.value) || 0,
      Number(end.inTangent) || 0,
      t,
      duration,
    );
  }

  const length = kind === 'quat' ? 4 : 3;
  const result = new Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = cubicHermiteScalar(
      Number(start.value?.[i]) || 0,
      Number(start.outTangent?.[i]) || 0,
      Number(end.value?.[i]) || 0,
      Number(end.inTangent?.[i]) || 0,
      t,
      duration,
    );
  }
  if (kind === 'quat') {
    const normalized = quat.fromValues(result[0], result[1], result[2], result[3]);
    quat.normalize(normalized, normalized);
    return Array.from(normalized);
  }
  return result;
}

function cubicHermiteScalar(v0, m0, v1, m1, t, duration) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * v0 + h10 * duration * m0 + h01 * v1 + h11 * duration * m1;
}

function interpolateVmdBezier(target, start, end, t) {
  const kind = getValueKindForTarget(target);
  const interpolation = start?.vmdInterpolation;
  if (!interpolation || interpolation.length < 16) {
    return interpolateLinear(kind, start.value, end.value, t);
  }

  if (kind === 'quat') {
    const rx1 = interpolation[3] / 127.0;
    const ry1 = interpolation[7] / 127.0;
    const rx2 = interpolation[11] / 127.0;
    const ry2 = interpolation[15] / 127.0;
    const rotationWeight = evaluateBezier(rx1, ry1, rx2, ry2, t);
    return interpolateLinear('quat', start.value, end.value, rotationWeight);
  }

  const result = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const x1 = interpolation[i] / 127.0;
    const y1 = interpolation[4 + i] / 127.0;
    const x2 = interpolation[8 + i] / 127.0;
    const y2 = interpolation[12 + i] / 127.0;
    const weight = evaluateBezier(x1, y1, x2, y2, t);
    const startValue = Number(start.value?.[i]) || 0;
    const endValue = Number(end.value?.[i]) || 0;
    result[i] = startValue + (endValue - startValue) * weight;
  }
  return result;
}

function evaluateBezier(x1, y1, x2, y2, t) {
  if (x1 === y1 && x2 === y2) {
    return t;
  }
  const bezierT = findBezierT(x1, x2, t);
  return evalBezierCurve(y1, y2, bezierT);
}

function findBezierT(x1, x2, x) {
  let start = 0.0;
  let end = 1.0;
  let t = 0.5;
  for (let i = 0; i < 12; i++) {
    const evalX = evalBezierCurve(x1, x2, t);
    if (evalX < x) {
      start = t;
    } else {
      end = t;
    }
    t = (start + end) * 0.5;
  }
  return t;
}

function evalBezierCurve(p1, p2, t) {
  const it = 1.0 - t;
  return 3 * t * it * it * p1 + 3 * t * t * it * p2 + t * t * t;
}

function compareStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}
