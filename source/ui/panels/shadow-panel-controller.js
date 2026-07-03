import {
  bindLinkedNumericInputs,
} from '../../shared/ui/numeric-input-utils.js';

/**
 * Installs the shadow panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function, dispose: function}} Controller.
 */
export function installShadowPanelController(options = {}) {
  const uiState = options.uiState ?? {};
  const service = options.service;
  const onShadowChanged = options.onShadowChanged ?? (() => {});
  const onPostEffectChanged = options.onPostEffectChanged ?? (() => {});
  const restoreNumericInputValueIfInvalid = options.restoreNumericInputValueIfInvalid ?? (() => {});
  const syncBloomShadowDebugUi = options.syncBloomShadowDebugUi ?? (() => {});
  const rebuildShadowResources = options.rebuildShadowResources ?? (() => {});

  /**
   * Syncs a range/value pair.
   * @param {HTMLInputElement|null} rangeInput - Range input.
   * @param {HTMLInputElement|null} valueInput - Number input.
   * @param {number} value - Source value.
   */
  function syncPair(rangeInput, valueInput, value) {
    const nextValue = String(value);
    if (rangeInput && rangeInput.value !== nextValue) {
      rangeInput.value = nextValue;
    }
    if (valueInput && valueInput.value !== nextValue) {
      valueInput.value = nextValue;
    }
  }

  bindLinkedNumericInputs({
    rangeInput: uiState.shadowPowerRange,
    valueInput: uiState.shadowPowerValue,
    fallbackValue: 1.0,
    getValue: () => service.getShadowState().shadowPower,
    setValue: (nextValue) => {
      syncPair(uiState.shadowPowerRange, uiState.shadowPowerValue, service.setShadowPower(nextValue));
      onShadowChanged();
    },
    sanitize: (value) => Math.min(10.0, Math.max(1.0, value)),
  }).syncFromValue(service.getShadowState().shadowPower, { forceValue: true, forceRange: true });

  const bindPostEffectPair = (rangeInput, valueInput, fallbackValue, getter, setter, min, max, round = false) => {
    syncPair(rangeInput, valueInput, getter());
    bindLinkedNumericInputs({
      rangeInput,
      valueInput,
      fallbackValue,
      parse: round ? (text) => Number.parseInt(text, 10) : Number.parseFloat,
      getValue: getter,
      setValue: (nextValue) => {
        syncPair(rangeInput, valueInput, setter(nextValue));
        onPostEffectChanged();
      },
      sanitize: (value) => {
        const normalized = round ? Math.round(value) : value;
        return Math.min(max, Math.max(min, normalized));
      },
      format: round ? (value) => String(Math.round(value)) : (value) => String(value),
    }).syncFromValue(getter(), { forceValue: true, forceRange: true });
  };

  bindPostEffectPair(
    uiState.ambientOcclusionRadiusRange,
    uiState.ambientOcclusionRadiusValue,
    service.getPostEffectState().ambientOcclusionRadius,
    () => service.getPostEffectState().ambientOcclusionRadius,
    (value) => service.setAmbientOcclusionRadius(value),
    0.0,
    2.0,
  );
  bindPostEffectPair(
    uiState.ambientOcclusionBiasRange,
    uiState.ambientOcclusionBiasValue,
    service.getPostEffectState().ambientOcclusionBias,
    () => service.getPostEffectState().ambientOcclusionBias,
    (value) => service.setAmbientOcclusionBias(value),
    0.0,
    0.1,
  );
  bindPostEffectPair(
    uiState.ambientOcclusionIntensityRange,
    uiState.ambientOcclusionIntensityValue,
    service.getPostEffectState().ambientOcclusionIntensity,
    () => service.getPostEffectState().ambientOcclusionIntensity,
    (value) => service.setAmbientOcclusionIntensity(value),
    0.0,
    10.0,
  );
  bindPostEffectPair(
    uiState.ambientOcclusionBlurAmountRange,
    uiState.ambientOcclusionBlurAmountValue,
    service.getPostEffectState().ambientOcclusionBlurAmount,
    () => service.getPostEffectState().ambientOcclusionBlurAmount,
    (value) => service.setAmbientOcclusionBlurAmount(value),
    0.0,
    4.0,
  );
  bindPostEffectPair(
    uiState.ambientOcclusionSampleCountRange,
    uiState.ambientOcclusionSampleCountValue,
    service.getPostEffectState().ambientOcclusionSampleCount,
    () => service.getPostEffectState().ambientOcclusionSampleCount,
    (value) => service.setAmbientOcclusionSampleCount(value),
    1,
    32,
    true,
  );
  bindPostEffectPair(
    uiState.contactShadowLengthRange,
    uiState.contactShadowLengthValue,
    service.getPostEffectState().contactShadowLength,
    () => service.getPostEffectState().contactShadowLength,
    (value) => service.setContactShadowLength(value),
    0.0,
    1.0,
  );
  bindPostEffectPair(
    uiState.contactShadowThicknessRange,
    uiState.contactShadowThicknessValue,
    service.getPostEffectState().contactShadowThickness,
    () => service.getPostEffectState().contactShadowThickness,
    (value) => service.setContactShadowThickness(value),
    0.0,
    0.1,
  );
  bindPostEffectPair(
    uiState.contactShadowIntensityRange,
    uiState.contactShadowIntensityValue,
    service.getPostEffectState().contactShadowIntensity,
    () => service.getPostEffectState().contactShadowIntensity,
    (value) => service.setContactShadowIntensity(value),
    0.0,
    2.0,
  );
  bindPostEffectPair(
    uiState.contactShadowBlurAmountRange,
    uiState.contactShadowBlurAmountValue,
    service.getPostEffectState().contactShadowBlurAmount,
    () => service.getPostEffectState().contactShadowBlurAmount,
    (value) => service.setContactShadowBlurAmount(value),
    0.0,
    4.0,
  );
  bindPostEffectPair(
    uiState.contactShadowStepCountRange,
    uiState.contactShadowStepCountValue,
    service.getPostEffectState().contactShadowStepCount,
    () => service.getPostEffectState().contactShadowStepCount,
    (value) => service.setContactShadowStepCount(value),
    1,
    32,
    true,
  );

  const handleShadowBiasInput = () => {
    service.setShadowBias(Number.parseFloat(uiState.shadowBiasInput?.value));
    onShadowChanged();
  };
  const handleEdgeOpacityInput = () => {
    service.setShadowEdgeOpacity(Number.parseFloat(uiState.edgeOpacityInput?.value));
    onShadowChanged();
  };
  const handleShadowStrengthInput = () => {
    service.setShadowStrength(Number.parseFloat(uiState.shadowStrengthInput?.value));
    onShadowChanged();
  };
  const handleShowCascadeChange = (event) => {
    service.setShowCascadeShadowMaps(event.target.checked);
  };
  const handleBloomShadowDebugChange = () => {
    service.setShowBloomShadowDebug(Boolean(uiState.bloomShadowDebugCheckbox?.checked));
    service.setBloomShadowDebugMode(Number.parseInt(uiState.bloomShadowDebugModeSelect?.value || '0', 10));
    syncBloomShadowDebugUi();
  };
  const handleShadowMapSizeChange = (event) => {
    const nextSize = Number.parseInt(event.target.value, 10);
    service.setShadowMapSize(nextSize);
    rebuildShadowResources(nextSize);
  };
  const handleShadowFarAutoChange = (event) => {
    service.setShadowFarAuto(event.target.checked);
    sync();
  };
  const handleShadowFarInput = (event) => {
    service.setShadowFar(Number.parseFloat(event.target.value));
  };
  const handleAoEnabledChange = (event) => {
    service.setAmbientOcclusionEnabled(event.target.checked);
    sync();
    onPostEffectChanged();
  };
  const handleContactShadowEnabledChange = (event) => {
    service.setContactShadowEnabled(event.target.checked);
    sync();
    onPostEffectChanged();
  };

  uiState.shadowBiasInput?.addEventListener('input', handleShadowBiasInput);
  uiState.shadowBiasInput?.addEventListener('blur', () => {
    restoreNumericInputValueIfInvalid(uiState.shadowBiasInput, service.getShadowState().shadowBias);
  });
  uiState.edgeOpacityInput?.addEventListener('input', handleEdgeOpacityInput);
  uiState.edgeOpacityInput?.addEventListener('blur', () => {
    restoreNumericInputValueIfInvalid(uiState.edgeOpacityInput, service.getShadowState().shadowEdgeOpacity);
  });
  uiState.shadowStrengthInput?.addEventListener('input', handleShadowStrengthInput);
  uiState.shadowStrengthInput?.addEventListener('blur', () => {
    restoreNumericInputValueIfInvalid(uiState.shadowStrengthInput, service.getShadowState().shadowStrength);
  });
  uiState.showCascadeShadowMapsCheckbox?.addEventListener('change', handleShowCascadeChange);
  uiState.bloomShadowDebugCheckbox?.addEventListener('change', handleBloomShadowDebugChange);
  uiState.bloomShadowDebugModeSelect?.addEventListener('change', handleBloomShadowDebugChange);
  uiState.shadowMapSizeSelector?.addEventListener('change', handleShadowMapSizeChange);
  uiState.shadowFarAutoCheckbox?.addEventListener('change', handleShadowFarAutoChange);
  uiState.shadowFarSlider?.addEventListener('input', handleShadowFarInput);
  uiState.ambientOcclusionEnabledInput?.addEventListener('change', handleAoEnabledChange);
  uiState.contactShadowEnabledInput?.addEventListener('change', handleContactShadowEnabledChange);

  function sync() {
    const shadowState = service.getShadowState();
    const postEffects = service.getPostEffectState();
    syncPair(uiState.shadowPowerRange, uiState.shadowPowerValue, shadowState.shadowPower);
    if (uiState.shadowBiasInput) {
      uiState.shadowBiasInput.value = String(shadowState.shadowBias);
    }
    if (uiState.edgeOpacityInput) {
      uiState.edgeOpacityInput.value = String(shadowState.shadowEdgeOpacity);
    }
    if (uiState.shadowStrengthInput) {
      uiState.shadowStrengthInput.value = String(shadowState.shadowStrength);
    }
    if (uiState.showCascadeShadowMapsCheckbox) {
      uiState.showCascadeShadowMapsCheckbox.checked = Boolean(options.getShowCascadeShadowMaps?.());
    }
    if (uiState.bloomShadowDebugCheckbox) {
      uiState.bloomShadowDebugCheckbox.checked = Boolean(options.getShowBloomShadowDebug?.());
    }
    if (uiState.bloomShadowDebugModeSelect) {
      uiState.bloomShadowDebugModeSelect.value = String(options.getBloomShadowDebugMode?.() ?? 0);
    }
    if (uiState.shadowMapSizeSelector) {
      uiState.shadowMapSizeSelector.value = String(options.getShadowMapSize?.());
    }
    if (uiState.shadowFarAutoCheckbox) {
      uiState.shadowFarAutoCheckbox.checked = Boolean(options.getShadowFarAuto?.());
    }
    if (uiState.shadowFarSlider) {
      uiState.shadowFarSlider.disabled = Boolean(options.getShadowFarAuto?.());
      uiState.shadowFarSlider.value = String(options.getShadowFar?.());
    }
    if (uiState.ambientOcclusionEnabledInput) {
      uiState.ambientOcclusionEnabledInput.checked = Boolean(postEffects.ambientOcclusionEnabled);
    }
    if (uiState.contactShadowEnabledInput) {
      uiState.contactShadowEnabledInput.checked = Boolean(postEffects.contactShadowEnabled);
    }
    const aoEnabled = Boolean(postEffects.ambientOcclusionEnabled);
    [
      uiState.ambientOcclusionRadiusRange,
      uiState.ambientOcclusionRadiusValue,
      uiState.ambientOcclusionBiasRange,
      uiState.ambientOcclusionBiasValue,
      uiState.ambientOcclusionIntensityRange,
      uiState.ambientOcclusionIntensityValue,
      uiState.ambientOcclusionBlurAmountRange,
      uiState.ambientOcclusionBlurAmountValue,
      uiState.ambientOcclusionSampleCountRange,
      uiState.ambientOcclusionSampleCountValue,
    ].forEach((input) => {
      if (input) {
        input.disabled = !aoEnabled;
      }
    });
    const contactShadowEnabled = Boolean(postEffects.contactShadowEnabled);
    [
      uiState.contactShadowLengthRange,
      uiState.contactShadowLengthValue,
      uiState.contactShadowThicknessRange,
      uiState.contactShadowThicknessValue,
      uiState.contactShadowIntensityRange,
      uiState.contactShadowIntensityValue,
      uiState.contactShadowBlurAmountRange,
      uiState.contactShadowBlurAmountValue,
      uiState.contactShadowStepCountRange,
      uiState.contactShadowStepCountValue,
    ].forEach((input) => {
      if (input) {
        input.disabled = !contactShadowEnabled;
      }
    });
  }

  sync();
  return {
    sync,
    dispose() {},
  };
}
