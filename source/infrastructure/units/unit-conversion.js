import { syncVmdAnimationClip } from '../../core/animation/animation-clip.js';
import { normalizeVmdLightKeyframe } from '../../core/scene/light-object.js';

export const MMD_LENGTH_TO_METERS_SCALE = 0.1;
export const METERS_TO_MMD_LENGTH_SCALE = 10.0;

/**
 * 3 要素ベクトルを倍率変換します。
 * @param {ArrayLike<number>|null|undefined} value - 入力値。
 * @param {number} scale - 倍率。
 * @returns {number[]|null} 変換結果。
 */
export function scaleVec3(value, scale) {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return null;
  }

  return [
    (Number(value[0]) || 0) * scale,
    (Number(value[1]) || 0) * scale,
    (Number(value[2]) || 0) * scale,
  ];
}

/**
 * VMD データを内部 meter 単位へ正規化します。
 * @param {object} vmd - VMD データ。
 * @returns {object} 正規化済み VMD。
 */
export function normalizeVmdToInternalUnits(vmd) {
  return scaleVmdDocument(vmd, MMD_LENGTH_TO_METERS_SCALE);
}

/**
 * VMD データを MMD 単位へ戻します。
 * @param {object} vmd - 内部 VMD データ。
 * @returns {object} MMD 単位の VMD。
 */
export function denormalizeVmdFromInternalUnits(vmd) {
  return scaleVmdDocument(vmd, METERS_TO_MMD_LENGTH_SCALE);
}

/**
 * VPD pose を内部 meter 単位へ正規化します。
 * @param {object} pose - VPD pose。
 * @returns {object} 正規化済み pose。
 */
export function normalizeVpdToInternalUnits(pose) {
  return scaleVpdPose(pose, MMD_LENGTH_TO_METERS_SCALE);
}

/**
 * VPD pose を MMD 単位へ戻します。
 * @param {object} pose - 内部 pose。
 * @returns {object} MMD 単位の pose。
 */
export function denormalizeVpdFromInternalUnits(pose) {
  return scaleVpdPose(pose, METERS_TO_MMD_LENGTH_SCALE);
}

/**
 * VMD ドキュメント内の長さ値を倍率変換します。
 * @param {object} vmd - VMD データ。
 * @param {number} scale - 倍率。
 * @returns {object} 変換結果。
 */
function scaleVmdDocument(vmd, scale) {
  const normalized = {
    signature: String(vmd?.signature || 'Vocaloid Motion Data 0002'),
    modelName: String(vmd?.modelName || 'Default'),
    boneKeyframes: Array.isArray(vmd?.boneKeyframes) ? vmd.boneKeyframes.map((keyframe) => ({
      ...keyframe,
      position: scaleVec3(keyframe?.position, scale) || [0, 0, 0],
    })) : [],
    faceKeyframes: Array.isArray(vmd?.faceKeyframes) ? vmd.faceKeyframes.map((keyframe) => ({ ...keyframe })) : [],
    cameraKeyframes: Array.isArray(vmd?.cameraKeyframes) ? vmd.cameraKeyframes.map((keyframe) => ({
      ...keyframe,
      distance: (Number(keyframe?.distance) || 0) * scale,
      target: scaleVec3(keyframe?.target, scale) || [0, 0, 0],
    })) : [],
    lightKeyframes: Array.isArray(vmd?.lightKeyframes) ? vmd.lightKeyframes.map((keyframe) => {
      const normalizedLightKeyframe = normalizeVmdLightKeyframe({
        ...keyframe,
        position: scaleVec3(keyframe?.position, scale),
      });
      return {
        ...normalizedLightKeyframe,
        position: null,
        keyedPosition: false,
      };
    }) : [],
    selfShadowKeyframes: Array.isArray(vmd?.selfShadowKeyframes)
      ? vmd.selfShadowKeyframes.map((keyframe) => ({ ...keyframe }))
      : [],
  };

  return syncVmdAnimationClip(normalized);
}

/**
 * VPD pose 内の長さ値を倍率変換します。
 * @param {object} pose - VPD pose。
 * @param {number} scale - 倍率。
 * @returns {object} 変換結果。
 */
function scaleVpdPose(pose, scale) {
  return {
    ...pose,
    bones: Array.isArray(pose?.bones) ? pose.bones.map((bone) => ({
      ...bone,
      position: scaleVec3(bone?.position, scale) || [0, 0, 0],
    })) : [],
  };
}
