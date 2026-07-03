import { mat4, quat, vec3 } from '../lib/esm/index.js';
import { getBoneInfoDisplayEulerXYZ, getBoneInfoDisplayLocalPosition, getBoneInfoDisplayValues, getBoneInfoDisplayWorldPosition, getEffectiveLocalRotation, getLocalPositionFromBoneInfoDisplayPosition, getLocalRotationFromBoneInfoDisplayRotation } from '../shared/bones/bone-display-utils.js';
import {
  setBoneInfoUiState,
} from '../ui/panels/bone-info-ui.js';
import { PhysicsEngine } from '../core/physics/physics.js';
import { ModelManager, replaceShaderAcrossInstances } from '../core/model/model-manager.js';
import { VMDManager } from '../infrastructure/animation/vmd-manager.js';
import { VPDWriter, buildVpdPoseData } from '../infrastructure/loaders/vpd-writer.js';
import { createCanvasTargets, loadShaderModule } from '../infrastructure/gpu/renderer-resources.js';
import {
  preloadInternalToonTextures,
} from '../infrastructure/gpu/material-resources.js';
import { loadModelSettingsFile } from '../infrastructure/serialization/model-json.js';
import {
  applyUiSettingsJsonData as applyUiSettingsJsonDataFromJson,
  buildUiSettingsJsonData,
  loadUiSettingsFile as loadUiSettingsFileFromJson,
} from '../infrastructure/config/ui-settings-loader.js';
import { HdrEnvironmentLoader } from '../infrastructure/assets/hdr-environment.js';
import { CustomShaderManager } from '../infrastructure/gpu/custom-shader-manager.js';
import {
  isVpdFileName,
} from '../infrastructure/io/file-loading.js';
import {
  applyCameraKeyframesToCamera,
  applyCameraManualFov,
  applyCameraManualPose,
  clearCameraManualPose,
  createAxisAlignedCameraView,
  createCameraEye,
  createCameraRotation,
  createCameraState,
  setCameraManualFov,
  setCameraManualPose,
  setCameraManualView,
} from '../core/scene/camera.js';
import { DOF_UNIFORM_OFFSETS } from '../shared/physics/dof-physics.js';
import {
  createAmbientOcclusionResources,
  createBloomColorDebugResources,
  createBloomShadowDebugResources,
  createBloomShadowDebugPipeline,
  createBloomResources,
  createColorTemperatureScale,
  createContactShadowResources,
  createDofResources,
  createGammaResources,
  createFxaaResources,
  createPostEffectGlobalResources,
  createUiOverlayCompositeResources,
  createGlobalResources,
  createShadowDebugPipeline,
  createSsssResources,
  GLOBAL_UNIFORM_OFFSETS,
  rebuildShadowResources,
  updateContactShadowResources,
  updateEnvironmentResources,
  updateEnvironmentIntensity,
} from '../infrastructure/gpu/renderer-gpu.js';
import {
  clearMorphUI,
  createMorphUI,
  readGridOverlayUIInitialValues,
  readRenderUIInitialValues,
  readPostEffectUIInitialValues,
  setupGridOverlayUI,
  setupUIHandlers,
  setupVideoExportUI,
  setupPostEffectUI,
  syncMorphSliders,
  updateModelListUI,
  updateVmdListUI,
  syncPlaybackRangeUI,
  syncPlaybackRangeLabels,
} from '../ui/renderer-ui.js';
import { setupBgmController } from '../ui/panels/bgm-controller.js';
import { createApplicationContext } from '../application/app-context.js';
import { createApplicationFacade } from '../application/app-facade.js';
import { createApplicationCommands } from '../application/commands/application-commands.js';
import { createPlaybackRuntimeService } from '../application/timeline/playback-runtime-service.js';
import { createTimelineOrchestrationService } from '../application/timeline/timeline-orchestration-service.js';
import { createViewerStateService } from '../application/viewer/viewer-state-service.js';
import { createBoneEditingService } from '../application/editing/bone-editing-service.js';
import { createBoneInspectorService } from '../application/editing/bone-inspector-service.js';
import { createBoneInspectorState, resetBoneInspectorSelectionState } from '../application/editing/bone-inspector-state.js';
import { createBoneParameterCommandService } from '../application/editing/bone-parameter-command-service.js';
import { createCameraEditingService } from '../application/editing/camera-editing-service.js';
import { createLightEditingService } from '../application/editing/light-editing-service.js';
import { createAssetLoadingService } from '../application/assets/asset-loading-service.js';
import { createImportCandidateService } from '../application/assets/import-candidate-service.js';
import { createMaterialPanelService } from '../application/material/material-panel-service.js';
import { createPendingImportService } from '../application/assets/pending-import-service.js';
import { createDebugReadModelService } from '../application/debug/debug-read-model-service.js';
import { createModelLifecycleService } from '../application/models/model-lifecycle-service.js';
import { createTexturePanelService } from '../application/material/texture-panel-service.js';
import { createExportRuntimeService } from '../application/export/export-runtime-service.js';
import { createDisplaySettingsService } from '../application/render/display-settings-service.js';
import { createEnvironmentPanelService } from '../application/render/environment-panel-service.js';
import { createRenderSettingsService } from '../application/render/render-settings-service.js';
import { createShadowPanelService } from '../application/render/shadow-panel-service.js';
import { createInspectorSyncCoordinator } from '../application/scene/inspector-sync-coordinator.js';
import { createSceneRefreshCoordinator } from '../application/scene/scene-refresh-coordinator.js';
import { createSelectionOverlayPort } from '../application/selection/selection-overlay-port.js';
import { createUiReadModelService } from '../application/ui/ui-read-model-service.js';
import { bindViewportInputHandlers } from '../application/interaction/viewport-input-binder.js';
import { startRenderLoop } from '../infrastructure/gpu/render-loop.js';
import { TimelineView } from '../ui/timeline.js';
import { InterpolationPanel } from '../ui/panels/interpolation-panel.js';
import { TimelineManager } from '../application/timeline/timeline-manager.js';
import {
  extractCameraKeyframesFromAnimationClip,
  extractLightKeyframesFromAnimationClip,
} from '../core/animation/animation-clip.js';
import { setupColorPickerUI } from '../ui/panels/color-picker-ui.js';
import { installBoneInspectorController } from '../ui/panels/bone-inspector-controller.js';
import { installCameraEditingController } from '../ui/panels/camera-editing-controller.js';
import { installDebugPanelController } from '../ui/panels/debug-panel-controller.js';
import { installImportCandidatesController } from '../ui/panels/import-candidates-controller.js';
import { installEnvironmentPanelController } from '../ui/panels/environment-panel-controller.js';
import { installLightPanelController } from '../ui/panels/light-panel-controller.js';
import { installMaterialPanelController } from '../ui/panels/material-panel-controller.js';
import { installDisplaySettingsController } from '../ui/panels/display-settings-controller.js';
import { installRenderSettingsController } from '../ui/panels/render-settings-controller.js';
import { installShadowPanelController } from '../ui/panels/shadow-panel-controller.js';
import { installTexturePanelController } from '../ui/panels/texture-panel-controller.js';
import { bindBoneInspectorUiState } from '../ui/panels/bone-inspector-ui-state.js';
import { bindCameraEditingUiState } from '../ui/panels/camera-editing-ui-state.js';
import { bindDebugPanelUiState } from '../ui/panels/debug-panel-ui-state.js';
import { bindDisplaySettingsUiState } from '../ui/panels/display-settings-ui-state.js';
import { bindImportCandidatesUiState } from '../ui/panels/import-candidates-ui-state.js';
import { bindLightUiState } from '../ui/panels/light-ui-state.js';
import { bindSelectionOverlayUiState } from '../ui/panels/selection-overlay-ui-state.js';
import { bindShadowPanelUiState } from '../ui/panels/shadow-panel-ui-state.js';
import { quaternionFromEulerXYZ, quaternionToEulerForBone, quaternionFromEulerForBone } from '../shared/math/math-utils.js';
import { createEmptyVmd } from '../core/animation/timeline-data.js';
import { createGizmoState, getBoneGizmoModes } from '../core/selection/gizmo.js';
import {
  createRuntimeIkSetup,
  findBoneIndexByName,
  getBone,
  getInitialRotationLocksFromBoneName,
  rebuildModelIkLinks,
  refreshSceneIkState,
  removeRuntimeIkSetup,
  updateRuntimeIkTargetRestPosition,
  syncModelIkEntryAliases,
} from '../core/model/model-scene.js';
import {
  findAspectPreset,
  getResolutionOptionsForAspect,
  RENDER_ASPECT_PRESETS,
} from '../shared/render/render-aspect-presets.js';
import {
  clearWorldRotationDisplay,
  setWorldRotationDisplay,
} from '../ui/panels/world-rotation-ui.js';
import {
  applyVmdLightKeyframesToLightObject,
  applyLightManualPose,
  setLightManualPosition,
  setLightManualRotationQuaternion,
  resolveLightKeyframePose,
  createLightObjectState,
  createLightOverlayState,
  setLightPosition,
  setLightRotationQuaternion,
} from '../core/scene/light-object.js';
import {
  getSelectedBoneIndices,
  resolveActiveInstance,
  resolveActiveBoneContext,
  resolveDefaultSelectedBoneIndex,
  resolveSelectedBoneContext,
  resetSelectionForInstanceChange,
  setSingleBoneSelection,
} from '../core/selection/renderer-selection.js';
import { syncViewportLayout } from '../ui/viewport-layout.js';
import {
  createShadowState,
  syncShadowUniforms,
} from '../infrastructure/gpu/renderer-shadow-state.js';
import { VideoExportManager } from '../application/export/video-export-manager.js';
import { createBrowserPlatformAdapter } from '../infrastructure/browser/browser-platform-adapter.js';
import {
  DISPLAY_COLOR_SPACE_SRGB,
  getGpuCanvasColorSpace,
  normalizeDisplayColorSpace,
  normalizeViewTransform,
} from '../shared/math/view-transform.js';
import {
  getAppliedDisplayPresetValues,
  normalizeDisplayPreset,
  readDisplayPresetCookie,
  writeDisplayPresetCookie,
} from '../shared/render/display-preset.js';
import {
  clampEnvironmentHdrIntensity,
  getEnvironmentHdrIntensityMax,
} from '../shared/render/environment-hdr-utils.js';
import {
  getDefaultsSnapshot,
  loadDefaults,
} from '../infrastructure/config/defaults/defaults-manager.js';
import {
  bindLinkedNumericInputs,
  isNumericInputFocused,
} from '../shared/ui/numeric-input-utils.js';
import { denormalizeVpdFromInternalUnits } from '../infrastructure/units/unit-conversion.js';

const MODEL_PATH = "";//'test-data/alicia/';
const MODEL_FILE = "";//`${MODEL_PATH}Alicia_solid.pmx`;
const UNIT_SCALE = 1.0;
let rendererState = null;
let boneEditingService = null;
let cameraEditingService = null;
let lightEditingService = null;
let materialPanelController = null;
let texturePanelController = null;
let getTimelineManager = () => null;
let invokeSyncAnimationMappingTabUi = () => {};

/**
 * Determines whether the default model is configured.
 * @param {string} modelFile - Default model file path.
 * @returns {boolean} Whether the model file should be loaded.
 */
function hasConfiguredDefaultModel(modelFile) {
  return typeof modelFile === 'string' && modelFile.trim().length > 0;
}

/**
 * レンダラーの初期 state を構築します。
 * @param {object} params - 初期値。
 * @param {object} params.renderUIInitialValues - 描画設定 UI の初期値。
 * @param {object} params.postEffectUIInitialValues - ポストエフェクト UI の初期値。
 * @param {object} params.gridOverlayInitialValues - 床グリッド UI の初期値。
 * @param {string} params.initialDisplayPreset - 表示プリセット名。
 * @param {object} params.initialDisplayPresetValues - 表示プリセット適用後の値。
 * @returns {object} renderer state。
 */
function createRendererState({
  renderUIInitialValues,
  postEffectUIInitialValues,
  gridOverlayInitialValues,
  initialDisplayPreset,
  initialDisplayPresetValues,
}) {
  const appDefaults = getDefaultsSnapshot('appState');
  const gridDefaults = getDefaultsSnapshot('gridOverlay');
  const lightColor = Array.isArray(appDefaults.lightColor) ? [...appDefaults.lightColor] : [1.0, 1.0, 1.0, 1.0];
  const environmentHdrIntensityMax = getEnvironmentHdrIntensityMax(appDefaults);
  const gridOverlay = {
    size: Number.isFinite(gridOverlayInitialValues?.size)
      ? gridOverlayInitialValues.size
      : (Number.isFinite(gridDefaults.size) ? gridDefaults.size : 0.5),
    count: Number.isFinite(gridOverlayInitialValues?.count)
      ? Math.round(gridOverlayInitialValues.count)
      : (Number.isFinite(gridDefaults.count) ? Math.round(gridDefaults.count) : 10),
    thickness: Number.isFinite(gridOverlayInitialValues?.thickness)
      ? Math.max(0.1, gridOverlayInitialValues.thickness)
      : (Number.isFinite(gridDefaults.thickness) ? gridDefaults.thickness : 1.0),
  };
  return {
    msaaSampleCount: renderUIInitialValues.msaaSampleCount,
    currentAaMode: renderUIInitialValues.aaMethod,
    renderingFPS: renderUIInitialValues.renderingFPS,
    displayPreset: initialDisplayPreset,
    viewTransform: normalizeViewTransform(initialDisplayPresetValues.viewTransform),
    displayColorSpace: normalizeDisplayColorSpace(renderUIInitialValues.displayColorSpace),
    aspectRatio: renderUIInitialValues.aspectRatio,
    internalResolution: renderUIInitialValues.internalResolution,
    isUpdatingMsaaSampleCount: false,
    needsResize: false,
    showCascadeShadowMaps: false,
    showBloomShadowDebug: false,
    bloomShadowDebugMode: 0,
    shadowMapSize: renderUIInitialValues.shadowMapSize,
    shadowFarAuto: renderUIInitialValues.shadowFarAuto,
    shadowFar: renderUIInitialValues.shadowFar,
    environmentHdrPath: appDefaults.environmentHdrPath || 'test-data/sundowner_deck_1k.hdr',
    environmentHdrName: appDefaults.environmentHdrName || 'sundowner_deck_1k.hdr',
    environmentHdrIntensity: clampEnvironmentHdrIntensity(appDefaults.environmentHdrIntensity, appDefaults),
    environmentHdrIntensityMax,
    environmentHdrLoaded: Boolean(appDefaults.environmentHdrLoaded),
    isVideoExporting: false,
    transparentVideoExportBackground: false,
    lightColor,
    lightObject: createLightObjectState(),
    gridOverlay,
    shadowParams: createShadowState({
      ...renderUIInitialValues,
      shadowPower: initialDisplayPresetValues.shadowPower,
    }),
    postEffects: {
      ...postEffectUIInitialValues,
      gamma: initialDisplayPresetValues.gamma,
      gltfLightStrength: initialDisplayPresetValues.gltfLightStrength,
      ambientOcclusionEnabled: renderUIInitialValues.ambientOcclusionEnabled,
      ambientOcclusionRadius: renderUIInitialValues.ambientOcclusionRadius,
      ambientOcclusionBias: renderUIInitialValues.ambientOcclusionBias,
      ambientOcclusionIntensity: renderUIInitialValues.ambientOcclusionIntensity,
      ambientOcclusionBlurAmount: renderUIInitialValues.ambientOcclusionBlurAmount,
      ambientOcclusionSampleCount: renderUIInitialValues.ambientOcclusionSampleCount,
      contactShadowEnabled: renderUIInitialValues.contactShadowEnabled,
      contactShadowLength: renderUIInitialValues.contactShadowLength,
      contactShadowThickness: renderUIInitialValues.contactShadowThickness,
      contactShadowIntensity: renderUIInitialValues.contactShadowIntensity,
      contactShadowBlurAmount: renderUIInitialValues.contactShadowBlurAmount,
      contactShadowStepCount: renderUIInitialValues.contactShadowStepCount,
    },
  };
}

/** @type {ModelManager|null} */
let modelManager = null;
/** @type {CustomShaderManager|null} */
let shaderManager = null;
/** @type {PhysicsEngine|null} */
let physicsEngine = null;
/** @type {VMDManager} */
let vmdManager = new VMDManager();
/** @type {VPDWriter} */
let vpdWriter = new VPDWriter();
/** @type {TimelineView|null} */
let timelineView = null;
/** @type {VideoExportManager|null} */
let videoExportManager = null;
/** @type {object|null} */
let bgmManager = null;
/** @type {object|null} */
let camera = null;
/** @type {object} */
let cameraUiState = {
  selectedModelIndex: -1,
  selectedBoneName: '',
  modelSelect: null,
  boneSelect: null,
  boneFollowLabel: null,
  fovRange: null,
  fovValue: null,
  fovKeyIcon: null,
  boneKeyIcon: null,
  positionInputs: [],
  rotationInputs: [],
  targetInputs: [],
  positionKeyIcon: null,
  rotationKeyIcon: null,
  targetKeyIcon: null,
  viewShortcutButtons: {
    front: null,
    back: null,
    left: null,
    right: null,
    top: null,
    reset: null,
  },
  lastModelSignature: '',
  lastBoneSignature: '',
};
/** @type {object} */
let lightUiState = {
  positionInputs: [],
  rotationInputs: [],
  rotationKeyIcon: null,
  gltfLightStrengthRange: null,
  gltfLightStrengthValue: null,
  lightColorPicker: null,
  rotationEuler: null,
  prevEuler: [0, 0, 0],
};
/** @type {object|null} */
let boneInspectorUiState = null;
/** @type {object} */
let childUiState = {
  enabledCheckbox: null,
  modelSelect: null,
  boneSelect: null,
  pickButton: null,
  influenceRange: null,
  influenceValue: null,
  setInverseButton: null,
  clearInverseButton: null,
  selectedModelIndex: -1,
  selectedBoneIndex: -1,
  lastModelSignature: '',
  lastBoneSignature: '',
};
/** @type {object} */
let ikUiState = {
  enabledCheckbox: null,
  targetBoneSelect: null,
  chainCountRange: null,
  chainCountValue: null,
  iterationCountRange: null,
  iterationCountValue: null,
  rotationLockButtons: [],
  createButton: null,
  deleteButton: null,
  selectedBoneIndex: -1,
  selectedTargetBoneIndex: -1,
  lastBoneSignature: '',
  chainCountBinding: null,
  iterationCountBinding: null,
};
/** @type {object} */
let depthFocusUiState = {
  inputElements: [],
  pickIcon: null,
};
/** @type {object} */
let postEffectUiState = {
  colorTemperaturePickButton: null,
  syncColorTemperatureInput: null,
};
/** @type {object} */
let bloomShadowDebugUiState = {
  checkbox: null,
  enabled: false,
  modeSelect: null,
  mode: 0,
};
/** @type {object} */
let depthPickState = {
  enabled: false,
  request: null,
  busy: false,
};
/** @type {object} */
let colorTemperaturePickState = {
  enabled: false,
  request: null,
  busy: false,
};
/** @type {{enabled: boolean}} */
let childBonePickState = {
  enabled: false,
};
/** @type {object} */
let selection = {
  selectedBoneIndex: -1,
  selectedBoneIndices: [],
  activeBoneIndex: -1,
  selectedTargetIndex: -1,
  selectedRigidbodyIndex: -1,
  selectedLight: false,
  showBones: true,
  showBoneAxes: false,
  showPhysics: false,
  disablePhysics: false,
  hideIkBones: false,
  hideSpringBones: false,
  showGridXZ: true,
  showGridXY: false,
  showGridYZ: false,
  gridSize: 0.5,
  gridCount: 10,
  gridThickness: 1.0,
  activeInstanceIndex: 0,
};

const boneInspectorState = createBoneInspectorState();

/** @type {object} */
let cameraDebugUiState = {
  output: null,
};
/** @type {object} */
let boneDebugUiState = {
  output: null,
};
/** @type {object} */
let animationDebugUiState = {
  checkbox: null,
  output: null,
};
/** @type {object} */
let clickedMousePositionUiState = {
  output: null,
  clientX: null,
  clientY: null,
  canvasX: null,
  canvasY: null,
};

/** @type {string} */
let currentLang = 'ja';
/** @type {object} */
let langData = {};
/** @type {function():void} */
let syncEnvironmentHdrUi = () => {};
/** @type {function():void} */
let syncModelCandidateUi = () => {};
/** @type {function():void} */
let syncBoneInspectorUi = () => {};
/** @type {function():void} */
let syncMaterialTabUi = () => {};
/** @type {function():void} */
let syncTextureTabUi = () => {};
/** @type {function():object} */
let getModelListUiState = () => ({ activeIndex: -1, items: [] });
/** @type {function():object} */
let getAnimationSourceListUiState = () => ({ entries: [], selectedValue: '', canDeleteSelected: false });

/** @type {Set<number>} */
let activeMorphIndices = new Set();

const BONE_POSITION_INPUT_IDS = ['bone-pos-x', 'bone-pos-y', 'bone-pos-z'];
const BONE_ROTATION_INPUT_IDS = ['bone-rot-x', 'bone-rot-y', 'bone-rot-z'];
const BONE_POSITION_HEADER_ID = 'bone-pos-header';
const BONE_ROTATION_HEADER_ID = 'bone-rot-header';
const BONE_PARENT_NAME_ID = 'bone-parent-bone-name';
const BONE_POSITION_KEY_BUTTON_ID = 'bone-pos-key';
const BONE_ROTATION_KEY_BUTTON_ID = 'bone-rot-key';
const BONE_ROTATION_LOCK_ICON_PATH = 'fonts/lock_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg';
const BONE_ROTATION_UNLOCK_ICON_PATH = 'fonts/lock_open_right_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg';
const CAMERA_FOV_INPUT_IDS = ['camera-fov-range', 'camera-fov-value'];
const CAMERA_POSITION_INPUT_IDS = ['camera-pos-x', 'camera-pos-y', 'camera-pos-z'];
const CAMERA_ROTATION_INPUT_IDS = ['camera-rot-x', 'camera-rot-y', 'camera-rot-z'];
const CAMERA_TARGET_INPUT_IDS = ['camera-target-x', 'camera-target-y', 'camera-target-z'];
const LIGHT_POSITION_INPUT_IDS = ['light-pos-x', 'light-pos-y', 'light-pos-z'];
const LIGHT_ROTATION_INPUT_IDS = ['light-rot-x', 'light-rot-y', 'light-rot-z'];
const CAMERA_VIEW_SHORTCUT_IDS = {
  front: 'camera-view-front',
  back: 'camera-view-back',
  left: 'camera-view-left',
  right: 'camera-view-right',
  top: 'camera-view-top',
  reset: 'camera-view-reset',
};
const DEPTH_FOCUS_INPUT_IDS = ['depth-focus-x', 'depth-focus-y', 'depth-focus-z'];
const DEPTH_FOCUS_PICK_ICON_ID = 'depth-focus-pick';
const CHILD_BONE_PICK_BUTTON_ID = 'bone-child-pick';
const IK_TARGET_BONE_SELECT_ID = 'bone-ik-target-bone-list';
const IK_ENABLED_CHECKBOX_ID = 'bone-ik-enable';
const IK_CHAIN_COUNT_RANGE_ID = 'bone-ik-chain-count-range';
const IK_CHAIN_COUNT_VALUE_ID = 'bone-ik-chain-count-value';
const IK_ITERATION_COUNT_RANGE_ID = 'bone-ik-iteration-count-range';
const IK_ITERATION_COUNT_VALUE_ID = 'bone-ik-iteration-count-value';
const IK_ROTATION_LOCK_BUTTON_IDS = ['bone-ik-rot-lock-x', 'bone-ik-rot-lock-y', 'bone-ik-rot-lock-z'];
const IK_CREATE_BUTTON_ID = 'bone-ik-create';
const IK_DELETE_BUTTON_ID = 'bone-ik-delete';
const CAMERA_FOV_MIN = 1;
const CAMERA_FOV_MAX = 180;
const TEXTURE_COLOR_SPACE_GAMMA_22 = 'gamma-2.2';
const TEXTURE_COLOR_SPACE_NONE = 'none';

/**
 * アクティブなモデルインスタンスを返します。
 * @returns {object|null} アクティブインスタンス。
 */
function getActiveInstance() {
  return resolveActiveInstance(modelManager, selection);
}

/**
 * VPD のダウンロードファイル名を生成します。
 * @param {string} modelName - モデル名。
 * @returns {string} ダウンロードファイル名。
 */
function createVpdDownloadName(modelName) {
  const safeBaseName = String(modelName || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, '_')
    .replace(/[. ]+$/gu, '');
  return `${safeBaseName || 'pose'}.vpd`;
}

/**
 * Downloads binary data through a browser anchor.
 * @param {{fileName: string, buffer: ArrayBuffer}} payload - Download payload.
 */
function downloadBinary(payload) {
  if (!payload?.buffer || typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }

  const blob = new Blob([payload.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = payload.fileName || 'download.bin';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') {
}

/**
 * 現在のボーン選択コンテキストを返します。
 * @returns {{instance: object, selectedBoneIndex: number, bone: object, local: object, bindBone: object}|null} 選択コンテキスト。
 */
function getSelectedBoneContext() {
  return resolveSelectedBoneContext(modelManager, selection);
}

/**
 * 指定フレームに keyframe があるかどうかで input 背景色を決定します。
 * @param {Array<object>|null|undefined} keyframes - keyframe 一覧。
 * @param {number} currentFrame - 現在フレーム。
 * @returns {string} 背景色。
 */
function getKeyframeBackgroundColor(keyframes, currentFrame) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return '';
  }

  const hasKeyAtCurrentFrame = keyframes.some((keyframe) => Math.round(keyframe.frameNum) === currentFrame);
  return hasKeyAtCurrentFrame ? 'var(--on-key-color)' : 'var(--primary-color)';
}

/**
 * ライト keyframe の成分別背景色を返します。
 * @param {Array<object>|null|undefined} keyframes - light keyframe 一覧。
 * @param {number} currentFrame - 現在フレーム。
 * @param {'position'|'rotation'} field - 判定対象成分。
 * @returns {string} 背景色。
 */
function getLightKeyframeBackgroundColor(keyframes, currentFrame, field) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return '';
  }

  const keyframe = keyframes.find((item) => Math.round(item?.frameNum) === currentFrame) || null;
  if (!keyframe) {
    return 'var(--primary-color)';
  }

  if (field === 'position') {
    return keyframe.keyedPosition !== false && keyframe.position
      ? 'var(--on-key-color)'
      : 'var(--primary-color)';
  }

  const hasRotationData = Boolean(keyframe.rotation)
    || Boolean(keyframe.direction)
    || (keyframe.keyedPosition !== false && Boolean(keyframe.position));
  return keyframe.keyedRotation !== false && hasRotationData
    ? 'var(--on-key-color)'
    : 'var(--primary-color)';
}

/**
 * ボーン名に対応する keyframe 一覧を返します。
 * @param {object|null} animationController - アニメーションコントローラー。
 * @param {string} boneName - ボーン名。
 * @returns {Array<object>|null} keyframe 一覧。
 */
function getBoneKeyframesForInspector(animationController, boneName) {
  const normalizedBoneName = String(boneName || '').trim();
  if (!animationController || !normalizedBoneName) {
    return null;
  }

  const animationClip = animationController.animationClip || null;
  if (animationClip && Array.isArray(animationClip.channels)) {
    const keyframes = [];
    for (const channel of animationClip.channels) {
      const target = channel?.target || {};
      if (target.kind !== 'bone' || String(target.name || target.nodeName || '').trim() !== normalizedBoneName) {
        continue;
      }
      for (const keyframe of channel?.sampler?.keyframes || []) {
        const frameNum = Number.isFinite(keyframe?.frameNum)
          ? Math.round(keyframe.frameNum)
          : Math.round((Number(keyframe?.time) || 0) * (animationClip.timelineFps || 30));
        keyframes.push({ frameNum });
      }
    }
    if (keyframes.length > 0) {
      return keyframes;
    }
  }

  const vmd = animationController.vmd || null;
  const boneKeyframes = vmd?.boneKeyframes || vmd?.motions || [];
  const matches = [];
  for (const keyframe of boneKeyframes) {
    if (String(keyframe?.boneName || '').trim() === normalizedBoneName) {
      matches.push(keyframe);
    }
  }
  return matches.length > 0 ? matches : null;
}

/**
 * input 群へ背景色を反映します。
 * @param {Array<HTMLInputElement|null>} inputs - 対象 input。
 * @param {string} backgroundColor - 背景色。
 * @param {boolean} enabled - 有効かどうか。
 */
function setInputBackgroundColor(inputs, backgroundColor, enabled) {
  for (const input of inputs) {
    if (!input) {
      continue;
    }
    input.style.backgroundColor = enabled ? backgroundColor : '';
  }
}

/**
 * 既定のボーン選択をモデルに応じて設定します。
 * @param {object|null} instance - モデルインスタンス。
 */
function selectDefaultBoneForInstance(instance) {
  if (!instance || !instance.model) {
    return;
  }

  const defaultBoneIndex = resolveDefaultSelectedBoneIndex(instance.model);
  if (defaultBoneIndex === -1) {
    return;
  }

  setSingleBoneSelection(selection, defaultBoneIndex);
  resetBoneInspectorSelectionState(boneInspectorState);
}

/**
 * 現在の VMD に含まれる表情のインデックスを計算します。
 */
function updateActiveMorphIndices() {
  activeMorphIndices.clear();
  const inst = getActiveInstance();
  if (!inst) return;

  const morphNames = new Set();
  if ((inst.animationSourceType === 'gltf' || inst.animationSourceType === 'vrma') && inst.animationSource?.clip) {
    for (const channel of inst.animationSource.clip.channels || []) {
      const target = channel?.target || {};
      if (target.kind !== 'morph' || target.path !== 'weights') {
        continue;
      }
      const name = String(target.name || target.nodeName || '').trim();
      if (name) {
        morphNames.add(name);
      }
    }
  } else if (inst.vmd) {
    const faceKeyframes = inst.vmd.faceKeyframes || inst.vmd.morphs || inst.vmd.faces || [];
    for (const kf of faceKeyframes) {
      const name = (kf.name || kf.morphName || "").trim();
      if (name) morphNames.add(name);
    }
  }

  inst.model.morphs.forEach((morph, index) => {
    if (morphNames.has(morph.name)) {
      activeMorphIndices.add(index);
    }
  });
}

/**
 * ボーンの回転ロック状態を返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {{x: boolean, y: boolean, z: boolean}} 回転ロック状態。
 */
function getBoneRotationLocks(bone) {
  const defaultBoneName = bone?.vrmHumanoidBoneName || bone?.name || '';
  const defaultLocks = getInitialRotationLocksFromBoneName(defaultBoneName);
  const locks = bone?.rotationLocks || {};
  return {
    x: Boolean(locks.x ?? defaultLocks.x),
    y: Boolean(locks.y ?? defaultLocks.y),
    z: Boolean(locks.z ?? defaultLocks.z),
  };
}

/**
 * 回転ロック状態をボーンへ反映します。
 * @param {object|null|undefined} bone - ボーン。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationLocks - 反映するロック状態。
 * @returns {{x: boolean, y: boolean, z: boolean}} 正規化済みロック状態。
 */
function setBoneRotationLocks(bone, rotationLocks) {
  if (!bone) {
    return {
      x: Boolean(rotationLocks?.x),
      y: Boolean(rotationLocks?.y),
      z: Boolean(rotationLocks?.z),
    };
  }

  const locks = bone.rotationLocks || { x: false, y: false, z: false };
  locks.x = Boolean(rotationLocks?.x);
  locks.y = Boolean(rotationLocks?.y);
  locks.z = Boolean(rotationLocks?.z);
  bone.rotationLocks = locks;
  return locks;
}

/**
 * ボーンの IK 専用回転ロック状態を返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {{x: boolean, y: boolean, z: boolean}} IK 回転ロック状態。
 */
function getBoneIkRotationLocks(bone) {
  const locks = bone?.ikRotationLocks || {};
  return {
    x: Boolean(locks.x),
    y: Boolean(locks.y),
    z: Boolean(locks.z),
  };
}

/**
 * IK 専用回転ロック状態をボーンへ反映します。
 * @param {object|null|undefined} bone - ボーン。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationLocks - 反映するロック状態。
 * @returns {{x: boolean, y: boolean, z: boolean}} 正規化済みロック状態。
 */
function setBoneIkRotationLocks(bone, rotationLocks) {
  if (!bone) {
    return {
      x: Boolean(rotationLocks?.x),
      y: Boolean(rotationLocks?.y),
      z: Boolean(rotationLocks?.z),
    };
  }

  const locks = bone.ikRotationLocks || { x: false, y: false, z: false };
  locks.x = Boolean(rotationLocks?.x);
  locks.y = Boolean(rotationLocks?.y);
  locks.z = Boolean(rotationLocks?.z);
  bone.ikRotationLocks = locks;
  return locks;
}

/**
 * IK 回転ロックボタン群の状態を同期します。
 * @param {Array<HTMLButtonElement|null>} buttons - 対象ボタン。
 * @param {{x: boolean, y: boolean, z: boolean}} rotationLocks - ロック状態。
 * @param {boolean} enabled - 編集可能かどうか。
 * @param {object} [currentLangData=langData] - 現在のローカライズ辞書。
 */
function setBoneIkRotationUiState(buttons, rotationLocks, enabled, currentLangData = langData) {
  const axes = ['x', 'y', 'z'];
  for (let i = 0; i < buttons.length; i += 1) {
    const button = buttons[i];
    if (!button) {
      continue;
    }

    const axis = axes[i];
    const locked = Boolean(rotationLocks[axis]);
    button.disabled = !enabled;
    button.setAttribute('aria-pressed', String(locked));
    const labelKey = locked ? 'Unlock IK Rotation' : 'Lock IK Rotation';
    const label = currentLangData[labelKey] || (locked ? 'Unlock IK rotation' : 'Lock IK rotation');
    const axisLabel = axis.toUpperCase();
    const buttonLabel = `${axisLabel} ${label}`;
    button.title = buttonLabel;
    button.setAttribute('aria-label', buttonLabel);
    const icon = button.querySelector('.bone-rotation-lock-icon');
    if (icon) {
      icon.src = locked ? BONE_ROTATION_LOCK_ICON_PATH : BONE_ROTATION_UNLOCK_ICON_PATH;
      icon.classList.toggle('is-disabled', !enabled);
    }
  }
}

/**
 * ボーン回転を現在のロック状態に合わせて補正します。
 * @param {object|null|undefined} bone - ボーン。
 * @param {quat|ArrayLike<number>} currentRotation - 現在回転。
 * @param {quat|ArrayLike<number>} targetRotation - 目標回転。
 * @returns {quat} 補正後の回転。
 */
function constrainRotationToBoneLocks(bone, currentRotation, targetRotation) {
  const locks = getBoneRotationLocks(bone);
  if (!locks.x && !locks.y && !locks.z) {
    return quat.clone(targetRotation);
  }

  const boneName = bone?.name || '';
  const currentEuler = quaternionToEulerForBone(currentRotation, boneName);
  const targetEuler = quaternionToEulerForBone(targetRotation, boneName);
  if (locks.x) {
    targetEuler[0] = currentEuler[0];
  }
  if (locks.y) {
    targetEuler[1] = currentEuler[1];
  }
  if (locks.z) {
    targetEuler[2] = currentEuler[2];
  }
  return quaternionFromEulerForBone(targetEuler, boneName, quat.create());
}

/**
 * Child picker のラベルを現在の言語で更新します。
 * @param {object} [currentLangData={}] - 現在のローカライズ辞書。
 */
function syncChildPickButtonLabel(currentLangData = langData) {
  const button = childUiState.pickButton;
  if (!button) {
    return;
  }

  const label = currentLangData['Pick Child Bone'] || 'Pick Child Bone';
  button.title = label;
  button.setAttribute('aria-label', label);
}

/**
 * Child の参照先をピック結果で更新します。
 * @param {object|null} pickedInstance - ピックされたモデルインスタンス。
 * @param {number} pickedBoneIndex - ピックされたボーン index。
 * @returns {boolean} 更新したかどうか。
 */
function applyChildBonePickResult(pickedInstance, pickedBoneIndex) {
  const activeBoneContext = resolveActiveBoneContext(modelManager, selection);
  if (!activeBoneContext || !pickedInstance || !Number.isInteger(pickedBoneIndex) || pickedBoneIndex < 0) {
    return false;
  }

  const targetInstanceIndex = modelManager?.instances?.indexOf?.(pickedInstance) ?? -1;
  if (targetInstanceIndex < 0) {
    return false;
  }

  modelManager.setChildTarget(activeBoneContext.instance, activeBoneContext.boneIndex, targetInstanceIndex, pickedBoneIndex);
  setChildBonePickMode(false);
  refreshScene();
  return true;
}


/**
 * ボーン編集対象の一覧を返します。
 * アクティブボーンがある場合は 1 件だけ返し、ない場合は選択集合全体を返します。
 * @returns {Array<{instance: object, boneIndex: number, local: object, bone: object, bindBone: object}>} 編集対象一覧。
 */
function getBoneEditTargets() {
  const activeBoneContext = resolveActiveBoneContext(modelManager, selection);
  if (activeBoneContext) {
    return [activeBoneContext];
  }

  const inst = getActiveInstance();
  if (!inst) {
    return [];
  }

  return getSelectedBoneIndices(selection, inst)
    .map((boneIndex) => {
      const local = inst.scene.boneLocalTransforms[boneIndex];
      const bone = getBone(inst.model, boneIndex);
      const bindBone = inst.model.bindBones[boneIndex];
      if (!local || !bone || !bindBone) {
        return null;
      }
      return {
        instance: inst,
        boneIndex,
        local,
        bone,
        bindBone,
      };
    })
    .filter((value) => value !== null);
}

/**
 * ボーン編集対象を指定モードで絞り込みます。
 * @param {Array<object>} boneEditTargets - 編集対象一覧。
 * @param {'translation'|'rotation'|'all'} mode - 絞り込みモード。
 * @returns {Array<object>} 絞り込み後の編集対象一覧。
 */
function filterBoneEditTargetsByMode(boneEditTargets, mode) {
  return boneEditTargets.filter((target) => {
    const gizmoModes = getBoneGizmoModes(target.bone);
    if (mode === 'translation') {
      return gizmoModes.translatable;
    }
    if (mode === 'rotation') {
      return gizmoModes.rotatable;
    }
    return gizmoModes.rotatable || gizmoModes.translatable;
  });
}

/**
 * 数値入力の値が不正な場合にのみ既存 state へ戻します。
 * @param {HTMLInputElement|null} input - 対象入力。
 * @param {number} fallbackValue - 復元する値。
 * @param {(value: number) => string} [format] - 表示フォーマッタ。
 */
function restoreNumericInputValueIfInvalid(input, fallbackValue, format = (value) => String(value)) {
  if (!input) {
    return;
  }
  const parsed = Number.parseFloat(String(input.value ?? ''));
  if (Number.isFinite(parsed)) {
    return;
  }
  input.value = format(fallbackValue);
}

/**
 * Camera UI のモデル選択肢を更新します。
 */
function syncCameraModelOptions() {
  const select = cameraUiState.modelSelect;
  if (!select) {
    return;
  }

  const instances = modelManager ? modelManager.instances : [];
  const signature = instances.map((inst, index) => `${index}:${inst.model.name || `Model ${index}`}`).join('|');
  if (!instances.length) {
    cameraUiState.selectedModelIndex = -1;
    select.disabled = true;
    select.value = '';
    cameraUiState.lastModelSignature = signature;
    return;
  }

  const validIndex = Number.isInteger(cameraUiState.selectedModelIndex) && cameraUiState.selectedModelIndex >= 0 && cameraUiState.selectedModelIndex < instances.length
    ? cameraUiState.selectedModelIndex
    : (selection.activeInstanceIndex >= 0 && selection.activeInstanceIndex < instances.length ? selection.activeInstanceIndex : 0);
  const desiredValue = String(validIndex);
  if (signature === cameraUiState.lastModelSignature && select.options.length === instances.length + 1 && select.value === desiredValue) {
    cameraUiState.selectedModelIndex = validIndex;
    return;
  }

  select.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = langData.None || 'None';
  select.appendChild(noneOption);
  instances.forEach((inst, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = inst.model.name || `Model ${index}`;
    select.appendChild(option);
  });

  select.disabled = false;
  cameraUiState.selectedModelIndex = validIndex;
  select.value = desiredValue;
  cameraUiState.lastModelSignature = signature;
}

/**
 * Camera UI の bone 選択肢を更新します。
 * @param {object|null} selectedModelInstance - Camera の対象モデル。
 */
function syncCameraBoneOptions(selectedModelInstance) {
  const select = cameraUiState.boneSelect;
  if (!select) {
    return;
  }

  const bones = selectedModelInstance ? selectedModelInstance.model.bones : [];
  const signature = `${cameraUiState.selectedModelIndex}:${bones.map((bone) => bone.name || '').join('|')}`;
  if (!bones.length) {
    cameraUiState.selectedBoneName = '';
    select.disabled = true;
    select.value = '';
    cameraUiState.lastBoneSignature = signature;
    return;
  }

  const resolvedName = cameraUiState.selectedBoneName === ''
    ? ''
    : (cameraUiState.selectedBoneName && findBoneIndexByName(selectedModelInstance.model, cameraUiState.selectedBoneName) !== -1
      ? cameraUiState.selectedBoneName
      : (getBone(selectedModelInstance.model, 0)?.name || ''));
  if (signature === cameraUiState.lastBoneSignature && select.options.length === bones.length + 1 && select.value === resolvedName) {
    cameraUiState.selectedBoneName = resolvedName;
    return;
  }

  select.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = langData.None || 'None';
  select.appendChild(noneOption);
  bones.forEach((bone) => {
    const option = document.createElement('option');
    option.value = bone.name || '';
    option.textContent = bone.name || '';
    select.appendChild(option);
  });

  select.disabled = false;
  cameraUiState.selectedBoneName = resolvedName;
  select.value = resolvedName;
  cameraUiState.lastBoneSignature = signature;
}

/**
 * Camera UI のアイコン状態を設定します。
 * @param {HTMLImageElement|null} icon - アイコン。
 * @param {boolean} enabled - 有効かどうか。
 */
function setCameraUiIconState(icon, enabled) {
  if (!icon) {
    return;
  }
  icon.hidden = false;
  icon.classList.toggle('is-disabled', !enabled);
}

/**
 * Child UI の入力群を一括で有効化/無効化します。
 * @param {Array<HTMLElement|null>} elements - 対象要素。
 * @param {boolean} enabled - 有効化するなら true。
 */
function setChildUiGroupState(elements, enabled) {
  for (const element of elements) {
    if (!element) {
      continue;
    }
    element.disabled = !enabled;
  }
}

/**
 * Child UI の model select を同期します。
 * @param {object|null} local - 現在のローカル変換。
 * @returns {object|null} 選択されたモデルインスタンス。
 */
function syncChildModelOptions(local) {
  const select = childUiState.modelSelect;
  if (!select) {
    return null;
  }

  const instances = Array.isArray(modelManager?.instances) ? modelManager.instances : [];
  const signature = instances.map((inst) => inst.model?.name || '').join('|');
  const selectedModelIndex = Number.isInteger(local?.childSourceInstanceIndex)
    && local.childSourceInstanceIndex >= 0
    && local.childSourceInstanceIndex < instances.length
    ? local.childSourceInstanceIndex
    : -1;
  if (signature === childUiState.lastModelSignature && select.options.length === instances.length + 1 && select.value === String(selectedModelIndex === -1 ? '' : selectedModelIndex)) {
    childUiState.selectedModelIndex = selectedModelIndex;
    return selectedModelIndex >= 0 ? instances[selectedModelIndex] ?? null : null;
  }

  select.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = langData.None || 'None';
  select.appendChild(noneOption);
  instances.forEach((inst, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = inst.model?.name || `Model ${index}`;
    select.appendChild(option);
  });

  select.disabled = instances.length === 0;
  select.value = selectedModelIndex === -1 ? '' : String(selectedModelIndex);
  childUiState.selectedModelIndex = selectedModelIndex;
  childUiState.lastModelSignature = signature;
  return selectedModelIndex >= 0 ? instances[selectedModelIndex] ?? null : null;
}

/**
 * Child UI の bone select を同期します。
 * @param {object|null} selectedModelInstance - 選択中モデル。
 * @param {object|null} local - 現在のローカル変換。
 */
function syncChildBoneOptions(selectedModelInstance, local) {
  const select = childUiState.boneSelect;
  if (!select) {
    return;
  }

  const bones = selectedModelInstance ? selectedModelInstance.model.bones : [];
  const signature = `${childUiState.selectedModelIndex}:${bones.map((bone) => bone.name || '').join('|')}`;
  const selectedBoneIndex = Number.isInteger(local?.childSourceBoneIndex)
    && local.childSourceBoneIndex >= 0
    && local.childSourceBoneIndex < bones.length
    ? local.childSourceBoneIndex
    : -1;
  if (signature === childUiState.lastBoneSignature && select.options.length === bones.length + 1 && select.value === String(selectedBoneIndex === -1 ? '' : selectedBoneIndex)) {
    childUiState.selectedBoneIndex = selectedBoneIndex;
    return;
  }

  select.innerHTML = '';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = langData.None || 'None';
  select.appendChild(noneOption);
  bones.forEach((bone, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = bone.name || `Bone ${index}`;
    select.appendChild(option);
  });

  const hasModel = Boolean(selectedModelInstance && bones.length > 0);
  select.disabled = !hasModel;
  select.value = selectedBoneIndex === -1 ? '' : String(selectedBoneIndex);
  childUiState.selectedBoneIndex = selectedBoneIndex;
  childUiState.lastBoneSignature = signature;
}

/**
 * Child UI の有効状態を更新します。
 * @param {object|null} activeInstance - アクティブなモデルインスタンス。
 */
function syncChildUiState(activeInstance) {
  const selectedBoneContext = resolveActiveBoneContext(modelManager, selection);
  const local = selectedBoneContext?.local ?? null;
  const controls = [
    childUiState.enabledCheckbox,
    childUiState.modelSelect,
    childUiState.boneSelect,
    childUiState.pickButton,
    childUiState.influenceRange,
    childUiState.influenceValue,
    childUiState.setInverseButton,
    childUiState.clearInverseButton,
  ];

  if (!local) {
    setChildUiGroupState(controls, false);
    if (childUiState.enabledCheckbox) {
      childUiState.enabledCheckbox.checked = false;
    }
    if (childUiState.modelSelect) {
      childUiState.modelSelect.value = '';
    }
    if (childUiState.boneSelect) {
      childUiState.boneSelect.value = '';
    }
    setChildBonePickMode(false);
    if (childUiState.influenceRange) {
      childUiState.influenceRange.value = '1';
    }
    if (childUiState.influenceValue) {
      childUiState.influenceValue.value = '1';
    }
    childUiState.selectedModelIndex = -1;
    childUiState.selectedBoneIndex = -1;
    childUiState.lastModelSignature = '';
    childUiState.lastBoneSignature = '';
    syncChildPickButtonLabel();
    return;
  }

  const targetModelInstance = syncChildModelOptions(local);
  syncChildBoneOptions(targetModelInstance, local);

  const hasValidTarget = Boolean(targetModelInstance && childUiState.selectedBoneIndex >= 0);
  const enabled = Boolean(local.childEnabled);

  setChildUiGroupState(controls, true);
  if (childUiState.enabledCheckbox) {
    childUiState.enabledCheckbox.checked = enabled;
  }
  if (childUiState.influenceRange) {
    const influence = Number.isFinite(local.childInfluence) ? Math.min(1, Math.max(0, local.childInfluence)) : 1;
    const nextValue = influence.toFixed(2);
    if (!isNumericInputFocused(childUiState.influenceRange)) {
      childUiState.influenceRange.value = nextValue;
    }
    if (childUiState.influenceValue && !isNumericInputFocused(childUiState.influenceValue)) {
      childUiState.influenceValue.value = nextValue;
    }
  }
  if (childUiState.setInverseButton) {
    childUiState.setInverseButton.disabled = !hasValidTarget;
  }
  if (childUiState.clearInverseButton) {
    childUiState.clearInverseButton.disabled = !hasValidTarget;
  }
  if (childUiState.pickButton) {
    childUiState.pickButton.disabled = false;
  }
  syncChildPickButtonLabel();
}

/**
 * 現在の選択中ボーンに対応する IK エントリを返します。
 * @returns {{instance: object, activeBoneIndex: number, boneIndex: number, bone: object, local: object, bindBone: object, ikIndex: number, ik: object}|null} IK コンテキスト。
 */
function resolveActiveIkContext() {
  const activeBoneContext = resolveActiveBoneContext(modelManager, selection);
  if (!activeBoneContext) {
    return null;
  }

  const ikList = Array.isArray(activeBoneContext.instance.model?.ik) ? activeBoneContext.instance.model.ik : [];
  const ikIndex = ikList.findIndex((ik) => ik && ik.boneIndex === activeBoneContext.activeBoneIndex);
  if (ikIndex < 0) {
    return null;
  }

  return {
    ...activeBoneContext,
    ikIndex,
    ik: ikList[ikIndex],
  };
}

/**
 * IK ターゲットボーンの select を同期します。
 * @param {object} activeInstance - アクティブなモデルインスタンス。
 * @param {object} ik - IK エントリ。
 */
function syncIkTargetBoneOptions(activeInstance, ik) {
  const select = ikUiState.targetBoneSelect;
  if (!select) {
    return;
  }

  const bones = Array.isArray(activeInstance?.model?.bones) ? activeInstance.model.bones : [];
  const signature = `${activeInstance?.model?.name || ''}:${bones.map((bone) => bone.name || '').join('|')}`;
  const selectedTargetBoneIndex = Number.isInteger(ik?.targetBoneIndex)
    && ik.targetBoneIndex >= 0
    && ik.targetBoneIndex < bones.length
    ? ik.targetBoneIndex
    : -1;

  if (signature === ikUiState.lastBoneSignature && select.options.length === bones.length && select.value === String(selectedTargetBoneIndex === -1 ? '' : selectedTargetBoneIndex)) {
    ikUiState.selectedTargetBoneIndex = selectedTargetBoneIndex;
    return;
  }

  select.innerHTML = '';
  bones.forEach((bone, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = bone.name || `Bone ${index}`;
    select.appendChild(option);
  });

  select.disabled = bones.length === 0;
  select.value = selectedTargetBoneIndex === -1 ? '' : String(selectedTargetBoneIndex);
  ikUiState.selectedTargetBoneIndex = selectedTargetBoneIndex;
  ikUiState.lastBoneSignature = signature;
}

/**
 * IK チェーン数の input 群を同期します。
 * @param {object} ik - IK エントリ。
 */
function syncIkChainCountInputs(ik) {
  const binding = ikUiState.chainCountBinding;
  if (!binding) {
    return;
  }

  const chainCount = Math.max(1, Math.min(10, Array.isArray(ik?.links) ? ik.links.length : 1));
  binding.syncFromValue(chainCount, { forceValue: false, forceRange: false });
}

/**
 * IK 反復回数の input 群を同期します。
 * @param {object} ik - IK エントリ。
 */
function syncIkIterationCountInputs(ik) {
  const binding = ikUiState.iterationCountBinding;
  if (!binding) {
    return;
  }

  const iterationCount = Math.max(
    1,
    Number.isFinite(ik?.loopCount)
      ? Math.round(ik.loopCount)
      : Number.isFinite(ik?.iteration)
        ? Math.round(ik.iteration)
        : 1,
  );
  binding.syncFromValue(iterationCount, { forceValue: false, forceRange: false });
}

/**
 * IK の有効状態を UI へ同期します。
 * @param {object} ik - IK エントリ。
 */
function syncIkEnabledCheckbox(ik) {
  if (ikUiState.enabledCheckbox) {
    ikUiState.enabledCheckbox.checked = ik?.enabled !== false;
  }
}

/**
 * IK 専用回転ロック UI を同期します。
 * @param {object|null} activeBoneContext - 選択中ボーン context。
 * @param {object} [currentLangData=langData] - 現在のローカライズ辞書。
 */
function syncIkRotationLockControls(activeBoneContext, currentLangData = langData) {
  const buttons = Array.isArray(ikUiState.rotationLockButtons) ? ikUiState.rotationLockButtons : [];
  if (!activeBoneContext?.bone) {
    setBoneIkRotationUiState(buttons, { x: false, y: false, z: false }, false, currentLangData);
    return;
  }

  setBoneIkRotationUiState(buttons, getBoneIkRotationLocks(activeBoneContext.bone), true, currentLangData);
}

/**
 * IK UI の表示と有効状態を更新します。
 * @param {object|null} activeInstance - アクティブなモデルインスタンス。
 * @param {object} [currentLangData=langData] - 現在のローカライズ辞書。
 */
function syncIkUiState(activeInstance, currentLangData = langData) {
  const activeBoneContext = resolveActiveBoneContext(modelManager, selection);
  const selectedIkContext = resolveActiveIkContext();
  const ik = selectedIkContext?.ik ?? null;
  syncIkRotationLockControls(activeBoneContext, currentLangData);
  const controls = [
    ikUiState.enabledCheckbox,
    ikUiState.targetBoneSelect,
    ikUiState.chainCountRange,
    ikUiState.chainCountValue,
    ikUiState.iterationCountRange,
    ikUiState.iterationCountValue,
  ];
  const canCreateIk = Boolean(
    activeBoneContext
    && !selectedIkContext
    && activeBoneContext.bone?.runtimeGeneratedIkBone !== true,
  );
  const canDeleteIk = Boolean(
    selectedIkContext
    && selectedIkContext.bone?.runtimeGeneratedIkBone === true
    && selectedIkContext.ik?.runtimeGeneratedIk === true,
  );
  if (ikUiState.createButton) {
    ikUiState.createButton.disabled = !canCreateIk;
  }
  if (ikUiState.deleteButton) {
    ikUiState.deleteButton.disabled = !canDeleteIk;
  }

  if (!activeInstance || !selectedIkContext || !ik) {
    setChildUiGroupState(controls, false);
    if (ikUiState.enabledCheckbox) {
      ikUiState.enabledCheckbox.checked = false;
    }
    if (ikUiState.targetBoneSelect) {
      ikUiState.targetBoneSelect.innerHTML = '';
      ikUiState.targetBoneSelect.value = '';
    }
    if (ikUiState.chainCountRange) {
      ikUiState.chainCountRange.value = '1';
    }
    if (ikUiState.chainCountValue) {
      ikUiState.chainCountValue.value = '1';
    }
    if (ikUiState.iterationCountRange) {
      ikUiState.iterationCountRange.value = '1';
    }
    if (ikUiState.iterationCountValue) {
      ikUiState.iterationCountValue.value = '1';
    }
    ikUiState.selectedBoneIndex = -1;
    ikUiState.selectedTargetBoneIndex = -1;
    ikUiState.lastBoneSignature = '';
    return;
  }

  const bones = Array.isArray(selectedIkContext.instance.model?.bones) ? selectedIkContext.instance.model.bones : [];
  const hasValidTarget = Number.isInteger(ik.targetBoneIndex) && ik.targetBoneIndex >= 0 && ik.targetBoneIndex < bones.length;
  setChildUiGroupState(controls, true);
  syncIkEnabledCheckbox(ik);
  syncIkTargetBoneOptions(selectedIkContext.instance, ik);
  syncIkChainCountInputs(ik);
  syncIkIterationCountInputs(ik);
  if (ikUiState.targetBoneSelect) {
    ikUiState.targetBoneSelect.value = hasValidTarget ? String(ik.targetBoneIndex) : '';
  }
  ikUiState.selectedBoneIndex = selectedIkContext.activeBoneIndex;
  ikUiState.selectedTargetBoneIndex = hasValidTarget ? ik.targetBoneIndex : -1;
}

/**
 * IK の有効状態変更をモデルへ反映します。
 * @param {boolean} nextEnabled - 新しい有効状態。
 * @returns {boolean} 反映できたら true。
 */
function applyIkEnabledFromUi(nextEnabled) {
  return boneEditingService?.applyIkEnabled?.(nextEnabled) ?? false;
}

/**
 * IK UI の設定をモデルへ反映します。
 * @param {number} nextTargetBoneIndex - 新しいターゲットボーン index。
 * @returns {boolean} 反映できたら true。
 */
function applyIkTargetFromUi(nextTargetBoneIndex) {
  return boneEditingService?.applyIkTarget?.(nextTargetBoneIndex) ?? false;
}

/**
 * IK チェーン数の変更をモデルへ反映します。
 * @param {number} nextChainCount - 新しいチェーン数。
 * @returns {boolean} 反映できたら true。
 */
function applyIkChainCountFromUi(nextChainCount) {
  return boneEditingService?.applyIkChainCount?.(nextChainCount) ?? false;
}

/**
 * IK 反復回数の変更をモデルへ反映します。
 * @param {number} nextIterationCount - 新しい反復回数。
 * @returns {boolean} 反映できたら true。
 */
function applyIkIterationCountFromUi(nextIterationCount) {
  return boneEditingService?.applyIkIterationCount?.(nextIterationCount) ?? false;
}

/**
 * IK 専用回転ロックの変更をボーンへ反映します。
 * @param {'x'|'y'|'z'} axis - 対象軸。
 * @returns {boolean} 反映できたら true。
 */
function applyIkRotationLockFromUi(axis) {
  return boneEditingService?.applyIkRotationLock?.(axis) ?? false;
}

/**
 * IK 設定ボタンから新規 IK を作成します。
 * @returns {boolean} 作成できたら true。
 */
function applyCreateIkFromUi() {
  return boneEditingService?.applyCreateIk?.() ?? false;
}

/**
 * IK 削除ボタンから IK を削除します。
 * @returns {boolean} 削除できたら true。
 */
function applyDeleteIkFromUi() {
  return boneEditingService?.applyDeleteIk?.() ?? false;
}

/**
 * 数値 input 群を更新します。
 * @param {Array<HTMLInputElement|null>} inputs - 対象 input。
 * @param {ArrayLike<number>} values - 反映値。
 * @param {number} fractionDigits - 表示桁数。
 */
function syncNumberInputs(inputs, values, fractionDigits) {
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) {
      continue;
    }
    const nextValue = Number(values[i] ?? 0).toFixed(fractionDigits);
    if (!isNumericInputFocused(input) && input.value !== nextValue) {
      input.value = nextValue;
    }
  }
}

/**
 * Light タブの position と rotation 入力を state に反映します。
 */
function syncLightPositionFromUi() {
  if (lightEditingService?.applyPositionFromInputs?.()) {
    refreshScene();
  }
}

/**
 * Light タブの rotation 入力を state に反映します。
 */
function syncLightRotationFromUi() {
  if (lightEditingService?.applyRotationFromInputs?.()) {
    refreshScene();
  }
}

/**
 * Camera の位置または注視点 input から state を同期します。
 */
function syncCameraPoseFromPositionTargetUi() {
  if (cameraEditingService?.applyPoseFromInputs?.()) {
    refreshScene();
  }
}

/**
 * Camera の回転 input から state を同期します。
 */
function syncCameraRotationFromUi() {
  if (cameraEditingService?.applyRotationFromInputs?.()) {
    refreshScene();
  }
}

/**
 * Camera の look-at ターゲット位置を取得します。
 * @returns {ArrayLike<number>|null} ターゲット位置。
 */
function getCameraLookAtTargetPosition() {
  return cameraEditingService?.getLookAtTargetPosition?.() ?? null;
}

/**
 * viewport canvas の aspect 比を返します。
 * @returns {number} aspect 比。
 */
function getViewportCanvasAspect() {
  const canvas = document.querySelector('#viewport canvas');
  if (!canvas) {
    return 16 / 9;
  }

  const width = Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : canvas.clientWidth;
  const height = Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : canvas.clientHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return 16 / 9;
  }

  return width / height;
}

/**
 * WebGPU canvas の display 色空間を反映します。
 * @param {GPUCanvasContext} context - WebGPU canvas context。
 * @param {GPUDevice} device - WebGPU device。
 * @param {GPUTextureFormat} presentationFormat - presentation format。
 * @param {string} requestedDisplayColorSpace - 要求された display 色空間。
 * @returns {'srgb'|'display-p3'} 実際に設定された色空間。
 */
function configureCanvasDisplayColorSpace(context, device, presentationFormat, requestedDisplayColorSpace) {
  const requestedColorSpace = getGpuCanvasColorSpace(requestedDisplayColorSpace);
  const configure = (colorSpace) => {
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
      colorSpace,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
  };

  try {
    configure(requestedColorSpace);
    return requestedColorSpace;
  } catch (error) {
    if (requestedColorSpace === DISPLAY_COLOR_SPACE_SRGB) {
      throw error;
    }
    console.warn(`Display color space '${requestedColorSpace}' is not supported. Falling back to '${DISPLAY_COLOR_SPACE_SRGB}'.`, error);
    configure(DISPLAY_COLOR_SPACE_SRGB);
    return DISPLAY_COLOR_SPACE_SRGB;
  }
}

/**
 * アクティブモデルの AABB を基準に camera を指定方向へ切り替えます。
 * @param {'x'|'y'|'z'} viewAxis - 視線軸。
 * @param {number} axisSign - 視線軸の符号。
 */
function applyCameraViewShortcut(viewAxis, axisSign) {
  if (cameraEditingService?.applyViewShortcut?.(viewAxis, axisSign)) {
    refreshScene();
  }
}

/**
 * camera の manual 姿勢を解除します。
 */
function resetCameraManualPoseShortcut() {
  if (cameraEditingService?.resetManualPose?.()) {
    refreshScene();
  }
}

/**
 * ピックしたボーンを camera look-at の対象として登録します。
 * @param {number} modelIndex - モデルインデックス。
 * @param {number} boneIndex - ボーンインデックス。
 */
function registerCameraLookAtTarget(modelIndex, boneIndex) {
  cameraEditingService?.registerLookAtTarget?.(modelIndex, boneIndex);
}

/**
 * Camera の look-at 対象を解除します。
 * @returns {boolean} 解除できたかどうか。
 */
function clearCameraLookAtTarget() {
  return cameraEditingService?.clearLookAtTarget?.() ?? false;
}

/**
 * Camera の look-at が有効かどうかを返します。
 * @returns {boolean} 有効かどうか。
 */
function isCameraLookAtEnabled() {
  return cameraEditingService?.isLookAtEnabled?.() ?? false;
}

/**
 * camera VMD が有効かどうかを返します。
 * @param {object|null} activeInstance - アクティブなモデルインスタンス。
 * @returns {boolean} camera VMD があるかどうか。
 */
function hasCameraKeyframes(activeInstance) {
  return cameraEditingService?.hasCameraKeyframes?.(activeInstance) ?? false;
}

/**
 * 被写界深度の数値入力を更新します。
 * @param {ArrayLike<number>} position - ワールド座標。
 */
function syncDepthFocusInputs(position) {
  for (let i = 0; i < depthFocusUiState.inputElements.length; i++) {
    const input = depthFocusUiState.inputElements[i];
    if (!input) {
      continue;
    }
    const nextValue = Number(position[i] ?? 0).toFixed(3);
    if (!isNumericInputFocused(input) && input.value !== nextValue) {
      input.value = nextValue;
    }
  }

  rendererState.postEffects.dofFocusPoint = [
    Number(position[0] ?? 0.0),
    Number(position[1] ?? 0.0),
    Number(position[2] ?? 0.0),
  ];
}

/**
 * 被写界深度の入力欄から state を同期します。
 */
function syncDepthFocusStateFromInputs() {
  const nextFocusPoint = depthFocusUiState.inputElements.map((input, index) => {
    const fallback = rendererState.postEffects.dofFocusPoint?.[index] ?? 0.0;
    if (!input) {
      return fallback;
    }
    const parsed = Number.parseFloat(input.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  });
  rendererState.postEffects.dofFocusPoint = nextFocusPoint;
}

/**
 * スポイトモードの有効/無効を切り替えます。
 * @param {boolean} enabled - 有効かどうか。
 */
function setColorTemperaturePickMode(enabled) {
  colorTemperaturePickState.enabled = enabled;
  if (!enabled) {
    colorTemperaturePickState.request = null;
  } else {
    depthPickState.enabled = false;
    depthPickState.request = null;
    childBonePickState.enabled = false;
  }
  syncViewportPickModeUi();
}

/**
 * いずれかの viewport pick モードが有効な場合に UI を同期します。
 */
function syncViewportPickModeUi() {
  document.body.classList.toggle('is-depth-pick-mode', depthPickState.enabled);
  document.body.classList.toggle('is-child-bone-pick-mode', childBonePickState.enabled);
  document.body.classList.toggle('is-color-temperature-pick-mode', colorTemperaturePickState.enabled);
  if (depthFocusUiState.pickIcon) {
    depthFocusUiState.pickIcon.classList.toggle('is-active', depthPickState.enabled);
    depthFocusUiState.pickIcon.setAttribute('aria-pressed', String(depthPickState.enabled));
  }
  if (childUiState.pickButton) {
    childUiState.pickButton.classList.toggle('is-active', childBonePickState.enabled);
    childUiState.pickButton.setAttribute('aria-pressed', String(childBonePickState.enabled));
  }
  if (postEffectUiState.colorTemperaturePickButton) {
    postEffectUiState.colorTemperaturePickButton.classList.toggle('is-active', colorTemperaturePickState.enabled);
    postEffectUiState.colorTemperaturePickButton.setAttribute('aria-pressed', String(colorTemperaturePickState.enabled));
  }
}

/**
 * 色温度ピックボタンのラベルを現在の言語で更新します。
 * @param {object} [currentLangData=langData] - 現在のローカライズ辞書。
 */
function syncColorTemperaturePickButtonLabel(currentLangData = langData) {
  const button = postEffectUiState.colorTemperaturePickButton;
  if (!button) {
    return;
  }

  const label = currentLangData['Pick viewport color'] || 'Pick viewport color';
  button.title = label;
  button.setAttribute('aria-label', label);
}

/**
 * スポイトモードの有効/無効を切り替えます。
 * @param {boolean} enabled - 有効かどうか。
 */
function setDepthPickMode(enabled) {
  depthPickState.enabled = enabled;
  if (!enabled) {
    depthPickState.request = null;
  } else {
    colorTemperaturePickState.enabled = false;
    colorTemperaturePickState.request = null;
    childBonePickState.enabled = false;
  }
  syncViewportPickModeUi();
}

/**
 * Child のボーンピックモードを切り替えます。
 * @param {boolean} enabled - 有効かどうか。
 */
function setChildBonePickMode(enabled) {
  childBonePickState.enabled = enabled;
  if (enabled) {
    depthPickState.enabled = false;
    depthPickState.request = null;
    colorTemperaturePickState.enabled = false;
    colorTemperaturePickState.request = null;
  }
  syncViewportPickModeUi();
}

/**
 * 深度ピック要求をキューに積みます。
 * @param {number} clientX - 画面上の X 座標。
 * @param {number} clientY - 画面上の Y 座標。
 * @param {string} [mode='focus'] - ピック結果の反映先。
 */
function queueDepthPick(clientX, clientY, mode = 'focus') {
  depthPickState.request = { clientX, clientY, mode };
}

/**
 * 深度ピック結果を入力欄へ反映します。
 * @param {ArrayLike<number>} position - ワールド座標。
 * @param {{mode?: string}|null} [request=null] - 元のピック要求。
 */
function applyDepthPickResult(position, request = null) {
  if (request?.mode === 'camera-center' && camera) {
    vec3.copy(camera.center, position);
    const activeInstance = getActiveInstance();
    const currentFrame = activeInstance?.animationController.currentFrame;
    if (Number.isFinite(currentFrame)) {
      setCameraManualPose(camera, camera.center, camera.distance, camera.phi, camera.theta, camera.roll, currentFrame);
    }
    clearCameraLookAtTarget();
  } else {
    syncDepthFocusInputs(position);
  }
  setDepthPickMode(false);
}

/**
 * 色温度ピック要求をキューに積みます。
 * @param {number} clientX - 画面上の X 座標。
 * @param {number} clientY - 画面上の Y 座標。
 */
function queueColorTemperaturePick(clientX, clientY) {
  colorTemperaturePickState.request = { clientX, clientY };
}

/**
 * 色温度ピック結果を反映します。
 * @param {number|null} temperature - 推定された色温度。
 */
function applyColorTemperaturePickResult(temperature) {
  setColorTemperaturePickMode(false);
  if (!Number.isFinite(temperature)) {
    return;
  }

  const nextTemperature = Math.min(40000, Math.max(1000, Math.round(temperature / 100) * 100));
  rendererState.postEffects.colorTemperature = nextTemperature;
  postEffectUiState.syncColorTemperatureInput?.(nextTemperature, true);
  syncPostEffectParametersFromState();
  refreshScene();
}

/**
 * 言語辞書をロードします。
 * @param {string} lang - 言語コード。
 */
async function loadLanguage(lang) {
  const response = await fetch(`source/langs/${lang}.json`);
  langData = await response.json();
  currentLang = lang;
  updateUIStrings();
}

/**
 * UI 文字列を現在の言語で更新します。
 */
function updateUIStrings() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    element.textContent = langData[key] || key;
  });
  syncBoneInspectorUi(getActiveInstance(), langData);
  syncColorTemperaturePickButtonLabel(langData);
  syncPlaybackRangeLabels(langData);
  bgmManager?.refreshUi?.();
  syncEnvironmentHdrUi();
  syncModelCandidateUi();
  updateModelListUI(getModelListUiState(), langData);
  updateVmdListUI(getAnimationSourceListUiState(), langData);
  syncMaterialTabUi();
  document.dispatchEvent(new Event('openmmd-languagechange'));
}

/**
 * bloom shadow のデバッグ表示を更新します。
 */
function syncBloomShadowDebugUi() {
  if (!bloomShadowDebugUiState.checkbox) {
    bloomShadowDebugUiState.checkbox = document.getElementById('show-bloom-shadow-debug');
  }
  if (!bloomShadowDebugUiState.modeSelect) {
    bloomShadowDebugUiState.modeSelect = document.getElementById('bloom-shadow-debug-mode');
  }

  const checkbox = bloomShadowDebugUiState.checkbox;
  const modeSelect = bloomShadowDebugUiState.modeSelect;
  if (!checkbox || !modeSelect) {
    return;
  }

  const enabled = Boolean(checkbox.checked);
  const parsedMode = Number.parseInt(modeSelect.value ?? '0', 10);
  const mode = Number.isInteger(parsedMode) ? Math.min(8, Math.max(0, parsedMode)) : 0;
  bloomShadowDebugUiState.enabled = enabled;
  bloomShadowDebugUiState.mode = mode;
  if (rendererState) {
    rendererState.showBloomShadowDebug = enabled;
    rendererState.bloomShadowDebugMode = mode;
  }
  modeSelect.disabled = !enabled;
}

export async function bootstrapOpenMmdApp(options = {}) {
  const platformAdapter = createBrowserPlatformAdapter({
    windowObject: globalThis.window ?? null,
    documentObject: globalThis.document ?? null,
    navigatorObject: globalThis.navigator ?? null,
    performanceObject: globalThis.performance ?? null,
  });
  const documentRef = platformAdapter.documentObject;
  const gpuAdapters = platformAdapter.getGpu();
  const enterAppFullscreen = typeof options.enterAppFullscreen === 'function'
    ? options.enterAppFullscreen
    : async () => {};
  const exitAppFullscreen = typeof options.exitAppFullscreen === 'function'
    ? options.exitAppFullscreen
    : async () => {};

  if (!gpuAdapters.gpu) {
    alert('WebGPU not supported! Please use a modern browser (Chrome, Edge).');
    return;
  }

  await loadDefaults();
  const adapter = await gpuAdapters.gpu.requestAdapter();
  const requiredFeatures = [];
  if (adapter.features.has('texture-compression-bc')) {
    requiredFeatures.push('texture-compression-bc');
  }
  const device = await adapter.requestDevice({ requiredFeatures });
  const canvas = documentRef.querySelector('#viewport canvas');
  const context = canvas.getContext('webgpu');
  const presentationFormat = gpuAdapters.preferredCanvasFormat;
  const renderUIInitialValues = readRenderUIInitialValues();
  const postEffectUIInitialValues = readPostEffectUIInitialValues();
  const gridOverlayInitialValues = readGridOverlayUIInitialValues();
  const initialDisplayPreset = readDisplayPresetCookie();
  const initialDisplayPresetValues = getAppliedDisplayPresetValues(initialDisplayPreset, {
    gltfLightStrength: postEffectUIInitialValues.gltfLightStrength,
    shadowPower: renderUIInitialValues.shadowPower,
  });
  rendererState = createRendererState({
    renderUIInitialValues,
    postEffectUIInitialValues,
    gridOverlayInitialValues,
    initialDisplayPreset,
    initialDisplayPresetValues,
  });
  rendererState.displayColorSpace = configureCanvasDisplayColorSpace(
    context,
    device,
    presentationFormat,
    rendererState.displayColorSpace,
  );
  const displayColorSpaceSelector = documentRef.getElementById('display-color-space-selector');
  if (displayColorSpaceSelector) {
    displayColorSpaceSelector.value = rendererState.displayColorSpace;
  }
  const sceneSyncPort = {
    refreshScene: () => {},
    syncTimelineUi: () => {},
    syncInspectorUi: () => {},
    syncCameraUiState: () => {},
    syncLightTabUi: () => {},
    syncCameraDebugUi: () => {},
  };
  const panelSyncPort = {
    syncEnvironmentHdrUi: () => {},
    syncModelCandidateUi: () => {},
    syncBoneInspectorUi: () => {},
    syncMaterialTabUi: () => {},
    syncTextureTabUi: () => {},
    syncAnimationMappingTabUi: () => {},
    syncRenderPanels: () => {},
  };
  let refreshScene = (...args) => sceneSyncPort.refreshScene(...args);
  let syncTimelineUi = (...args) => sceneSyncPort.syncTimelineUi(...args);
  let syncInspectorUi = (...args) => sceneSyncPort.syncInspectorUi(...args);
  let syncCameraUiState = (...args) => sceneSyncPort.syncCameraUiState(...args);
  let syncLightTabUi = (...args) => sceneSyncPort.syncLightTabUi(...args);
  let syncCameraDebugUi = (...args) => sceneSyncPort.syncCameraDebugUi(...args);

  const canvasTargets = createCanvasTargets(device, canvas, presentationFormat, rendererState.msaaSampleCount, rendererState.internalResolution);
  shaderManager = new CustomShaderManager(device);
  await shaderManager.init();
  // 初回の自動ロードモデルが cookie 由来の表示プリセットを反映できるよう、先に既定 MMD シェーダを切り替える。
  shaderManager.setDefaultMmdShaderName(initialDisplayPresetValues.shaderName);
  const defaultShaderName = shaderManager.getDefaultShaderNameForModel({ magic: 'Pmd' });
  const shaderModule = await shaderManager.getShaderModule(defaultShaderName);
  const fxaaShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/fxaa.wgsl');
  const bloomShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/bloom.wgsl');
  const gammaShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/gamma.wgsl');
  const dofShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/dof.wgsl');
  const sssShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/sss.wgsl');
  const sssMaskShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/sss-mask.wgsl');
  const ambientOcclusionMaskShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/ambient-occlusion-mask.wgsl');
  const ambientOcclusionMaskMsaaShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/ambient-occlusion-mask-msaa.wgsl');
  const contactShadowMaskShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/contact-shadow-mask.wgsl');
  const contactShadowMaskMsaaShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/contact-shadow-mask-msaa.wgsl');
  const uiOverlayCompositeShaderModule = await loadShaderModule(device, 'source/infrastructure/gpu/shaders/post-effect/ui-overlay-composite.wgsl');
  const globalResources = createGlobalResources(device, {
    shadowMapSize: rendererState.shadowMapSize,
    shadowEdgeSize: rendererState.shadowParams.shadowEdgeSize,
    shadowEdgeOpacity: rendererState.shadowParams.shadowEdgeOpacity,
    shadowPower: rendererState.shadowParams.shadowPower,
    shadowBias: rendererState.shadowParams.shadowBias,
    shadowStrength: rendererState.shadowParams.shadowStrength,
    gridThickness: rendererState.gridOverlay.thickness,
    lightColor: rendererState.lightColor,
    lightDirection: rendererState.lightObject.direction,
    gltfLightStrength: rendererState.postEffects.gltfLightStrength,
    dynamicRange: rendererState.environmentHdrIntensityMax,
  });
  globalResources.gridThickness = rendererState.gridOverlay.thickness;
  rendererState.lightObject.uiOverlay = createLightOverlayState(device);
  const environmentLoader = new HdrEnvironmentLoader(device);
  const { environmentHdrUiState, modelCandidateUiState } = bindImportCandidatesUiState(documentRef);
  const pendingImportService = createPendingImportService();
  let importCandidateService = null;

  /**
   * 環境テクスチャ表示名を整形します。
   * @param {string} sourcePath - ソースパス。
   * @returns {string} 表示名。
   */
  function getEnvironmentHdrDisplayName(sourcePath) {
    const fallbackName = 'sundowner_deck_1k.hdr';
    const normalized = typeof sourcePath === 'string' ? sourcePath.trim() : '';
    if (!normalized) {
      return fallbackName;
    }

    const parts = normalized.split(/[\\/]/);
    const last = parts[parts.length - 1] || normalized;
    return last || fallbackName;
  }

  /**
   * HDR 環境マップを読み込み、グローバルリソースへ反映します。
   * @param {string|Blob|ArrayBuffer|Uint8Array|ArrayLike<number>} source - HDR ソース。
   * @param {{sourcePath?: string}} [options={}] - 付加情報。
   * @returns {Promise<void>}
   */
  async function reloadEnvironmentMap(source = rendererState.environmentHdrPath, options = {}) {
    const sourcePath = typeof options.sourcePath === 'string' && options.sourcePath.trim()
      ? options.sourcePath.trim()
      : typeof source === 'string'
        ? source.trim()
        : rendererState.environmentHdrPath;
    const environmentResources = await environmentLoader.load(source, { sourcePath });
    const nextIntensity = clampEnvironmentHdrIntensity(rendererState.environmentHdrIntensity, rendererState.environmentHdrIntensityMax);
    environmentResources.intensity = nextIntensity;
    rendererState.environmentHdrPath = environmentResources.sourcePath || sourcePath || rendererState.environmentHdrPath;
    rendererState.environmentHdrName = getEnvironmentHdrDisplayName(rendererState.environmentHdrPath);
    rendererState.environmentHdrIntensity = nextIntensity;
    rendererState.environmentHdrLoaded = Boolean(environmentResources.loaded);
    updateEnvironmentResources(device, globalResources, environmentResources);
    syncEnvironmentHdrUi();
  }

  const setEnvironmentHdrPath = async (hdrPath) => {
    importCandidateService?.clearEnvironmentHdrCandidates?.();
    rendererState.environmentHdrPath = typeof hdrPath === 'string' && hdrPath.trim()
      ? hdrPath.trim()
      : 'test-data/sundowner_deck_1k.hdr';
    rendererState.environmentHdrName = getEnvironmentHdrDisplayName(rendererState.environmentHdrPath);
    await reloadEnvironmentMap(rendererState.environmentHdrPath, { sourcePath: rendererState.environmentHdrPath });
  };

  const loadEnvironmentHdrFile = async (file, options = {}) => {
    if (!file) {
      return;
    }

    const preserveCandidates = Boolean(options?.preserveCandidates);
    if (!preserveCandidates) {
      importCandidateService?.clearEnvironmentHdrCandidates?.();
    }

    rendererState.environmentHdrPath = typeof file.name === 'string' && file.name.trim()
      ? file.name.trim()
      : rendererState.environmentHdrPath;
    rendererState.environmentHdrName = getEnvironmentHdrDisplayName(rendererState.environmentHdrPath);
    await reloadEnvironmentMap(file, { sourcePath: rendererState.environmentHdrPath });
  };

  const setEnvironmentHdrIntensity = (intensity) => {
    const nextValue = clampEnvironmentHdrIntensity(intensity, rendererState.environmentHdrIntensityMax);
    rendererState.environmentHdrIntensity = nextValue;
    updateEnvironmentIntensity(device, globalResources, nextValue);
    syncEnvironmentHdrUi();
  };

  await reloadEnvironmentMap(rendererState.environmentHdrPath);
  await preloadInternalToonTextures(device, globalResources.internalToonTextureCache);
  globalResources.shadowDebugPipeline = createShadowDebugPipeline(
    device,
    shaderModule,
    presentationFormat,
    globalResources.globalBindGroupLayout,
  );
  const postEffectGlobalResources = createPostEffectGlobalResources(device, globalResources);
  const linearColorFormat = 'rgba16float';

  const postEffectSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const gammaResources = createGammaResources(
    device,
    gammaShaderModule,
    presentationFormat,
    postEffectSampler,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    {
      gamma: rendererState.postEffects.gamma,
      colorTemperature: rendererState.postEffects.colorTemperature,
      chromaticAberration: rendererState.postEffects.chromaticAberration,
      viewTransform: rendererState.viewTransform,
      displayColorSpace: rendererState.displayColorSpace,
    },
  );
  const { fxaaPipeline, fxaaBindGroup } = createFxaaResources(
    device,
    fxaaShaderModule,
    linearColorFormat,
    canvasTargets,
    postEffectSampler,
    gammaResources.gammaSettingsBuffer,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
  );
  const bloomResources = createBloomResources(
    device,
    bloomShaderModule,
    linearColorFormat,
    postEffectSampler,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    {
      ...rendererState.postEffects,
      dynamicRange: rendererState.environmentHdrIntensityMax,
    },
  );
  const bloomShadowDebugPipeline = createBloomShadowDebugPipeline(
    device,
    shaderModule,
    presentationFormat,
    globalResources.globalBindGroupLayout,
  );
  const bloomShadowDebugResources = createBloomShadowDebugResources(
    device,
    bloomShaderModule,
    presentationFormat,
    postEffectSampler,
  );
  const bloomColorDebugResources = createBloomColorDebugResources(
    device,
    bloomShaderModule,
    presentationFormat,
    postEffectSampler,
  );
  const dofResources = createDofResources(
    device,
    dofShaderModule,
    linearColorFormat,
    postEffectSampler,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    rendererState.postEffects,
  );
  const ssssResources = createSsssResources(
    device,
    sssShaderModule,
    sssMaskShaderModule,
    linearColorFormat,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    rendererState.postEffects,
  );
  const ambientOcclusionResources = createAmbientOcclusionResources(
    device,
    ambientOcclusionMaskShaderModule,
    ambientOcclusionMaskMsaaShaderModule,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    rendererState.postEffects,
  );
  const contactShadowResources = createContactShadowResources(
    device,
    contactShadowMaskShaderModule,
    contactShadowMaskMsaaShaderModule,
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    rendererState.postEffects,
  );
  updateContactShadowResources(
    device,
    globalResources,
    canvasTargets.getPrepassDepthView(),
    canvasTargets.getPrepassNormalView(),
    canvasTargets.getContactShadowMaskView(),
    contactShadowResources.contactShadowSettingsBuffer,
    canvasTargets.getAmbientOcclusionMaskView(),
    ambientOcclusionResources.ambientOcclusionSettingsBuffer,
  );
  const uiOverlayCompositeResources = createUiOverlayCompositeResources(
    device,
    uiOverlayCompositeShaderModule,
    presentationFormat,
  );

  /**
   * ポストエフェクトの UI 値を GPU uniform に同期します。
   */
  function syncPostEffectParametersFromState() {
    const colorTemperatureScale = createColorTemperatureScale(rendererState.postEffects.colorTemperature);
    const bloomAlpha = Math.min(1.0, Math.max(0.0, Number.isFinite(rendererState.postEffects.bloomAlpha) ? rendererState.postEffects.bloomAlpha : 1.0));
    const gltfLightStrength = Math.min(
      rendererState.environmentHdrIntensityMax,
      Math.max(0.0, Number.isFinite(rendererState.postEffects.gltfLightStrength) ? rendererState.postEffects.gltfLightStrength : 1.0),
    );
    rendererState.postEffects.bloomAlpha = bloomAlpha;
    rendererState.postEffects.bloomShadowMultiplier = Math.min(
      1.0,
      Math.max(0.0, Number.isFinite(rendererState.postEffects.bloomShadowMultiplier) ? rendererState.postEffects.bloomShadowMultiplier : 0.0),
    );
    rendererState.postEffects.gltfLightStrength = gltfLightStrength;
    bloomResources.bloomSettingsData[0] = rendererState.postEffects.bloomThreshold;
    bloomResources.bloomSettingsData[1] = rendererState.postEffects.bloomBlurAmount;
    bloomResources.bloomSettingsData[2] = bloomAlpha;
    bloomResources.bloomSettingsData[3] = rendererState.environmentHdrIntensityMax;
    bloomResources.bloomSettingsData[4] = rendererState.postEffects.bloomShadowMultiplier;
    device.queue.writeBuffer(bloomResources.bloomSettingsBuffer, 0, bloomResources.bloomSettingsData);
    syncBloomShadowDebugUi();
    gammaResources.gammaSettingsData[0] = rendererState.postEffects.gamma;
    gammaResources.gammaSettingsData[1] = rendererState.postEffects.chromaticAberration;
    gammaResources.gammaSettingsData[2] = colorTemperatureScale[0];
    gammaResources.gammaSettingsData[3] = colorTemperatureScale[1];
    gammaResources.gammaSettingsData[4] = colorTemperatureScale[2];
    gammaResources.gammaSettingsData[5] = rendererState.postEffects.filmGrainAmount ?? 0.0;
    gammaResources.gammaSettingsData[6] = 0.0;
    gammaResources.gammaSettingsData[7] = rendererState.postEffects.filmGrainAnimationMode === 'always' ? 1.0 : 0.0;
    gammaResources.setDisplayTransformModes(rendererState.viewTransform, rendererState.displayColorSpace);
    device.queue.writeBuffer(gammaResources.gammaSettingsBuffer, 0, gammaResources.gammaSettingsData);
    globalResources.gltfLightStrength = gltfLightStrength;
    globalResources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 2] = gltfLightStrength;
    globalResources.edgeUniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 2] = gltfLightStrength;
    device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);
    device.queue.writeBuffer(globalResources.edgeUniformBuffer, 0, globalResources.edgeUniformData);
    dofResources.dofSettingsData[DOF_UNIFORM_OFFSETS.blurAmount] = rendererState.postEffects.dofBlurAmount ?? 2.0;
    dofResources.dofSettingsData[DOF_UNIFORM_OFFSETS.fStop] = rendererState.postEffects.dofFStop ?? 2.8;
    dofResources.dofSettingsData[DOF_UNIFORM_OFFSETS.algorithm] = rendererState.postEffects.dofAlgorithm === 'thin-lens-multisample'
      ? 2.0
      : (rendererState.postEffects.dofAlgorithm === 'depth-aware-gather' ? 1.0 : 0.0);
    device.queue.writeBuffer(dofResources.dofSettingsBuffer, 0, dofResources.dofSettingsData);
    ssssResources.sssSettingsData[0] = rendererState.postEffects.sssRadius ?? 1.5;
    ssssResources.sssSettingsData[1] = rendererState.postEffects.sssDepthThreshold ?? 0.01;
    ssssResources.sssSettingsData[2] = rendererState.postEffects.sssNormalThreshold ?? 0.2;
    ssssResources.sssSettingsData[3] = rendererState.postEffects.sssStrength ?? 0.2;
    device.queue.writeBuffer(ssssResources.sssSettingsBuffer, 0, ssssResources.sssSettingsData);
  }
  syncPostEffectParametersFromState();

  /**
   * 影関連の UI 値を uniform に同期します。
   */
  function syncShadowParametersFromState() {
    syncShadowUniforms(globalResources, device, rendererState.shadowParams);
  }
  syncShadowParametersFromState();

  modelManager = new ModelManager(
    device,
    shaderModule,
    presentationFormat,
    rendererState.msaaSampleCount,
    globalResources,
  );
  modelManager.setShaderManager(shaderManager);
  physicsEngine = new PhysicsEngine();
  physicsEngine.setModelManager(modelManager);
  await physicsEngine.init();

  timelineView = new TimelineView();

  const interpolationPanel = new InterpolationPanel({
    onChanged: (index, values) => {
    const activeInstance = getActiveInstance();
    if (
      activeInstance &&
      activeInstance.vmd &&
      timelineView.selectedTrack &&
      timelineView.selectedTrack.category !== 'header' &&
      timelineView.selectedKeyframeEntries &&
      timelineView.selectedKeyframeEntries.length === 1 &&
      timelineView.selectedKeyframe
    ) {
      const kf = timelineView.selectedKeyframe.source;
      if (kf && kf.interpolation) {
        interpolationPanel.getInterpolationArray(kf.interpolation);
        refreshScene();
        }
      }
    }
  });

  /** @type {TimelineManager|null} */
  let timelineManager = new TimelineManager({
    modelManager,
    selection,
    timelineView,
    interpolationPanel,
    vmdManager,
    refreshScene: () => refreshScene(),
    updateVmdListUI: () => updateVmdListUI(getAnimationSourceListUiState(), langData),
  });
  getTimelineManager = () => timelineManager;
  const playbackRuntimeService = createPlaybackRuntimeService({
    timelineManager,
    getTimelineManager,
    syncPlaybackRangeUi: (playbackRange) => syncPlaybackRangeUI(playbackRange),
  });
  const modelLifecycleService = createModelLifecycleService({
    modelManager,
    physicsEngine,
    vmdManager,
    selection,
    unitScale: UNIT_SCALE,
    playbackRuntimeService,
    getActiveInstance,
    getLangData: () => langData,
    refreshScene: () => refreshScene(),
    renderMorphUi: createMorphUI,
    clearMorphUi: clearMorphUI,
    syncMaterialTabUi: () => syncMaterialTabUi(),
    syncAnimationMappingTabUi: (...args) => panelSyncPort.syncAnimationMappingTabUi(...args),
    syncTimelineRuntimeState: () => playbackRuntimeService.syncTimelineRuntimeState(),
    syncPlaybackRangeUi: (playbackRange) => syncPlaybackRangeUI(playbackRange),
    updateActiveMorphIndices,
    updateModelListUI: () => updateModelListUI(getModelListUiState(), langData),
    updateModelListUi: () => updateModelListUI(getModelListUiState(), langData),
    updateVmdListUI: () => updateVmdListUI(getAnimationSourceListUiState(), langData),
    clearWorldRotationDisplay: () => clearWorldRotationDisplay(boneInspectorState.worldRotationUiState),
    selectDefaultBoneForInstance,
  });
  const assetLoadingService = createAssetLoadingService({
    vmdManager,
    modelManager,
    selection,
    physicsEngine,
    playbackRuntimeService,
    getActiveInstance,
    getBgmManager: () => bgmManager,
    modelLifecycleService,
    beforeLoadModelFile: () => pendingImportService.clearPendingSettingsFiles(),
    confirmModelMismatch: (message) => platformAdapter.confirm(message),
    refreshScene: () => refreshScene(),
    updateVmdListUI: () => updateVmdListUI(getAnimationSourceListUiState(), langData),
    updateActiveMorphIndices,
  });
  const timelineOrchestrationService = createTimelineOrchestrationService({
    timelineManager,
    getTimelineManager,
    modelManager,
    selection,
    vmdManager,
    getBgmManager: () => bgmManager,
    getActiveInstance,
    refreshScene: (...args) => refreshScene(...args),
    updateVmdListUI: () => updateVmdListUI(getAnimationSourceListUiState(), langData),
    updateActiveMorphIndices,
    syncPlaybackRangeUi: (playbackRange) => syncPlaybackRangeUI(playbackRange),
    syncAnimationMappingTabUi: (...args) => panelSyncPort.syncAnimationMappingTabUi(...args),
  });
  const uiReadModelService = createUiReadModelService({
    modelManager,
    selection,
    vmdManager,
    getActiveInstance,
  });
  getModelListUiState = () => uiReadModelService.getModelListState();
  getAnimationSourceListUiState = () => uiReadModelService.getAnimationSourceListState();
  const { selectionUiState, boneThicknessInput } = bindSelectionOverlayUiState(documentRef);
  selection.gridSize = rendererState.gridOverlay.size;
  selection.gridCount = rendererState.gridOverlay.count;
  selection.gridThickness = rendererState.gridOverlay.thickness;
  const selectionOverlayPort = createSelectionOverlayPort({
    selection,
    uiState: {
      ...selectionUiState,
      boneThicknessInput,
    },
    rendererState,
    physicsEngine,
    globalResources,
    globalUniformOffsets: GLOBAL_UNIFORM_OFFSETS,
    device,
    onRefreshRequested: () => refreshScene(),
    onVisibilityChanged: () => {
      selection.gridSize = rendererState.gridOverlay.size;
      selection.gridCount = rendererState.gridOverlay.count;
      selection.gridThickness = rendererState.gridOverlay.thickness;
    },
  });
  selectionOverlayPort.bind();
  if (boneThicknessInput) {
    boneThicknessInput.addEventListener('blur', () => {
      restoreNumericInputValueIfInvalid(boneThicknessInput, rendererState.boneThickness);
    });
  }
  boneInspectorUiState = bindBoneInspectorUiState(documentRef);
  Object.assign(childUiState, boneInspectorUiState.child);
  Object.assign(ikUiState, boneInspectorUiState.ik);
  syncChildPickButtonLabel();
  boneInspectorUiState.rotationLockButtons.forEach((button) => {
    if (button.hasAttribute('data-bone-ik-rotation-axis')) {
      return;
    }
    button.addEventListener('click', () => {
      const axis = button.getAttribute('data-bone-rotation-axis');
      if (!axis) {
        return;
      }

      const activeBoneContext = resolveActiveBoneContext(modelManager, selection);
      const bone = activeBoneContext?.bone;
      if (!bone) {
        return;
      }

      const locks = getBoneRotationLocks(bone);
      setBoneRotationLocks(bone, {
        ...locks,
        [axis]: !locks[axis],
      });
      refreshScene();
    });
  });
  setupGridOverlayUI({
    selection: selectionUiState,
    state: rendererState.gridOverlay,
    refreshScene: () => refreshScene(),
    onChanged: () => {
      selectionOverlayPort.syncFlagsFromUi();
      selection.gridSize = rendererState.gridOverlay.size;
      selection.gridCount = rendererState.gridOverlay.count;
      selection.gridThickness = rendererState.gridOverlay.thickness;
      globalResources.gridThickness = rendererState.gridOverlay.thickness;
      syncShadowUniforms(globalResources, device, rendererState.shadowParams);
    },
  });

  const cameraEditingUiState = bindCameraEditingUiState(documentRef);
  Object.assign(cameraUiState, cameraEditingUiState.cameraUiState);
  cameraUiState.selectedModelIndex = selection.activeInstanceIndex;
  Object.assign(depthFocusUiState, cameraEditingUiState.depthFocusUiState);
  depthFocusUiState.inputElements.forEach((input) => {
    if (input) {
      input.addEventListener('input', syncDepthFocusStateFromInputs);
    }
  });
  if (depthFocusUiState.pickIcon) {
    depthFocusUiState.pickIcon.addEventListener('click', () => {
      setDepthPickMode(!depthPickState.enabled);
    });
  }
  syncDepthFocusInputs(rendererState.postEffects.dofFocusPoint);
  setDepthPickMode(false);

  /**
   * 表示プリセットの UI を現在の state へ同期します。
   */
  let shadowPanelUiState = null;
  let displaySettingsUiState = null;
  let displaySettingsController = null;
  let shadowPanelController = null;
  let environmentPanelController = null;
  let lightPanelController = null;
  let environmentPanelService = null;
  let shadowPanelService = null;
  let displaySettingsService = null;
  let renderSettingsService = null;
  let videoExportUiApi = null;

  function syncRenderPanels(forceLightStrengthSync = false) {
    displaySettingsController?.sync?.();
    postEffectUiState?.sync?.();
    shadowPanelController?.sync?.();
    environmentPanelController?.sync?.();
    lightPanelController?.sync?.(forceLightStrengthSync);
  }
  panelSyncPort.syncRenderPanels = (...args) => syncRenderPanels(...args);

  /**
   * 表示プリセットを適用します。
   * @param {string} preset - 表示プリセット。
   * @param {{persist?: boolean}} [options={}] - 適用オプション。
   * @returns {Promise<void>} 完了 Promise。
   */
  async function applyDisplayPreset(preset, options = {}) {
    const normalizedPreset = normalizeDisplayPreset(preset);
    const appliedValues = getAppliedDisplayPresetValues(normalizedPreset, {
      gltfLightStrength: rendererState.postEffects.gltfLightStrength,
      shadowPower: rendererState.shadowParams.shadowPower,
      environmentHdrIntensity: rendererState.environmentHdrIntensity,
    });
    const targetShaderNames = new Set(['mmd-shader.wgsl']);

    rendererState.displayPreset = appliedValues.preset;
    rendererState.viewTransform = appliedValues.viewTransform;
    rendererState.postEffects.gamma = appliedValues.gamma;
    rendererState.postEffects.gltfLightStrength = appliedValues.gltfLightStrength;
    rendererState.shadowParams.shadowPower = appliedValues.shadowPower;
    if (rendererState.environmentHdrIntensity !== appliedValues.environmentHdrIntensity) {
      setEnvironmentHdrIntensity(appliedValues.environmentHdrIntensity);
    }

    shaderManager?.setDefaultMmdShaderName?.(appliedValues.shaderName);
    if (options.persist !== false) {
      writeDisplayPresetCookie(document, appliedValues.preset);
    }
    syncPostEffectParametersFromState();
    syncShadowParametersFromState();

    if (modelManager) {
      for (const sourceShaderName of targetShaderNames) {
        if (sourceShaderName === appliedValues.shaderName) {
          continue;
        }
        await replaceShaderAcrossInstances(modelManager, sourceShaderName, appliedValues.shaderName);
      }
    }

    panelSyncPort.syncRenderPanels(true);
    syncMaterialTabUi?.();
    refreshScene?.();
  }

  const langSelector = document.getElementById('lang-selector');
  langSelector.addEventListener('change', (event) => {
      const lang = event.target.value;
      platformAdapter.writeLanguage(lang);
      loadLanguage(lang);
  });

  const savedLang = platformAdapter.readLanguage();
  if (savedLang) {
    langSelector.value = savedLang;
    await loadLanguage(savedLang);
  } else {
    await loadLanguage('ja');
  }

  panelSyncPort.syncRenderPanels();
  syncBloomShadowDebugUi();

  postEffectUiState = setupPostEffectUI({
    state: rendererState,
    onChanged: syncPostEffectParametersFromState,
    onColorTemperaturePickToggle: () => {
      setColorTemperaturePickMode(!colorTemperaturePickState.enabled);
    },
    includeShadowControls: false,
  });
  syncColorTemperaturePickButtonLabel(langData);
  syncViewportPickModeUi();

  Object.assign(lightUiState, bindLightUiState(documentRef));
  lightUiState.lightColorPicker = setupColorPickerUI({
    state: rendererState,
    propertyName: 'lightColor',
    strengthRangeInputId: null,
    strengthValueInputId: null,
    strengthMin: 0.0,
    strengthMax: rendererState.environmentHdrIntensityMax,
    applyValue: (nextValue) => {
      rendererState.lightColor = nextValue;
      refreshScene();
    },
    title: 'Light Color',
  });
  const environmentHdrIntensityRange = environmentHdrUiState.intensityRange;
  const environmentHdrIntensityValue = environmentHdrUiState.intensityValue;
  importCandidateService = createImportCandidateService({
    onStateChanged: () => {
      syncEnvironmentHdrUi();
      syncModelCandidateUi();
    },
    loadEnvironmentHdrFile: async (file, extraOptions = {}) => loadEnvironmentHdrFile(file, extraOptions),
    clearPendingImports: () => pendingImportService.clearAllPendingImports(),
    loadModelFile: async (file) => assetLoadingService.loadModelFile(file),
    loadZipModel: async (zipFiles) => assetLoadingService.loadZipModel(zipFiles),
    consumePendingSettingsFiles: async () => pendingImportService.consumePendingSettingsFiles(),
    consumePendingPoseFiles: async () => pendingImportService.consumePendingPoseFiles(),
  });
  const importCandidatesController = installImportCandidatesController({
    documentRef: document,
    candidateService: importCandidateService,
    getLangData: () => langData,
    getEnvironmentHdrUiState: () => environmentHdrUiState,
    getModelCandidateUiState: () => modelCandidateUiState,
    loadEnvironmentHdrFile: async (file) => loadEnvironmentHdrFile(file),
  });
  syncEnvironmentHdrUi = (...args) => importCandidatesController.syncEnvironmentHdrUi(...args);
  syncModelCandidateUi = (...args) => importCandidatesController.syncModelCandidateUi(...args);
  panelSyncPort.syncEnvironmentHdrUi = (...args) => syncEnvironmentHdrUi(...args);
  panelSyncPort.syncModelCandidateUi = (...args) => syncModelCandidateUi(...args);
  environmentPanelService = createEnvironmentPanelService({
    rendererState,
  });
  environmentPanelController = installEnvironmentPanelController({
    uiState: environmentHdrUiState,
    service: environmentPanelService,
    refreshScene: () => refreshScene(),
    getDisplayName: () => rendererState.environmentHdrName || getEnvironmentHdrDisplayName(rendererState.environmentHdrPath),
    getIntensityMax: () => rendererState.environmentHdrIntensityMax,
    onValueApplied: (appliedValue) => {
      setEnvironmentHdrIntensity(appliedValue);
      syncEnvironmentHdrUi();
    },
  });
  syncEnvironmentHdrUi();

  shadowPanelUiState = bindShadowPanelUiState(documentRef);
  bloomShadowDebugUiState.checkbox = shadowPanelUiState.bloomShadowDebugCheckbox;
  bloomShadowDebugUiState.modeSelect = shadowPanelUiState.bloomShadowDebugModeSelect;
  shadowPanelService = createShadowPanelService({
    rendererState,
  });
  shadowPanelController = installShadowPanelController({
    uiState: shadowPanelUiState,
    service: shadowPanelService,
    onShadowChanged: () => syncShadowParametersFromState(),
    onPostEffectChanged: () => {
      syncPostEffectParametersFromState();
      syncShadowParametersFromState();
    },
    restoreNumericInputValueIfInvalid,
    syncBloomShadowDebugUi,
    rebuildShadowResources: (nextSize) => {
      if (!Number.isFinite(nextSize) || nextSize === rendererState.shadowMapSize) {
        return;
      }
      rebuildShadowResources(device, globalResources, nextSize);
    },
    getShowCascadeShadowMaps: () => rendererState.showCascadeShadowMaps,
    getShowBloomShadowDebug: () => rendererState.showBloomShadowDebug,
    getBloomShadowDebugMode: () => rendererState.bloomShadowDebugMode,
    getShadowMapSize: () => rendererState.shadowMapSize,
    getShadowFarAuto: () => rendererState.shadowFarAuto,
    getShadowFar: () => rendererState.shadowFar,
  });
  syncShadowParametersFromState();
  syncBloomShadowDebugUi();

  displaySettingsUiState = bindDisplaySettingsUiState(documentRef);
  displaySettingsService = createDisplaySettingsService({
    rendererState,
  });
  rendererState.aspectRatio = findAspectPreset(rendererState.aspectRatio).id;
  renderSettingsService = createRenderSettingsService({
    rendererState,
    renderAspectPresets: RENDER_ASPECT_PRESETS,
    findAspectPreset,
    getResolutionOptionsForAspect,
    onViewportLayoutChanged: (aspectRatioId) => {
      syncViewportLayout({ aspectRatioId });
    },
    onRenderResolutionChanged: ({ aspectRatio, internalResolution }) => {
      platformAdapter.dispatchRenderResolutionChanged({ aspectRatio, internalResolution });
    },
  });
  const renderSettingsController = installRenderSettingsController({
    documentRef,
    windowTarget: platformAdapter.windowObject,
    service: renderSettingsService,
    aspectRatioSelector: displaySettingsUiState.aspectRatioSelector,
    resolutionSelector: displaySettingsUiState.resolutionSelector,
    getAspectRatioValue: () => rendererState.aspectRatio,
  });
  renderSettingsController.syncSelectors();
  rendererState.internalResolution = renderSettingsService.getResolutionOptions(
    rendererState.aspectRatio,
    rendererState.internalResolution,
  ).selectedResolution;
  syncViewportLayout({ aspectRatioId: rendererState.aspectRatio });

  /**
   * 表示カラースペースを適用します。
   * @param {string} value - Color space ID.
   * @returns {string} 適用後の color space。
   */
  function applyDisplayColorSpaceSetting(value) {
    const nextDisplayColorSpace = displaySettingsService.applyDisplayColorSpace(value);
    const appliedDisplayColorSpace = configureCanvasDisplayColorSpace(
      context,
      device,
      presentationFormat,
      nextDisplayColorSpace,
    );
    rendererState.displayColorSpace = appliedDisplayColorSpace;
    return appliedDisplayColorSpace;
  }

  /**
   * AA モードを適用します。
   * @param {string} newMode - AA mode.
   * @param {HTMLSelectElement|null} [aaSelector=null] - Selector reference.
   * @returns {Promise<void>} 完了 Promise。
   */
  async function applyAaMode(newMode, aaSelector = null) {
    const normalizedMode = typeof newMode === 'string' && newMode.trim()
      ? newMode
      : rendererState.currentAaMode;
    const newMsaaCount = normalizedMode.includes('msaa4') ? 4 : 1;
    if (newMsaaCount !== rendererState.msaaSampleCount) {
      rendererState.isUpdatingMsaaSampleCount = true;
      if (aaSelector) {
        aaSelector.disabled = true;
      }
      try {
        if (modelManager) {
          await modelManager.updateMsaaSampleCount(newMsaaCount);
        }
        rendererState.msaaSampleCount = newMsaaCount;
        rendererState.currentAaMode = normalizedMode;
        rendererState.needsResize = true;
      } finally {
        rendererState.isUpdatingMsaaSampleCount = false;
        if (aaSelector) {
          aaSelector.disabled = false;
        }
      }
      return;
    }
    rendererState.currentAaMode = normalizedMode;
    rendererState.needsResize = true;
  }

  displaySettingsController = installDisplaySettingsController({
    uiState: displaySettingsUiState,
    service: displaySettingsService,
    applyDisplayPreset,
    getRenderingFps: () => rendererState.renderingFPS,
    getDisplayPreset: () => rendererState.displayPreset,
    getViewTransform: () => rendererState.viewTransform,
    getDisplayColorSpace: () => rendererState.displayColorSpace,
    getAaMode: () => rendererState.currentAaMode,
    onViewTransformChanged: () => {
      syncPostEffectParametersFromState();
    },
    applyDisplayColorSpace: (value) => applyDisplayColorSpaceSetting(value),
    onDisplayColorSpaceChanged: () => {
      syncPostEffectParametersFromState();
    },
    onAaModeChanged: async (newMode, aaSelector) => applyAaMode(newMode, aaSelector),
  });
  displaySettingsController?.sync?.();

  camera = createCameraState(UNIT_SCALE);
  syncDepthFocusInputs(camera.center);
  if (hasConfiguredDefaultModel(MODEL_FILE)) {
    try {
      await modelLifecycleService.addModel({
        zipFiles: null,
        modelPath: MODEL_PATH,
        modelFile: MODEL_FILE,
      });
    } catch (error) {
      console.warn('Default model load failed, continuing without default model:', error);
    }
  }

  const updateSceneState = (step = 1) => {
    modelManager.update(
      physicsEngine,
      selection,
      step,
      camera,
      playbackRuntimeService.getAnimationUpdateState(step),
      boneInspectorState,
    );
  };

  boneEditingService = createBoneEditingService({
    modelManager,
    selection,
    inspectorState: boneInspectorState,
    physicsEngine,
    timelineOrchestrationService,
    resolveActiveBoneContext,
    getBoneEditTargets,
    filterBoneEditTargetsByMode,
    getSelectedBoneContext,
    getActiveInstance,
    getLocalPositionFromBoneInfoDisplayPosition,
    getLocalRotationFromBoneInfoDisplayRotation,
    constrainRotationToBoneLocks,
    setBoneInfoUiState,
    setWorldRotationDisplay,
    syncModelIkEntryAliases,
    refreshSceneIkState,
    updateRuntimeIkTargetRestPosition,
    rebuildModelIkLinks,
    createRuntimeIkSetup,
    removeRuntimeIkSetup,
    clearWorldRotationDisplay,
    setSingleBoneSelection,
    getSelectedBoneIndices,
    buildVpdPoseData,
    denormalizeVpdFromInternalUnits,
    vpdWriter,
    createVpdDownloadName,
    getSelectedTimelineEntries: () => timelineView?.selectedKeyframeEntries || [],
    getBoneIkRotationLocks,
    setBoneIkRotationLocks,
  });
  const boneInspectorService = createBoneInspectorService({
    modelManager,
    selection,
    inspectorState: boneInspectorState,
    boneService: boneEditingService,
    getBoneEditTargets,
    filterBoneEditTargetsByMode,
    getBoneRotationLocks,
    getBoneIkRotationLocks,
    childBonePickState,
    getKeyframeBackgroundColor,
  });
  cameraEditingService = createCameraEditingService({
    camera,
    cameraUiState,
    modelManager,
    timelineOrchestrationService,
    getActiveInstance,
    syncCameraModelOptions,
    syncCameraBoneOptions,
    getViewportCanvasAspect,
  });
  lightEditingService = createLightEditingService({
    rendererState,
    lightUiState,
    timelineOrchestrationService,
    getActiveInstance,
  });
  lightPanelController = installLightPanelController({
    uiState: lightUiState,
    lightService: lightEditingService,
    rendererState,
    timelineOrchestrationService,
    getActiveInstance,
    extractLightKeyframesFromAnimationClip,
    getLightKeyframeBackgroundColor,
    setInputBackgroundColor,
    bindLinkedNumericInputs,
    syncPostEffectParametersFromState,
    refreshScene: () => refreshScene(),
  });
  const debugUiStateBundle = bindDebugPanelUiState(documentRef);
  Object.assign(cameraDebugUiState, debugUiStateBundle.cameraDebugUiState);
  Object.assign(boneDebugUiState, debugUiStateBundle.boneDebugUiState);
  Object.assign(animationDebugUiState, debugUiStateBundle.animationDebugUiState);
  Object.assign(clickedMousePositionUiState, debugUiStateBundle.clickedMousePositionUiState);
  const debugReadModelService = createDebugReadModelService({
    camera,
    getActiveInstance,
    clickedMousePositionUiState,
  });
  const debugPanelController = installDebugPanelController({
    documentRef: document,
    readModelService: debugReadModelService,
    clickedMousePositionUiState,
    cameraDebugUiState,
    boneDebugUiState,
    animationDebugUiState,
  });
  const inspectorSyncCoordinator = createInspectorSyncCoordinator({
    camera,
    rendererState,
    cameraUiState,
    lightUiState,
    selection,
    modelManager,
    getLangData: () => langData,
    getActiveInstance,
    timelineOrchestrationService,
    cameraService: cameraEditingService,
    lightService: lightEditingService,
    extractCameraKeyframesFromAnimationClip,
    extractLightKeyframesFromAnimationClip,
    getKeyframeBackgroundColor,
    getLightKeyframeBackgroundColor,
    setInputBackgroundColor,
    findBoneIndexByName,
    getBone,
    clickedMousePositionUiState,
    cameraDebugUiState,
    syncLightPanelUi: (...args) => lightPanelController?.sync?.(...args),
    syncBoneInspectorUi: (...args) => panelSyncPort.syncBoneInspectorUi(...args),
    syncBoneDebugUi: (...args) => debugPanelController.syncBoneDebugUi(...args),
    syncAnimationDebugUi: (...args) => debugPanelController.syncAnimationDebugUi(...args),
    syncBloomShadowDebugUi,
    updateSelectedBoneLabel: (model, scene, currentSelection, currentLangData) => {
      selectionOverlayPort.syncSelectedBoneLabel(model, scene, currentSelection, currentLangData);
    },
    updateSelectedRigidbodyLabel: (model, currentSelection, currentLangData) => {
      selectionOverlayPort.syncSelectedRigidbodyLabel(model, currentSelection, currentLangData);
    },
    syncMorphSliders,
    activeMorphIndices,
    documentRef,
  });
  syncInspectorUi = (...args) => inspectorSyncCoordinator.syncInspectorUi(...args);
  syncCameraUiState = (...args) => inspectorSyncCoordinator.syncCameraUiState(...args);
  syncLightTabUi = (...args) => inspectorSyncCoordinator.syncLightTabUi(...args);
  syncCameraDebugUi = (...args) => debugPanelController.syncCameraDebugUi(...args);
  sceneSyncPort.syncInspectorUi = (...args) => syncInspectorUi(...args);
  sceneSyncPort.syncCameraUiState = (...args) => syncCameraUiState(...args);
  sceneSyncPort.syncLightTabUi = (...args) => syncLightTabUi(...args);
  sceneSyncPort.syncCameraDebugUi = (...args) => syncCameraDebugUi(...args);

  /**
   * DOM event を生成します。
   * @param {'input'|'change'} type - Event type.
   * @returns {Event|object} DOM event.
   */
  function createUiSettingsDomEvent(type) {
    return typeof Event === 'function'
      ? new Event(type, { bubbles: true, cancelable: true })
      : { type };
  }

  /**
   * 数値入力配列を読み取ります。
   * @param {Array<HTMLInputElement|null>} inputs - Input list.
   * @returns {number[]} Number array.
   */
  function readNumericInputArray(inputs) {
    return (Array.isArray(inputs) ? inputs : []).map((input) => {
      const parsed = Number.parseFloat(input?.value ?? '');
      return Number.isFinite(parsed) ? parsed : 0;
    });
  }

  /**
   * 数値 input を更新して input event を発火します。
   * @param {HTMLInputElement|null} input - Input element.
   * @param {number} value - Next value.
   */
  function applyNumericInputValue(input, value) {
    if (!input || !Number.isFinite(value)) {
      return;
    }
    input.value = String(value);
    input.dispatchEvent(createUiSettingsDomEvent('input'));
  }

  /**
   * checkbox を更新して change event を発火します。
   * @param {HTMLInputElement|null} input - Checkbox element.
   * @param {boolean} value - Next value.
   */
  function applyCheckboxValue(input, value) {
    if (!input) {
      return;
    }
    input.checked = Boolean(value);
    input.dispatchEvent(createUiSettingsDomEvent('change'));
  }

  /**
   * カメラ追従対象を名前から解決します。
   * @param {string} modelName - Model name.
   * @param {string} boneName - Bone name.
   */
  function applyCameraLookAtSelection(modelName, boneName) {
    const trimmedModelName = String(modelName || '').trim();
    const trimmedBoneName = String(boneName || '').trim();
    const nextModelIndex = trimmedModelName
      ? modelManager.instances.findIndex((instance) => instance?.model?.name === trimmedModelName)
      : -1;
    cameraUiState.selectedModelIndex = nextModelIndex;
    syncCameraModelOptions();
    const targetInstance = nextModelIndex >= 0 ? modelManager.instances[nextModelIndex] : null;
    syncCameraBoneOptions(targetInstance);
    if (!targetInstance || !trimmedBoneName) {
      cameraUiState.selectedBoneName = '';
      syncCameraBoneOptions(targetInstance);
      return;
    }

    const boneIndex = findBoneIndexByName(targetInstance.model, trimmedBoneName);
    if (boneIndex >= 0) {
      cameraEditingService?.registerLookAtTarget?.(nextModelIndex, boneIndex);
      return;
    }
    cameraUiState.selectedBoneName = '';
    syncCameraBoneOptions(targetInstance);
  }

  const uiSettingsPort = {
    readAnimationState() {
      const playbackRange = timelineOrchestrationService.getPlaybackRange?.() ?? { start: 0, end: null };
      return {
        playbackRange: {
          start: Number.isFinite(playbackRange.start) ? playbackRange.start : 0,
          end: Number.isFinite(playbackRange.end) ? playbackRange.end : null,
        },
      };
    },
    applyAnimationState(section = {}) {
      const range = section.playbackRange ?? {};
      timelineOrchestrationService.setPlaybackRange?.(range.start ?? 0, range.end ?? null);
    },
    readShortcutState() {
      return {
        ...selectionOverlayPort.getState(),
        boneThickness: Number.isFinite(rendererState.boneThickness) ? rendererState.boneThickness : 1,
        gridSize: Number.isFinite(rendererState.gridOverlay?.size) ? rendererState.gridOverlay.size : 0.5,
        gridCount: Number.isFinite(rendererState.gridOverlay?.count) ? rendererState.gridOverlay.count : 10,
        gridThickness: Number.isFinite(rendererState.gridOverlay?.thickness) ? rendererState.gridOverlay.thickness : 1,
      };
    },
    applyShortcutState(section = {}) {
      if ('showBones' in section) {
        applyCheckboxValue(selectionUiState.showBonesElement, section.showBones);
      }
      if ('showBoneAxes' in section) {
        applyCheckboxValue(selectionUiState.showBoneAxesElement, section.showBoneAxes);
      }
      if ('showPhysics' in section) {
        applyCheckboxValue(selectionUiState.showPhysicsElement, section.showPhysics);
      }
      if ('disablePhysics' in section) {
        applyCheckboxValue(selectionUiState.disablePhysicsElement, section.disablePhysics);
      }
      if ('hideIkBones' in section) {
        applyCheckboxValue(selectionUiState.hideIkBonesElement, section.hideIkBones);
      }
      if ('hideSpringBones' in section) {
        applyCheckboxValue(selectionUiState.hideSpringBonesElement, section.hideSpringBones);
      }
      if ('showGridXZ' in section) {
        applyCheckboxValue(selectionUiState.showGridXZElement, section.showGridXZ);
      }
      if ('showGridXY' in section) {
        applyCheckboxValue(selectionUiState.showGridXYElement, section.showGridXY);
      }
      if ('showGridYZ' in section) {
        applyCheckboxValue(selectionUiState.showGridYZElement, section.showGridYZ);
      }
      if (Number.isFinite(Number(section.boneThickness))) {
        applyNumericInputValue(boneThicknessInput, Number(section.boneThickness));
      }
      if (Number.isFinite(Number(section.gridSize))) {
        applyNumericInputValue(selectionUiState.gridSizeRangeElement, Number(section.gridSize));
      }
      if (Number.isFinite(Number(section.gridCount))) {
        applyNumericInputValue(selectionUiState.gridCountRangeElement, Number(section.gridCount));
      }
      if (Number.isFinite(Number(section.gridThickness))) {
        applyNumericInputValue(selectionUiState.gridThicknessRangeElement, Number(section.gridThickness));
      }
    },
    readVideoExportState() {
      return videoExportUiApi?.readValues?.() ?? {};
    },
    async applyVideoExportState(section = {}) {
      await videoExportUiApi?.applyValues?.(section);
    },
    readRenderState() {
      return {
        displayPreset: rendererState.displayPreset,
        renderingFps: rendererState.renderingFPS,
        viewTransform: rendererState.viewTransform,
        displayColorSpace: rendererState.displayColorSpace,
        aspectRatio: rendererState.aspectRatio,
        internalResolution: rendererState.internalResolution,
        aaMethod: rendererState.currentAaMode,
        environmentHdrIntensity: rendererState.environmentHdrIntensity,
        shadowBias: rendererState.shadowParams.shadowBias,
        shadowPower: rendererState.shadowParams.shadowPower,
        shadowStrength: rendererState.shadowParams.shadowStrength,
        shadowEdgeOpacity: rendererState.shadowParams.shadowEdgeOpacity,
        showCascadeShadowMaps: rendererState.showCascadeShadowMaps,
        showBloomShadowDebug: rendererState.showBloomShadowDebug,
        bloomShadowDebugMode: rendererState.bloomShadowDebugMode,
        shadowMapSize: rendererState.shadowMapSize,
        shadowFarAuto: rendererState.shadowFarAuto,
        shadowFar: rendererState.shadowFar,
        ambientOcclusionEnabled: rendererState.postEffects.ambientOcclusionEnabled,
        ambientOcclusionRadius: rendererState.postEffects.ambientOcclusionRadius,
        ambientOcclusionBias: rendererState.postEffects.ambientOcclusionBias,
        ambientOcclusionIntensity: rendererState.postEffects.ambientOcclusionIntensity,
        ambientOcclusionBlurAmount: rendererState.postEffects.ambientOcclusionBlurAmount,
        ambientOcclusionSampleCount: rendererState.postEffects.ambientOcclusionSampleCount,
        contactShadowEnabled: rendererState.postEffects.contactShadowEnabled,
        contactShadowLength: rendererState.postEffects.contactShadowLength,
        contactShadowThickness: rendererState.postEffects.contactShadowThickness,
        contactShadowIntensity: rendererState.postEffects.contactShadowIntensity,
        contactShadowBlurAmount: rendererState.postEffects.contactShadowBlurAmount,
        contactShadowStepCount: rendererState.postEffects.contactShadowStepCount,
      };
    },
    async applyRenderState(section = {}) {
      if (typeof section.displayPreset === 'string' && section.displayPreset.trim()) {
        await applyDisplayPreset(section.displayPreset, { persist: false });
      }
      if (Number.isFinite(Number(section.renderingFps))) {
        displaySettingsService.applyRenderingFps(Number(section.renderingFps));
      }
      if (typeof section.viewTransform === 'string' && section.viewTransform.trim()) {
        displaySettingsService.applyViewTransform(section.viewTransform);
      }
      if (typeof section.displayColorSpace === 'string' && section.displayColorSpace.trim()) {
        applyDisplayColorSpaceSetting(section.displayColorSpace);
      }
      if (typeof section.aspectRatio === 'string' && section.aspectRatio.trim()) {
        renderSettingsService.applyAspectRatio(section.aspectRatio);
      }
      if (typeof section.internalResolution === 'string' && section.internalResolution.trim()) {
        renderSettingsService.applyInternalResolution(section.internalResolution);
      }
      if (typeof section.aaMethod === 'string' && section.aaMethod.trim()) {
        await applyAaMode(section.aaMethod, displaySettingsUiState?.aaSelector ?? null);
      }
      if (Number.isFinite(Number(section.environmentHdrIntensity))) {
        setEnvironmentHdrIntensity(Number(section.environmentHdrIntensity));
      }
      if (Number.isFinite(Number(section.shadowBias))) {
        shadowPanelService.setShadowBias(Number(section.shadowBias));
      }
      if (Number.isFinite(Number(section.shadowPower))) {
        shadowPanelService.setShadowPower(Number(section.shadowPower));
      }
      if (Number.isFinite(Number(section.shadowStrength))) {
        shadowPanelService.setShadowStrength(Number(section.shadowStrength));
      }
      if (Number.isFinite(Number(section.shadowEdgeOpacity))) {
        shadowPanelService.setShadowEdgeOpacity(Number(section.shadowEdgeOpacity));
      }
      if ('showCascadeShadowMaps' in section) {
        shadowPanelService.setShowCascadeShadowMaps(section.showCascadeShadowMaps);
      }
      if ('showBloomShadowDebug' in section) {
        shadowPanelService.setShowBloomShadowDebug(section.showBloomShadowDebug);
      }
      if (Number.isFinite(Number(section.bloomShadowDebugMode))) {
        shadowPanelService.setBloomShadowDebugMode(Number(section.bloomShadowDebugMode));
      }
      if (Number.isFinite(Number(section.shadowMapSize))) {
        shadowPanelService.setShadowMapSize(Number(section.shadowMapSize));
      }
      if ('shadowFarAuto' in section) {
        shadowPanelService.setShadowFarAuto(section.shadowFarAuto);
      }
      if (Number.isFinite(Number(section.shadowFar))) {
        shadowPanelService.setShadowFar(Number(section.shadowFar));
      }
      if ('ambientOcclusionEnabled' in section) {
        shadowPanelService.setAmbientOcclusionEnabled(section.ambientOcclusionEnabled);
      }
      if (Number.isFinite(Number(section.ambientOcclusionRadius))) {
        shadowPanelService.setAmbientOcclusionRadius(Number(section.ambientOcclusionRadius));
      }
      if (Number.isFinite(Number(section.ambientOcclusionBias))) {
        shadowPanelService.setAmbientOcclusionBias(Number(section.ambientOcclusionBias));
      }
      if (Number.isFinite(Number(section.ambientOcclusionIntensity))) {
        shadowPanelService.setAmbientOcclusionIntensity(Number(section.ambientOcclusionIntensity));
      }
      if (Number.isFinite(Number(section.ambientOcclusionBlurAmount))) {
        shadowPanelService.setAmbientOcclusionBlurAmount(Number(section.ambientOcclusionBlurAmount));
      }
      if (Number.isFinite(Number(section.ambientOcclusionSampleCount))) {
        shadowPanelService.setAmbientOcclusionSampleCount(Number(section.ambientOcclusionSampleCount));
      }
      if ('contactShadowEnabled' in section) {
        shadowPanelService.setContactShadowEnabled(section.contactShadowEnabled);
      }
      if (Number.isFinite(Number(section.contactShadowLength))) {
        shadowPanelService.setContactShadowLength(Number(section.contactShadowLength));
      }
      if (Number.isFinite(Number(section.contactShadowThickness))) {
        shadowPanelService.setContactShadowThickness(Number(section.contactShadowThickness));
      }
      if (Number.isFinite(Number(section.contactShadowIntensity))) {
        shadowPanelService.setContactShadowIntensity(Number(section.contactShadowIntensity));
      }
      if (Number.isFinite(Number(section.contactShadowBlurAmount))) {
        shadowPanelService.setContactShadowBlurAmount(Number(section.contactShadowBlurAmount));
      }
      if (Number.isFinite(Number(section.contactShadowStepCount))) {
        shadowPanelService.setContactShadowStepCount(Number(section.contactShadowStepCount));
      }
      syncPostEffectParametersFromState();
      syncShadowParametersFromState();
      panelSyncPort.syncRenderPanels(true);
      syncMaterialTabUi?.();
      refreshScene?.();
    },
    readPostEffectState() {
      const postEffects = postEffectUiState.service?.getState?.() ?? rendererState.postEffects;
      return {
        bloomEnabled: Boolean(postEffects.bloomEnabled),
        dofEnabled: Boolean(postEffects.dofEnabled),
        colorTemperature: postEffects.colorTemperature,
        bloomThreshold: postEffects.bloomThreshold,
        gamma: postEffects.gamma,
        chromaticAberration: postEffects.chromaticAberration,
        filmGrainAmount: postEffects.filmGrainAmount,
        filmGrainAnimationMode: postEffects.filmGrainAnimationMode,
        bloomBlurAmount: postEffects.bloomBlurAmount,
        bloomAlpha: postEffects.bloomAlpha,
        bloomShadowMultiplier: postEffects.bloomShadowMultiplier,
        dofAlgorithm: postEffects.dofAlgorithm,
        dofFStop: postEffects.dofFStop,
        sssEnabled: Boolean(postEffects.sssEnabled),
        sssRadius: postEffects.sssRadius,
        sssDepthThreshold: postEffects.sssDepthThreshold,
        sssNormalThreshold: postEffects.sssNormalThreshold,
        sssStrength: postEffects.sssStrength,
      };
    },
    applyPostEffectState(section = {}) {
      const service = postEffectUiState.service;
      if (!service) {
        return;
      }
      if ('bloomEnabled' in section) {
        service.setBoolean('bloomEnabled', section.bloomEnabled);
      }
      if ('dofEnabled' in section) {
        service.setBoolean('dofEnabled', section.dofEnabled);
      }
      if (Number.isFinite(Number(section.colorTemperature))) {
        service.setNumber('colorTemperature', Number(section.colorTemperature), 1000.0, 40000.0);
      }
      if (Number.isFinite(Number(section.bloomThreshold))) {
        service.setNumber('bloomThreshold', Number(section.bloomThreshold), 0.0, service.getBloomThresholdMax?.() ?? 1);
      }
      if (Number.isFinite(Number(section.gamma))) {
        service.setNumber('gamma', Number(section.gamma), 0.1, 4.0);
      }
      if (Number.isFinite(Number(section.chromaticAberration))) {
        service.setNumber('chromaticAberration', Number(section.chromaticAberration), 0.0, 1.0);
      }
      if (Number.isFinite(Number(section.filmGrainAmount))) {
        service.setNumber('filmGrainAmount', Number(section.filmGrainAmount), 0.0, 1.0);
      }
      if (typeof section.filmGrainAnimationMode === 'string' && section.filmGrainAnimationMode.trim()) {
        service.setString('filmGrainAnimationMode', section.filmGrainAnimationMode, 'timeline');
      }
      if (Number.isFinite(Number(section.bloomBlurAmount))) {
        service.setNumber('bloomBlurAmount', Number(section.bloomBlurAmount), 0.0, 8.0);
      }
      if (Number.isFinite(Number(section.bloomAlpha))) {
        service.setNumber('bloomAlpha', Number(section.bloomAlpha), 0.0, 1.0);
      }
      if (Number.isFinite(Number(section.bloomShadowMultiplier))) {
        service.setNumber('bloomShadowMultiplier', Number(section.bloomShadowMultiplier), 0.0, 1.0);
      }
      if (typeof section.dofAlgorithm === 'string' && section.dofAlgorithm.trim()) {
        service.setString('dofAlgorithm', section.dofAlgorithm, 'fast');
      }
      if (Number.isFinite(Number(section.dofFStop))) {
        service.setNumber('dofFStop', Number(section.dofFStop), 0.1, 32.0);
      }
      if ('sssEnabled' in section) {
        service.setBoolean('sssEnabled', section.sssEnabled);
      }
      if (Number.isFinite(Number(section.sssRadius))) {
        service.setNumber('sssRadius', Number(section.sssRadius), 0.0, 8.0);
      }
      if (Number.isFinite(Number(section.sssDepthThreshold))) {
        service.setNumber('sssDepthThreshold', Number(section.sssDepthThreshold), 0.0, 0.1);
      }
      if (Number.isFinite(Number(section.sssNormalThreshold))) {
        service.setNumber('sssNormalThreshold', Number(section.sssNormalThreshold), 0.0, 1.0);
      }
      if (Number.isFinite(Number(section.sssStrength))) {
        service.setNumber('sssStrength', Number(section.sssStrength), 0.0, 1.0);
      }
      syncPostEffectParametersFromState();
      postEffectUiState.sync?.();
      refreshScene?.();
    },
    readCameraState() {
      const trackedInstance = cameraUiState.selectedModelIndex >= 0
        ? modelManager.instances[cameraUiState.selectedModelIndex]
        : null;
      const fov = Number.parseFloat(cameraUiState.fovValue?.value ?? cameraUiState.fovRange?.value ?? '');
      return {
        modelName: trackedInstance?.model?.name || '',
        boneName: cameraUiState.selectedBoneName || '',
        fov: Number.isFinite(fov) ? fov : 45,
        position: readNumericInputArray(cameraUiState.positionInputs),
        rotation: readNumericInputArray(cameraUiState.rotationInputs),
        target: readNumericInputArray(cameraUiState.targetInputs),
      };
    },
    applyCameraState(section = {}) {
      const hasPosition = Array.isArray(section.position);
      const hasRotation = Array.isArray(section.rotation);
      const hasTarget = Array.isArray(section.target);
      if (Number.isFinite(Number(section.fov))) {
        if (cameraUiState.fovRange) {
          cameraUiState.fovRange.value = String(section.fov);
        }
        if (cameraUiState.fovValue) {
          cameraUiState.fovValue.value = String(section.fov);
        }
        cameraEditingService?.applyFovDegrees?.(Number(section.fov));
      }
      if (hasPosition) {
        section.position.forEach((value, index) => applyNumericInputValue(cameraUiState.positionInputs[index], Number(value)));
      }
      if (hasRotation) {
        section.rotation.forEach((value, index) => applyNumericInputValue(cameraUiState.rotationInputs[index], Number(value)));
      }
      if (hasTarget) {
        section.target.forEach((value, index) => applyNumericInputValue(cameraUiState.targetInputs[index], Number(value)));
      }
      if (hasPosition || hasTarget) {
        cameraEditingService?.applyPoseFromInputs?.();
      } else if (hasRotation) {
        cameraEditingService?.applyRotationFromInputs?.();
      }
      if ('modelName' in section || 'boneName' in section) {
        applyCameraLookAtSelection(section.modelName, section.boneName);
      }
      refreshScene?.();
    },
    readLightState() {
      return {
        position: readNumericInputArray(lightUiState.positionInputs),
        rotation: readNumericInputArray(lightUiState.rotationInputs),
        gltfLightStrength: rendererState.postEffects.gltfLightStrength,
      };
    },
    applyLightState(section = {}) {
      if (Array.isArray(section.position)) {
        section.position.forEach((value, index) => applyNumericInputValue(lightUiState.positionInputs[index], Number(value)));
        lightEditingService?.applyPositionFromInputs?.();
      }
      if (Array.isArray(section.rotation)) {
        section.rotation.forEach((value, index) => applyNumericInputValue(lightUiState.rotationInputs[index], Number(value)));
        lightEditingService?.applyRotationFromInputs?.();
      }
      if (Number.isFinite(Number(section.gltfLightStrength))) {
        rendererState.postEffects.gltfLightStrength = Number(section.gltfLightStrength);
      }
      syncPostEffectParametersFromState();
      lightPanelController?.sync?.(true);
      refreshScene?.();
    },
  };

  const sceneRefreshCoordinator = createSceneRefreshCoordinator({
    camera,
    playbackRuntimeService,
    getBgmManager: () => bgmManager,
    getActiveInstance,
    cameraService: cameraEditingService,
    lightService: lightEditingService,
    updateSceneState,
    syncInspectorUi,
  });
  refreshScene = (...args) => sceneRefreshCoordinator.refreshScene(...args);
  syncTimelineUi = (...args) => sceneRefreshCoordinator.syncTimelineUi(...args);
  sceneSyncPort.refreshScene = (...args) => refreshScene(...args);
  sceneSyncPort.syncTimelineUi = (...args) => syncTimelineUi(...args);
  syncLightTabUi();
  const boneInspectorController = installBoneInspectorController({
    documentRef: document,
    uiState: boneInspectorUiState,
    inspectorState: boneInspectorState,
    inspectorService: boneInspectorService,
    boneService: boneEditingService,
    timelineView,
    interpolationPanel,
    bindLinkedNumericInputs,
    refreshScene,
    setChildBonePickMode,
    isChildBonePickModeEnabled: () => childBonePickState.enabled,
    clearWorldRotationDisplay,
    downloadBinary: (...args) => platformAdapter.downloadBinary(...args),
    getLangData: () => langData,
  });
  syncBoneInspectorUi = (...args) => boneInspectorController.sync(...args);
  panelSyncPort.syncBoneInspectorUi = (...args) => syncBoneInspectorUi(...args);

  installCameraEditingController({
    cameraUiState,
    refreshScene,
    bindLinkedNumericInputs,
    cameraService: cameraEditingService,
    camera,
    CAMERA_FOV_MIN,
    CAMERA_FOV_MAX,
    modelManager,
    findBoneIndexByName,
    getBone,
    syncCameraModelOptions,
    syncCameraBoneOptions,
  });
  const gizmoState = createGizmoState();

  const applicationPorts = {
    viewer: {
      document: documentRef,
      modelManager,
      physicsEngine,
      selection,
      selectionOverlayPort,
      vmdManager,
      rendererState,
      videoExportManager,
      bgmManager,
      shaderManager,
      playbackRuntimeService,
      enterAppFullscreen,
      exitAppFullscreen,
      refreshScene: (...args) => refreshScene(...args),
      getActiveInstance,
    },
    playback: {
      playbackRuntimeService,
      vmdManager,
      getActiveInstance,
      refreshScene,
    },
    export: {
      get videoExportManager() {
        return videoExportManager;
      },
      selectionOverlayPort,
      refreshScene,
    },
    uiSync: {
      refreshScene,
      syncRenderPanels: (...args) => panelSyncPort.syncRenderPanels(...args),
      syncBoneInspectorUi: (...args) => panelSyncPort.syncBoneInspectorUi(...args),
      syncMaterialTabUi: (...args) => syncMaterialTabUi(...args),
      syncTextureTabUi: (...args) => syncTextureTabUi(...args),
      syncAnimationMappingTabUi: (...args) => panelSyncPort.syncAnimationMappingTabUi(...args),
      syncInspectorUi: (...args) => syncInspectorUi(...args),
      syncTimelineUi: (...args) => syncTimelineUi(...args),
    },
    shell: {
      document: documentRef,
      platform: platformAdapter,
      prompt: (...args) => platformAdapter.prompt(...args),
      confirm: (...args) => platformAdapter.confirm(...args),
      enterAppFullscreen,
      exitAppFullscreen,
    },
  };

  let applicationCommands = null;
  const viewerStateService = createViewerStateService({
    ports: () => applicationPorts,
    commands: () => applicationCommands,
    document: () => documentRef,
    setTimeoutImpl: platformAdapter.windowObject?.setTimeout?.bind(platformAdapter.windowObject),
    nowImpl: () => platformAdapter.now(),
  });
  const boneParameterCommandService = createBoneParameterCommandService({
    modelManager,
    getActiveInstance,
  });

  const applicationCommandDeps = {
    assetLoadingService,
    modelLifecycleService,
    timelineOrchestrationService,
    viewerStateService,
    modelManager,
    physicsEngine,
    selection,
    getActiveInstance,
    vmdManager,
    bgmManager,
    videoExportManager,
    ports: applicationPorts,
    refreshScene,
    loadModelSettingsFile: async (file, extraOptions = {}) => loadModelSettingsFile(file, {
      ...extraOptions,
      modelManager,
      selection,
      getActiveInstance,
      shaderDefinitions: shaderManager?.getShaderDefinitions?.() || [],
      confirmModelMismatch: (message) => platformAdapter.confirm(message),
      onMaterialJsonApplied: () => {
        syncMaterialTabUi();
        refreshScene?.();
      },
    }),
    buildUiSettingsData: () => buildUiSettingsJsonData({ uiSettingsPort }),
    applyUiSettingsData: async (data) => applyUiSettingsJsonDataFromJson(data, { uiSettingsPort }),
    loadUiSettingsFile: async (file) => loadUiSettingsFileFromJson(file, { uiSettingsPort }),
    setEnvironmentHdrCandidateFiles: (...args) => importCandidateService?.setEnvironmentHdrCandidateFiles?.(...args),
    setModelCandidateFiles: (...args) => importCandidateService?.setModelCandidateFiles?.(...args),
    setBoneParams: (...args) => boneParameterCommandService.applyPayload(...args),
    updateVmdListUI: () => updateVmdListUI(getAnimationSourceListUiState(), langData),
    updateActiveMorphIndices,
    syncPlaybackRangeUi: (playbackRange) => syncPlaybackRangeUI(playbackRange),
    syncMaterialTabUi: (...args) => syncMaterialTabUi(...args),
    syncAnimationMappingTabUi: (...args) => panelSyncPort.syncAnimationMappingTabUi(...args),
    getModelListState: () => uiReadModelService.getModelListState(),
    getModelDeletionState: (index) => uiReadModelService.getModelDeletionState(index),
    getAnimationSourceListState: () => uiReadModelService.getAnimationSourceListState(),
    getAnimationDeletionState: (selectionInfo) => uiReadModelService.getAnimationDeletionState(selectionInfo),
    getActiveAnimationExportState: () => uiReadModelService.getActiveAnimationExportState(),
    loadEnvironmentHdrFile,
    setEnvironmentHdrPath,
    setEnvironmentHdrIntensity,
    resetPhysics: () => modelManager.rebuildPhysics?.(physicsEngine),
  };

  applicationCommands = createApplicationCommands(applicationCommandDeps);

  const applicationContext = createApplicationContext({
    ports: applicationPorts,
    commands: applicationCommands,
  });
  const applicationFacade = createApplicationFacade(applicationContext);
  bgmManager = setupBgmController({
    appFacade: applicationFacade,
    getLangData: () => langData,
    documentRef,
  });
  applicationPorts.viewer.bgmManager = bgmManager;

  const materialPanelService = createMaterialPanelService({
    getActiveInstance,
    getActiveInstanceIndex: () => selection.activeInstanceIndex,
    getInstances: () => modelManager?.instances || [],
    getLangData: () => langData,
    getDefaultsSnapshot,
    modelManager,
    shaderManager,
    onStateChanged: () => {
      syncMaterialTabUi();
    },
  });
  const texturePanelService = createTexturePanelService({
    getActiveInstance,
    getLangData: () => langData,
    modelManager,
    onStateChanged: () => {
      syncTextureTabUi();
    },
  });
  materialPanelController = installMaterialPanelController({
    documentRef: documentRef,
    windowRef: platformAdapter.windowObject,
    service: materialPanelService,
    getLangData: () => langData,
    triggerSceneRefresh: () => refreshScene(),
    loadModelSettingsFile: async (file) => applicationCommands.loadModelSettingsFile?.(file),
  });
  texturePanelController = installTexturePanelController({
    documentRef: documentRef,
    service: texturePanelService,
    getLangData: () => langData,
    triggerSceneRefresh: () => refreshScene(),
  });
  syncMaterialTabUi = (...args) => materialPanelController?.sync?.(...args);
  syncTextureTabUi = (...args) => texturePanelController?.sync?.(...args);
  panelSyncPort.syncMaterialTabUi = (...args) => syncMaterialTabUi(...args);
  panelSyncPort.syncTextureTabUi = (...args) => syncTextureTabUi(...args);

  if (timelineView) {
    timelineView.onFrameChanged = (frame) => {
      applicationFacade.playback.seek?.(frame);
    };
  }

  bindViewportInputHandlers({
    canvas,
    camera,
    selection,
    inspectorState: boneInspectorState,
    modelManager,
    physicsEngine,
    appFacade: applicationFacade,
    lightObject: rendererState.lightObject,
    refreshScene,
    activateInstance: applicationFacade.editing.activateInstance,
    gizmoState,
    depthPickState,
    colorTemperaturePickState,
    childBonePickState,
    queueDepthPick,
    queueColorTemperaturePick,
    registerCameraLookAtTarget,
    clearCameraLookAtTarget,
    onClickPositionChanged: (...args) => debugPanelController.onClickPositionChanged(...args),
    onChildBonePicked: (pickedInstance, pickedBoneIndex) => {
      applyChildBonePickResult(pickedInstance, pickedBoneIndex);
    },
    getBgmManager: () => bgmManager,
    documentRef,
    windowTarget: platformAdapter.windowObject,
    exitAppFullscreen,
  });

  const exportRuntimeService = createExportRuntimeService({
    canvas,
    canvasTargets,
    rendererState,
    selection,
    selectionOverlayPort,
    playbackRuntimeService,
    getActiveInstance,
    refreshScene,
    waitForGpuIdle: () => device.queue.onSubmittedWorkDone(),
  });

  videoExportManager = new VideoExportManager({
    canvas,
    canvasTargets,
    gpuContext: context,
    presentationFormat,
    device,
    rendererState,
    exportRuntimeService,
    physicsEngine,
    camera,
    getLangData: () => langData,
    getBgmManager: () => bgmManager,
    createExportCanvas: (width, height) => platformAdapter.createExportCanvas(width, height),
    canvasToBlob: (exportCanvas) => platformAdapter.canvasToBlob(exportCanvas),
  });
  applicationPorts.viewer.videoExportManager = videoExportManager;
  applicationCommandDeps.videoExportManager = videoExportManager;

  setupUIHandlers({
    appFacade: applicationFacade,
    getLangData: () => langData,
  });

  videoExportUiApi = setupVideoExportUI({
    videoExportManager,
    appFacade: applicationFacade,
    rendererState,
    getLangData: () => langData,
    bgmManager,
  });

  syncBoneInspectorUi(getActiveInstance(), langData);
  syncMaterialTabUi();

  startRenderLoop({
    canvas,
    gpuContext: context,
    canvasTargets,
    camera,
    device,
    globalResources,
    bloomResources,
    bloomColorDebugResources,
    bloomShadowDebugResources,
    bloomShadowDebugPipeline,
    dofResources,
    ssssResources,
    gammaResources,
    ambientOcclusionResources,
    contactShadowResources,
    postEffectGlobalBindGroup: postEffectGlobalResources.postEffectGlobalBindGroup,
    uiOverlayCompositeResources,
    modelManager,
    refreshScene,
    selection,
    inspectorState: boneInspectorState,
    depthPickState,
    colorTemperaturePickState,
    onDepthPickResolved: applyDepthPickResult,
    onColorTemperaturePickResolved: applyColorTemperaturePickResult,
    fxaaPipeline,
    fxaaBindGroup,
    fxaaSampler: postEffectSampler,
    state: rendererState,
  });
  return {
    appContext: applicationContext,
    appFacade: applicationFacade,
    runtime: applicationPorts.viewer,
    commands: applicationCommands,
    pendingImportService,
    registerAnimationMappingController(controller) {
      invokeSyncAnimationMappingTabUi = typeof controller?.sync === 'function'
        ? () => controller.sync()
        : () => {};
      panelSyncPort.syncAnimationMappingTabUi = () => invokeSyncAnimationMappingTabUi();
    },
  };
}
