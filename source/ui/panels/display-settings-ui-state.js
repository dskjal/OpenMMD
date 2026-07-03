/**
 * Resolves DOM references used by display settings controls.
 * @param {Document} documentRef - Target document.
 * @returns {object} Display settings UI state.
 */
export function bindDisplaySettingsUiState(documentRef) {
  return {
    fpsSelector: documentRef.getElementById('fps-selector'),
    displayPresetSelector: documentRef.getElementById('display-preset-selector'),
    viewTransformSelector: documentRef.getElementById('view-transform-selector'),
    displayColorSpaceSelector: documentRef.getElementById('display-color-space-selector'),
    aspectRatioSelector: documentRef.getElementById('aspect-ratio-selector'),
    resolutionSelector: documentRef.getElementById('resolution-selector'),
    aaSelector: documentRef.getElementById('aa-method'),
  };
}
