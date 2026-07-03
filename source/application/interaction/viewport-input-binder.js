import { setupInputHandlers } from './renderer-interaction.js';

/**
 * Binds viewport input handlers to the current renderer runtime.
 * @param {object} options - Binding options.
 */
export function bindViewportInputHandlers(options) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const windowTarget = options.windowTarget ?? globalThis.window ?? null;
  setupInputHandlers({
    ...options,
    documentRef,
    windowTarget,
    rangeZoomOverlay: options.rangeZoomOverlay ?? documentRef?.getElementById?.('camera-range-zoom-overlay') ?? null,
    boxSelectionOverlay: options.boxSelectionOverlay ?? documentRef?.getElementById?.('bone-box-selection-overlay') ?? null,
  });
}
