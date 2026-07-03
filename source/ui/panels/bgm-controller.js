import { BgmManager } from '../../application/playback/bgm-manager.js';
import {
  bindLinkedNumericInputs,
  syncNumericInputValue,
} from '../../shared/ui/numeric-input-utils.js';

/**
 * BGM UI を初期化します。
 * @param {object} options - UI options.
 * @param {object} [options.appFacade] - Application facade.
 * @param {function(): object|null} [options.getPlaybackController] - Playback controller getter.
 * @param {function(): {start:number, end:number|null}} [options.getPlaybackRange] - Playback range getter.
 * @param {function():object} options.getLangData - Localization getter.
 * @param {Document} [options.documentRef] - 対象 document。
 * @returns {BgmManager|null} Initialized manager.
 */
export function setupBgmController(options) {
  const {
    appFacade,
    getPlaybackController,
    getPlaybackRange,
    getLangData,
    documentRef = globalThis.document,
  } = options;
  const label = documentRef?.getElementById?.('label-bgm');
  const dropZone = documentRef?.getElementById?.('bgm-drop-zone');
  const fileInput = documentRef?.getElementById?.('bgm-file-input');
  const fileNameEl = documentRef?.getElementById?.('bgm-file-name');
  const statusEl = documentRef?.getElementById?.('bgm-status');
  const volumeRange = documentRef?.getElementById?.('bgm-volume');
  const volumeValue = null;
  const loopCheckbox = documentRef?.getElementById?.('bgm-loop');
  const candidateArea = documentRef?.getElementById?.('bgm-candidate-area');
  const candidateHeader = documentRef?.getElementById?.('bgm-candidate-header');
  const candidateCount = documentRef?.getElementById?.('bgm-candidate-count');
  const candidateList = documentRef?.getElementById?.('bgm-candidate-list');

  if (!label || !dropZone || !fileInput || !fileNameEl || !statusEl || !volumeRange || !loopCheckbox || !candidateArea || !candidateHeader || !candidateCount || !candidateList) {
    return null;
  }

  /**
   * Returns the active playback controller.
   * @returns {object|null} Playback controller.
   */
  function getActivePlaybackController() {
    if (typeof getPlaybackController === 'function') {
      return getPlaybackController() ?? null;
    }
    return appFacade?.playback?.getPlaybackController?.() ?? null;
  }

  /**
   * Returns the active playback range.
   * @returns {{start:number, end:number|null}} Playback range.
   */
  function getActivePlaybackRange() {
    if (typeof getPlaybackRange === 'function') {
      return getPlaybackRange() ?? { start: 0, end: null };
    }
    return appFacade?.playback?.getPlaybackRange?.() ?? { start: 0, end: null };
  }

  /**
   * Returns localized text for a key.
   * @param {string} key - Localization key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(key, fallback) {
    const langData = typeof getLangData === 'function' ? getLangData() : null;
    return langData?.[key] || fallback || key;
  }

  const bgmManager = new BgmManager({
    getPlaybackController: getActivePlaybackController,
    getPlaybackRange: getActivePlaybackRange,
    onStateChanged: syncUi,
  });
  let lastCandidateSignature = '';

  /**
   * Syncs the BGM UI with the current manager state.
   */
  function syncUi() {
    const state = bgmManager.getState();
    dropZone.setAttribute('aria-label', t('Click or drop a BGM file here.', 'Click or drop a BGM file here.'));
    fileNameEl.textContent = state.fileName || t('No BGM loaded.', 'No BGM loaded.');
    const errorMessage = state.errorMessage ? t(state.errorMessage, state.errorMessage) : '';
    statusEl.textContent = errorMessage
      || (state.hasSource
        ? (state.isReady
          ? (state.isPlaying ? t('Playing', 'Playing') : t('Paused', 'Paused'))
          : t('Loading BGM...', 'Loading BGM...'))
        : t('No BGM loaded.', 'No BGM loaded.'));
    syncNumericInputValue(volumeRange, state.volume, { force: false });
    syncNumericInputValue(volumeValue, state.volume, { force: false });
    loopCheckbox.checked = state.loop;
    candidateHeader.textContent = t('Detected audio files', 'Detected audio files');
    renderCandidateList(state);
  }

  /**
   * Renders candidate audio radios when more than one source was detected.
   * @param {object} state - BGM state.
   */
  function renderCandidateList(state) {
    const candidates = bgmManager.candidateFiles || [];
    const candidateSignature = `${state.selectedCandidateIndex}|${candidates.map((file) => file.name).join('\u0000')}`;
    if (candidateSignature === lastCandidateSignature) {
      return;
    }
    lastCandidateSignature = candidateSignature;

    const candidateCountValue = candidates.length;
    candidateCount.textContent = candidateCountValue > 0 ? `(${candidateCountValue})` : '';

    if (candidateCountValue <= 1) {
      candidateArea.hidden = true;
      candidateList.innerHTML = '';
      return;
    }

    candidateArea.hidden = false;
    candidateHeader.textContent = t('Detected audio files', 'Detected audio files');
    candidateList.innerHTML = '';

    candidates.forEach((candidate, index) => {
      const optionLabel = documentRef.createElement('label');
      optionLabel.className = 'bgm-candidate-option';

      const radio = documentRef.createElement('input');
      radio.type = 'radio';
      radio.name = 'bgm-candidate';
      radio.checked = index === state.selectedCandidateIndex;
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await bgmManager.selectCandidate(index);
        }
      });

      const text = documentRef.createElement('span');
      text.textContent = candidate.name;

      optionLabel.append(radio, text);
      candidateList.appendChild(optionLabel);
    });
  }

  /**
   * Loads one or more files from a file list.
   * @param {FileList|File[]} files - Selected files.
   */
  async function loadFiles(files) {
    const nextFiles = Array.isArray(files) ? files.filter(Boolean) : Array.from(files || []).filter(Boolean);
    if (nextFiles.length === 0) {
      return;
    }

    if (nextFiles.length === 1) {
      const result = await bgmManager.loadFile(nextFiles[0]);
      if (!result.accepted) {
        statusEl.textContent = t('Unsupported audio format.', 'Unsupported audio format.');
      } else {
        syncUi();
      }
      return;
    }

    await bgmManager.setCandidateFiles(nextFiles);
  }

  fileInput.setAttribute('accept', 'audio/*');
  fileInput.setAttribute('multiple', 'multiple');

  dropZone.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    fileInput.value = '';
    fileInput.click();
  });
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });
  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    await loadFiles(event.dataTransfer?.files || []);
  });

  fileInput.addEventListener('change', async (event) => {
    await loadFiles(event.target.files);
    event.target.value = '';
  });

  bindLinkedNumericInputs({
    rangeInput: volumeRange,
    valueInput: volumeValue,
    fallbackValue: 1,
    getValue: () => bgmManager.volume,
    setValue: (nextValue) => {
      bgmManager.setVolume(nextValue);
    },
    sanitize: (value) => Math.min(1, Math.max(0, value)),
  });
  loopCheckbox.addEventListener('change', () => {
    bgmManager.setLoop(loopCheckbox.checked);
    bgmManager.syncFromActivePlayback({ forceSeek: true });
  });

  bgmManager.refreshUi = syncUi;
  syncUi();
  return bgmManager;
}
