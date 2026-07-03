/**
 * JSON document text を object として解析します。
 * @param {string} text - JSON text.
 * @param {string} objectErrorMessage - object 以外だった場合の error message.
 * @returns {object} Parsed object.
 * @throws {Error} JSON が object でない場合。
 */
export function parseJsonObjectDocument(text, objectErrorMessage) {
  const normalizedText = String(text || '').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(normalizedText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(objectErrorMessage);
  }
  return parsed;
}

/**
 * 設定 document の type を正規化します。
 * @param {object|null|undefined} data - Parsed data.
 * @returns {string} Normalized type.
 */
export function normalizeSettingsType(data) {
  return String(data?.type || '').trim().toLowerCase();
}

/**
 * document が対象 type かどうかを判定します。
 * @param {object|null|undefined} data - Parsed data.
 * @param {string} expectedType - Expected type.
 * @returns {boolean} True when the type matches.
 */
export function isSettingsType(data, expectedType) {
  return normalizeSettingsType(data) === String(expectedType || '').trim().toLowerCase();
}
