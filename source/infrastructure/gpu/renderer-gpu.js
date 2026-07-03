import { normalize } from '../../shared/math/math-utils.js';
import {
  createDofUniformData,
  DOF_DEFAULT_FAR_PLANE,
  DOF_DEFAULT_FOV_Y,
  DOF_DEFAULT_NEAR_PLANE,
  DOF_SENSOR_HEIGHT_MM,
  DOF_UNIFORM_FLOAT_COUNT,
  DOF_WORLD_UNITS_PER_METER,
} from '../../shared/physics/dof-physics.js';
import {
  createBlackHdrEnvironmentTexture,
  createHdrEnvironmentSampler,
} from '../assets/hdr-environment.js';
import {
  ACES_LUT_SIZE,
  createAcesLutData,
  getDisplayColorSpaceModeValue,
  getViewTransformModeValue,
  normalizeDisplayColorSpace,
  normalizeViewTransform,
} from '../../shared/math/view-transform.js';
import {
  createColorTemperatureScale,
  estimateColorTemperatureFromLinearRgb,
} from '../../shared/color/color-temperature-utils.js';
export {
  createColorTemperatureScale,
  estimateColorTemperatureFromLinearRgb,
} from '../../shared/color/color-temperature-utils.js';

export const GLOBAL_UNIFORM_FLOAT_COUNT = 136;
export const SHADOW_CASCADE_COUNT = 4;
export const SHADOW_MAP_SIZE = 1024;
export const GLOBAL_UNIFORM_OFFSETS = {
  mvp: 0,
  view: 16,
  lightingParams: 32,
  lightColor: 36,
  shadowParams: 40,
  shadowInfo: 44,      // x: cascadeCount, y: shadowMapSize, z: boneThickness, w: shadowCascadeIndex
  shadowSplits: 48,
  shadowMatrices: 52,
  edgeColor: 116,
  resolution: 120,    // x: width, y: height, zw: (unused)
  environmentParams: 124, // x: maxMipLevel, y: intensity, z: gltfLightStrength, w: loadedFlag
  cameraWorldPosition: 128,
  shadowPowerParams: 132, // x: shadowPower, y: dynamicRange, z: gridThickness, w: reserved
};
const LINEAR_COLOR_FORMAT = 'rgba16float';

/**
 * post-effect シェーダで共有する global uniform bind group を作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {{uniformBuffer: GPUBuffer}} globalResources - 既存の global uniform リソース。
 * @returns {{postEffectGlobalBindGroupLayout: GPUBindGroupLayout, postEffectGlobalBindGroup: GPUBindGroup}} 共有 bind group。
 */
export function createPostEffectGlobalResources(device, globalResources) {
  const postEffectGlobalBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });

  return {
    postEffectGlobalBindGroupLayout,
    postEffectGlobalBindGroup: device.createBindGroup({
      layout: postEffectGlobalBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: globalResources.uniformBuffer } },
      ],
    }),
  };
}

/**
 * FXAA 用のパイプラインと bind group を作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} postEffectShaderModule - ポストエフェクト用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {object} canvasTargets - キャンバスターゲット。
 * @param {GPUSampler} fxaaSampler - FXAA サンプラー。
 * @param {GPUBuffer} gammaSettingsBuffer - FXAA bind group の uniform バッファ。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {GPUTextureView|null} [sourceView=null] - FXAA の入力ビュー。
 * @returns {{fxaaPipeline: GPURenderPipeline, fxaaBindGroup: GPUBindGroup}} FXAA リソース。
 */
export function createFxaaResources(device, postEffectShaderModule, outputFormat, canvasTargets, fxaaSampler, gammaSettingsBuffer, postEffectGlobalBindGroupLayout, sourceView = null) {
  const fxaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const fxaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        fxaaBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: postEffectShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: { module: postEffectShaderModule, entryPoint: 'fs_fxaa', targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }] },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  return {
    fxaaPipeline,
    fxaaBindGroup: createFxaaBindGroup(device, fxaaPipeline, canvasTargets, fxaaSampler, gammaSettingsBuffer, sourceView),
  };
}

/**
 * 最終表示面へ UI overlay を合成するパイプラインを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} uiOverlayShaderModule - UI overlay 合成用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 最終描画先フォーマット。
 * @returns {{uiOverlayCompositePipeline: GPURenderPipeline, createUiOverlayCompositeBindGroup: Function}} UI overlay 合成リソース。
 */
export function createUiOverlayCompositeResources(device, uiOverlayShaderModule, outputFormat) {
  const uiOverlayCompositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ],
        }),
      ],
    }),
    vertex: { module: uiOverlayShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: uiOverlayShaderModule,
      entryPoint: 'fs_ui_overlay_composite',
      targets: [{
        format: outputFormat ?? LINEAR_COLOR_FORMAT,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  return {
    uiOverlayCompositePipeline,
    createUiOverlayCompositeBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: uiOverlayCompositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sourceView },
        ],
      });
    },
  };
}

/**
 * 最終表示変換用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} gammaShaderModule - 最終表示変換用シェーダーモジュール。
 * @param {GPUTextureFormat} presentationFormat - 描画フォーマット。
 * @param {GPUSampler} gammaSampler - シーンカラー用サンプラー。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {object} [initialState={}] - 初期表示状態。
 * @returns {object} 最終表示変換リソース。
 */
export function createGammaResources(device, gammaShaderModule, presentationFormat, gammaSampler, postEffectGlobalBindGroupLayout, initialState = {}) {
  const initialGamma = Number.isFinite(initialState.gamma) ? initialState.gamma : 1.0;
  const initialColorTemperature = Number.isFinite(initialState.colorTemperature)
    ? initialState.colorTemperature
    : COLOR_TEMPERATURE_NEUTRAL_KELVIN;
  const initialChromaticAberration = Number.isFinite(initialState.chromaticAberration)
    ? initialState.chromaticAberration
    : 0.0;
  const initialViewTransform = normalizeViewTransform(initialState.viewTransform);
  const initialDisplayColorSpace = normalizeDisplayColorSpace(initialState.displayColorSpace);
  const gammaSettingsBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const gammaSettingsData = new Float32Array([
    initialGamma,
    initialChromaticAberration,
    ...createColorTemperatureScale(initialColorTemperature),
    0.0,
    0.0,
    0.0,
    getViewTransformModeValue(initialViewTransform),
    getDisplayColorSpaceModeValue(initialDisplayColorSpace),
    0.0,
    0.0,
  ]);
  const lutSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  });
  const placeholderLutTexture = createPlaceholderLutTexture(device);
  const placeholderLutView = placeholderLutTexture.createView({ dimension: '3d' });
  const acesLutCache = new Map();
  let activeAcesLutView = placeholderLutView;
  const gammaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '3d' } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          ],
        }),
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: gammaShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: { module: gammaShaderModule, entryPoint: 'fs_gamma', targets: [{ format: presentationFormat }] },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  setDisplayTransformModes(initialViewTransform, initialDisplayColorSpace);
  device.queue.writeBuffer(gammaSettingsBuffer, 0, gammaSettingsData);

  return {
    gammaSettingsBuffer,
    gammaSettingsData,
    gammaPipeline,
    acesLutCache,
    setDisplayTransformModes,
    createGammaBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: gammaPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: gammaSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: gammaSampler },
          { binding: 3, resource: activeAcesLutView },
          { binding: 4, resource: lutSampler },
        ],
      });
    },
  };

  /**
   * 表示変換モードに応じて 3D LUT を切り替えます。
   * @param {string} viewTransform - view transform。
   * @param {string} displayColorSpace - display 色空間。
   */
  function setDisplayTransformModes(viewTransform, displayColorSpace) {
    const normalizedViewTransform = normalizeViewTransform(viewTransform);
    const normalizedDisplayColorSpace = normalizeDisplayColorSpace(displayColorSpace);
    gammaSettingsData[8] = getViewTransformModeValue(normalizedViewTransform);
    gammaSettingsData[9] = getDisplayColorSpaceModeValue(normalizedDisplayColorSpace);
    activeAcesLutView = normalizedViewTransform === 'aces-2.0'
      ? getOrCreateAcesLutView(normalizedDisplayColorSpace)
      : placeholderLutView;
  }

  /**
   * 指定 display 用 ACES LUT view を返します。
   * @param {string} displayColorSpace - display 色空間。
   * @returns {GPUTextureView} 3D LUT view。
   */
  function getOrCreateAcesLutView(displayColorSpace) {
    const normalizedDisplayColorSpace = normalizeDisplayColorSpace(displayColorSpace);
    const cached = acesLutCache.get(normalizedDisplayColorSpace);
    if (cached) {
      return cached.view;
    }

    const texture = device.createTexture({
      size: [ACES_LUT_SIZE, ACES_LUT_SIZE, ACES_LUT_SIZE],
      dimension: '3d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = createAcesLutUploadData(
      createAcesLutData(ACES_LUT_SIZE, normalizedDisplayColorSpace),
      ACES_LUT_SIZE,
    );
    device.queue.writeTexture(
      { texture },
      data,
      {
        bytesPerRow: getPaddedBytesPerRow(ACES_LUT_SIZE, 4),
        rowsPerImage: ACES_LUT_SIZE,
      },
      {
        width: ACES_LUT_SIZE,
        height: ACES_LUT_SIZE,
        depthOrArrayLayers: ACES_LUT_SIZE,
      },
    );
    const view = texture.createView({ dimension: '3d' });
    acesLutCache.set(normalizedDisplayColorSpace, { texture, view });
    return view;
  }
}

/**
 * 色収差用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} postEffectShaderModule - ポストエフェクト用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUSampler} postEffectSampler - ポストエフェクト用サンプラー。
 * @param {GPUBuffer} gammaSettingsBuffer - gamma 設定用 uniform バッファ。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @returns {object} 色収差リソース。
 */
export function createChromaticAberrationResources(device, postEffectShaderModule, outputFormat, postEffectSampler, gammaSettingsBuffer, postEffectGlobalBindGroupLayout) {
  const chromaticAberrationPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          ],
        }),
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: postEffectShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: { module: postEffectShaderModule, entryPoint: 'fs_chromatic_aberration', targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }] },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  return {
    chromaticAberrationPipeline,
    createChromaticAberrationBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: chromaticAberrationPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: gammaSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: postEffectSampler },
        ],
      });
    },
  };
}

/**
 * 被写界深度用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} dofShaderModule - DOF 用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUSampler} postEffectSampler - ポストエフェクト用サンプラー。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {{focusDistance?: number, blurAmount?: number, nearPlane?: number, farPlane?: number, fStop?: number}} [initialSettings={}] - 初期設定。
 * @returns {object} DOF リソース。
 */
export function createDofResources(device, dofShaderModule, outputFormat, postEffectSampler, postEffectGlobalBindGroupLayout, initialSettings = {}) {
  const {
    focusDistance = 1.0,
    blurAmount = 2.0,
    nearPlane = DOF_DEFAULT_NEAR_PLANE,
    farPlane = DOF_DEFAULT_FAR_PLANE,
    fStop = 2.8,
  } = initialSettings;
  const dofSettingsBuffer = device.createBuffer({
    size: DOF_UNIFORM_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const dofSettingsData = createDofUniformData({
    focusDistanceWorld: focusDistance,
    sceneScale: DOF_WORLD_UNITS_PER_METER,
    fovY: DOF_DEFAULT_FOV_Y,
    canvasHeight: 1,
    sensorHeightMm: DOF_SENSOR_HEIGHT_MM,
    fStop,
    blurAmount,
    nearPlane,
    farPlane,
  });
  const dofBlurBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: false } },
    ],
  });
  const dofBlurMsaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const dofCompositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: false } },
    ],
  });
  const dofCompositeMsaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
    ],
  });

  const dofBlurPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        dofBlurBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: dofShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: dofShaderModule,
      entryPoint: 'fs_dof_blur',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const dofBlurMsaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        dofBlurMsaaBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: dofShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: dofShaderModule,
      entryPoint: 'fs_dof_blur_msaa',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const dofCompositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        dofBlurBindGroupLayout,
        dofCompositeBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: dofShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: dofShaderModule,
      entryPoint: 'fs_dof_composite',
      targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const dofCompositeMsaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        dofCompositeMsaaBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: dofShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: dofShaderModule,
      entryPoint: 'fs_dof_composite_msaa',
      targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  device.queue.writeBuffer(dofSettingsBuffer, 0, dofSettingsData);

  return {
    dofSettingsBuffer,
    dofSettingsData,
    dofBlurPipeline,
    dofBlurMsaaPipeline,
    dofCompositePipeline,
    dofCompositeMsaaPipeline,
    createDofBlurBindGroup(deviceRef, sourceView, depthView = null, useMsaa = false) {
      return deviceRef.createBindGroup({
        layout: useMsaa ? dofBlurMsaaPipeline.getBindGroupLayout(0) : dofBlurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: dofSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: postEffectSampler },
          ...(useMsaa ? [] : [{ binding: 3, resource: depthView }]),
        ],
      });
    },
    createDofCompositeBindGroup(deviceRef, sourceView, blurredView, depthView, useMsaa = false) {
      return deviceRef.createBindGroup({
        layout: useMsaa ? dofCompositeMsaaPipeline.getBindGroupLayout(2) : dofCompositePipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: dofSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: postEffectSampler },
          { binding: 3, resource: blurredView },
          { binding: 4, resource: depthView },
        ],
      });
    },
  };
}

/**
 * Ambient Occlusion 用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} ambientOcclusionMaskShaderModule - AO mask 用シェーダーモジュール。
 * @param {GPUShaderModule} ambientOcclusionMaskMsaaShaderModule - AO MSAA mask 用シェーダーモジュール。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {{ambientOcclusionRadius?: number, ambientOcclusionBias?: number, ambientOcclusionIntensity?: number, ambientOcclusionSampleCount?: number, ambientOcclusionBlurAmount?: number}} [initialSettings={}] - 初期設定。
 * @returns {object} Ambient Occlusion リソース。
 */
export function createAmbientOcclusionResources(
  device,
  ambientOcclusionMaskShaderModule,
  ambientOcclusionMaskMsaaShaderModule,
  postEffectGlobalBindGroupLayout,
  initialSettings = {},
) {
  const ambientOcclusionSettingsBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const ambientOcclusionSettingsData = new Float32Array([
    initialSettings.ambientOcclusionRadius ?? 0.4,
    initialSettings.ambientOcclusionBias ?? 0.02,
    initialSettings.ambientOcclusionIntensity ?? 1.0,
    initialSettings.ambientOcclusionSampleCount ?? 12,
    initialSettings.ambientOcclusionBlurAmount ?? 1.0,
    0.1,
    1000.0,
    Math.tan(Math.PI / 8.0),
    1.0,
    0.0,
    0.0,
    0.0,
  ]);
  const ambientOcclusionMaskBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const ambientOcclusionMaskMsaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const ambientOcclusionMaskPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        ambientOcclusionMaskBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: ambientOcclusionMaskShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: ambientOcclusionMaskShaderModule,
      entryPoint: 'fs_ambient_occlusion_mask',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const ambientOcclusionMaskMsaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        ambientOcclusionMaskMsaaBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: ambientOcclusionMaskMsaaShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: ambientOcclusionMaskMsaaShaderModule,
      entryPoint: 'fs_ambient_occlusion_mask_msaa',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  device.queue.writeBuffer(ambientOcclusionSettingsBuffer, 0, ambientOcclusionSettingsData);

  return {
    ambientOcclusionSettingsBuffer,
    ambientOcclusionSettingsData,
    ambientOcclusionMaskPipeline,
    ambientOcclusionMaskMsaaPipeline,
    createAmbientOcclusionMaskBindGroup(deviceRef, depthView, normalView, useMsaa = false) {
      return deviceRef.createBindGroup({
        layout: useMsaa ? ambientOcclusionMaskMsaaPipeline.getBindGroupLayout(0) : ambientOcclusionMaskPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ambientOcclusionSettingsBuffer } },
          { binding: 1, resource: depthView },
          { binding: 2, resource: normalView },
        ],
      });
    },
  };
}

/**
 * コンタクトシャドウ用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} contactShadowMaskShaderModule - コンタクトシャドウ mask 用シェーダーモジュール。
 * @param {GPUShaderModule} contactShadowMaskMsaaShaderModule - コンタクトシャドウ MSAA mask 用シェーダーモジュール。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {{contactShadowLength?: number, contactShadowThickness?: number, contactShadowIntensity?: number, contactShadowStepCount?: number, contactShadowBlurAmount?: number}} [initialSettings={}] - 初期設定。
 * @returns {object} コンタクトシャドウリソース。
 */
export function createContactShadowResources(
  device,
  contactShadowMaskShaderModule,
  contactShadowMaskMsaaShaderModule,
  postEffectGlobalBindGroupLayout,
  initialSettings = {},
) {
  const contactShadowSettingsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const contactShadowSettingsData = new Float32Array([
    initialSettings.contactShadowLength ?? 0.08,
    initialSettings.contactShadowThickness ?? 0.01,
    initialSettings.contactShadowIntensity ?? 0.55,
    initialSettings.contactShadowStepCount ?? 8,
    0.1,
    1000.0,
    Math.tan(45 * Math.PI / 180 * 0.5),
    1.0,
    0.0,
    -1.0,
    0.0,
    initialSettings.contactShadowBlurAmount ?? 1.0,
    0.0,
    0.0,
    0.0,
    0.0,
  ]);
  const contactShadowMaskBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const contactShadowMaskMsaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const contactShadowMaskPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        contactShadowMaskBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: contactShadowMaskShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: contactShadowMaskShaderModule,
      entryPoint: 'fs_contact_shadow_mask',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const contactShadowMaskMsaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        contactShadowMaskMsaaBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: contactShadowMaskMsaaShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: contactShadowMaskMsaaShaderModule,
      entryPoint: 'fs_contact_shadow_mask_msaa',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  device.queue.writeBuffer(contactShadowSettingsBuffer, 0, contactShadowSettingsData);

  return {
    contactShadowSettingsBuffer,
    contactShadowSettingsData,
    contactShadowMaskPipeline,
    contactShadowMaskMsaaPipeline,
    createContactShadowMaskBindGroup(deviceRef, depthView, normalView, useMsaa = false) {
      return deviceRef.createBindGroup({
        layout: useMsaa ? contactShadowMaskMsaaPipeline.getBindGroupLayout(0) : contactShadowMaskPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: contactShadowSettingsBuffer } },
          { binding: 1, resource: depthView },
          { binding: 2, resource: normalView },
        ],
      });
    },
  };
}

/**
 * Screen Space SSS 用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} sssShaderModule - SSS 用シェーダーモジュール。
 * @param {GPUShaderModule} sssMaskShaderModule - SSS mask filter 用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {{radius?: number, depthThreshold?: number, normalThreshold?: number, strength?: number}} [initialSettings={}] - 初期設定。
 * @returns {object} SSS リソース。
 */
export function createSsssResources(device, sssShaderModule, sssMaskShaderModule, outputFormat, postEffectGlobalBindGroupLayout, initialSettings = {}) {
  const sssSettingsBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sssSettingsData = new Float32Array([
    initialSettings.radius ?? 1.5,
    initialSettings.depthThreshold ?? 0.01,
    initialSettings.normalThreshold ?? 0.2,
    initialSettings.strength ?? 0.2,
    0.0,
    0.0,
    0.0,
    0.0,
  ]);
  const emptyBindGroupLayout = device.createBindGroupLayout({
    entries: [],
  });
  const sssBlurBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: false } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const sssBlurMsaaBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const sssMaskResolveBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', multisampled: true } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: true } },
    ],
  });
  const sssMaskFilterBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: false } },
    ],
  });
  const sssCompositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const sssBlurPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        sssBlurBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: sssShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: sssShaderModule,
      entryPoint: 'fs_sss_blur',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const sssBlurMsaaPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        emptyBindGroupLayout,
        sssBlurMsaaBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: sssShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: sssShaderModule,
      entryPoint: 'fs_sss_blur_msaa',
      targets: [{ format: 'rgba16float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const sssMaskResolvePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        sssMaskResolveBindGroupLayout,
        emptyBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: sssMaskShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: sssMaskShaderModule,
      entryPoint: 'fs_sss_mask_resolve',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const sssMaskFilterPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        sssMaskFilterBindGroupLayout,
        emptyBindGroupLayout,
        emptyBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: sssMaskShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: sssMaskShaderModule,
      entryPoint: 'fs_sss_mask_filter',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const sssCompositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        sssCompositeBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: sssShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: sssShaderModule,
      entryPoint: 'fs_sss_composite',
      targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  device.queue.writeBuffer(sssSettingsBuffer, 0, sssSettingsData);

  return {
    sssSettingsBuffer,
    sssSettingsData,
    sssBlurPipeline,
    sssBlurMsaaPipeline,
    sssMaskResolvePipeline,
    sssMaskFilterPipeline,
    sssCompositePipeline,
    createSsssBlurBindGroup(deviceRef, sourceView, depthView, normalView, maskView, useMsaa = false) {
      return deviceRef.createBindGroup({
        layout: useMsaa ? sssBlurMsaaPipeline.getBindGroupLayout(2) : sssBlurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sssSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: depthView },
          { binding: 3, resource: normalView },
          { binding: 4, resource: maskView },
        ],
      });
    },
    createSsssMaskResolveBindGroup(deviceRef, maskView, depthView) {
      return deviceRef.createBindGroup({
        layout: sssMaskResolvePipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sssSettingsBuffer } },
          { binding: 1, resource: maskView },
          { binding: 2, resource: depthView },
        ],
      });
    },
    createSsssMaskFilterBindGroup(deviceRef, maskView, depthView) {
      return deviceRef.createBindGroup({
        layout: sssMaskFilterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sssSettingsBuffer } },
          { binding: 1, resource: maskView },
          { binding: 2, resource: depthView },
        ],
      });
    },
    createSsssCompositeBindGroup(deviceRef, sourceView, blurredView, maskView) {
      return deviceRef.createBindGroup({
        layout: sssCompositePipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sssSettingsBuffer } },
          { binding: 1, resource: sourceView },
          { binding: 2, resource: blurredView },
          { binding: 3, resource: maskView },
        ],
      });
    },
  };
}

/**
 * bloom 用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} bloomShaderModule - bloom 用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUSampler} bloomSampler - bloom 用サンプラー。
 * @param {GPUBindGroupLayout} postEffectGlobalBindGroupLayout - 共有 post-effect uniform レイアウト。
 * @param {{bloomThreshold?: number, bloomBlurAmount?: number, bloomAlpha?: number, dynamicRange?: number, bloomShadowMultiplier?: number}} [initialSettings] - 初期 bloom 設定。
 * @returns {object} bloom リソース。
 */
export function createBloomResources(device, bloomShaderModule, outputFormat, bloomSampler, postEffectGlobalBindGroupLayout, initialSettings = {}) {
  const {
    bloomThreshold = 0.98,
    bloomBlurAmount = 2.0,
    bloomAlpha = 1.0,
    dynamicRange = 10.0,
    bloomShadowMultiplier = 0.0,
  } = initialSettings;
  const bloomSettingsBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomPassParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomOutputSizeBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomSettingsData = new Float32Array([
    bloomThreshold,
    bloomBlurAmount,
    bloomAlpha,
    dynamicRange,
    bloomShadowMultiplier,
    0.0,
    0.0,
    0.0,
  ]);
  const bloomPassParamsData = new Float32Array([1.0, 0.0, 0.1, 0.0]);
  const bloomOutputSizeData = new Float32Array([1.0, 1.0]);
  const emptyBindGroupLayout = device.createBindGroupLayout({
    entries: [],
  });

  const bloomExtractBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const bloomDownsampleBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const bloomUpsampleBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const bloomCompositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  const bloomExtractPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        bloomExtractBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: bloomShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_extract',
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const bloomDownsamplePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        emptyBindGroupLayout,
        bloomDownsampleBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: bloomShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_downsample',
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const bloomUpsamplePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        emptyBindGroupLayout,
        bloomUpsampleBindGroupLayout,
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: bloomShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_upsample',
      targets: [{ format: LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  const bloomCompositePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        emptyBindGroupLayout,
        bloomCompositeBindGroupLayout,
        device.createBindGroupLayout({ entries: [] }),
        postEffectGlobalBindGroupLayout,
      ],
    }),
    vertex: { module: bloomShaderModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_composite',
      targets: [{ format: outputFormat ?? LINEAR_COLOR_FORMAT }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
  device.queue.writeBuffer(bloomSettingsBuffer, 0, bloomSettingsData);
  device.queue.writeBuffer(bloomPassParamsBuffer, 0, bloomPassParamsData);
  device.queue.writeBuffer(bloomOutputSizeBuffer, 0, bloomOutputSizeData);

  return {
    bloomSettingsBuffer,
    bloomPassParamsBuffer,
    bloomOutputSizeBuffer,
    bloomSettingsData,
    bloomPassParamsData,
    bloomOutputSizeData,
    bloomExtractPipeline,
    bloomDownsamplePipeline,
    bloomUpsamplePipeline,
    bloomCompositePipeline,
    createBloomExtractBindGroup(deviceRef, canvasTargets, sourceView = null, maskView = null) {
      return deviceRef.createBindGroup({
        layout: bloomExtractPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: bloomSettingsBuffer } },
          { binding: 1, resource: { buffer: bloomPassParamsBuffer } },
          { binding: 2, resource: { buffer: bloomOutputSizeBuffer } },
          { binding: 3, resource: sourceView ?? canvasTargets.getPostProcessInputView() },
          { binding: 4, resource: maskView ?? canvasTargets.getSsssMaskView() },
          { binding: 5, resource: bloomSampler },
        ],
      });
    },
    createBloomDownsampleBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: bloomDownsamplePipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: bloomSettingsBuffer } },
          { binding: 1, resource: { buffer: bloomPassParamsBuffer } },
          { binding: 2, resource: { buffer: bloomOutputSizeBuffer } },
          { binding: 3, resource: sourceView },
          { binding: 4, resource: sourceView },
          { binding: 5, resource: bloomSampler },
        ],
      });
    },
    createBloomUpsampleBindGroup(deviceRef, highResView, lowResView) {
      return deviceRef.createBindGroup({
        layout: bloomUpsamplePipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: bloomSettingsBuffer } },
          { binding: 1, resource: { buffer: bloomPassParamsBuffer } },
          { binding: 2, resource: { buffer: bloomOutputSizeBuffer } },
          { binding: 3, resource: highResView },
          { binding: 4, resource: lowResView },
          { binding: 5, resource: bloomSampler },
        ],
      });
    },
    createBloomCompositeBindGroup(deviceRef, bloomView, sourceView = null, canvasTargets = null, maskView = null) {
      return deviceRef.createBindGroup({
        layout: bloomCompositePipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: bloomSettingsBuffer } },
          { binding: 1, resource: { buffer: bloomPassParamsBuffer } },
          { binding: 2, resource: { buffer: bloomOutputSizeBuffer } },
          { binding: 3, resource: sourceView ?? canvasTargets?.getPostProcessInputView() },
          { binding: 4, resource: bloomView },
          { binding: 5, resource: maskView ?? canvasTargets?.getSsssMaskView() },
          { binding: 6, resource: bloomSampler },
        ],
      });
    },
  };
}

/**
 * bloom shadow デバッグ表示用のパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} bloomShaderModule - bloom 用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUSampler} debugSampler - デバッグ表示用サンプラー。
 * @returns {object} bloom shadow デバッグリソース。
 */
export function createBloomShadowDebugResources(device, bloomShaderModule, outputFormat, debugSampler) {
  void debugSampler;
  const bloomShadowDebugPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: bloomShaderModule, entryPoint: 'vs_bloom_shadow_debug' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_shadow_debug',
      targets: [{
        format: outputFormat ?? LINEAR_COLOR_FORMAT,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  return {
    bloomShadowDebugPipeline,
    createBloomShadowDebugBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: bloomShadowDebugPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sourceView },
        ],
      });
    },
  };
}

/**
 * bloom color デバッグ表示用のオーバーレイパイプラインと bind group 作成関数をまとめて返します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} bloomShaderModule - bloom 用シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 描画フォーマット。
 * @param {GPUSampler} debugSampler - デバッグ表示用サンプラー。
 * @returns {object} bloom color デバッグリソース。
 */
export function createBloomColorDebugResources(device, bloomShaderModule, outputFormat, debugSampler) {
  const bloomColorDebugPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: bloomShaderModule, entryPoint: 'vs_bloom_shadow_debug' },
    fragment: {
      module: bloomShaderModule,
      entryPoint: 'fs_bloom_color_debug',
      targets: [{
        format: outputFormat ?? LINEAR_COLOR_FORMAT,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });

  return {
    bloomColorDebugPipeline,
    createBloomColorDebugBindGroup(deviceRef, sourceView) {
      return deviceRef.createBindGroup({
        layout: bloomColorDebugPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: debugSampler },
        ],
      });
    },
  };
}

/**
 * シャドウマップ可視化用のオーバーレイパイプラインを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} shaderModule - シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 最終描画先のフォーマット。
 * @param {GPUBindGroupLayout} globalBindGroupLayout - グローバル bind group layout。
 * @returns {GPURenderPipeline} デバッグ描画パイプライン。
 */
export function createShadowDebugPipeline(device, shaderModule, outputFormat, globalBindGroupLayout) {
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [globalBindGroupLayout],
    }),
    vertex: { module: shaderModule, entryPoint: 'vs_shadow_debug' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_shadow_debug',
      targets: [{
        format: outputFormat ?? LINEAR_COLOR_FORMAT,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
}

/**
 * FXAA bind group を現在の描画ターゲットに合わせて作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPURenderPipeline} fxaaPipeline - FXAA パイプライン。
 * @param {object} canvasTargets - キャンバスターゲット。
 * @param {GPUSampler} fxaaSampler - FXAA サンプラー。
 * @param {GPUBuffer} gammaSettingsBuffer - FXAA bind group の uniform バッファ。
 * @param {GPUTextureView|null} [sourceView=null] - FXAA の入力ビュー。
 * @returns {GPUBindGroup} FXAA bind group。
 */
export function createFxaaBindGroup(device, fxaaPipeline, canvasTargets, fxaaSampler, gammaSettingsBuffer, sourceView = null) {
  return device.createBindGroup({
    layout: fxaaPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: gammaSettingsBuffer } },
      { binding: 1, resource: sourceView ?? canvasTargets.getPostProcessInputView() },
      { binding: 2, resource: fxaaSampler },
    ],
  });
}

/**
 * 指定値を範囲に収めます。
 * @param {number} value - 入力値。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @param {number} fallback - 非数時の既定値。
 * @returns {number} 収めた値。
 */
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * 最終表示変換用のプレースホルダー LUT texture を作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {GPUTexture} 1x1x1 LUT texture。
 */
function createPlaceholderLutTexture(device) {
  const texture = device.createTexture({
    size: [1, 1, 1],
    dimension: '3d',
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array([0, 0, 0, 255]),
    {
      bytesPerRow: 4,
      rowsPerImage: 1,
    },
    {
      width: 1,
      height: 1,
      depthOrArrayLayers: 1,
    },
  );
  return texture;
}

/**
 * tightly packed な LUT データへ row padding を追加します。
 * @param {Uint8Array} sourceData - 元データ。
 * @param {number} size - LUT 辺長。
 * @returns {Uint8Array} upload 用データ。
 */
function createAcesLutUploadData(sourceData, size) {
  const bytesPerTexel = 4;
  const rowTexelCount = size * 4;
  const paddedBytesPerRow = getPaddedBytesPerRow(size, bytesPerTexel);
  const paddedTexelCountPerRow = paddedBytesPerRow;
  if (paddedBytesPerRow === size * bytesPerTexel) {
    return sourceData;
  }

  const rowCount = size * size;
  const targetData = new Uint8Array(paddedBytesPerRow * rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const sourceOffset = rowIndex * rowTexelCount;
    const targetOffset = rowIndex * paddedTexelCountPerRow;
    targetData.set(sourceData.subarray(sourceOffset, sourceOffset + rowTexelCount), targetOffset);
  }
  return targetData;
}

/**
 * WebGPU upload 用の bytesPerRow を 256-byte align で返します。
 * @param {number} width - texture 幅。
 * @param {number} bytesPerTexel - texel あたりバイト数。
 * @returns {number} padding 後の bytesPerRow。
 */
function getPaddedBytesPerRow(width, bytesPerTexel) {
  const unpadded = width * bytesPerTexel;
  return Math.ceil(unpadded / 256) * 256;
}

/**
 * グローバル GPU リソースを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {{shadowMapSize?: number, shadowEdgeSize?: number, shadowEdgeOpacity?: number, shadowPower?: number, shadowBias?: number, shadowStrength?: number, gridThickness?: number, lightColor?: number[], lightDirection?: number[], gltfLightStrength?: number, dynamicRange?: number}} [options={}] - オプション。
 * @returns {object} グローバル GPU リソース一式。
 */
export function createGlobalResources(device, options = {}) {
  const shadowMapSize = options.shadowMapSize ?? SHADOW_MAP_SIZE;
  const shadowEdgeSize = options.shadowEdgeSize ?? 0.002;
  const shadowEdgeOpacity = options.shadowEdgeOpacity ?? 0.5;
  const shadowPower = options.shadowPower ?? 1.0;
  const shadowBias = options.shadowBias ?? 0.001;
  const shadowStrength = options.shadowStrength ?? 1.0;
  const gridThickness = Number.isFinite(options.gridThickness) ? Math.max(0.1, options.gridThickness) : 1.0;
  const boneThickness = options.boneThickness ?? 1.0;
  const lightColor = Array.isArray(options.lightColor)
    ? [
      options.lightColor[0] ?? 1.0,
      options.lightColor[1] ?? 1.0,
      options.lightColor[2] ?? 1.0,
      options.lightColor[3] ?? 1.0,
    ]
    : [1.0, 1.0, 1.0, 1.0];
  const dynamicRange = Number.isFinite(options.dynamicRange) && options.dynamicRange >= 0
    ? options.dynamicRange
    : 10.0;
  const gltfLightStrength = clampNumber(
    options.gltfLightStrength,
    0.0,
    dynamicRange,
    1.0,
  );
  const lightDirection = Array.isArray(options.lightDirection)
    ? normalize([
      options.lightDirection[0] ?? 0.5,
      options.lightDirection[1] ?? 1.0,
      options.lightDirection[2] ?? 0.5,
    ])
    : normalize([0.5, 1.0, 0.5]);
  const uniformBuffer = device.createBuffer({
    size: GLOBAL_UNIFORM_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const edgeUniformBuffer = device.createBuffer({
    size: GLOBAL_UNIFORM_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformData = new Float32Array(GLOBAL_UNIFORM_FLOAT_COUNT);
  const edgeUniformData = new Float32Array(GLOBAL_UNIFORM_FLOAT_COUNT);
  const shadowSplits = [250, 500, 750, 1000];

  uniformData.set([...lightDirection, 0.0], GLOBAL_UNIFORM_OFFSETS.lightingParams);
  uniformData.set(lightColor, GLOBAL_UNIFORM_OFFSETS.lightColor);
  uniformData.set([shadowEdgeSize, shadowEdgeOpacity, shadowBias, shadowStrength], GLOBAL_UNIFORM_OFFSETS.shadowParams);
  uniformData.set([SHADOW_CASCADE_COUNT, shadowMapSize, boneThickness, 0.0], GLOBAL_UNIFORM_OFFSETS.shadowInfo);
  uniformData.set(shadowSplits, GLOBAL_UNIFORM_OFFSETS.shadowSplits);
  uniformData.set([0, 0, 0, 1], GLOBAL_UNIFORM_OFFSETS.edgeColor);
  uniformData.set([shadowPower, dynamicRange, gridThickness, 0.0], GLOBAL_UNIFORM_OFFSETS.shadowPowerParams);
  edgeUniformData.set(uniformData);
  edgeUniformData[GLOBAL_UNIFORM_OFFSETS.lightingParams + 3] = 1.0;

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    // MMD の diffuse UV は 0..1 を超えてタイルされることがあるため repeat にする。
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });
  const toonSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const shadowSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    compare: 'less-equal',
  });
  const environmentSampler = createHdrEnvironmentSampler(device);
  const environmentTexture = createBlackHdrEnvironmentTexture(device);
  const environmentTextureView = environmentTexture.createView();
  const prepassDepthTexture = device.createTexture({
    size: [1, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const prepassNormalTexture = device.createTexture({
    size: [1, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const contactShadowMaskTexture = device.createTexture({
    size: [1, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const ambientOcclusionMaskTexture = device.createTexture({
    size: [1, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const contactShadowSettingsBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const ambientOcclusionSettingsBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: prepassDepthTexture },
    new Float32Array([0.0, 0.0, 0.0, 1.0]),
    { bytesPerRow: 16 },
    [1, 1],
  );
  device.queue.writeTexture(
    { texture: prepassNormalTexture },
    new Uint16Array([14336, 14336, 15360, 15360]),
    { bytesPerRow: 8 },
    [1, 1],
  );
  device.queue.writeTexture(
    { texture: contactShadowMaskTexture },
    new Float32Array([1.0, 1.0, 1.0, 0.0]),
    { bytesPerRow: 16 },
    [1, 1],
  );
  device.queue.writeTexture(
    { texture: ambientOcclusionMaskTexture },
    new Float32Array([1.0, 1.0, 1.0, 0.0]),
    { bytesPerRow: 16 },
    [1, 1],
  );
  device.queue.writeBuffer(contactShadowSettingsBuffer, 0, new Float32Array(16));
  device.queue.writeBuffer(ambientOcclusionSettingsBuffer, 0, new Float32Array(12));
  const prepassDepthView = prepassDepthTexture.createView();
  const prepassNormalView = prepassNormalTexture.createView();
  const contactShadowMaskView = contactShadowMaskTexture.createView();
  const ambientOcclusionMaskView = ambientOcclusionMaskTexture.createView();
  const globalBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 13, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const shadowBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const shadowGlobalBindGroup = device.createBindGroup({
    layout: shadowBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
    ],
  });

  const matBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const resources = {
    edgeUniformBuffer,
    edgeUniformData,
    environmentIntensity: 1.0,
    environmentLoaded: false,
    environmentMaxMipLevel: 0.0,
    environmentMipLevelCount: 1,
    environmentSampler,
    environmentTexture,
    environmentTextureView,
    gltfLightStrength,
    gridThickness,
    fallbackPrepassDepthView: prepassDepthView,
    prepassDepthTexture,
    prepassDepthView,
    fallbackPrepassNormalView: prepassNormalView,
    prepassNormalTexture,
    prepassNormalView,
    fallbackContactShadowMaskView: contactShadowMaskView,
    contactShadowMaskTexture,
    contactShadowMaskView,
    contactShadowSettingsBuffer,
    fallbackAmbientOcclusionMaskView: ambientOcclusionMaskView,
    ambientOcclusionMaskTexture,
    ambientOcclusionMaskView,
    ambientOcclusionSettingsBuffer,
    shadowGlobalBindGroup,
    shadowBindGroupLayout,
    globalBindGroupLayout,
    matBindGroupLayout,
    internalToonTextureCache: new Map(),
    sampler,
    toonSampler,
    shadowSampler,
    uniformBuffer,
    uniformData,
    dynamicRange,
    shadowMapSize,
    shadowCascadeCount: SHADOW_CASCADE_COUNT,
  };
  resources.uniformData.set([0.0, 1.0, gltfLightStrength, 0.0], GLOBAL_UNIFORM_OFFSETS.environmentParams);
  resources.edgeUniformData.set([0.0, 1.0, gltfLightStrength, 0.0], GLOBAL_UNIFORM_OFFSETS.environmentParams);
  rebuildShadowResources(device, resources, shadowMapSize);
  return resources;
}

/**
 * 環境マップを差し替えます。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 * @param {object} environmentResources - HDR 環境マップ。
 */
export function updateEnvironmentResources(device, globalResources, environmentResources) {
  if (!globalResources || !environmentResources) {
    return;
  }

  if (globalResources.environmentTexture && globalResources.environmentTexture !== environmentResources.texture) {
    globalResources.environmentTexture.destroy();
  }

  globalResources.environmentTexture = environmentResources.texture;
  globalResources.environmentTextureView = environmentResources.textureView || environmentResources.texture.createView();
  globalResources.environmentSampler = environmentResources.sampler || globalResources.environmentSampler;
  globalResources.environmentMipLevelCount = Number.isFinite(environmentResources.mipLevelCount) ? environmentResources.mipLevelCount : 1;
  globalResources.environmentMaxMipLevel = Number.isFinite(environmentResources.maxMipLevel)
    ? environmentResources.maxMipLevel
    : Math.max(0, globalResources.environmentMipLevelCount - 1);
  globalResources.environmentIntensity = Number.isFinite(environmentResources.intensity)
    ? environmentResources.intensity
    : 1.0;
  globalResources.environmentLoaded = Boolean(environmentResources.loaded);

  writeEnvironmentParams(device, globalResources);
  rebuildGlobalBindGroups(device, globalResources);
}

/**
 * HDR 環境マップの明るさだけを更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 * @param {number} intensity - 明るさ。
 */
export function updateEnvironmentIntensity(device, globalResources, intensity) {
  if (!globalResources) {
    return;
  }

  globalResources.environmentIntensity = Number.isFinite(intensity) ? intensity : globalResources.environmentIntensity;
  writeEnvironmentParams(device, globalResources);
}

/**
 * 環境テクスチャ用 uniform を書き込みます。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 */
function writeEnvironmentParams(device, globalResources) {
  const dynamicRange = Number.isFinite(globalResources.dynamicRange) ? globalResources.dynamicRange : 10.0;
  const environmentParams = [
    globalResources.environmentMaxMipLevel,
    globalResources.environmentIntensity,
    clampNumber(globalResources.gltfLightStrength, 0.0, dynamicRange, 1.0),
    globalResources.environmentLoaded ? 1.0 : 0.0,
  ];
  globalResources.uniformData.set(environmentParams, GLOBAL_UNIFORM_OFFSETS.environmentParams);
  globalResources.edgeUniformData.set(environmentParams, GLOBAL_UNIFORM_OFFSETS.environmentParams);
  device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);
  device.queue.writeBuffer(globalResources.edgeUniformBuffer, 0, globalResources.edgeUniformData);
}

/**
 * グローバル bind group を再構築します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 */
export function rebuildGlobalBindGroups(device, globalResources) {
  globalResources.globalBindGroup = device.createBindGroup({
    layout: globalResources.globalBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: globalResources.uniformBuffer } },
      { binding: 1, resource: globalResources.sampler },
      { binding: 2, resource: globalResources.toonSampler },
      { binding: 3, resource: globalResources.sampler },
      { binding: 4, resource: globalResources.shadowDepthTextureView },
      { binding: 5, resource: globalResources.shadowSampler },
      { binding: 6, resource: globalResources.environmentTextureView },
      { binding: 7, resource: globalResources.environmentSampler },
      { binding: 8, resource: globalResources.prepassDepthView },
      { binding: 9, resource: globalResources.prepassNormalView },
      { binding: 10, resource: globalResources.contactShadowMaskView },
      { binding: 11, resource: { buffer: globalResources.contactShadowSettingsBuffer } },
      { binding: 12, resource: globalResources.ambientOcclusionMaskView },
      { binding: 13, resource: { buffer: globalResources.ambientOcclusionSettingsBuffer } },
    ],
  });
  globalResources.prepassGlobalBindGroup = device.createBindGroup({
    layout: globalResources.globalBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: globalResources.uniformBuffer } },
      { binding: 1, resource: globalResources.sampler },
      { binding: 2, resource: globalResources.toonSampler },
      { binding: 3, resource: globalResources.sampler },
      { binding: 4, resource: globalResources.shadowDepthTextureView },
      { binding: 5, resource: globalResources.shadowSampler },
      { binding: 6, resource: globalResources.environmentTextureView },
      { binding: 7, resource: globalResources.environmentSampler },
      { binding: 8, resource: globalResources.fallbackPrepassDepthView },
      { binding: 9, resource: globalResources.fallbackPrepassNormalView },
      { binding: 10, resource: globalResources.fallbackContactShadowMaskView },
      { binding: 11, resource: { buffer: globalResources.contactShadowSettingsBuffer } },
      { binding: 12, resource: globalResources.fallbackAmbientOcclusionMaskView },
      { binding: 13, resource: { buffer: globalResources.ambientOcclusionSettingsBuffer } },
    ],
  });
  globalResources.edgeBindGroup = device.createBindGroup({
    layout: globalResources.globalBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: globalResources.edgeUniformBuffer } },
      { binding: 1, resource: globalResources.sampler },
      { binding: 2, resource: globalResources.toonSampler },
      { binding: 3, resource: globalResources.sampler },
      { binding: 4, resource: globalResources.shadowDepthTextureView },
      { binding: 5, resource: globalResources.shadowSampler },
      { binding: 6, resource: globalResources.environmentTextureView },
      { binding: 7, resource: globalResources.environmentSampler },
      { binding: 8, resource: globalResources.prepassDepthView },
      { binding: 9, resource: globalResources.prepassNormalView },
      { binding: 10, resource: globalResources.contactShadowMaskView },
      { binding: 11, resource: { buffer: globalResources.contactShadowSettingsBuffer } },
      { binding: 12, resource: globalResources.ambientOcclusionMaskView },
      { binding: 13, resource: { buffer: globalResources.ambientOcclusionSettingsBuffer } },
    ],
  });
}

/**
 * bloom shadow 可視化用の白タイルオーバーレイパイプラインを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {GPUShaderModule} shaderModule - 共通シェーダーモジュール。
 * @param {GPUTextureFormat} outputFormat - 最終描画先のフォーマット。
 * @param {GPUBindGroupLayout} globalBindGroupLayout - グローバル bind group layout。
 * @returns {GPURenderPipeline} デバッグ描画パイプライン。
 */
export function createBloomShadowDebugPipeline(device, shaderModule, outputFormat, globalBindGroupLayout) {
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [globalBindGroupLayout],
    }),
    vertex: { module: shaderModule, entryPoint: 'vs_bloom_shadow_debug' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_bloom_shadow_debug',
      targets: [{
        format: outputFormat ?? LINEAR_COLOR_FORMAT,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    multisample: { count: 1 },
  });
}

/**
 * シャドウテクスチャと関連 bind group を再構築します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 * @param {number} shadowMapSize - シャドウマップ解像度。
 */
export function rebuildShadowResources(device, globalResources, shadowMapSize) {
  if (globalResources.shadowDepthTexture) {
    globalResources.shadowDepthTexture.destroy();
  }

  const shadowDepthTexture = device.createTexture({
    size: [shadowMapSize, shadowMapSize, globalResources.shadowCascadeCount],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowDepthTextureView = shadowDepthTexture.createView({ dimension: '2d-array' });
  const shadowLayerViews = Array.from(
    { length: globalResources.shadowCascadeCount },
    (_, layer) => shadowDepthTexture.createView({ baseArrayLayer: layer, arrayLayerCount: 1 }),
  );

  globalResources.shadowDepthTexture = shadowDepthTexture;
  globalResources.shadowDepthTextureView = shadowDepthTextureView;
  globalResources.shadowLayerViews = shadowLayerViews;
  globalResources.shadowMapSize = shadowMapSize;
  rebuildGlobalBindGroups(device, globalResources);
}

/**
 * Contact Shadow / Ambient Occlusion 用の sampled resource を更新します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} globalResources - グローバル GPU リソース。
 * @param {GPUTextureView} prepassDepthView - prepass depth ビュー。
 * @param {GPUTextureView} prepassNormalView - prepass normal ビュー。
 * @param {GPUTextureView} contactShadowMaskView - Contact Shadow mask ビュー。
 * @param {GPUBuffer} contactShadowSettingsBuffer - Contact Shadow uniform バッファ。
 * @param {GPUTextureView} [ambientOcclusionMaskView] - AO mask ビュー。
 * @param {GPUBuffer} [ambientOcclusionSettingsBuffer] - AO uniform バッファ。
 */
export function updateContactShadowResources(
  device,
  globalResources,
  prepassDepthView,
  prepassNormalView,
  contactShadowMaskView,
  contactShadowSettingsBuffer,
  ambientOcclusionMaskView,
  ambientOcclusionSettingsBuffer,
) {
  if (!globalResources) {
    return;
  }
  globalResources.prepassDepthView = prepassDepthView ?? globalResources.prepassDepthView;
  globalResources.prepassNormalView = prepassNormalView ?? globalResources.prepassNormalView;
  globalResources.contactShadowMaskView = contactShadowMaskView ?? globalResources.contactShadowMaskView;
  globalResources.contactShadowSettingsBuffer = contactShadowSettingsBuffer ?? globalResources.contactShadowSettingsBuffer;
  globalResources.ambientOcclusionMaskView = ambientOcclusionMaskView ?? globalResources.ambientOcclusionMaskView;
  globalResources.ambientOcclusionSettingsBuffer = ambientOcclusionSettingsBuffer ?? globalResources.ambientOcclusionSettingsBuffer;
  rebuildGlobalBindGroups(device, globalResources);
}
