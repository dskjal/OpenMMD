import { createMaterialResources } from './material-resources.js';

const LINEAR_COLOR_FORMAT = 'rgba16float';

/**
 * 描画用パイプラインリソースを作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @param {object} scene - シーン状態。
 * @param {object} model - モデルデータ。
 * @param {object|null} fileProvider - ファイルプロバイダー。
 * @param {string} modelPath - モデルパス。
 * @param {Map<string, object>|null} [textureCache=null] - 既存 texture cache。
 * @returns {Promise<object>} パイプラインリソース。
 */
export async function createPipelineResources(manager, scene, model, fileProvider, modelPath, textureCache = null) {
  console.log('Creating pipelines with MSAA sample count:', manager.msaaSampleCount);
  const boneBindGroup = manager.device.createBindGroup({
    layout: manager.boneBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: scene.boneMatricesBuffer } }],
  });
  const defaultShaderName = getDefaultShaderName(manager, model);
  ensureMaterialShaderNames(model, defaultShaderName);
  const materials = await createMaterialResources(
    manager.device,
    modelPath,
    model,
    manager.globalResources.matBindGroupLayout,
    fileProvider,
    manager.globalResources.internalToonTextureCache,
    model.textureColorSpaces,
    textureCache,
  );
  for (let i = 0; i < materials.materials.length; i++) {
    if (typeof materials.materials[i].shaderName !== 'string' || !materials.materials[i].shaderName) {
      materials.materials[i].shaderName = model.materials[i]?.shaderName || defaultShaderName;
    }
  }
  const defaultShaderModule = await loadShaderModuleForName(manager, defaultShaderName);

  const meshLayout = manager.device.createPipelineLayout({
    bindGroupLayouts: [
      manager.globalResources.globalBindGroupLayout,
      manager.globalResources.matBindGroupLayout,
      manager.boneBindGroupLayout,
    ],
  });
  const meshPipelineDescriptor = {
    layout: meshLayout,
    vertex: {
      module: defaultShaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 108,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32x4' },
            { shaderLocation: 4, offset: 48, format: 'float32x4' },
            { shaderLocation: 6, offset: 64, format: 'float32' },
            { shaderLocation: 7, offset: 68, format: 'float32x3' },
            { shaderLocation: 8, offset: 80, format: 'float32x3' },
            { shaderLocation: 9, offset: 92, format: 'float32x3' },
            { shaderLocation: 10, offset: 104, format: 'float32' },
          ],
        },
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x3' }],
        },
      ],
    },
    fragment: {
      module: defaultShaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format: LINEAR_COLOR_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
        { format: LINEAR_COLOR_FORMAT },
        {
          format: 'rgba16float',
        },
      ],
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
      format: 'depth24plus',
      depthBias: 2,
      depthBiasSlopeScale: 2.0,
      depthBiasClamp: 0.0,
    },
  };
  const depthPrepassPipelineDescriptor = {
    layout: meshLayout,
    vertex: {
      module: defaultShaderModule,
      entryPoint: 'vs_main',
      buffers: meshPipelineDescriptor.vertex.buffers,
    },
    fragment: {
      module: defaultShaderModule,
      entryPoint: 'fs_depth_prepass',
      targets: [
        {
          format: 'rgba16float',
        },
        {
          format: 'rgba16float',
        },
      ],
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
      format: 'depth24plus',
      depthBias: 2,
      depthBiasSlopeScale: 2.0,
      depthBiasClamp: 0.0,
    },
  };
  const shaderNames = collectShaderNames(materials.materials, defaultShaderName);
  const shaderPipelines = {};

  for (const shaderName of shaderNames) {
    const shaderModule = shaderName === defaultShaderName
      ? defaultShaderModule
      : await loadShaderModuleForName(manager, shaderName, defaultShaderModule);
    shaderPipelines[shaderName] = {
      msaa: createPipelineSet(manager, meshPipelineDescriptor, manager.msaaSampleCount, shaderModule),
      nonMsaa: createPipelineSet(manager, meshPipelineDescriptor, 1, shaderModule),
      depthPrepassMsaa: createDepthPrepassPipelineSet(manager, depthPrepassPipelineDescriptor, manager.msaaSampleCount, shaderModule),
      depthPrepassNonMsaa: createDepthPrepassPipelineSet(manager, depthPrepassPipelineDescriptor, 1, shaderModule),
    };
  }
  const defaultPipelineShaderName = shaderPipelines[defaultShaderName]
    ? defaultShaderName
    : shaderNames[0];
  if (defaultPipelineShaderName !== defaultShaderName) {
    // 既定シェーダが材料の shaderName から外れた場合でも、呼び出し側の既定参照を壊さないようにする。
    shaderPipelines[defaultShaderName] = shaderPipelines[defaultPipelineShaderName];
  }

  const shadowPipeline = manager.device.createRenderPipeline({
    layout: manager.device.createPipelineLayout({
      bindGroupLayouts: [
        manager.globalResources.shadowBindGroupLayout,
        manager.globalResources.matBindGroupLayout,
        manager.boneBindGroupLayout,
      ],
    }),
    vertex: {
      module: defaultShaderModule,
      entryPoint: 'vs_shadow',
      buffers: meshPipelineDescriptor.vertex.buffers,
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: 1 },
  });
  const depthPickPipeline = manager.device.createRenderPipeline({
    layout: manager.device.createPipelineLayout({
      bindGroupLayouts: [
        manager.globalResources.globalBindGroupLayout,
        manager.globalResources.matBindGroupLayout,
        manager.boneBindGroupLayout,
      ],
    }),
    vertex: {
      module: defaultShaderModule,
      entryPoint: 'vs_main',
      buffers: meshPipelineDescriptor.vertex.buffers,
    },
    fragment: {
      module: defaultShaderModule,
      entryPoint: 'fs_pick_world',
      targets: [{ format: 'rgba32float' }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
      format: 'depth32float',
    },
    multisample: { count: 1 },
  });

  return {
    boneBindGroup,
    materials: materials.materials,
    textureResources: materials.textureResources,
    textureCandidates: materials.textureCandidates || [],
    toonTextureCandidates: materials.toonTextureCandidates || [],
    textureCache: materials.textureCache,
    emptyTexture: materials.emptyTexture,
    shadowPipeline,
    depthPickPipeline,
    defaultShaderName,
    shaderPipelines,
    msaa: shaderPipelines[defaultShaderName].msaa,
    nonMsaa: shaderPipelines[defaultShaderName].nonMsaa,
  };
}

/**
 * サンプル数ごとのパイプライン集合を作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @param {object} meshPipelineDescriptor - ベースパイプライン定義。
 * @param {number} sampleCount - MSAA サンプル数。
 * @returns {object} パイプライン集合。
 */
function createPipelineSet(manager, meshPipelineDescriptor, sampleCount, shaderModule) {
  const pipelineDescriptor = {
    ...meshPipelineDescriptor,
    vertex: {
      ...meshPipelineDescriptor.vertex,
      module: shaderModule,
    },
    fragment: {
      ...meshPipelineDescriptor.fragment,
      module: shaderModule,
    },
  };
  const transparentPipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: sampleCount },
  });
  const opaqueNoCullPipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: sampleCount },
  });
  const transparentNoCullPipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: sampleCount },
  });
  const edgePipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'front' },
    depthStencil: { depthWriteEnabled: false, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: sampleCount },
  });
  const pipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less-equal', format: 'depth24plus' },
    multisample: { count: sampleCount },
  });
  return {
    transparentPipeline,
    opaqueNoCullPipeline,
    transparentNoCullPipeline,
    edgePipeline,
    pipeline,
  };
}

/**
 * 深度プリパス用のサンプル数ごとのパイプライン集合を作成します。
 * @param {object} manager - ModelManager インスタンス。
 * @param {object} depthPrepassPipelineDescriptor - ベースパイプライン定義。
 * @param {number} sampleCount - MSAA サンプル数。
 * @param {GPUShaderModule} shaderModule - シェーダーモジュール。
 * @returns {object} パイプライン集合。
 */
function createDepthPrepassPipelineSet(manager, depthPrepassPipelineDescriptor, sampleCount, shaderModule) {
  const pipelineDescriptor = {
    ...depthPrepassPipelineDescriptor,
    vertex: {
      ...depthPrepassPipelineDescriptor.vertex,
      module: shaderModule,
    },
    fragment: {
      ...depthPrepassPipelineDescriptor.fragment,
      module: shaderModule,
    },
  };

  const depthPrepassPipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    multisample: { count: sampleCount },
  });
  const depthPrepassNoCullPipeline = manager.device.createRenderPipeline({
    ...pipelineDescriptor,
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    multisample: { count: sampleCount },
  });

  return {
    depthPrepassPipeline,
    depthPrepassNoCullPipeline,
  };
}

/**
 * モデルの既定シェーダ名を返します。
 * @param {object} manager - ModelManager インスタンス。
 * @param {object} model - モデルデータ。
 * @returns {string} シェーダ名。
 */
function getDefaultShaderName(manager, model) {
  if (manager?.shaderManager && typeof manager.shaderManager.getDefaultShaderNameForModel === 'function') {
    return manager.shaderManager.getDefaultShaderNameForModel(model);
  }
  return 'mmd-shader.wgsl';
}

/**
 * マテリアルにシェーダ名を設定します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>} materials - GPU マテリアル群。
 * @param {string} defaultShaderName - 既定シェーダ名。
 */
function ensureMaterialShaderNames(model, defaultShaderName) {
  if (!Array.isArray(model?.materials)) {
    return;
  }

  for (let i = 0; i < model.materials.length; i++) {
    const material = model.materials[i];
    if (typeof material.shaderName !== 'string' || !material.shaderName) {
      material.shaderName = defaultShaderName;
    }
  }
}

/**
 * 使用中のシェーダ名を集約します。
 * @param {Array<object>} materials - GPU マテリアル群。
 * @param {string} defaultShaderName - 既定シェーダ名。
 * @returns {Array<string>} シェーダ名一覧。
 */
function collectShaderNames(materials, defaultShaderName) {
  const names = new Set();
  for (const material of materials) {
    names.add(typeof material.shaderName === 'string' && material.shaderName ? material.shaderName : defaultShaderName);
  }
  if (names.size === 0) {
    names.add(defaultShaderName);
  }
  return Array.from(names);
}

/**
 * シェーダモジュールを読み込みます。
 * @param {object} manager - ModelManager インスタンス。
 * @param {string} shaderName - シェーダ名。
 * @param {GPUShaderModule|null} [fallbackModule=null] - フォールバック。
 * @returns {Promise<GPUShaderModule>} シェーダモジュール。
 */
async function loadShaderModuleForName(manager, shaderName, fallbackModule = null) {
  if (manager?.shaderManager && typeof manager.shaderManager.getShaderModule === 'function') {
    const module = await manager.shaderManager.getShaderModule(shaderName);
    if (module) {
      return module;
    }
  }

  if (fallbackModule) {
    return fallbackModule;
  }

  if (manager?.shaderModule) {
    return manager.shaderModule;
  }

  throw new Error(`Shader module not available for '${shaderName}'.`);
}
