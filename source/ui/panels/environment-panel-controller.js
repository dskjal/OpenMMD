import { bindLinkedNumericInputs, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';
import { syncEnvironmentHdrIntensityInputBounds } from '../../shared/render/environment-hdr-utils.js';

/**
 * Installs the environment panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function}} Controller.
 */
export function installEnvironmentPanelController(options = {}) {
  const uiState = options.uiState ?? {};
  const service = options.service;
  const refreshScene = options.refreshScene ?? (() => {});
  const onValueApplied = options.onValueApplied ?? (() => {});

  const binding = bindLinkedNumericInputs({
    rangeInput: uiState.intensityRange,
    valueInput: uiState.intensityValue,
    fallbackValue: 1.0,
    getValue: () => service.getIntensity(),
    setValue: (nextValue) => {
      const appliedValue = service.applyIntensity(nextValue);
      onValueApplied(appliedValue);
      refreshScene();
    },
    sanitize: (value) => service.applyIntensity(value),
  });

  return {
    /**
     * Syncs the environment HDR UI from current state.
     */
    sync() {
      const intensity = service.getIntensity();
      const maxValue = options.getIntensityMax?.() ?? 1;
      if (uiState.nameLabel) {
        uiState.nameLabel.textContent = options.getDisplayName?.() ?? '';
      }
      syncEnvironmentHdrIntensityInputBounds(uiState.intensityRange, uiState.intensityValue, maxValue);
      syncNumericInputValue(uiState.intensityRange, intensity, { force: false });
      syncNumericInputValue(uiState.intensityValue, intensity, { force: false });
      binding?.syncFromValue?.(intensity, { forceValue: false, forceRange: false });
    },
  };
}
