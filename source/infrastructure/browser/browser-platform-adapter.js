import {
  browserCanvasToBlob,
  createBrowserExportCanvas,
} from './browser-canvas-export-adapter.js';

/**
 * Creates a browser platform adapter.
 * @param {object} [options={}] - Adapter options.
 * @returns {object} Adapter API.
 */
export function createBrowserPlatformAdapter(options = {}) {
  const windowObject = options.windowObject ?? globalThis.window ?? null;
  const documentObject = options.documentObject ?? windowObject?.document ?? globalThis.document ?? null;
  const navigatorObject = options.navigatorObject ?? windowObject?.navigator ?? globalThis.navigator ?? null;
  const storageObject = options.storageObject ?? windowObject?.localStorage ?? globalThis.localStorage ?? null;
  const urlApi = options.urlApi ?? globalThis.URL ?? null;
  const performanceObject = options.performanceObject ?? globalThis.performance ?? null;
  const blobCtor = options.blobCtor ?? globalThis.Blob ?? null;

  return {
    windowObject,
    documentObject,
    navigatorObject,
    storageObject,
    urlApi,
    performanceObject,
    blobCtor,

    /**
     * Downloads binary data through an anchor element.
     * @param {{fileName: string, buffer: ArrayBuffer}} payload - Download payload.
     */
    downloadBinary(payload) {
      if (
        !payload?.buffer
        || !documentObject
        || !urlApi
        || typeof urlApi.createObjectURL !== 'function'
        || typeof blobCtor !== 'function'
      ) {
        return;
      }

      const blob = new blobCtor([payload.buffer], { type: 'application/octet-stream' });
      const url = urlApi.createObjectURL(blob);
      const anchor = documentObject.createElement('a');
      anchor.href = url;
      anchor.download = payload.fileName || 'download.bin';
      documentObject.body?.appendChild(anchor);
      anchor.click();
      anchor.remove();
      if (typeof urlApi.revokeObjectURL === 'function') {
        urlApi.revokeObjectURL(url);
      }
    },

    /**
     * Reads the persisted language setting.
     * @returns {string} Persisted language.
     */
    readLanguage() {
      return typeof storageObject?.getItem === 'function'
        ? storageObject.getItem('openmmd-lang') || ''
        : '';
    },

    /**
     * Writes the persisted language setting.
     * @param {string} lang - Language code.
     */
    writeLanguage(lang) {
      storageObject?.setItem?.('openmmd-lang', lang);
    },

    /**
     * Shows a confirm dialog.
     * @param {string} message - Prompt message.
     * @returns {boolean} User choice.
     */
    confirm(message) {
      return typeof windowObject?.confirm === 'function' ? windowObject.confirm(message) : false;
    },

    /**
     * Shows a prompt dialog.
     * @param {string} message - Prompt message.
     * @param {string} [defaultValue=''] - Default value.
     * @returns {string|null} User input.
     */
    prompt(message, defaultValue = '') {
      return typeof windowObject?.prompt === 'function' ? windowObject.prompt(message, defaultValue) : null;
    },

    /**
     * Returns WebGPU adapters used by the app.
     * @returns {{gpu: object|null, preferredCanvasFormat: string|null}} GPU adapters.
     */
    getGpu() {
      return {
        gpu: navigatorObject?.gpu ?? null,
        preferredCanvasFormat: typeof navigatorObject?.gpu?.getPreferredCanvasFormat === 'function'
          ? navigatorObject.gpu.getPreferredCanvasFormat()
          : null,
      };
    },

    /**
     * Creates an export canvas.
     * @param {number} width - Canvas width.
     * @param {number} height - Canvas height.
     * @returns {HTMLCanvasElement|OffscreenCanvas} Export canvas.
     */
    createExportCanvas(width, height) {
      return createBrowserExportCanvas(width, height, documentObject);
    },

    /**
     * Converts a canvas to a blob.
     * @param {HTMLCanvasElement|OffscreenCanvas} canvas - Source canvas.
     * @returns {Promise<Blob>} Blob result.
     */
    async canvasToBlob(canvas) {
      return browserCanvasToBlob(canvas);
    },

    /**
     * Dispatches the render-resolution changed event.
     * @param {object} detail - Event detail.
     */
    dispatchRenderResolutionChanged(detail) {
      windowObject?.dispatchEvent?.(new CustomEvent('render-resolution-changed', { detail }));
    },

    /**
     * Returns the current monotonic time.
     * @returns {number} Current time.
     */
    now() {
      return typeof performanceObject?.now === 'function' ? performanceObject.now() : Date.now();
    },
  };
}
