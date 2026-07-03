import { applyTypedSettingsAdapters } from './json-apply-runner.js';
import { isSettingsType, parseJsonObjectDocument } from './json-document-utils.js';

const UI_SETTINGS_TYPE = 'ui';
const UI_SETTINGS_SECTION_ORDER = Object.freeze([
  'animation',
  'shortcuts',
  'videoExport',
  'render',
  'postEffect',
  'camera',
  'light',
]);

/**
 * UI 設定 JSON を文字列から解析します。
 * @param {string} text - JSON 文字列。
 * @returns {object} 解析済み設定。
 * @throws {Error} JSON が不正な場合。
 */
export function parseUiSettingsJsonText(text) {
  return parseJsonObjectDocument(text, 'UI settings JSON must be an object.');
}

/**
 * 設定オブジェクトが UI 設定かどうかを判定します。
 * @param {object|null} data - 設定オブジェクト。
 * @returns {boolean} UI 設定なら true。
 */
export function isUiSettingsObject(data) {
  return isSettingsType(data, UI_SETTINGS_TYPE);
}

/**
 * UI 設定 port を解決します。
 * @param {object} [options={}] - オプション。
 * @returns {object} Port object.
 */
function resolveUiSettingsPort(options = {}) {
  return options.uiSettingsPort ?? options.port ?? {};
}

/**
 * section にシリアライズ対象の値があるかを判定します。
 * @param {unknown} value - 判定値。
 * @returns {boolean} 値があれば true。
 */
function hasSerializableSectionValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value !== 'object') {
    return true;
  }
  return Object.keys(value).length > 0;
}

/**
 * Section adapter 一覧を返します。
 * @param {object} [options={}] - オプション。
 * @returns {Array<{key: string, read: (function(): object|undefined|null)|null, apply: (function(object): (void|Promise<void>))|null}>} Adapter list.
 */
function getUiSettingsSectionAdapters(options = {}) {
  const port = resolveUiSettingsPort(options);
  return [
    {
      key: 'animation',
      read: port.readAnimationState ?? null,
      apply: port.applyAnimationState ?? null,
    },
    {
      key: 'shortcuts',
      read: port.readShortcutState ?? null,
      apply: port.applyShortcutState ?? null,
    },
    {
      key: 'videoExport',
      read: port.readVideoExportState ?? null,
      apply: port.applyVideoExportState ?? null,
    },
    {
      key: 'render',
      read: port.readRenderState ?? null,
      apply: port.applyRenderState ?? null,
    },
    {
      key: 'postEffect',
      read: port.readPostEffectState ?? null,
      apply: port.applyPostEffectState ?? null,
    },
    {
      key: 'camera',
      read: port.readCameraState ?? null,
      apply: port.applyCameraState ?? null,
    },
    {
      key: 'light',
      read: port.readLightState ?? null,
      apply: port.applyLightState ?? null,
    },
  ];
}

/**
 * 現在の UI 状態を UI 設定 JSON 形式へ変換します。
 * @param {object} [options={}] - ビルドオプション。
 * @returns {object} UI 設定 JSON 互換 object。
 */
export function buildUiSettingsJsonData(options = {}) {
  const data = { type: UI_SETTINGS_TYPE };
  for (const adapter of getUiSettingsSectionAdapters(options)) {
    if (typeof adapter.read !== 'function') {
      continue;
    }
    const sectionData = adapter.read();
    if (!hasSerializableSectionValue(sectionData)) {
      continue;
    }
    data[adapter.key] = sectionData;
  }
  return data;
}

/**
 * UI 設定を内部 API に反映します。
 * @param {object} data - 解析済み設定。
 * @param {object} [options={}] - 反映オプション。
 * @returns {Promise<{applied: boolean, type: string, appliedKeys: string[], skippedReason?: string}>} 反映結果。
 */
export async function applyUiSettingsJsonData(data, options = {}) {
  const adapterByKey = new Map(getUiSettingsSectionAdapters(options).map((adapter) => [adapter.key, adapter]));
  return applyTypedSettingsAdapters(data, {
    expectedType: UI_SETTINGS_TYPE,
    adapters: UI_SETTINGS_SECTION_ORDER.map((key) => ({
      key,
      shouldApply: (sectionData) => Boolean(sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)),
      apply: async (sectionData) => {
        const adapter = adapterByKey.get(key);
        await adapter?.apply?.(sectionData);
      },
    })),
  });
}

/**
 * UI 設定 JSON ファイルを読み込み、内部 API に反映します。
 * @param {Blob|File} file - UI 設定 JSON ファイル。
 * @param {object} [options={}] - 反映オプション。
 * @returns {Promise<{applied: boolean, type: string, appliedKeys: string[], skippedReason?: string}>} 反映結果。
 */
export async function loadUiSettingsFile(file, options = {}) {
  if (!file || typeof file.text !== 'function') {
    throw new Error('UI settings file is not readable.');
  }

  const parsed = parseUiSettingsJsonText(await file.text());
  return applyUiSettingsJsonData(parsed, options);
}
