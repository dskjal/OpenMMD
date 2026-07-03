import {
  resolveSelectedBoneIndex,
} from '../core/selection/renderer-selection.js';
import { getEnvironmentHdrIntensityMax } from '../shared/render/environment-hdr-utils.js';
import {
  filterVideoExportCodecsForFormat,
  normalizeVideoExportCodec,
  normalizeVideoExportFormat,
  normalizeVideoExportTransparentBackground,
  normalizeVideoExportQuality,
  supportsVideoExportTransparency,
  VIDEO_EXPORT_QUALITY_ORDER,
} from '../shared/export/video-export-utils.js';
import {
  findAspectPreset,
} from '../shared/render/render-aspect-presets.js';
import { getDefaultsSnapshot } from '../infrastructure/config/defaults/defaults-manager.js';
import {
  bindLinkedNumericInputs,
  isNumericInputFocused,
  readNumericInputValue,
  shouldSkipNumericInputCommit,
  syncNumericInputValue,
} from '../shared/ui/numeric-input-utils.js';
import { getBone } from '../core/model/model-scene.js';
import { createPostEffectPanelService } from '../application/render/post-effect-panel-service.js';
import { installPostEffectPanelController } from './panels/post-effect-panel-controller.js';
import { bindPostEffectUiState } from './panels/post-effect-ui-state.js';

/**
 * モデル一覧 UI を更新します。
 * @param {object} modelListState - 描画用モデル一覧 state。
 * @param {object} [langData={}] - ローカライズ辞書。
 */
export function updateModelListUI(modelListState, langData = {}) {
  const listEl = document.getElementById('model-list');
  if (!listEl) {
    return;
  }

  listEl.innerHTML = '';
  listEl.setAttribute('role', 'listbox');
  listEl.setAttribute('aria-label', langData['Loaded Models'] || 'Loaded Models');

  const activeIndex = Number.isInteger(modelListState?.activeIndex) ? modelListState.activeIndex : -1;
  const deleteLabel = langData['Delete Model'] || langData.Delete || 'Delete';
  const showLabel = langData['Show Model'] || 'Show Model';
  const hideLabel = langData['Hide Model'] || 'Hide Model';

  for (const item of modelListState?.items || []) {
    const index = Number.isInteger(item?.index) ? item.index : -1;
    const labelText = String(item?.name || `Model ${index}`);
    const isVisible = item?.visible !== false;
    const row = document.createElement('div');
    row.className = 'model-list-row';
    if (!isVisible) {
      row.classList.add('is-hidden');
    }
    row.dataset.modelIndex = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-selected', String(index === activeIndex));
    row.setAttribute('aria-hidden', String(!isVisible));
    if (index === activeIndex) {
      row.classList.add('is-active');
    }

    const visibilityButton = document.createElement('button');
    visibilityButton.className = 'icon-button model-list-visibility-button';
    visibilityButton.type = 'button';
    visibilityButton.dataset.modelVisibilityIndex = String(index);
    visibilityButton.title = isVisible ? hideLabel : showLabel;
    visibilityButton.setAttribute('aria-label', `${visibilityButton.title}: ${labelText}`);
    visibilityButton.setAttribute('aria-pressed', String(isVisible));
    visibilityButton.innerHTML = '<img src="fonts/visibility_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg" alt="">';

    const label = document.createElement('span');
    label.className = 'model-list-label';
    label.textContent = labelText;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'icon-button model-list-delete-button';
    deleteButton.type = 'button';
    deleteButton.dataset.modelDeleteIndex = String(index);
    deleteButton.title = deleteLabel;
    deleteButton.setAttribute('aria-label', `${deleteLabel}: ${label.textContent}`);
    deleteButton.innerHTML = '<img src="fonts/delete_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg" alt="">';

    row.append(visibilityButton, label, deleteButton);
    listEl.appendChild(row);
  }
}

/**
 * 指定した animation source を参照しているモデル名を返します。
 * @param {object} modelManager - モデル管理インスタンス。
 * @param {string} sourceKind - source kind。
 * @param {string} sourceName - source 名。
 * @returns {string[]} 参照中のモデル名一覧。
 */
export function getAnimationReferenceModelNames(modelManager, sourceKind, sourceName) {
  if (!modelManager || !sourceName) {
    return [];
  }

  const references = [];
  modelManager.instances.forEach((instance, index) => {
    const instanceSourceKind = String(instance?.animationSourceKind || instance?.animationSourceType || (instance?.vmdName ? 'vmd' : '')).trim();
    const instanceSourceName = String(instance?.animationSourceName || instance?.vmdName || '').trim();
    if (instanceSourceKind === String(sourceKind || '').trim()
      && instanceSourceName === String(sourceName || '').trim()) {
      references.push(instance.model?.name || `Model ${index}`);
    }
  });
  return references;
}

/**
 * 後方互換のため VMD 参照ヘルパーを残します。
 * @param {object} modelManager - モデル管理インスタンス。
 * @param {string} vmdName - VMD 名。
 * @returns {string[]} 参照中のモデル名一覧。
 */
export function getVmdReferenceModelNames(modelManager, vmdName) {
  return getAnimationReferenceModelNames(modelManager, 'vmd', vmdName);
}

/**
 * animation 一覧の選択値を解析します。
 * @param {string} value - list value。
 * @returns {{kind: string, targetType: string, name: string, index: number|null}}
 */
function parseAnimationListValue(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { kind: '', targetType: 'model', name: '', index: null };
  }

  const [kind = '', targetType = 'model', ...rest] = text.split(':');
  const name = rest.join(':');
  const index = kind === 'gltf' ? Number.parseInt(name, 10) : null;
  return {
    kind,
    targetType: targetType || 'model',
    name,
    index: Number.isInteger(index) ? index : null,
  };
}

/**
 * 一覧表示用 animation entries を返します。
 * @param {object} vmdManager - animation 管理インスタンス。
 * @param {object|null} activeInstance - アクティブモデルインスタンス。
 * @returns {Array<object>}
 */
function getAnimationListEntries(vmdManager, activeInstance) {
  if (typeof vmdManager?.getAnimationListEntries === 'function') {
    return vmdManager.getAnimationListEntries(activeInstance);
  }

  const entries = [];
  for (const name of vmdManager?.vmds?.keys?.() || []) {
    entries.push({
      value: `vmd:model:${name}`,
      label: name,
    });
  }
  for (const name of vmdManager?.vrmas?.keys?.() || []) {
    entries.push({
      value: `vrma:model:${name}`,
      label: `[VRMA] ${name}`,
    });
  }
  for (let index = 0; index < (activeInstance?.gltfAnimationSources || []).length; index++) {
    const source = activeInstance.gltfAnimationSources[index];
    entries.push({
      value: `gltf:model:${index}`,
      label: `[glTF] ${source.name}`,
    });
  }
  return entries;
}

/**
 * アニメーション保存用のアクティブインスタンスを返します。
 * @param {object} modelManager - モデル管理インスタンス。
 * @param {object} selection - 現在の選択状態。
 * @returns {object|null} アクティブインスタンス。
 */
function getActiveAnimationExportInstance(modelManager, selection) {
  const activeIndex = Number.isInteger(selection?.activeInstanceIndex) ? selection.activeInstanceIndex : -1;
  if (activeIndex < 0) {
    return null;
  }
  return modelManager?.instances?.[activeIndex] || null;
}

/**
 * アニメーションエクスポートダイアログの要素群を取得します。
 * @returns {object|null} ダイアログ要素群。
 */
function getAnimationExportDialogElements() {
  const overlay = document.getElementById('animation-export-overlay');
  if (!overlay) {
    return null;
  }

  return {
    overlay,
    dialog: document.getElementById('animation-export-dialog'),
    title: document.getElementById('animation-export-title'),
    formatGroup: document.getElementById('animation-export-format-group'),
    formatLegend: document.getElementById('animation-export-format-legend'),
    formatVmdRadio: document.getElementById('animation-export-format-vmd'),
    formatVrmaRadio: document.getElementById('animation-export-format-vrma'),
    vrmaOptions: document.getElementById('animation-export-vrma-options'),
    vrmaIkGroup: document.getElementById('animation-export-vrma-ik-group'),
    vrmaIkLegend: document.getElementById('animation-export-vrma-ik-legend'),
    vrmaIkToRotationRadio: document.getElementById('animation-export-vrma-ik-to-rotation'),
    vrmaIkAsIsRadio: document.getElementById('animation-export-vrma-ik-as-is'),
    vrmaLowerBodyGroup: document.getElementById('animation-export-vrma-lower-body-group'),
    vrmaLowerBodyLegend: document.getElementById('animation-export-vrma-lower-body-legend'),
    vrmaLowerBodyBakeRadio: document.getElementById('animation-export-vrma-lower-body-bake'),
    vrmaLowerBodySkipRadio: document.getElementById('animation-export-vrma-lower-body-skip'),
    saveButton: document.getElementById('animation-export-save'),
  };
}

let animationExportDialogResolver = null;
let animationExportDialogKeydownHandler = null;
let animationExportDialogBound = false;
let animationExportDialogBoundOverlay = null;

/**
 * アニメーションエクスポートダイアログを閉じます。
 * @param {object|null} result - 選択結果。キャンセル時は null。
 */
function closeAnimationExportDialog(result = null) {
  const elements = getAnimationExportDialogElements();
  if (elements) {
    elements.overlay.hidden = true;
  }

  const resolver = animationExportDialogResolver;
  animationExportDialogResolver = null;
  if (resolver) {
    resolver(result);
  }
}

/**
 * ダイアログ内の VRMA 専用オプション表示を同期します。
 * @param {object} elements - ダイアログ要素群。
 */
function syncAnimationExportDialogVisibility(elements) {
  const isVrmaSelected = Boolean(elements?.formatVrmaRadio?.checked);
  if (elements?.vrmaOptions) {
    elements.vrmaOptions.hidden = !isVrmaSelected;
    elements.vrmaOptions.setAttribute('aria-hidden', String(!isVrmaSelected));
  }
}

/**
 * ダイアログの現在の選択値を読み取ります。
 * @param {object} elements - ダイアログ要素群。
 * @returns {object} 選択値。
 */
function readAnimationExportDialogSelection(elements) {
  const exportFormat = elements?.formatVrmaRadio?.checked ? 'vrma' : 'vmd';
  return {
    exportFormat,
    bakeIkToRotation: Boolean(elements?.vrmaIkToRotationRadio?.checked),
    bakeLowerBodyToHumanoid: Boolean(elements?.vrmaLowerBodyBakeRadio?.checked),
  };
}

/**
 * アニメーションエクスポートダイアログを初期化します。
 */
function bindAnimationExportDialog() {
  const elements = getAnimationExportDialogElements();
  if (!elements) {
    return;
  }

  if (animationExportDialogBound && animationExportDialogBoundOverlay === elements.overlay) {
    return;
  }

  animationExportDialogBound = true;
  animationExportDialogBoundOverlay = elements.overlay;
  elements.overlay.addEventListener('click', (event) => {
    if (event.target === elements.overlay) {
      closeAnimationExportDialog(null);
    }
  });

  elements.formatVmdRadio?.addEventListener('change', () => {
    syncAnimationExportDialogVisibility(elements);
  });
  elements.formatVrmaRadio?.addEventListener('change', () => {
    syncAnimationExportDialogVisibility(elements);
  });

  elements.saveButton?.addEventListener('click', () => {
    if (elements.saveButton.disabled) {
      return;
    }
    const selection = readAnimationExportDialogSelection(elements);
    closeAnimationExportDialog(selection);
  });

  animationExportDialogKeydownHandler = (event) => {
    if (event.key === 'Escape' && elements.overlay && !elements.overlay.hidden) {
      closeAnimationExportDialog(null);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', animationExportDialogKeydownHandler);
  }
}

/**
 * アニメーションエクスポートダイアログを表示します。
 * @param {object} options - 表示オプション。
 * @param {object|null} [options.activeInstance=null] - アクティブインスタンス。
 * @param {object} [options.langData={}] - ローカライズ辞書。
 * @param {string} [options.defaultFormat] - 初期選択形式。
 * @param {boolean} [options.defaultBakeIkToRotation=true] - IK の初期ベイク状態。
 * @param {boolean} [options.defaultBakeLowerBodyToHumanoid=true] - 下半身の初期ベイク状態。
 * @returns {Promise<object|null>} 選択結果。キャンセル時は null。
 */
function openAnimationExportDialog(options = {}) {
  const elements = getAnimationExportDialogElements();
  if (!elements) {
    return Promise.resolve(null);
  }

  bindAnimationExportDialog();
  if (animationExportDialogResolver) {
    closeAnimationExportDialog(null);
  }

  const langData = options.langData || {};
  const activeInstance = options.activeInstance || null;
  const defaultFormat = String(options.defaultFormat
    || (activeInstance?.model?.magic === 'Vrm' ? 'vrma' : 'vmd'))
    .trim()
    .toLowerCase() === 'vrma'
    ? 'vrma'
    : 'vmd';
  const defaultBakeIkToRotation = options.defaultBakeIkToRotation !== undefined
    ? Boolean(options.defaultBakeIkToRotation)
    : true;
  const defaultBakeLowerBodyToHumanoid = options.defaultBakeLowerBodyToHumanoid !== undefined
    ? Boolean(options.defaultBakeLowerBodyToHumanoid)
    : true;

  if (elements.title) {
    elements.title.textContent = langData['Animation Export'] || 'Animation Export';
  }
  if (elements.formatLegend) {
    elements.formatLegend.textContent = langData['Export Format'] || 'Export Format';
  }
  if (elements.formatVmdRadio) {
    elements.formatVmdRadio.checked = defaultFormat === 'vmd';
  }
  if (elements.formatVrmaRadio) {
    elements.formatVrmaRadio.checked = defaultFormat === 'vrma';
  }
  if (elements.vrmaIkLegend) {
    elements.vrmaIkLegend.textContent = langData['IK Bake'] || 'IK Bake';
  }
  if (elements.vrmaIkToRotationRadio) {
    elements.vrmaIkToRotationRadio.checked = defaultBakeIkToRotation;
  }
  if (elements.vrmaIkAsIsRadio) {
    elements.vrmaIkAsIsRadio.checked = !defaultBakeIkToRotation;
  }
  if (elements.vrmaLowerBodyLegend) {
    elements.vrmaLowerBodyLegend.textContent = langData['Lower Body Bake'] || 'Lower Body Bake';
  }
  if (elements.vrmaLowerBodyBakeRadio) {
    elements.vrmaLowerBodyBakeRadio.checked = defaultBakeLowerBodyToHumanoid;
  }
  if (elements.vrmaLowerBodySkipRadio) {
    elements.vrmaLowerBodySkipRadio.checked = !defaultBakeLowerBodyToHumanoid;
  }
  if (elements.saveButton) {
    elements.saveButton.textContent = langData.Save || 'Save';
  }

  syncAnimationExportDialogVisibility(elements);
  elements.overlay.hidden = false;
  elements.dialog?.setAttribute('aria-label', elements.title?.textContent || 'Animation Export');
  (elements.formatVrmaRadio?.checked ? elements.formatVrmaRadio : elements.formatVmdRadio)?.focus?.();

  return new Promise((resolve) => {
    animationExportDialogResolver = resolve;
  });
}

/**
 * 削除確認ダイアログの状態を取得します。
 * @returns {object|null} ダイアログ要素群。
 */
function getDeleteConfirmDialogElements() {
  const overlay = document.getElementById('delete-confirm-overlay');
  if (!overlay) {
    return null;
  }

  return {
    overlay,
    dialog: document.getElementById('delete-confirm-dialog'),
    title: document.getElementById('delete-confirm-title'),
    message: document.getElementById('delete-confirm-message'),
    list: document.getElementById('delete-confirm-list'),
    cancelButton: document.getElementById('delete-confirm-cancel'),
    confirmButton: document.getElementById('delete-confirm-confirm'),
  };
}

let deleteConfirmDialogResolver = null;
let deleteConfirmDialogKeydownHandler = null;
let deleteConfirmDialogBound = false;

/**
 * 削除確認ダイアログを閉じます。
 * @param {boolean} result - 確認結果。
 */
function closeDeleteConfirmDialog(result = false) {
  const elements = getDeleteConfirmDialogElements();
  if (elements) {
    elements.overlay.hidden = true;
  }

  const resolver = deleteConfirmDialogResolver;
  deleteConfirmDialogResolver = null;
  if (resolver) {
    resolver(result);
  }
}

/**
 * 削除確認ダイアログを初期化します。
 */
function bindDeleteConfirmDialog() {
  if (deleteConfirmDialogBound) {
    return;
  }

  const elements = getDeleteConfirmDialogElements();
  if (!elements) {
    return;
  }

  deleteConfirmDialogBound = true;
  elements.overlay.addEventListener('click', (event) => {
    if (event.target === elements.overlay) {
      closeDeleteConfirmDialog(false);
    }
  });

  elements.cancelButton?.addEventListener('click', () => {
    closeDeleteConfirmDialog(false);
  });

  elements.confirmButton?.addEventListener('click', () => {
    if (elements.confirmButton.disabled) {
      return;
    }
    closeDeleteConfirmDialog(true);
  });

  deleteConfirmDialogKeydownHandler = (event) => {
    if (event.key === 'Escape' && elements.overlay && !elements.overlay.hidden) {
      closeDeleteConfirmDialog(false);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', deleteConfirmDialogKeydownHandler);
  }
}

/**
 * モーダル形式の削除確認ダイアログを表示します。
 * @param {object} options - 表示オプション。
 * @param {string} options.title - タイトル。
 * @param {string} options.message - メッセージ。
 * @param {string[]} [options.details=[]] - 補足情報の一覧。
 * @param {string} options.confirmLabel - 確認ボタンの文言。
 * @param {string} options.cancelLabel - キャンセルボタンの文言。
 * @param {boolean} [options.confirmDisabled=false] - 確認ボタンを無効化するかどうか。
 * @returns {Promise<boolean>} 確認結果。
 */
function openDeleteConfirmDialog(options) {
  const elements = getDeleteConfirmDialogElements();
  if (!elements) {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return Promise.resolve(window.confirm(options.message));
    }
    return Promise.resolve(false);
  }

  bindDeleteConfirmDialog();
  if (deleteConfirmDialogResolver) {
    closeDeleteConfirmDialog(false);
  }

  const {
    title,
    message,
    details = [],
    confirmLabel,
    cancelLabel,
    confirmDisabled = false,
  } = options;

  if (elements.title) {
    elements.title.textContent = title;
  }
  if (elements.message) {
    elements.message.textContent = message;
  }
  if (elements.list) {
    elements.list.innerHTML = '';
    details.forEach((detail) => {
      const item = document.createElement('li');
      item.textContent = detail;
      elements.list.appendChild(item);
    });
    elements.list.hidden = details.length === 0;
  }
  if (elements.confirmButton) {
    elements.confirmButton.textContent = confirmLabel;
    elements.confirmButton.disabled = confirmDisabled;
  }
  if (elements.cancelButton) {
    elements.cancelButton.textContent = cancelLabel;
  }
  elements.overlay.hidden = false;
  elements.cancelButton?.focus();

  return new Promise((resolve) => {
    deleteConfirmDialogResolver = resolve;
  });
}

/**
 * VMD 一覧 UI を更新します。
 * @param {object} animationListState - 描画用 animation 一覧 state。
 * @param {object} langData - ローカライズ辞書。
 */
export function updateVmdListUI(animationListState, langData) {
  const listEl = document.getElementById('vmd-list');
  const deleteButton = document.getElementById('delete-vmd');
  if (!listEl) {
    return;
  }

  listEl.innerHTML = '';
  listEl.setAttribute('aria-label', langData['Loaded Animations'] || 'Loaded Animations');
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = langData.None || 'None';
  listEl.appendChild(noneOption);

  for (const entry of animationListState?.entries || []) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    listEl.appendChild(option);
  }
  listEl.value = String(animationListState?.selectedValue || '');

  if (deleteButton) {
    deleteButton.disabled = !animationListState?.canDeleteSelected;
    deleteButton.title = langData['Delete VMD'] || langData.Delete || 'Delete';
    deleteButton.setAttribute('aria-label', langData['Delete VMD'] || langData.Delete || 'Delete');
  }
}

/**
 * DOM の数値入力を読み取ります。
 * @param {HTMLElement|null} element - 数値入力。
 * @param {number} fallback - 入力が取得できない場合の既定値。
 * @returns {number} 読み取った値。
 */
function readNumberValue(element, fallback) {
  return readNumericInputValue(element, fallback);
}

/**
 * 数値入力ペアの max 属性を同期します。
 * @param {HTMLInputElement|null} rangeInput - range 入力。
 * @param {HTMLInputElement|null} valueInput - number 入力。
 * @param {number} maxValue - 上限値。
 * @returns {void}
 */
function syncNumericInputBounds(rangeInput, valueInput, maxValue) {
  const normalizedMax = Number.isFinite(maxValue) && maxValue >= 0 ? maxValue : 10.0;
  const maxString = String(normalizedMax);
  if (rangeInput) {
    rangeInput.max = maxString;
  }
  if (valueInput) {
    valueInput.max = maxString;
  }
}

/**
 * DOM の選択値を読み取ります。
 * @param {HTMLElement|null} element - セレクト要素。
 * @param {string} fallback - 入力が取得できない場合の既定値。
 * @returns {string} 読み取った値。
 */
function readSelectValue(element, fallback) {
  if (!element || !('value' in element)) {
    return fallback;
  }
  return element.value || fallback;
}

/**
 * アスペクト比セレクタの値を読み取ります。
 * @param {HTMLElement|null} element - セレクト要素。
 * @param {string} fallback - 入力が取得できない場合の既定値。
 * @returns {string} 読み取ったアスペクト比 ID。
 */
function readAspectRatioValue(element, fallback) {
  const selected = readSelectValue(element, fallback);
  return findAspectPreset(selected).id;
}

/**
 * 内部解像度セレクタの値を読み取ります。
 * @param {HTMLElement|null} element - セレクト要素。
 * @param {string} fallback - 入力が取得できない場合の既定値。
 * @returns {string} 読み取った内部解像度。
 */
function readInternalResolutionValue(element, fallback) {
  return readSelectValue(element, fallback);
}

/**
 * 再生範囲の UI を現在のコントローラー状態へ同期します。
 * @param {{start?: number, end?: number|null}|null} playbackRange - 再生範囲。
 */
export function syncPlaybackRangeUI(playbackRange) {
  const startInput = document.getElementById('playback-range-start');
  const endInput = document.getElementById('playback-range-end');
  if (!startInput || !endInput) {
    return;
  }

  const range = playbackRange && typeof playbackRange === 'object'
    ? playbackRange
    : { start: 0, end: null };
  syncNumericInputValue(startInput, Math.round(range.start ?? 0), {
    force: false,
    format: (value) => String(Math.round(value)),
  });
  if (!isNumericInputFocused(endInput)) {
    endInput.value = Number.isFinite(range.end) ? String(Math.round(range.end)) : '';
  }
}

/**
 * 再生範囲ラベルとプレースホルダーを現在の言語へ同期します。
 * @param {object} [langData={}] - ローカライズ辞書。
 */
export function syncPlaybackRangeLabels(langData = {}) {
  const startInput = document.getElementById('playback-range-start');
  const startLabel = startInput?.previousElementSibling || null;
  const endInput = document.getElementById('playback-range-end');
  if (startLabel) {
    startLabel.textContent = langData['Playback Range'] || 'Playback Range';
  }
  if (endInput) {
    endInput.placeholder = langData.Unset || 'Unset';
  }
}

const VIDEO_EXPORT_CODEC_LABELS = Object.freeze({
  avc: 'H.264 (AVC)',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  av1: 'AV1',
  vp8: 'VP8',
});

const VIDEO_EXPORT_FORMAT_LABELS = Object.freeze({
  mp4: 'MP4',
  webm: 'WebM',
  mov: 'MOV',
  mkv: 'MKV',
});

const VIDEO_EXPORT_QUALITY_LABELS = Object.freeze({
  'very-low': 'Very Low',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'very-high': 'Very High',
});

/**
 * 動画書き出し入力の値を読み取ります。
 * @returns {{format: string, codec: string, quality: string, width: number, height: number, includeAudio: boolean, transparentBackground: boolean}} 動画書き出し設定。
 */
export function readVideoExportUIValues() {
  const formatSelect = document.getElementById('video-export-format');
  const codecSelect = document.getElementById('video-export-codec');
  const qualitySelect = document.getElementById('video-export-quality');
  const widthInput = document.getElementById('video-export-width');
  const heightInput = document.getElementById('video-export-height');
  const includeAudioCheckbox = document.getElementById('video-export-include-audio');
  const transparentBackgroundCheckbox = document.getElementById('video-export-transparent-background');
  const format = normalizeVideoExportFormat(formatSelect?.value);
  return {
    format,
    codec: normalizeVideoExportCodec(codecSelect?.value),
    quality: normalizeVideoExportQuality(qualitySelect?.value),
    width: readNumberValue(widthInput, 1280),
    height: readNumberValue(heightInput, 720),
    includeAudio: Boolean(includeAudioCheckbox?.checked && !includeAudioCheckbox?.disabled),
    transparentBackground: normalizeVideoExportTransparentBackground(format, transparentBackgroundCheckbox?.checked),
  };
}

/**
 * 動画書き出しタブの codec 選択肢を更新します。
 * @param {object} options - 更新オプション。
 * @param {object} options.videoExportManager - VideoExportManager。
 * @param {HTMLSelectElement|null} options.formatSelect - フォーマット選択。
 * @param {HTMLSelectElement|null} options.codecSelect - codec 選択。
 * @param {HTMLSelectElement|null} options.qualitySelect - quality 選択。
 * @param {HTMLInputElement|null} options.widthInput - 幅入力。
 * @param {HTMLInputElement|null} options.heightInput - 高さ入力。
 * @returns {Promise<void>} 完了 Promise。
 */
export async function syncVideoExportCodecOptions(options) {
  const {
    videoExportManager,
    formatSelect,
    codecSelect,
    qualitySelect,
    widthInput,
    heightInput,
  } = options;

  if (!videoExportManager || !formatSelect || !codecSelect) {
    return;
  }

  const format = normalizeVideoExportFormat(formatSelect.value);
  const quality = normalizeVideoExportQuality(qualitySelect?.value);
  const width = readNumberValue(widthInput, 1280);
  const height = readNumberValue(heightInput, 720);
  codecSelect.disabled = true;
  codecSelect.innerHTML = '';

  const allowedCodecs = filterVideoExportCodecsForFormat(format);
  let availableCodecs = allowedCodecs;
  try {
    availableCodecs = await videoExportManager.getAvailableCodecs({ format, width, height, quality });
  } catch (error) {
    console.warn('Failed to probe video codecs, falling back to static compatibility list.', error);
    availableCodecs = allowedCodecs;
  }

  const candidates = availableCodecs.length > 0 ? availableCodecs : allowedCodecs;
  candidates.forEach((codec) => {
    const option = document.createElement('option');
    option.value = codec;
    option.textContent = VIDEO_EXPORT_CODEC_LABELS[codec] || codec.toUpperCase();
    codecSelect.appendChild(option);
  });

  const fallbackCodec = candidates[0] || 'avc';
  const currentCodec = normalizeVideoExportCodec(codecSelect.dataset.selectedCodec || codecSelect.value || fallbackCodec);
  const nextCodec = candidates.includes(currentCodec) ? currentCodec : fallbackCodec;
  codecSelect.value = nextCodec;
  codecSelect.dataset.selectedCodec = nextCodec;
  codecSelect.disabled = candidates.length === 0;
}

/**
 * 動画書き出し UI を初期化します。
 * @param {object} options - 初期化オプション。
 * @returns {{readValues: function(): object, applyValues: function(object): Promise<void>}|undefined} 内部用 API。
 */
export function setupVideoExportUI(options) {
  const {
    videoExportManager,
    appFacade,
    getPlaybackRange,
    rendererState,
    getLangData,
    bgmManager,
  } = options;

  const formatSelect = document.getElementById('video-export-format');
  const codecSelect = document.getElementById('video-export-codec');
  const qualitySelect = document.getElementById('video-export-quality');
  const widthInput = document.getElementById('video-export-width');
  const heightInput = document.getElementById('video-export-height');
  const transparentBackgroundCheckbox = document.getElementById('video-export-transparent-background');
  const savePngButton = document.getElementById('video-export-save-png-button');
  const includeAudioCheckbox = document.getElementById('video-export-include-audio');
  const exportButton = document.getElementById('video-export-button');
  const cancelButton = document.getElementById('video-export-cancel');
  const overlay = document.getElementById('video-export-overlay');
  const progressBar = document.getElementById('video-export-progress');
  const progressLabel = document.getElementById('video-export-progress-label');
  const statusLabel = document.getElementById('video-export-status');
  const viewportCanvas = document.querySelector('#viewport canvas');

  if (!videoExportManager || !formatSelect || !codecSelect || !qualitySelect || !widthInput || !heightInput || !transparentBackgroundCheckbox || !savePngButton || !includeAudioCheckbox || !exportButton || !cancelButton || !overlay || !progressBar || !progressLabel || !statusLabel) {
    return;
  }

  /**
   * 動画書き出しオーバーレイを切り替えます。
   * @param {boolean} visible - 表示状態。
   */
  function setOverlayVisible(visible) {
    overlay.hidden = !visible;
    document.body.classList.toggle('is-video-exporting', visible);
    exportButton.disabled = visible;
    cancelButton.disabled = !visible;
  }

  /**
   * ローカライズ済みの文言を取得します。
   * @param {string} key - 文言キー。
   * @returns {string} 文言。
   */
  function t(key) {
    const langData = typeof getLangData === 'function' ? getLangData() : null;
    return langData?.[key] || key;
  }

  /**
   * 幅/高さ入力を現在のレンダラー解像度に同期します。
   */
  function syncSizeInputsFromRenderer() {
    const resolution = rendererState?.internalResolution || 'auto';
    const fallbackWidth = viewportCanvas?.clientWidth || viewportCanvas?.width || 1280;
    const fallbackHeight = viewportCanvas?.clientHeight || viewportCanvas?.height || 720;
    let width = fallbackWidth;
    let height = fallbackHeight;

    if (resolution !== 'auto') {
      const parts = String(resolution).split('x');
      if (parts.length === 2) {
        const parsedWidth = Number.parseInt(parts[0], 10);
        const parsedHeight = Number.parseInt(parts[1], 10);
        if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight)) {
          width = parsedWidth;
          height = parsedHeight;
        }
      }
    }

    syncNumericInputValue(widthInput, width, {
      force: false,
      format: (value) => String(Math.round(value)),
    });
    syncNumericInputValue(heightInput, height, {
      force: false,
      format: (value) => String(Math.round(value)),
    });
  }

  /**
   * BGM の有無に合わせて音声出力チェックボックスを同期します。
   * @param {object} [state] - BGM state。
   */
  function syncBgmExportUi(state = bgmManager?.getState?.() ?? { hasSource: false }) {
    const hasSource = Boolean(state?.hasSource);
    const wasDisabled = includeAudioCheckbox.disabled;
    includeAudioCheckbox.disabled = !hasSource;
    if (!hasSource) {
      includeAudioCheckbox.checked = false;
    } else if (wasDisabled) {
      includeAudioCheckbox.checked = true;
    }
    includeAudioCheckbox.dataset.wasDisabled = String(wasDisabled);
  }

  /**
   * コーデック選択を更新します。
   */
  async function refreshCodecSelect() {
    await syncVideoExportCodecOptions({
      videoExportManager,
      formatSelect,
      codecSelect,
      qualitySelect,
      widthInput,
      heightInput,
    });
    syncTransparentBackgroundUi();
  }

  /**
   * 値を export UI に反映します。
   * @param {object} nextValues - 適用値。
   * @returns {Promise<void>} 完了 Promise。
   */
  async function applyValues(nextValues = {}) {
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(nextValues, key);

    if (hasOwn('format')) {
      formatSelect.value = normalizeVideoExportFormat(nextValues.format);
    }
    if (hasOwn('quality')) {
      qualitySelect.value = normalizeVideoExportQuality(nextValues.quality);
    }
    if (hasOwn('width') && Number.isFinite(Number(nextValues.width))) {
      syncNumericInputValue(widthInput, Math.max(1, Math.round(Number(nextValues.width))), {
        force: true,
        format: (value) => String(Math.round(value)),
      });
    }
    if (hasOwn('height') && Number.isFinite(Number(nextValues.height))) {
      syncNumericInputValue(heightInput, Math.max(1, Math.round(Number(nextValues.height))), {
        force: true,
        format: (value) => String(Math.round(value)),
      });
    }

    syncBgmExportUi();
    await refreshCodecSelect();

    if (hasOwn('codec')) {
      const normalizedCodec = normalizeVideoExportCodec(nextValues.codec);
      if (Array.from(codecSelect.options).some((option) => option.value === normalizedCodec)) {
        codecSelect.value = normalizedCodec;
        codecSelect.dataset.selectedCodec = normalizedCodec;
      }
    }
    if (hasOwn('includeAudio')) {
      includeAudioCheckbox.checked = Boolean(nextValues.includeAudio) && !includeAudioCheckbox.disabled;
    }

    syncTransparentBackgroundUi();
    if (hasOwn('transparentBackground')) {
      transparentBackgroundCheckbox.checked = normalizeVideoExportTransparentBackground(
        normalizeVideoExportFormat(formatSelect.value),
        Boolean(nextValues.transparentBackground),
      );
    }
  }

  /**
   * 背景透過チェックの有効状態を同期します。
   */
  function syncTransparentBackgroundUi() {
    const format = normalizeVideoExportFormat(formatSelect.value);
    const supported = supportsVideoExportTransparency(format);
    transparentBackgroundCheckbox.disabled = !supported;
    if (!supported) {
      transparentBackgroundCheckbox.checked = false;
    }
  }

  /**
   * オーバーレイに進捗を反映します。
   * @param {number} progress - 0..1 の進捗。
   * @param {string} [message] - 補助テキスト。
   */
  function updateProgress(progress, message = '') {
    const clamped = Math.min(1, Math.max(0, progress));
    progressBar.value = String(Math.round(clamped * 1000) / 10);
    progressLabel.textContent = `${Math.round(clamped * 100)}%`;
    statusLabel.textContent = message || '';
  }

  /**
   * UI lock を切り替えます。
   * @param {boolean} locked - ロック状態。
   */
  function setUiLock(locked) {
    if (locked) {
      setOverlayVisible(true);
      updateProgress(0, '');
      statusLabel.textContent = t('Exporting...');
      savePngButton.disabled = true;
      return;
    }

    setOverlayVisible(false);
    updateProgress(0, '');
    statusLabel.textContent = '';
    savePngButton.disabled = false;
  }

  let codecRefreshTimer = null;

  /**
   * codec 更新を少し遅延させます。
   */
  function scheduleCodecRefresh() {
    if (codecRefreshTimer !== null) {
      window.clearTimeout(codecRefreshTimer);
    }
    codecRefreshTimer = window.setTimeout(() => {
      codecRefreshTimer = null;
      void refreshCodecSelect();
    }, 180);
  }

  /**
   * 動画を書き出します。
   */
  async function startExport() {
    if (videoExportManager.isExporting) {
      return;
    }

    const format = normalizeVideoExportFormat(formatSelect.value);
    const codec = normalizeVideoExportCodec(codecSelect.value);
    const quality = normalizeVideoExportQuality(qualitySelect.value);
    const width = Math.max(1, Math.round(readNumberValue(widthInput, viewportCanvas?.width || 1280)));
    const height = Math.max(1, Math.round(readNumberValue(heightInput, viewportCanvas?.height || 720)));
    const transparentBackground = normalizeVideoExportTransparentBackground(format, transparentBackgroundCheckbox.checked);
    const playbackRange = getPlaybackRange?.()
      ?? appFacade?.playback?.getPlaybackRange?.()
      ?? { start: 0, end: null };
    const activeInstance = appFacade?.editing?.getActiveInstance?.() ?? null;
    const endFrame = Number.isFinite(playbackRange.end)
      ? playbackRange.end
      : (activeInstance?.animationController?.maxFrame ?? playbackRange.start);
    const exportFps = Math.max(1, Number.parseInt(String(rendererState?.renderingFPS ?? 60), 10) || 60);

    try {
      const result = await videoExportManager.exportVideo({
        format,
        codec,
        quality,
        width,
        height,
        exportFps,
        startFrame: playbackRange.start ?? 0,
        endFrame,
        includeAudio: includeAudioCheckbox.checked,
        transparentBackground,
        onProgress: updateProgress,
        onUiLockChange: setUiLock,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Video export failed:', error);
      if (error && String(error.message || error).includes('canceled')) {
        return;
      }
      alert(`Video export failed: ${error?.message || error}`);
    } finally {
      setUiLock(false);
    }
  }

  /**
   * Mediabunny の quality 選択肢を更新します。
   */
  function syncQualitySelect() {
    const currentValue = normalizeVideoExportQuality(qualitySelect.value);
    qualitySelect.innerHTML = '';
    VIDEO_EXPORT_QUALITY_ORDER.forEach((quality) => {
      const option = document.createElement('option');
      option.value = quality;
      option.textContent = VIDEO_EXPORT_QUALITY_LABELS[quality] || quality;
      if (quality === currentValue) {
        option.selected = true;
      }
      qualitySelect.appendChild(option);
    });
    if (!qualitySelect.value) {
      qualitySelect.value = 'medium';
    }
  }

  /**
   * 現在フレームを PNG で保存します。
   */
  async function saveCurrentFrameAsPng() {
    if (videoExportManager.isExporting) {
      return;
    }

    const width = Math.max(1, Math.round(readNumberValue(widthInput, viewportCanvas?.width || 1280)));
    const height = Math.max(1, Math.round(readNumberValue(heightInput, viewportCanvas?.height || 720)));

    savePngButton.disabled = true;
    try {
      const result = await videoExportManager.saveCurrentFrameAsPng({ width, height });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PNG save failed:', error);
      alert(`PNG save failed: ${error?.message || error}`);
    } finally {
      savePngButton.disabled = false;
    }
  }

  const formatOptions = Array.from(formatSelect.options);
  formatSelect.innerHTML = '';
  for (const option of formatOptions) {
    const normalized = normalizeVideoExportFormat(option.value || option.textContent || '');
    const nextOption = document.createElement('option');
    nextOption.value = normalized;
    nextOption.textContent = VIDEO_EXPORT_FORMAT_LABELS[normalized] || option.textContent || normalized.toUpperCase();
    if (option.selected) {
      nextOption.selected = true;
    }
    formatSelect.appendChild(nextOption);
  }
  if (!formatSelect.value) {
    formatSelect.value = 'mp4';
  }

  syncSizeInputsFromRenderer();
  syncQualitySelect();
  void refreshCodecSelect();

  /**
   * レンダリングサイズ変更に応じて export UI を再同期します。
   */
  function handleRenderResolutionChange() {
    syncSizeInputsFromRenderer();
    scheduleCodecRefresh();
  }

  window.addEventListener('render-resolution-changed', handleRenderResolutionChange);

  formatSelect.addEventListener('change', () => {
    syncTransparentBackgroundUi();
    scheduleCodecRefresh();
  });
  qualitySelect.addEventListener('change', () => {
    scheduleCodecRefresh();
  });
  widthInput.addEventListener('input', () => {
    scheduleCodecRefresh();
  });
  heightInput.addEventListener('input', () => {
    scheduleCodecRefresh();
  });
  codecSelect.addEventListener('change', () => {
    codecSelect.dataset.selectedCodec = codecSelect.value;
  });
  savePngButton.addEventListener('click', () => {
    void saveCurrentFrameAsPng();
  });
  exportButton.addEventListener('click', () => {
    void startExport();
  });
  includeAudioCheckbox.addEventListener('change', () => {
    if (includeAudioCheckbox.disabled) {
      includeAudioCheckbox.checked = false;
    }
  });
  transparentBackgroundCheckbox.addEventListener('change', () => {
    if (transparentBackgroundCheckbox.disabled) {
      transparentBackgroundCheckbox.checked = false;
    }
  });
  cancelButton.addEventListener('click', () => {
    videoExportManager.cancel();
    statusLabel.textContent = t('Canceling...');
  });

  setUiLock(false);
  syncBgmExportUi();
  syncTransparentBackgroundUi();

  if (bgmManager) {
    bgmManager.refreshExportUi = syncBgmExportUi;
  }

  return {
    readValues: () => readVideoExportUIValues(),
    applyValues,
  };
}

/**
 * 再生範囲の UI 入力を読み取ります。
 * @param {HTMLInputElement|null} startInput - 開始フレーム入力。
 * @param {HTMLInputElement|null} endInput - 終了フレーム入力。
 * @returns {{start: number, end: number|null}} 読み取った再生範囲。
 */
function readPlaybackRangeInputs(startInput, endInput) {
  const start = startInput ? Number.parseFloat(startInput.value) : 0;
  const endText = endInput ? endInput.value.trim() : '';
  const end = endText === '' ? null : Number.parseFloat(endText);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: endText === '' ? null : (Number.isFinite(end) ? end : null),
  };
}

/**
 * ポストエフェクト UI の初期値を defaults.json から読み取ります。
 * @returns {{bloomEnabled: boolean, dofEnabled: boolean, colorTemperature: number, gamma: number, chromaticAberration: number, filmGrainAmount: number, filmGrainAnimationMode: string, bloomThreshold: number, bloomBlurAmount: number, bloomAlpha: number, bloomShadowMultiplier: number, gltfLightStrength: number, contactShadowEnabled: boolean, contactShadowLength: number, contactShadowThickness: number, contactShadowIntensity: number, contactShadowBlurAmount: number, contactShadowStepCount: number, ambientOcclusionEnabled: boolean, ambientOcclusionRadius: number, ambientOcclusionBias: number, ambientOcclusionIntensity: number, ambientOcclusionBlurAmount: number, ambientOcclusionSampleCount: number, dofBlurAmount: number, dofAlgorithm: string, dofFStop: number, dofFocusPoint: number[], sssEnabled: boolean, sssRadius: number, sssDepthThreshold: number, sssNormalThreshold: number, sssStrength: number}} UI 初期値。
 */
export function readPostEffectUIInitialValues(defaults = getDefaultsSnapshot('postEffectUi')) {
  const postEffectDefaults = defaults?.postEffectUi ?? defaults;
  const appStateDefaults = defaults?.appState ?? getDefaultsSnapshot('appState');
  const bloomThresholdMax = getEnvironmentHdrIntensityMax(appStateDefaults);
  return {
    bloomEnabled: Boolean(postEffectDefaults.bloomEnabled),
    dofEnabled: Boolean(postEffectDefaults.dofEnabled),
    colorTemperature: Number.isFinite(postEffectDefaults.colorTemperature) ? postEffectDefaults.colorTemperature : 6500,
    gamma: Number.isFinite(postEffectDefaults.gamma) ? postEffectDefaults.gamma : 1.0,
    chromaticAberration: Number.isFinite(postEffectDefaults.chromaticAberration) ? postEffectDefaults.chromaticAberration : 0,
    filmGrainAmount: Number.isFinite(postEffectDefaults.filmGrainAmount) ? postEffectDefaults.filmGrainAmount : 0,
    filmGrainAnimationMode: postEffectDefaults.filmGrainAnimationMode === 'always'
      ? 'always'
      : 'timeline',
    bloomThreshold: Math.min(bloomThresholdMax, Math.max(0.0, Number.isFinite(postEffectDefaults.bloomThreshold) ? postEffectDefaults.bloomThreshold : 0.98)),
    bloomBlurAmount: Number.isFinite(postEffectDefaults.bloomBlurAmount) ? postEffectDefaults.bloomBlurAmount : 2,
    bloomAlpha: Number.isFinite(postEffectDefaults.bloomAlpha) ? postEffectDefaults.bloomAlpha : 1,
    bloomShadowMultiplier: Number.isFinite(postEffectDefaults.bloomShadowMultiplier) ? postEffectDefaults.bloomShadowMultiplier : 0,
    gltfLightStrength: Number.isFinite(postEffectDefaults.gltfLightStrength) ? postEffectDefaults.gltfLightStrength : 1,
    ambientOcclusionEnabled: Boolean(postEffectDefaults.ambientOcclusionEnabled),
    ambientOcclusionRadius: Number.isFinite(postEffectDefaults.ambientOcclusionRadius) ? postEffectDefaults.ambientOcclusionRadius : 0.4,
    ambientOcclusionBias: Number.isFinite(postEffectDefaults.ambientOcclusionBias) ? postEffectDefaults.ambientOcclusionBias : 0.02,
    ambientOcclusionIntensity: Number.isFinite(postEffectDefaults.ambientOcclusionIntensity) ? postEffectDefaults.ambientOcclusionIntensity : 1,
    ambientOcclusionBlurAmount: Number.isFinite(postEffectDefaults.ambientOcclusionBlurAmount) ? postEffectDefaults.ambientOcclusionBlurAmount : 1,
    ambientOcclusionSampleCount: Number.isFinite(postEffectDefaults.ambientOcclusionSampleCount) ? postEffectDefaults.ambientOcclusionSampleCount : 12,
    contactShadowEnabled: Boolean(postEffectDefaults.contactShadowEnabled),
    contactShadowLength: Number.isFinite(postEffectDefaults.contactShadowLength) ? postEffectDefaults.contactShadowLength : 0.08,
    contactShadowThickness: Number.isFinite(postEffectDefaults.contactShadowThickness) ? postEffectDefaults.contactShadowThickness : 0.01,
    contactShadowIntensity: Number.isFinite(postEffectDefaults.contactShadowIntensity) ? postEffectDefaults.contactShadowIntensity : 0.55,
    contactShadowBlurAmount: Number.isFinite(postEffectDefaults.contactShadowBlurAmount) ? postEffectDefaults.contactShadowBlurAmount : 1,
    contactShadowStepCount: Number.isFinite(postEffectDefaults.contactShadowStepCount) ? postEffectDefaults.contactShadowStepCount : 8,
    dofBlurAmount: Number.isFinite(postEffectDefaults.dofBlurAmount) ? postEffectDefaults.dofBlurAmount : 2,
    dofAlgorithm: typeof postEffectDefaults.dofAlgorithm === 'string' ? postEffectDefaults.dofAlgorithm : 'fast',
    dofFStop: Number.isFinite(postEffectDefaults.dofFStop) ? postEffectDefaults.dofFStop : 2.8,
    dofFocusPoint: Array.isArray(postEffectDefaults.dofFocusPoint) ? [...postEffectDefaults.dofFocusPoint] : [0.0, 0.0, 0.0],
    sssEnabled: Boolean(postEffectDefaults.sssEnabled),
    sssRadius: Number.isFinite(postEffectDefaults.sssRadius) ? postEffectDefaults.sssRadius : 1.5,
    sssDepthThreshold: Number.isFinite(postEffectDefaults.sssDepthThreshold) ? postEffectDefaults.sssDepthThreshold : 0.01,
    sssNormalThreshold: Number.isFinite(postEffectDefaults.sssNormalThreshold) ? postEffectDefaults.sssNormalThreshold : 0.2,
    sssStrength: Number.isFinite(postEffectDefaults.sssStrength) ? postEffectDefaults.sssStrength : 0.2,
  };
}

/**
 * 床グリッド UI の初期値を defaults.json から読み取ります。
 * @param {object} [defaults=getDefaultsSnapshot('gridOverlay')] - フォールバック既定値。
 * @returns {{size: number, count: number, thickness: number}} UI 初期値。
 */
export function readGridOverlayUIInitialValues(defaults = getDefaultsSnapshot('gridOverlay')) {
  const gridDefaults = defaults?.gridOverlay ?? defaults;
  return {
    size: Number.isFinite(gridDefaults.size) ? gridDefaults.size : 0.5,
    count: Math.round(Number.isFinite(gridDefaults.count) ? gridDefaults.count : 10),
    thickness: Math.max(0.1, Number.isFinite(gridDefaults.thickness) ? gridDefaults.thickness : 1.0),
  };
}

/**
 * 描画設定 UI の初期値を defaults.json から読み取ります。
 * @returns {{shadowPower: number, shadowBias: number, shadowStrength: number, shadowMapSize: number, shadowFarAuto: boolean, shadowFar: number, ambientOcclusionEnabled: boolean, ambientOcclusionRadius: number, ambientOcclusionBias: number, ambientOcclusionIntensity: number, ambientOcclusionBlurAmount: number, ambientOcclusionSampleCount: number, contactShadowEnabled: boolean, contactShadowLength: number, contactShadowThickness: number, contactShadowIntensity: number, contactShadowBlurAmount: number, contactShadowStepCount: number, aaMethod: string, renderingFPS: number, viewTransform: string, displayColorSpace: string, aspectRatio: string, internalResolution: string, msaaSampleCount: number, edgeOpacity: number}} UI 初期値。
 */
export function readRenderUIInitialValues(defaults = getDefaultsSnapshot('renderUi')) {
  const renderDefaults = defaults?.renderUi ?? defaults;
  return {
    shadowPower: Number.isFinite(renderDefaults.shadowPower) ? renderDefaults.shadowPower : 1.0,
    shadowBias: Number.isFinite(renderDefaults.shadowBias) ? renderDefaults.shadowBias : 0.008,
    shadowStrength: Number.isFinite(renderDefaults.shadowStrength) ? renderDefaults.shadowStrength : 1.0,
    shadowMapSize: Number.isFinite(renderDefaults.shadowMapSize) ? renderDefaults.shadowMapSize : 1024,
    shadowFarAuto: Boolean(renderDefaults.shadowFarAuto),
    shadowFar: Number.isFinite(renderDefaults.shadowFar) ? renderDefaults.shadowFar : 1000,
    ambientOcclusionEnabled: Boolean(renderDefaults.ambientOcclusionEnabled),
    ambientOcclusionRadius: Number.isFinite(renderDefaults.ambientOcclusionRadius) ? renderDefaults.ambientOcclusionRadius : 0.4,
    ambientOcclusionBias: Number.isFinite(renderDefaults.ambientOcclusionBias) ? renderDefaults.ambientOcclusionBias : 0.02,
    ambientOcclusionIntensity: Number.isFinite(renderDefaults.ambientOcclusionIntensity) ? renderDefaults.ambientOcclusionIntensity : 1,
    ambientOcclusionBlurAmount: Number.isFinite(renderDefaults.ambientOcclusionBlurAmount) ? renderDefaults.ambientOcclusionBlurAmount : 1,
    ambientOcclusionSampleCount: Number.isFinite(renderDefaults.ambientOcclusionSampleCount) ? renderDefaults.ambientOcclusionSampleCount : 12,
    contactShadowEnabled: Boolean(renderDefaults.contactShadowEnabled),
    contactShadowLength: Number.isFinite(renderDefaults.contactShadowLength) ? renderDefaults.contactShadowLength : 0.08,
    contactShadowThickness: Number.isFinite(renderDefaults.contactShadowThickness) ? renderDefaults.contactShadowThickness : 0.01,
    contactShadowIntensity: Number.isFinite(renderDefaults.contactShadowIntensity) ? renderDefaults.contactShadowIntensity : 0.55,
    contactShadowBlurAmount: Number.isFinite(renderDefaults.contactShadowBlurAmount) ? renderDefaults.contactShadowBlurAmount : 1,
    contactShadowStepCount: Number.isFinite(renderDefaults.contactShadowStepCount) ? renderDefaults.contactShadowStepCount : 8,
    aaMethod: typeof renderDefaults.aaMethod === 'string' ? renderDefaults.aaMethod : 'msaa4',
    renderingFPS: Number.isFinite(renderDefaults.renderingFPS) ? renderDefaults.renderingFPS : 60,
    viewTransform: typeof renderDefaults.viewTransform === 'string' ? renderDefaults.viewTransform : 'standard',
    displayColorSpace: typeof renderDefaults.displayColorSpace === 'string' ? renderDefaults.displayColorSpace : 'srgb',
    aspectRatio: typeof renderDefaults.aspectRatio === 'string' ? findAspectPreset(renderDefaults.aspectRatio).id : '16:9',
    internalResolution: typeof renderDefaults.internalResolution === 'string' ? renderDefaults.internalResolution : 'auto',
    msaaSampleCount: typeof renderDefaults.aaMethod === 'string' && renderDefaults.aaMethod.includes('msaa4') ? 4 : 1,
    edgeOpacity: Number.isFinite(renderDefaults.edgeOpacity) ? renderDefaults.edgeOpacity : 0.5,
  };
}

/**
 * ポストエフェクト UI を初期化します。
 * @param {object} options - 初期化オプション。
 * @param {Function} [options.onColorTemperaturePickToggle] - 色温度スポイトのトグル時コールバック。
 * @returns {{colorTemperaturePickButton: HTMLButtonElement|null, syncColorTemperatureInput: function(number=, boolean=): void, sync: function, dispose: function, service: object, uiState: object}} 参照要素。
 */
export function setupPostEffectUI(options) {
  const documentRef = options.documentRef ?? globalThis.document;
  const service = createPostEffectPanelService({
    rendererState: options.state,
  });
  const uiState = bindPostEffectUiState(documentRef);
  const controller = installPostEffectPanelController({
    uiState,
    service,
    onChanged: options.onChanged,
    onColorTemperaturePickToggle: options.onColorTemperaturePickToggle,
    includeShadowControls: options.includeShadowControls,
    syncNumericInputBounds,
  });
  return {
    ...controller,
    service,
    uiState,
  };
}

let currentMorphSliders = [];
const VRM_MORPH_GROUP_IDS = Object.freeze([
  'vrm-morph-group-emotion',
  'vrm-morph-group-lip-sync',
  'vrm-morph-group-blink',
  'vrm-morph-group-look-at',
  'vrm-morph-group-other',
  'vrm-morph-group-custom',
]);

/**
 * モーフ UI を構築します。
 * @param {object} model - モデルデータ。
 * @param {object} morphController - モーフコントローラー。
 */
export function createMorphUI(model, morphController) {
  currentMorphSliders = [];
  clearMorphContainers();
  toggleMorphUiMode(model);

  const morphs = model.morphs || [];
  morphs.forEach((morph, index) => {
    const container = resolveMorphContainer(model, morph);
    if (!container) {
      return;
    }
    const keyable = !isVrmNonAnimatableUiMorph(morph);
    const item = createMorphItem(morph, index, morphController, keyable);
    container.appendChild(item.item);
    currentMorphSliders.push({
      input: item.input,
      index,
      container,
    });
  });
}

/**
 * モーフ UI を空状態へ戻します。
 */
export function clearMorphUI() {
  clearMorphContainers();
  toggleMorphUiMode(null);
}

/**
 * 表情スライダーの値を同期します。
 * @param {object} morphController - モーフコントローラー。
 * @param {Set<number>} activeMorphIndices - VMDにキーが存在する表情のインデックス集合。
 */
export function syncMorphSliders(morphController, activeMorphIndices) {
  if (!morphController || currentMorphSliders.length === 0) return;

  for (const item of currentMorphSliders) {
    const input = item.input;
    
    // ユーザーがドラッグ中の場合はスキップ
    if (input.matches(':active')) continue;

    const isVmdActive = activeMorphIndices && activeMorphIndices.has(item.index);
    const details = item.container.closest('details');
    const isVisible = details && details.open;

    // VMDでキーがあるか、パネルが開いている場合のみ同期
    if (isVmdActive || isVisible) {
      const manual = morphController.getManualWeight(item.index);
      const weight = manual >= 0 ? manual : morphController.getWeight(item.index);
      
      const valString = weight.toFixed(2);
      if (input.value !== valString) {
        input.value = valString;
      }
    }
  }
}

/**
 * モーフコンテナを全消去します。
 */
function clearMorphContainers() {
  for (let i = 1; i <= 4; i++) {
    const container = document.getElementById(`morph-group-${i}`);
    if (container) {
      container.innerHTML = '';
    }
  }
  for (const containerId of VRM_MORPH_GROUP_IDS) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '';
    }
  }
}

/**
 * モデル種別に応じて Morph UI の表示モードを切り替えます。
 * @param {object} model - モデルデータ。
 */
function toggleMorphUiMode(model) {
  const mmdMorphGroups = document.getElementById('mmd-morph-groups');
  const vrmMorphGroups = document.getElementById('vrm-morph-groups');
  const isVrmModel = String(model?.magic || '').trim() === 'Vrm';
  if (mmdMorphGroups) {
    mmdMorphGroups.hidden = isVrmModel;
  }
  if (vrmMorphGroups) {
    vrmMorphGroups.hidden = !isVrmModel;
  }
}

/**
 * モーフごとの描画先コンテナを返します。
 * @param {object} model - モデルデータ。
 * @param {object} morph - モーフ。
 * @returns {HTMLElement|null} 描画先コンテナ。
 */
function resolveMorphContainer(model, morph) {
  if (String(model?.magic || '').trim() === 'Vrm') {
    return document.getElementById(`vrm-morph-group-${String(morph?.vrmUiGroup || 'other').trim()}`) || null;
  }
  return document.getElementById(`morph-group-${morph.panelType}`) || null;
}

/**
 * モーフ 1 件分の UI 要素を作成します。
 * @param {object} morph - モーフ。
 * @param {number} index - モーフインデックス。
 * @param {object} morphController - モーフコントローラー。
 * @param {boolean} keyable - キー登録可能かどうか。
 * @returns {{item: HTMLElement, input: HTMLInputElement}} 生成結果。
 */
function createMorphItem(morph, index, morphController, keyable) {
  const item = document.createElement('div');
  item.className = 'morph-item';
  const label = document.createElement('label');
  label.textContent = morph.name;
  item.appendChild(label);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = '0';
  input.addEventListener('input', (event) => {
    morphController.setManualWeight(index, parseFloat(event.target.value));
  });
  item.appendChild(input);

  const icon = document.createElement('img');
  icon.className = 'morph-key-icon';
  icon.src = 'fonts/radio_button_checked_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg';
  if (!keyable) {
    icon.style.opacity = '0.35';
    icon.style.pointerEvents = 'none';
    icon.title = 'VRMA does not animate this expression';
  } else {
    icon.addEventListener('click', () => {
      const ev = new CustomEvent('register-morph-key', {
        detail: { name: morph.name, weight: parseFloat(input.value) },
        bubbles: true,
      });
      icon.dispatchEvent(ev);
    });
  }
  item.appendChild(icon);

  return { item, input };
}

/**
 * VRM UI 上でキー登録不可のモーフかどうかを返します。
 * @param {object} morph - モーフ。
 * @returns {boolean} キー登録不可なら true。
 */
function isVrmNonAnimatableUiMorph(morph) {
  return String(morph?.vrmExpressionType || '').trim() === 'preset'
    && ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].includes(String(morph?.vrmExpressionName || morph?.name || '').trim());
}

/**
 * 選択中ボーン名のラベルを更新します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} selection - 現在の選択状態。
 * @param {object} langData - ローカライズ辞書。
 */
export function updateSelectedBoneLabel(model, scene, selection, langData) {
  if (!selection.selectedBoneNameElement) {
    return;
  }

  let label = langData.None || 'None';
  if (selection.selectedLight) {
    label = langData.Light || 'Light';
  }
  const selectedBoneIndex = resolveSelectedBoneIndex({ scene }, selection);
  if (selectedBoneIndex !== -1) {
    label = getBone(model, selectedBoneIndex)?.name || 'Unknown';
  }
  selection.selectedBoneNameElement.textContent = label;
}

/**
 * 選択中剛体名のラベルを更新します。
 * @param {object} model - モデルデータ。
 * @param {object} selection - 現在の選択状態。
 * @param {object} langData - ローカライズ辞書。
 */
export function updateSelectedRigidbodyLabel(model, selection, langData) {
  if (!selection.selectedRigidbodyElement) {
    return;
  }

  let label = langData.None || 'None';
  if (selection.selectedRigidbodyIndex !== -1) {
    label = model.rigidBodies[selection.selectedRigidbodyIndex]?.name || 'Unknown';
  }
  selection.selectedRigidbodyElement.textContent = label;
}

/**
 * UI イベントハンドラーを設定します。
 * @param {object} options - UI 初期化オプション。
 */
export function setupUIHandlers(options) {
  const {
    appFacade,
    getLangData,
  } = options;

  const listEl = document.getElementById('model-list');
  const vmdListEl = document.getElementById('vmd-list');
  const deleteVmdButton = document.getElementById('delete-vmd');
  const saveVmdButton = document.getElementById('save-vmd');
  const saveUiSettingsButton = document.getElementById('ui-settings-save');
  const deleteTimelineKeyButton = document.getElementById('timeline-delete-key');
  const playbackRangeStartInput = document.getElementById('playback-range-start');
  const playbackRangeEndInput = document.getElementById('playback-range-end');
  syncPlaybackRangeLabels(getLangData());

  /**
   * モデル一覧 UI を同期します。
   */
  function syncModelListUi() {
    updateModelListUI(appFacade?.ui?.getModelListState?.(), getLangData());
  }

  /**
   * animation 一覧 UI を同期します。
   */
  function syncAnimationListUi() {
    updateVmdListUI(appFacade?.ui?.getAnimationSourceListState?.(), getLangData());
  }

  /**
   * UI 上の一覧を同期します。
   */
  function syncListUi() {
    syncModelListUi();
    syncAnimationListUi();
  }

  /**
   * UI settings を保存します。
   */
  function saveUiSettings() {
    const uiSettingsData = appFacade?.system?.buildUiSettingsData?.();
    if (!uiSettingsData) {
      return;
    }

    const blob = new Blob([`${JSON.stringify(uiSettingsData, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ui-settings.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (listEl) {
    listEl.addEventListener('click', async (event) => {
      const target = event.target;
      const visibilityButton = target && typeof target.closest === 'function'
        ? target.closest('[data-model-visibility-index]')
        : null;
      if (visibilityButton && listEl.contains(visibilityButton)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        const index = Number.parseInt(visibilityButton.dataset.modelVisibilityIndex || '', 10);
        if (Number.isInteger(index)) {
          appFacade?.editing?.setModelVisibility?.(index);
          syncModelListUi();
        }
        return;
      }

      const deleteButton = target && typeof target.closest === 'function'
        ? target.closest('[data-model-delete-index]')
        : null;
      if (deleteButton && listEl.contains(deleteButton)) {
        const index = Number.parseInt(deleteButton.dataset.modelDeleteIndex || '', 10);
        const deletionState = Number.isInteger(index)
          ? appFacade?.ui?.getModelDeletionState?.(index)
          : null;
        const dialogLang = getLangData();
        const confirmed = await openDeleteConfirmDialog({
          title: dialogLang['Delete Model'] || dialogLang.Delete || 'Delete',
          message: dialogLang['Delete Model Confirmation'] || 'Delete this model?',
          details: deletionState?.details || [],
          confirmLabel: dialogLang.Delete || 'Delete',
          cancelLabel: dialogLang.Cancel || 'Cancel',
        });
        if (confirmed && Number.isInteger(index)) {
          appFacade?.editing?.removeModelAtIndex?.(index);
          syncListUi();
        }
        return;
      }

      const row = target && typeof target.closest === 'function'
        ? target.closest('[data-model-index]')
        : null;
      if (!row || !listEl.contains(row)) {
        return;
      }

      const index = Number.parseInt(row.dataset.modelIndex || '', 10);
      if (Number.isInteger(index)) {
        appFacade?.editing?.activateInstance?.(index);
        syncListUi();
      }
    });

    listEl.addEventListener('keydown', (event) => {
      const target = event.target;
      const row = target && typeof target.closest === 'function'
        ? target.closest('[data-model-index]')
        : null;
      if (!row || !listEl.contains(row)) {
        return;
      }

      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      const index = Number.parseInt(row.dataset.modelIndex || '', 10);
      if (Number.isInteger(index)) {
        appFacade?.editing?.activateInstance?.(index);
        syncListUi();
      }
    });
  }

  function applyPlaybackRangeFromInputs() {
    const range = readPlaybackRangeInputs(playbackRangeStartInput, playbackRangeEndInput);
    appFacade?.playback?.setPlaybackRange?.(range.start, range.end);
    appFacade?.playback?.syncBgmPlayback?.(true);
    syncPlaybackRangeUI(appFacade?.playback?.getPlaybackRange?.() ?? range);
  }

  if (vmdListEl) {
    vmdListEl.addEventListener('change', (event) => {
      const selectedValue = String(event.target.value || '');
      const selectedInfo = parseAnimationListValue(selectedValue);
      appFacade?.animation?.selectAnimationSource?.(selectedInfo);
      syncAnimationListUi();
      syncPlaybackRangeUI(appFacade?.playback?.getPlaybackRange?.());
    });
  }

  if (deleteVmdButton) {
    deleteVmdButton.addEventListener('click', async () => {
      const selectedInfo = parseAnimationListValue(vmdListEl?.value);
      const deletionState = appFacade?.ui?.getAnimationDeletionState?.(selectedInfo) || null;
      if (!deletionState?.selectionInfo?.name || !deletionState?.selectionInfo?.kind) {
        return;
      }

      const dialogLang = getLangData();
      const confirmed = await openDeleteConfirmDialog({
        title: dialogLang['Delete VMD'] || dialogLang.Delete || 'Delete',
        message: deletionState.canDelete
          ? (dialogLang['Delete VMD Confirmation'] || 'Delete this VMD?')
          : (dialogLang['Delete VMD In Use'] || 'This VMD is currently used by the following model(s) and cannot be deleted.'),
        details: deletionState.references || [],
        confirmLabel: dialogLang.Delete || 'Delete',
        cancelLabel: dialogLang.Cancel || 'Cancel',
        confirmDisabled: !deletionState.canDelete,
      });

      if (!confirmed || !deletionState.canDelete) {
        return;
      }

      appFacade?.animation?.removeAnimationSource?.(deletionState.selectionInfo);
      syncAnimationListUi();
    });
  }

  if (saveUiSettingsButton) {
    saveUiSettingsButton.addEventListener('click', () => {
      saveUiSettings();
    });
  }

  if (saveVmdButton) {
    saveVmdButton.addEventListener('click', async () => {
      const selectedInfo = parseAnimationListValue(vmdListEl?.value);
      if (selectedInfo.kind === 'vmd' && selectedInfo.targetType !== 'model') {
        await appFacade?.export?.downloadSceneAnimationSource?.(selectedInfo.targetType);
        return;
      }

      const exportState = appFacade?.ui?.getActiveAnimationExportState?.() || null;
      if (!exportState?.activeInstance) {
        return;
      }

      if (exportState.exportMode === 'direct') {
        await appFacade?.export?.downloadActiveAnimationSource?.();
        return;
      }

      const dialogLang = getLangData();
      const selectionResult = await openAnimationExportDialog({
        activeInstance: exportState.activeInstance,
        langData: dialogLang,
        defaultFormat: exportState.defaultFormat,
        defaultBakeIkToRotation: exportState.defaultBakeIkToRotation,
        defaultBakeLowerBodyToHumanoid: exportState.defaultBakeLowerBodyToHumanoid,
      });
      if (!selectionResult) {
        return;
      }

      await appFacade?.export?.downloadActiveAnimationSource?.(selectionResult);
    });
  }

  if (deleteTimelineKeyButton) {
    const deleteKeyLabel = getLangData()?.Delete || 'Delete';
    deleteTimelineKeyButton.title = deleteKeyLabel;
    deleteTimelineKeyButton.setAttribute('aria-label', deleteKeyLabel);
    deleteTimelineKeyButton.addEventListener('click', () => {
      appFacade?.animation?.deleteSelectedKeyframes?.();
    });
  }

  document.getElementById('play-vmd').addEventListener('click', () => {
    appFacade?.playback?.togglePlayback?.();
  });

  document.getElementById('rewind-vmd').addEventListener('click', () => {
    appFacade?.playback?.rewind?.();
  });

  document.getElementById('prev-key-vmd').addEventListener('click', () => {
    appFacade?.playback?.stepKeyframe?.(-1);
  });

  document.getElementById('step-back-vmd').addEventListener('click', () => {
    appFacade?.playback?.stepFrame?.(-1);
  });

  document.getElementById('step-forward-vmd').addEventListener('click', () => {
    appFacade?.playback?.stepFrame?.(1);
  });

  document.getElementById('next-key-vmd').addEventListener('click', () => {
    appFacade?.playback?.stepKeyframe?.(1);
  });

  document.getElementById('go-to-end-vmd').addEventListener('click', () => {
    appFacade?.playback?.goToEnd?.();
  });

  if (playbackRangeStartInput) {
    playbackRangeStartInput.addEventListener('input', applyPlaybackRangeFromInputs);
    playbackRangeStartInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, playbackRangeEndInput)) {
        return;
      }
      applyPlaybackRangeFromInputs();
    });
    playbackRangeStartInput.addEventListener('blur', (event) => {
      if (shouldSkipNumericInputCommit(event, playbackRangeEndInput)) {
        return;
      }
      applyPlaybackRangeFromInputs();
    });
  }
  if (playbackRangeEndInput) {
    playbackRangeEndInput.addEventListener('input', applyPlaybackRangeFromInputs);
    playbackRangeEndInput.addEventListener('change', (event) => {
      if (shouldSkipNumericInputCommit(event, playbackRangeStartInput)) {
        return;
      }
      applyPlaybackRangeFromInputs();
    });
    playbackRangeEndInput.addEventListener('blur', (event) => {
      if (shouldSkipNumericInputCommit(event, playbackRangeStartInput)) {
        return;
      }
      applyPlaybackRangeFromInputs();
    });
  }

  const morphRegisterContainers = typeof document.querySelectorAll === 'function'
    ? Array.from(document.querySelectorAll('[data-morph-register-container="true"]'))
    : collectLegacyMorphRegisterContainers();
  morphRegisterContainers.forEach((container) => {
    container.addEventListener('register-morph-key', (event) => {
      const { name, weight } = event.detail;
      appFacade?.animation?.registerMorphKeyframe?.(name, weight);
    });
  });

  syncListUi();
  syncPlaybackRangeUI(appFacade?.playback?.getPlaybackRange?.());
}

/**
 * querySelectorAll 非対応環境向けに既知コンテナを列挙します。
 * @returns {Array<HTMLElement>} morph register container 一覧。
 */
function collectLegacyMorphRegisterContainers() {
  const containerIds = [
    'morph-group-1',
    'morph-group-2',
    'morph-group-3',
    'morph-group-4',
    ...VRM_MORPH_GROUP_IDS,
  ];
  return containerIds
    .map((containerId) => document.getElementById(containerId))
    .filter((container) => container);
}

/**
 * 床グリッド UI を初期化します。
 * @param {object} options - 初期化オプション。
 * @param {{size?: number, count?: number, thickness?: number}} [options.state] - 床グリッドの状態。
 * @param {function} [options.onChanged] - 値変更時のコールバック。
 */
export function setupGridOverlayUI(options) {
  const { selection, refreshScene, state, onChanged } = options;

  const showGridXZElement = selection.showGridXZElement;
  const showGridXYElement = selection.showGridXYElement;
  const showGridYZElement = selection.showGridYZElement;
  const gridSizeRangeElement = selection.gridSizeRangeElement;
  const gridSizeValueElement = selection.gridSizeValueElement;
  const gridCountRangeElement = selection.gridCountRangeElement;
  const gridCountValueElement = selection.gridCountValueElement;
  const gridThicknessRangeElement = selection.gridThicknessRangeElement;
  const gridThicknessValueElement = selection.gridThicknessValueElement;
  const defaults = getDefaultsSnapshot('gridOverlay');
  const defaultGridSize = Number.isFinite(defaults.size) ? defaults.size : 0.5;
  const defaultGridCount = Number.isFinite(defaults.count) ? defaults.count : 10;
  const defaultGridThickness = Number.isFinite(defaults.thickness) ? defaults.thickness : 1.0;
  const GRID_SIZE_MIN = 0.1;
  const GRID_SIZE_MAX = 50.0;
  const GRID_COUNT_MIN = 1;
  const GRID_COUNT_MAX = 100;
  const GRID_THICKNESS_MIN = 0.1;
  const GRID_THICKNESS_MAX = 10.0;

  if (!showGridXZElement && !showGridXYElement && !showGridYZElement && !gridSizeRangeElement && !gridSizeValueElement && !gridCountRangeElement && !gridCountValueElement && !gridThicknessRangeElement && !gridThicknessValueElement) {
    return;
  }

  let gridSizeValue = Number.isFinite(state?.size)
    ? state.size
    : readNumericInputValue(gridSizeValueElement || gridSizeRangeElement, defaultGridSize);
  let gridCountValue = Number.isFinite(state?.count)
    ? Math.round(state.count)
    : Math.round(readNumericInputValue(gridCountValueElement || gridCountRangeElement, defaultGridCount));
  let gridThicknessValue = Number.isFinite(state?.thickness)
    ? state.thickness
    : readNumericInputValue(gridThicknessValueElement || gridThicknessRangeElement, defaultGridThickness);
  gridThicknessValue = Math.min(GRID_THICKNESS_MAX, Math.max(GRID_THICKNESS_MIN, gridThicknessValue));

  if (state) {
    state.size = gridSizeValue;
    state.count = gridCountValue;
    state.thickness = gridThicknessValue;
  }

  const gridSizeBinding = bindLinkedNumericInputs({
    rangeInput: gridSizeRangeElement,
    valueInput: gridSizeValueElement,
    fallbackValue: defaultGridSize,
    getValue: () => gridSizeValue,
    setValue(nextValue) {
      gridSizeValue = Math.min(GRID_SIZE_MAX, Math.max(GRID_SIZE_MIN, nextValue));
      if (state) {
        state.size = gridSizeValue;
      }
      onChanged?.();
      refreshScene?.();
    },
    sanitize: (value) => Math.min(GRID_SIZE_MAX, Math.max(GRID_SIZE_MIN, value)),
  });

  const gridCountBinding = bindLinkedNumericInputs({
    rangeInput: gridCountRangeElement,
    valueInput: gridCountValueElement,
    fallbackValue: defaultGridCount,
    getValue: () => gridCountValue,
    setValue(nextValue) {
      gridCountValue = Math.round(Math.min(GRID_COUNT_MAX, Math.max(GRID_COUNT_MIN, nextValue)));
      if (state) {
        state.count = gridCountValue;
      }
      onChanged?.();
      refreshScene?.();
    },
    parse: (text) => Number.parseInt(text, 10),
    sanitize: (value) => Math.round(Math.min(GRID_COUNT_MAX, Math.max(GRID_COUNT_MIN, value))),
    format: (value) => String(Math.round(value)),
  });

  const gridThicknessBinding = bindLinkedNumericInputs({
    rangeInput: gridThicknessRangeElement,
    valueInput: gridThicknessValueElement,
    fallbackValue: defaultGridThickness,
    getValue: () => gridThicknessValue,
    setValue(nextValue) {
      gridThicknessValue = Math.min(GRID_THICKNESS_MAX, Math.max(GRID_THICKNESS_MIN, nextValue));
      if (state) {
        state.thickness = gridThicknessValue;
      }
      onChanged?.();
      refreshScene?.();
    },
    sanitize: (value) => Math.min(GRID_THICKNESS_MAX, Math.max(GRID_THICKNESS_MIN, value)),
  });

  if (showGridXZElement) {
    showGridXZElement.addEventListener('change', () => {
      onChanged?.();
      refreshScene?.();
    });
  }
  if (showGridXYElement) {
    showGridXYElement.addEventListener('change', () => {
      onChanged?.();
      refreshScene?.();
    });
  }
  if (showGridYZElement) {
    showGridYZElement.addEventListener('change', () => {
      onChanged?.();
      refreshScene?.();
    });
  }

  gridSizeBinding.syncFromValue(gridSizeValue, { forceValue: true, forceRange: true });
  gridCountBinding.syncFromValue(gridCountValue, { forceValue: true, forceRange: true });
  gridThicknessBinding.syncFromValue(gridThicknessValue, { forceValue: true, forceRange: true });
}

