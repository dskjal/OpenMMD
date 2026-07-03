import { normalizeSettingsType } from './json-document-utils.js';

/**
 * Typed settings adapters を順番に適用します。
 * @param {object} data - Parsed settings data.
 * @param {object} options - Apply options.
 * @param {string} options.expectedType - Expected settings type.
 * @param {Array<{key: string, shouldApply?: function(unknown): boolean, apply: function(unknown): (void|Promise<void>)}>} options.adapters - Ordered adapters.
 * @returns {Promise<{applied: boolean, type: string, appliedKeys: string[], skippedReason?: string}>} Apply result.
 */
export async function applyTypedSettingsAdapters(data, options) {
  const settingsType = normalizeSettingsType(data);
  if (settingsType !== String(options?.expectedType || '').trim().toLowerCase()) {
    return {
      applied: false,
      type: settingsType || '',
      appliedKeys: [],
      skippedReason: 'unsupported-type',
    };
  }

  const appliedKeys = [];
  for (const adapter of Array.isArray(options?.adapters) ? options.adapters : []) {
    if (!adapter || typeof adapter.apply !== 'function') {
      continue;
    }
    const sectionData = data?.[adapter.key];
    const shouldApply = typeof adapter.shouldApply === 'function'
      ? adapter.shouldApply(sectionData)
      : sectionData !== undefined;
    if (!shouldApply) {
      continue;
    }
    await adapter.apply(sectionData);
    appliedKeys.push(adapter.key);
  }

  return {
    applied: appliedKeys.length > 0,
    type: settingsType,
    appliedKeys,
  };
}
