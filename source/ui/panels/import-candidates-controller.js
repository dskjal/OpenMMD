import { syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';

/**
 * Installs import candidate UI controllers.
 * @param {object} options - Controller options.
 * @returns {{syncEnvironmentHdrUi: function, syncModelCandidateUi: function}} Candidate controller.
 */
export function installImportCandidatesController(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const candidateService = options.candidateService;
  const getLangData = options.getLangData ?? (() => ({}));
  const getEnvironmentHdrDisplayName = options.getEnvironmentHdrDisplayName ?? ((value) => String(value || ''));
  const getEnvironmentHdrUiState = options.getEnvironmentHdrUiState;
  const getModelCandidateUiState = options.getModelCandidateUiState;
  const getEnvironmentHdrValue = options.getEnvironmentHdrValue ?? (() => 1);
  const getEnvironmentHdrMax = options.getEnvironmentHdrMax ?? (() => 1);

  /**
   * Returns localized text.
   * @param {string} key - Translation key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(key, fallback) {
    const langData = getLangData();
    return langData?.[key] || fallback || key;
  }

  /**
   * Syncs environment HDR UI.
   */
  function syncEnvironmentHdrUi() {
    const uiState = getEnvironmentHdrUiState?.();
    if (!uiState) {
      return;
    }
    const state = candidateService?.getState?.() ?? {
      environmentHdrCandidateFiles: [],
      environmentHdrSelectedCandidateIndex: -1,
    };
    if (uiState.nameLabel) {
      uiState.nameLabel.textContent = getEnvironmentHdrDisplayName();
    }
    const intensity = getEnvironmentHdrValue();
    syncNumericInputValue(uiState.intensityRange, intensity, { force: false });
    syncNumericInputValue(uiState.intensityValue, intensity, { force: false });
    if (uiState.intensityRange) {
      uiState.intensityRange.max = String(getEnvironmentHdrMax());
    }
    if (uiState.intensityValue) {
      uiState.intensityValue.max = String(getEnvironmentHdrMax());
    }

    const candidates = state.environmentHdrCandidateFiles;
    const candidateCountValue = candidates.length;
    if (uiState.candidateCount) {
      uiState.candidateCount.textContent = candidateCountValue > 0 ? `(${candidateCountValue})` : '';
    }
    if (candidateCountValue <= 1) {
      if (uiState.candidateArea) {
        uiState.candidateArea.hidden = true;
      }
      if (uiState.candidateList) {
        uiState.candidateList.innerHTML = '';
      }
      return;
    }

    if (uiState.candidateArea) {
      uiState.candidateArea.hidden = false;
    }
    if (uiState.candidateHeader) {
      uiState.candidateHeader.textContent = t('Detected HDR files', 'Detected HDR files');
    }
    if (!uiState.candidateList || !documentRef) {
      return;
    }
    uiState.candidateList.innerHTML = '';
    candidates.forEach((candidate, index) => {
      const optionLabel = documentRef.createElement('label');
      optionLabel.className = 'environment-hdr-candidate-option';
      const radio = documentRef.createElement('input');
      radio.type = 'radio';
      radio.name = 'environment-hdr-candidate';
      radio.checked = index === state.environmentHdrSelectedCandidateIndex;
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await candidateService?.selectEnvironmentHdrCandidate?.(index);
        }
      });
      const text = documentRef.createElement('span');
      text.textContent = candidate.name;
      optionLabel.append(radio, text);
      uiState.candidateList.appendChild(optionLabel);
    });
  }

  /**
   * Syncs model candidate UI.
   */
  function syncModelCandidateUi() {
    const uiState = getModelCandidateUiState?.();
    if (!uiState) {
      return;
    }
    const state = candidateService?.getState?.() ?? { modelCandidateFiles: [] };
    const candidateCountValue = state.modelCandidateFiles.length;
    if (uiState.count) {
      uiState.count.textContent = candidateCountValue > 0 ? `(${candidateCountValue})` : '';
    }
    if (candidateCountValue <= 1) {
      if (uiState.area) {
        uiState.area.hidden = true;
      }
      if (uiState.list) {
        uiState.list.innerHTML = '';
      }
      if (uiState.loadButton) {
        uiState.loadButton.disabled = candidateCountValue === 0;
      }
      return;
    }

    if (uiState.area) {
      uiState.area.hidden = false;
    }
    if (uiState.header) {
      uiState.header.textContent = t('Detected model files', 'Detected model files');
    }
    if (uiState.loadButton) {
      uiState.loadButton.textContent = t('Load Selected Models', 'Load Selected Models');
      uiState.loadButton.disabled = false;
    }
    if (!uiState.list || !documentRef) {
      return;
    }
    uiState.list.innerHTML = '';
    state.modelCandidateFiles.forEach((candidate, index) => {
      const optionLabel = documentRef.createElement('label');
      optionLabel.className = 'model-candidate-option';
      const checkbox = documentRef.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = candidate.checked !== false;
      checkbox.addEventListener('change', () => {
        candidateService?.setModelCandidateChecked?.(index, checkbox.checked);
      });
      const text = documentRef.createElement('span');
      text.textContent = candidateService?.getModelCandidateDisplayName?.(candidate) ?? '';
      optionLabel.append(checkbox, text);
      uiState.list.appendChild(optionLabel);
    });
  }

  const environmentHdrUiState = getEnvironmentHdrUiState?.();
  environmentHdrUiState?.fileInput?.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }
    try {
      if (files.length === 1) {
        await options.loadEnvironmentHdrFile?.(files[0]);
      } else {
        await candidateService?.setEnvironmentHdrCandidateFiles?.(files);
      }
    } finally {
      event.target.value = '';
      syncEnvironmentHdrUi();
    }
  });

  const modelCandidateUiState = getModelCandidateUiState?.();
  modelCandidateUiState?.loadButton?.addEventListener('click', async () => {
    await candidateService?.loadSelectedModelCandidates?.();
  });

  return {
    syncEnvironmentHdrUi,
    syncModelCandidateUi,
  };
}
