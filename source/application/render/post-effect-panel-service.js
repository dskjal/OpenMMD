/**
 * Creates a post-effect panel service.
 * @param {object} options - Service options.
 * @returns {object} Post-effect panel service.
 */
export function createPostEffectPanelService(options = {}) {
  const rendererState = options.rendererState;
  const defaults = options.defaults ?? {};

  /**
   * Clamps a numeric value.
   * @param {number} value - Input value.
   * @param {number} min - Lower bound.
   * @param {number} max - Upper bound.
   * @param {boolean} [roundToInteger=false] - Whether to round to an integer.
   * @returns {number} Clamped value.
   */
  function clamp(value, min, max, roundToInteger = false) {
    const normalized = roundToInteger ? Math.round(value) : value;
    return Math.min(max, Math.max(min, normalized));
  }

  return {
    /**
     * Returns the current post-effect state.
     * @returns {object} Post-effect state.
     */
    getState() {
      return rendererState.postEffects;
    },

    /**
     * Returns the default post-effect values.
     * @returns {object} Default values.
     */
    getDefaults() {
      return defaults;
    },

    /**
     * Returns the bloom threshold max.
     * @returns {number} Max threshold.
     */
    getBloomThresholdMax() {
      return Number.isFinite(rendererState?.environmentHdrIntensityMax) && rendererState.environmentHdrIntensityMax >= 0
        ? rendererState.environmentHdrIntensityMax
        : 1;
    },

    /**
     * Sets a boolean post-effect field.
     * @param {string} key - State key.
     * @param {boolean} enabled - Next value.
     */
    setBoolean(key, enabled) {
      rendererState.postEffects[key] = Boolean(enabled);
    },

    /**
     * Sets a post-effect enum/string field.
     * @param {string} key - State key.
     * @param {string} value - Next value.
     * @param {string} fallback - Fallback value.
     */
    setString(key, value, fallback) {
      rendererState.postEffects[key] = value || fallback;
    },

    /**
     * Sets a numeric post-effect field.
     * @param {string} key - State key.
     * @param {number} value - Next value.
     * @param {number} min - Lower bound.
     * @param {number} max - Upper bound.
     * @param {boolean} [roundToInteger=false] - Whether to round to an integer.
     * @returns {number} Applied value.
     */
    setNumber(key, value, min, max, roundToInteger = false) {
      const nextValue = clamp(Number(value) || 0, min, max, roundToInteger);
      rendererState.postEffects[key] = nextValue;
      return nextValue;
    },

    /**
     * Resolves the current value for one field.
     * @param {string} key - State key.
     * @param {number|string|boolean} fallback - Fallback value.
     * @param {{min?: number, max?: number, roundToInteger?: boolean}} [options={}] - Value options.
     * @returns {number|string|boolean} Resolved value.
     */
    getValue(key, fallback, options = {}) {
      const currentValue = rendererState.postEffects[key];
      if (typeof fallback === 'boolean') {
        return Boolean(currentValue);
      }
      if (typeof fallback === 'string') {
        return typeof currentValue === 'string' && currentValue ? currentValue : fallback;
      }
      if (Number.isFinite(currentValue)) {
        return clamp(currentValue, options.min ?? currentValue, options.max ?? currentValue, options.roundToInteger === true);
      }
      return fallback;
    },
  };
}
