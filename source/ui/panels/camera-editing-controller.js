/**
 * Installs camera editing DOM event handlers.
 * @param {object} options - Controller options.
 */
export function installCameraEditingController(options) {
  const {
    cameraUiState,
    refreshScene,
    bindLinkedNumericInputs,
    cameraService,
    camera,
    CAMERA_FOV_MIN,
    CAMERA_FOV_MAX,
  } = options;

  cameraUiState.modelSelect?.addEventListener('change', (event) => {
    const nextIndex = Number.parseInt(event.target.value, 10);
    if (!Number.isInteger(nextIndex)) {
      cameraUiState.selectedModelIndex = -1;
      cameraUiState.selectedBoneName = '';
      options.syncCameraModelOptions();
      options.syncCameraBoneOptions(null);
      return;
    }

    const inst = options.modelManager.instances[nextIndex] || null;
    cameraUiState.selectedModelIndex = nextIndex;
    const currentBoneName = cameraUiState.selectedBoneName;
    if (!currentBoneName || options.findBoneIndexByName(inst?.model, currentBoneName) === -1) {
      cameraUiState.selectedBoneName = inst && inst.model.bones.length > 0 ? (options.getBone(inst.model, 0)?.name || '') : '';
    }
    options.syncCameraBoneOptions(inst);
  });
  cameraUiState.boneSelect?.addEventListener('change', (event) => {
    cameraUiState.selectedBoneName = event.target.value || '';
    cameraService.syncLookAtTarget();
    refreshScene();
  });
  bindLinkedNumericInputs({
    rangeInput: cameraUiState.fovRange,
    valueInput: cameraUiState.fovValue,
    fallbackValue: 45,
    getValue: () => Number.isFinite(camera?.fovY) ? camera.fovY * 180 / Math.PI : 45,
    setValue: (nextValue) => {
      const applied = cameraService.applyFovDegrees?.(
        Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, nextValue)),
      );
      if (applied) {
        refreshScene();
      }
    },
    sanitize: (value) => Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV_MIN, Number(value) || 45)),
  });
  cameraUiState.positionInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      cameraService.applyPoseFromInputs();
      refreshScene();
    });
  });
  cameraUiState.targetInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      cameraService.applyPoseFromInputs();
      refreshScene();
    });
  });
  cameraUiState.rotationInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      cameraService.applyRotationFromInputs();
      refreshScene();
    });
  });
  cameraUiState.viewShortcutButtons.front?.addEventListener('click', () => {
    cameraService.applyViewShortcut('z', 1);
    refreshScene();
  });
  cameraUiState.viewShortcutButtons.back?.addEventListener('click', () => {
    cameraService.applyViewShortcut('z', -1);
    refreshScene();
  });
  cameraUiState.viewShortcutButtons.left?.addEventListener('click', () => {
    cameraService.applyViewShortcut('x', 1);
    refreshScene();
  });
  cameraUiState.viewShortcutButtons.right?.addEventListener('click', () => {
    cameraService.applyViewShortcut('x', -1);
    refreshScene();
  });
  cameraUiState.viewShortcutButtons.top?.addEventListener('click', () => {
    cameraService.applyViewShortcut('y', 1);
    refreshScene();
  });
  cameraUiState.viewShortcutButtons.reset?.addEventListener('click', () => {
    cameraService.resetManualPose();
    refreshScene();
  });
  cameraUiState.fovKeyIcon?.addEventListener('click', () => {
    cameraService.registerKeyframe();
  });
  cameraUiState.boneKeyIcon?.addEventListener('click', () => {
    cameraService.registerKeyframe();
  });
  document.querySelectorAll('.camera-state-key-icon').forEach((icon) => {
    icon.addEventListener('click', () => {
      cameraService.registerKeyframe();
    });
  });
}
