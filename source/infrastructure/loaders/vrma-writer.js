import { DirectionalLight, Group, Object3D, PerspectiveCamera } from 'three';
import { mat4, quat, vec3 } from '../../lib/esm/index.js';
import {
  exportAnimationSourcesToGlb,
  upsertAnimationClipBoneKeyframe,
} from '../animation/gltf-animation.js';
import {
  convertCameraKeyframeToVrmaValues,
  sampleAnimationChannelValue,
  syncVrmaAuxiliaryMetadataFromChannels,
} from '../../core/animation/animation-clip.js';
import { solveIk } from '../../core/physics/ik.js';
import {
  DEFAULT_VRMA_PMX_ANIMATION_MAPPINGS,
  createVrmaExportResolvedAnimationBoneMappings,
  getBoneLocalRestRotationQuaternion,
} from '../../core/animation/animation-mapper.js';

const DEFAULT_TIMELINE_FPS = 30;
const IDENTITY_QUATERNION = Object.freeze([0, 0, 0, 1]);
const VRMA_NON_ANIMATABLE_PRESET_EXPRESSIONS = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);
const VRMA_CAMERA_TARGET_NODE_NAME = 'OMMD_CameraTarget';
const VRMA_CAMERA_ORBIT_NODE_NAME = 'OMMD_CameraOrbit';
const VRMA_CAMERA_NODE_NAME = 'OMMD_Camera';
const VRMA_LIGHT_NODE_NAME = 'OMMD_DirectionalLight';
const VRMA_CAMERA_FOV_POINTER = '/cameras/0/perspective/yfov';
const VRMA_LIGHT_COLOR_POINTER = '/extensions/KHR_lights_punctual/lights/0/color';
const HUMAN_BONE_PARENT_MAP = Object.freeze({
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  jaw: 'head',
  leftEye: 'head',
  rightEye: 'head',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
  leftThumbMetacarpal: 'leftHand',
  leftThumbProximal: 'leftThumbMetacarpal',
  leftThumbDistal: 'leftThumbProximal',
  leftIndexProximal: 'leftHand',
  leftIndexIntermediate: 'leftIndexProximal',
  leftIndexDistal: 'leftIndexIntermediate',
  leftMiddleProximal: 'leftHand',
  leftMiddleIntermediate: 'leftMiddleProximal',
  leftMiddleDistal: 'leftMiddleIntermediate',
  leftRingProximal: 'leftHand',
  leftRingIntermediate: 'leftRingProximal',
  leftRingDistal: 'leftRingIntermediate',
  leftLittleProximal: 'leftHand',
  leftLittleIntermediate: 'leftLittleProximal',
  leftLittleDistal: 'leftLittleIntermediate',
  rightThumbMetacarpal: 'rightHand',
  rightThumbProximal: 'rightThumbMetacarpal',
  rightThumbDistal: 'rightThumbProximal',
  rightIndexProximal: 'rightHand',
  rightIndexIntermediate: 'rightIndexProximal',
  rightIndexDistal: 'rightIndexIntermediate',
  rightMiddleProximal: 'rightHand',
  rightMiddleIntermediate: 'rightMiddleProximal',
  rightMiddleDistal: 'rightMiddleIntermediate',
  rightRingProximal: 'rightHand',
  rightRingIntermediate: 'rightRingProximal',
  rightRingDistal: 'rightRingIntermediate',
  rightLittleProximal: 'rightHand',
  rightLittleIntermediate: 'rightLittleProximal',
  rightLittleDistal: 'rightLittleIntermediate',
});

/**
 * VRMA を書き出します。
 */
export class VRMAWriter {
  constructor() {
    this.lastWarnings = [];
  }

  /**
   * VRMA バイナリを書き出します。
   * @param {object|null} sourceOrClip - source または clip。
   * @param {object} [options={}] - 書き出しオプション。
   * @param {object|null} [options.model=null] - 対象 VRM モデル。
   * @param {object|null} [options.instance=null] - ベイク元インスタンス。
   * @param {boolean} [options.bakeIkToRotation] - IK を FK 回転へベイクするなら true。instance 指定時は既定で true。
   * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - synthetic `下半身` 回転を `hips` / `spine` へベイクするなら true。
   * @returns {Promise<ArrayBuffer>} VRMA GLB。
   */
  async write(sourceOrClip, options = {}) {
    this.lastWarnings = [];
    const model = options?.instance?.model || options?.model || null;
    if (!model || !['Vrm', 'Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
      throw new Error('VRMA export requires an active VRM, PMX, or PMD model.');
    }

    const bakeIkToRotation = options?.bakeIkToRotation !== undefined
      ? Boolean(options.bakeIkToRotation)
      : Boolean(options?.instance);
    const bakeLowerBodyToHumanoid = options?.bakeLowerBodyToHumanoid !== undefined
      ? Boolean(options.bakeLowerBodyToHumanoid)
      : true;
    const rawClip = options?.instance
      ? buildVrmaExportClipFromInstance(options.instance, { bakeIkToRotation, bakeLowerBodyToHumanoid })
      : normalizeVrmaExportClip(sourceOrClip, model);
    const openMmdBoneChannels = String(model?.magic || '').trim() === 'Vrm'
      ? collectOpenMmdBoneChannels(rawClip, { bakeLowerBodyToHumanoid })
      : undefined;
    const clip = normalizeVrmaHumanoidClipForExport(rawClip, model, this.lastWarnings, {
      bakeLowerBodyToHumanoid,
      foldAllParentIntoHips: String(model?.magic || '').trim() !== 'Vrm' || bakeLowerBodyToHumanoid,
    });
    syncVrmaAuxiliaryMetadataFromChannels(clip);
    const expressionDefinitions = collectVrmaExpressionDefinitions(clip);
    const { scene, humanoidBoneNames, expressionNodeNames } = createVrmaScene(model, expressionDefinitions, clip);
    const filteredClip = filterVrmaClipForExport(clip, new Set(humanoidBoneNames), new Set(expressionNodeNames), this.lastWarnings);
    const vrmaClip = cloneVrmaClipForExport(filteredClip);
    const source = {
      kind: 'vrma',
      name: `${String(vrmaClip?.name || model?.name || 'animation')}.vrma`,
      clip: vrmaClip,
    };
    const buffer = await exportAnimationSourcesToGlb(scene, [source]);
    return patchGlbWithVrmaExtension(buffer, humanoidBoneNames, expressionDefinitions, vrmaClip, openMmdBoneChannels);
  }
}

/**
 * clip を scene に存在する humanoid / expression 名へ絞ります。
 * @param {object} clip - 対象 clip。
 * @param {Set<string>} humanoidBoneNames - 利用可能 humanoid 名集合。
 * @param {Set<string>} expressionNodeNames - 利用可能 expression node 名集合。
 * @param {object[]} warnings - warning 出力先。
 * @returns {object} フィルタ後 clip。
 */
function filterVrmaClipForExport(clip, humanoidBoneNames, expressionNodeNames, warnings) {
  return {
    ...(clip || {}),
    channels: Array.isArray(clip?.channels)
      ? clip.channels.filter((channel) => {
        const targetKind = String(channel?.target?.kind || '').trim();
        const targetName = String(channel?.target?.name || '').trim();
        if (targetKind === 'bone') {
          const targetPath = String(channel?.target?.path || '').trim();
          if (targetPath === 'translation' && targetName !== 'hips') {
            warnings.push(createVrmaExportWarning('non-hips-translation-dropped', `VRMA export skipped translation for non-hips bone '${targetName}'.`));
            return false;
          }
          const allowed = humanoidBoneNames.has(targetName);
          if (!allowed) {
            warnings.push(createVrmaExportWarning('unsupported-bone-target', `VRMA export skipped non-humanoid bone '${targetName}'.`));
          }
          return allowed;
        }
        if (targetKind === 'morph') {
          const expressionName = String(channel?.target?.vrmaExpressionName || targetName).trim();
          const expressionType = String(channel?.target?.vrmaExpressionType || 'custom').trim();
          if (expressionType === 'preset' && VRMA_NON_ANIMATABLE_PRESET_EXPRESSIONS.has(expressionName)) {
            warnings.push(createVrmaExportWarning('unsupported-expression', `VRMA export skipped non-animatable expression '${expressionName}'.`));
            return false;
          }
          const expressionNodeName = getVrmaExpressionNodeName(channel);
          const allowed = Boolean(expressionNodeName);
          if (!allowed) {
            warnings.push(createVrmaExportWarning('missing-expression-node', `VRMA export skipped morph '${targetName}' because no expression node was resolved.`));
          }
          return allowed;
        }
        if (targetKind === 'node') {
          return ['OMMD_CameraTarget', 'OMMD_CameraOrbit', 'OMMD_Camera', 'OMMD_DirectionalLight'].includes(targetName);
        }
        if (targetKind === 'pointer') {
          return targetName === 'camera-fov' || targetName === 'light-color'
            || String(channel?.target?.pointer || '').trim() === VRMA_CAMERA_FOV_POINTER
            || String(channel?.target?.pointer || '').trim() === VRMA_LIGHT_COLOR_POINTER;
        }
        return false;
      })
      : [],
  };
}

/**
 * source/clip を VRMA 用 clip として正規化します。
 * @param {object|null} sourceOrClip - source または clip。
 * @param {object} model - 対象モデル。
 * @returns {object} 書き出し対象 clip。
 */
function normalizeVrmaExportClip(sourceOrClip, model) {
  if (sourceOrClip?.clip && Array.isArray(sourceOrClip.clip.channels)) {
    if (String(sourceOrClip.kind || '').trim() === 'vrma') {
      return sourceOrClip.clip;
    }
  }
  if (sourceOrClip && Array.isArray(sourceOrClip.channels)) {
    return sourceOrClip;
  }
  throw new Error(`No VRMA-exportable clip is available for model '${String(model?.name || '')}'.`);
}

/**
 * インスタンスから VRMA 書き出し用 clip を構築します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} [options={}] - 構築オプション。
 * @param {boolean} [options.bakeIkToRotation=false] - IK を FK 回転へベイクするなら true。
 * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - synthetic `下半身` 回転を `hips` / `spine` へベイクするなら true。
 * @returns {object} VRMA 用 clip。
 */
function buildVrmaExportClipFromInstance(instance, options = {}) {
  if (options?.bakeIkToRotation) {
    return buildVrmaBakedExportClipFromInstance(instance, options);
  }
  return buildVrmaDirectExportClipFromInstance(instance, options);
}

/**
 * インスタンスから VRMA 書き出し用 clip を構築します。
 * IK ベイクなしで source / mapping をそのまま書き出し用へ変換します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} [options={}] - 構築オプション。
 * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - synthetic `下半身` 回転を `hips` / `spine` へベイクするなら true。
 * @returns {object} VRMA 用 clip。
 */
function buildVrmaDirectExportClipFromInstance(instance, options = {}) {
  const source = instance?.animationSource || null;
  if (source?.kind === 'vrma' && source.clip) {
    return source.clip;
  }

  const model = instance?.model || null;
  const exportHumanoidBoneNameMap = buildVrmaExportHumanoidBoneNameMap(model);
  const inverseHumanoidMap = buildInverseHumanoidBoneNameMap(model);
  const clip = {
    name: String(source?.clip?.name || source?.name || model?.name || 'VRMA Animation'),
    duration: Number(source?.clip?.duration) || 0,
    timelineFps: Number(source?.clip?.timelineFps) || DEFAULT_TIMELINE_FPS,
    metadata: {
      sourceFormat: 'vrma',
      cameraKeyframes: Array.isArray(source?.clip?.metadata?.cameraKeyframes)
        ? source.clip.metadata.cameraKeyframes.map((keyframe) => ({ ...keyframe }))
        : [],
      lightKeyframes: Array.isArray(source?.clip?.metadata?.lightKeyframes)
        ? source.clip.metadata.lightKeyframes.map((keyframe) => ({ ...keyframe }))
        : [],
      vrmAnimation: {
        humanBones: Object.fromEntries(Array.from(exportHumanoidBoneNameMap.keys(), (key) => [key, key])),
        humanBoneRestRotations: buildVrmaExportHumanBoneRestRotationMap(model, exportHumanoidBoneNameMap),
        expressions: {},
      },
    },
    channels: [],
  };

  const timelineFps = clip.timelineFps;
  const maxFrame = Math.max(0, Math.round(instance?.animationController?.maxFrame || (clip.duration * timelineFps)));
  const groupedSourceChannels = groupClipBoneChannels(source?.clip || null);
  const resolvedMappings = createVrmaExportResolvedAnimationBoneMappings(instance, source);

  if (
    String(source?.kind || '').trim() === 'vmd'
    && ['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())
    && resolvedMappings.length > 0
  ) {
    appendVrmaChannelsFromPmxVmdMappings(clip, groupedSourceChannels, resolvedMappings, inverseHumanoidMap, model);
    maybeAppendSampledLowerBodyRotationChannelFromInstance(clip, instance, options);
    appendVrmaAuxiliaryChannelsFromMetadata(clip);
    clip.duration = Number(source?.clip?.duration) || 0;
    return clip;
  }

  if (resolvedMappings.length > 0) {
    for (let frameNum = 0; frameNum <= maxFrame; frameNum++) {
      const time = frameNum / timelineFps;
      for (const mapping of resolvedMappings) {
        const humanoidBoneName = inverseHumanoidMap.get(mapping.targetBoneName);
        if (!humanoidBoneName) {
          continue;
        }
        const channels = groupedSourceChannels.get(mapping.sourceBoneName);
        if (!channels) {
          continue;
        }
        const translation = sampleAnimationChannelValue(channels.translation || null, time) || [0, 0, 0];
        const rotation = sampleAnimationChannelValue(channels.rotation || null, time) || IDENTITY_QUATERNION;
        const resolvedTranslation = vec3.create();
        vec3.transformQuat(resolvedTranslation, translation, mapping.basisCorrectionQuaternion);
        resolvedTranslation[0] += Number(mapping.translationOffset?.[0]) || 0;
        resolvedTranslation[1] += Number(mapping.translationOffset?.[1]) || 0;
        resolvedTranslation[2] += Number(mapping.translationOffset?.[2]) || 0;

        const resolvedRotation = quat.create();
        const tempRotation = quat.create();
        quat.multiply(tempRotation, mapping.basisCorrectionQuaternion, rotation);
        quat.multiply(tempRotation, tempRotation, mapping.basisCorrectionInverseQuaternion);
        quat.multiply(resolvedRotation, mapping.rotationOffsetQuaternion, tempRotation);
        quat.normalize(resolvedRotation, resolvedRotation);

        if (humanoidBoneName === 'hips') {
          upsertAnimationClipBoneKeyframe(clip, humanoidBoneName, frameNum, {
            translation: Array.from(resolvedTranslation),
          });
        }
        upsertAnimationClipBoneKeyframe(clip, humanoidBoneName, frameNum, {
          rotation: Array.from(resolvedRotation),
        });
      }
    }
    appendVrmaAuxiliaryChannelsFromMetadata(clip);
    clip.duration = maxFrame / timelineFps;
    return clip;
  }

  const directClip = source?.clip || null;
  if (!directClip || !Array.isArray(directClip.channels)) {
    appendVrmaAuxiliaryChannelsFromMetadata(clip);
    return clip;
  }

  if (String(source?.kind || '').trim() === 'vmd' && ['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
    appendVrmaInternalPmxVmdChannels(clip, groupClipBoneChannels(directClip));
  }

  for (const channel of directClip.channels) {
    if (channel?.target?.kind === 'bone') {
      if (isVrmaInternalPmxVmdSourceBoneChannel(channel)) {
        continue;
      }
      const humanoidBoneName = inverseHumanoidMap.get(String(channel?.target?.name || '').trim());
      if (!humanoidBoneName) {
        continue;
      }
      if (channel.target.path === 'translation' && humanoidBoneName !== 'hips') {
        continue;
      }
      const clonedChannel = cloneChannelWithTargetName(channel, humanoidBoneName);
      if (String(source?.kind || '').trim() === 'vmd' && ['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
        assignVrmaHumanoidBindTransforms(clonedChannel, model, humanoidBoneName);
        if (String(channel?.target?.path || '').trim() === 'translation') {
          clonedChannel.target.vrmaSkipLeftHandedTranslationFlip = true;
        }
      }
      clip.channels.push(clonedChannel);
      continue;
    }
    if (channel?.target?.kind === 'morph') {
      clip.channels.push(cloneVrmaMorphChannel(channel));
      continue;
    }
    if (channel?.target?.kind === 'node' || channel?.target?.kind === 'pointer') {
      clip.channels.push(cloneVrmaAuxiliaryChannel(channel));
    }
  }
  appendVrmaAuxiliaryChannelsFromMetadata(clip);
  clip.duration = Number(directClip.duration) || 0;
  return clip;
}

/**
 * PMX/PMD + VMD direct export で source clip に `下半身` が無い場合のみ、実姿勢から synthetic 下半身回転を補完します。
 * IK ボーン主体の VMD でも `下半身ベイク` の入力を確保するための経路です。
 * @param {object} clip - 補完先 clip。
 * @param {object} instance - モデルインスタンス。
 * @param {object} [options={}] - 構築オプション。
 */
function maybeAppendSampledLowerBodyRotationChannelFromInstance(clip, instance, options = {}) {
  if (options?.bakeLowerBodyToHumanoid === false) {
    return;
  }
  const model = instance?.model || null;
  const source = instance?.animationSource || null;
  if (
    String(source?.kind || '').trim() !== 'vmd'
    || !['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())
  ) {
    return;
  }

  const groupedClipChannels = groupClipBoneChannels(clip);
  if (groupedClipChannels.get('下半身')?.rotation) {
    return;
  }

  const sampledChannel = sampleLowerBodyRotationChannelFromInstance(instance, Number(clip?.timelineFps) || DEFAULT_TIMELINE_FPS);
  if (!sampledChannel) {
    return;
  }
  clip.channels.push(sampledChannel);
  const keyframes = Array.isArray(sampledChannel?.sampler?.keyframes) ? sampledChannel.sampler.keyframes : [];
  const lastKeyframeTime = keyframes.length > 0 ? Number(keyframes[keyframes.length - 1]?.time) || 0 : 0;
  clip.duration = Math.max(Number(clip?.duration) || 0, lastKeyframeTime);
}

/**
 * PMX/PMD に適用中の VMD clip を humanoid channel として複製します。
 * 再生用の補正は export に持ち込まず、生の VMD channel 値を使います。
 * `全ての親` / `下半身` は最終出力へは残さず、後段の humanoid bake 用入力 channel としてだけ raw clip に保持します。
 * @param {object} clip - 書き出し先 clip。
 * @param {Map<string, object>} groupedSourceChannels - source bone 名ごとの channel 群。
 * @param {object[]} resolvedMappings - 解決済み mapping 一覧。
 * @param {Map<string, string>} inverseHumanoidMap - 実 bone 名 -> humanoid 名。
 */
function appendVrmaChannelsFromPmxVmdMappings(clip, groupedSourceChannels, resolvedMappings, inverseHumanoidMap, model) {
  const exportedTargets = new Set();
  appendVrmaInternalPmxVmdChannels(clip, groupedSourceChannels);
  for (const mapping of resolvedMappings) {
    const sourceBoneName = String(mapping?.sourceBoneName || '').trim();
    const humanoidBoneName = inverseHumanoidMap.get(String(mapping?.targetBoneName || '').trim());
    if (!sourceBoneName || !humanoidBoneName) {
      continue;
    }
    const channels = groupedSourceChannels.get(sourceBoneName);
    if (!channels) {
      continue;
    }

    if (channels.translation && humanoidBoneName === 'hips') {
      const translationKey = `${humanoidBoneName}:translation`;
      if (!exportedTargets.has(translationKey)) {
        const translationChannel = cloneChannelWithTargetName(channels.translation, humanoidBoneName);
        assignVrmaHumanoidBindTransforms(translationChannel, model, humanoidBoneName);
        translationChannel.target.vrmaSkipLeftHandedTranslationFlip = true;
        clip.channels.push(translationChannel);
        exportedTargets.add(translationKey);
      }
    }

    if (channels.rotation) {
      const rotationKey = `${humanoidBoneName}:rotation`;
      if (!exportedTargets.has(rotationKey)) {
        const rotationChannel = cloneChannelWithTargetName(channels.rotation, humanoidBoneName);
        assignVrmaHumanoidBindTransforms(rotationChannel, model, humanoidBoneName);
        clip.channels.push(rotationChannel);
        exportedTargets.add(rotationKey);
      }
    }
  }
}

/**
 * PMX/PMD + VMD export で final humanoid channel へ fold する前の内部 channel を複製します。
 * @param {object} clip - 書き出し先 clip。
 * @param {Map<string, object>} groupedSourceChannels - source bone 名ごとの channel 群。
 */
function appendVrmaInternalPmxVmdChannels(clip, groupedSourceChannels) {
  const allParentChannels = groupedSourceChannels.get('全ての親');
  if (allParentChannels?.translation) {
    clip.channels.push(cloneChannelWithTargetName(allParentChannels.translation, '全ての親'));
  }
  if (allParentChannels?.rotation) {
    clip.channels.push(cloneChannelWithTargetName(allParentChannels.rotation, '全ての親'));
  }
  if (allParentChannels?.scale) {
    clip.channels.push(cloneChannelWithTargetName(allParentChannels.scale, '全ての親'));
  }
  const lowerBodyChannels = groupedSourceChannels.get('下半身');
  if (lowerBodyChannels?.rotation) {
    clip.channels.push(cloneChannelWithTargetName(lowerBodyChannels.rotation, '下半身'));
  }
}

/**
 * PMX/PMD + VMD export で内部 channel として先に複製する source bone channel かどうかを返します。
 * @param {object|null} channel - 判定対象 channel。
 * @returns {boolean} 内部 channel 扱いなら true。
 */
function isVrmaInternalPmxVmdSourceBoneChannel(channel) {
  if (String(channel?.target?.kind || '').trim() !== 'bone') {
    return false;
  }
  const targetName = String(channel?.target?.name || '').trim();
  const targetPath = String(channel?.target?.path || '').trim();
  if (targetName === '下半身') {
    return targetPath === 'rotation';
  }
  if (targetName === '全ての親') {
    return targetPath === 'translation' || targetPath === 'rotation' || targetPath === 'scale';
  }
  return false;
}

/**
 * humanoid bone channel に bind pose TRS を設定します。
 * @param {object} channel - 対象 channel。
 * @param {object|null} model - 対象モデル。
 * @param {string} humanoidBoneName - humanoid 名。
 */
function assignVrmaHumanoidBindTransforms(channel, model, humanoidBoneName) {
  const boneName = String(buildVrmaExportHumanoidBoneNameMap(model).get(humanoidBoneName) || '').trim();
  const bone = findBoneByName(model, boneName);
  if (!bone) {
    return;
  }
  const restRotation = getVrmaExportHumanBoneRestRotation(model, humanoidBoneName);
  const path = String(channel?.target?.path || '').trim();
  if (path === 'translation' && humanoidBoneName === 'hips') {
    assignBoneChannelBindTransforms(channel, computeHumanoidLocalTranslation(model, humanoidBoneName, bone), null);
    return;
  }
  if (path === 'rotation' && restRotation) {
    assignBoneChannelBindTransforms(channel, null, restRotation.localRotation);
  }
}

/**
 * インスタンスの実姿勢を各フレームで評価し、IK を FK 回転へベイクした VRMA 用 clip を構築します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} [options={}] - 構築オプション。
 * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - 互換オプション。IK ベイク時は synthetic 下半身を保持して pivot を維持します。
 * @returns {object} ベイク済み clip。
 */
function buildVrmaBakedExportClipFromInstance(instance, options = {}) {
  const source = instance?.animationSource || null;
  const model = instance?.model || null;
  const scene = instance?.scene || null;
  const animationController = instance?.animationController || null;
  if (!source || !model || !scene || !animationController) {
    return buildVrmaDirectExportClipFromInstance(instance);
  }

  const sourceClip = source?.clip || null;
  const clip = {
    name: String(sourceClip?.name || source?.name || model?.name || 'VRMA Animation'),
    duration: Number(sourceClip?.duration) || 0,
    timelineFps: Number(sourceClip?.timelineFps) || DEFAULT_TIMELINE_FPS,
    metadata: {
      ...(sourceClip?.metadata ? { ...sourceClip.metadata } : {}),
      sourceFormat: 'vrma',
      vrmAnimation: {
        ...(sourceClip?.metadata?.vrmAnimation ? { ...sourceClip.metadata.vrmAnimation } : {}),
        humanBones: Object.fromEntries(Array.from(buildVrmaExportHumanBoneNameEntries(model, true), ([key]) => [key, key])),
        humanBoneRestRotations: buildVrmaExportHumanBoneRestRotationMap(model, null, { includeSyntheticLowerBody: true }),
        includeSyntheticLowerBody: true,
      },
    },
    channels: [],
  };

  if (Array.isArray(sourceClip?.channels)) {
    for (const channel of sourceClip.channels) {
      if (channel?.target?.kind === 'morph') {
        clip.channels.push(cloneVrmaMorphChannel(channel));
      } else if (channel?.target?.kind === 'node' || channel?.target?.kind === 'pointer') {
        clip.channels.push(cloneVrmaAuxiliaryChannel(channel));
      }
    }
  }

  const exportBoneNames = collectVrmaBakedExportBoneNames(model);
  const exportHumanoidBoneNameMap = buildVrmaExportHumanoidBoneNameMap(model);
  const exportHipsBoneName = String(exportHumanoidBoneNameMap.get('hips') || '').trim();
  if (exportBoneNames.length === 0) {
    appendVrmaAuxiliaryChannelsFromMetadata(clip);
    return clip;
  }

  const timelineFps = Math.max(1, Number(clip.timelineFps) || DEFAULT_TIMELINE_FPS);
  const maxFrame = Math.max(
    0,
    Math.round(animationController?.maxFrame || 0),
    Math.round((Number(sourceClip?.duration) || 0) * timelineFps),
  );
  const sceneSnapshot = snapshotSceneBoneState(scene);
  const controllerSnapshot = snapshotAnimationControllerState(animationController);

  try {
    for (let frameNum = 0; frameNum <= maxFrame; frameNum += 1) {
      sampleInstancePoseForVrmaBake(instance, frameNum);
      for (const boneName of exportBoneNames) {
        const boneIndex = findBoneIndexByName(model, boneName);
        if (boneIndex < 0) {
          continue;
        }
        const local = scene?.boneLocalTransforms?.[boneIndex] || null;
        if (!local) {
          continue;
        }
        if (boneName === '全ての親' || boneName === exportHipsBoneName) {
          const keyframe = {
            translation: Array.from(local.translation || [0, 0, 0]),
            rotation: Array.from(local.rotation || IDENTITY_QUATERNION),
          };
          if (String(source?.kind || '').trim() === 'vmd' && ['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
            keyframe.vrmaSkipLeftHandedTranslationFlip = true;
          }
          upsertAnimationClipBoneKeyframe(clip, boneName, frameNum, keyframe);
          if (boneName === exportHipsBoneName) {
            const translationChannel = clip.channels.find((channel) => (
              String(channel?.target?.kind || '').trim() === 'bone'
              && String(channel?.target?.name || '').trim() === exportHipsBoneName
              && String(channel?.target?.path || '').trim() === 'translation'
            ));
            if (translationChannel && !Array.isArray(translationChannel.target.bindTranslation) && !ArrayBuffer.isView(translationChannel.target.bindTranslation)) {
              translationChannel.target.bindTranslation = Array.from(local.baseTranslation || [0, 0, 0]).slice(0, 3);
            }
          }
          continue;
        }
        upsertAnimationClipBoneKeyframe(clip, boneName, frameNum, {
          rotation: Array.from(local.rotation || IDENTITY_QUATERNION),
        });
      }
    }
  } finally {
    restoreSceneBoneState(scene, sceneSnapshot);
    restoreAnimationControllerState(animationController, controllerSnapshot);
  }

  appendVrmaAuxiliaryChannelsFromMetadata(clip);
  clip.duration = maxFrame / timelineFps;
  return clip;
}

/**
 * IK ベイク対象のボーン名一覧を返します。
 * @param {object|null} model - モデルデータ。
 * @returns {string[]} ボーン名一覧。
 */
function collectVrmaBakedExportBoneNames(model) {
  const names = new Set();
  const allParentBoneName = findBoneByName(model, '全ての親')?.name;
  if (allParentBoneName) {
    names.add(String(allParentBoneName).trim());
  }
  const lowerBodyBoneName = findBoneByName(model, '下半身')?.name;
  if (lowerBodyBoneName) {
    names.add(String(lowerBodyBoneName).trim());
  }
  for (const boneName of buildVrmaExportHumanoidBoneNameMap(model).values()) {
    const normalizedBoneName = String(boneName || '').trim();
    if (normalizedBoneName) {
      names.add(normalizedBoneName);
    }
  }
  return Array.from(names);
}

/**
 * シーンのボーン状態を退避します。
 * @param {object|null} scene - シーン状態。
 * @returns {object} 退避済み状態。
 */
function snapshotSceneBoneState(scene) {
  return {
    boneLocalTransforms: Array.isArray(scene?.boneLocalTransforms)
      ? scene.boneLocalTransforms.map((local) => ({
        translation: Array.from(local?.translation || [0, 0, 0]),
        rotation: Array.from(local?.rotation || IDENTITY_QUATERNION),
        manualTranslation: Array.from(local?.manualTranslation || [0, 0, 0]),
        manualRotation: Array.from(local?.manualRotation || IDENTITY_QUATERNION),
        scale: Array.from(local?.scale || [1, 1, 1]),
        worldMatrix: Array.from(local?.worldMatrix || []),
        worldRotation: Array.from(local?.worldRotation || IDENTITY_QUATERNION),
        localDirty: Boolean(local?.localDirty),
        worldDirty: Boolean(local?.worldDirty),
        physicsDriven: Boolean(local?.physicsDriven),
      }))
      : [],
    boneWorldPositions: Array.isArray(scene?.boneWorldPositions)
      ? scene.boneWorldPositions.map((position) => Array.from(position || [0, 0, 0]))
      : [],
  };
}

/**
 * 退避済みシーン状態を復元します。
 * @param {object|null} scene - シーン状態。
 * @param {object} snapshot - 退避済み状態。
 */
function restoreSceneBoneState(scene, snapshot) {
  const locals = Array.isArray(scene?.boneLocalTransforms) ? scene.boneLocalTransforms : [];
  const savedLocals = Array.isArray(snapshot?.boneLocalTransforms) ? snapshot.boneLocalTransforms : [];
  for (let index = 0; index < locals.length; index += 1) {
    const local = locals[index];
    const saved = savedLocals[index];
    if (!local || !saved) {
      continue;
    }
    assignArrayLike(local.translation, saved.translation);
    assignArrayLike(local.rotation, saved.rotation);
    assignArrayLike(local.manualTranslation, saved.manualTranslation);
    assignArrayLike(local.manualRotation, saved.manualRotation);
    assignArrayLike(local.scale, saved.scale);
    assignArrayLike(local.worldMatrix, saved.worldMatrix);
    assignArrayLike(local.worldRotation, saved.worldRotation);
    local.localDirty = Boolean(saved.localDirty);
    local.worldDirty = Boolean(saved.worldDirty);
    local.physicsDriven = Boolean(saved.physicsDriven);
  }
  const savedWorldPositions = Array.isArray(snapshot?.boneWorldPositions) ? snapshot.boneWorldPositions : [];
  for (let index = 0; index < (scene?.boneWorldPositions || []).length; index += 1) {
    if (scene?.boneWorldPositions?.[index] && savedWorldPositions[index]) {
      assignArrayLike(scene.boneWorldPositions[index], savedWorldPositions[index]);
    }
  }
}

/**
 * アニメーションコントローラー状態を退避します。
 * @param {object|null} animationController - コントローラー。
 * @returns {object} 退避済み状態。
 */
function snapshotAnimationControllerState(animationController) {
  return {
    currentFrame: Number(animationController?.currentFrame) || 0,
    jumped: Boolean(animationController?.jumped),
    isPlaying: Boolean(animationController?.isPlaying),
    lastFrameTime: Number(animationController?.lastFrameTime) || 0,
  };
}

/**
 * 退避済みアニメーションコントローラー状態を復元します。
 * @param {object|null} animationController - コントローラー。
 * @param {object} snapshot - 退避済み状態。
 */
function restoreAnimationControllerState(animationController, snapshot) {
  if (!animationController || !snapshot) {
    return;
  }
  animationController.currentFrame = Number(snapshot.currentFrame) || 0;
  animationController.jumped = Boolean(snapshot.jumped);
  animationController.isPlaying = Boolean(snapshot.isPlaying);
  animationController.lastFrameTime = Number(snapshot.lastFrameTime) || 0;
}

/**
 * 指定フレームの実姿勢を評価して scene に反映します。
 * @param {object} instance - モデルインスタンス。
 * @param {number} frameNum - 評価フレーム。
 */
function sampleInstancePoseForVrmaBake(instance, frameNum) {
  const model = instance?.model || null;
  const scene = instance?.scene || null;
  const animationController = instance?.animationController || null;
  if (!model || !scene || !animationController) {
    return;
  }

  resetSceneAnimationPose(scene);
  animationController.currentFrame = Math.max(0, Number(frameNum) || 0);
  animationController.jumped = true;
  animationController.updateBones(scene.boneLocalTransforms, markBoneLocalTransformDirtyForVrmaBake);

  const recomputeWorldTransforms = () => recomputeVrmaBakeBoneMatrices(instance);
  recomputeWorldTransforms();
  solveIk(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirtyForVrmaBake);
}

/**
 * scene のアニメーション適用値を初期化します。
 * @param {object|null} scene - シーン状態。
 */
function resetSceneAnimationPose(scene) {
  for (const local of scene?.boneLocalTransforms || []) {
    if (!local) {
      continue;
    }
    vec3.set(local.translation, 0, 0, 0);
    quat.identity(local.rotation);
    vec3.set(local.scale, 1, 1, 1);
    local.physicsDriven = false;
    local.localDirty = true;
    local.worldDirty = true;
  }
}

/**
 * ベイク用の dirty フラグを立てます。
 * @param {object|null} local - ローカル変換状態。
 */
function markBoneLocalTransformDirtyForVrmaBake(local) {
  if (!local) {
    return;
  }
  local.localDirty = true;
  local.worldDirty = true;
}

/**
 * ベイク用にボーン行列を再計算します。
 * 実行時の ModelManager がある場合はそれを優先し、無い場合のみ最小限のローカル実装へフォールバックします。
 * @param {object} instance - モデルインスタンス。
 */
function recomputeVrmaBakeBoneMatrices(instance) {
  const modelManager = instance?.scene?.modelManager || null;
  if (modelManager && typeof modelManager.recomputeBoneMatrices === 'function') {
    modelManager.recomputeBoneMatrices(instance.model, instance.scene, true);
    return;
  }
  recomputeVrmaBakeBoneMatricesFallback(instance?.model || null, instance?.scene || null);
}

/**
 * ベイク用ボーン行列再計算の簡易フォールバックです。
 * @param {object|null} model - モデルデータ。
 * @param {object|null} scene - シーン状態。
 */
function recomputeVrmaBakeBoneMatricesFallback(model, scene) {
  for (const boneIndex of scene?.sortedBoneIndices || []) {
    const bone = model?.bones?.[boneIndex] || null;
    const local = scene?.boneLocalTransforms?.[boneIndex] || null;
    if (!bone || !local) {
      continue;
    }

    let currentRotation = quat.clone(local.rotation || IDENTITY_QUATERNION);
    let currentTranslationX = Number(local.translation?.[0]) || 0;
    let currentTranslationY = Number(local.translation?.[1]) || 0;
    let currentTranslationZ = Number(local.translation?.[2]) || 0;

    if (local.manualRotation) {
      const manualRotation = quat.clone(local.manualRotation);
      quat.multiply(currentRotation, manualRotation, currentRotation);
      quat.normalize(currentRotation, currentRotation);
    }
    if (local.baseRotation) {
      quat.multiply(currentRotation, local.baseRotation, currentRotation);
      quat.normalize(currentRotation, currentRotation);
    }
    if (local.manualTranslation) {
      currentTranslationX += Number(local.manualTranslation[0]) || 0;
      currentTranslationY += Number(local.manualTranslation[1]) || 0;
      currentTranslationZ += Number(local.manualTranslation[2]) || 0;
    }

    if ((bone.flags & 0x0100) && bone.inheritParentIndex !== -1) {
      const inheritLocal = scene.boneLocalTransforms[bone.inheritParentIndex] || null;
      if (inheritLocal && bone.parentIndex !== bone.inheritParentIndex) {
        const inheritedRotation = quat.create();
        quat.slerp(inheritedRotation, IDENTITY_QUATERNION, inheritLocal.rotation || IDENTITY_QUATERNION, Number(bone.inheritInfluence) || 0);
        quat.multiply(currentRotation, inheritedRotation, currentRotation);
        quat.normalize(currentRotation, currentRotation);
      }
    }
    if ((bone.flags & 0x0200) && bone.inheritParentIndex !== -1) {
      const inheritLocal = scene.boneLocalTransforms[bone.inheritParentIndex] || null;
      if (inheritLocal && bone.parentIndex !== bone.inheritParentIndex) {
        currentTranslationX += (Number(inheritLocal.translation?.[0]) || 0) * (Number(bone.inheritInfluence) || 0);
        currentTranslationY += (Number(inheritLocal.translation?.[1]) || 0) * (Number(bone.inheritInfluence) || 0);
        currentTranslationZ += (Number(inheritLocal.translation?.[2]) || 0) * (Number(bone.inheritInfluence) || 0);
      }
    }

    mat4.fromTranslation(local.worldMatrix, local.baseTranslation || [0, 0, 0]);
    mat4.multiply(
      local.worldMatrix,
      local.worldMatrix,
      mat4.fromTranslation(mat4.create(), [currentTranslationX, currentTranslationY, currentTranslationZ]),
    );
    mat4.multiply(local.worldMatrix, local.worldMatrix, mat4.fromQuat(mat4.create(), currentRotation));
    mat4.multiply(local.worldMatrix, local.worldMatrix, mat4.fromScaling(mat4.create(), local.scale || [1, 1, 1]));

    if (bone.parentIndex !== -1 && scene.boneLocalTransforms[bone.parentIndex]) {
      const parentLocal = scene.boneLocalTransforms[bone.parentIndex];
      mat4.multiply(local.worldMatrix, parentLocal.worldMatrix, local.worldMatrix);
      quat.multiply(local.worldRotation, parentLocal.worldRotation || IDENTITY_QUATERNION, currentRotation);
    } else {
      quat.copy(local.worldRotation, currentRotation);
    }

    mat4.multiply(local.skinMatrix, local.worldMatrix, scene.inverseBindMatrices?.[boneIndex] || mat4.create());
    if (scene.boneWorldPositions?.[boneIndex]) {
      scene.boneWorldPositions[boneIndex][0] = local.worldMatrix[12];
      scene.boneWorldPositions[boneIndex][1] = local.worldMatrix[13];
      scene.boneWorldPositions[boneIndex][2] = local.worldMatrix[14];
    }
    local.localDirty = false;
    local.worldDirty = true;
  }
}

/**
 * ArrayLike の値を既存配列へコピーします。
 * @param {ArrayLike<number>} target - コピー先。
 * @param {ArrayLike<number>} source - コピー元。
 */
function assignArrayLike(target, source) {
  if (!target || !source) {
    return;
  }
  const count = Math.min(target.length || 0, source.length || 0);
  for (let index = 0; index < count; index += 1) {
    target[index] = source[index];
  }
}

/**
 * clip の bone channel を source bone 名ごとにまとめます。
 * @param {object|null} clip - clip。
 * @returns {Map<string, object>} bone 名 -> path 別 channel。
 */
function groupClipBoneChannels(clip) {
  const result = new Map();
  for (const channel of clip?.channels || []) {
    if (channel?.target?.kind !== 'bone') {
      continue;
    }
    const boneName = String(channel?.target?.name || '').trim();
    const path = String(channel?.target?.path || '').trim();
    if (!boneName || !path) {
      continue;
    }
    if (!result.has(boneName)) {
      result.set(boneName, {});
    }
    result.get(boneName)[path] = channel;
  }
  return result;
}

/**
 * インスタンスの実姿勢から synthetic `下半身` 回転 channel をサンプルします。
 * @param {object} instance - モデルインスタンス。
 * @param {number} timelineFps - clip fps。
 * @returns {object|null} `下半身.rotation` channel。
 */
function sampleLowerBodyRotationChannelFromInstance(instance, timelineFps) {
  const model = instance?.model || null;
  const scene = instance?.scene || null;
  const animationController = instance?.animationController || null;
  const lowerBodyBone = findBoneByName(model, '下半身');
  if (!model || !scene || !animationController || !lowerBodyBone) {
    return null;
  }

  const lowerBodyBoneIndex = findBoneIndexByName(model, lowerBodyBone.name);
  if (lowerBodyBoneIndex < 0) {
    return null;
  }

  const fps = Math.max(1, Number(timelineFps) || DEFAULT_TIMELINE_FPS);
  const sourceClip = instance?.animationSource?.clip || null;
  const maxFrame = Math.max(
    0,
    Math.round(animationController?.maxFrame || 0),
    Math.round((Number(sourceClip?.duration) || 0) * fps),
  );
  const sceneSnapshot = snapshotSceneBoneState(scene);
  const controllerSnapshot = snapshotAnimationControllerState(animationController);
  const channel = createEmptyBoneChannel(lowerBodyBone.name, 'rotation');
  let hasMeaningfulRotation = false;

  try {
    for (let frameNum = 0; frameNum <= maxFrame; frameNum += 1) {
      sampleInstancePoseForVrmaBake(instance, frameNum);
      const local = scene?.boneLocalTransforms?.[lowerBodyBoneIndex] || null;
      const value = normalizeQuaternionValue(local?.rotation || IDENTITY_QUATERNION);
      if (!isIdentityQuaternion(value)) {
        hasMeaningfulRotation = true;
      }
      channel.sampler.keyframes.push({
        time: frameNum / fps,
        frameNum,
        value,
      });
    }
  } finally {
    restoreSceneBoneState(scene, sceneSnapshot);
    restoreAnimationControllerState(animationController, controllerSnapshot);
  }

  if (!hasMeaningfulRotation) {
    return null;
  }
  return channel;
}

/**
 * モデル向け VRMA export 用 humanoid 対応表を構築します。
 * @param {object|null} model - モデル。
 * @returns {Map<string, string>} humanoid 名 -> 実 bone 名。
 */
function buildVrmaExportHumanoidBoneNameMap(model) {
  const result = new Map();
  if (String(model?.magic || '').trim() === 'Vrm') {
    for (const [humanoidBoneName, boneName] of Object.entries(model?.vrm?.humanoidBoneNameMap || {})) {
      const normalizedHumanoidBoneName = String(humanoidBoneName || '').trim();
      const normalizedBoneName = String(boneName || '').trim();
      if (normalizedHumanoidBoneName && normalizedBoneName) {
        result.set(normalizedHumanoidBoneName, normalizedBoneName);
      }
    }
    return result;
  }

  if (['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
    for (const [humanoidBoneName, boneName] of DEFAULT_VRMA_PMX_ANIMATION_MAPPINGS) {
      const normalizedHumanoidBoneName = String(humanoidBoneName || '').trim();
      const normalizedBoneName = String(boneName || '').trim();
      if (!normalizedHumanoidBoneName || !normalizedBoneName) {
        continue;
      }
      if (findBoneByName(model, normalizedBoneName)) {
        result.set(normalizedHumanoidBoneName, normalizedBoneName);
      }
    }
  }
  return result;
}

/**
 * モデル向け VRMA export 用 bone 対応表を返します。
 * @param {object|null} model - モデル。
 * @param {boolean} [includeSyntheticLowerBody=false] - synthetic 下半身を含めるなら true。
 * @returns {Array<[string, string]>} humanoid/拡張名 -> 実 bone 名。
 */
function buildVrmaExportHumanBoneNameEntries(model, includeSyntheticLowerBody = false) {
  const entries = Array.from(buildVrmaExportHumanoidBoneNameMap(model).entries());
  if (includeSyntheticLowerBody && findBoneByName(model, '下半身')) {
    entries.push(['下半身', '下半身']);
  }
  return entries;
}

/**
 * synthetic 下半身階層を使うかどうかを返します。
 * @param {object|null|undefined} clipOrOptions - clip または option 相当。
 * @returns {boolean} 使用するなら true。
 */
function usesVrmaSyntheticLowerBodyHierarchy(clipOrOptions) {
  return Boolean(clipOrOptions?.metadata?.vrmAnimation?.includeSyntheticLowerBody || clipOrOptions?.includeSyntheticLowerBody);
}

/**
 * VRMA scene/rest 計算用の parent 名を返します。
 * @param {string} boneName - bone 名。
 * @param {object} [options={}] - 補助オプション。
 * @param {boolean} [options.includeSyntheticLowerBody=false] - synthetic 下半身階層を使うなら true。
 * @returns {string} 親 bone 名。
 */
function getVrmaExportParentBoneName(boneName, options = {}) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName) {
    return '';
  }
  if (usesVrmaSyntheticLowerBodyHierarchy(options)) {
    if (normalizedBoneName === '下半身') {
      return 'hips';
    }
    if (normalizedBoneName === 'spine' || normalizedBoneName === 'leftUpperLeg' || normalizedBoneName === 'rightUpperLeg') {
      return '下半身';
    }
  }
  return String(HUMAN_BONE_PARENT_MAP[normalizedBoneName] || '').trim();
}

/**
 * 実 bone 名から humanoid 名への逆引き表を構築します。
 * @param {object|null} model - モデル。
 * @returns {Map<string, string>} 実 bone 名 -> humanoid 名。
 */
function buildInverseHumanoidBoneNameMap(model) {
  const result = new Map();
  for (const [humanoidBoneName, boneName] of buildVrmaExportHumanoidBoneNameMap(model).entries()) {
    result.set(String(boneName || '').trim(), String(humanoidBoneName || '').trim());
  }
  return result;
}

/**
 * clip を VRMA humanoid export ルールへ正規化します。
 * @param {object|null} clip - 対象 clip。
 * @param {object|null} model - 対象モデル。
 * @param {object[]} warnings - warning 出力先。
 * @param {object} [options={}] - 正規化オプション。
 * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - synthetic `下半身` 回転を `hips` / `spine` へベイクするなら true。
 * @param {boolean} [options.foldAllParentIntoHips=true] - `全ての親` を `hips` world TRS へ fold するなら true。
 * @returns {object} 正規化済み clip。
 */
function normalizeVrmaHumanoidClipForExport(clip, model, warnings, options = {}) {
  const normalizedClip = {
    ...(clip || {}),
    metadata: clip?.metadata ? { ...clip.metadata } : {},
    channels: [],
  };
  const humanoidBoneNames = new Set(buildVrmaExportHumanoidBoneNameMap(model).keys());
  const inverseHumanoidMap = buildInverseHumanoidBoneNameMap(model);
  const bakeLowerBodyToHumanoid = !usesVrmaSyntheticLowerBodyHierarchy(clip) && (options?.bakeLowerBodyToHumanoid !== undefined
    ? Boolean(options.bakeLowerBodyToHumanoid)
    : true);
  const foldAllParentIntoHips = options?.foldAllParentIntoHips !== undefined
    ? Boolean(options.foldAllParentIntoHips)
    : true;
  const normalizedChannels = [];
  const allParentChannels = {};
  let droppedNonHipsTranslation = false;

  for (const channel of clip?.channels || []) {
    if (channel?.target?.kind !== 'bone') {
      normalizedChannels.push(cloneVrmaAuxiliaryOrMorphChannel(channel));
      continue;
    }

    const sourceName = String(channel?.target?.name || '').trim();
    const path = String(channel?.target?.path || '').trim();
    if (!sourceName || !path) {
      continue;
    }
    if (sourceName === '全ての親') {
      allParentChannels[path] = cloneChannelWithTargetName(channel, sourceName);
      continue;
    }

    const humanoidBoneName = inverseHumanoidMap.get(sourceName) || sourceName;
    const clonedChannel = cloneChannelWithTargetName(channel, humanoidBoneName);
    if (path === 'translation' && humanoidBoneName !== 'hips' && humanoidBoneNames.has(humanoidBoneName)) {
      droppedNonHipsTranslation = true;
      continue;
    }
    normalizedChannels.push(clonedChannel);
  }

  const bakedChannels = bakeLowerBodyToHumanoid
    ? bakeLowerBodyRotationIntoHumanoidChannels(normalizedChannels, model, Number(normalizedClip.timelineFps) || DEFAULT_TIMELINE_FPS)
    : normalizedChannels;

  if (droppedNonHipsTranslation) {
    warnings.push(createVrmaExportWarning(
      'non-hips-translation-dropped',
      'VRMA export dropped humanoid translation channels except hips.',
    ));
  }

  normalizedClip.channels = rebuildWorldHipsChannels(
    bakedChannels,
    allParentChannels,
    model,
    Number(normalizedClip.timelineFps) || DEFAULT_TIMELINE_FPS,
    { foldAllParentIntoHips },
  );
  normalizedClip.duration = Number(normalizedClip.duration) || 0;
  return normalizedClip;
}

/**
 * channel を別 target 名で複製します。
 * @param {object} channel - 元 channel。
 * @param {string} targetName - 新しい target 名。
 * @returns {object} 複製 channel。
 */
function cloneChannelWithTargetName(channel, targetName) {
  return {
    target: {
      ...(channel?.target || {}),
      name: targetName,
      nodeName: targetName,
      originalTrackName: createTrackName(targetName, channel?.target?.path),
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
 * morph channel を VRMA expression node 向けに複製します。
 * @param {object} channel - 元 channel。
 * @returns {object} 複製 channel。
 */
function cloneVrmaMorphChannel(channel) {
  const expressionNodeName = getVrmaExpressionNodeName(channel);
  return {
    target: {
      ...(channel?.target || {}),
      kind: 'morph',
      name: String(channel?.target?.name || ''),
      nodeName: expressionNodeName,
      originalTrackName: createTrackName(expressionNodeName, 'translation'),
      vrmaExpressionName: String(channel?.target?.vrmaExpressionName || channel?.target?.name || ''),
      vrmaExpressionType: String(channel?.target?.vrmaExpressionType || 'custom'),
    },
    sampler: {
      interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
      keyframes: Array.isArray(channel?.sampler?.keyframes)
        ? channel.sampler.keyframes.map((keyframe) => ({
          time: Number(keyframe?.time) || 0,
          frameNum: Number.isFinite(keyframe?.frameNum) ? Number(keyframe.frameNum) : undefined,
          value: Number(keyframe?.value) || 0,
        }))
        : [],
    },
  };
}

function cloneVrmaAuxiliaryChannel(channel) {
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

function cloneVrmaAuxiliaryOrMorphChannel(channel) {
  if (channel?.target?.kind === 'morph') {
    return cloneVrmaMorphChannel(channel);
  }
  if (channel?.target?.kind === 'node' || channel?.target?.kind === 'pointer') {
    return cloneVrmaAuxiliaryChannel(channel);
  }
  return cloneChannelWithTargetName(channel, String(channel?.target?.name || ''));
}

/**
 * synthetic `下半身` 回転を `hips` / `spine` へベイクし、`下半身` channel を除去します。
 * @param {object[]} channels - 正規化済み channel 一覧。
 * @param {object|null} model - 対象モデル。
 * @param {number} timelineFps - clip fps。
 * @returns {object[]} ベイク済み channel 一覧。
 */
function bakeLowerBodyRotationIntoHumanoidChannels(channels, model, timelineFps) {
  const lowerBodyBone = findBoneByName(model, '下半身');
  const exportHumanoidBoneNameMap = buildVrmaExportHumanoidBoneNameMap(model);
  const hipsBone = findBoneByName(model, exportHumanoidBoneNameMap.get('hips'));
  const spineBone = findBoneByName(model, exportHumanoidBoneNameMap.get('spine'));
  if (!lowerBodyBone || !hipsBone || !spineBone) {
    return Array.isArray(channels) ? channels.map((channel) => cloneVrmaAuxiliaryOrMorphChannel(channel)) : [];
  }

  const lowerBodyBoneName = String(lowerBodyBone.name || '').trim();
  const result = [];
  const lowerBodyChannels = {};
  let hipsRotationChannel = null;
  let spineRotationChannel = null;

  for (const channel of Array.isArray(channels) ? channels : []) {
    if (channel?.target?.kind !== 'bone') {
      result.push(cloneVrmaAuxiliaryOrMorphChannel(channel));
      continue;
    }
    const targetName = String(channel?.target?.name || '').trim();
    const targetPath = String(channel?.target?.path || '').trim();
    if (targetName === lowerBodyBoneName) {
      lowerBodyChannels[targetPath] = cloneChannelWithTargetName(channel, targetName);
      continue;
    }
    const clonedChannel = cloneChannelWithTargetName(channel, targetName);
    if (targetName === 'hips' && targetPath === 'rotation') {
      hipsRotationChannel = clonedChannel;
    } else if (targetName === 'spine' && targetPath === 'rotation') {
      spineRotationChannel = clonedChannel;
    }
    result.push(clonedChannel);
  }

  if (!lowerBodyChannels.rotation) {
    return result;
  }

  const frameNumbers = collectChannelFrameNumbers([
    lowerBodyChannels.rotation,
    hipsRotationChannel,
    spineRotationChannel,
  ]);
  if (frameNumbers.length === 0) {
    return result;
  }

  const hipsBindRotation = Array.isArray(hipsRotationChannel?.target?.bindRotation) || ArrayBuffer.isView(hipsRotationChannel?.target?.bindRotation)
    ? normalizeQuaternionValue(hipsRotationChannel.target.bindRotation)
    : computeBoneRestRotationQuaternion(hipsBone);
  const spineBindRotation = Array.isArray(spineRotationChannel?.target?.bindRotation) || ArrayBuffer.isView(spineRotationChannel?.target?.bindRotation)
    ? normalizeQuaternionValue(spineRotationChannel.target.bindRotation)
    : computeBoneRestRotationQuaternion(spineBone);
  const sourceHipsRotationChannel = hipsRotationChannel ? cloneChannelWithTargetName(hipsRotationChannel, 'hips') : null;
  const sourceSpineRotationChannel = spineRotationChannel ? cloneChannelWithTargetName(spineRotationChannel, 'spine') : null;

  if (!hipsRotationChannel) {
    hipsRotationChannel = createEmptyBoneChannel('hips', 'rotation');
    assignBoneChannelBindTransforms(hipsRotationChannel, null, hipsBindRotation);
    result.push(hipsRotationChannel);
  } else {
    hipsRotationChannel.sampler.keyframes = [];
    assignBoneChannelBindTransforms(hipsRotationChannel, null, hipsBindRotation);
  }
  if (!spineRotationChannel) {
    spineRotationChannel = createEmptyBoneChannel('spine', 'rotation');
    assignBoneChannelBindTransforms(spineRotationChannel, null, spineBindRotation);
    result.push(spineRotationChannel);
  } else {
    spineRotationChannel.sampler.keyframes = [];
    assignBoneChannelBindTransforms(spineRotationChannel, null, spineBindRotation);
  }

  for (const frameNum of frameNumbers) {
    const time = frameNum / Math.max(1, Number(timelineFps) || DEFAULT_TIMELINE_FPS);
    const lowerBodyRotationDelta = sampleAnimationChannelValue(lowerBodyChannels.rotation, time) || IDENTITY_QUATERNION;
    const hipsRotationDelta = sampleAnimationChannelValue(sourceHipsRotationChannel, time) || IDENTITY_QUATERNION;
    const spineRotationDelta = sampleAnimationChannelValue(sourceSpineRotationChannel, time) || IDENTITY_QUATERNION;
    const hipsRotation = multiplyQuaternionValues(hipsBindRotation, hipsRotationDelta);
    const spineRotation = multiplyQuaternionValues(spineBindRotation, spineRotationDelta);
    const bakedHipsRotation = multiplyQuaternionValues(hipsRotation, lowerBodyRotationDelta);
    const bakedSpineRotation = multiplyQuaternionValues(invertQuaternionValue(lowerBodyRotationDelta), spineRotation);

    hipsRotationChannel.sampler.keyframes.push({
      time,
      frameNum,
      value: subtractQuaternionValues(bakedHipsRotation, hipsBindRotation),
    });
    spineRotationChannel.sampler.keyframes.push({
      time,
      frameNum,
      value: subtractQuaternionValues(bakedSpineRotation, spineBindRotation),
    });
  }

  return result;
}

function rebuildWorldHipsChannels(channels, allParentChannels, model, timelineFps, options = {}) {
  const result = Array.isArray(channels) ? channels.map((channel) => cloneVrmaAuxiliaryOrMorphChannel(channel)) : [];
  const hipsChannels = {};
  for (const channel of result) {
    if (channel?.target?.kind !== 'bone' || String(channel?.target?.name || '').trim() !== 'hips') {
      continue;
    }
    hipsChannels[String(channel?.target?.path || '').trim()] = channel;
  }

  const rootHasTranslation = Boolean(allParentChannels.translation);
  const rootHasRotation = Boolean(allParentChannels.rotation);
  const rootHasScale = Boolean(allParentChannels.scale);
  const hipsHasTranslation = Boolean(hipsChannels.translation);
  const hipsHasRotation = Boolean(hipsChannels.rotation);
  const hipsHasScale = Boolean(hipsChannels.scale);
  const sourceHipsChannels = {
    translation: hipsChannels.translation ? cloneChannelWithTargetName(hipsChannels.translation, 'hips') : null,
    rotation: hipsChannels.rotation ? cloneChannelWithTargetName(hipsChannels.rotation, 'hips') : null,
    scale: hipsChannels.scale ? cloneChannelWithTargetName(hipsChannels.scale, 'hips') : null,
  };
  const hipsBoneName = String(buildVrmaExportHumanoidBoneNameMap(model).get('hips') || '').trim();
  const hipsBone = findBoneByName(model, hipsBoneName);
  if (!hipsBone) {
    return result;
  }

  const hipsBindTranslation = Array.isArray(hipsChannels.translation?.target?.bindTranslation) || ArrayBuffer.isView(hipsChannels.translation?.target?.bindTranslation)
    ? normalizeVector3(hipsChannels.translation.target.bindTranslation, [0, 0, 0])
    : computeHumanoidLocalTranslation(model, 'hips', hipsBone);
  const hipsBindRotation = Array.isArray(hipsChannels.rotation?.target?.bindRotation) || ArrayBuffer.isView(hipsChannels.rotation?.target?.bindRotation)
    ? normalizeQuaternionValue(hipsChannels.rotation.target.bindRotation)
    : computeBoneRestRotationQuaternion(hipsBone);
  const foldAllParentIntoHips = options?.foldAllParentIntoHips !== undefined
    ? Boolean(options.foldAllParentIntoHips)
    : true;
  if (!rootHasTranslation && !rootHasRotation && !rootHasScale) {
    if (hipsChannels.translation) {
      normalizeTranslationChannelKeyframesForBindTranslation(hipsChannels.translation, hipsBindTranslation);
      assignBoneChannelBindTransforms(hipsChannels.translation, hipsBindTranslation, null);
    }
    if (hipsChannels.rotation) {
      assignBoneChannelBindTransforms(hipsChannels.rotation, null, hipsBindRotation);
    }
    return result;
  }
  if (!foldAllParentIntoHips) {
    if (hipsChannels.translation) {
      normalizeTranslationChannelKeyframesForBindTranslation(hipsChannels.translation, hipsBindTranslation);
      assignBoneChannelBindTransforms(hipsChannels.translation, hipsBindTranslation, null);
    }
    if (hipsChannels.rotation) {
      assignBoneChannelBindTransforms(hipsChannels.rotation, null, hipsBindRotation);
    }
    return result;
  }

  const allParentBone = findBoneByName(model, '全ての親');
  if (!allParentBone) {
    return result;
  }

  const rootBindTranslation = normalizeVector3(allParentBone?.position, [0, 0, 0]);
  const rootBindRotation = isVrmSyntheticAllParentBone(model, allParentBone)
    ? Array.from(IDENTITY_QUATERNION)
    : computeBoneRestRotationQuaternion(allParentBone);

  const frameNumbers = collectChannelFrameNumbers([
    allParentChannels.translation,
    allParentChannels.rotation,
    allParentChannels.scale,
    hipsChannels.translation,
    hipsChannels.rotation,
    hipsChannels.scale,
  ]);
  if (frameNumbers.length === 0) {
    return result;
  }

  if (hipsChannels.translation) {
    hipsChannels.translation.sampler.keyframes = [];
    assignBoneChannelBindTransforms(hipsChannels.translation, hipsBindTranslation, null);
  }
  if (hipsChannels.rotation) {
    hipsChannels.rotation.sampler.keyframes = [];
    assignBoneChannelBindTransforms(hipsChannels.rotation, null, hipsBindRotation);
  }
  if (hipsChannels.scale) {
    hipsChannels.scale.sampler.keyframes = [];
  }

  for (const frameNum of frameNumbers) {
    const time = frameNum / Math.max(1, Number(timelineFps) || DEFAULT_TIMELINE_FPS);
    const rootTranslationDelta = sampleAnimationChannelValue(allParentChannels.translation || null, time) || [0, 0, 0];
    const rootRotationDelta = sampleAnimationChannelValue(allParentChannels.rotation || null, time) || IDENTITY_QUATERNION;
    const rootScale = sampleAnimationChannelValue(allParentChannels.scale || null, time) || [1, 1, 1];
    const hipsTranslationDelta = sampleAnimationChannelValue(sourceHipsChannels.translation || null, time) || [0, 0, 0];
    const hipsRotationDelta = sampleAnimationChannelValue(sourceHipsChannels.rotation || null, time) || IDENTITY_QUATERNION;
    const hipsScale = sampleAnimationChannelValue(sourceHipsChannels.scale || null, time) || [1, 1, 1];

    const rootTranslation = addVector3Values(rootBindTranslation, rootTranslationDelta);
    const rootRotation = multiplyQuaternionValues(rootBindRotation, rootRotationDelta);
    const hipsTranslation = addVector3Values(hipsBindTranslation, hipsTranslationDelta);
    const hipsRotation = multiplyQuaternionValues(hipsBindRotation, hipsRotationDelta);
    const composedTranslation = composeParentChildTranslation(rootTranslation, rootRotation, rootScale, hipsTranslation);
    const composedRotation = multiplyQuaternionValues(rootRotation, hipsRotation);
    const composedScale = multiplyScaleValues(rootScale, hipsScale);
    const exportTranslation = hasMeaningfulVector3(rootTranslationDelta) && hasMeaningfulVector3(hipsTranslationDelta)
      ? subtractVector3Values(hipsTranslationDelta, rootTranslationDelta)
      : subtractVector3Values(composedTranslation, hipsBindTranslation);
    const exportRotation = subtractQuaternionValues(composedRotation, hipsBindRotation);

    if (rootHasTranslation || hipsHasTranslation || rootHasRotation || rootHasScale) {
      if (!hipsChannels.translation) {
        hipsChannels.translation = createEmptyBoneChannel('hips', 'translation');
        assignBoneChannelBindTransforms(hipsChannels.translation, hipsBindTranslation, null);
        result.push(hipsChannels.translation);
      }
      hipsChannels.translation.sampler.keyframes.push({
        time,
        frameNum,
        value: exportTranslation,
      });
    }
    if (rootHasRotation || hipsHasRotation) {
      if (!hipsChannels.rotation) {
        hipsChannels.rotation = createEmptyBoneChannel('hips', 'rotation');
        assignBoneChannelBindTransforms(hipsChannels.rotation, null, hipsBindRotation);
        result.push(hipsChannels.rotation);
      }
      hipsChannels.rotation.sampler.keyframes.push({
        time,
        frameNum,
        value: exportRotation,
      });
    }
    if (rootHasScale || hipsHasScale) {
      if (!hipsChannels.scale) {
        hipsChannels.scale = createEmptyBoneChannel('hips', 'scale');
        result.push(hipsChannels.scale);
      }
      hipsChannels.scale.sampler.keyframes.push({
        time,
        frameNum,
        value: composedScale,
      });
    }
  }

  return result;
}

/**
 * bindTranslation を持たない absolute local translation channel を bind-relative 値へ正規化します。
 * @param {object|null} channel - 対象 channel。
 * @param {ArrayLike<number>|null|undefined} bindTranslation - bind translation。
 */
function normalizeTranslationChannelKeyframesForBindTranslation(channel, bindTranslation) {
  if (
    !channel
    || channel?.target?.path !== 'translation'
    || Array.isArray(channel?.target?.bindTranslation)
    || ArrayBuffer.isView(channel?.target?.bindTranslation)
    || !(Array.isArray(bindTranslation) || ArrayBuffer.isView(bindTranslation))
  ) {
    return;
  }

  for (const keyframe of channel?.sampler?.keyframes || []) {
    if (!(Array.isArray(keyframe?.value) || ArrayBuffer.isView(keyframe?.value))) {
      continue;
    }
    keyframe.value = subtractVector3Values(keyframe.value, bindTranslation);
  }
}

/**
 * vector3 に有意な成分があるかを判定します。
 * @param {ArrayLike<number>|undefined|null} value - 入力 vector3。
 * @returns {boolean} 有意な成分がある場合は true。
 */
function hasMeaningfulVector3(value) {
  return Math.abs(Number(value?.[0]) || 0) > 1e-8
    || Math.abs(Number(value?.[1]) || 0) > 1e-8
    || Math.abs(Number(value?.[2]) || 0) > 1e-8;
}

function appendVrmaAuxiliaryChannelsFromMetadata(clip) {
  const cameraKeyframes = Array.isArray(clip?.metadata?.cameraKeyframes) ? clip.metadata.cameraKeyframes : [];
  for (const keyframe of cameraKeyframes) {
    const vrmaValues = convertCameraKeyframeToVrmaValues(keyframe);
    upsertAuxiliaryChannel(clip, {
      kind: 'node',
      name: VRMA_CAMERA_TARGET_NODE_NAME,
      nodeName: VRMA_CAMERA_TARGET_NODE_NAME,
      path: 'translation',
      role: 'camera-target',
    }, keyframe.frameNum, vrmaValues.target);
    upsertAuxiliaryChannel(clip, {
      kind: 'node',
      name: VRMA_CAMERA_ORBIT_NODE_NAME,
      nodeName: VRMA_CAMERA_ORBIT_NODE_NAME,
      path: 'rotation',
      role: 'camera-orbit',
    }, keyframe.frameNum, vrmaValues.orbit);
    upsertAuxiliaryChannel(clip, {
      kind: 'node',
      name: VRMA_CAMERA_NODE_NAME,
      nodeName: VRMA_CAMERA_NODE_NAME,
      path: 'translation',
      role: 'camera',
    }, keyframe.frameNum, vrmaValues.distance);
    upsertAuxiliaryChannel(clip, {
      kind: 'pointer',
      name: 'camera-fov',
      path: 'value',
      pointer: VRMA_CAMERA_FOV_POINTER,
      role: 'camera-fov',
      valueType: 'scalar',
    }, keyframe.frameNum, vrmaValues.fovY);
  }

  const lightKeyframes = Array.isArray(clip?.metadata?.lightKeyframes) ? clip.metadata.lightKeyframes : [];
  for (const keyframe of lightKeyframes) {
    if (Array.isArray(keyframe?.position)) {
      upsertAuxiliaryChannel(clip, {
        kind: 'node',
        name: VRMA_LIGHT_NODE_NAME,
        nodeName: VRMA_LIGHT_NODE_NAME,
        path: 'translation',
        role: 'light',
      }, keyframe.frameNum, keyframe.position);
    }
    if (Array.isArray(keyframe?.rotation)) {
      upsertAuxiliaryChannel(clip, {
        kind: 'node',
        name: VRMA_LIGHT_NODE_NAME,
        nodeName: VRMA_LIGHT_NODE_NAME,
        path: 'rotation',
        role: 'light',
      }, keyframe.frameNum, keyframe.rotation);
    }
    upsertAuxiliaryChannel(clip, {
      kind: 'pointer',
      name: 'light-color',
      path: 'value',
      pointer: VRMA_LIGHT_COLOR_POINTER,
      role: 'light-color',
      valueType: 'vec3',
    }, keyframe.frameNum, Array.from(keyframe?.color || [1, 1, 1]).slice(0, 3));
  }
}

function upsertAuxiliaryChannel(clip, target, frameNum, value) {
  if (!clip || !Array.isArray(clip.channels)) {
    return;
  }
  const time = frameNum / (Number(clip.timelineFps) || DEFAULT_TIMELINE_FPS);
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

function collectChannelFrameNumbers(channels) {
  const frames = new Set();
  for (const channel of channels) {
    const keyframes = Array.isArray(channel?.sampler?.keyframes) ? channel.sampler.keyframes : [];
    for (const keyframe of keyframes) {
      const frameNum = Number.isFinite(keyframe?.frameNum)
        ? Math.round(keyframe.frameNum)
        : null;
      if (frameNum !== null) {
        frames.add(frameNum);
      }
    }
  }
  return Array.from(frames).sort((left, right) => left - right);
}

function addVector3Values(left, right) {
  return [
    (Number(left?.[0]) || 0) + (Number(right?.[0]) || 0),
    (Number(left?.[1]) || 0) + (Number(right?.[1]) || 0),
    (Number(left?.[2]) || 0) + (Number(right?.[2]) || 0),
  ];
}

function subtractVector3Values(left, right) {
  return [
    (Number(left?.[0]) || 0) - (Number(right?.[0]) || 0),
    (Number(left?.[1]) || 0) - (Number(right?.[1]) || 0),
    (Number(left?.[2]) || 0) - (Number(right?.[2]) || 0),
  ];
}

function composeParentChildTranslation(parentTranslation, parentRotation, parentScale, childTranslation) {
  const scaledChild = vec3.fromValues(
    (Number(childTranslation?.[0]) || 0) * (Number(parentScale?.[0]) || 1),
    (Number(childTranslation?.[1]) || 0) * (Number(parentScale?.[1]) || 1),
    (Number(childTranslation?.[2]) || 0) * (Number(parentScale?.[2]) || 1),
  );
  const rotatedChild = vec3.create();
  vec3.transformQuat(rotatedChild, scaledChild, normalizeQuaternionValue(parentRotation));
  return [
    (Number(parentTranslation?.[0]) || 0) + rotatedChild[0],
    (Number(parentTranslation?.[1]) || 0) + rotatedChild[1],
    (Number(parentTranslation?.[2]) || 0) + rotatedChild[2],
  ];
}

function multiplyQuaternionValues(left, right) {
  const result = quat.create();
  quat.multiply(result, normalizeQuaternionValue(left), normalizeQuaternionValue(right));
  quat.normalize(result, result);
  return canonicalizeQuaternionValue(result);
}

function subtractQuaternionValues(value, bindRotation) {
  const result = quat.create();
  const inverseBind = quat.invert(quat.create(), normalizeQuaternionValue(bindRotation));
  quat.multiply(result, inverseBind, normalizeQuaternionValue(value));
  quat.normalize(result, result);
  return canonicalizeQuaternionValue(result);
}

function invertQuaternionValue(value) {
  const result = quat.invert(quat.create(), normalizeQuaternionValue(value));
  quat.normalize(result, result);
  return canonicalizeQuaternionValue(result);
}

function multiplyScaleValues(left, right) {
  return [
    (Number(left?.[0]) || 1) * (Number(right?.[0]) || 1),
    (Number(left?.[1]) || 1) * (Number(right?.[1]) || 1),
    (Number(left?.[2]) || 1) * (Number(right?.[2]) || 1),
  ];
}

function normalizeQuaternionValue(value) {
  const result = quat.fromValues(
    Number(value?.[0]) || 0,
    Number(value?.[1]) || 0,
    Number(value?.[2]) || 0,
    Number.isFinite(Number(value?.[3])) ? Number(value[3]) : 1,
  );
  if (quat.length(result) <= 1e-8) {
    return quat.fromValues(0, 0, 0, 1);
  }
  quat.normalize(result, result);
  const canonicalized = canonicalizeQuaternionValue(result);
  return quat.fromValues(canonicalized[0], canonicalized[1], canonicalized[2], canonicalized[3]);
}

/**
 * quaternion が恒等回転かどうかを判定します。
 * @param {ArrayLike<number>|null|undefined} quaternion - 判定対象の quaternion。
 * @returns {boolean} 恒等回転なら true。
 */
function isIdentityQuaternion(quaternion) {
  const value = normalizeQuaternionValue(quaternion);
  return Math.abs(value[0]) <= 1e-8
    && Math.abs(value[1]) <= 1e-8
    && Math.abs(value[2]) <= 1e-8
    && Math.abs(value[3] - 1) <= 1e-8;
}

function canonicalizeQuaternionValue(value) {
  const normalized = [
    Math.abs(Number(value?.[0]) || 0) <= 1e-8 ? 0 : Number(value?.[0]) || 0,
    Math.abs(Number(value?.[1]) || 0) <= 1e-8 ? 0 : Number(value?.[1]) || 0,
    Math.abs(Number(value?.[2]) || 0) <= 1e-8 ? 0 : Number(value?.[2]) || 0,
    Math.abs(Number(value?.[3]) || 0) <= 1e-8 ? 0 : Number(value?.[3]) || 0,
  ];
  const sign = selectCanonicalQuaternionSign(normalized);
  return normalized.map((component) => component * sign);
}

function selectCanonicalQuaternionSign(value) {
  const priority = [3, 1, 0, 2];
  for (const index of priority) {
    const component = Number(value?.[index]) || 0;
    if (component > 1e-8) {
      return 1;
    }
    if (component < -1e-8) {
      return -1;
    }
  }
  return 1;
}

function createEmptyBoneChannel(targetName, path) {
  return {
    target: {
      kind: 'bone',
      name: targetName,
      nodeName: targetName,
      path,
      originalTrackName: createTrackName(targetName, path),
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [],
    },
  };
}

function assignBoneChannelBindTransforms(channel, bindTranslation, bindRotation) {
  if (!channel?.target) {
    return;
  }
  if (Array.isArray(bindTranslation) || ArrayBuffer.isView(bindTranslation)) {
    channel.target.bindTranslation = Array.from(bindTranslation);
  }
  if (Array.isArray(bindRotation) || ArrayBuffer.isView(bindRotation)) {
    channel.target.bindRotation = Array.from(bindRotation);
  }
}

/**
 * VRMA 用の Three.js scene を構築します。
 * @param {object} model - 対象 VRM モデル。
 * @param {Map<string, object>} expressionDefinitions - expression 定義。
 * @param {object|null} [clip=null] - 書き出し対象 clip。
 * @returns {{scene: Group, humanoidBoneNames: string[], expressionNodeNames: string[]}} scene と node 一覧。
 */
function createVrmaScene(model, expressionDefinitions, clip = null) {
  const scene = new Group();
  scene.name = 'VRMA';
  const humanBoneNames = collectVrmaSceneHumanBoneNames(model, clip);
  const humanBoneNodeMap = new Map();
  const expressionNodeNames = [];

  for (const humanBoneName of humanBoneNames) {
    const nodeTransform = resolveVrmaSceneHumanBoneTransform(model, clip, humanBoneName);
    if (!nodeTransform) {
      continue;
    }
    const node = new Object3D();
    node.name = humanBoneName;
    const localTranslation = nodeTransform.localTranslation;
    const localRotation = nodeTransform.localRotation;
    node.position.set(localTranslation[0], localTranslation[1], localTranslation[2]);
    node.quaternion.set(localRotation[0], localRotation[1], localRotation[2], localRotation[3]);
    humanBoneNodeMap.set(humanBoneName, node);
  }

  for (const humanBoneName of humanBoneNames) {
    const node = humanBoneNodeMap.get(humanBoneName);
    if (!node) {
      continue;
    }
    const parentName = getVrmaExportParentBoneName(humanBoneName, {
      includeSyntheticLowerBody: usesVrmaSyntheticLowerBodyHierarchy(clip),
    });
    const parentNode = parentName ? humanBoneNodeMap.get(parentName) : null;
    if (parentNode) {
      parentNode.add(node);
    } else {
      scene.add(node);
    }
  }

  for (const definition of expressionDefinitions.values()) {
    const node = new Object3D();
    node.name = String(definition?.nodeName || '');
    scene.add(node);
    expressionNodeNames.push(node.name);
  }

  const cameraTarget = new Object3D();
  cameraTarget.name = VRMA_CAMERA_TARGET_NODE_NAME;
  const cameraOrbit = new Object3D();
  cameraOrbit.name = VRMA_CAMERA_ORBIT_NODE_NAME;
  const cameraNode = new PerspectiveCamera(45, 16 / 9, 0.1, 1000);
  cameraNode.name = VRMA_CAMERA_NODE_NAME;
  cameraOrbit.add(cameraNode);
  cameraTarget.add(cameraOrbit);
  scene.add(cameraTarget);

  const lightNode = new DirectionalLight(0xffffff, 1.0);
  lightNode.name = VRMA_LIGHT_NODE_NAME;
  scene.add(lightNode);

  return {
    scene,
    humanoidBoneNames: Array.from(humanBoneNodeMap.keys()),
    expressionNodeNames,
  };
}

/**
 * VRMA scene に含める humanoid 名一覧を返します。
 * @param {object|null} model - 対象モデル。
 * @param {object|null} clip - 書き出し対象 clip。
 * @returns {string[]} humanoid 名一覧。
 */
function collectVrmaSceneHumanBoneNames(model, clip) {
  const names = [];
  const seen = new Set();
  const append = (name) => {
    const normalizedName = String(name || '').trim();
    if (!normalizedName || normalizedName === 'leftEye' || normalizedName === 'rightEye' || seen.has(normalizedName)) {
      return;
    }
    seen.add(normalizedName);
    names.push(normalizedName);
  };

  for (const name of buildVrmaExportHumanoidBoneNameMap(model).keys()) {
    append(name);
  }
  for (const name of Object.keys(clip?.metadata?.vrmAnimation?.humanBones || {})) {
    append(name);
  }
  for (const channel of clip?.channels || []) {
    if (String(channel?.target?.kind || '').trim() !== 'bone') {
      continue;
    }
    append(channel?.target?.name);
  }
  return names;
}

/**
 * VRMA scene 用 humanoid node のローカル TRS を返します。
 * @param {object|null} model - 対象モデル。
 * @param {object|null} clip - 書き出し対象 clip。
 * @param {string} humanBoneName - humanoid 名。
 * @returns {{localTranslation: number[], localRotation: number[]}|null} node 変換情報。
 */
function resolveVrmaSceneHumanBoneTransform(model, clip, humanBoneName) {
  const translationChannel = findVrmaBoneChannel(clip, humanBoneName, 'translation');
  const rotationChannel = findVrmaBoneChannel(clip, humanBoneName, 'rotation');
  const restRotation = clip?.metadata?.vrmAnimation?.humanBoneRestRotations?.[humanBoneName];
  const clipLocalTranslation = Array.isArray(translationChannel?.target?.bindTranslation) || ArrayBuffer.isView(translationChannel?.target?.bindTranslation)
    ? normalizeVector3(translationChannel.target.bindTranslation, [0, 0, 0])
    : null;
  const clipLocalRotation = Array.isArray(restRotation?.localRotation) || ArrayBuffer.isView(restRotation?.localRotation)
    ? normalizeQuaternionValue(restRotation.localRotation)
    : (Array.isArray(rotationChannel?.target?.bindRotation) || ArrayBuffer.isView(rotationChannel?.target?.bindRotation)
      ? normalizeQuaternionValue(rotationChannel.target.bindRotation)
      : null);
  if (clipLocalTranslation || clipLocalRotation) {
    return {
      localTranslation: clipLocalTranslation || [0, 0, 0],
      localRotation: clipLocalRotation || Array.from(IDENTITY_QUATERNION),
    };
  }

  const boneName = String(buildVrmaExportHumanoidBoneNameMap(model).get(humanBoneName) || '').trim();
  const resolvedBoneName = boneName || String(humanBoneName || '').trim();
  const bone = findBoneByName(model, resolvedBoneName);
  const exportRestRotation = getVrmaExportHumanBoneRestRotation(model, humanBoneName, {
    includeSyntheticLowerBody: usesVrmaSyntheticLowerBodyHierarchy(clip),
  });
  if (bone) {
    return {
      localTranslation: computeHumanoidLocalTranslation(model, humanBoneName, bone, {
        includeSyntheticLowerBody: usesVrmaSyntheticLowerBodyHierarchy(clip),
      }),
      localRotation: exportRestRotation?.localRotation || computeBoneRestRotationQuaternion(bone),
    };
  }
  return {
    localTranslation: normalizeVector3(translationChannel?.target?.bindTranslation, [0, 0, 0]),
    localRotation: normalizeQuaternionValue(
      restRotation?.localRotation
      || rotationChannel?.target?.bindRotation
      || IDENTITY_QUATERNION,
    ),
  };
}

/**
 * humanoid 名と path から bone channel を返します。
 * @param {object|null} clip - 対象 clip。
 * @param {string} humanBoneName - humanoid 名。
 * @param {string} path - channel path。
 * @returns {object|null} 一致 channel。
 */
function findVrmaBoneChannel(clip, humanBoneName, path) {
  const normalizedBoneName = String(humanBoneName || '').trim();
  const normalizedPath = String(path || '').trim();
  if (!normalizedBoneName || !normalizedPath) {
    return null;
  }
  return Array.isArray(clip?.channels)
    ? clip.channels.find((channel) => (
      String(channel?.target?.kind || '').trim() === 'bone'
      && String(channel?.target?.name || '').trim() === normalizedBoneName
      && String(channel?.target?.path || '').trim() === normalizedPath
    )) || null
    : null;
}

/**
 * VRMA 用 clip を複製します。
 * @param {object} clip - 入力 clip。
 * @returns {object} 複製した clip。
 */
function cloneVrmaClipForExport(clip) {
  return {
    ...(clip || {}),
    metadata: clip?.metadata ? { ...clip.metadata } : {},
    channels: Array.isArray(clip?.channels)
      ? clip.channels.map((channel) => {
        const path = String(channel?.target?.path || '');
        const targetKind = String(channel?.target?.kind || '');
        return {
          target: {
            ...(channel?.target || {}),
            kind: targetKind === 'morph' ? 'node' : String(channel?.target?.kind || ''),
            name: targetKind === 'morph' ? getVrmaExpressionNodeName(channel) : String(channel?.target?.name || ''),
            path: targetKind === 'morph' ? 'translation' : path,
            nodeName: targetKind === 'morph' ? getVrmaExpressionNodeName(channel) : String(channel?.target?.name || ''),
            originalTrackName: createTrackName(
              targetKind === 'morph' ? getVrmaExpressionNodeName(channel) : String(channel?.target?.name || ''),
              targetKind === 'morph' ? 'translation' : path,
            ),
            bindTranslation: Array.isArray(channel?.target?.bindTranslation) || ArrayBuffer.isView(channel?.target?.bindTranslation)
              ? Array.from(channel.target.bindTranslation)
              : channel?.target?.bindTranslation,
            bindRotation: Array.isArray(channel?.target?.bindRotation) || ArrayBuffer.isView(channel?.target?.bindRotation)
              ? Array.from(channel.target.bindRotation)
              : channel?.target?.bindRotation,
          },
          sampler: {
            interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
            keyframes: Array.isArray(channel?.sampler?.keyframes)
              ? channel.sampler.keyframes.map((keyframe) => ({
                time: Number(keyframe?.time) || 0,
                frameNum: Number.isFinite(keyframe?.frameNum) ? Number(keyframe.frameNum) : undefined,
                value: targetKind === 'morph'
                  ? [clampExpressionWeight(keyframe?.value), 0, 0]
                  : Array.isArray(keyframe?.value) || ArrayBuffer.isView(keyframe?.value)
                    ? Array.from(keyframe.value)
                    : Number(keyframe?.value) || 0,
              }))
              : [],
          },
        };
      })
      : [],
  };
}

/**
 * humanoid 親子関係に基づくローカル translation を返します。
 * @param {object} model - モデル。
 * @param {string} humanBoneName - humanoid 名。
 * @param {object} bone - 実 bone。
 * @param {object} [options={}] - 補助オプション。
 * @param {boolean} [options.includeSyntheticLowerBody=false] - synthetic 下半身階層を使うなら true。
 * @returns {number[]} ローカル translation。
 */
function computeHumanoidLocalTranslation(model, humanBoneName, bone, options = {}) {
  const parentHumanBoneName = getVrmaExportParentBoneName(humanBoneName, options);
  if (!parentHumanBoneName) {
    return normalizeVector3(bone?.position, [0, 0, 0]);
  }
  const parentBoneName = buildVrmaExportHumanoidBoneNameMap(model).get(parentHumanBoneName) || parentHumanBoneName;
  const parentBone = findBoneByName(model, parentBoneName);
  if (!parentBone) {
    return normalizeVector3(bone?.position, [0, 0, 0]);
  }
  return [
    (Number(bone?.position?.[0]) || 0) - (Number(parentBone?.position?.[0]) || 0),
    (Number(bone?.position?.[1]) || 0) - (Number(parentBone?.position?.[1]) || 0),
    (Number(bone?.position?.[2]) || 0) - (Number(parentBone?.position?.[2]) || 0),
  ];
}

/**
 * PMX/PMD export 用 humanoid rest rotation を構築します。
 * @param {object|null} model - 対象モデル。
 * @param {Map<string, string>|null} [humanoidBoneNameMap=null] - humanoid 名 -> 実 bone 名。
 * @param {object} [options={}] - 補助オプション。
 * @param {boolean} [options.includeSyntheticLowerBody=false] - synthetic 下半身階層を使うなら true。
 * @returns {Record<string, {localRotation: number[], worldRotation: number[]}>} humanoid rest rotation map。
 */
function buildVrmaExportHumanBoneRestRotationMap(model, humanoidBoneNameMap = null, options = {}) {
  if (!['Pmx', 'Pmd'].includes(String(model?.magic || '').trim())) {
    return {};
  }

  const resolvedHumanoidBoneNameMap = humanoidBoneNameMap || new Map(buildVrmaExportHumanBoneNameEntries(model, usesVrmaSyntheticLowerBodyHierarchy(options)));
  const result = {};
  for (const [humanBoneName, boneName] of resolvedHumanoidBoneNameMap.entries()) {
    const boneIndex = findBoneIndexByName(model, boneName);
    if (boneIndex < 0) {
      continue;
    }
    result[humanBoneName] = {
      localRotation: Array.from(getBoneLocalRestRotationQuaternion(model.bones[boneIndex])),
      worldRotation: Array.from(IDENTITY_QUATERNION),
    };
  }
  const worldRestRotationCache = new Map();
  for (const humanBoneName of Object.keys(result)) {
    result[humanBoneName].worldRotation = computeVrmaExportHumanBoneWorldRestRotation(
      humanBoneName,
      result,
      worldRestRotationCache,
      options,
    );
  }
  return result;
}

/**
 * humanoid bone の export 用 rest rotation を返します。
 * @param {object|null} model - 対象モデル。
 * @param {string} humanBoneName - humanoid 名。
 * @param {object} [options={}] - 補助オプション。
 * @param {boolean} [options.includeSyntheticLowerBody=false] - synthetic 下半身階層を使うなら true。
 * @returns {{localRotation: number[], worldRotation: number[]}|null} rest rotation。
 */
function getVrmaExportHumanBoneRestRotation(model, humanBoneName, options = {}) {
  const restRotationMap = buildVrmaExportHumanBoneRestRotationMap(model, null, options);
  return restRotationMap[String(humanBoneName || '').trim()] || null;
}

/**
 * VRMA humanoid 親子で world rest rotation を計算します。
 * @param {string} humanBoneName - humanoid 名。
 * @param {Record<string, {localRotation: number[], worldRotation: number[]}>} restRotationMap - rest rotation map。
 * @param {Map<string, number[]>} cache - 計算キャッシュ。
 * @param {object} [options={}] - 補助オプション。
 * @param {boolean} [options.includeSyntheticLowerBody=false] - synthetic 下半身階層を使うなら true。
 * @returns {number[]} world rest rotation。
 */
function computeVrmaExportHumanBoneWorldRestRotation(humanBoneName, restRotationMap, cache, options = {}) {
  const normalizedHumanBoneName = String(humanBoneName || '').trim();
  if (!normalizedHumanBoneName) {
    return Array.from(IDENTITY_QUATERNION);
  }
  if (cache.has(normalizedHumanBoneName)) {
    return Array.from(cache.get(normalizedHumanBoneName));
  }

  const localRotation = normalizeQuaternionValue(
    restRotationMap?.[normalizedHumanBoneName]?.localRotation || IDENTITY_QUATERNION,
  );
  const parentHumanBoneName = getVrmaExportParentBoneName(normalizedHumanBoneName, options);
  if (!parentHumanBoneName || !restRotationMap?.[parentHumanBoneName]) {
    cache.set(normalizedHumanBoneName, localRotation);
    return Array.from(localRotation);
  }

  const parentWorldRotation = computeVrmaExportHumanBoneWorldRestRotation(parentHumanBoneName, restRotationMap, cache, options);
  const worldRotation = multiplyQuaternionValues(parentWorldRotation, localRotation);
  cache.set(normalizedHumanBoneName, worldRotation);
  return Array.from(worldRotation);
}

/**
 * 実 bone の rest rotation を返します。
 * @param {object|null} bone - 実 bone。
 * @returns {number[]} rest rotation。
 */
function computeBoneRestRotationQuaternion(bone) {
  return Array.from(getBoneLocalRestRotationQuaternion(bone));
}

/**
 * GLB に VRMC_vrm_animation 拡張を追加します。
 * @param {ArrayBuffer} buffer - 元 GLB。
 * @param {string[]} humanoidBoneNames - humanoid bone 一覧。
 * @returns {ArrayBuffer} 拡張追加済み GLB。
 */
function patchGlbWithVrmaExtension(buffer, humanoidBoneNames, expressionDefinitions, clip, openMmdBoneChannels = null) {
  const json = parseGlbJson(buffer);
  const nodeNameToIndex = new Map();
  for (let index = 0; index < (json.nodes || []).length; index++) {
    const nodeName = String(json.nodes[index]?.name || '').trim();
    if (nodeName) {
      nodeNameToIndex.set(nodeName, index);
    }
  }

  const humanBones = {};
  for (const humanBoneName of humanoidBoneNames) {
    const nodeIndex = nodeNameToIndex.get(humanBoneName);
    if (Number.isInteger(nodeIndex)) {
      humanBones[humanBoneName] = { node: nodeIndex };
    }
  }

  const extensionsUsed = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  extensionsUsed.add('VRMC_vrm_animation');
  json.extensionsUsed = Array.from(extensionsUsed);
  json.extensions = {
    ...(json.extensions || {}),
    VRMC_vrm_animation: {
      specVersion: '1.0',
      humanoid: {
        humanBones,
      },
      expressions: buildVrmaExpressionsExtension(expressionDefinitions, nodeNameToIndex),
      openMmdBoneChannels,
    },
  };
  const extraBinary = appendVrmaPointerAnimations(json, clip);
  return rebuildGlb(buffer, JSON.stringify(json), extraBinary);
}

/**
 * GLTFExporter で落ちやすい非 ASCII bone channel を退避します。
 * @param {object|null} clip - 対象 clip。
 * @param {object} [options={}] - 退避オプション。
 * @param {boolean} [options.bakeLowerBodyToHumanoid=true] - synthetic `下半身` を退避するなら true。
 * @returns {Array<object>|undefined} 退避 channel 一覧。
 */
function collectOpenMmdBoneChannels(clip, options = {}) {
  const bakeLowerBodyToHumanoid = options?.bakeLowerBodyToHumanoid !== undefined
    ? Boolean(options.bakeLowerBodyToHumanoid)
    : true;
  const channels = [];
  for (const channel of Array.isArray(clip?.channels) ? clip.channels : []) {
    if (String(channel?.target?.kind || '').trim() !== 'bone') {
      continue;
    }
    const targetName = String(channel?.target?.name || '').trim();
    if (!targetName || isAsciiSafeName(targetName)) {
      continue;
    }
    if (targetName === '下半身' && bakeLowerBodyToHumanoid) {
      continue;
    }
    channels.push(cloneVrmaAuxiliaryOrMorphChannel(channel));
  }
  if (channels.length === 0) {
    return undefined;
  }
  return cloneVrmaClipForExport({
    ...(clip || {}),
    channels,
  }).channels;
}

/**
 * ASCII のみで構成された名前かどうかを返します。
 * @param {string} value - 判定対象。
 * @returns {boolean} ASCII のみなら true。
 */
function isAsciiSafeName(value) {
  return /^[\x20-\x7E]+$/.test(String(value || ''));
}

function appendVrmaPointerAnimations(json, clip) {
  const pointerChannels = Array.isArray(clip?.channels)
    ? clip.channels.filter((channel) => channel?.target?.kind === 'pointer')
    : [];
  if (pointerChannels.length === 0) {
    return null;
  }

  json.animations = Array.isArray(json.animations) && json.animations.length > 0
    ? json.animations
    : [{ channels: [], samplers: [] }];
  const animation = json.animations[0];
  animation.channels = Array.isArray(animation.channels) ? animation.channels : [];
  animation.samplers = Array.isArray(animation.samplers) ? animation.samplers : [];
  json.accessors = Array.isArray(json.accessors) ? json.accessors : [];
  json.bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  json.buffers = Array.isArray(json.buffers) && json.buffers.length > 0 ? json.buffers : [{ byteLength: 0 }];

  const bufferParts = [];
  let currentOffset = Number(json.buffers[0]?.byteLength) || 0;

  for (const channel of pointerChannels) {
    const keyframes = Array.isArray(channel?.sampler?.keyframes) ? channel.sampler.keyframes : [];
    if (keyframes.length === 0) {
      continue;
    }

    const pointer = String(channel?.target?.pointer || '').trim();
    const valueType = String(channel?.target?.valueType || 'scalar') === 'vec3' ? 'VEC3' : 'SCALAR';
    const times = new Float32Array(keyframes.length);
    const values = new Float32Array(keyframes.length * (valueType === 'VEC3' ? 3 : 1));
    for (let index = 0; index < keyframes.length; index++) {
      times[index] = Number(keyframes[index]?.time) || 0;
      if (valueType === 'VEC3') {
        const vec = Array.isArray(keyframes[index]?.value) || ArrayBuffer.isView(keyframes[index]?.value)
          ? Array.from(keyframes[index].value).slice(0, 3)
          : [0, 0, 0];
        values[(index * 3) + 0] = Number(vec[0]) || 0;
        values[(index * 3) + 1] = Number(vec[1]) || 0;
        values[(index * 3) + 2] = Number(vec[2]) || 0;
      } else {
        values[index] = Number(keyframes[index]?.value) || 0;
      }
    }

    const inputAccessor = appendFloatAccessor(json, bufferParts, currentOffset, times, 'SCALAR');
    currentOffset += times.byteLength;
    const outputAccessor = appendFloatAccessor(json, bufferParts, currentOffset, values, valueType);
    currentOffset += values.byteLength;
    const samplerIndex = animation.samplers.length;
    animation.samplers.push({
      input: inputAccessor,
      output: outputAccessor,
      interpolation: String(channel?.sampler?.interpolation || 'LINEAR'),
    });
    animation.channels.push({
      sampler: samplerIndex,
      target: {
        extensions: {
          KHR_animation_pointer: {
            pointer,
          },
        },
      },
    });
  }

  if (bufferParts.length === 0) {
    return null;
  }

  json.buffers[0].byteLength = currentOffset;
  const extensionsUsed = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  extensionsUsed.add('KHR_animation_pointer');
  if (pointerChannels.some((channel) => String(channel?.target?.pointer || '').trim() === VRMA_LIGHT_COLOR_POINTER)) {
    extensionsUsed.add('KHR_lights_punctual');
  }
  json.extensionsUsed = Array.from(extensionsUsed);
  return concatUint8Arrays(bufferParts);
}

function appendFloatAccessor(json, bufferParts, byteOffset, values, type) {
  const bytes = new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
  bufferParts.push(bytes);
  const bufferViewIndex = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: bytes.byteLength,
  });
  const accessorIndex = json.accessors.length;
  json.accessors.push({
    bufferView: bufferViewIndex,
    componentType: 5126,
    count: type === 'VEC3' ? values.length / 3 : values.length,
    type,
  });
  return accessorIndex;
}

/**
 * expression 拡張 JSON を構築します。
 * @param {Map<string, object>} expressionDefinitions - expression 定義。
 * @param {Map<string, number>} nodeNameToIndex - node 名 -> index。
 * @returns {object|undefined} expressions 拡張。
 */
function buildVrmaExpressionsExtension(expressionDefinitions, nodeNameToIndex) {
  const preset = {};
  const custom = {};
  for (const definition of expressionDefinitions.values()) {
    const nodeIndex = nodeNameToIndex.get(String(definition?.nodeName || '').trim());
    if (!Number.isInteger(nodeIndex)) {
      continue;
    }
    const section = definition.expressionType === 'preset' ? preset : custom;
    section[definition.expressionName] = { node: nodeIndex };
  }
  if (Object.keys(preset).length === 0 && Object.keys(custom).length === 0) {
    return undefined;
  }
  return {
    ...(Object.keys(preset).length > 0 ? { preset } : {}),
    ...(Object.keys(custom).length > 0 ? { custom } : {}),
  };
}

/**
 * clip から VRMA expression 定義を集めます。
 * @param {object} clip - 対象 clip。
 * @returns {Map<string, object>} expression 定義。
 */
function collectVrmaExpressionDefinitions(clip) {
  const definitions = new Map();
  const metadataExpressions = clip?.metadata?.vrmAnimation?.expressions;
  if (metadataExpressions && typeof metadataExpressions === 'object') {
    for (const [expressionName, definition] of Object.entries(metadataExpressions)) {
      const normalizedExpressionName = String(expressionName || '').trim();
      if (!normalizedExpressionName) {
        continue;
      }
      definitions.set(normalizedExpressionName, {
        expressionName: normalizedExpressionName,
        expressionType: String(definition?.expressionType || definition?.type || 'custom') === 'preset' ? 'preset' : 'custom',
        nodeName: String(definition?.nodeName || `Expression_${normalizedExpressionName}`),
      });
    }
  }

  for (const channel of clip?.channels || []) {
    if (channel?.target?.kind !== 'morph') {
      continue;
    }
    const expressionName = String(channel?.target?.vrmaExpressionName || channel?.target?.name || '').trim();
    if (!expressionName || definitions.has(expressionName)) {
      continue;
    }
    definitions.set(expressionName, {
      expressionName,
      expressionType: String(channel?.target?.vrmaExpressionType || 'custom') === 'preset' ? 'preset' : 'custom',
      nodeName: String(channel?.target?.nodeName || `Expression_${expressionName}`),
    });
  }

  return definitions;
}

/**
 * morph channel から VRMA expression node 名を返します。
 * @param {object} channel - morph channel。
 * @returns {string} expression node 名。
 */
function getVrmaExpressionNodeName(channel) {
  const expressionName = String(channel?.target?.vrmaExpressionName || channel?.target?.name || '').trim();
  const explicitNodeName = String(channel?.target?.nodeName || '').trim();
  if (explicitNodeName && (!expressionName || explicitNodeName !== String(channel?.target?.name || '').trim())) {
    return explicitNodeName;
  }
  return expressionName ? `Expression_${expressionName}` : '';
}

/**
 * VRMA export warning を作成します。
 * @param {string} code - warning code。
 * @param {string} message - warning message。
 * @returns {{code: string, message: string}} warning。
 */
function createVrmaExportWarning(code, message) {
  return { code, message };
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
 * GLB の JSON を読み込みます。
 * @param {ArrayBuffer} input - GLB。
 * @returns {object} glTF JSON。
 */
function parseGlbJson(input) {
  const view = new DataView(input);
  const jsonChunkLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(input, 20, jsonChunkLength)).trimEnd());
}

/**
 * GLB を新しい JSON で再構築します。
 * @param {ArrayBuffer} input - 元 GLB。
 * @param {string} jsonText - 新しい JSON。
 * @returns {ArrayBuffer} 再構築済み GLB。
 */
function rebuildGlb(input, jsonText, extraBinary = null) {
  const chunks = parseGlbChunks(input);
  const normalizedExtraBinary = extraBinary instanceof Uint8Array ? extraBinary : null;
  const encodedChunks = chunks.map((chunk) => (
    chunk.type === 'JSON'
      ? createGlbChunk('JSON', new TextEncoder().encode(jsonText), 0x20)
      : chunk.type === 'BIN\0' && normalizedExtraBinary
        ? createGlbChunk(chunk.type, concatUint8Arrays([chunk.data, normalizedExtraBinary]), 0x00)
        : createGlbChunk(chunk.type, chunk.data, 0x00)
  ));
  if (normalizedExtraBinary && !chunks.some((chunk) => chunk.type === 'BIN\0')) {
    encodedChunks.push(createGlbChunk('BIN\0', normalizedExtraBinary, 0x00));
  }
  const totalLength = 12 + encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  writeAscii(bytes, 0, 'glTF');
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  let offset = 12;
  for (const chunk of encodedChunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * GLB チャンク一覧を返します。
 * @param {ArrayBuffer} input - GLB。
 * @returns {Array<{type: string, data: Uint8Array}>} チャンク一覧。
 */
function parseGlbChunks(input) {
  const view = new DataView(input);
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= input.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = readAscii(input, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > input.byteLength) {
      break;
    }
    chunks.push({
      type: chunkType,
      data: new Uint8Array(input.slice(dataStart, dataEnd)),
    });
    offset = dataEnd;
  }
  return chunks;
}

/**
 * GLB チャンクを構築します。
 * @param {string} type - チャンク種別。
 * @param {Uint8Array} data - データ。
 * @param {number} padByte - パディング値。
 * @returns {Uint8Array} 構築済みチャンク。
 */
function createGlbChunk(type, data, padByte) {
  const padding = (4 - (data.byteLength % 4)) % 4;
  const chunkLength = data.byteLength + padding;
  const chunk = new Uint8Array(8 + chunkLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunkLength, true);
  writeAscii(chunk, 4, type);
  chunk.set(data, 8);
  if (padding > 0) {
    chunk.fill(padByte, 8 + data.byteLength);
  }
  return chunk;
}

function concatUint8Arrays(items) {
  const totalLength = items.reduce((sum, item) => sum + item.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const item of items) {
    output.set(item, offset);
    offset += item.byteLength;
  }
  return output;
}

/**
 * ASCII を書き込みます。
 * @param {Uint8Array} target - 書き込み先。
 * @param {number} offset - 開始位置。
 * @param {string} value - 文字列。
 */
function writeAscii(target, offset, value) {
  for (let index = 0; index < value.length; index++) {
    target[offset + index] = value.charCodeAt(index) & 0xFF;
  }
}

/**
 * ASCII を読み込みます。
 * @param {ArrayBuffer} input - 元バイナリ。
 * @param {number} offset - 開始位置。
 * @param {number} length - 長さ。
 * @returns {string} ASCII。
 */
function readAscii(input, offset, length) {
  return new TextDecoder('ascii').decode(new Uint8Array(input, offset, length));
}

/**
 * track 名を path から構築します。
 * @param {string} targetName - target 名。
 * @param {string} path - path。
 * @returns {string} track 名。
 */
function createTrackName(targetName, path) {
  if (path === 'translation') {
    return `${targetName}.position`;
  }
  if (path === 'rotation') {
    return `${targetName}.quaternion`;
  }
  return `${targetName}.scale`;
}

/**
 * モデルから名前一致の bone を返します。
 * @param {object|null} model - モデル。
 * @param {string} boneName - bone 名。
 * @returns {object|null} 一致 bone。
 */
function findBoneByName(model, boneName) {
  const targetName = String(boneName || '').trim();
  if (!targetName) {
    return null;
  }
  return Array.isArray(model?.bones)
    ? model.bones.find((bone) => String(bone?.name || '').trim() === targetName) || null
    : null;
}

/**
 * ボーン名から index を返します。
 * @param {object|null} model - モデルデータ。
 * @param {string} boneName - bone 名。
 * @returns {number} 一致 index。見つからない場合は -1。
 */
function findBoneIndexByName(model, boneName) {
  const targetName = String(boneName || '').trim();
  if (!targetName || !Array.isArray(model?.bones)) {
    return -1;
  }
  return model.bones.findIndex((bone) => String(bone?.name || '').trim() === targetName);
}

function isVrmSyntheticAllParentBone(model, bone) {
  return String(model?.magic || '').trim() === 'Vrm'
    && String(bone?.name || '').trim() === '全ての親';
}

/**
 * vec3 値を正規化します。
 * @param {ArrayLike<number>|null|undefined} value - 入力値。
 * @param {number[]} fallback - 既定値。
 * @returns {number[]} 正規化済み値。
 */
function normalizeVector3(value, fallback) {
  return [
    Number(value?.[0]) || fallback[0],
    Number(value?.[1]) || fallback[1],
    Number(value?.[2]) || fallback[2],
  ];
}
