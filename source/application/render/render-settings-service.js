/**
 * Creates the render settings service.
 * @param {object} options - Service options.
 * @returns {object} Render settings service.
 */
export function createRenderSettingsService(options) {
  const rendererState = options.rendererState;

  return {
    /**
     * Returns aspect ratio options.
     * @returns {Array<{value: string, label: string}>} Options.
     */
    getAspectRatioOptions() {
      return options.renderAspectPresets.map((preset) => ({
        value: preset.id,
        label: preset.label,
      }));
    },

    /**
     * Returns resolution options for one aspect ratio.
     * @param {string} aspectRatioId - Aspect ratio ID.
     * @param {string} [selectedResolution] - Current selection.
     * @returns {{selectedResolution: string, options: Array<{value: string, label: string}>}} Resolution options.
     */
    getResolutionOptions(aspectRatioId, selectedResolution = rendererState.internalResolution) {
      const preset = options.findAspectPreset(aspectRatioId);
      const resolutionOptions = options.getResolutionOptionsForAspect(aspectRatioId);
      const nextResolution = selectedResolution === 'auto'
        ? 'auto'
        : (resolutionOptions.includes(selectedResolution) ? selectedResolution : preset.defaultResolution);
      return {
        selectedResolution: nextResolution,
        options: [
          { value: 'auto', label: 'Auto' },
          ...resolutionOptions.map((resolution) => ({ value: resolution, label: resolution })),
        ],
      };
    },

    /**
     * Applies the current aspect ratio.
     * @param {string} aspectRatioId - Aspect ratio ID.
     * @returns {{aspectRatio: string, internalResolution: string}} Updated state.
     */
    applyAspectRatio(aspectRatioId) {
      const preset = options.findAspectPreset(aspectRatioId);
      rendererState.aspectRatio = preset.id;
      const resolutionState = this.getResolutionOptions(preset.id, rendererState.internalResolution);
      rendererState.internalResolution = resolutionState.selectedResolution;
      rendererState.needsResize = true;
      options.onViewportLayoutChanged?.(preset.id);
      options.onRenderResolutionChanged?.({
        aspectRatio: rendererState.aspectRatio,
        internalResolution: rendererState.internalResolution,
      });
      return {
        aspectRatio: rendererState.aspectRatio,
        internalResolution: rendererState.internalResolution,
      };
    },

    /**
     * Applies the internal resolution.
     * @param {string} resolution - Resolution value.
     */
    applyInternalResolution(resolution) {
      rendererState.internalResolution = resolution;
      rendererState.needsResize = true;
      options.onRenderResolutionChanged?.({
        aspectRatio: rendererState.aspectRatio,
        internalResolution: rendererState.internalResolution,
      });
    },

    /**
     * Handles browser viewport resize.
     */
    handleViewportResize() {
      rendererState.needsResize = true;
      options.onRenderResolutionChanged?.({
        aspectRatio: rendererState.aspectRatio,
        internalResolution: rendererState.internalResolution,
      });
    },
  };
}
