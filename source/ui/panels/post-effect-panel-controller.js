import { bindLinkedNumericInputs, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';

/**
 * Installs the post-effect panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function, syncColorTemperatureInput: function, colorTemperaturePickButton: HTMLButtonElement|null, dispose: function}} Controller.
 */
export function installPostEffectPanelController(options = {}) {
  const uiState = options.uiState ?? {};
  const service = options.service;
  const onChanged = options.onChanged ?? (() => {});
  const onColorTemperaturePickToggle = options.onColorTemperaturePickToggle ?? (() => {});
  const syncNumericInputBounds = options.syncNumericInputBounds ?? (() => {});
  const includeShadowControls = options.includeShadowControls !== false;
  const defaults = service.getDefaults?.() ?? {};
  const postEffects = service.getState?.() ?? {};
  const bloomThresholdMax = service.getBloomThresholdMax?.() ?? 1;
  syncNumericInputBounds(uiState.bloomThresholdRange, uiState.bloomThresholdValue, bloomThresholdMax);

  /**
   * Binds one clamped numeric pair to the post-effect state.
   * @param {object} binding - Binding options.
   * @returns {object|null} Binding handle.
   */
  function bindClampedNumericPair(binding) {
    const {
      rangeInput,
      valueInput,
      stateKey,
      fallbackValue,
      min,
      max,
      roundToInteger = false,
      sanitizeOnInput = true,
      inputSync = null,
    } = binding;
    if (!rangeInput && !valueInput) {
      return null;
    }

    const bindingHandle = bindLinkedNumericInputs({
      rangeInput,
      valueInput,
      parse: roundToInteger ? (text) => Number.parseInt(text, 10) : Number.parseFloat,
      sanitize: (value) => service.setNumber(stateKey, value, min, max, roundToInteger),
      sanitizeOnInput,
      inputSync,
      format: roundToInteger ? (value) => String(Math.round(value)) : (value) => String(value),
      fallbackValue: typeof fallbackValue === 'function' ? fallbackValue : () => fallbackValue,
      getValue: () => service.getValue(stateKey, typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue, {
        min,
        max,
        roundToInteger,
      }),
      setValue: (nextValue) => {
        if (sanitizeOnInput) {
          service.setNumber(stateKey, nextValue, min, max, roundToInteger);
        } else {
          postEffects[stateKey] = nextValue;
        }
        onChanged();
      },
    });

    const initialValue = service.getValue(stateKey, typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue, {
      min,
      max,
      roundToInteger,
    });
    postEffects[stateKey] = initialValue;
    bindingHandle.syncFromValue(initialValue, { forceValue: true, forceRange: true });
    return bindingHandle;
  }

  uiState.bloomEnabledCheckbox?.addEventListener('change', (event) => {
    service.setBoolean('bloomEnabled', event.target.checked);
    onChanged();
  });
  uiState.dofEnabledCheckbox?.addEventListener('change', (event) => {
    service.setBoolean('dofEnabled', event.target.checked);
    onChanged();
  });
  if (includeShadowControls) {
    uiState.ambientOcclusionEnabledCheckbox?.addEventListener('change', (event) => {
      service.setBoolean('ambientOcclusionEnabled', event.target.checked);
      onChanged();
    });
    uiState.contactShadowEnabledCheckbox?.addEventListener('change', (event) => {
      service.setBoolean('contactShadowEnabled', event.target.checked);
      onChanged();
    });
  }
  uiState.sssEnabledCheckbox?.addEventListener('change', (event) => {
    service.setBoolean('sssEnabled', event.target.checked);
    onChanged();
  });
  uiState.colorTemperaturePickButton?.addEventListener('click', () => {
    onColorTemperaturePickToggle();
  });
  uiState.colorTemperaturePickButton?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onColorTemperaturePickToggle();
  });

  bindClampedNumericPair({
    rangeInput: uiState.colorTemperatureRange,
    valueInput: uiState.colorTemperatureValue,
    stateKey: 'colorTemperature',
    fallbackValue: defaults.colorTemperature,
    min: 1000.0,
    max: 40000.0,
    sanitizeOnInput: false,
    inputSync: {
      forceValue: false,
      forceRange: false,
    },
  });
  uiState.colorTemperatureRange?.setAttribute('defer-number-input-sync', '');
  bindClampedNumericPair({
    rangeInput: uiState.bloomThresholdRange,
    valueInput: uiState.bloomThresholdValue,
    stateKey: 'bloomThreshold',
    fallbackValue: () => postEffects.bloomThreshold,
    min: 0.0,
    max: bloomThresholdMax,
  });
  bindClampedNumericPair({
    rangeInput: uiState.gammaRange,
    valueInput: uiState.gammaValue,
    stateKey: 'gamma',
    fallbackValue: () => postEffects.gamma,
    min: 0.1,
    max: 4.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.chromaticAberrationRange,
    valueInput: uiState.chromaticAberrationValue,
    stateKey: 'chromaticAberration',
    fallbackValue: defaults.chromaticAberration,
    min: 0.0,
    max: 1.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.filmGrainAmountRange,
    valueInput: uiState.filmGrainAmountValue,
    stateKey: 'filmGrainAmount',
    fallbackValue: defaults.filmGrainAmount,
    min: 0.0,
    max: 1.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.bloomBlurRange,
    valueInput: uiState.bloomBlurValue,
    stateKey: 'bloomBlurAmount',
    fallbackValue: () => postEffects.bloomBlurAmount,
    min: 0.0,
    max: 8.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.bloomAlphaRange,
    valueInput: uiState.bloomAlphaValue,
    stateKey: 'bloomAlpha',
    fallbackValue: defaults.bloomAlpha,
    min: 0.0,
    max: 1.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.bloomShadowMultiplierRange,
    valueInput: uiState.bloomShadowMultiplierValue,
    stateKey: 'bloomShadowMultiplier',
    fallbackValue: defaults.bloomShadowMultiplier,
    min: 0.0,
    max: 1.0,
  });
  if (includeShadowControls) {
    bindClampedNumericPair({
      rangeInput: uiState.ambientOcclusionRadiusRange,
      valueInput: uiState.ambientOcclusionRadiusValue,
      stateKey: 'ambientOcclusionRadius',
      fallbackValue: defaults.ambientOcclusionRadius,
      min: 0.0,
      max: 2.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.ambientOcclusionBiasRange,
      valueInput: uiState.ambientOcclusionBiasValue,
      stateKey: 'ambientOcclusionBias',
      fallbackValue: defaults.ambientOcclusionBias,
      min: 0.0,
      max: 0.1,
    });
    bindClampedNumericPair({
      rangeInput: uiState.ambientOcclusionIntensityRange,
      valueInput: uiState.ambientOcclusionIntensityValue,
      stateKey: 'ambientOcclusionIntensity',
      fallbackValue: defaults.ambientOcclusionIntensity,
      min: 0.0,
      max: 10.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.ambientOcclusionBlurAmountRange,
      valueInput: uiState.ambientOcclusionBlurAmountValue,
      stateKey: 'ambientOcclusionBlurAmount',
      fallbackValue: defaults.ambientOcclusionBlurAmount,
      min: 0.0,
      max: 4.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.ambientOcclusionSampleCountRange,
      valueInput: uiState.ambientOcclusionSampleCountValue,
      stateKey: 'ambientOcclusionSampleCount',
      fallbackValue: defaults.ambientOcclusionSampleCount,
      min: 1,
      max: 32,
      roundToInteger: true,
    });
    bindClampedNumericPair({
      rangeInput: uiState.contactShadowLengthRange,
      valueInput: uiState.contactShadowLengthValue,
      stateKey: 'contactShadowLength',
      fallbackValue: defaults.contactShadowLength,
      min: 0.0,
      max: 1.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.contactShadowThicknessRange,
      valueInput: uiState.contactShadowThicknessValue,
      stateKey: 'contactShadowThickness',
      fallbackValue: defaults.contactShadowThickness,
      min: 0.0,
      max: 0.1,
    });
    bindClampedNumericPair({
      rangeInput: uiState.contactShadowIntensityRange,
      valueInput: uiState.contactShadowIntensityValue,
      stateKey: 'contactShadowIntensity',
      fallbackValue: defaults.contactShadowIntensity,
      min: 0.0,
      max: 2.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.contactShadowBlurAmountRange,
      valueInput: uiState.contactShadowBlurAmountValue,
      stateKey: 'contactShadowBlurAmount',
      fallbackValue: defaults.contactShadowBlurAmount,
      min: 0.0,
      max: 4.0,
    });
    bindClampedNumericPair({
      rangeInput: uiState.contactShadowStepCountRange,
      valueInput: uiState.contactShadowStepCountValue,
      stateKey: 'contactShadowStepCount',
      fallbackValue: defaults.contactShadowStepCount,
      min: 1,
      max: 32,
      roundToInteger: true,
    });
  }
  bindClampedNumericPair({
    rangeInput: uiState.dofFStopRange,
    valueInput: uiState.dofFStopValue,
    stateKey: 'dofFStop',
    fallbackValue: defaults.dofFStop,
    min: 0.1,
    max: 32.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.sssRadiusRange,
    valueInput: uiState.sssRadiusValue,
    stateKey: 'sssRadius',
    fallbackValue: defaults.sssRadius,
    min: 0.0,
    max: 8.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.sssDepthThresholdRange,
    valueInput: uiState.sssDepthThresholdValue,
    stateKey: 'sssDepthThreshold',
    fallbackValue: defaults.sssDepthThreshold,
    min: 0.0,
    max: 0.1,
  });
  bindClampedNumericPair({
    rangeInput: uiState.sssNormalThresholdRange,
    valueInput: uiState.sssNormalThresholdValue,
    stateKey: 'sssNormalThreshold',
    fallbackValue: defaults.sssNormalThreshold,
    min: 0.0,
    max: 1.0,
  });
  bindClampedNumericPair({
    rangeInput: uiState.sssStrengthRange,
    valueInput: uiState.sssStrengthValue,
    stateKey: 'sssStrength',
    fallbackValue: defaults.sssStrength,
    min: 0.0,
    max: 1.0,
  });

  if (uiState.filmGrainAnimationModeAlwaysInput || uiState.filmGrainAnimationModeTimelineInput) {
    const setFilmGrainAnimationMode = (mode) => {
      service.setString('filmGrainAnimationMode', mode, defaults.filmGrainAnimationMode);
      if (uiState.filmGrainAnimationModeAlwaysInput) {
        uiState.filmGrainAnimationModeAlwaysInput.checked = mode === 'always';
      }
      if (uiState.filmGrainAnimationModeTimelineInput) {
        uiState.filmGrainAnimationModeTimelineInput.checked = mode === 'timeline';
      }
    };
    setFilmGrainAnimationMode(postEffects.filmGrainAnimationMode ?? defaults.filmGrainAnimationMode);
    uiState.filmGrainAnimationModeAlwaysInput?.addEventListener('change', (event) => {
      if (event.target.checked) {
        setFilmGrainAnimationMode('always');
        onChanged();
      }
    });
    uiState.filmGrainAnimationModeTimelineInput?.addEventListener('change', (event) => {
      if (event.target.checked) {
        setFilmGrainAnimationMode('timeline');
        onChanged();
      }
    });
  }

  uiState.dofAlgorithmSelect?.addEventListener('change', (event) => {
    service.setString('dofAlgorithm', event.target.value, defaults.dofAlgorithm);
    onChanged();
  });
  uiState.dofAlgorithmSelect && (uiState.dofAlgorithmSelect.value = postEffects.dofAlgorithm ?? defaults.dofAlgorithm);

  /**
   * Syncs the color temperature inputs from state.
   * @param {number} [value=postEffects.colorTemperature] - Next color temperature.
   * @param {boolean} [force=false] - Whether to override focused input state.
   */
  function syncColorTemperatureInput(value = postEffects.colorTemperature, force = false) {
    const nextValue = Number.isFinite(value) ? value : postEffects.colorTemperature;
    syncNumericInputValue(uiState.colorTemperatureRange, nextValue, { force });
    syncNumericInputValue(uiState.colorTemperatureValue, nextValue, { force });
  }

  return {
    colorTemperaturePickButton: uiState.colorTemperaturePickButton,
    syncColorTemperatureInput,
    sync() {
      if (uiState.bloomEnabledCheckbox) {
        uiState.bloomEnabledCheckbox.checked = Boolean(postEffects.bloomEnabled);
      }
      if (uiState.dofEnabledCheckbox) {
        uiState.dofEnabledCheckbox.checked = Boolean(postEffects.dofEnabled);
      }
      if (includeShadowControls && uiState.ambientOcclusionEnabledCheckbox) {
        uiState.ambientOcclusionEnabledCheckbox.checked = Boolean(postEffects.ambientOcclusionEnabled);
      }
      if (includeShadowControls && uiState.contactShadowEnabledCheckbox) {
        uiState.contactShadowEnabledCheckbox.checked = Boolean(postEffects.contactShadowEnabled);
      }
      if (uiState.sssEnabledCheckbox) {
        uiState.sssEnabledCheckbox.checked = Boolean(postEffects.sssEnabled);
      }
      if (uiState.dofAlgorithmSelect) {
        uiState.dofAlgorithmSelect.value = postEffects.dofAlgorithm ?? defaults.dofAlgorithm;
      }
      syncColorTemperatureInput(postEffects.colorTemperature, true);
      syncNumericInputValue(uiState.gammaRange, postEffects.gamma, { force: true });
    },
    dispose() {},
  };
}
