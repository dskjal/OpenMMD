import {
  createEmptyVmdDocument,
  ensureAnimationClip,
  syncVmdAnimationClip,
} from './animation-clip.js';
import {
  ensureAnimationMappingState,
} from './animation-mapper.js';

/**
 * @typedef {object} TimelineKeyframe
 * @property {number} frame
 * @property {string} kind
 * @property {any} source
 */

/**
 * @typedef {object} TimelineTrack
 * @property {string} id
 * @property {string} label
 * @property {string} category
 * @property {string} trackType
 * @property {string|null} parentId
 * @property {string|null} itemType
 * @property {boolean} [hidden]
 * @property {TimelineKeyframe[]} keyframes
 * @property {TimelineTrack[]} [children]
 */

/**
 * Creates an empty VMD object.
 * @param {string} modelName 
 * @returns {object}
 */
export function createEmptyVmd(modelName = 'Default') {
  return createEmptyVmdDocument(modelName);
}

/**
 * Adds or updates a bone keyframe in the VMD data.
 * @param {object} vmd 
 * @param {string} boneName 
 * @param {number} frameNum 
 * @param {vec3} position 
 * @param {quat} rotation 
 * @param {Uint8Array} [interpolation]
 * @returns {object} Updated or new VMD data.
 */
export function upsertBoneKeyframe(vmd, boneName, frameNum, position, rotation, interpolation = null) {
  if (!vmd) vmd = createEmptyVmd();
  if (!vmd.boneKeyframes) vmd.boneKeyframes = vmd.motions || [];
  
  let kf = vmd.boneKeyframes.find(k => k.boneName === boneName && k.frameNum === frameNum);
  if (kf) {
    kf.position = [...position];
    kf.rotation = [...rotation];
    if (interpolation) kf.interpolation = new Uint8Array(interpolation);
  } else {
    vmd.boneKeyframes.push({
      boneName,
      frameNum,
      position: [...position],
      rotation: [...rotation],
      interpolation: interpolation ? new Uint8Array(interpolation) : (function() {
        const arr = new Uint8Array(64);
        for (let i = 0; i < 4; i++) {
          arr[0 + i] = 20;
          arr[4 + i] = 20;
          arr[8 + i] = 107;
          arr[12 + i] = 107;
        }
        for (let i = 1; i < 4; i++) {
          for (let j = 0; j < 16; j++) {
            arr[i * 16 + j] = arr[j];
          }
        }
        return arr;
      })()
    });
    vmd.boneKeyframes.sort((a, b) => a.frameNum - b.frameNum);
  }
  return syncVmdAnimationClip(vmd);
}

/**
 * Adds or updates a morph keyframe in the VMD data.
 * @param {object} vmd 
 * @param {string} morphName 
 * @param {number} frameNum 
 * @param {number} weight 
 * @returns {object} Updated or new VMD data.
 */
export function upsertMorphKeyframe(vmd, morphName, frameNum, weight) {
  if (!vmd) vmd = createEmptyVmd();
  if (!vmd.faceKeyframes) vmd.faceKeyframes = vmd.morphs || vmd.faces || [];

  let kf = vmd.faceKeyframes.find(k => (k.name === morphName || k.morphName === morphName) && k.frameNum === frameNum);
  if (kf) {
    kf.weight = weight;
  } else {
    vmd.faceKeyframes.push({
      name: morphName,
      frameNum,
      weight
    });
    vmd.faceKeyframes.sort((a, b) => a.frameNum - b.frameNum);
  }
  return syncVmdAnimationClip(vmd);
}

/**
 * Adds or updates a light keyframe in the VMD data.
 * @param {object} vmd - VMD data.
 * @param {string|number} frameNum - Frame number.
 * @param {object} lightKeyframe - Light keyframe contents.
 * @param {ArrayLike<number>} lightKeyframe.color - Light color RGB.
 * @param {ArrayLike<number>|null} [lightKeyframe.position] - VMD point-light position.
 * @param {ArrayLike<number>} [lightKeyframe.direction] - Internal directional light direction.
 * @param {ArrayLike<number>} [lightKeyframe.rotation] - Internal directional light quaternion.
 * @param {boolean} [lightKeyframe.keyedPosition=true] - position を keyed とみなすかどうか。
 * @param {boolean} [lightKeyframe.keyedRotation=true] - rotation を keyed とみなすかどうか。
 * @returns {object} Updated or new VMD data.
 */
export function upsertLightKeyframe(vmd, frameNum, lightKeyframe) {
  if (!vmd) vmd = createEmptyVmd();
  if (!vmd.lightKeyframes) vmd.lightKeyframes = [];

  const existingKeyframe = vmd.lightKeyframes.find((item) => item.frameNum === frameNum) || null;
  const hasPosition = Object.prototype.hasOwnProperty.call(lightKeyframe || {}, 'position');
  const hasDirection = Object.prototype.hasOwnProperty.call(lightKeyframe || {}, 'direction');
  const hasRotation = Object.prototype.hasOwnProperty.call(lightKeyframe || {}, 'rotation');
  const keyedPosition = lightKeyframe?.keyedPosition !== false;
  const keyedRotation = lightKeyframe?.keyedRotation !== false;
  const nextKeyframe = {
    frameNum,
    color: Array.from(lightKeyframe?.color || [1, 1, 1]).slice(0, 3),
    position: hasPosition && lightKeyframe?.position
      ? Array.from(lightKeyframe.position).slice(0, 3)
      : null,
    direction: hasDirection && lightKeyframe?.direction
      ? Array.from(lightKeyframe.direction).slice(0, 3)
      : null,
    rotation: hasRotation && lightKeyframe?.rotation
      ? Array.from(lightKeyframe.rotation).slice(0, 4)
      : null,
    keyedPosition,
    keyedRotation,
  };

  if (existingKeyframe) {
    existingKeyframe.color = nextKeyframe.color;
    if (hasPosition) {
      existingKeyframe.position = nextKeyframe.position;
      existingKeyframe.keyedPosition = nextKeyframe.keyedPosition;
    } else if (!nextKeyframe.keyedPosition) {
      existingKeyframe.position = null;
      existingKeyframe.keyedPosition = false;
    }
    if (hasDirection) {
      existingKeyframe.direction = nextKeyframe.direction;
    }
    if (hasRotation) {
      existingKeyframe.rotation = nextKeyframe.rotation;
      existingKeyframe.keyedRotation = nextKeyframe.keyedRotation;
    }
  } else {
    vmd.lightKeyframes.push(nextKeyframe);
    vmd.lightKeyframes.sort((a, b) => a.frameNum - b.frameNum);
  }

  return syncVmdAnimationClip(vmd);
}

/**
 * Camera keyframe の既定補間を作成します。
 * @returns {Uint8Array} 24 bytes の補間データ。
 */
function createDefaultCameraInterpolation() {
  const interpolation = new Uint8Array(24);
  for (let i = 0; i < 24; i += 4) {
    interpolation[i + 0] = 20;
    interpolation[i + 1] = 20;
    interpolation[i + 2] = 107;
    interpolation[i + 3] = 107;
  }
  return interpolation;
}

/**
 * Camera keyframe を VMD データへ追加または更新します。
 * @param {object} vmd - VMD データ。
 * @param {number} frameNum - フレーム番号。
 * @param {object} cameraKeyframe - Camera keyframe の内容。
 * @param {number} cameraKeyframe.distance - Camera distance.
 * @param {ArrayLike<number>} cameraKeyframe.target - Target position.
 * @param {ArrayLike<number>} cameraKeyframe.rotation - Camera rotation.
 * @param {number} cameraKeyframe.fov - Field of view in degrees.
 * @param {Uint8Array|ArrayLike<number>} [cameraKeyframe.interpolation] - Interpolation bytes.
 * @param {Uint8Array|ArrayLike<number>} [cameraKeyframe.fovInterpolation] - FOV interpolation bytes.
 * @param {number} [cameraKeyframe.perspective=1] - Perspective toggle.
 * @returns {object} 更新済みの VMD データ。
 */
export function upsertCameraKeyframe(vmd, frameNum, cameraKeyframe) {
  if (!vmd) vmd = createEmptyVmd();
  if (!vmd.cameraKeyframes) vmd.cameraKeyframes = [];

  const existingKeyframe = vmd.cameraKeyframes.find((item) => item.frameNum === frameNum) || null;
  const interpolation = cameraKeyframe.interpolation
    ? new Uint8Array(cameraKeyframe.interpolation)
    : existingKeyframe && existingKeyframe.interpolation
      ? new Uint8Array(existingKeyframe.interpolation)
      : createDefaultCameraInterpolation();
  const fovInterpolation = cameraKeyframe.fovInterpolation
    ? new Uint8Array(cameraKeyframe.fovInterpolation)
    : existingKeyframe && existingKeyframe.fovInterpolation
      ? new Uint8Array(existingKeyframe.fovInterpolation)
      : null;

  const nextKeyframe = {
    frameNum,
    distance: cameraKeyframe.distance,
    target: Array.from(cameraKeyframe.target || [0, 0, 0]),
    rotation: Array.from(cameraKeyframe.rotation || [0, 0, 0]),
    interpolation,
    fovInterpolation,
    fov: cameraKeyframe.fov,
    perspective: cameraKeyframe.perspective ?? 1,
  };

  if (existingKeyframe) {
    existingKeyframe.distance = nextKeyframe.distance;
    existingKeyframe.target = nextKeyframe.target;
    existingKeyframe.rotation = nextKeyframe.rotation;
    existingKeyframe.interpolation = nextKeyframe.interpolation;
    existingKeyframe.fovInterpolation = nextKeyframe.fovInterpolation;
    existingKeyframe.fov = nextKeyframe.fov;
    existingKeyframe.perspective = nextKeyframe.perspective;
  } else {
    vmd.cameraKeyframes.push(nextKeyframe);
    vmd.cameraKeyframes.sort((a, b) => a.frameNum - b.frameNum);
  }

  return syncVmdAnimationClip(vmd);
}

/**
 * Creates a timeline keyframe entry.
 * @param {number} frame
 * @param {string} kind
 * @param {object} source
 * @returns {TimelineKeyframe}
 */
function createTimelineKeyframe(frame, kind, source) {
  return {
    frame,
    kind,
    source
  };
}

/**
 * Creates a timeline track object.
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.label
 * @param {string} options.category
 * @param {string} options.trackType
 * @param {string|null} [options.parentId]
 * @param {string|null} [options.itemType]
 * @param {TimelineKeyframe[]} [options.keyframes]
 * @param {TimelineTrack[]} [options.children]
 * @param {boolean} [options.hidden]
 * @returns {TimelineTrack}
 */
function createTimelineTrack(options) {
  return {
    id: options.id,
    label: options.label,
    category: options.category,
    trackType: options.trackType,
    parentId: options.parentId || null,
    itemType: options.itemType || null,
    hidden: Boolean(options.hidden),
    keyframes: options.keyframes || [],
    children: options.children || []
  };
}

/**
 * Creates a keyframe map keyed by item name.
 * @param {Array<object>} keyframes
 * @param {string} kind
 * @param {(keyframe: object) => string} getName
 * @param {(name: string) => string|null} [resolveName]
 * @returns {Map<string, TimelineKeyframe[]>}
 */
function createKeyframeMap(keyframes, kind, getName, resolveName = null) {
  const map = new Map();

  keyframes.forEach((kf) => {
    const rawName = getName(kf);
    const name = resolveName ? resolveName(rawName) || rawName : rawName;
    if (!name) return;

    if (!map.has(name)) {
      map.set(name, []);
    }
    map.get(name).push(createTimelineKeyframe(kf.frameNum, kind, kf));
  });

  map.forEach((frames) => {
    frames.sort((a, b) => a.frame - b.frame);
  });

  return map;
}

/**
 * Collects ordered item names from a model list and a keyframe map.
 * Model order is preserved and unmatched animated names are appended.
 * @param {Array<object>|undefined|null} modelItems
 * @param {Map<string, TimelineKeyframe[]>} keyframeMap
 * @returns {string[]}
 */
function collectOrderedNames(modelItems, keyframeMap) {
  const orderedNames = [];
  const seen = new Set();

  (modelItems || []).forEach((item) => {
    if (!item || !item.name || seen.has(item.name)) return;
    seen.add(item.name);
    orderedNames.push(item.name);
  });

  keyframeMap.forEach((_, name) => {
    if (seen.has(name)) return;
    seen.add(name);
    orderedNames.push(name);
  });

  return orderedNames;
}

/**
 * Creates a leaf timeline track for a bone or morph.
 * @param {string} name
 * @param {string} itemType
 * @param {TimelineKeyframe[]} keyframes
 * @returns {TimelineTrack}
 */
function createLeafTrack(name, itemType, keyframes) {
  return createTimelineTrack({
    id: `${itemType}:${name}`,
    label: name,
    category: itemType,
    trackType: itemType,
    itemType,
    keyframes
  });
}

/**
 * Creates a group timeline track for a display frame.
 * @param {string} id
 * @param {string} label
 * @param {TimelineTrack[]} children
 * @returns {TimelineTrack}
 */
function createGroupTrack(id, label, children) {
  const keyframes = [];

  children.forEach((child) => {
    keyframes.push(...child.keyframes);
  });
  keyframes.sort((a, b) => a.frame - b.frame);

  return createTimelineTrack({
    id,
    label,
    category: 'header',
    trackType: 'display-frame',
    keyframes,
    children
  });
}

/**
 * Creates a timeline track tree for the timeline from VMD and model data.
 * @param {object} vmd 
 * @param {object} model 
 * @returns {TimelineTrack[]}
 */
export function createTracksFromVmd(vmd, model) {
  return createTracksFromAnimationSource(vmd, model);
}

/**
 * animation source からタイムライン track tree を生成します。
 * @param {object|null} source - VMD または animation clip。
 * @param {object|null} model - モデルデータ。
 * @returns {TimelineTrack[]} track 一覧。
 */
export function createTracksFromAnimationSource(source, model) {
  const tracks = [];
  const normalizedSource = source || {};
  const bones = model && Array.isArray(model.bones) ? model.bones : [];
  const morphs = model && Array.isArray(model.morphs) ? model.morphs : [];
  const displayFrames = model && Array.isArray(model.displayFrames) ? model.displayFrames : [];
  const sourceKind = String(
    normalizedSource.kind
    || normalizedSource.metadata?.sourceFormat
    || normalizedSource.animationClip?.metadata?.sourceFormat
    || normalizedSource.clip?.metadata?.sourceFormat
    || ''
  ).trim();
  const isVmdSource = looksLikeVmdSource(normalizedSource);
  const animationClip = ensureAnimationClip(normalizedSource.clip || normalizedSource) || ensureAnimationClip(normalizedSource.clip);
  const boneNameResolver = sourceKind === 'vrma' ? createVrmaBoneNameResolver(model, normalizedSource, animationClip) : null;
  const boneKeyframes = animationClip
    ? collectClipTimelineFrames(animationClip, 'bone', boneNameResolver)
    : (normalizedSource.boneKeyframes || normalizedSource.motions || []);
  const morphKeyframes = animationClip
    ? collectClipTimelineFrames(animationClip, 'morph')
    : (normalizedSource.faceKeyframes || normalizedSource.morphs || normalizedSource.faces || []);
  const boneMap = createKeyframeMap(boneKeyframes, 'bone', (kf) => kf.boneName, boneNameResolver);
  const morphMap = createKeyframeMap(morphKeyframes, 'morph', (kf) => kf.name || kf.morphName);
  const boneNames = collectOrderedNames(bones, boneMap);
  const morphNames = collectOrderedNames(morphs, morphMap);
  const boneTracks = new Map();
  const morphTracks = new Map();
  const usedBoneNames = new Set();
  const usedMorphNames = new Set();

  boneNames.forEach((name) => {
    boneTracks.set(name, createLeafTrack(name, 'bone', boneMap.get(name) || []));
  });
  morphNames.forEach((name) => {
    morphTracks.set(name, createLeafTrack(name, 'morph', morphMap.get(name) || []));
  });

  if (displayFrames.length > 0) {
    displayFrames.forEach((displayFrame, frameIndex) => {
      const children = [];
      const seenInFrame = new Set();

      (displayFrame.frames || []).forEach((frameEntry) => {
        const isBone = frameEntry.type === 0;
        const isMorph = frameEntry.type === 1;
        const modelItems = isBone ? bones : (isMorph ? morphs : null);
        if (!modelItems) return;

        const item = modelItems[frameEntry.index];
        if (!item || !item.name) return;

        if (seenInFrame.has(item.name)) return;
        seenInFrame.add(item.name);

        const track = isBone ? boneTracks.get(item.name) : morphTracks.get(item.name);
        if (!track) return;

        if (isBone) {
          if (usedBoneNames.has(item.name)) return;
          usedBoneNames.add(item.name);
        } else {
          if (usedMorphNames.has(item.name)) return;
          usedMorphNames.add(item.name);
        }

        track.parentId = `display-frame:${frameIndex}:${displayFrame.name || 'unnamed'}`;
        children.push(track);
      });

      const groupTrack = createGroupTrack(
        `display-frame:${frameIndex}:${displayFrame.name || 'unnamed'}`,
        displayFrame.name || `Display Frame ${frameIndex}`,
        children
      );

      tracks.push(groupTrack);
      children.forEach((child) => {
        tracks.push(child);
      });
    });

    const otherChildren = [];
    boneNames.forEach((name) => {
      if (usedBoneNames.has(name)) return;
      const track = boneTracks.get(name);
      if (!track) return;
      track.parentId = 'display-frame:other';
      otherChildren.push(track);
    });
    morphNames.forEach((name) => {
      if (usedMorphNames.has(name)) return;
      const track = morphTracks.get(name);
      if (!track) return;
      track.parentId = 'display-frame:other';
      otherChildren.push(track);
    });

    if (otherChildren.length > 0) {
      const otherTrack = createGroupTrack('display-frame:other', 'Other', otherChildren);
      otherTrack.hidden = true;
      tracks.push(otherTrack);
      otherChildren.forEach((child) => {
        tracks.push(child);
      });
    }
  } else {
    boneNames.forEach((name) => {
      const track = boneTracks.get(name);
      if (!track) return;
      tracks.push(track);
    });
    morphNames.forEach((name) => {
      const track = morphTracks.get(name);
      if (!track) return;
      tracks.push(track);
    });
  }

  const cameraKeyframes = animationClip
    ? collectClipLogicalTimelineFrames(animationClip, 'camera')
    : (normalizedSource.cameraKeyframes || []);
  if (cameraKeyframes.length > 0) {
    tracks.push(createTimelineTrack({
      id: 'camera',
      label: 'Camera',
      category: 'camera',
      trackType: 'camera',
      keyframes: cameraKeyframes.map((kf) => createTimelineKeyframe(kf.frameNum, 'camera', kf)).sort((a, b) => a.frame - b.frame)
    }));
  }

  const lightKeyframes = animationClip
    ? collectClipLogicalTimelineFrames(animationClip, 'light')
    : (normalizedSource.lightKeyframes || []);
  if (lightKeyframes.length > 0) {
    tracks.push(createTimelineTrack({
      id: 'light',
      label: 'Light',
      category: 'light',
      trackType: 'light',
      keyframes: lightKeyframes.map((kf) => createTimelineKeyframe(kf.frameNum, 'light', kf)).sort((a, b) => a.frame - b.frame)
    }));
  }

  const selfShadowKeyframes = animationClip
    ? collectClipLogicalTimelineFrames(animationClip, 'shadow')
    : (normalizedSource.selfShadowKeyframes || []);
  if (selfShadowKeyframes.length > 0) {
    tracks.push(createTimelineTrack({
      id: 'shadow',
      label: 'Shadow',
      category: 'shadow',
      trackType: 'shadow',
      keyframes: selfShadowKeyframes.map((kf) => createTimelineKeyframe(kf.frameNum, 'shadow', kf)).sort((a, b) => a.frame - b.frame)
    }));
  }

  return tracks;
}

/**
 * モデル source と scene source を合成して timeline track tree を生成します。
 * @param {object|null} modelSource - モデル用 animation source。
 * @param {object|null} model - モデルデータ。
 * @param {object} [sceneSources={}] - scene animation source 群。
 * @param {object|null} [sceneSources.camera=null] - camera source。
 * @param {object|null} [sceneSources.light=null] - light source。
 * @param {object|null} [sceneSources.shadow=null] - shadow source。
 * @returns {TimelineTrack[]} track 一覧。
 */
export function createTracksFromMixedSources(modelSource, model, sceneSources = {}) {
  const tracks = createTracksFromAnimationSource(modelSource, model)
    .filter((track) => track.category !== 'camera' && track.category !== 'light' && track.category !== 'shadow');

  const appendSceneTracks = (source) => {
    if (!source) {
      return;
    }
    const sceneTracks = createTracksFromAnimationSource(source, model)
      .filter((track) => track.category === 'camera' || track.category === 'light' || track.category === 'shadow');
    tracks.push(...sceneTracks);
  };

  appendSceneTracks(sceneSources.camera || null);
  appendSceneTracks(sceneSources.light || null);
  appendSceneTracks(sceneSources.shadow || null);
  return tracks;
}

/**
 * source が VMD 互換データかどうかを返します。
 * @param {object|null} source - 判定対象。
 * @returns {boolean} VMD 互換なら true。
 */
function looksLikeVmdSource(source) {
  return Boolean(source)
    && typeof source === 'object'
    && (
      Array.isArray(source.boneKeyframes)
      || Array.isArray(source.motions)
      || Array.isArray(source.faceKeyframes)
      || Array.isArray(source.morphs)
      || Array.isArray(source.faces)
      || Array.isArray(source.cameraKeyframes)
      || Array.isArray(source.lightKeyframes)
      || Array.isArray(source.selfShadowKeyframes)
    );
}

/**
 * generic animation clip から timeline 表示用 keyframe 配列を構築します。
 * @param {object} clip - animation clip。
 * @param {'bone'|'morph'} kind - 対象種別。
 * @param {(name: string) => string|null} [resolveName] - 表示用 name 解決関数。
 * @returns {Array<object>} timeline keyframe 配列。
 */
function collectClipTimelineFrames(clip, kind, resolveName = null) {
  const framesByTarget = new Map();
  const timelineFps = Number.isFinite(clip?.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : 30;

  for (const channel of clip?.channels || []) {
    const target = channel?.target || {};
    if (target.kind !== kind) {
      continue;
    }
    if (kind === 'bone' && !['translation', 'rotation', 'scale'].includes(target.path)) {
      continue;
    }
    if (kind === 'morph' && target.path !== 'weights') {
      continue;
    }

    const rawTargetName = String(target.name || target.nodeName || '').trim();
    const targetName = String(resolveName ? resolveName(rawTargetName) || rawTargetName : rawTargetName).trim();
    if (!targetName) {
      continue;
    }

    if (!framesByTarget.has(targetName)) {
      framesByTarget.set(targetName, new Map());
    }
    const targetFrames = framesByTarget.get(targetName);
    for (const keyframe of channel?.sampler?.keyframes || []) {
      const frameNum = Number.isFinite(keyframe?.frameNum)
        ? Math.round(keyframe.frameNum)
        : Math.round((Number(keyframe?.time) || 0) * timelineFps);
      if (!targetFrames.has(frameNum)) {
        targetFrames.set(frameNum, {
          frameNum,
          boneName: kind === 'bone' ? targetName : undefined,
          name: kind === 'morph' ? targetName : undefined,
          timelineSourceKind: 'animation-clip',
          target: {
            kind,
            name: targetName,
            sourceName: rawTargetName,
          },
        });
      }
    }
  }

  const result = [];
  framesByTarget.forEach((frameMap) => {
    frameMap.forEach((value) => {
      result.push(value);
    });
  });
  result.sort((left, right) => left.frameNum - right.frameNum);
  return result;
}

/**
 * VRMA の humanoid bone 名を、VRM モデルの実ボーン名へ解決します。
 * @param {object|null} model - モデルデータ。
 * @returns {(name: string) => string|null} 解決関数。
 */
function createVrmaBoneNameResolver(model, source, clip = null) {
  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap;
  if (!humanoidBoneNameMap || typeof humanoidBoneNameMap !== 'object') {
    return createVrmaPmxBoneNameResolver(model, source, clip);
  }

  const resolvedNames = new Map();
  for (const [humanoidBoneName, resolvedBoneName] of Object.entries(humanoidBoneNameMap)) {
    const normalizedHumanoidName = String(humanoidBoneName || '').trim();
    const normalizedResolvedName = String(resolvedBoneName || '').trim();
    if (!normalizedHumanoidName || !normalizedResolvedName) {
      continue;
    }
    resolvedNames.set(normalizedHumanoidName, normalizedResolvedName);
  }

  if (resolvedNames.size === 0) {
    return null;
  }

  return (name) => resolvedNames.get(String(name || '').trim()) || null;
}

/**
 * logical camera/light/shadow channel から timeline 表示用 keyframe 配列を構築します。
 * @param {object} clip - animation clip。
 * @param {'camera'|'light'|'shadow'} kind - 対象種別。
 * @returns {Array<object>} timeline keyframe 配列。
 */
function collectClipLogicalTimelineFrames(clip, kind) {
  const timelineFps = Number.isFinite(clip?.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : 30;
  const frames = new Map();

  for (const channel of clip?.channels || []) {
    if (String(channel?.target?.kind || '') !== kind) {
      continue;
    }
    for (const keyframe of channel?.sampler?.keyframes || []) {
      const frameNum = Number.isFinite(keyframe?.frameNum)
        ? Math.round(keyframe.frameNum)
        : Math.round((Number(keyframe?.time) || 0) * timelineFps);
      if (!frames.has(frameNum)) {
        frames.set(frameNum, {
          frameNum,
          timelineSourceKind: 'animation-clip',
          target: {
            kind,
            name: kind,
          },
        });
      }
    }
  }

  return Array.from(frames.values()).sort((left, right) => left.frameNum - right.frameNum);
}

/**
 * VRMA の humanoid bone 名を、PMX/PMD モデルの既定 mapping target 名へ解決します。
 * @param {object|null} model - モデルデータ。
 * @param {object|null} source - animation source または clip。
 * @param {object|null} clip - 正規化済み animation clip。
 * @returns {(name: string) => string|null} 解決関数。
 */
function createVrmaPmxBoneNameResolver(model, source, clip = null) {
  const magic = String(model?.magic || '').trim();
  if (magic !== 'Pmx' && magic !== 'Pmd') {
    return null;
  }

  const sourceObject = source?.kind === 'vrma'
    ? source
    : {
      kind: 'vrma',
      name: String(source?.name || clip?.name || 'animation.vrma'),
      clip: clip || ensureAnimationClip(source),
    };
  const state = ensureAnimationMappingState({
    model,
    animationSource: sourceObject,
    animationMappingBySourceKey: new Map(),
  }, sourceObject);
  if (!(state?.entries instanceof Map) || state.entries.size === 0) {
    return null;
  }

  const resolvedNames = new Map();
  for (const [sourceBoneName, entry] of state.entries) {
    const normalizedSourceBoneName = String(sourceBoneName || '').trim();
    const normalizedTargetBoneName = String(entry?.targetBoneName || '').trim();
    if (!normalizedSourceBoneName || !normalizedTargetBoneName) {
      continue;
    }
    resolvedNames.set(normalizedSourceBoneName, normalizedTargetBoneName);
  }
  if (resolvedNames.size === 0) {
    return null;
  }

  return (name) => resolvedNames.get(String(name || '').trim()) || null;
}
