/**
 * Installs the display settings controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function, dispose: function}} Controller.
 */
export function installDisplaySettingsController(options = {}) {
  const uiState = options.uiState ?? {};
  const service = options.service;
  const applyDisplayPreset = options.applyDisplayPreset ?? (async () => {});

  const handleFpsChange = (event) => {
    service?.applyRenderingFps?.(Number.parseInt(event.target.value, 10));
  };
  const handleViewTransformChange = () => {
    const nextValue = service?.applyViewTransform?.(uiState.viewTransformSelector?.value);
    if (uiState.viewTransformSelector && typeof nextValue === 'string') {
      uiState.viewTransformSelector.value = nextValue;
    }
    options.onViewTransformChanged?.();
  };
  const handleDisplayPresetChange = (event) => {
    void applyDisplayPreset(event.target.value).catch((error) => {
      console.error('Failed to apply display preset.', error);
    });
  };
  const handleDisplayColorSpaceChange = () => {
    const nextValue = options.applyDisplayColorSpace?.(uiState.displayColorSpaceSelector?.value)
      ?? service?.applyDisplayColorSpace?.(uiState.displayColorSpaceSelector?.value);
    if (uiState.displayColorSpaceSelector && typeof nextValue === 'string') {
      uiState.displayColorSpaceSelector.value = nextValue;
    }
    options.onDisplayColorSpaceChanged?.();
  };
  const handleAaChange = (event) => {
    void options.onAaModeChanged?.(event.target.value, uiState.aaSelector);
  };

  uiState.fpsSelector?.addEventListener('change', handleFpsChange);
  uiState.viewTransformSelector?.addEventListener('change', handleViewTransformChange);
  uiState.displayPresetSelector?.addEventListener('change', handleDisplayPresetChange);
  uiState.displayColorSpaceSelector?.addEventListener('change', handleDisplayColorSpaceChange);
  uiState.aaSelector?.addEventListener('change', handleAaChange);

  return {
    sync() {
      if (uiState.fpsSelector && Number.isFinite(options.getRenderingFps?.())) {
        uiState.fpsSelector.value = String(options.getRenderingFps());
      }
      if (uiState.displayPresetSelector && typeof options.getDisplayPreset?.() === 'string') {
        uiState.displayPresetSelector.value = options.getDisplayPreset();
      }
      if (uiState.viewTransformSelector && typeof options.getViewTransform?.() === 'string') {
        uiState.viewTransformSelector.value = options.getViewTransform();
      }
      if (uiState.displayColorSpaceSelector && typeof options.getDisplayColorSpace?.() === 'string') {
        uiState.displayColorSpaceSelector.value = options.getDisplayColorSpace();
      }
      if (uiState.aaSelector && typeof options.getAaMode?.() === 'string') {
        uiState.aaSelector.value = options.getAaMode();
      }
    },
    dispose() {
      uiState.fpsSelector?.removeEventListener('change', handleFpsChange);
      uiState.viewTransformSelector?.removeEventListener('change', handleViewTransformChange);
      uiState.displayPresetSelector?.removeEventListener('change', handleDisplayPresetChange);
      uiState.displayColorSpaceSelector?.removeEventListener('change', handleDisplayColorSpaceChange);
      uiState.aaSelector?.removeEventListener('change', handleAaChange);
    },
  };
}
