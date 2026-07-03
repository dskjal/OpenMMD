import { clampEnvironmentHdrIntensity } from '../../shared/render/environment-hdr-utils.js';

/**
 * Creates an environment panel service.
 * @param {object} options - Service options.
 * @returns {object} Environment panel service.
 */
export function createEnvironmentPanelService(options = {}) {
  const rendererState = options.rendererState;

  return {
    /**
     * Returns the current HDR intensity.
     * @returns {number} Current intensity.
     */
    getIntensity() {
      return clampEnvironmentHdrIntensity(
        rendererState.environmentHdrIntensity,
        rendererState.environmentHdrIntensityMax,
      );
    },

    /**
     * Applies a new HDR intensity.
     * @param {number} value - Target intensity.
     * @returns {number} Applied intensity.
     */
    applyIntensity(value) {
      const nextValue = clampEnvironmentHdrIntensity(value, rendererState.environmentHdrIntensityMax);
      rendererState.environmentHdrIntensity = nextValue;
      return nextValue;
    },
  };
}
