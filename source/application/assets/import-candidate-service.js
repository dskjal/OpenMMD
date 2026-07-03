import {
  createFileFromZipModelCandidate,
  isHdrFileName,
  isModelFileName,
  shouldLoadZipModelCandidateAsFile,
} from '../../infrastructure/io/file-loading.js';

/**
 * Creates the import candidate service.
 * @param {object} options - Service options.
 * @returns {object} Candidate service.
 */
export function createImportCandidateService(options = {}) {
  /** @type {File[]} */
  let environmentHdrCandidateFiles = [];
  let environmentHdrSelectedCandidateIndex = -1;
  /** @type {Array<object>} */
  let modelCandidateFiles = [];

  /**
   * Emits a state change event.
   */
  function emitStateChanged() {
    options.onStateChanged?.({
      environmentHdrCandidateFiles,
      environmentHdrSelectedCandidateIndex,
      modelCandidateFiles,
    });
  }

  /**
   * Returns a model candidate label.
   * @param {object} candidate - Candidate.
   * @returns {string} Label.
   */
  function getModelCandidateDisplayName(candidate) {
    if (!candidate) {
      return '';
    }
    if (candidate.kind === 'zip') {
      const sourceLabel = candidate.sourceLabel || candidate.archiveName || 'ZIP';
      const modelPath = candidate.modelPath || '';
      return modelPath ? `${sourceLabel}/${modelPath}` : sourceLabel;
    }
    return candidate.label || candidate.file?.name || '';
  }

  /**
   * Creates a ZIP selection containing only the selected model paths.
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP entries.
   * @param {string[]} selectedModelPaths - Selected paths.
   * @returns {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} Filtered entries.
   */
  function createSelectedZipFiles(zipFiles, selectedModelPaths) {
    const selectedPaths = new Set(selectedModelPaths || []);
    const filteredZipFiles = {};
    for (const [path, entry] of Object.entries(zipFiles || {})) {
      if (!isModelFileName(path) || selectedPaths.has(path)) {
        filteredZipFiles[path] = entry;
      }
    }
    return filteredZipFiles;
  }

  return {
    /**
     * Returns the current state snapshot.
     * @returns {{environmentHdrCandidateFiles: File[], environmentHdrSelectedCandidateIndex: number, modelCandidateFiles: Array<object>}} State snapshot.
     */
    getState() {
      return {
        environmentHdrCandidateFiles: environmentHdrCandidateFiles.slice(),
        environmentHdrSelectedCandidateIndex,
        modelCandidateFiles: modelCandidateFiles.slice(),
      };
    },

    /**
     * Returns a display label for one model candidate.
     * @param {object} candidate - Candidate.
     * @returns {string} Display label.
     */
    getModelCandidateDisplayName,

    /**
     * Clears environment HDR candidates.
     */
    clearEnvironmentHdrCandidates() {
      environmentHdrCandidateFiles = [];
      environmentHdrSelectedCandidateIndex = -1;
      emitStateChanged();
    },

    /**
     * Registers environment HDR candidates.
     * @param {File[]} files - Candidate files.
     * @returns {Promise<void>} Completion promise.
     */
    async setEnvironmentHdrCandidateFiles(files) {
      const nextFiles = Array.isArray(files)
        ? files.filter((file) => Boolean(file) && isHdrFileName(file.name || ''))
        : [];
      if (nextFiles.length === 0) {
        this.clearEnvironmentHdrCandidates();
        return;
      }

      environmentHdrCandidateFiles = nextFiles;
      environmentHdrSelectedCandidateIndex = 0;
      emitStateChanged();
      await options.loadEnvironmentHdrFile?.(nextFiles[0], { preserveCandidates: true });
    },

    /**
     * Selects an environment HDR candidate.
     * @param {number} index - Candidate index.
     * @returns {Promise<void>} Completion promise.
     */
    async selectEnvironmentHdrCandidate(index) {
      if (!Number.isInteger(index) || index < 0 || index >= environmentHdrCandidateFiles.length) {
        return;
      }
      environmentHdrSelectedCandidateIndex = index;
      emitStateChanged();
      await options.loadEnvironmentHdrFile?.(environmentHdrCandidateFiles[index], { preserveCandidates: true });
    },

    /**
     * Clears model candidates.
     */
    clearModelCandidates() {
      modelCandidateFiles = [];
      options.clearPendingImports?.();
      emitStateChanged();
    },

    /**
     * Sets one model candidate checked state.
     * @param {number} index - Candidate index.
     * @param {boolean} checked - Checked state.
     */
    setModelCandidateChecked(index, checked) {
      if (!Number.isInteger(index) || index < 0 || index >= modelCandidateFiles.length) {
        return;
      }
      modelCandidateFiles[index].checked = checked !== false;
      emitStateChanged();
    },

    /**
     * Loads the selected model candidates.
     * @returns {Promise<void>} Completion promise.
     */
    async loadSelectedModelCandidates() {
      const selectedCandidates = modelCandidateFiles.filter((candidate) => candidate.checked !== false);
      if (selectedCandidates.length === 0) {
        return;
      }

      const zipSelections = new Map();
      for (const candidate of selectedCandidates) {
        if (candidate.kind === 'file') {
          await options.loadModelFile?.(candidate.file);
          continue;
        }

        const zipFiles = candidate.zipFiles || null;
        if (!zipFiles) {
          continue;
        }
        const nextSelection = zipSelections.get(zipFiles) || [];
        nextSelection.push(candidate.modelPath);
        zipSelections.set(zipFiles, nextSelection);
      }

      for (const [zipFiles, modelPaths] of zipSelections.entries()) {
        const filteredZipFiles = createSelectedZipFiles(zipFiles, modelPaths);
        if (modelPaths.length === 1) {
          const singleCandidate = {
            kind: 'zip',
            zipFiles: filteredZipFiles,
            modelPath: modelPaths[0],
          };
          if (shouldLoadZipModelCandidateAsFile(singleCandidate)) {
            const file = await createFileFromZipModelCandidate(singleCandidate);
            if (file) {
              await options.loadModelFile?.(file);
              continue;
            }
          }
        }
        await options.loadZipModel?.(filteredZipFiles);
      }

      await options.consumePendingSettingsFiles?.();
      await options.consumePendingPoseFiles?.();
      this.clearModelCandidates();
    },

    /**
     * Registers model candidates.
     * @param {Array<object>} files - Model candidates.
     * @returns {Promise<void>} Completion promise.
     */
    async setModelCandidateFiles(files) {
      const nextFiles = Array.isArray(files)
        ? files.filter(Boolean).map((candidate) => ({
          ...candidate,
          checked: candidate.checked !== false,
          label: candidate.label || candidate.file?.name || candidate.modelPath || '',
        }))
        : [];

      if (nextFiles.length === 0) {
        this.clearModelCandidates();
        return;
      }

      modelCandidateFiles = nextFiles;
      emitStateChanged();
      if (modelCandidateFiles.length === 1) {
        await this.loadSelectedModelCandidates();
      }
    },
  };
}
