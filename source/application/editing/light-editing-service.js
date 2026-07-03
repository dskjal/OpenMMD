import { quaternionFromEulerXYZ } from '../../shared/math/math-utils.js';
import { applyLightManualPose, applyVmdLightKeyframesToLightObject, resolveLightKeyframePose, setLightManualPosition, setLightManualRotationQuaternion } from '../../core/scene/light-object.js';
import { extractLightKeyframesFromAnimationClip } from '../../core/animation/animation-clip.js';

/**
 * Creates the light editing application service.
 * @param {object} options - Service options.
 * @returns {object} Light editing service.
 */
export function createLightEditingService(options) {
  function applyPositionFromInputs() {
    const lightObject = options.rendererState?.lightObject;
    if (!lightObject) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController?.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return false;
    }

    const nextPosition = options.lightUiState.positionInputs.map((input, index) => {
      const fallback = lightObject.position[index] ?? 0;
      const parsed = Number.parseFloat(input?.value ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    });
    setLightManualPosition(lightObject, nextPosition, currentFrame);
    return true;
  }

  function applyRotationFromInputs() {
    const lightObject = options.rendererState?.lightObject;
    if (!lightObject) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController?.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return false;
    }

    const rotX = Number.parseFloat(options.lightUiState.rotationInputs[0]?.value ?? '');
    const rotY = Number.parseFloat(options.lightUiState.rotationInputs[1]?.value ?? '');
    const rotZ = Number.parseFloat(options.lightUiState.rotationInputs[2]?.value ?? '');
    if (!Number.isFinite(rotX) || !Number.isFinite(rotY) || !Number.isFinite(rotZ)) {
      return false;
    }

    const nextRotation = quaternionFromEulerXYZ([
      rotX * Math.PI / 180,
      rotY * Math.PI / 180,
      rotZ * Math.PI / 180,
    ]);
    setLightManualRotationQuaternion(lightObject, nextRotation, currentFrame);
    return true;
  }

  function applyMotionFromActiveInstance(activeInstance) {
    const lightObject = options.rendererState?.lightObject;
    if (!lightObject) {
      return false;
    }

    const currentFrame = options.timelineOrchestrationService?.getCurrentFrame?.() ?? activeInstance?.animationController?.currentFrame ?? 0;
    const lightSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('light') || null;
    const lightKeyframes = lightSource?.clip ? extractLightKeyframesFromAnimationClip(lightSource.clip) : [];
    if (!Array.isArray(lightKeyframes) || lightKeyframes.length === 0) {
      applyLightManualPose(lightObject, currentFrame);
      return false;
    }

    applyVmdLightKeyframesToLightObject(
      lightObject,
      lightKeyframes,
      currentFrame,
      options.rendererState.lightColor,
    );
    return true;
  }

  function registerKeyframe() {
    const lightObject = options.rendererState?.lightObject;
    if (!lightObject) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController?.currentFrame;
    const lightPose = resolveLightKeyframePose(lightObject, currentFrame, 'rotation');
    if (!lightPose) {
      return false;
    }

    return options.timelineOrchestrationService?.registerLightKeyframe?.({
      mode: 'rotation',
      color: options.rendererState.lightColor,
      position: lightPose.position,
      direction: lightPose.direction,
      rotation: lightPose.rotation,
    }) ?? false;
  }

  return {
    applyPositionFromInputs,
    applyRotationFromInputs,
    applyMotionFromActiveInstance,
    registerKeyframe,
  };
}
