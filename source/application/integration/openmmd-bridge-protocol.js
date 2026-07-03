export const MESSAGE_NAMESPACE = 'openmmd-api';

/**
 * Converts bytes to base64 text.
 * @param {Uint8Array} bytes - Binary data.
 * @returns {string} Base64 text.
 */
export function bytesToBase64(bytes, options = {}) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  const btoaFunction = options.btoa
    ?? globalThis.btoa
    ?? globalThis.window?.btoa
    ?? null;
  if (typeof btoaFunction === 'function') {
    return btoaFunction(binary);
  }
  throw new Error('Base64 encoding is not available in this environment.');
}

/**
 * Converts base64 text to bytes.
 * @param {string} base64 - Base64 encoded data.
 * @returns {Uint8Array} Binary data.
 */
export function base64ToUint8Array(base64, options = {}) {
  const normalized = String(base64 || '').includes(',')
    ? String(base64).slice(String(base64).indexOf(',') + 1)
    : String(base64 || '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }

  const atobFunction = options.atob ?? globalThis.atob ?? globalThis.window?.atob ?? null;
  if (typeof atobFunction !== 'function') {
    throw new Error('Base64 decoding is not available in this environment.');
  }

  const binary = atobFunction(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Serializes a Blob or File for JSON transport.
 * @param {Blob} blob - Blob value.
 * @param {string} fileName - Suggested file name.
 * @param {string} fileType - Suggested MIME type.
 * @returns {Promise<object>} Serialized payload.
 */
export async function serializeBlobPayload(blob, fileName, fileType) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    fileName: typeof fileName === 'string' ? fileName : '',
    fileType: typeof fileType === 'string' && fileType
      ? fileType
      : blob.type || 'application/octet-stream',
    fileData: bytesToBase64(bytes),
  };
}

/**
 * Serializes a File for bridge transport.
 * @param {File} file - Input file.
 * @returns {Promise<object>} Serialized file payload.
 */
export async function serializeFilePayload(file) {
  return serializeBlobPayload(
    file,
    typeof file?.name === 'string' ? file.name : '',
    typeof file?.type === 'string' ? file.type : 'application/octet-stream',
  );
}

/**
 * Reconstructs a File from a serialized payload.
 * @param {object} payload - Serialized file payload.
 * @returns {File|null} File instance.
 */
export function deserializeFilePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.file instanceof File) {
    return payload.file;
  }

  if (payload.file instanceof Blob && typeof payload.file.name === 'string') {
    return payload.file;
  }

  if (typeof payload.fileName !== 'string' || typeof payload.fileData !== 'string') {
    return null;
  }

  const bytes = base64ToUint8Array(payload.fileData);
  return new File([bytes], payload.fileName, {
    type: typeof payload.fileType === 'string' ? payload.fileType : 'application/octet-stream',
  });
}
