import { quaternionToEulerXYZ } from '../../shared/math/math-utils.js';
import { bindLinkedNumericInputs, isNumericInputFocused, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';

/**
 * Returns whether any numeric input is focused.
 * @param {Array<HTMLInputElement|null>} inputs - Candidate inputs.
 * @returns {boolean} True when any input is focused.
 */
function isAnyNumericInputFocused(inputs) {
  return inputs.some((input) => isNumericInputFocused(input));
}

/**
 * Installs the light panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function}} Controller.
 */
export function installLightPanelController(options = {}) {
  const uiState = options.uiState ?? {};
  const lightService = options.lightService;
  const rendererState = options.rendererState;
  const getActiveInstance = options.getActiveInstance ?? (() => null);
  const timelineOrchestrationService = options.timelineOrchestrationService;
  const bindNumericInputs = options.bindLinkedNumericInputs ?? bindLinkedNumericInputs;
  const syncPostEffectParametersFromState = options.syncPostEffectParametersFromState ?? (() => {});
  const refreshScene = options.refreshScene ?? (() => {});

  uiState.positionInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      lightService?.applyPositionFromInputs?.();
      refreshScene();
    });
  });
  uiState.rotationInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      lightService?.applyRotationFromInputs?.();
      refreshScene();
    });
  });
  uiState.rotationKeyIcon?.addEventListener('click', () => {
    lightService?.registerKeyframe?.();
  });

  bindNumericInputs({
    rangeInput: uiState.gltfLightStrengthRange,
    valueInput: uiState.gltfLightStrengthValue,
    fallbackValue: 1.0,
    getValue: () => Number.isFinite(rendererState?.postEffects?.gltfLightStrength)
      ? rendererState.postEffects.gltfLightStrength
      : 1.0,
    setValue: (nextValue) => {
      rendererState.postEffects.gltfLightStrength = Math.min(
        rendererState.environmentHdrIntensityMax,
        Math.max(0.0, nextValue),
      );
      syncPostEffectParametersFromState();
      refreshScene();
    },
    sanitize: (value) => Math.min(rendererState.environmentHdrIntensityMax, Math.max(0.0, value)),
    format: (value) => Number(value).toFixed(3),
  });

  return {
    /**
     * Syncs the light panel UI from scene state.
     * @param {boolean} [forceStrengthSync=false] - Whether to override focused strength inputs.
     */
    sync(forceStrengthSync = false) {
      const lightObject = rendererState?.lightObject;
      if (!lightObject) {
        return;
      }

      const currentFrame = Math.round(
        timelineOrchestrationService?.getCurrentFrame?.()
        ?? getActiveInstance()?.animationController?.currentFrame
        ?? 0,
      );
      const lightSource = timelineOrchestrationService?.getSceneAnimationSource?.('light') || null;
      const lightKeyframes = lightSource?.clip
        ? options.extractLightKeyframesFromAnimationClip(lightSource.clip)
        : [];
      const positionBgColor = options.getLightKeyframeBackgroundColor?.(lightKeyframes, currentFrame, 'position') ?? '';
      const rotationBgColor = options.getLightKeyframeBackgroundColor?.(lightKeyframes, currentFrame, 'rotation') ?? '';

      if (uiState.positionInputs.length > 0) {
        options.setInputBackgroundColor?.(uiState.positionInputs, positionBgColor, true);
        for (let index = 0; index < uiState.positionInputs.length; index += 1) {
          const input = uiState.positionInputs[index];
          if (!input || isNumericInputFocused(input)) {
            continue;
          }
          syncNumericInputValue(input, Number(lightObject.position[index] ?? 0), {
            force: false,
            format: (value) => Number(value).toFixed(3),
          });
        }
      }

      const isRotationEditing = isAnyNumericInputFocused(uiState.rotationInputs);
      const euler = isRotationEditing && Array.isArray(uiState.rotationEuler)
        ? uiState.rotationEuler
        : quaternionToEulerXYZ(lightObject.rotation, uiState.prevEuler);
      uiState.rotationEuler = [euler[0], euler[1], euler[2]];
      uiState.prevEuler[0] = euler[0];
      uiState.prevEuler[1] = euler[1];
      uiState.prevEuler[2] = euler[2];
      options.setInputBackgroundColor?.(uiState.rotationInputs, rotationBgColor, true);
      for (let index = 0; index < uiState.rotationInputs.length; index += 1) {
        const input = uiState.rotationInputs[index];
        if (!input || isNumericInputFocused(input)) {
          continue;
        }
        syncNumericInputValue(input, Number(euler[index] ?? 0) * 180 / Math.PI, {
          force: false,
          format: (value) => Number(value).toFixed(1),
        });
      }

      const lightStrengthMax = rendererState.environmentHdrIntensityMax;
      const nextLightStrength = Math.min(
        lightStrengthMax,
        Math.max(0.0, Number.isFinite(rendererState.postEffects.gltfLightStrength) ? rendererState.postEffects.gltfLightStrength : 1.0),
      );
      if (uiState.gltfLightStrengthRange) {
        uiState.gltfLightStrengthRange.max = String(lightStrengthMax);
        if (forceStrengthSync || !isNumericInputFocused(uiState.gltfLightStrengthRange)) {
          syncNumericInputValue(uiState.gltfLightStrengthRange, nextLightStrength, {
            force: forceStrengthSync,
            format: (value) => Number(value).toFixed(3),
          });
        }
      }
      if (uiState.gltfLightStrengthValue) {
        uiState.gltfLightStrengthValue.max = String(lightStrengthMax);
        if (forceStrengthSync || !isNumericInputFocused(uiState.gltfLightStrengthValue)) {
          syncNumericInputValue(uiState.gltfLightStrengthValue, nextLightStrength, {
            force: forceStrengthSync,
            format: (value) => Number(value).toFixed(3),
          });
        }
      }

      uiState.lightColorPicker?.refresh?.();
    },
  };
}
