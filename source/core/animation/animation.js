import { quat, vec3 } from '../../lib/esm/index.js';
import {
  ensureAnimationClip,
  extractCameraKeyframesFromAnimationClip,
  extractLightKeyframesFromAnimationClip,
  sampleAnimationChannelValue,
} from './animation-clip.js';
import { quaternionFromEulerXYZ, quaternionToEulerXYZ } from '../../shared/math/math-utils.js';

/**
 * VRM モデルの humanoid 名を実ボーン名へ解決します。
 * @param {object|null} model - モデルデータ。
 * @param {string} boneName - 解決対象のボーン名。
 * @returns {string} 実ボーン名。解決できない場合は元の名前。
 */
function resolveVrmBoneDisplayName(model, boneName) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!normalizedBoneName || model?.magic !== 'Vrm') {
    return normalizedBoneName;
  }

  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap;
  if (!humanoidBoneNameMap || typeof humanoidBoneNameMap !== 'object') {
    return normalizedBoneName;
  }

  return String(humanoidBoneNameMap[normalizedBoneName] || '').trim() || normalizedBoneName;
}

/**
 * AnimationController
 * Handles animation clip playback and interpolation for a specific model instance.
 */
export class AnimationController {
  /**
   * 
   * @param {*} model 
   * @param {*} morphController 
   * @param {int} fps アニメーション FPS
   */
  constructor(model, morphController, fps=120) {
    this.model = model;
    this.morphController = morphController;
    this.timelineFramePerMilliSec = 0.03;  // 現行タイムラインは 30 FPS
    this.timelineFps = 30;
    this.milliSecPerFrame = 1000 / fps;
    this.lastFrameTime = 0.0;
    this.vmd = null;
    this.animationClip = null;
    this.currentFrame = 0;
    this.isPlaying = false;
    this.loop = true;
    this.jumped = false;
    this.playbackRangeStart = 0;
    this.playbackRangeEnd = null;
    
    // Cache for optimized lookup
    // ... rest of constructor ...
    this.boneChannelMap = new Map(); // boneName -> target path map
    this.morphChannelMap = new Map(); // morphName -> weights channel
    this.resolvedBoneMappings = [];
    this.hasExplicitBoneMapping = false;
    this.cameraKeyframes = [];
    this.lightKeyframes = [];
    this.keyframesByFrame = [];
    this.maxFrame = 0;
    this.animationSourceKind = null;

    // Reuse objects to reduce GC pressure
    this._tempTranslation = vec3.create();
    this._tempTranslationA = vec3.create();
    this._tempBasisRotation = quat.create();
    this._tempRotation = quat.create();
    this._tempRotationA = quat.create();
    this._tempRotationB = quat.create();
    this._tempRotationC = quat.create();
    this._animationDebugPrevEulerBySourceBoneName = new Map();
    this._animationDebugLastFrame = null;
  }

  /**
   * Sets the VMD data to play.
   * @param {Object} vmd 
   */
  setVmd(vmd) {
    this.vmd = vmd;
    this.animationSourceKind = 'vmd';
    this.setAnimationClip(ensureAnimationClip(vmd));
  }

  /**
   * animation source を設定します。
   * @param {object|null} source - animation source。
   */
  setAnimationSource(source) {
    this.vmd = source?.kind === 'vmd' ? source?.data || null : null;
    this.animationSourceKind = String(source?.kind || source?.clip?.metadata?.sourceFormat || '').trim() || null;
    this.setAnimationClip(ensureAnimationClip(source?.clip || source?.data || source));
  }

  /**
   * Sets the generic animation clip to play.
   * @param {object|null} clip - animation clip.
   */
  setAnimationClip(clip) {
    this.animationClip = clip || null;
    this.animationSourceKind = String(clip?.metadata?.sourceFormat || '').trim() || null;
    this.currentFrame = 0;
    this.jumped = true;
    this.playbackRangeStart = 0;
    this.playbackRangeEnd = null;
    this.boneChannelMap.clear();
    this.morphChannelMap.clear();
    this.cameraKeyframes = [];
    this.lightKeyframes = [];
    this.keyframesByFrame = [];
    this.maxFrame = 0;
    this._animationDebugPrevEulerBySourceBoneName.clear();
    this._animationDebugLastFrame = null;

    if (!clip) return;

    this.timelineFps = Number.isFinite(clip.timelineFps) && clip.timelineFps > 0 ? clip.timelineFps : 30;
    for (const channel of clip.channels || []) {
      const target = channel?.target || {};
      const targetName = String(target.name || target.nodeName || '').trim();
      const path = String(target.path || '');
      if (!targetName) {
        continue;
      }
      if (target.kind === 'bone') {
        if (!this.boneChannelMap.has(targetName)) {
          this.boneChannelMap.set(targetName, {});
        }
        this.boneChannelMap.get(targetName)[path] = channel;
      } else if (target.kind === 'morph' && path === 'weights') {
        this.morphChannelMap.set(targetName, channel);
      }
      for (const keyframe of channel?.sampler?.keyframes || []) {
        const frameNum = Number.isFinite(keyframe?.frameNum)
          ? Math.round(keyframe.frameNum)
          : Math.round((Number(keyframe?.time) || 0) * this.timelineFps);
        this.keyframesByFrame.push(frameNum);
        if (frameNum > this.maxFrame) this.maxFrame = frameNum;
      }
    }

    const cameraKeyframes = extractCameraKeyframesFromAnimationClip(clip);
    this.cameraKeyframes = cameraKeyframes.slice().sort((a, b) => a.frameNum - b.frameNum);
    for (const keyframe of this.cameraKeyframes) {
      const frameNum = Number(keyframe.frameNum) || 0;
      this.keyframesByFrame.push(frameNum);
      if (frameNum > this.maxFrame) this.maxFrame = frameNum;
    }

    const lightKeyframes = extractLightKeyframesFromAnimationClip(clip);
    this.lightKeyframes = lightKeyframes.slice().sort((a, b) => a.frameNum - b.frameNum);
    for (const keyframe of this.lightKeyframes) {
      const frameNum = Number(keyframe.frameNum) || 0;
      this.keyframesByFrame.push(frameNum);
      if (frameNum > this.maxFrame) this.maxFrame = frameNum;
    }
    this.keyframesByFrame.sort((a, b) => a - b);
  }

  /**
   * 解決済み animation bone mapping を設定します。
   * @param {Array<object>|null} mappings - 解決済み mapping 一覧。
   */
  setBoneMappings(mappings) {
    this.resolvedBoneMappings = Array.isArray(mappings) ? mappings.map((mapping) => ({
      sourceKind: String(mapping?.sourceKind || '').trim(),
      debugSourceFormat: String(mapping?.debugSourceFormat || mapping?.sourceKind || '').trim(),
      sourceBoneName: String(mapping?.sourceBoneName || '').trim(),
      targetBoneName: String(mapping?.targetBoneName || '').trim(),
      targetBoneIndex: Number.isInteger(mapping?.targetBoneIndex) ? mapping.targetBoneIndex : -1,
      basisCorrectionQuaternion: Array.isArray(mapping?.basisCorrectionQuaternion) || ArrayBuffer.isView(mapping?.basisCorrectionQuaternion)
        ? Array.from(mapping.basisCorrectionQuaternion)
        : [0, 0, 0, 1],
      basisCorrectionInverseQuaternion: Array.isArray(mapping?.basisCorrectionInverseQuaternion) || ArrayBuffer.isView(mapping?.basisCorrectionInverseQuaternion)
        ? Array.from(mapping.basisCorrectionInverseQuaternion)
        : [0, 0, 0, 1],
      rotationOffsetQuaternion: Array.isArray(mapping?.rotationOffsetQuaternion) || ArrayBuffer.isView(mapping?.rotationOffsetQuaternion)
        ? Array.from(mapping.rotationOffsetQuaternion)
        : [0, 0, 0, 1],
      rotationFlipAxes: normalizeRotationFlipAxes(mapping?.rotationFlipAxes),
      vrmaBasisCorrectionQuaternion: Array.isArray(mapping?.vrmaBasisCorrectionQuaternion) || ArrayBuffer.isView(mapping?.vrmaBasisCorrectionQuaternion)
        ? Array.from(mapping.vrmaBasisCorrectionQuaternion)
        : [0, 0, 0, 1],
      vrmaBasisCorrectionInverseQuaternion: Array.isArray(mapping?.vrmaBasisCorrectionInverseQuaternion) || ArrayBuffer.isView(mapping?.vrmaBasisCorrectionInverseQuaternion)
        ? Array.from(mapping.vrmaBasisCorrectionInverseQuaternion)
        : [0, 0, 0, 1],
      targetApplyCorrectionQuaternion: Array.isArray(mapping?.targetApplyCorrectionQuaternion) || ArrayBuffer.isView(mapping?.targetApplyCorrectionQuaternion)
        ? Array.from(mapping.targetApplyCorrectionQuaternion)
        : [0, 0, 0, 1],
      targetApplyCorrectionInverseQuaternion: Array.isArray(mapping?.targetApplyCorrectionInverseQuaternion) || ArrayBuffer.isView(mapping?.targetApplyCorrectionInverseQuaternion)
        ? Array.from(mapping.targetApplyCorrectionInverseQuaternion)
        : [0, 0, 0, 1],
      vrmaRightLegPostCorrectionQuaternion: Array.isArray(mapping?.vrmaRightLegPostCorrectionQuaternion) || ArrayBuffer.isView(mapping?.vrmaRightLegPostCorrectionQuaternion)
        ? Array.from(mapping.vrmaRightLegPostCorrectionQuaternion)
        : [0, 0, 0, 1],
      vrmaUseWorldRestRetarget: Boolean(mapping?.vrmaUseWorldRestRetarget),
      sourceLocalRestRotation: Array.isArray(mapping?.sourceLocalRestRotation) || ArrayBuffer.isView(mapping?.sourceLocalRestRotation)
        ? Array.from(mapping.sourceLocalRestRotation)
        : [0, 0, 0, 1],
      sourceWorldRestRotation: Array.isArray(mapping?.sourceWorldRestRotation) || ArrayBuffer.isView(mapping?.sourceWorldRestRotation)
        ? Array.from(mapping.sourceWorldRestRotation)
        : [0, 0, 0, 1],
      targetLocalRestRotation: Array.isArray(mapping?.targetLocalRestRotation) || ArrayBuffer.isView(mapping?.targetLocalRestRotation)
        ? Array.from(mapping.targetLocalRestRotation)
        : [0, 0, 0, 1],
      targetWorldRestRotation: Array.isArray(mapping?.targetWorldRestRotation) || ArrayBuffer.isView(mapping?.targetWorldRestRotation)
        ? Array.from(mapping.targetWorldRestRotation)
        : [0, 0, 0, 1],
      rotationRetargetMode: String(
        mapping?.rotationRetargetMode
        || (String(mapping?.sourceKind || '').trim() === 'vrma' ? 'rest-pose' : 'direct-basis')
      ).trim() || 'direct-basis',
      applyTranslationFlipAxes: mapping?.applyTranslationFlipAxes === undefined
        ? String(mapping?.sourceKind || '').trim() === 'vmd'
        : Boolean(mapping?.applyTranslationFlipAxes),
      applyRotationFlipAxesInDirectMode: mapping?.applyRotationFlipAxesInDirectMode === undefined
        ? String(mapping?.sourceKind || '').trim() === 'vmd'
        : Boolean(mapping?.applyRotationFlipAxesInDirectMode),
      useBindTranslation: mapping?.useBindTranslation === undefined
        ? String(mapping?.sourceKind || '').trim() === 'vrma'
        : Boolean(mapping?.useBindTranslation),
      subtractTargetBaseTranslation: mapping?.subtractTargetBaseTranslation === undefined
        ? String(mapping?.sourceKind || '').trim() === 'vrma'
        : Boolean(mapping?.subtractTargetBaseTranslation),
      translationCorrectionQuaternion: Array.isArray(mapping?.translationCorrectionQuaternion) || ArrayBuffer.isView(mapping?.translationCorrectionQuaternion)
        ? Array.from(mapping.translationCorrectionQuaternion)
        : [0, 0, 0, 1],
      translationScale: Array.isArray(mapping?.translationScale) || ArrayBuffer.isView(mapping?.translationScale)
        ? Array.from(mapping.translationScale)
        : [1, 1, 1],
      translationOffset: Array.isArray(mapping?.translationOffset) || ArrayBuffer.isView(mapping?.translationOffset)
        ? Array.from(mapping.translationOffset)
        : [0, 0, 0],
      scaleOffset: Array.isArray(mapping?.scaleOffset) || ArrayBuffer.isView(mapping?.scaleOffset)
        ? Array.from(mapping.scaleOffset)
        : [1, 1, 1],
    })).filter((mapping) => (
      mapping.sourceBoneName
      && Number.isInteger(mapping.targetBoneIndex)
      && mapping.targetBoneIndex >= 0
    )) : [];
    this.hasExplicitBoneMapping = this.resolvedBoneMappings.length > 0;
  }

  play() {
    if (this.currentFrame < this.playbackRangeStart) {
      this.seek(this.playbackRangeStart);
    } else if (this.playbackRangeEnd !== null && this.currentFrame > this.playbackRangeEnd) {
      this.seek(this.playbackRangeStart);
    }
    this.isPlaying = true;
    this.lastFrameTime = Date.now();
  }

  stop() {
    this.isPlaying = false;
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
    return this.isPlaying;
  }

  /**
   * Seeks to a specific frame.
   * @param {number} frame 
   */
  seek(frame) {
    const targetFrame = Math.max(0, Number.isFinite(frame) ? frame : 0);
    
    // If we are jumping significantly or backwards, reset cache
    if (Math.abs(targetFrame - this.currentFrame) > 1 || targetFrame < this.currentFrame) {
      this._resetCacheIndices();
      this.jumped = true;
    }
    
    this.currentFrame = targetFrame;
    this.lastFrameTime = Date.now();
  }

  rewind() {
    this.seek(this.playbackRangeStart);
  }

  goToEnd() {
    this.seek(this.playbackRangeEnd !== null ? this.playbackRangeEnd : this.maxFrame);
  }

  /**
   * 再生範囲を設定します。
   * @param {number} start 再生開始フレーム。
   * @param {number|null} end 再生終了フレーム。未指定ならループ再生。
   * @returns {boolean} 現在フレームを範囲内に補正した場合は true。
   */
  setPlaybackRange(start, end = null) {
    const normalizedStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const normalizedEnd = Number.isFinite(end) ? Math.max(normalizedStart, end) : null;

    this.playbackRangeStart = normalizedStart;
    this.playbackRangeEnd = normalizedEnd;

    if (this.currentFrame < normalizedStart) {
      this.seek(normalizedStart);
      return true;
    }
    if (normalizedEnd !== null && this.currentFrame > normalizedEnd) {
      this.seek(normalizedEnd);
      return true;
    }
    return false;
  }

  /**
   * Advances/reverses the animation by n frames.
   * @param {number} n Delta frames
   */
  stepFrame(n) {
    this.seek(this.currentFrame + n);
  }

  /**
   * Moves the current frame to the next keyframe position across all bones and morphs.
   */
  stepNextKeyframe() {
    let nextFrame = Infinity;
    const current = this.currentFrame;
    for (const frameNum of this.keyframesByFrame) {
      if (frameNum > current + 0.01) {
        nextFrame = frameNum;
        break;
      }
    }

    if (nextFrame !== Infinity) {
      this.seek(nextFrame);
    }
  }

  /**
   * Moves the current frame to the previous keyframe position across all bones and morphs.
   */
  stepPreviousKeyframe() {
    let prevFrame = -1;
    const current = this.currentFrame;
    for (let i = this.keyframesByFrame.length - 1; i >= 0; i--) {
      const frameNum = this.keyframesByFrame[i];
      if (frameNum < current - 0.01) {
        prevFrame = frameNum;
        break;
      }
    }

    const target = prevFrame === -1 ? 0 : prevFrame;
    this.seek(target);
  }

  _resetCacheIndices() {
    // Generic sampler evaluation currently performs direct search, so cache reset is a no-op.
  }

  /**
   * Updates the animation state.
   * @param {number} deltaFrame Frames to advance
   * @param {Array} boneLocalTransforms The transforms to update
   * @param {(local: object) => void} markBoneLocalTransformDirty ローカル変換を dirty にするコールバック
   */
  update(deltaFrame, boneLocalTransforms, markBoneLocalTransformDirty = null, options = {}) {
    // 常にボーンをベースポーズにリセット
    for (let i = 0, len = boneLocalTransforms.length; i < len; i++) {
      const local = boneLocalTransforms[i];
      
      // 物理演算Mode 1（物理のみ）はリセットを完全にスキップ
      if (local.physicsMode === 1) continue;
      
      // AnimationController では VMD を適用するためのベースポーズ（恒等変換）にリセットする。
      // 手動変形（manualRotation/manualTranslation）は ModelManager.recomputeBoneMatrices で適用される。
      local.translation[0] = 0;
      local.translation[1] = 0;
      local.translation[2] = 0;
      
      // Mode 2 は回転のリセットをスキップ（物理演算の結果を維持するため）
      if (local.physicsMode !== 2) {
        local.rotation[0] = 0;
        local.rotation[1] = 0;
        local.rotation[2] = 0;
        local.rotation[3] = 1;
      }
      local.scale[0] = 1;
      local.scale[1] = 1;
      local.scale[2] = 1;
      
      if (typeof markBoneLocalTransformDirty === 'function') {
        markBoneLocalTransformDirty(local);
      }
    }

    if (Number.isFinite(options.currentFrame)) {
      this.currentFrame = Math.max(0, options.currentFrame);
    }
    if (typeof options.isPlaying === 'boolean') {
      this.isPlaying = options.isPlaying;
    }
    if (Number.isFinite(options.playbackRangeStart)) {
      this.playbackRangeStart = Math.max(0, options.playbackRangeStart);
    }
    if (options.playbackRangeEnd === null || Number.isFinite(options.playbackRangeEnd)) {
      this.playbackRangeEnd = options.playbackRangeEnd === null ? null : Math.max(this.playbackRangeStart, options.playbackRangeEnd);
    }
    if (typeof options.jumped === 'boolean') {
      this.jumped = options.jumped;
    }
    if (Number.isFinite(options.lastFrameTime)) {
      this.lastFrameTime = options.lastFrameTime;
    }

    if (options.skipPlaybackAdvance !== true && this.isPlaying) {
      // FPS 調整
      const now = Date.now();
      const elapsedTime = now - this.lastFrameTime;
      if (elapsedTime >= this.milliSecPerFrame) {
        this.lastFrameTime = now;

        const prevFrame = this.currentFrame;
        this.currentFrame += deltaFrame * elapsedTime * this.timelineFramePerMilliSec;
        const playbackStart = Math.max(0, this.playbackRangeStart);
        const playbackEnd = this.playbackRangeEnd !== null ? this.playbackRangeEnd : this.maxFrame;

        if (this.currentFrame < playbackStart) {
          this.currentFrame = playbackStart;
          this.jumped = true;
          this._resetCacheIndices();
        } else if (this.currentFrame > playbackEnd) {
          if (this.playbackRangeEnd !== null) {
            this.currentFrame = playbackEnd;
            this.isPlaying = false;
          } else if (this.loop) {
            const loopStart = playbackStart;
            const loopEnd = Math.max(loopStart, playbackEnd);
            const loopSpan = Math.max(loopEnd - loopStart, 1);
            this.currentFrame = loopStart + ((this.currentFrame - loopStart) % loopSpan);
            // On loop back, reset search indices
            if (this.currentFrame < prevFrame) {
              this.jumped = true;
              this._resetCacheIndices();
            }
          } else {
            this.currentFrame = playbackEnd;
            this.isPlaying = false;
          }
        }
      }
    }

    if (!this.animationClip) return;

    this.updateBones(boneLocalTransforms, markBoneLocalTransformDirty);
    this.updateMorphs();
  }

  /**
   * Applies VMD bone motions to the current local transforms.
   * @param {Array} boneLocalTransforms The transforms to update
   * @param {(local: object) => void} markBoneLocalTransformDirty ローカル変換を dirty にするコールバック
   */
  updateBones(boneLocalTransforms, markBoneLocalTransformDirty = null) {
    const currentTime = this.currentFrame / this.timelineFps;

    if (this.hasExplicitBoneMapping) {
      for (const mapping of this.resolvedBoneMappings) {
        const channels = this.boneChannelMap.get(mapping.sourceBoneName);
        if (!channels) {
          continue;
        }

        const local = boneLocalTransforms[mapping.targetBoneIndex];
        if (!local || local.physicsMode === 1) {
          continue;
        }

        const translationChannel = channels.translation || null;
        const translation = sampleAnimationChannelValue(translationChannel, currentTime) || [0, 0, 0];
        const rotation = sampleAnimationChannelValue(channels.rotation || null, currentTime) || [0, 0, 0, 1];
        const scale = sampleAnimationChannelValue(channels.scale || null, currentTime) || [1, 1, 1];
        if (translationChannel) {
          applyMappedBoneTranslation(this._tempTranslation, this._tempTranslationA, local, translation, mapping, translationChannel);
        }

        if (local.physicsMode !== 2) {
          applyMappedBoneRotation(
            this._tempRotation,
            this._tempBasisRotation,
            this._tempRotationA,
            this._tempRotationB,
            this._tempRotationC,
            rotation,
            mapping,
          );
          if (
            mapping.rotationRetargetMode === 'rest-pose'
            && String(this.model?.magic || '').trim() === 'Vrm'
            && String(this.model?.bones?.[mapping.targetBoneIndex]?.name || '').trim() === '全ての親'
          ) {
            quat.invert(this._tempBasisRotation, local.baseRotation || quat.create());
            quat.multiply(this._tempRotation, this._tempBasisRotation, this._tempRotation);
            quat.normalize(this._tempRotation, this._tempRotation);
          }
          quat.multiply(this._tempBasisRotation, mapping.targetApplyCorrectionQuaternion, this._tempRotation);
          quat.multiply(this._tempRotation, this._tempBasisRotation, mapping.targetApplyCorrectionInverseQuaternion);
          quat.normalize(this._tempRotation, this._tempRotation);
          local.rotation[0] = this._tempRotation[0];
          local.rotation[1] = this._tempRotation[1];
          local.rotation[2] = this._tempRotation[2];
          local.rotation[3] = this._tempRotation[3];
        }

        applyMappedBoneScale(local, scale, mapping);

        if (typeof markBoneLocalTransformDirty === 'function') {
          markBoneLocalTransformDirty(local);
        }
      }
      return;
    }

    const bones = this.model.bones;

    for (let i = 0, len = bones.length; i < len; i++) {
      const local = boneLocalTransforms[i];
      // 物理演算Mode 1（物理のみ）のボーンはアニメーションを適用しない
      if (local.physicsMode === 1) continue;

      const bone = bones[i];
      const name = (bone.name || "").trim();
      const channels = this.boneChannelMap.get(name);
      if (!channels) continue;
      const translation = sampleAnimationChannelValue(channels.translation || null, currentTime) || [0, 0, 0];
      const rotation = sampleAnimationChannelValue(channels.rotation || null, currentTime) || [0, 0, 0, 1];
      const scale = sampleAnimationChannelValue(channels.scale || null, currentTime) || [1, 1, 1];
      
      // Mode 1, 2 共通で移動は適用する（Mode 2 は位置追従のため）
      local.translation[0] = translation[0];
      local.translation[1] = translation[1];
      local.translation[2] = translation[2];
      
      // Mode 2 は回転の適用をスキップ（物理演算に任せる）
      if (local.physicsMode !== 2) {
        local.rotation[0] = rotation[0];
        local.rotation[1] = rotation[1];
        local.rotation[2] = rotation[2];
        local.rotation[3] = rotation[3];
      }
      local.scale[0] = scale[0];
      local.scale[1] = scale[1];
      local.scale[2] = scale[2];

      if (typeof markBoneLocalTransformDirty === 'function') {
        markBoneLocalTransformDirty(local);
      }
    }
  }

  updateMorphs() {
    if (!this.morphController) return;

    const morphs = this.model.morphs;
    const currentTime = this.currentFrame / this.timelineFps;

    for (let i = 0, len = morphs.length; i < len; i++) {
      const morph = morphs[i];
      const name = morph.name;
      const channel = this.morphChannelMap.get(name);
      if (!channel) continue;
      const weight = sampleAnimationChannelValue(channel, currentTime);
      this.morphController.setWeight(i, weight);
    }
  }

  /**
   * 現在フレームの raw animation rotation を Euler 表示用に列挙します。
   * VMD / VRMA の source rotation をそのままサンプルし、補正前の値を返します。
   * @returns {Array<object>} 表示用データ。
   */
  getAnimationDebugRotations() {
    if (this.boneChannelMap.size === 0) {
      return [];
    }

    const currentFrame = Number.isFinite(this.currentFrame) ? this.currentFrame : 0;
    if (this._animationDebugLastFrame === null || Math.abs(currentFrame - this._animationDebugLastFrame) > 1 || currentFrame < this._animationDebugLastFrame) {
      this._animationDebugPrevEulerBySourceBoneName.clear();
    }
    this._animationDebugLastFrame = currentFrame;

    const currentTime = currentFrame / this.timelineFps;
    const debugEntries = [];
    const mappings = Array.isArray(this.resolvedBoneMappings) ? this.resolvedBoneMappings : [];
    const sourceEntries = mappings.length > 0
      ? mappings.map((mapping) => ({
        sourceBoneName: String(mapping?.sourceBoneName || '').trim(),
        targetBoneName: String(mapping?.targetBoneName || '').trim(),
      }))
      : Array.from(this.boneChannelMap.keys()).map((sourceBoneName) => ({
        sourceBoneName,
        targetBoneName: sourceBoneName,
      }));

    for (const entry of sourceEntries) {
      if (!entry.sourceBoneName) {
        continue;
      }

      const channels = this.boneChannelMap.get(entry.sourceBoneName);
      const rotationChannel = channels?.rotation || null;
      if (!rotationChannel) {
        continue;
      }

      const rotation = sampleAnimationChannelValue(rotationChannel, currentTime) || [0, 0, 0, 1];
      const prevEuler = this._animationDebugPrevEulerBySourceBoneName.get(entry.sourceBoneName) || null;
      const euler = quaternionToEulerXYZ(rotation, prevEuler);
      this._animationDebugPrevEulerBySourceBoneName.set(entry.sourceBoneName, [...euler]);
      debugEntries.push({
        sourceBoneName: entry.sourceBoneName,
        targetBoneName: entry.targetBoneName || entry.sourceBoneName,
        displayTargetBoneName: resolveVrmBoneDisplayName(this.model, entry.targetBoneName || entry.sourceBoneName),
        rotation,
        euler,
      });
    }

    return debugEntries;
  }
}

/**
 * explicit bone mapping の translation を適用します。
 * @param {vec3} tempTranslation - 一時 translation。
 * @param {vec3} tempFlippedTranslation - 軸反転用の一時 translation。
 * @param {object} local - 適用先 local transform。
 * @param {ArrayLike<number>} translation - source translation。
 * @param {object} mapping - 解決済み mapping。
 * @param {object|null} [channel=null] - source translation channel。
 */
function applyMappedBoneTranslation(tempTranslation, tempFlippedTranslation, local, translation, mapping, channel = null) {
  const sourceTranslation = mapping.applyTranslationFlipAxes
    ? applyTranslationFlipAxes(tempFlippedTranslation, translation, mapping.rotationFlipAxes)
    : vec3.copy(tempFlippedTranslation, translation);
  if (mapping.useBindTranslation) {
    const bindTranslation = Array.isArray(channel?.target?.bindTranslation) || ArrayBuffer.isView(channel?.target?.bindTranslation)
      ? channel.target.bindTranslation
      : null;
    if (bindTranslation) {
      sourceTranslation[0] += Number(bindTranslation[0]) || 0;
      sourceTranslation[1] += Number(bindTranslation[1]) || 0;
      sourceTranslation[2] += Number(bindTranslation[2]) || 0;
    }
  }
  sourceTranslation[0] *= Number(mapping.translationScale?.[0]) || 1;
  sourceTranslation[1] *= Number(mapping.translationScale?.[1]) || 1;
  sourceTranslation[2] *= Number(mapping.translationScale?.[2]) || 1;
  vec3.transformQuat(tempTranslation, sourceTranslation, mapping.basisCorrectionQuaternion);
  if (mapping.subtractTargetBaseTranslation) {
    vec3.transformQuat(tempTranslation, tempTranslation, mapping.translationCorrectionQuaternion);
    tempTranslation[0] -= Number(local?.baseTranslation?.[0]) || 0;
    tempTranslation[1] -= Number(local?.baseTranslation?.[1]) || 0;
    tempTranslation[2] -= Number(local?.baseTranslation?.[2]) || 0;
  }
  local.translation[0] = tempTranslation[0] + (Number(mapping.translationOffset[0]) || 0);
  local.translation[1] = tempTranslation[1] + (Number(mapping.translationOffset[1]) || 0);
  local.translation[2] = tempTranslation[2] + (Number(mapping.translationOffset[2]) || 0);
}

/**
 * explicit bone mapping の rotation を source kind ごとに適用します。
 * @param {quat} out - 出力先 rotation。
 * @param {quat} tempBasis - 一時 quaternion。
 * @param {quat} tempA - 一時 quaternion A。
 * @param {quat} tempB - 一時 quaternion B。
 * @param {quat} tempC - 一時 quaternion C。
 * @param {ArrayLike<number>} rotation - source rotation。
 * @param {object} mapping - 解決済み mapping。
 */
function applyMappedBoneRotation(out, tempBasis, tempA, tempB, tempC, rotation, mapping) {
  if (mapping.rotationRetargetMode === 'rest-pose') {
    applyVrmaMappedBoneRotation(out, tempA, tempB, tempC, rotation, mapping);
    return;
  }
  applyDirectMappedBoneRotation(out, tempBasis, tempA, rotation, mapping);
}

/**
 * direct-basis explicit mapping の rotation を適用します。
 * @param {quat} out - 出力先 rotation。
 * @param {quat} tempBasis - 一時 quaternion。
 * @param {quat} tempRotation - 一時 quaternion。
 * @param {ArrayLike<number>} rotation - source rotation。
 * @param {object} mapping - 解決済み mapping。
 */
function applyDirectMappedBoneRotation(out, tempBasis, tempRotation, rotation, mapping) {
  const sourceRotation = mapping.applyRotationFlipAxesInDirectMode
    ? applyRotationFlipAxes(tempRotation, rotation, mapping.rotationFlipAxes)
    : quat.copy(tempRotation, rotation);
  quat.multiply(tempBasis, mapping.basisCorrectionQuaternion, sourceRotation);
  quat.multiply(out, tempBasis, mapping.basisCorrectionInverseQuaternion);
  quat.multiply(out, mapping.rotationOffsetQuaternion, out);
  quat.normalize(out, out);
}

/**
 * VMD -> VRM の再生時に各軸の回転向きを反転します。
 * @param {quat} out - 出力先 quaternion。
 * @param {ArrayLike<number>} rotation - 元 rotation。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationFlipAxes - 軸反転設定。
 * @returns {quat} 反転適用済み quaternion。
 */
function applyRotationFlipAxes(out, rotation, rotationFlipAxes) {
  if (!rotationFlipAxes?.x && !rotationFlipAxes?.y && !rotationFlipAxes?.z) {
    quat.copy(out, rotation);
    return out;
  }

  const euler = quaternionToEulerXYZ(rotation);
  if (rotationFlipAxes.x) {
    euler[0] = -euler[0];
  }
  if (rotationFlipAxes.y) {
    euler[1] = -euler[1];
  }
  if (rotationFlipAxes.z) {
    euler[2] = -euler[2];
  }
  quaternionFromEulerXYZ(euler, out);
  quat.normalize(out, out);
  return out;
}

/**
 * VMD -> VRM の再生時に各軸の移動向きを反転します。
 * @param {vec3} out - 出力先 translation。
 * @param {ArrayLike<number>} translation - 元 translation。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationFlipAxes - 軸反転設定。
 * @returns {vec3} 反転適用済み translation。
 */
function applyTranslationFlipAxes(out, translation, rotationFlipAxes) {
  out[0] = rotationFlipAxes?.x ? -(Number(translation?.[0]) || 0) : (Number(translation?.[0]) || 0);
  out[1] = rotationFlipAxes?.y ? -(Number(translation?.[1]) || 0) : (Number(translation?.[1]) || 0);
  out[2] = rotationFlipAxes?.z ? -(Number(translation?.[2]) || 0) : (Number(translation?.[2]) || 0);
  return out;
}

/**
 * 回転軸反転設定を正規化します。
 * @param {object|null|undefined} value - 入力値。
 * @returns {{x: boolean, y: boolean, z: boolean}} 正規化済み設定。
 */
function normalizeRotationFlipAxes(value) {
  return {
    x: Boolean(value?.x),
    y: Boolean(value?.y),
    z: Boolean(value?.z),
  };
}

/**
 * VRMA 系 explicit mapping の rotation を適用します。
 * @param {quat} out - 出力先 rotation。
 * @param {quat} tempA - 一時 quaternion A。
 * @param {quat} tempB - 一時 quaternion B。
 * @param {quat} tempC - 一時 quaternion C。
 * @param {ArrayLike<number>} rotation - source rotation。
 * @param {object} mapping - 解決済み mapping。
 */
function applyVrmaMappedBoneRotation(out, tempA, tempB, tempC, rotation, mapping) {
  applyVrmaMappedRotation(
    out,
    tempA,
    tempB,
    tempC,
    rotation,
    mapping.sourceLocalRestRotation,
    mapping.sourceWorldRestRotation,
    mapping.targetLocalRestRotation,
    mapping.targetWorldRestRotation,
    mapping.vrmaUseWorldRestRetarget,
    mapping.rotationFlipAxes,
    mapping.vrmaBasisCorrectionQuaternion,
    mapping.vrmaBasisCorrectionInverseQuaternion,
    mapping.rotationOffsetQuaternion,
    mapping.vrmaRightLegPostCorrectionQuaternion,
  );
}

/**
 * explicit bone mapping の scale を適用します。
 * @param {object} local - 適用先 local transform。
 * @param {ArrayLike<number>} scale - source scale。
 * @param {object} mapping - 解決済み mapping。
 */
function applyMappedBoneScale(local, scale, mapping) {
  local.scale[0] = scale[0] * (Number(mapping.scaleOffset[0]) || 1);
  local.scale[1] = scale[1] * (Number(mapping.scaleOffset[1]) || 1);
  local.scale[2] = scale[2] * (Number(mapping.scaleOffset[2]) || 1);
}

/**
 * VRMA の local rotation を target VRM の rest rotation へ変換して適用します。
 * @param {quat} out - 出力先。
 * @param {quat} tempA - 一時 quaternion A。
 * @param {quat} tempB - 一時 quaternion B。
 * @param {quat} tempC - 一時 quaternion C。
 * @param {ArrayLike<number>} rotation - source local rotation。
 * @param {ArrayLike<number>} sourceLocalRestRotation - source local rest rotation。
 * @param {ArrayLike<number>} sourceWorldRestRotation - source world rest rotation。
 * @param {ArrayLike<number>} targetLocalRestRotation - target local rest rotation。
 * @param {ArrayLike<number>} targetWorldRestRotation - target world rest rotation。
 * @param {boolean} vrmaUseWorldRestRetarget - body / leg 系では world rest ベースで retarget するかどうか。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationFlipAxes - 軸反転設定。
 * @param {ArrayLike<number>} vrmaBasisCorrectionQuaternion - VRMA semantic basis 補正。
 * @param {ArrayLike<number>} vrmaBasisCorrectionInverseQuaternion - VRMA semantic basis 補正の逆。
 * @param {ArrayLike<number>} rotationOffsetQuaternion - 追加の回転オフセット。
 * @param {ArrayLike<number>} vrmaRightLegPostCorrectionQuaternion - 右脚用の追加 post correction。
 * @returns {quat} 適用済み rotation。
 */
function applyVrmaMappedRotation(
  out,
  tempA,
  tempB,
  tempC,
  rotation,
  sourceLocalRestRotation,
  sourceWorldRestRotation,
  targetLocalRestRotation,
  targetWorldRestRotation,
  vrmaUseWorldRestRetarget,
  rotationFlipAxes,
  vrmaBasisCorrectionQuaternion,
  vrmaBasisCorrectionInverseQuaternion,
  rotationOffsetQuaternion,
  vrmaRightLegPostCorrectionQuaternion,
) {
  if (rotationFlipAxes?.x || rotationFlipAxes?.y || rotationFlipAxes?.z) {
    applyRotationFlipAxes(tempC, rotation, rotationFlipAxes);
  } else {
    quat.copy(tempC, rotation);
  }
  if (vrmaUseWorldRestRetarget) {
    quat.invert(tempA, sourceWorldRestRotation);
    quat.multiply(tempC, sourceWorldRestRotation, tempC);
    quat.multiply(tempC, tempC, tempA);
  } else {
    quat.invert(tempA, sourceLocalRestRotation);
    quat.multiply(tempB, tempA, tempC);
    quat.invert(tempA, sourceWorldRestRotation);
    quat.multiply(tempC, sourceWorldRestRotation, tempB);
    quat.multiply(tempC, tempC, tempA);
  }
  quat.multiply(tempB, vrmaBasisCorrectionQuaternion, tempC);
  quat.multiply(tempC, tempB, vrmaBasisCorrectionInverseQuaternion);

  quat.invert(tempA, targetWorldRestRotation);
  quat.multiply(tempB, tempA, tempC);
  quat.multiply(tempB, tempB, targetWorldRestRotation);
  if (vrmaUseWorldRestRetarget) {
    quat.copy(out, tempB);
  } else {
    quat.multiply(out, targetLocalRestRotation, tempB);
  }
  quat.multiply(out, rotationOffsetQuaternion, out);
  quat.multiply(out, out, vrmaRightLegPostCorrectionQuaternion);
  quat.normalize(out, out);
  return out;
}
