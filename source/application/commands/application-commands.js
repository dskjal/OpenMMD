import { exportAnimationSourcesToGlb } from '../../infrastructure/animation/gltf-animation.js';
import {
  exportAnimationDataAsVmdBuffer,
  syncLegacyVmdDataFromAnimationSource,
} from '../animation/runtime-animation.js';

/**
 * Creates the application command surface.
 * @param {object} deps - Command dependencies.
 * @returns {object} Flat command registry.
 */
export function createApplicationCommands(deps) {
  const shellPort = deps.ports?.shell ?? {};
  const documentObject = shellPort.document ?? deps.document ?? globalThis.document ?? null;

  /**
   * Downloads binary data with an anchor element.
   * @param {Blob} blob - Blob data.
   * @param {string} fileName - Download file name.
   */
  function downloadBlob(blob, fileName) {
    if (!blob || !documentObject || typeof URL?.createObjectURL !== 'function') {
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = documentObject.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    documentObject.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Exports an animation source as VMD data.
   * @param {object|null} source - Source object.
   * @returns {{buffer: ArrayBuffer, warnings: object[]}|null} Export result.
   */
  function exportAnimationSourceAsVmd(source) {
    if (!source) {
      return null;
    }

    if (source.kind === 'vmd') {
      syncLegacyVmdDataFromAnimationSource(source);
      return source.data ? exportAnimationDataAsVmdBuffer(source.data) : null;
    }

    if (
      Array.isArray(source.boneKeyframes)
      || Array.isArray(source.faceKeyframes)
      || Array.isArray(source.cameraKeyframes)
      || Array.isArray(source.lightKeyframes)
      || Array.isArray(source.selfShadowKeyframes)
    ) {
      return exportAnimationDataAsVmdBuffer(source);
    }

    return null;
  }

  /**
   * Returns the preferred export format.
   * @param {object} activeInstance - Active model instance.
   * @returns {Promise<'vmd'|'vrma'>} Selected format.
   */
  async function chooseAnimationExportFormat(activeInstance) {
    const defaultFormat = activeInstance?.model?.magic === 'Vrm' ? 'vrma' : 'vmd';
    const promptText = shellPort.prompt?.('Export format? Enter "vmd" or "vrma".', defaultFormat)
      ?? deps.prompt?.('Export format? Enter "vmd" or "vrma".', defaultFormat)
      ?? defaultFormat;
    const normalized = String(promptText || '').trim().toLowerCase();
    return normalized === 'vrma' ? 'vrma' : 'vmd';
  }

  /**
   * Loads models and motions from a ZIP-like object.
   * @param {object} zipFiles - ZIP entries.
   */
  async function loadZipModel(zipFiles) {
    return deps.assetLoadingService?.loadZipModel?.(zipFiles);
  }

  /**
   * Loads a VMD, VRMA, or VPD file.
   * @param {File} file - Animation or pose file.
   * @returns {Promise<object>} Load result.
   */
  async function loadVmd(file) {
    return deps.assetLoadingService?.loadVmd?.(file);
  }

  /**
   * Loads a VPD file.
   * @param {File} file - Pose file.
   * @returns {Promise<object>} Apply result.
   */
  async function loadVpd(file) {
    return deps.assetLoadingService?.loadVpd?.(file);
  }

  /**
   * Loads a single model file.
   * @param {File} file - Model file.
   * @returns {Promise<unknown>} Load result.
   */
  async function loadModelFile(file) {
    return deps.assetLoadingService?.loadModelFile?.(file);
  }

  /**
   * Loads a model settings file.
   * @param {File} file - Settings file.
   * @param {object} [options={}] - Apply options.
   * @returns {Promise<unknown>} Apply result.
   */
  async function loadModelSettingsFile(file, options = {}) {
    return deps.loadModelSettingsFile?.(file, options);
  }

  /**
   * Sets environment HDR candidate files.
   * @param {File[]} files - Candidate files.
   * @returns {Promise<unknown>} Completion promise.
   */
  async function setEnvironmentHdrCandidateFiles(files) {
    return deps.setEnvironmentHdrCandidateFiles?.(files);
  }

  /**
   * Sets model candidate files.
   * @param {Array<object>} files - Candidate descriptors.
   * @returns {Promise<unknown>} Completion promise.
   */
  async function setModelCandidateFiles(files) {
    return deps.setModelCandidateFiles?.(files);
  }

  /**
   * Activates a model instance.
   * @param {number} index - Instance index.
   */
  function activateInstance(index) {
    return deps.modelLifecycleService?.activateInstance?.(index);
  }

  /**
   * Removes the active model.
   */
  function removeActiveModel() {
    return deps.modelLifecycleService?.removeActiveModel?.();
  }

  /**
   * Removes a model at the specified index.
   * @param {number} index - Model index.
   */
  function removeModelAtIndex(index) {
    return deps.modelLifecycleService?.removeModelAtIndex?.(index);
  }

  /**
   * Updates model visibility.
   * @param {number} index - Model index.
   * @param {boolean} [visible] - Explicit visibility state.
   */
  function setModelVisibility(index, visible) {
    return deps.modelLifecycleService?.setModelVisibility?.(index, visible);
  }

  /**
   * Returns the active model instance.
   * @returns {object|null} Active instance.
   */
  function getActiveInstance() {
    return deps.getActiveInstance?.() ?? null;
  }

  /**
   * Assigns a VMD to the active instance.
   * @param {...unknown} args - Assignment arguments.
   */
  function assignVmdToActiveInstance(...args) {
    return deps.timelineOrchestrationService?.assignVmdToActiveInstance?.(...args);
  }

  /**
   * Assigns an animation source to the active instance.
   * @param {...unknown} args - Assignment arguments.
   */
  function assignAnimationSourceToActiveInstance(...args) {
    return deps.timelineOrchestrationService?.assignAnimationSourceToActiveInstance?.(...args);
  }

  /**
   * Deletes the selected timeline keyframes.
   * @returns {boolean} True when something changed.
   */
  function deleteSelectedKeyframes() {
    return deps.timelineOrchestrationService?.deleteSelectedKeyframes?.() ?? false;
  }

  /**
   * Registers a morph keyframe on the active animation source.
   * @param {string} name - Morph name.
   * @param {number} weight - Morph weight.
   * @returns {unknown} Handler result.
   */
  function registerMorphKeyframe(name, weight) {
    return deps.timelineOrchestrationService?.registerMorphKeyframe?.(name, weight);
  }

  /**
   * Registers a bone keyframe on the active animation source.
   * @param {...unknown} args - Registration arguments.
   * @returns {boolean} True when registered.
   */
  function registerBoneKeyframe(...args) {
    return deps.timelineOrchestrationService?.registerBoneKeyframe?.(...args) ?? false;
  }

  /**
   * Registers a camera keyframe on the scene animation source.
   * @param {...unknown} args - Registration arguments.
   * @returns {boolean} True when registered.
   */
  function registerCameraKeyframe(...args) {
    return deps.timelineOrchestrationService?.registerCameraKeyframe?.(...args) ?? false;
  }

  /**
   * Registers a light keyframe on the scene animation source.
   * @param {...unknown} args - Registration arguments.
   * @returns {boolean} True when registered.
   */
  function registerLightKeyframe(...args) {
    return deps.timelineOrchestrationService?.registerLightKeyframe?.(...args) ?? false;
  }

  /**
   * Sets bone parameters through an injected application handler.
   * @param {...unknown} args - Bone parameter arguments.
   * @returns {unknown} Handler result.
   */
  function setBoneParams(...args) {
    return deps.setBoneParams?.(...args);
  }

  /**
   * Rebuilds physics state.
   * @returns {unknown} Handler result.
   */
  function resetPhysics() {
    return deps.resetPhysics?.();
  }

  /**
   * Selects a model by index.
   * @param {number} index - Target index.
   * @returns {unknown} Handler result.
   */
  function selectModel(index) {
    return activateInstance(index);
  }

  /**
   * Returns a serializable viewer-state snapshot.
   * @returns {object} Viewer state snapshot.
   */
  function getViewerState() {
    return deps.viewerStateService?.getViewerState?.() ?? deps.getViewerState?.();
  }

  /**
   * Enters fullscreen mode.
   * @returns {Promise<unknown>} Completion promise.
   */
  async function enterFullscreen() {
    return shellPort.enterAppFullscreen?.() ?? deps.enterFullscreen?.();
  }

  /**
   * Exits fullscreen mode.
   * @returns {Promise<unknown>} Completion promise.
   */
  async function exitFullscreen() {
    return shellPort.exitAppFullscreen?.() ?? deps.exitFullscreen?.();
  }

  /**
   * Forces a scene refresh.
   * @param {...unknown} args - Refresh arguments.
   * @returns {unknown} Refresh result.
   */
  function refreshScene(...args) {
    return deps.refreshScene?.(...args);
  }

  /**
   * Synchronizes the material tab.
   * @returns {unknown} Sync result.
   */
  function syncMaterialTabUi() {
    return deps.ports?.uiSync?.syncMaterialTabUi?.() ?? deps.syncMaterialTabUi?.();
  }

  /**
   * 現在の UI 設定を JSON 互換 object として構築します。
   * @returns {object|null} UI 設定 data。
   */
  function buildUiSettingsData() {
    return deps.buildUiSettingsData?.() ?? null;
  }

  /**
   * UI 設定 data を適用します。
   * @param {object} data - UI settings data.
   * @returns {Promise<object>} 適用結果。
   */
  async function applyUiSettingsData(data) {
    return deps.applyUiSettingsData?.(data);
  }

  /**
   * UI 設定 JSON ファイルを読み込みます。
   * @param {File|Blob} file - UI settings file.
   * @returns {Promise<object>} 適用結果。
   */
  async function loadUiSettingsFile(file) {
    return deps.loadUiSettingsFile?.(file);
  }

  /**
   * Returns the current model list state for UI rendering.
   * @returns {{activeIndex: number, items: Array<object>}} Model list state.
   */
  function getModelListState() {
    return deps.getModelListState?.() ?? { activeIndex: -1, items: [] };
  }

  /**
   * Returns model deletion dialog state.
   * @param {number} index - Model index.
   * @returns {{index: number, details: string[]}} Deletion state.
   */
  function getModelDeletionState(index) {
    return deps.getModelDeletionState?.(index) ?? {
      index,
      details: [],
    };
  }

  /**
   * Returns the current animation list state for UI rendering.
   * @returns {{entries: Array<object>, selectedValue: string, canDeleteSelected: boolean}} Animation list state.
   */
  function getAnimationSourceListState() {
    return deps.getAnimationSourceListState?.() ?? {
      entries: [],
      selectedValue: '',
      canDeleteSelected: false,
    };
  }

  /**
   * Returns animation deletion dialog state.
   * @param {object} selectionInfo - Animation selection info.
   * @returns {{selectionInfo: object, references: string[], canDelete: boolean}} Deletion state.
   */
  function getAnimationDeletionState(selectionInfo) {
    return deps.getAnimationDeletionState?.(selectionInfo) ?? {
      selectionInfo,
      references: [],
      canDelete: false,
    };
  }

  /**
   * Returns the active animation export state.
   * @returns {object|null} Export state.
   */
  function getActiveAnimationExportState() {
    return deps.getActiveAnimationExportState?.() ?? null;
  }

  /**
   * Downloads the active animation as VMD.
   * @param {object} activeInstance - Active instance.
   */
  async function downloadActiveAnimationAsVmd(activeInstance) {
    const exportData = exportAnimationSourceAsVmd(activeInstance?.animationSource || activeInstance?.vmd || null);
    if (!exportData) {
      return;
    }

    downloadBlob(
      new Blob([exportData.buffer], { type: 'application/octet-stream' }),
      `${activeInstance.model?.name || 'animation'}.vmd`,
    );
  }

  /**
   * Downloads a scene animation source.
   * @param {'camera'|'light'|'shadow'} targetType - Scene animation type.
   */
  async function downloadSceneAnimationSource(targetType) {
    const source = deps.timelineOrchestrationService?.getSceneAnimationSource?.(targetType) || null;
    const exportData = exportAnimationSourceAsVmd(source);
    if (!exportData) {
      return;
    }

    downloadBlob(
      new Blob([exportData.buffer], { type: 'application/octet-stream' }),
      source?.name || `${targetType}.vmd`,
    );
  }

  /**
   * Downloads the active animation source.
   * @param {object} [options={}] - Export options.
   */
  async function downloadActiveAnimationSource(options = {}) {
    const activeInstance = deps.getActiveInstance?.();
    if (!activeInstance) {
      return;
    }

    if (
      activeInstance.animationSourceType === 'gltf'
      && activeInstance.gltfAssetContext?.scene
      && activeInstance.model?.magic !== 'Vrm'
    ) {
      const buffer = await exportAnimationSourcesToGlb(
        activeInstance.gltfAssetContext.scene,
        activeInstance.gltfAnimationSources || [],
      );
      downloadBlob(
        new Blob([buffer], { type: 'model/gltf-binary' }),
        `${activeInstance.model?.name || 'animation'}.glb`,
      );
      return;
    }

    const exportFormat = String(options?.exportFormat || '').trim().toLowerCase();
    if (exportFormat === 'vrma') {
      await deps.vmdManager?.downloadVrma?.({
        instance: activeInstance,
        model: activeInstance.model,
        source: activeInstance.animationSource || null,
        filename: `${activeInstance.model?.name || 'animation'}.vrma`,
        bakeIkToRotation: options?.bakeIkToRotation !== undefined
          ? Boolean(options.bakeIkToRotation)
          : Boolean(activeInstance),
        bakeLowerBodyToHumanoid: options?.bakeLowerBodyToHumanoid !== undefined
          ? Boolean(options.bakeLowerBodyToHumanoid)
          : true,
      });
      return;
    }

    if (exportFormat === 'vmd') {
      await downloadActiveAnimationAsVmd(activeInstance);
      return;
    }

    const chosenExportFormat = await chooseAnimationExportFormat(activeInstance);
    if (chosenExportFormat === 'vrma') {
      await deps.vmdManager?.downloadVrma?.({
        instance: activeInstance,
        model: activeInstance.model,
        source: activeInstance.animationSource || null,
        filename: `${activeInstance.model?.name || 'animation'}.vrma`,
        bakeIkToRotation: options?.bakeIkToRotation !== undefined
          ? Boolean(options.bakeIkToRotation)
          : Boolean(activeInstance),
        bakeLowerBodyToHumanoid: options?.bakeLowerBodyToHumanoid !== undefined
          ? Boolean(options.bakeLowerBodyToHumanoid)
          : true,
      });
      return;
    }

    await downloadActiveAnimationAsVmd(activeInstance);
  }

  return {
    loadZipModel,
    loadModelFile,
    loadModelSettingsFile,
    loadVmd,
    loadVpd,
    loadEnvironmentHdrFile: (...args) => deps.loadEnvironmentHdrFile?.(...args),
    setEnvironmentHdrPath: (...args) => deps.setEnvironmentHdrPath?.(...args),
    setEnvironmentHdrIntensity: (...args) => deps.setEnvironmentHdrIntensity?.(...args),
    setEnvironmentHdrCandidateFiles,
    setModelCandidateFiles,
    togglePlayback: (...args) => deps.timelineOrchestrationService?.togglePlayback?.(...args),
    play: (...args) => deps.timelineOrchestrationService?.play?.(...args),
    pause: (...args) => deps.timelineOrchestrationService?.pause?.(...args),
    rewind: (...args) => deps.timelineOrchestrationService?.rewind?.(...args),
    goToEnd: (...args) => deps.timelineOrchestrationService?.goToEnd?.(...args),
    seek: (...args) => deps.timelineOrchestrationService?.seek?.(...args),
    stepFrame: (...args) => deps.timelineOrchestrationService?.stepFrame?.(...args),
    stepKeyframe: (...args) => deps.timelineOrchestrationService?.stepKeyframe?.(...args),
    setPlaybackRange: (...args) => deps.timelineOrchestrationService?.setPlaybackRange?.(...args),
    getPlaybackRange: (...args) => deps.timelineOrchestrationService?.getPlaybackRange?.(...args),
    getPlaybackController: (...args) => deps.timelineOrchestrationService?.getPlaybackController?.(...args),
    syncBgmPlayback: (...args) => deps.timelineOrchestrationService?.syncBgmPlayback?.(...args),
    activateInstance,
    removeActiveModel,
    removeModelAtIndex,
    setModelVisibility,
    assignVmdToActiveInstance,
    assignAnimationSourceToActiveInstance,
    selectAnimationSource: (...args) => deps.timelineOrchestrationService?.selectAnimationSource?.(...args),
    removeAnimationSource: (...args) => deps.timelineOrchestrationService?.removeAnimationSource?.(...args),
    deleteSelectedKeyframes,
    registerMorphKeyframe,
    registerBoneKeyframe,
    registerCameraKeyframe,
    registerLightKeyframe,
    getActiveInstance,
    setBoneParams,
    resetPhysics,
    selectModel,
    exportVideo: (...args) => deps.videoExportManager?.exportVideo?.(...args),
    downloadActiveAnimationSource,
    downloadSceneAnimationSource,
    getViewerState,
    enterFullscreen,
    exitFullscreen,
    refreshScene,
    syncMaterialTabUi,
    buildUiSettingsData,
    applyUiSettingsData,
    loadUiSettingsFile,
    getModelListState,
    getModelDeletionState,
    getAnimationSourceListState,
    getAnimationDeletionState,
    getActiveAnimationExportState,
  };
}
