import { replaceSelectOptions } from './inspector-select-ui.js';

/**
 * Installs the render settings controller.
 * @param {object} options - Controller options.
 * @returns {{syncSelectors: function, dispose: function}} Controller.
 */
export function installRenderSettingsController(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const windowTarget = options.windowTarget ?? globalThis.window ?? null;
  const service = options.service;
  const aspectRatioSelector = options.aspectRatioSelector ?? null;
  const resolutionSelector = options.resolutionSelector ?? null;

  /**
   * Syncs selector options from the current service state.
   */
  function syncSelectors() {
    const aspectRatioOptions = service.getAspectRatioOptions();
    replaceSelectOptions({
      select: aspectRatioSelector,
      documentRef,
      items: aspectRatioOptions.map((item) => ({ value: item.value, label: item.label })),
      value: options.getAspectRatioValue?.() ?? '',
      disabled: false,
    });
    const resolutionState = service.getResolutionOptions(options.getAspectRatioValue?.() ?? '');
    replaceSelectOptions({
      select: resolutionSelector,
      documentRef,
      items: resolutionState.options.map((item) => ({ value: item.value, label: item.label })),
      value: resolutionState.selectedResolution,
      disabled: false,
    });
  }

  const handleAspectRatioChange = (event) => {
    const result = service.applyAspectRatio(event.target.value);
    const resolutionState = service.getResolutionOptions(result.aspectRatio, result.internalResolution);
    replaceSelectOptions({
      select: resolutionSelector,
      documentRef,
      items: resolutionState.options.map((item) => ({ value: item.value, label: item.label })),
      value: resolutionState.selectedResolution,
      disabled: false,
    });
  };

  const handleResolutionChange = (event) => {
    service.applyInternalResolution(event.target.value);
  };

  const handleWindowResize = () => {
    service.handleViewportResize();
  };

  aspectRatioSelector?.addEventListener('change', handleAspectRatioChange);
  resolutionSelector?.addEventListener('change', handleResolutionChange);
  windowTarget?.addEventListener?.('resize', handleWindowResize);

  return {
    syncSelectors,
    dispose() {
      aspectRatioSelector?.removeEventListener('change', handleAspectRatioChange);
      resolutionSelector?.removeEventListener('change', handleResolutionChange);
      windowTarget?.removeEventListener?.('resize', handleWindowResize);
    },
  };
}
