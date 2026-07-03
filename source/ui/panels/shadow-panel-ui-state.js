/**
 * Resolves DOM references used by shadow panel controls.
 * @param {Document} documentRef - Target document.
 * @returns {object} Shadow panel UI state.
 */
export function bindShadowPanelUiState(documentRef) {
  return {
    shadowBiasInput: documentRef.getElementById('shadow-bias'),
    edgeOpacityInput: documentRef.getElementById('edge-opacity'),
    shadowPowerRange: documentRef.getElementById('shadow-power'),
    shadowPowerValue: null,
    shadowStrengthInput: documentRef.getElementById('shadow-strength'),
    showCascadeShadowMapsCheckbox: documentRef.getElementById('show-cascade-shadow-maps'),
    bloomShadowDebugCheckbox: documentRef.getElementById('show-bloom-shadow-debug'),
    bloomShadowDebugModeSelect: documentRef.getElementById('bloom-shadow-debug-mode'),
    shadowMapSizeSelector: documentRef.getElementById('shadow-map-size'),
    shadowFarAutoCheckbox: documentRef.getElementById('shadow-far-auto'),
    shadowFarSlider: documentRef.getElementById('shadow-far'),
    ambientOcclusionEnabledInput: documentRef.getElementById('ambient-occlusion-enabled'),
    ambientOcclusionRadiusRange: documentRef.getElementById('ambient-occlusion-radius'),
    ambientOcclusionRadiusValue: null,
    ambientOcclusionBiasRange: documentRef.getElementById('ambient-occlusion-bias'),
    ambientOcclusionBiasValue: null,
    ambientOcclusionIntensityRange: documentRef.getElementById('ambient-occlusion-intensity'),
    ambientOcclusionIntensityValue: null,
    ambientOcclusionBlurAmountRange: documentRef.getElementById('ambient-occlusion-blur-amount'),
    ambientOcclusionBlurAmountValue: null,
    ambientOcclusionSampleCountRange: documentRef.getElementById('ambient-occlusion-sample-count'),
    ambientOcclusionSampleCountValue: null,
    contactShadowEnabledInput: documentRef.getElementById('contact-shadow-enabled'),
    contactShadowLengthRange: documentRef.getElementById('contact-shadow-length'),
    contactShadowLengthValue: null,
    contactShadowThicknessRange: documentRef.getElementById('contact-shadow-thickness'),
    contactShadowThicknessValue: null,
    contactShadowIntensityRange: documentRef.getElementById('contact-shadow-intensity'),
    contactShadowIntensityValue: null,
    contactShadowBlurAmountRange: documentRef.getElementById('contact-shadow-blur-amount'),
    contactShadowBlurAmountValue: null,
    contactShadowStepCountRange: documentRef.getElementById('contact-shadow-step-count'),
    contactShadowStepCountValue: null,
  };
}
