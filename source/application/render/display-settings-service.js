import { normalizeDisplayColorSpace, normalizeViewTransform } from '../../shared/math/view-transform.js';
import { getAppliedDisplayPresetValues, normalizeDisplayPreset } from '../../shared/render/display-preset.js';

/**
 * Creates a display settings service.
 * @param {object} options - Service options.
 * @returns {object} Display settings service.
 */
export function createDisplaySettingsService(options = {}) {
  const rendererState = options.rendererState;

  return {
    /**
     * Applies the rendering FPS.
     * @param {number} fps - Target FPS.
     */
    applyRenderingFps(fps) {
      if (Number.isFinite(fps)) {
        rendererState.renderingFPS = Math.round(fps);
      }
    },

    /**
     * Applies a view transform.
     * @param {string} viewTransform - View transform ID.
     * @returns {string} Applied view transform.
     */
    applyViewTransform(viewTransform) {
      rendererState.viewTransform = normalizeViewTransform(viewTransform);
      return rendererState.viewTransform;
    },

    /**
     * Applies a display color space.
     * @param {string} displayColorSpace - Color space ID.
     * @returns {string} Applied color space.
     */
    applyDisplayColorSpace(displayColorSpace) {
      rendererState.displayColorSpace = normalizeDisplayColorSpace(displayColorSpace);
      return rendererState.displayColorSpace;
    },

    /**
     * Returns the applied display preset values.
     * @param {string} preset - Preset ID.
     * @returns {object} Applied preset values.
     */
    getAppliedDisplayPresetValues(preset) {
      return getAppliedDisplayPresetValues(normalizeDisplayPreset(preset), {
        gltfLightStrength: rendererState.postEffects.gltfLightStrength,
        shadowPower: rendererState.shadowParams.shadowPower,
        environmentHdrIntensity: rendererState.environmentHdrIntensity,
      });
    },
  };
}
