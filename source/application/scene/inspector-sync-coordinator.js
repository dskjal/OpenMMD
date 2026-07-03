import { createCameraEye, createCameraRotation } from '../../core/scene/camera.js';
import { quaternionToEulerXYZ } from '../../shared/math/math-utils.js';
import { isNumericInputFocused, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';
import { replaceSelectOptions } from '../../ui/panels/inspector-select-ui.js';

/**
 * Returns whether any numeric input is currently focused.
 * @param {Array<HTMLInputElement|null>} inputs - Candidate inputs.
 * @returns {boolean} True when any input is focused.
 */
function isAnyNumericInputFocused(inputs) {
  return inputs.some((input) => isNumericInputFocused(input));
}

/**
 * Sets background colors and disabled state on a camera key icon.
 * @param {HTMLImageElement|null} icon - Target icon.
 * @param {boolean} enabled - Whether the icon is enabled.
 */
function setCameraUiIconState(icon, enabled) {
  if (!icon) {
    return;
  }
  icon.hidden = false;
  icon.classList.toggle('is-disabled', !enabled);
}

/**
 * Syncs a list of numeric inputs from a value array.
 * @param {Array<HTMLInputElement|null>} inputs - Target inputs.
 * @param {ArrayLike<number>} values - Source numeric values.
 * @param {number} fractionDigits - Display precision.
 */
function syncNumberInputs(inputs, values, fractionDigits) {
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (!input) {
      continue;
    }
    const nextValue = Number(values[index] ?? 0).toFixed(fractionDigits);
    if (!isNumericInputFocused(input) && input.value !== nextValue) {
      input.value = nextValue;
    }
  }
}

/**
 * Creates the inspector sync coordinator.
 * @param {object} options - Coordinator options.
 * @returns {{syncInspectorUi: function, syncCameraUiState: function, syncLightTabUi: function, syncCameraDebugUi: function}} Inspector sync coordinator.
 */
export function createInspectorSyncCoordinator(options) {
  /**
   * Returns the active instance resolved by the caller.
   * @returns {object|null} Active instance.
   */
  function getActiveInstance() {
    return options.getActiveInstance?.() ?? null;
  }

  /**
   * Returns the current localization data.
   * @returns {object} Current localization map.
   */
  function getLangData() {
    return options.getLangData?.() ?? {};
  }

  /**
   * Syncs the camera model selector options.
   */
  function syncCameraModelOptions() {
    const select = options.cameraUiState?.modelSelect;
    if (!select) {
      return;
    }

    const instances = options.modelManager ? options.modelManager.instances : [];
    const signature = instances.map((inst, index) => `${index}:${inst.model.name || `Model ${index}`}`).join('|');
    if (!instances.length) {
      options.cameraUiState.selectedModelIndex = -1;
      select.disabled = true;
      select.value = '';
      options.cameraUiState.lastModelSignature = signature;
      return;
    }

    const validIndex = Number.isInteger(options.cameraUiState.selectedModelIndex)
      && options.cameraUiState.selectedModelIndex >= 0
      && options.cameraUiState.selectedModelIndex < instances.length
      ? options.cameraUiState.selectedModelIndex
      : (options.selection.activeInstanceIndex >= 0 && options.selection.activeInstanceIndex < instances.length
        ? options.selection.activeInstanceIndex
        : 0);
    const desiredValue = String(validIndex);
    if (
      signature === options.cameraUiState.lastModelSignature
      && select.options.length === instances.length + 1
      && select.value === desiredValue
    ) {
      options.cameraUiState.selectedModelIndex = validIndex;
      return;
    }

    replaceSelectOptions({
      select,
      documentRef: options.documentRef,
      items: [
        { value: '', label: getLangData().None || 'None' },
        ...instances.map((inst, index) => ({
          value: String(index),
          label: inst.model.name || `Model ${index}`,
        })),
      ],
      value: desiredValue,
      disabled: false,
    });
    options.cameraUiState.selectedModelIndex = validIndex;
    options.cameraUiState.lastModelSignature = signature;
  }

  /**
   * Syncs the camera bone selector options.
   * @param {object|null} selectedModelInstance - Target model instance.
   */
  function syncCameraBoneOptions(selectedModelInstance) {
    const select = options.cameraUiState?.boneSelect;
    if (!select) {
      return;
    }

    const bones = selectedModelInstance ? selectedModelInstance.model.bones : [];
    const signature = `${options.cameraUiState.selectedModelIndex}:${bones.map((bone) => bone.name || '').join('|')}`;
    if (!bones.length) {
      options.cameraUiState.selectedBoneName = '';
      select.disabled = true;
      select.value = '';
      options.cameraUiState.lastBoneSignature = signature;
      return;
    }

    const resolvedName = options.cameraUiState.selectedBoneName === ''
      ? ''
      : (
        options.cameraUiState.selectedBoneName
        && options.findBoneIndexByName(selectedModelInstance.model, options.cameraUiState.selectedBoneName) !== -1
          ? options.cameraUiState.selectedBoneName
          : (options.getBone(selectedModelInstance.model, 0)?.name || '')
      );
    if (
      signature === options.cameraUiState.lastBoneSignature
      && select.options.length === bones.length + 1
      && select.value === resolvedName
    ) {
      options.cameraUiState.selectedBoneName = resolvedName;
      return;
    }

    replaceSelectOptions({
      select,
      documentRef: options.documentRef,
      items: [
        { value: '', label: getLangData().None || 'None' },
        ...bones.map((bone) => ({
          value: bone.name || '',
          label: bone.name || '',
        })),
      ],
      value: resolvedName,
      disabled: false,
    });
    options.cameraUiState.selectedBoneName = resolvedName;
    options.cameraUiState.lastBoneSignature = signature;
  }

  /**
   * Returns whether camera look-at follow is enabled.
   * @returns {boolean} True when enabled.
   */
  function isCameraLookAtEnabled() {
    return options.cameraService?.isLookAtEnabled?.() ?? false;
  }

  /**
   * Returns whether camera scene keyframes exist.
   * @param {object|null} activeInstance - Active instance.
   * @returns {boolean} True when keyed.
   */
  function hasCameraKeyframes(activeInstance) {
    return options.cameraService?.hasCameraKeyframes?.(activeInstance) ?? false;
  }

  /**
   * Syncs the camera look-at target into the current camera state.
   */
  function syncCameraLookAtTarget() {
    options.cameraService?.syncLookAtTarget?.();
  }

  /**
   * Syncs camera FOV inputs.
   * @param {object|null} activeInstance - Active instance.
   */
  function syncCameraFovInputs(activeInstance) {
    const rangeInput = options.cameraUiState?.fovRange;
    const valueInput = options.cameraUiState?.fovValue;
    if (!rangeInput && !valueInput) {
      return;
    }

    let bgColor = '';
    if (options.camera) {
      const currentFrame = Math.round(options.timelineOrchestrationService?.getCurrentFrame?.() ?? activeInstance?.animationController?.currentFrame ?? 0);
      const cameraSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('camera') || null;
      const cameraKeyframes = cameraSource?.clip
        ? options.extractCameraKeyframesFromAnimationClip(cameraSource.clip)
        : [];
      bgColor = options.getKeyframeBackgroundColor(cameraKeyframes, currentFrame);
    }

    options.setInputBackgroundColor([rangeInput, valueInput], bgColor, true);

    if (!options.camera) {
      return;
    }

    if (!Number.isFinite(options.camera.fovY)) {
      options.camera.fovY = 45 * Math.PI / 180;
    }

    const fovDegrees = options.camera.fovY * 180 / Math.PI;
    syncNumericInputValue(rangeInput, fovDegrees, {
      force: false,
      format: (value) => Number(value).toFixed(1),
    });
    syncNumericInputValue(valueInput, fovDegrees, {
      force: false,
      format: (value) => Number(value).toFixed(1),
    });
  }

  /**
   * Syncs camera position, rotation, and target inputs.
   * @param {object|null} activeInstance - Active instance.
   */
  function syncCameraPoseInputs(activeInstance) {
    const positionInputs = options.cameraUiState?.positionInputs ?? [];
    const rotationInputs = options.cameraUiState?.rotationInputs ?? [];
    const targetInputs = options.cameraUiState?.targetInputs ?? [];
    if ((!positionInputs.length && !rotationInputs.length && !targetInputs.length) || !options.camera) {
      return;
    }

    let bgColor = '';
    const currentFrame = Math.round(options.timelineOrchestrationService?.getCurrentFrame?.() ?? activeInstance?.animationController?.currentFrame ?? 0);
    const cameraSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('camera') || null;
    const cameraKeyframes = cameraSource?.clip
      ? options.extractCameraKeyframesFromAnimationClip(cameraSource.clip)
      : [];
    bgColor = options.getKeyframeBackgroundColor(cameraKeyframes, currentFrame);

    options.setInputBackgroundColor(positionInputs, bgColor, true);
    options.setInputBackgroundColor(rotationInputs, bgColor, true);
    options.setInputBackgroundColor(targetInputs, bgColor, true);

    const eye = createCameraEye(options.camera);
    const rotation = createCameraRotation(options.camera);
    syncNumberInputs(positionInputs, eye, 3);
    syncNumberInputs(rotationInputs, rotation.map((value) => value * 180 / Math.PI), 1);
    syncNumberInputs(targetInputs, options.camera.center, 3);
  }

  /**
   * Syncs the light inspector tab.
   * @param {boolean} [forceStrengthSync=false] - Whether to override focused strength inputs.
   */
  function syncLightTabUi(forceStrengthSync = false) {
    if (typeof options.syncLightPanelUi === 'function') {
      options.syncLightPanelUi(forceStrengthSync);
      return;
    }
    const lightObject = options.rendererState?.lightObject;
    if (!lightObject) {
      return;
    }

    const currentFrame = Math.round(options.timelineOrchestrationService?.getCurrentFrame?.() ?? getActiveInstance()?.animationController?.currentFrame ?? 0);
    const lightSource = options.timelineOrchestrationService?.getSceneAnimationSource?.('light') || null;
    const lightKeyframes = lightSource?.clip
      ? options.extractLightKeyframesFromAnimationClip(lightSource.clip)
      : [];
    const positionBgColor = options.getLightKeyframeBackgroundColor(lightKeyframes, currentFrame, 'position');
    const rotationBgColor = options.getLightKeyframeBackgroundColor(lightKeyframes, currentFrame, 'rotation');

    if (options.lightUiState.positionInputs.length > 0) {
      options.setInputBackgroundColor(options.lightUiState.positionInputs, positionBgColor, true);
      for (let index = 0; index < options.lightUiState.positionInputs.length; index += 1) {
        const input = options.lightUiState.positionInputs[index];
        if (!input || isNumericInputFocused(input)) {
          continue;
        }
        syncNumericInputValue(input, Number(lightObject.position[index] ?? 0), {
          force: false,
          format: (value) => Number(value).toFixed(3),
        });
      }
    }

    const isRotationEditing = isAnyNumericInputFocused(options.lightUiState.rotationInputs);
    const euler = isRotationEditing && Array.isArray(options.lightUiState.rotationEuler)
      ? options.lightUiState.rotationEuler
      : quaternionToEulerXYZ(lightObject.rotation, options.lightUiState.prevEuler);
    options.lightUiState.rotationEuler = [euler[0], euler[1], euler[2]];
    options.lightUiState.prevEuler[0] = euler[0];
    options.lightUiState.prevEuler[1] = euler[1];
    options.lightUiState.prevEuler[2] = euler[2];
    options.setInputBackgroundColor(options.lightUiState.rotationInputs, rotationBgColor, true);
    for (let index = 0; index < options.lightUiState.rotationInputs.length; index += 1) {
      const input = options.lightUiState.rotationInputs[index];
      if (!input || isNumericInputFocused(input)) {
        continue;
      }
      syncNumericInputValue(input, Number(euler[index] ?? 0) * 180 / Math.PI, {
        force: false,
        format: (value) => Number(value).toFixed(1),
      });
    }

    if (options.lightUiState.gltfLightStrengthRange || options.lightUiState.gltfLightStrengthValue) {
      const lightStrengthMax = options.rendererState.environmentHdrIntensityMax;
      const nextLightStrength = Math.min(
        lightStrengthMax,
        Math.max(
          0.0,
          Number.isFinite(options.rendererState.postEffects.gltfLightStrength)
            ? options.rendererState.postEffects.gltfLightStrength
            : 1.0,
        ),
      );
      if (options.lightUiState.gltfLightStrengthRange && (forceStrengthSync || !isNumericInputFocused(options.lightUiState.gltfLightStrengthRange))) {
        syncNumericInputValue(options.lightUiState.gltfLightStrengthRange, nextLightStrength, {
          force: forceStrengthSync,
          format: (value) => Number(value).toFixed(3),
        });
      }
      if (options.lightUiState.gltfLightStrengthValue && (forceStrengthSync || !isNumericInputFocused(options.lightUiState.gltfLightStrengthValue))) {
        syncNumericInputValue(options.lightUiState.gltfLightStrengthValue, nextLightStrength, {
          force: forceStrengthSync,
          format: (value) => Number(value).toFixed(3),
        });
      }
    }

    options.lightUiState.lightColorPicker?.refresh?.();
  }

  /**
   * Syncs camera inspector controls and state.
   * @param {object|null} activeInstance - Active instance.
   */
  function syncCameraUiState(activeInstance) {
    syncCameraModelOptions();

    const selectedModelInstance = options.modelManager && options.cameraUiState.selectedModelIndex >= 0
      ? options.modelManager.instances[options.cameraUiState.selectedModelIndex] || null
      : null;
    const hasActiveInstance = Boolean(activeInstance);
    syncCameraBoneOptions(selectedModelInstance);
    syncCameraFovInputs(activeInstance);
    syncCameraPoseInputs(activeInstance);
    if (options.cameraUiState.boneFollowLabel) {
      options.cameraUiState.boneFollowLabel.classList.toggle('is-disabled', !isCameraLookAtEnabled());
    }
    ['front', 'back', 'left', 'right', 'top'].forEach((key) => {
      const button = options.cameraUiState.viewShortcutButtons[key];
      if (button) {
        button.disabled = !hasActiveInstance;
      }
    });
    setCameraUiIconState(options.cameraUiState.fovKeyIcon, Boolean(getActiveInstance()));
    setCameraUiIconState(options.cameraUiState.boneKeyIcon, isCameraLookAtEnabled());
    setCameraUiIconState(options.cameraUiState.positionKeyIcon, Boolean(getActiveInstance()));
    setCameraUiIconState(options.cameraUiState.rotationKeyIcon, Boolean(getActiveInstance()));
    setCameraUiIconState(options.cameraUiState.targetKeyIcon, Boolean(getActiveInstance()));
    if (!hasCameraKeyframes(activeInstance) && isCameraLookAtEnabled()) {
      syncCameraLookAtTarget();
    }
  }

  /**
   * Syncs camera debug output.
   */
  function syncCameraDebugUi() {
    const clickedMouseOutput = options.clickedMousePositionUiState.output;
    if (clickedMouseOutput) {
      if (
        Number.isFinite(options.clickedMousePositionUiState.clientX)
        && Number.isFinite(options.clickedMousePositionUiState.clientY)
        && Number.isFinite(options.clickedMousePositionUiState.canvasX)
        && Number.isFinite(options.clickedMousePositionUiState.canvasY)
      ) {
        clickedMouseOutput.textContent = [
          `Client: ${options.clickedMousePositionUiState.clientX.toFixed(1)}, ${options.clickedMousePositionUiState.clientY.toFixed(1)}`,
          `Canvas: ${options.clickedMousePositionUiState.canvasX.toFixed(1)}, ${options.clickedMousePositionUiState.canvasY.toFixed(1)}`,
        ].join('\n');
      } else {
        clickedMouseOutput.textContent = 'No click recorded.';
      }
    }

    const output = options.cameraDebugUiState.output;
    if (!output) {
      return;
    }

    if (!options.camera) {
      output.textContent = 'Camera debug data is not available.';
      return;
    }

    const eye = createCameraEye(options.camera);
    const clipPlanes = options.camera.clipPlanes || { near: 0.1, far: 1000.0 };
    const toDeg = (value) => value * 180 / Math.PI;
    output.textContent = [
      `Eye:      ${eye.map((value) => value.toFixed(3)).join(', ')}`,
      `Center:   ${options.camera.center.map((value) => value.toFixed(3)).join(', ')}`,
      `Distance: ${options.camera.distance.toFixed(3)}`,
      `Phi:      ${toDeg(options.camera.phi).toFixed(3)} deg`,
      `Theta:    ${toDeg(options.camera.theta).toFixed(3)} deg`,
      `Roll:     ${toDeg(options.camera.roll ?? 0).toFixed(3)} deg`,
      `FOV:      ${toDeg(options.camera.fovY).toFixed(3)} deg`,
      `Clip:     near ${clipPlanes.near.toFixed(3)} / far ${clipPlanes.far.toFixed(3)}`,
    ].join('\n');
  }

  /**
   * Syncs the full inspector UI.
   */
  function syncInspectorUi() {
    const activeInstance = getActiveInstance();
    if (!activeInstance) {
      options.syncBoneInspectorUi?.(null, getLangData());
      syncCameraUiState(null);
      syncLightTabUi();
      syncCameraDebugUi();
      options.syncBoneDebugUi?.();
      options.syncAnimationDebugUi?.();
      options.syncBloomShadowDebugUi?.();
      return;
    }

    options.updateSelectedBoneLabel?.(activeInstance.model, activeInstance.scene, options.selection, getLangData());
    options.updateSelectedRigidbodyLabel?.(activeInstance.model, options.selection, getLangData());
    options.syncMorphSliders?.(activeInstance.morphController, options.activeMorphIndices);
    options.syncBoneInspectorUi?.(activeInstance, getLangData());
    syncCameraUiState(activeInstance);
    syncLightTabUi();
    syncCameraDebugUi();
    options.syncBoneDebugUi?.();
    options.syncAnimationDebugUi?.();
    options.syncBloomShadowDebugUi?.();
  }

  return {
    syncInspectorUi,
    syncCameraUiState,
    syncLightTabUi,
    syncCameraDebugUi,
  };
}
