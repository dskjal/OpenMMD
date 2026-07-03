/**
 * Creates a facade over application-level commands.
 * @param {object} context - Application context.
 * @returns {object} Facade object.
 */
export function createApplicationFacade(context) {
  const ports = context?.ports ?? {};
  const runtime = context?.runtime ?? ports.viewer ?? {};
  const commands = context?.commands ?? {};

  return {
    ports,
    runtime,
    commands,
    assets: {
      loadModelFile: (...args) => commands.loadModelFile?.(...args),
      loadModelSettingsFile: (...args) => commands.loadModelSettingsFile?.(...args),
      loadZipModel: (...args) => commands.loadZipModel?.(...args),
      loadVmd: (...args) => commands.loadVmd?.(...args),
      loadVpd: (...args) => commands.loadVpd?.(...args),
      loadUiSettingsFile: (...args) => commands.loadUiSettingsFile?.(...args),
      loadEnvironmentHdrFile: (...args) => commands.loadEnvironmentHdrFile?.(...args),
      setEnvironmentHdrPath: (...args) => commands.setEnvironmentHdrPath?.(...args),
      setEnvironmentHdrIntensity: (...args) => commands.setEnvironmentHdrIntensity?.(...args),
      setEnvironmentHdrCandidateFiles: (...args) => commands.setEnvironmentHdrCandidateFiles?.(...args),
      setModelCandidateFiles: (...args) => commands.setModelCandidateFiles?.(...args),
    },
    playback: {
      togglePlayback: (...args) => commands.togglePlayback?.(...args),
      play: (...args) => commands.play?.(...args),
      pause: (...args) => commands.pause?.(...args),
      rewind: (...args) => commands.rewind?.(...args),
      goToEnd: (...args) => commands.goToEnd?.(...args),
      seek: (...args) => commands.seek?.(...args),
      stepFrame: (...args) => commands.stepFrame?.(...args),
      stepKeyframe: (...args) => commands.stepKeyframe?.(...args),
      setPlaybackRange: (...args) => commands.setPlaybackRange?.(...args),
      getPlaybackRange: (...args) => commands.getPlaybackRange?.(...args),
      getPlaybackController: (...args) => commands.getPlaybackController?.(...args),
      syncBgmPlayback: (...args) => commands.syncBgmPlayback?.(...args),
    },
    editing: {
      activateInstance: (...args) => commands.activateInstance?.(...args),
      removeActiveModel: (...args) => commands.removeActiveModel?.(...args),
      removeModelAtIndex: (...args) => commands.removeModelAtIndex?.(...args),
      setModelVisibility: (...args) => commands.setModelVisibility?.(...args),
      assignVmdToActiveInstance: (...args) => commands.assignVmdToActiveInstance?.(...args),
      getActiveInstance: (...args) => commands.getActiveInstance?.(...args),
      setBoneParams: (...args) => commands.setBoneParams?.(...args),
      selectModel: (...args) => commands.selectModel?.(...args),
    },
    ui: {
      getModelListState: (...args) => commands.getModelListState?.(...args),
      getModelDeletionState: (...args) => commands.getModelDeletionState?.(...args),
      getAnimationSourceListState: (...args) => commands.getAnimationSourceListState?.(...args),
      getAnimationDeletionState: (...args) => commands.getAnimationDeletionState?.(...args),
      getActiveAnimationExportState: (...args) => commands.getActiveAnimationExportState?.(...args),
    },
    animation: {
      selectAnimationSource: (...args) => commands.selectAnimationSource?.(...args),
      removeAnimationSource: (...args) => commands.removeAnimationSource?.(...args),
      deleteSelectedKeyframes: (...args) => commands.deleteSelectedKeyframes?.(...args),
      registerMorphKeyframe: (...args) => commands.registerMorphKeyframe?.(...args),
      registerBoneKeyframe: (...args) => commands.registerBoneKeyframe?.(...args),
      registerCameraKeyframe: (...args) => commands.registerCameraKeyframe?.(...args),
      registerLightKeyframe: (...args) => commands.registerLightKeyframe?.(...args),
    },
    export: {
      exportVideo: (...args) => commands.exportVideo?.(...args),
      downloadActiveAnimationSource: (...args) => commands.downloadActiveAnimationSource?.(...args),
      downloadSceneAnimationSource: (...args) => commands.downloadSceneAnimationSource?.(...args),
    },
    system: {
      resetPhysics: (...args) => commands.resetPhysics?.(...args),
      getViewerState: (...args) => commands.getViewerState?.(...args),
      enterFullscreen: (...args) => commands.enterFullscreen?.(...args),
      exitFullscreen: (...args) => commands.exitFullscreen?.(...args),
      refreshScene: (...args) => commands.refreshScene?.(...args),
      syncMaterialTabUi: (...args) => commands.syncMaterialTabUi?.(...args),
      buildUiSettingsData: (...args) => commands.buildUiSettingsData?.(...args),
      applyUiSettingsData: (...args) => commands.applyUiSettingsData?.(...args),
    },
  };
}
