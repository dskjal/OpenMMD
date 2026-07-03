import {
  isAnimationFileName,
  collectHdrFilesFromZipFiles,
  collectModelCandidatesFromZipFiles,
  collectModelCompanionShaderFilesFromZipFiles,
  collectUiSettingsFilesFromZipFiles,
  createFileFromZipModelCandidate,
  isHdrFileName,
  isJsonFileName,
  isModelFileName,
  isPlayableAudioFileName,
  isShaderFileName,
  isVpdFileName,
  loadZipArchive,
  shouldLoadZipModelCandidateAsFile,
} from '../../infrastructure/io/file-loading.js';

/**
 * Creates the shared dropped-input service for drag/drop, ZIP, and direct files.
 * @param {object} deps - Service dependencies.
 * @param {function(File): Promise<void>} [deps.loadModelFile] - Single model loader.
 * @param {function(object): Promise<void>} [deps.loadZipModel] - ZIP/folder model loader.
 * @param {function(File): Promise<void>} [deps.loadVmd] - Animation loader.
 * @param {function(File): Promise<void>} [deps.loadVpd] - Pose loader.
 * @param {function(File): Promise<void>} [deps.loadAudioFile] - Audio loader.
 * @param {function(File[]): Promise<void>} [deps.setAudioCandidateFiles] - Audio candidate registrar.
 * @param {function(File): Promise<void>} [deps.loadEnvironmentHdrFile] - HDR loader.
 * @param {function(File[]): Promise<void>} [deps.setEnvironmentHdrCandidateFiles] - HDR candidate registrar.
 * @param {function(Array<object>): Promise<void>} [deps.setModelCandidateFiles] - Model candidate registrar.
 * @param {function(File[], object|null=): void} [deps.setPendingSettingsFiles] - Pending settings registrar.
 * @param {function(File[], object|null=): void} [deps.setPendingPoseFiles] - Pending pose registrar.
 * @param {function(File[], object|null=): Promise<void>} [deps.applySettingsFiles] - Settings apply handler.
 * @param {function(File, object|null=): Promise<boolean>} [deps.processSettingsFile] - Per-file settings handler.
 * @param {function(File, object=): Promise<void>} [deps.loadModelSettingsFile] - Model settings loader.
 * @param {function(File): Promise<object>} [deps.loadUiSettingsFile] - UI settings loader.
 * @param {function(string): object} [deps.parseUiSettingsJsonText] - UI settings parser.
 * @param {function(File): Promise<Array<object>>} [deps.loadShaderFile] - Shader file loader.
 * @param {function(object): Promise<Array<object>>} [deps.loadShaderBundle] - Shader bundle loader.
 * @param {function(string[]): Promise<void>} [deps.reloadShaderUsage] - Shader usage reload callback.
 * @param {function(string[]): void} [deps.onShaderStateChanged] - Shader UI/scene sync callback.
 * @returns {object} Dropped-input service API.
 */
export function createDroppedInputService(deps) {
  const {
    loadModelFile,
    loadZipModel,
    loadVmd,
    loadVpd,
    loadAudioFile,
    setAudioCandidateFiles,
    loadEnvironmentHdrFile,
    setEnvironmentHdrCandidateFiles,
    setModelCandidateFiles,
    setPendingSettingsFiles,
    setPendingPoseFiles,
    applySettingsFiles,
    processSettingsFile: processSettingsFileOverride,
    loadModelSettingsFile,
    loadUiSettingsFile,
    parseUiSettingsJsonText,
    loadShaderFile,
    loadShaderBundle,
    reloadShaderUsage,
    onShaderStateChanged,
  } = deps || {};

  async function loadModelCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    if (candidate.kind === 'file') {
      if (typeof loadModelFile === 'function') {
        await loadModelFile(candidate.file);
        return true;
      }
      return false;
    }

    if (candidate.kind === 'zip') {
      if (shouldLoadZipModelCandidateAsFile(candidate)) {
        const file = await createFileFromZipModelCandidate(candidate);
        if (file && typeof loadModelFile === 'function') {
          await loadModelFile(file);
          return true;
        }
      }

      if (typeof loadZipModel === 'function') {
        await loadZipModel(candidate.zipFiles);
        return true;
      }
    }

    return false;
  }

  async function processZipArchiveFile(file) {
    if (!file) {
      return;
    }

    const { zipFiles: archiveFiles } = await inspectZipModelArchive(file);
    await processFileBatch([], archiveFiles, file?.name || 'ZIP');
  }

  async function processHdrCandidates(files) {
    const hdrFiles = Array.isArray(files)
      ? files.filter((file) => Boolean(file) && isHdrFileName(file.name || ''))
      : [];
    if (hdrFiles.length === 0) {
      return;
    }

    if (hdrFiles.length === 1) {
      await loadEnvironmentHdrFile?.(hdrFiles[0]);
      return;
    }

    await setEnvironmentHdrCandidateFiles?.(hdrFiles);
  }

  async function loadModelSettingsFileWithCompanions(file, zipFiles = null) {
    const fileName = file?.name || '';
    if (loadShaderFile && zipFiles && Object.keys(zipFiles).length > 0 && typeof file?.text === 'function' && typeof parseUiSettingsJsonText === 'function') {
      try {
        const parsed = parseUiSettingsJsonText(await file.text());
        if (String(parsed?.type || '').trim().toLowerCase() === 'model') {
          const companionShaderFiles = await collectModelCompanionShaderFilesFromZipFiles(parsed, fileName, zipFiles);
          if (companionShaderFiles.length > 0) {
            await processShaderCandidates(companionShaderFiles);
          }
        }
      } catch (error) {
        console.warn(`Failed to inspect model JSON for companion shaders: ${fileName || 'unknown'}`, error);
      }
    }

    await loadModelSettingsFile?.(file, {
      shaderContextPath: fileName,
    });
  }

  async function processSettingsFile(file, zipFiles = null) {
    if (typeof processSettingsFileOverride === 'function') {
      return await processSettingsFileOverride(file, zipFiles);
    }

    const uiResult = await loadUiSettingsFile?.(file);
    if (uiResult?.skippedReason === 'unsupported-type') {
      await loadModelSettingsFileWithCompanions(file, zipFiles);
      return true;
    }
    return Boolean(uiResult?.applied);
  }

  async function processShaderCandidates(files, zipFiles = null) {
    if (!loadShaderFile && !loadShaderBundle) {
      return [];
    }

    const loadedNames = new Set();
    const candidateFiles = Array.isArray(files)
      ? files.filter((file) => Boolean(file) && isShaderFileName(file.name || ''))
      : [];

    for (const file of candidateFiles) {
      const registered = await loadShaderFile?.(file);
      for (const definition of Array.isArray(registered) ? registered : []) {
        if (definition?.name) {
          loadedNames.add(definition.name);
        }
      }
    }

    if (zipFiles && Object.keys(zipFiles).length > 0) {
      const registered = await loadShaderBundle?.(zipFiles);
      for (const definition of Array.isArray(registered) ? registered : []) {
        if (definition?.name) {
          loadedNames.add(definition.name);
        }
      }
    }

    if (loadedNames.size === 0) {
      return [];
    }

    const loadedShaderNames = Array.from(loadedNames);
    await reloadShaderUsage?.(loadedShaderNames);
    onShaderStateChanged?.(loadedShaderNames);
    return loadedShaderNames;
  }

  async function inspectZipModelArchive(file) {
    const zip = await loadZipArchive(file);
    const zipFiles = zip.files;
    const sourceLabel = file?.name || 'ZIP';
    const modelCandidates = collectModelCandidatesFromZipFiles(zipFiles, sourceLabel)
      .map((candidate) => ({
        ...candidate,
        archiveName: sourceLabel,
        sourceLabel,
        label: candidate.label || `${sourceLabel}/${candidate.modelPath}`,
        checked: candidate.checked !== false,
      }));
    const hdrFiles = await collectHdrFilesFromZipFiles(zipFiles);
    const uiSettingsFiles = await collectUiSettingsFilesFromZipFiles(zipFiles);
    return { zipFiles, modelCandidates, hdrFiles, uiSettingsFiles };
  }

  async function handleFile(file, zipFiles = null) {
    if (!file) {
      return;
    }

    const fileName = String(file.name || '');
    const lowerFileName = fileName.toLowerCase();

    if (isPlayableAudioFileName(fileName, file.type || '')) {
      await loadAudioFile?.(file);
      return;
    }
    if (isHdrFileName(fileName)) {
      await processHdrCandidates([file]);
      return;
    }
    if (isShaderFileName(fileName)) {
      await processShaderCandidates([file]);
      return;
    }
    if (isVpdFileName(fileName)) {
      if (typeof loadVpd === 'function') {
        await loadVpd(file);
      } else {
        await loadVmd?.(file);
      }
      return;
    }
    if (isModelFileName(fileName)) {
      await loadModelFile?.(file);
      return;
    }
    if (lowerFileName.endsWith('.zip')) {
      await processZipArchiveFile(file);
      return;
    }
    if (isAnimationFileName(fileName)) {
      await loadVmd?.(file);
      return;
    }

    try {
      await processSettingsFile(file, zipFiles);
    } catch {
      // Ignore unsupported non-JSON files.
    }
  }

  async function processFileBatch(files, zipFiles = null, sourceLabel = 'Folder') {
    const audioFiles = [];
    const hdrFiles = [];
    const uiSettingsFiles = [];
    const modelCandidates = [];
    const shaderFiles = [];
    const vpdFiles = [];
    const otherFiles = [];
    const hasZipFiles = Boolean(zipFiles) && Object.keys(zipFiles).length > 0;
    let sharedArchiveZipFiles = null;
    let hasMultipleArchiveContexts = false;

    if (Array.isArray(files) && files.length > 0) {
      for (const file of files) {
        const fileName = String(file?.name || '');
        const lowerFileName = fileName.toLowerCase();
        if (isPlayableAudioFileName(fileName, file?.type || '')) {
          audioFiles.push(file);
          continue;
        }
        if (isHdrFileName(fileName)) {
          hdrFiles.push(file);
          continue;
        }
        if (isJsonFileName(fileName)) {
          uiSettingsFiles.push(file);
          continue;
        }
        if (isShaderFileName(fileName)) {
          if (!hasZipFiles) {
            shaderFiles.push(file);
          }
          continue;
        }
        if (isModelFileName(fileName)) {
          if (!hasZipFiles) {
            modelCandidates.push({
              kind: 'file',
              file,
              label: fileName,
              checked: true,
            });
          }
          continue;
        }
        if (isVpdFileName(fileName)) {
          vpdFiles.push(file);
          continue;
        }
        if (lowerFileName.endsWith('.zip')) {
          await processZipArchiveFile(file);
          continue;
        }
        otherFiles.push(file);
      }
    }

    if (hasZipFiles) {
      modelCandidates.push(...collectModelCandidatesFromZipFiles(zipFiles, sourceLabel));
      uiSettingsFiles.push(...await collectUiSettingsFilesFromZipFiles(zipFiles));
    }

    const sharedSettingsZipFiles = hasZipFiles
      ? zipFiles
      : (hasMultipleArchiveContexts ? null : sharedArchiveZipFiles);

    if (audioFiles.length === 1) {
      await loadAudioFile?.(audioFiles[0]);
    } else if (audioFiles.length > 1) {
      await setAudioCandidateFiles?.(audioFiles);
    }

    await processHdrCandidates(hdrFiles);
    await processShaderCandidates(shaderFiles, hasZipFiles ? zipFiles : null);

    const hasUiSettingsFiles = uiSettingsFiles.length > 0;

    if (modelCandidates.length === 1) {
      await loadModelCandidate(modelCandidates[0]);
      if (hasUiSettingsFiles) {
        await applySettingsFiles?.(uiSettingsFiles, sharedSettingsZipFiles);
      }
      for (const file of vpdFiles) {
        await handleFile(file, sharedSettingsZipFiles);
      }
    } else if (modelCandidates.length > 1) {
      await setModelCandidateFiles?.(modelCandidates);
      if (hasUiSettingsFiles) {
        setPendingSettingsFiles?.(uiSettingsFiles, sharedSettingsZipFiles);
      }
      setPendingPoseFiles?.(vpdFiles, sharedSettingsZipFiles);
    } else {
      if (hasUiSettingsFiles) {
        await applySettingsFiles?.(uiSettingsFiles, sharedSettingsZipFiles);
      }
      for (const file of vpdFiles) {
        await handleFile(file, sharedSettingsZipFiles);
      }
    }

    for (const file of otherFiles) {
      await handleFile(file, sharedSettingsZipFiles);
    }
  }

  async function processDroppedData(dropped) {
    const files = Array.isArray(dropped?.files) ? dropped.files : [];
    const nextZipFiles = dropped?.hasDirectory ? dropped.zipFiles : null;
    await processFileBatch(files, nextZipFiles);
  }

  return {
    processDroppedData,
    processFileBatch,
    handleFile,
    processSettingsFile,
    processShaderCandidates,
    processHdrCandidates,
    inspectZipModelArchive,
  };
}
