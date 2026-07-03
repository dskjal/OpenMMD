import { createColorTemperatureScale, createFxaaBindGroup, estimateColorTemperatureFromLinearRgb, GLOBAL_UNIFORM_OFFSETS, updateContactShadowResources } from './renderer-gpu.js';
import {
  computeAutoClipPlanes,
  createCameraEye,
  createCameraRotation,
  createViewMatrix,
  createViewProjection,
} from '../../core/scene/camera.js';
import { perceptualRgbToLinearRgb } from '../../shared/color/color-utils.js';
import {
  createDofUniformData,
  DOF_WORLD_UNITS_PER_METER,
} from '../../shared/physics/dof-physics.js';
import { normalize, unionAabb } from '../../shared/math/math-utils.js';
import { getDefaultsSnapshot } from '../config/defaults/defaults-manager.js';
import { createShadowManager } from './shadow-manager.js';
import { drawLightOverlay, updateLightOverlayBuffer } from '../../ui/ui-overlay.js';
import {
  buildPostEffectPlan,
  POST_EFFECT_PASS_IDS,
  POST_EFFECT_TEXTURE_SLOTS,
} from './post-effect-planner.js';
import { resolveActiveInstance } from '../../core/selection/renderer-selection.js';

/**
 * 行列の回転成分で方向ベクトルを変換します。
 * @param {ArrayLike<number>} matrix - 4x4 行列。
 * @param {ArrayLike<number>} direction - 方向ベクトル。
 * @param {Array<number>} [out=[0, 0, 0]] - 出力先。
 * @returns {Array<number>} 変換後の方向。
 */
function transformDirection(matrix, direction, out = [0, 0, 0]) {
  out[0] = matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2];
  out[1] = matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2];
  out[2] = matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2];
  return out;
}

/**
 * 表示中の床グリッドを含めた AABB を返します。
 * @param {{min: number[], max: number[]}|null} sceneBounds - モデル由来の scene bounds。
 * @param {object} selection - 現在の選択状態。
 * @returns {{min: number[], max: number[]}|null} grid を含めた bounds。
 */
function createSceneBoundsWithGrid(sceneBounds, selection) {
  const showXZ = selection?.showGridXZ !== false;
  const showXY = Boolean(selection?.showGridXY);
  const showYZ = Boolean(selection?.showGridYZ);
  if (!showXZ && !showXY && !showYZ) {
    return sceneBounds;
  }

  const defaults = getDefaultsSnapshot('gridOverlay');
  const defaultGridSize = Number.isFinite(defaults.size) ? defaults.size : 0.5;
  const defaultGridCount = Number.isFinite(defaults.count) ? defaults.count : 10;
  const safeGridSize = Number.isFinite(selection?.gridSize) ? Math.max(0.1, selection.gridSize) : defaultGridSize;
  const safeGridCount = Number.isFinite(selection?.gridCount) ? Math.max(1, Math.round(selection.gridCount)) : defaultGridCount;
  const gridReach = safeGridSize * safeGridCount;
  const gridBounds = {
    min: [-gridReach, -gridReach, -gridReach],
    max: [gridReach, gridReach, gridReach],
  };
  return unionAabb(sceneBounds, gridBounds);
}

/**
 * 動画書き出し中に light UI overlay を描画するかどうかを返します。
 * @param {object} state - Renderer state.
 * @returns {boolean} 描画可否。
 */
export function shouldDrawLightOverlay(state) {
  return state?.isVideoExporting !== true;
}

/**
 * レンダーループを開始します。
 * @param {object} context - レンダリングコンテキスト。
 */
export function startRenderLoop(context) {
  const {
    canvas,
    gpuContext,
    bloomColorDebugResources,
    bloomShadowDebugResources,
    bloomShadowDebugPipeline,
    canvasTargets,
    camera,
    device,
  globalResources,
  bloomResources,
  dofResources,
  ssssResources,
  gammaResources,
  chromaticAberrationResources,
  ambientOcclusionResources,
  contactShadowResources,
    postEffectGlobalBindGroup,
    uiOverlayCompositeResources,
    modelManager,
    refreshScene,
    selection,
    inspectorState = null,
    depthPickState,
    colorTemperaturePickState,
    onDepthPickResolved,
    onColorTemperaturePickResolved,
    fxaaPipeline,
    fxaaSampler,
    state,
  } = context;
  let { fxaaBindGroup } = context;
  let lastCameraDebugSignature = '';
  let shadowManager = null;
  let shadowManagerKey = '';
  let chromaticAberrationEnabled = false;

  /**
   * gamma 系の uniform を現在のフレーム状態へ同期します。
   * @param {number} filmGrainSeed - film grain の seed。
   */
  function syncGammaUniforms(filmGrainSeed) {
    const colorTemperatureScale = createColorTemperatureScale(state.postEffects?.colorTemperature ?? 6500);
    gammaResources.gammaSettingsData[0] = state.postEffects?.gamma ?? 1.0;
    gammaResources.gammaSettingsData[1] = chromaticAberrationEnabled ? (state.postEffects?.chromaticAberration ?? 0.0) : 0.0;
    gammaResources.gammaSettingsData[2] = colorTemperatureScale[0];
    gammaResources.gammaSettingsData[3] = colorTemperatureScale[1];
    gammaResources.gammaSettingsData[4] = colorTemperatureScale[2];
    gammaResources.gammaSettingsData[5] = Math.max(0.0, state.postEffects?.filmGrainAmount ?? 0.0);
    gammaResources.gammaSettingsData[6] = filmGrainSeed;
    gammaResources.gammaSettingsData[7] = state.postEffects?.filmGrainAnimationMode === 'always' ? 1.0 : 0.0;
    device.queue.writeBuffer(gammaResources.gammaSettingsBuffer, 0, gammaResources.gammaSettingsData);
    return colorTemperatureScale;
  }

  /**
   * 現在の設定に対応する shadow manager を返します。
   * @returns {object} shadow manager。
   */
  function getShadowManager() {
    const nextKey = [
      globalResources.shadowCascadeCount,
      state.shadowFarAuto ? 'auto' : 'manual',
      state.shadowFar,
      globalResources.shadowMapSize,
    ].join(':');
    if (shadowManager && shadowManagerKey === nextKey) {
      return shadowManager;
    }
    shadowManager = createShadowManager({
      cascadeCount: globalResources.shadowCascadeCount,
      cameraNear: 0.1,
      cameraFar: state.shadowFar,
      autoFar: state.shadowFarAuto,
      lambda: 0.75,
      shadowMapSize: globalResources.shadowMapSize,
      padding: 0.5,
    });
    shadowManagerKey = nextKey;
    return shadowManager;
  }

  /**
   * 未処理の深度ピック要求を処理します。
   */
  function processDepthPickRequest() {
    if (!depthPickState || depthPickState.busy || !depthPickState.request) {
      return;
    }

    const request = depthPickState.request;
    depthPickState.request = null;
    depthPickState.busy = true;
    void resolveDepthPickRequest(request)
      .finally(() => {
        depthPickState.busy = false;
      });
  }

  /**
   * 未処理の色温度ピック要求を処理します。
   */
  function processColorTemperaturePickRequest() {
    if (!colorTemperaturePickState || colorTemperaturePickState.busy || !colorTemperaturePickState.request) {
      return;
    }

    const request = colorTemperaturePickState.request;
    colorTemperaturePickState.request = null;
    colorTemperaturePickState.busy = true;
    void resolveColorTemperaturePickRequest(request)
      .finally(() => {
        colorTemperaturePickState.busy = false;
      });
  }

  /**
   * capture texture の小領域を平均して色温度を推定します。
   * @param {{clientX: number, clientY: number}} request - ピック要求。
   * @returns {Promise<void>} 処理完了 Promise。
   */
  async function resolveColorTemperaturePickRequest(request) {
    const rect = canvas.getBoundingClientRect();
    const relativeX = request.clientX - rect.left;
    const relativeY = request.clientY - rect.top;
    if (relativeX < 0 || relativeY < 0 || relativeX >= rect.width || relativeY >= rect.height) {
      if (typeof onColorTemperaturePickResolved === 'function') {
        onColorTemperaturePickResolved(null, request);
      }
      return;
    }

    const captureTexture = typeof canvasTargets.getCaptureTexture === 'function'
      ? canvasTargets.getCaptureTexture()
      : null;
    if (!captureTexture) {
      if (typeof onColorTemperaturePickResolved === 'function') {
        onColorTemperaturePickResolved(null, request);
      }
      return;
    }

    const captureTextureFormat = typeof canvasTargets.getCaptureTextureFormat === 'function'
      ? String(canvasTargets.getCaptureTextureFormat() || '').toLowerCase()
      : '';
    const pickX = Math.min(canvas.width - 1, Math.max(0, Math.floor(relativeX / rect.width * canvas.width)));
    const pickY = Math.min(canvas.height - 1, Math.max(0, Math.floor(relativeY / rect.height * canvas.height)));
    const sampleRadius = 2;
    const originX = Math.max(0, pickX - sampleRadius);
    const originY = Math.max(0, pickY - sampleRadius);
    const sampleWidth = Math.min(canvas.width - originX, sampleRadius * 2 + 1);
    const sampleHeight = Math.min(canvas.height - originY, sampleRadius * 2 + 1);
    if (sampleWidth <= 0 || sampleHeight <= 0) {
      if (typeof onColorTemperaturePickResolved === 'function') {
        onColorTemperaturePickResolved(null, request);
      }
      return;
    }

    const bytesPerRow = 256;
    const sampleBuffer = device.createBuffer({
      size: bytesPerRow * sampleHeight,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      {
        texture: captureTexture,
        origin: { x: originX, y: originY, z: 0 },
      },
      {
        buffer: sampleBuffer,
        bytesPerRow,
        rowsPerImage: sampleHeight,
      },
      {
        width: sampleWidth,
        height: sampleHeight,
        depthOrArrayLayers: 1,
      },
    );
    device.queue.submit([encoder.finish()]);

    let isMapped = false;
    try {
      await sampleBuffer.mapAsync(GPUMapMode.READ);
      isMapped = true;
      const bytes = new Uint8Array(sampleBuffer.getMappedRange());
      const isBgra = captureTextureFormat.startsWith('bgra');
      let redSum = 0.0;
      let greenSum = 0.0;
      let blueSum = 0.0;
      let sampleCount = 0;

      for (let y = 0; y < sampleHeight; y++) {
        const rowOffset = y * bytesPerRow;
        for (let x = 0; x < sampleWidth; x++) {
          const offset = rowOffset + x * 4;
          const red = isBgra ? bytes[offset + 2] : bytes[offset + 0];
          const green = bytes[offset + 1];
          const blue = isBgra ? bytes[offset + 0] : bytes[offset + 2];
          const linearRgb = perceptualRgbToLinearRgb([red / 255.0, green / 255.0, blue / 255.0]);
          redSum += linearRgb[0];
          greenSum += linearRgb[1];
          blueSum += linearRgb[2];
          sampleCount += 1;
        }
      }

      if (sampleCount <= 0) {
        if (typeof onColorTemperaturePickResolved === 'function') {
          onColorTemperaturePickResolved(null, request);
        }
        return;
      }

      const averagedLinearRgb = [
        redSum / sampleCount,
        greenSum / sampleCount,
        blueSum / sampleCount,
      ];
      const pickedTemperature = estimateColorTemperatureFromLinearRgb(averagedLinearRgb);
      if (typeof onColorTemperaturePickResolved === 'function') {
        onColorTemperaturePickResolved(pickedTemperature, request);
      }
    } finally {
      if (isMapped) {
        sampleBuffer.unmap();
      }
      sampleBuffer.destroy();
    }
  }

  /**
   * カメラ姿勢を変化時だけ console に出力します。
   * @param {object} cameraState - カメラ状態。
   * @param {ArrayLike<number>} cameraEye - カメラ位置。
   */
  function logCameraDebugIfChanged(cameraState, cameraEye) {
    const rotation = createCameraRotation(cameraState);
    const forward = normalize([
      cameraState.center[0] - cameraEye[0],
      cameraState.center[1] - cameraEye[1],
      cameraState.center[2] - cameraEye[2],
    ]);
    const signature = [
      cameraEye[0].toFixed(4),
      cameraEye[1].toFixed(4),
      cameraEye[2].toFixed(4),
      cameraState.center[0].toFixed(4),
      cameraState.center[1].toFixed(4),
      cameraState.center[2].toFixed(4),
      cameraState.distance.toFixed(4),
      cameraState.phi.toFixed(4),
      cameraState.theta.toFixed(4),
    ].join(':');
    if (signature === lastCameraDebugSignature) {
      return;
    }
    lastCameraDebugSignature = signature;
    /* DEBUG CAMERA
    console.log('[debug] camera pose', {
      eye: Array.from(cameraEye),
      center: [...cameraState.center],
      forward,
      rotation,
      distance: cameraState.distance,
      phi: cameraState.phi,
      theta: cameraState.theta,
    });
    */
  }

  /**
   * 深度ピック要求を GPU で解決します。
   * @param {{clientX: number, clientY: number}} request - ピック要求。
   * @returns {Promise<void>} 処理完了 Promise。
   */
  async function resolveDepthPickRequest(request) {
    const rect = canvas.getBoundingClientRect();
    const relativeX = request.clientX - rect.left;
    const relativeY = request.clientY - rect.top;
    if (relativeX < 0 || relativeY < 0 || relativeX >= rect.width || relativeY >= rect.height) {
      return;
    }

    const pickX = Math.min(canvas.width - 1, Math.max(0, Math.floor(relativeX / rect.width * canvas.width)));
    const pickY = Math.min(canvas.height - 1, Math.max(0, Math.floor(relativeY / rect.height * canvas.height)));

    let encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: canvasTargets.getPickWorldView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: canvasTargets.getPickDepthView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setScissorRect(pickX, pickY, 1, 1);
    modelManager.drawDepthPick(pass);
    pass.end();

    const worldBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      {
        texture: canvasTargets.getPickWorldTexture(),
        origin: { x: pickX, y: pickY, z: 0 },
      },
      {
        buffer: worldBuffer,
        bytesPerRow: 256,
        rowsPerImage: 1,
      },
      {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
    );
    device.queue.submit([encoder.finish()]);

    let isMapped = false;
    try {
      await worldBuffer.mapAsync(GPUMapMode.READ);
      isMapped = true;
      const picked = new Float32Array(worldBuffer.getMappedRange(), 0, 4);
      if (!Number.isFinite(picked[3]) || picked[3] <= 0.0) {
        return;
      }
      const pickedPosition = [
        picked[0],
        picked[1],
        picked[2],
      ];
      if (typeof onDepthPickResolved === 'function') {
        onDepthPickResolved(pickedPosition, request);
      }
    } finally {
      if (isMapped) {
        worldBuffer.unmap();
      }
      worldBuffer.destroy();
    }
  }

  let lastFrameTime = 0;
  let filmGrainFrameIndex = 0;
  const draw = (now) => {
    if (state.isUpdatingMsaaSampleCount) {
      requestAnimationFrame(draw);
      return;
    }

    if (state.renderingFPS > 0) {
      const elapsed = now - lastFrameTime;
      const interval = 1000 / state.renderingFPS;
      if (elapsed < interval) {
        requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = now - (elapsed % interval);
    }

    if (state.needsResize) {
      canvasTargets.resize(state.msaaSampleCount, state.internalResolution);
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
      fxaaBindGroup = createFxaaBindGroup(device, fxaaPipeline, canvasTargets, fxaaSampler, gammaResources.gammaSettingsBuffer);
      state.needsResize = false;
    }

    if (!state.isVideoExporting) {
      refreshScene();
    }

    const sceneBounds = modelManager.getCombinedAabb();
    const visibleSceneBounds = createSceneBoundsWithGrid(sceneBounds, selection);
    const clipPlanes = computeAutoClipPlanes(camera, visibleSceneBounds);
    camera.clipPlanes = clipPlanes;

    const viewProjection = createViewProjection(canvas, camera, clipPlanes);
    const view = createViewMatrix(camera);
    const cameraEye = createCameraEye(camera);
    logCameraDebugIfChanged(camera, cameraEye);
    const focusPoint = state.postEffects?.dofFocusPoint ?? camera.center;
    const dofFocusDistance = Math.max(
      0.0001,
      Math.hypot(
        cameraEye[0] - (focusPoint[0] ?? camera.center[0]),
        cameraEye[1] - (focusPoint[1] ?? camera.center[1]),
        cameraEye[2] - (focusPoint[2] ?? camera.center[2]),
      ),
    );
    const lightDir = normalize(state.lightObject?.direction ?? [-0.5, -1.0, -0.5]);
    const contactShadowViewDir = normalize(transformDirection(view, lightDir));
    const shadowState = getShadowManager().update({
      camera,
      sceneBounds,
      lightDirection: lightDir,
      aspect: canvas.width / canvas.height,
      clipPlanes,
    });
    const activeInstance = resolveActiveInstance(modelManager, selection);
    if (state.postEffects?.filmGrainAnimationMode === 'always') {
      // Keep the seed in a small normalized range so the hash input does not
      // lose precision and collapse into moiré at large timestamps.
      filmGrainFrameIndex = (filmGrainFrameIndex + 1) % 65536;
    }
    const filmGrainSeed = state.postEffects?.filmGrainAnimationMode === 'always'
      ? (filmGrainFrameIndex / 65536.0)
      : (activeInstance?.animationController?.currentFrame ?? 0.0);
    const syncedColorTemperatureScale = syncGammaUniforms(filmGrainSeed);

    globalResources.uniformData.set(viewProjection, GLOBAL_UNIFORM_OFFSETS.mvp);
    globalResources.uniformData.set(view, GLOBAL_UNIFORM_OFFSETS.view);
    globalResources.uniformData.set([cameraEye[0], cameraEye[1], cameraEye[2], 0.0], GLOBAL_UNIFORM_OFFSETS.cameraWorldPosition);
    globalResources.uniformData.set([...lightDir, 0.0], GLOBAL_UNIFORM_OFFSETS.lightingParams);
    globalResources.uniformData.set(state.lightColor ?? [1.0, 1.0, 1.0, 1.0], GLOBAL_UNIFORM_OFFSETS.lightColor);
    globalResources.uniformData.set([
      shadowState.getCascadeCount(),
      globalResources.shadowMapSize,
      state.boneThickness ?? 1.0,
      state.gridOverlay?.thickness ?? 1.0,
    ], GLOBAL_UNIFORM_OFFSETS.shadowInfo);
    globalResources.uniformData.set([canvas.width, canvas.height, 0.0, 0.0], GLOBAL_UNIFORM_OFFSETS.resolution);
    globalResources.uniformData.set(Array.from(shadowState.getCascadeSplits()), GLOBAL_UNIFORM_OFFSETS.shadowSplits);
    shadowState.getCascadeMatrices().forEach((matrix, index) => {
      globalResources.uniformData.set(matrix, GLOBAL_UNIFORM_OFFSETS.shadowMatrices + index * 16);
    });
    globalResources.uniformData.set([0, 0, 0, 1], GLOBAL_UNIFORM_OFFSETS.edgeColor);
    device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);

    globalResources.edgeUniformData.set(viewProjection, GLOBAL_UNIFORM_OFFSETS.mvp);
    globalResources.edgeUniformData.set(view, GLOBAL_UNIFORM_OFFSETS.view);
    globalResources.edgeUniformData.set([cameraEye[0], cameraEye[1], cameraEye[2], 0.0], GLOBAL_UNIFORM_OFFSETS.cameraWorldPosition);
    globalResources.edgeUniformData.set([...lightDir, 1.0], GLOBAL_UNIFORM_OFFSETS.lightingParams);
    globalResources.edgeUniformData.set(state.lightColor ?? [1.0, 1.0, 1.0, 1.0], GLOBAL_UNIFORM_OFFSETS.lightColor);
    globalResources.edgeUniformData.set([
      shadowState.getCascadeCount(),
      globalResources.shadowMapSize,
      state.boneThickness ?? 1.0,
      state.gridOverlay?.thickness ?? 1.0,
    ], GLOBAL_UNIFORM_OFFSETS.shadowInfo);
    globalResources.edgeUniformData.set([canvas.width, canvas.height, 0.0, 0.0], GLOBAL_UNIFORM_OFFSETS.resolution);
    globalResources.edgeUniformData.set(Array.from(shadowState.getCascadeSplits()), GLOBAL_UNIFORM_OFFSETS.shadowSplits);
    shadowState.getCascadeMatrices().forEach((matrix, index) => {
      globalResources.edgeUniformData.set(matrix, GLOBAL_UNIFORM_OFFSETS.shadowMatrices + index * 16);
    });
    globalResources.edgeUniformData.set([0, 0, 0, 1], GLOBAL_UNIFORM_OFFSETS.edgeColor);
    device.queue.writeBuffer(globalResources.edgeUniformBuffer, 0, globalResources.edgeUniformData);
    createDofUniformData({
      focusDistanceWorld: dofFocusDistance,
      sceneScale: DOF_WORLD_UNITS_PER_METER,
      fovY: camera.fovY,
      canvasHeight: canvas.height,
      dofAlgorithm: state.postEffects?.dofAlgorithm,
      blurAmount: state.postEffects?.dofBlurAmount ?? 2.0,
      nearPlane: clipPlanes.near,
      farPlane: clipPlanes.far,
      fStop: state.postEffects?.dofFStop ?? 2.8,
    }, dofResources.dofSettingsData);
    dofResources.dofSettingsData[12] = 1.0 / Math.max(1, canvas.width);
    dofResources.dofSettingsData[13] = 1.0 / Math.max(1, canvas.height);
    device.queue.writeBuffer(dofResources.dofSettingsBuffer, 0, dofResources.dofSettingsData);
    contactShadowResources.contactShadowSettingsData[0] = state.postEffects?.contactShadowLength ?? 0.08;
    contactShadowResources.contactShadowSettingsData[1] = state.postEffects?.contactShadowThickness ?? 0.01;
    contactShadowResources.contactShadowSettingsData[2] = state.postEffects?.contactShadowIntensity ?? 0.55;
    contactShadowResources.contactShadowSettingsData[3] = Math.max(1, Math.round(state.postEffects?.contactShadowStepCount ?? 8));
    contactShadowResources.contactShadowSettingsData[4] = clipPlanes.near;
    contactShadowResources.contactShadowSettingsData[5] = clipPlanes.far;
    contactShadowResources.contactShadowSettingsData[6] = Math.tan(camera.fovY * 0.5);
    contactShadowResources.contactShadowSettingsData[7] = canvas.width / canvas.height;
    contactShadowResources.contactShadowSettingsData[8] = contactShadowViewDir[0];
    contactShadowResources.contactShadowSettingsData[9] = contactShadowViewDir[1];
    contactShadowResources.contactShadowSettingsData[10] = contactShadowViewDir[2];
    contactShadowResources.contactShadowSettingsData[11] = state.postEffects?.contactShadowBlurAmount ?? 1.0;
    device.queue.writeBuffer(
      contactShadowResources.contactShadowSettingsBuffer,
      0,
      contactShadowResources.contactShadowSettingsData,
    );
    ambientOcclusionResources.ambientOcclusionSettingsData[0] = state.postEffects?.ambientOcclusionRadius ?? 0.4;
    ambientOcclusionResources.ambientOcclusionSettingsData[1] = state.postEffects?.ambientOcclusionBias ?? 0.02;
    ambientOcclusionResources.ambientOcclusionSettingsData[2] = state.postEffects?.ambientOcclusionIntensity ?? 1.0;
    ambientOcclusionResources.ambientOcclusionSettingsData[3] = Math.max(1, Math.round(state.postEffects?.ambientOcclusionSampleCount ?? 12));
    ambientOcclusionResources.ambientOcclusionSettingsData[4] = state.postEffects?.ambientOcclusionBlurAmount ?? 1.0;
    ambientOcclusionResources.ambientOcclusionSettingsData[5] = clipPlanes.near;
    ambientOcclusionResources.ambientOcclusionSettingsData[6] = clipPlanes.far;
    ambientOcclusionResources.ambientOcclusionSettingsData[7] = Math.tan(camera.fovY * 0.5);
    ambientOcclusionResources.ambientOcclusionSettingsData[8] = canvas.width / canvas.height;
    device.queue.writeBuffer(
      ambientOcclusionResources.ambientOcclusionSettingsBuffer,
      0,
      ambientOcclusionResources.ambientOcclusionSettingsData,
    );

    processDepthPickRequest();
    processColorTemperaturePickRequest();

    for (let cascadeIndex = 0; cascadeIndex < shadowState.getCascadeCount(); cascadeIndex++) {
      globalResources.uniformData[GLOBAL_UNIFORM_OFFSETS.shadowInfo + 3] = cascadeIndex;
      device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);
      const shadowEncoder = device.createCommandEncoder();
      const shadowPass = shadowEncoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: globalResources.shadowLayerViews[cascadeIndex],
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      modelManager.drawShadow(shadowPass);
      shadowPass.end();
      device.queue.submit([shadowEncoder.finish()]);
    }

    const postEffectPlan = buildPostEffectPlan(state);
    const useFxaa = postEffectPlan.useFxaa;
    const useBloom = postEffectPlan.useBloom;
    const useChromaticAberration = postEffectPlan.useChromaticAberration;
    const useSsss = postEffectPlan.useSsss;
    chromaticAberrationEnabled = useChromaticAberration;
    const backgroundAlpha = state.transparentVideoExportBackground ? 0.0 : 1.0;
    const gammaValue = state.postEffects?.gamma ?? 1.0;
    const useMsaa = state.msaaSampleCount > 1 && !useFxaa;
    const targetSampleCount = (useMsaa || postEffectPlan.needsSceneResolve) ? state.msaaSampleCount : 1;
    const currentTexture = gpuContext.getCurrentTexture();
    const captureTexture = typeof canvasTargets.getCaptureTexture === 'function'
      ? canvasTargets.getCaptureTexture()
      : null;
    const currentTextureView = (captureTexture ?? currentTexture).createView();
    const sceneInputView = canvasTargets.getPostProcessInputView();
    const postEffectOutputViews = [
      canvasTargets.getPostEffectPingView(),
      canvasTargets.getPostEffectPongView(),
    ];
    const sssMaskRenderView = canvasTargets.getSsssMaskRenderView();
    const sssMaskView = canvasTargets.getSsssMaskView();
    const needsResolvedSceneMask = useSsss || useBloom || Boolean(state.showBloomShadowDebug);
    let currentColorView = sceneInputView;
    /**
     * 現在の入力とは別のポストエフェクト出力先を選びます。
     * @returns {GPUTextureView} 出力先ビュー。
     */
    const getNextPostEffectOutputView = () => (
      postEffectOutputViews.find((view) => view !== currentColorView) ?? postEffectOutputViews[0]
    );
    const showGridXZ = selection.showGridXZ !== false;
    const showGridXY = Boolean(selection.showGridXY);
    const showGridYZ = Boolean(selection.showGridYZ);
    const needsGridDepth = showGridXZ || showGridXY || showGridYZ;
    // Bloom の影乗算は scene mask の再解決に使う depth を必要とするため、
    // Bloom 系が有効なときも depth を保持する。
    const depthStoreOp = (postEffectPlan.needsDepthSampling || needsGridDepth || needsResolvedSceneMask)
      ? 'store'
      : 'discard';
    const colorAttachment = {
      view: targetSampleCount > 1 ? canvasTargets.getRenderView() : sceneInputView,
      clearValue: { r: 0.9, g: 0.9, b: 0.9, a: backgroundAlpha },
      loadOp: 'clear',
      storeOp: 'store',
    };
    const normalAttachment = {
      view: canvasTargets.getSceneNormalRenderView(),
      clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1.0 },
      loadOp: 'clear',
      storeOp: 'store',
    };
    if (targetSampleCount > 1) {
      colorAttachment.resolveTarget = sceneInputView;
      normalAttachment.resolveTarget = canvasTargets.getSceneNormalView();
    }

    const prepassEncoder = device.createCommandEncoder();
    const depthPrepass = prepassEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetSampleCount > 1 ? canvasTargets.getPrepassNormalRenderView() : canvasTargets.getPrepassNormalView(),
          clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
          ...(targetSampleCount > 1 ? { resolveTarget: canvasTargets.getPrepassNormalView() } : {}),
        },
        {
          view: targetSampleCount > 1 ? canvasTargets.getPrepassDepthRenderView() : canvasTargets.getPrepassDepthView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
          ...(targetSampleCount > 1 ? { resolveTarget: canvasTargets.getPrepassDepthView() } : {}),
        },
      ],
      depthStencilAttachment: {
        view: canvasTargets.getDepthView(targetSampleCount),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    modelManager.drawDepthPrepass(depthPrepass, targetSampleCount > 1);
    depthPrepass.end();
    device.queue.submit([prepassEncoder.finish()]);

    const contactShadowEncoder = device.createCommandEncoder();
    const ambientOcclusionMaskPass = contactShadowEncoder.beginRenderPass({
      colorAttachments: [{
        view: canvasTargets.getAmbientOcclusionMaskView(),
        clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 0.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (postEffectPlan.useAmbientOcclusion) {
      const ambientOcclusionMaskBindGroup = ambientOcclusionResources.createAmbientOcclusionMaskBindGroup(
        device,
        canvasTargets.getPrepassDepthView(),
        canvasTargets.getPrepassNormalView(),
        targetSampleCount > 1,
      );
      ambientOcclusionMaskPass.setPipeline(
        targetSampleCount > 1
          ? ambientOcclusionResources.ambientOcclusionMaskMsaaPipeline
          : ambientOcclusionResources.ambientOcclusionMaskPipeline,
      );
      ambientOcclusionMaskPass.setBindGroup(3, postEffectGlobalBindGroup);
      ambientOcclusionMaskPass.setBindGroup(0, ambientOcclusionMaskBindGroup);
      ambientOcclusionMaskPass.draw(3, 1, 0, 0);
    }
    ambientOcclusionMaskPass.end();
    const contactShadowMaskPass = contactShadowEncoder.beginRenderPass({
      colorAttachments: [{
        view: canvasTargets.getContactShadowMaskView(),
        clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 0.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (postEffectPlan.useContactShadow) {
      const contactShadowMaskBindGroup = contactShadowResources.createContactShadowMaskBindGroup(
        device,
        canvasTargets.getPrepassDepthView(),
        canvasTargets.getPrepassNormalView(),
        targetSampleCount > 1,
      );
      contactShadowMaskPass.setPipeline(
        targetSampleCount > 1
          ? contactShadowResources.contactShadowMaskMsaaPipeline
          : contactShadowResources.contactShadowMaskPipeline,
      );
      contactShadowMaskPass.setBindGroup(3, postEffectGlobalBindGroup);
      contactShadowMaskPass.setBindGroup(0, contactShadowMaskBindGroup);
      contactShadowMaskPass.draw(3, 1, 0, 0);
    }
    contactShadowMaskPass.end();
    device.queue.submit([contactShadowEncoder.finish()]);

    let encoder = device.createCommandEncoder();
    const mainPass = encoder.beginRenderPass({
      colorAttachments: [
        colorAttachment,
        normalAttachment,
        {
          view: sssMaskRenderView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: canvasTargets.getDepthView(targetSampleCount),
        depthClearValue: 1.0,
        depthLoadOp: 'load',
        depthStoreOp,
      },
    });
    modelManager.draw(mainPass, selection, targetSampleCount > 1, cameraEye);
    mainPass.end();

    ssssResources.sssSettingsData[5] = clipPlanes.near;
    ssssResources.sssSettingsData[6] = clipPlanes.far;
    device.queue.writeBuffer(ssssResources.sssSettingsBuffer, 0, ssssResources.sssSettingsData);

    if (needsResolvedSceneMask) {
      const sssMaskPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: sssMaskView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      if (targetSampleCount > 1) {
        const sssMaskResolveBindGroup = ssssResources.createSsssMaskResolveBindGroup(
          device,
          sssMaskRenderView,
          canvasTargets.getDepthView(targetSampleCount),
        );
        sssMaskPass.setPipeline(ssssResources.sssMaskResolvePipeline);
        sssMaskPass.setBindGroup(3, postEffectGlobalBindGroup);
        sssMaskPass.setBindGroup(1, sssMaskResolveBindGroup);
      } else {
        const sssMaskFilterBindGroup = ssssResources.createSsssMaskFilterBindGroup(
          device,
          sssMaskRenderView,
          canvasTargets.getDepthView(targetSampleCount),
        );
        sssMaskPass.setPipeline(ssssResources.sssMaskFilterPipeline);
        sssMaskPass.setBindGroup(3, postEffectGlobalBindGroup);
        sssMaskPass.setBindGroup(0, sssMaskFilterBindGroup);
      }
      sssMaskPass.draw(3, 1, 0, 0);
      sssMaskPass.end();
    }

    device.queue.submit([encoder.finish()]);
    encoder = device.createCommandEncoder();

    let activeBloomLevels = 0;
    if (useBloom) {
      const bloomDynamicRange = Number.isFinite(state.environmentHdrIntensityMax) && state.environmentHdrIntensityMax >= 0
        ? state.environmentHdrIntensityMax
        : 10.0;
      bloomResources.bloomSettingsData[0] = state.postEffects.bloomThreshold;
      bloomResources.bloomSettingsData[1] = state.postEffects.bloomBlurAmount;
      bloomResources.bloomSettingsData[2] = state.postEffects.bloomAlpha;
      bloomResources.bloomSettingsData[3] = bloomDynamicRange;
      bloomResources.bloomSettingsData[4] = state.postEffects.bloomShadowMultiplier ?? 0.0;
      const blurAmount = Math.max(0.0, state.postEffects.bloomBlurAmount ?? 0.0);
      const maxBloomLevels = canvasTargets.getBloomLevelCount();
      activeBloomLevels = 2;
      if (blurAmount > 5.5) {
        activeBloomLevels = 5;
      } else if (blurAmount > 3.0) {
        activeBloomLevels = 4;
      } else if (blurAmount > 1.5) {
        activeBloomLevels = 3;
      }
      activeBloomLevels = Math.min(maxBloomLevels, activeBloomLevels);
      device.queue.writeBuffer(bloomResources.bloomSettingsBuffer, 0, bloomResources.bloomSettingsData);
    }

    const dofCompositePipeline = targetSampleCount > 1
      ? dofResources.dofCompositeMsaaPipeline
      : dofResources.dofCompositePipeline;
    const bloomLevelCount = useBloom
      ? Math.max(1, Math.min(canvasTargets.getBloomLevelCount(), Math.round(activeBloomLevels || 1)))
      : 0;
    const bloomBlurAmount = Math.max(0.0, state.postEffects?.bloomBlurAmount ?? 0.0);
    const writeBloomPassParams = (radiusScale, blendFactor, knee) => {
      bloomResources.bloomPassParamsData[0] = radiusScale;
      bloomResources.bloomPassParamsData[1] = blendFactor;
      bloomResources.bloomPassParamsData[2] = knee;
      bloomResources.bloomPassParamsData[3] = 0.0;
      device.queue.writeBuffer(bloomResources.bloomPassParamsBuffer, 0, bloomResources.bloomPassParamsData);
    };
    const writeBloomOutputSize = (width, height) => {
      bloomResources.bloomOutputSizeData[0] = Math.max(1, width);
      bloomResources.bloomOutputSizeData[1] = Math.max(1, height);
      device.queue.writeBuffer(bloomResources.bloomOutputSizeBuffer, 0, bloomResources.bloomOutputSizeData);
    };
    /**
     * 現在の post effect command encoder を送信して新しい encoder を作成します。
     * @returns {void}
     */
    const submitPostEffectEncoder = () => {
      device.queue.submit([encoder.finish()]);
      encoder = device.createCommandEncoder();
    };
    const getBloomRadiusScale = (level) => (
      1.0 + Math.max(0.0, bloomBlurAmount - 1.0) * 0.25 + level * 0.35
    );
    const getBloomBlendFactor = (level) => {
      const levelBias = Math.max(0, bloomLevelCount - level - 1) * 0.08;
      return Math.min(1.0, 0.2 + bloomBlurAmount * 0.08 + levelBias);
    };
    const bloomSoftKnee = Math.max(0.0001, (state.postEffects?.bloomThreshold ?? 0.98) * 0.25);

    for (const pass of postEffectPlan.passes) {
      switch (pass.id) {
        case POST_EFFECT_PASS_IDS.SSS_BLUR_H: {
          ssssResources.sssSettingsData[4] = 0.0;
          device.queue.writeBuffer(ssssResources.sssSettingsBuffer, 0, ssssResources.sssSettingsData);
          const sssBlurHTarget = pass.output === POST_EFFECT_TEXTURE_SLOTS.SSS_PING
            ? canvasTargets.getSsssPingView()
            : canvasTargets.getSsssPongView();
          const sssBlurHPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: sssBlurHTarget,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const sssBlurHBindGroup = ssssResources.createSsssBlurBindGroup(
            device,
            currentColorView,
            canvasTargets.getDepthView(targetSampleCount),
            canvasTargets.getSceneNormalView(),
            sssMaskView,
            targetSampleCount > 1,
          );
          sssBlurHPass.setPipeline(targetSampleCount > 1 ? ssssResources.sssBlurMsaaPipeline : ssssResources.sssBlurPipeline);
          sssBlurHPass.setBindGroup(3, postEffectGlobalBindGroup);
          sssBlurHPass.setBindGroup(targetSampleCount > 1 ? 2 : 0, sssBlurHBindGroup);
          sssBlurHPass.draw(3, 1, 0, 0);
          sssBlurHPass.end();
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
          break;
        }
        case POST_EFFECT_PASS_IDS.SSS_BLUR_V: {
          ssssResources.sssSettingsData[4] = 1.0;
          device.queue.writeBuffer(ssssResources.sssSettingsBuffer, 0, ssssResources.sssSettingsData);
          const sssBlurVTarget = pass.output === POST_EFFECT_TEXTURE_SLOTS.SSS_PONG
            ? canvasTargets.getSsssPongView()
            : canvasTargets.getSsssPingView();
          const sssBlurVPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: sssBlurVTarget,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const sssBlurVBindGroup = ssssResources.createSsssBlurBindGroup(
            device,
            canvasTargets.getSsssPingView(),
            canvasTargets.getDepthView(targetSampleCount),
            canvasTargets.getSceneNormalView(),
            sssMaskView,
            targetSampleCount > 1,
          );
          sssBlurVPass.setPipeline(targetSampleCount > 1 ? ssssResources.sssBlurMsaaPipeline : ssssResources.sssBlurPipeline);
          sssBlurVPass.setBindGroup(3, postEffectGlobalBindGroup);
          sssBlurVPass.setBindGroup(targetSampleCount > 1 ? 2 : 0, sssBlurVBindGroup);
          sssBlurVPass.draw(3, 1, 0, 0);
          sssBlurVPass.end();
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
          break;
        }
        case POST_EFFECT_PASS_IDS.SSS_COMPOSITE: {
          const sssCompositeTarget = getNextPostEffectOutputView();
          const sssCompositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: sssCompositeTarget,
              clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const sssCompositeBindGroup = ssssResources.createSsssCompositeBindGroup(
            device,
            currentColorView,
            canvasTargets.getSsssPongView(),
            sssMaskView,
          );
          sssCompositePass.setPipeline(ssssResources.sssCompositePipeline);
          sssCompositePass.setBindGroup(3, postEffectGlobalBindGroup);
          sssCompositePass.setBindGroup(1, sssCompositeBindGroup);
          sssCompositePass.draw(3, 1, 0, 0);
          sssCompositePass.end();
          currentColorView = sssCompositeTarget;
          break;
        }
        case POST_EFFECT_PASS_IDS.BLOOM_EXTRACT: {
          const outputSize = canvasTargets.getBloomLevelSize(0);
          writeBloomOutputSize(outputSize.width, outputSize.height);
          writeBloomPassParams(getBloomRadiusScale(0), 0.0, bloomSoftKnee);
          const bloomExtractBindGroup = bloomResources.createBloomExtractBindGroup(
            device,
            canvasTargets,
            currentColorView,
            sssMaskView,
          );
          const bloomExtractPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: canvasTargets.getBloomDownsampleView(0),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          bloomExtractPass.setPipeline(bloomResources.bloomExtractPipeline);
          bloomExtractPass.setBindGroup(3, postEffectGlobalBindGroup);
          bloomExtractPass.setBindGroup(0, bloomExtractBindGroup);
          bloomExtractPass.draw(3, 1, 0, 0);
          bloomExtractPass.end();
          submitPostEffectEncoder();
          break;
        }
        case POST_EFFECT_PASS_IDS.BLOOM_DOWNSAMPLE: {
          for (let level = 1; level < bloomLevelCount; level += 1) {
            const outputSize = canvasTargets.getBloomLevelSize(level);
            writeBloomOutputSize(outputSize.width, outputSize.height);
            writeBloomPassParams(getBloomRadiusScale(level), 0.0, bloomSoftKnee);
            const bloomDownsamplePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: canvasTargets.getBloomDownsampleView(level),
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
              }],
            });
            const bloomDownsampleBindGroup = bloomResources.createBloomDownsampleBindGroup(
              device,
              canvasTargets.getBloomDownsampleView(level - 1),
            );
            bloomDownsamplePass.setPipeline(bloomResources.bloomDownsamplePipeline);
            bloomDownsamplePass.setBindGroup(3, postEffectGlobalBindGroup);
            bloomDownsamplePass.setBindGroup(2, bloomDownsampleBindGroup);
            bloomDownsamplePass.draw(3, 1, 0, 0);
            bloomDownsamplePass.end();
            submitPostEffectEncoder();
          }
          break;
        }
        case POST_EFFECT_PASS_IDS.BLOOM_UPSAMPLE: {
          const lastLevel = Math.max(0, bloomLevelCount - 1);
          {
            const outputSize = canvasTargets.getBloomLevelSize(lastLevel);
            writeBloomOutputSize(outputSize.width, outputSize.height);
            const seedPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: canvasTargets.getBloomUpsampleView(lastLevel),
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
              }],
            });
            const seedBindGroup = bloomResources.createBloomDownsampleBindGroup(
              device,
              canvasTargets.getBloomDownsampleView(lastLevel),
            );
            writeBloomPassParams(1.0, 0.0, bloomSoftKnee);
            seedPass.setPipeline(bloomResources.bloomDownsamplePipeline);
            seedPass.setBindGroup(3, postEffectGlobalBindGroup);
            seedPass.setBindGroup(2, seedBindGroup);
            seedPass.draw(3, 1, 0, 0);
            seedPass.end();
            submitPostEffectEncoder();
          }
          for (let level = lastLevel - 1; level >= 0; level -= 1) {
            const outputSize = canvasTargets.getBloomLevelSize(level);
            writeBloomOutputSize(outputSize.width, outputSize.height);
            writeBloomPassParams(getBloomRadiusScale(level), getBloomBlendFactor(level), bloomSoftKnee);
            const bloomUpsamplePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: canvasTargets.getBloomUpsampleView(level),
                clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
              }],
            });
            const bloomUpsampleBindGroup = bloomResources.createBloomUpsampleBindGroup(
              device,
              canvasTargets.getBloomDownsampleView(level),
              canvasTargets.getBloomUpsampleView(level + 1),
            );
            bloomUpsamplePass.setPipeline(bloomResources.bloomUpsamplePipeline);
            bloomUpsamplePass.setBindGroup(3, postEffectGlobalBindGroup);
            bloomUpsamplePass.setBindGroup(2, bloomUpsampleBindGroup);
            bloomUpsamplePass.draw(3, 1, 0, 0);
            bloomUpsamplePass.end();
            submitPostEffectEncoder();
          }
          break;
        }
        case POST_EFFECT_PASS_IDS.BLOOM_COMPOSITE: {
          writeBloomOutputSize(canvas.width, canvas.height);
          writeBloomPassParams(1.0, 1.0, bloomSoftKnee);
          const bloomCompositeTarget = getNextPostEffectOutputView();
          const bloomCompositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: bloomCompositeTarget,
              clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const bloomCompositeBindGroup = bloomResources.createBloomCompositeBindGroup(
            device,
            canvasTargets.getBloomUpsampleView(0),
            currentColorView,
            canvasTargets,
            sssMaskView,
          );
          bloomCompositePass.setPipeline(bloomResources.bloomCompositePipeline);
          bloomCompositePass.setBindGroup(3, postEffectGlobalBindGroup);
          bloomCompositePass.setBindGroup(1, bloomCompositeBindGroup);
          bloomCompositePass.draw(3, 1, 0, 0);
          bloomCompositePass.end();
          currentColorView = bloomCompositeTarget;
          submitPostEffectEncoder();
          break;
        }
        case POST_EFFECT_PASS_IDS.DOF_BLUR: {
          const dofBlurPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: canvasTargets.getDofBlurView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const dofBlurBindGroup = dofResources.createDofBlurBindGroup(
            device,
            currentColorView,
            canvasTargets.getDepthView(targetSampleCount),
            targetSampleCount > 1,
          );
          dofBlurPass.setPipeline(targetSampleCount > 1 ? dofResources.dofBlurMsaaPipeline : dofResources.dofBlurPipeline);
          dofBlurPass.setBindGroup(3, postEffectGlobalBindGroup);
          dofBlurPass.setBindGroup(0, dofBlurBindGroup);
          dofBlurPass.draw(3, 1, 0, 0);
          dofBlurPass.end();
          break;
        }
        case POST_EFFECT_PASS_IDS.DOF_COMPOSITE: {
          const dofCompositeTarget = getNextPostEffectOutputView();
          const dofCompositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: dofCompositeTarget,
              clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          const dofCompositeBindGroup = dofResources.createDofCompositeBindGroup(
            device,
            currentColorView,
            canvasTargets.getDofBlurView(),
            canvasTargets.getDepthView(targetSampleCount),
            targetSampleCount > 1,
          );
          dofCompositePass.setPipeline(dofCompositePipeline);
          dofCompositePass.setBindGroup(3, postEffectGlobalBindGroup);
          if (targetSampleCount === 1) {
            dofCompositePass.setBindGroup(0, dofResources.createDofBlurBindGroup(
              device,
              currentColorView,
              canvasTargets.getDepthView(targetSampleCount),
              false,
            ));
          }
          dofCompositePass.setBindGroup(targetSampleCount > 1 ? 2 : 1, dofCompositeBindGroup);
          dofCompositePass.draw(3, 1, 0, 0);
          dofCompositePass.end();
          currentColorView = dofCompositeTarget;
          break;
        }
        default:
          break;
      }
    }

    if (useFxaa) {
      const fxaaSourceView = currentColorView;
      const fxaaTargetView = getNextPostEffectOutputView();
      fxaaBindGroup = createFxaaBindGroup(device, fxaaPipeline, canvasTargets, fxaaSampler, gammaResources.gammaSettingsBuffer, fxaaSourceView);
      const fxaaPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: fxaaTargetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      fxaaPass.setPipeline(fxaaPipeline);
      fxaaPass.setBindGroup(3, postEffectGlobalBindGroup);
      fxaaPass.setBindGroup(0, fxaaBindGroup);
      fxaaPass.draw(3, 1, 0, 0);
      fxaaPass.end();
      currentColorView = fxaaTargetView;
    }

    const sceneDepthView = canvasTargets.getDepthView(targetSampleCount);
    const gridOverlayPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: canvasTargets.getGridOverlayRenderView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
        resolveTarget: canvasTargets.getGridOverlayView(),
      }],
    });
    modelManager.drawGridOverlay(gridOverlayPass, sceneDepthView, targetSampleCount > 1);
    gridOverlayPass.end();

    const finalCompositePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: currentTextureView,
        clearValue: { r: 0, g: 0, b: 0, a: backgroundAlpha },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    const finalCompositeBindGroup = gammaResources.createGammaBindGroup(device, currentColorView);
    finalCompositePass.setPipeline(gammaResources.gammaPipeline);
    finalCompositePass.setBindGroup(3, postEffectGlobalBindGroup);
    finalCompositePass.setBindGroup(0, finalCompositeBindGroup);
    finalCompositePass.draw(3, 1, 0, 0);
    finalCompositePass.end();

    const gridOverlayCompositePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: currentTextureView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    const gridOverlayCompositeBindGroup = uiOverlayCompositeResources.createUiOverlayCompositeBindGroup(
      device,
      canvasTargets.getGridOverlayView(),
    );
    gridOverlayCompositePass.setPipeline(uiOverlayCompositeResources.uiOverlayCompositePipeline);
    gridOverlayCompositePass.setBindGroup(0, gridOverlayCompositeBindGroup);
    gridOverlayCompositePass.draw(3, 1, 0, 0);
    gridOverlayCompositePass.end();

    if (state.showCascadeShadowMaps) {
      const debugPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: currentTextureView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      debugPass.setPipeline(globalResources.shadowDebugPipeline);
      debugPass.setBindGroup(0, globalResources.globalBindGroup);
      debugPass.draw(6, 4, 0, 0);
      debugPass.end();
    }

    if (state.showBloomShadowDebug) {
      const bloomDebugMode = state.bloomShadowDebugMode ?? 0;
      if (bloomDebugMode >= 5 && bloomColorDebugResources) {
        const bloomColorDebugSourceView = bloomDebugMode === 5
          ? sceneInputView
          : (bloomDebugMode === 6 && useBloom
            ? canvasTargets.getBloomDownsampleView(0)
            : (bloomDebugMode === 7 && useBloom
              ? canvasTargets.getBloomUpsampleView(0)
              : (bloomDebugMode === 8
                ? currentColorView
                : null)));
        if (bloomColorDebugSourceView) {
          const bloomColorDebugPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: currentTextureView,
              loadOp: 'load',
              storeOp: 'store',
            }],
          });
          const bloomColorDebugBindGroup = bloomColorDebugResources.createBloomColorDebugBindGroup(
            device,
            bloomColorDebugSourceView,
          );
          bloomColorDebugPass.setPipeline(bloomColorDebugResources.bloomColorDebugPipeline);
          bloomColorDebugPass.setBindGroup(0, bloomColorDebugBindGroup);
          bloomColorDebugPass.draw(6, 1, 0, 0);
          bloomColorDebugPass.end();
        }
      } else if (bloomShadowDebugResources) {
        const bloomShadowDebugPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: currentTextureView,
            loadOp: 'load',
            storeOp: 'store',
          }],
        });
        const bloomShadowDebugBindGroup = bloomShadowDebugResources.createBloomShadowDebugBindGroup(
          device,
          canvasTargets.getSsssMaskView(),
        );
        bloomShadowDebugPass.setPipeline(bloomShadowDebugResources.bloomShadowDebugPipeline);
        bloomShadowDebugPass.setBindGroup(0, bloomShadowDebugBindGroup);
        bloomShadowDebugPass.draw(6, 1, 0, 0);
        bloomShadowDebugPass.end();
      } else if (bloomShadowDebugPipeline) {
        const bloomShadowDebugPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: currentTextureView,
            loadOp: 'load',
            storeOp: 'store',
          }],
        });
        bloomShadowDebugPass.setPipeline(bloomShadowDebugPipeline);
        bloomShadowDebugPass.setBindGroup(0, globalResources.globalBindGroup);
        bloomShadowDebugPass.draw(6, 1, 0, 0);
        bloomShadowDebugPass.end();
      }
    }

    const uiOverlayPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: canvasTargets.getUiOverlayRenderView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
        resolveTarget: canvasTargets.getUiOverlayView(),
      }],
    });
    modelManager.drawUiOverlay(uiOverlayPass, selection);
    if (shouldDrawLightOverlay(state)) {
      updateLightOverlayBuffer(device, state.lightObject, selection, camera, inspectorState);
      drawLightOverlay(uiOverlayPass, state.lightObject);
    }
    uiOverlayPass.end();

    const uiOverlayCompositePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: currentTextureView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    const uiOverlayCompositeBindGroup = uiOverlayCompositeResources.createUiOverlayCompositeBindGroup(
      device,
      canvasTargets.getUiOverlayView(),
    );
    uiOverlayCompositePass.setPipeline(uiOverlayCompositeResources.uiOverlayCompositePipeline);
    uiOverlayCompositePass.setBindGroup(0, uiOverlayCompositeBindGroup);
    uiOverlayCompositePass.draw(3, 1, 0, 0);
    uiOverlayCompositePass.end();

    if (captureTexture) {
      const presentEncoder = device.createCommandEncoder();
      presentEncoder.copyTextureToTexture(
        { texture: captureTexture },
        { texture: currentTexture },
        {
          width: canvas.width,
          height: canvas.height,
          depthOrArrayLayers: 1,
        },
      );
      device.queue.submit([encoder.finish(), presentEncoder.finish()]);
    } else {
      device.queue.submit([encoder.finish()]);
    }
    requestAnimationFrame(draw);
  };

  draw(performance.now());
}
