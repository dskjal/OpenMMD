/**
 * Installs light editing DOM event handlers.
 * @param {object} options - Controller options.
 */
export function installLightEditingController(options) {
  const {
    lightUiState,
    lightService,
    refreshScene,
  } = options;

  lightUiState.positionInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      lightService.applyPositionFromInputs();
      refreshScene();
    });
  });
  lightUiState.rotationInputs.forEach((input) => {
    input?.addEventListener('input', () => {
      lightService.applyRotationFromInputs();
      refreshScene();
    });
  });
  lightUiState.rotationKeyIcon?.addEventListener('click', () => {
    lightService.registerKeyframe();
  });
}
