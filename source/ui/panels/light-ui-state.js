const LIGHT_POSITION_INPUT_IDS = ['light-pos-x', 'light-pos-y', 'light-pos-z'];
const LIGHT_ROTATION_INPUT_IDS = ['light-rot-x', 'light-rot-y', 'light-rot-z'];

/**
 * Resolves DOM references used by the light panel.
 * @param {Document} documentRef - Target document.
 * @returns {object} Light UI state.
 */
export function bindLightUiState(documentRef) {
  return {
    positionInputs: LIGHT_POSITION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
    rotationInputs: LIGHT_ROTATION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
    rotationKeyIcon: documentRef.getElementById('light-rot-key'),
    gltfLightStrengthRange: documentRef.getElementById('light-color-strength-range'),
    gltfLightStrengthValue: null,
    lightColorPicker: null,
    rotationEuler: null,
    prevEuler: [0, 0, 0],
  };
}
