/**
 * Creates a browser-backed canvas for export.
 * @param {number} width - Width.
 * @param {number} height - Height.
 * @param {Document} [documentRef] - Browser document.
 * @returns {HTMLCanvasElement|OffscreenCanvas} Export canvas.
 */
export function createBrowserExportCanvas(width, height, documentRef = globalThis.document) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  const exportCanvas = documentRef.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  exportCanvas.style.display = 'none';
  return exportCanvas;
}

/**
 * Converts a browser canvas into a PNG blob.
 * @param {HTMLCanvasElement|OffscreenCanvas} exportCanvas - Target canvas.
 * @returns {Promise<Blob>} PNG blob.
 */
export async function browserCanvasToBlob(exportCanvas) {
  if (typeof exportCanvas.convertToBlob === 'function') {
    return exportCanvas.convertToBlob({ type: 'image/png' });
  }

  if (typeof exportCanvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Failed to create PNG blob.'));
      }, 'image/png');
    });
  }

  throw new Error('The current environment does not support PNG export.');
}
