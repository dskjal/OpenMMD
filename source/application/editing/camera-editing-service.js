import { vec3 } from '../../lib/esm/index.js';
import { findBoneIndexByName, getBone } from '../../core/model/model-scene.js';
import { createAxisAlignedCameraView, createCameraEye, createCameraRotation, setCameraManualFov, setCameraManualPose, setCameraManualView, clearCameraManualPose, applyCameraKeyframesToCamera } from '../../core/scene/camera.js';
import { extractCameraKeyframesFromAnimationClip } from '../../core/animation/animation-clip.js';

/**
 * Creates the camera editing application service.
 * @param {object} options - Service options.
 * @returns {object} Camera editing service.
 */
export function createCameraEditingService(options) {
  function applyPoseFromInputs() {
    const camera = options.camera;
    if (!camera) {
      return false;
    }

    const currentEye = createCameraEye(camera);
    const position = options.cameraUiState.positionInputs.map((input, index) => {
      const fallback = currentEye[index];
      const parsed = Number.parseFloat(input?.value ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    });
    const target = options.cameraUiState.targetInputs.map((input, index) => {
      const fallback = camera.center[index] ?? 0;
      const parsed = Number.parseFloat(input?.value ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    });
    const rollInput = Number.parseFloat(options.cameraUiState.rotationInputs[2]?.value ?? '');
    const roll = Number.isFinite(rollInput) ? rollInput * Math.PI / 180 : camera.roll ?? 0;
    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return false;
    }

    setCameraManualView(camera, position, target, roll, currentFrame);
    clearLookAtTarget();
    return true;
  }

  function applyRotationFromInputs() {
    const camera = options.camera;
    if (!camera) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return false;
    }

    const rotX = Number.parseFloat(options.cameraUiState.rotationInputs[0]?.value ?? '');
    const rotY = Number.parseFloat(options.cameraUiState.rotationInputs[1]?.value ?? '');
    const rotZ = Number.parseFloat(options.cameraUiState.rotationInputs[2]?.value ?? '');
    if (!Number.isFinite(rotX) || !Number.isFinite(rotY) || !Number.isFinite(rotZ)) {
      return false;
    }

    setCameraManualPose(
      camera,
      camera.center,
      camera.distance,
      -rotX * Math.PI / 180,
      rotY * Math.PI / 180,
      rotZ * Math.PI / 180,
      currentFrame,
    );
    clearLookAtTarget();
    return true;
  }

  /**
   * Applies a manual FOV value in degrees at the current frame.
   * @param {number} fovDegrees - Next FOV value in degrees.
   * @returns {boolean} True when applied.
   */
  function applyFovDegrees(fovDegrees) {
    const camera = options.camera;
    if (!camera || !Number.isFinite(fovDegrees)) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = options.timelineOrchestrationService?.getCurrentFrame?.()
      ?? activeInstance?.animationController?.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return false;
    }

    setCameraManualFov(camera, fovDegrees * Math.PI / 180, currentFrame);
    return true;
  }

  function getLookAtTargetPosition() {
    const modelManager = options.modelManager;
    const cameraUiState = options.cameraUiState;
    if (!modelManager || cameraUiState.selectedModelIndex < 0 || !cameraUiState.selectedBoneName) {
      return null;
    }

    const inst = modelManager.instances[cameraUiState.selectedModelIndex];
    if (!inst || !cameraUiState.selectedBoneName) {
      return null;
    }

    const boneIndex = findBoneIndexByName(inst.model, cameraUiState.selectedBoneName);
    if (boneIndex === -1) {
      return null;
    }

    return inst.scene.boneWorldPositions[boneIndex] || null;
  }

  function syncLookAtTarget() {
    const targetPosition = getLookAtTargetPosition();
    const camera = options.camera;
    if (!targetPosition || !camera) {
      return false;
    }

    vec3.copy(camera.center, targetPosition);
    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController.currentFrame;
    if (Number.isFinite(currentFrame)) {
      setCameraManualPose(camera, camera.center, camera.distance, camera.phi, camera.theta, camera.roll, currentFrame);
    }
    return true;
  }

  function applyViewShortcut(viewAxis, axisSign) {
    const camera = options.camera;
    const modelManager = options.modelManager;
    if (!camera || !modelManager) {
      return false;
    }

    const activeInstance = options.getActiveInstance();
    const currentFrame = activeInstance?.animationController?.currentFrame;
    if (!activeInstance || !Number.isFinite(currentFrame)) {
      return false;
    }

    const sceneBounds = activeInstance.aabb;
    if (!sceneBounds) {
      return false;
    }

    const aspect = options.getViewportCanvasAspect();
    const { eye, target } = createAxisAlignedCameraView(sceneBounds, camera, viewAxis, axisSign, aspect);
    setCameraManualView(camera, eye, target, 0, currentFrame);
    clearLookAtTarget();
    return true;
  }

  function resetManualPose() {
    if (!options.camera) {
      return false;
    }

    clearCameraManualPose(options.camera);
    return true;
  }

  function registerLookAtTarget(modelIndex, boneIndex) {
    const modelManager = options.modelManager;
    const camera = options.camera;
    if (!modelManager || !camera || modelIndex < 0 || boneIndex < 0) {
      return false;
    }

    const inst = modelManager.instances[modelIndex];
    const bone = getBone(inst?.model, boneIndex);
    if (!inst || !bone || !bone.name) {
      return false;
    }

    options.cameraUiState.selectedModelIndex = modelIndex;
    options.cameraUiState.selectedBoneName = bone.name;
    options.syncCameraModelOptions();
    options.syncCameraBoneOptions(inst);
    syncLookAtTarget();
    return true;
  }

  function clearLookAtTarget() {
    const modelManager = options.modelManager;
    const cameraUiState = options.cameraUiState;
    if (!modelManager || cameraUiState.selectedModelIndex < 0 || !cameraUiState.selectedBoneName) {
      return false;
    }

    const inst = modelManager.instances[cameraUiState.selectedModelIndex];
    if (!inst) {
      return false;
    }

    cameraUiState.selectedBoneName = '';
    options.syncCameraBoneOptions(inst);
    return true;
  }

  function isLookAtEnabled() {
    return Boolean(getLookAtTargetPosition());
  }

  function hasCameraKeyframes(activeInstance) {
    const cameraSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('camera') || null;
    return Boolean(
      cameraSource?.clip
      && extractCameraKeyframesFromAnimationClip(cameraSource.clip).length > 0
    );
  }

  function applyMotionFromActiveInstance(activeInstance) {
    const camera = options.camera;
    if (!camera) {
      return false;
    }

    const cameraSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('camera') || null;
    const currentFrame = options.timelineOrchestrationService?.getCurrentFrame?.() ?? activeInstance?.animationController?.currentFrame ?? 0;
    const cameraKeyframes = cameraSource?.clip ? extractCameraKeyframesFromAnimationClip(cameraSource.clip) : [];
    if (!Array.isArray(cameraKeyframes) || cameraKeyframes.length === 0) {
      return false;
    }

    applyCameraKeyframesToCamera(camera, cameraKeyframes, currentFrame);
    return true;
  }

  function registerKeyframe() {
    const inst = options.getActiveInstance();
    const camera = options.camera;
    if (!inst || !camera) {
      return false;
    }

    const targetPosition = getLookAtTargetPosition() || vec3.clone(camera.center);
    return options.timelineOrchestrationService?.registerCameraKeyframe?.({
      distance: camera.distance,
      target: targetPosition,
      rotation: createCameraRotation(camera),
      fov: camera.fovY * 180 / Math.PI,
      interpolation: null,
      perspective: 1,
    }) ?? false;
  }

  return {
    applyFovDegrees,
    applyPoseFromInputs,
    applyRotationFromInputs,
    getLookAtTargetPosition,
    syncLookAtTarget,
    applyViewShortcut,
    resetManualPose,
    registerLookAtTarget,
    clearLookAtTarget,
    isLookAtEnabled,
    hasCameraKeyframes,
    applyMotionFromActiveInstance,
    registerKeyframe,
  };
}
