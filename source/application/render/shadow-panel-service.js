/**
 * Creates a shadow panel service.
 * @param {object} options - Service options.
 * @returns {object} Shadow panel service.
 */
export function createShadowPanelService(options = {}) {
  const rendererState = options.rendererState;

  /**
   * Clamps a value.
   * @param {number} value - Source value.
   * @param {number} min - Lower bound.
   * @param {number} max - Upper bound.
   * @returns {number} Clamped value.
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return {
    getShadowState() {
      return rendererState.shadowParams;
    },
    getPostEffectState() {
      return rendererState.postEffects;
    },
    setShadowPower(value) {
      rendererState.shadowParams.shadowPower = clamp(value, 1.0, 10.0);
      return rendererState.shadowParams.shadowPower;
    },
    setShadowBias(value) {
      if (Number.isFinite(value)) {
        rendererState.shadowParams.shadowBias = value;
      }
    },
    setShadowEdgeOpacity(value) {
      if (Number.isFinite(value)) {
        rendererState.shadowParams.shadowEdgeOpacity = value;
      }
    },
    setShadowStrength(value) {
      if (Number.isFinite(value)) {
        rendererState.shadowParams.shadowStrength = value;
      }
    },
    setShowCascadeShadowMaps(enabled) {
      rendererState.showCascadeShadowMaps = Boolean(enabled);
    },
    setShowBloomShadowDebug(enabled) {
      rendererState.showBloomShadowDebug = Boolean(enabled);
    },
    setBloomShadowDebugMode(mode) {
      rendererState.bloomShadowDebugMode = Number.isFinite(mode) ? mode : 0;
    },
    setShadowMapSize(size) {
      if (Number.isFinite(size)) {
        rendererState.shadowMapSize = size;
      }
    },
    setShadowFarAuto(enabled) {
      rendererState.shadowFarAuto = Boolean(enabled);
    },
    setShadowFar(value) {
      if (Number.isFinite(value)) {
        rendererState.shadowFar = value;
      }
    },
    setAmbientOcclusionEnabled(enabled) {
      rendererState.postEffects.ambientOcclusionEnabled = Boolean(enabled);
    },
    setAmbientOcclusionRadius(value) {
      rendererState.postEffects.ambientOcclusionRadius = clamp(value, 0.0, 2.0);
      return rendererState.postEffects.ambientOcclusionRadius;
    },
    setAmbientOcclusionBias(value) {
      rendererState.postEffects.ambientOcclusionBias = clamp(value, 0.0, 0.1);
      return rendererState.postEffects.ambientOcclusionBias;
    },
    setAmbientOcclusionIntensity(value) {
      rendererState.postEffects.ambientOcclusionIntensity = clamp(value, 0.0, 10.0);
      return rendererState.postEffects.ambientOcclusionIntensity;
    },
    setAmbientOcclusionBlurAmount(value) {
      rendererState.postEffects.ambientOcclusionBlurAmount = clamp(value, 0.0, 4.0);
      return rendererState.postEffects.ambientOcclusionBlurAmount;
    },
    setAmbientOcclusionSampleCount(value) {
      rendererState.postEffects.ambientOcclusionSampleCount = clamp(Math.round(value), 1, 32);
      return rendererState.postEffects.ambientOcclusionSampleCount;
    },
    setContactShadowEnabled(enabled) {
      rendererState.postEffects.contactShadowEnabled = Boolean(enabled);
    },
    setContactShadowLength(value) {
      rendererState.postEffects.contactShadowLength = clamp(value, 0.0, 1.0);
      return rendererState.postEffects.contactShadowLength;
    },
    setContactShadowThickness(value) {
      rendererState.postEffects.contactShadowThickness = clamp(value, 0.0, 0.1);
      return rendererState.postEffects.contactShadowThickness;
    },
    setContactShadowIntensity(value) {
      rendererState.postEffects.contactShadowIntensity = clamp(value, 0.0, 2.0);
      return rendererState.postEffects.contactShadowIntensity;
    },
    setContactShadowBlurAmount(value) {
      rendererState.postEffects.contactShadowBlurAmount = clamp(value, 0.0, 4.0);
      return rendererState.postEffects.contactShadowBlurAmount;
    },
    setContactShadowStepCount(value) {
      rendererState.postEffects.contactShadowStepCount = clamp(Math.round(value), 1, 32);
      return rendererState.postEffects.contactShadowStepCount;
    },
  };
}
