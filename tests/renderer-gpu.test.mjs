import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  createBloomColorDebugResources,
  createBloomShadowDebugResources,
  createBloomShadowDebugPipeline,
  createBloomResources,
  createFxaaBindGroup,
  createFxaaResources,
  createGammaResources,
  createGlobalResources,
  createPostEffectGlobalResources,
  createSsssResources,
  createUiOverlayCompositeResources,
  GLOBAL_UNIFORM_OFFSETS,
  updateEnvironmentIntensity,
  updateEnvironmentResources,
} from '../source/infrastructure/gpu/renderer-gpu.js';

globalThis.GPUBufferUsage ??= {
  UNIFORM: 1,
  COPY_DST: 2,
};

globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
};

globalThis.GPUShaderStage ??= {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};

test('createGlobalResources exposes HDR environment bindings in the global bind group', () => {
  const device = createMockDevice();
  const resources = createGlobalResources(device, { gltfLightStrength: 20.0, dynamicRange: 16.0 });

  assert.equal(resources.globalBindGroupLayout.entries.length, 14);
  assert.equal(resources.globalBindGroup.entries.length, 14);
  assert.equal(resources.globalBindGroup.entries[6].binding, 6);
  assert.equal(resources.globalBindGroup.entries[7].binding, 7);
  assert.equal(resources.environmentLoaded, false);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 0], 0);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 1], 1);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 2], 16.0);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.shadowPowerParams + 0], 1);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.shadowPowerParams + 1], 16.0);
});

test('updateEnvironmentResources replaces the placeholder HDR environment binding', () => {
  const device = createMockDevice();
  const resources = createGlobalResources(device);
  const environmentTexture = device.createTexture({
    size: [4, 2],
    mipLevelCount: 3,
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const environmentResources = {
    texture: environmentTexture,
    textureView: environmentTexture.createView(),
    sampler: device.createSampler(),
    intensity: 2.0,
    loaded: true,
    mipLevelCount: 3,
    maxMipLevel: 2,
  };

  updateEnvironmentResources(device, resources, environmentResources);

  assert.equal(resources.environmentLoaded, true);
  assert.equal(resources.environmentMaxMipLevel, 2);
  assert.equal(resources.environmentIntensity, 2.0);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 2], 1);
  assert.equal(resources.globalBindGroup.entries[6].resource.texture, environmentTexture);
  assert.equal(resources.globalBindGroup.entries[7].resource, resources.environmentSampler);
});

test('updateEnvironmentIntensity updates the HDR brightness without replacing the texture', () => {
  const device = createMockDevice();
  const resources = createGlobalResources(device, { dynamicRange: 4.5, gltfLightStrength: 9.0 });
  const environmentTexture = device.createTexture({
    size: [4, 2],
    mipLevelCount: 3,
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const environmentResources = {
    texture: environmentTexture,
    textureView: environmentTexture.createView(),
    sampler: device.createSampler(),
    intensity: 1.0,
    loaded: true,
    mipLevelCount: 3,
    maxMipLevel: 2,
  };

  updateEnvironmentResources(device, resources, environmentResources);
  resources.gltfLightStrength = 9.0;
  updateEnvironmentIntensity(device, resources, 3.5);

  assert.equal(resources.environmentIntensity, 3.5);
  assert.equal(resources.uniformData[GLOBAL_UNIFORM_OFFSETS.environmentParams + 2], 4.5);
  assert.equal(resources.globalBindGroup.entries[6].resource.texture, environmentTexture);
});

test('createGammaResources builds and caches ACES LUTs per display color space', () => {
  const device = createMockDevice();
  const shaderModule = { label: 'gamma' };
  const globalResources = createGlobalResources(device);
  const postEffectGlobalResources = createPostEffectGlobalResources(device, globalResources);
  const gammaResources = createGammaResources(
    device,
    shaderModule,
    'bgra8unorm',
    device.createSampler(),
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    {
      gamma: 1.0,
      colorTemperature: 6500,
      chromaticAberration: 0.0,
      viewTransform: 'standard',
      displayColorSpace: 'srgb',
    },
  );

  const initialTextureCount = device.textures.length;
  gammaResources.setDisplayTransformModes('aces-2.0', 'srgb');
  const srgbBindGroup = gammaResources.createGammaBindGroup(device, { texture: { label: 'scene' } });
  gammaResources.setDisplayTransformModes('aces-2.0', 'display-p3');
  const p3BindGroup = gammaResources.createGammaBindGroup(device, { texture: { label: 'scene' } });
  gammaResources.setDisplayTransformModes('aces-2.0', 'srgb');

  assert.equal(initialTextureCount >= 1, true);
  assert.equal(device.textures.length, initialTextureCount + 2);
  assert.equal(gammaResources.acesLutCache.size, 2);
  assert.equal(srgbBindGroup.entries.length, 5);
  assert.equal(p3BindGroup.entries.length, 5);
  assert.notEqual(srgbBindGroup.entries[3].resource.texture, p3BindGroup.entries[3].resource.texture);
  assert.equal(gammaResources.gammaSettingsData[8], 1);
  assert.equal(gammaResources.gammaSettingsData[9], 0);
  assert.equal(postEffectGlobalResources.postEffectGlobalBindGroup.entries.length, 1);
  assert.equal(
    postEffectGlobalResources.postEffectGlobalBindGroup.entries[0].resource.buffer,
    globalResources.uniformBuffer,
  );
  assert.equal(gammaResources.gammaPipeline.getBindGroupLayout(3), postEffectGlobalResources.postEffectGlobalBindGroupLayout);
});

test('createUiOverlayCompositeResources targets the final presentation format', () => {
  const descriptors = [];
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      descriptors.push(descriptor);
      return {
        getBindGroupLayout(index) {
          return descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const resources = createUiOverlayCompositeResources(
    device,
    { label: 'ui-overlay' },
    'bgra8unorm',
  );

  assert.ok(resources.uiOverlayCompositePipeline);
  assert.equal(descriptors[0].fragment.targets[0].format, 'bgra8unorm');
  assert.deepEqual(descriptors[0].fragment.targets[0].blend, {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  });
});

test('createFxaaResources builds a single-sampled fullscreen FXAA pipeline', () => {
  const descriptors = [];
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      descriptors.push(descriptor);
      return {
        layout: descriptor.layout,
        fragment: descriptor.fragment,
        multisample: descriptor.multisample,
        getBindGroupLayout(index) {
          return descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const globalResources = createGlobalResources(device);
  const postEffectGlobalResources = createPostEffectGlobalResources(device, globalResources);
  const resources = createFxaaResources(
    device,
    { label: 'fxaa' },
    'rgba16float',
    {
      getPostProcessInputView() {
        return { name: 'defaultSceneView' };
      },
    },
    device.createSampler(),
    device.createBuffer({ size: 48 }),
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
  );

  assert.ok(resources.fxaaPipeline);
  assert.equal(descriptors[0].vertex.entryPoint, 'vs_fullscreen');
  assert.equal(descriptors[0].fragment.entryPoint, 'fs_fxaa');
  assert.equal(descriptors[0].fragment.targets.length, 1);
  assert.equal(descriptors[0].fragment.targets[0].format, 'rgba16float');
  assert.equal(descriptors[0].multisample.count, 1);
});

test('createFxaaBindGroup prefers the provided source view', () => {
  const device = createMockDevice();
  const bindGroup = createFxaaBindGroup(
    device,
    {
      getBindGroupLayout() {
        return { name: 'fxaaLayout' };
      },
    },
    {
      getPostProcessInputView() {
        return { name: 'defaultSceneView' };
      },
    },
    { name: 'fxaaSampler' },
    { name: 'gammaSettingsBuffer' },
    { name: 'fxaaSourceView' },
  );

  assert.deepEqual(bindGroup.entries, [
    { binding: 0, resource: { buffer: { name: 'gammaSettingsBuffer' } } },
    { binding: 1, resource: { name: 'fxaaSourceView' } },
    { binding: 2, resource: { name: 'fxaaSampler' } },
  ]);
});

test('fxaa shader samples from builtin position instead of interpolated uv', async () => {
  const shaderSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/post-effect/fxaa.wgsl', import.meta.url), 'utf8');

  assert.doesNotMatch(shaderSource, /@location\(0\)\s+uv:\s+vec2<f32>/);
  assert.match(shaderSource, /fn fs_fxaa\(@builtin\(position\) pos: vec4<f32>\)/);
  assert.match(shaderSource, /let uv = clamp\(pos\.xy \/ res, vec2<f32>\(0\.0\), vec2<f32>\(1\.0\)\);/);
});

test('createBloomResources builds multi-scale bloom pipelines', () => {
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      return {
        layout: descriptor.layout,
        fragment: descriptor.fragment,
        getBindGroupLayout(index) {
          return descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const globalResources = createGlobalResources(device);
  const postEffectGlobalResources = createPostEffectGlobalResources(device, globalResources);
  const bloomResources = createBloomResources(
    device,
    { label: 'bloom' },
    'rgba16float',
    device.createSampler(),
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
    {
      bloomThreshold: 0.98,
      bloomBlurAmount: 2.0,
      bloomAlpha: 1.0,
      dynamicRange: 12.5,
      bloomShadowMultiplier: 0.35,
    },
  );

  assert.ok(bloomResources.bloomExtractPipeline);
  assert.ok(bloomResources.bloomDownsamplePipeline);
  assert.ok(bloomResources.bloomUpsamplePipeline);
  assert.ok(bloomResources.bloomCompositePipeline);
  assert.equal(bloomResources.bloomSettingsData.length, 8);
  assert.equal(bloomResources.bloomSettingsData[3], 12.5);
  assert.ok(Math.abs(bloomResources.bloomSettingsData[4] - 0.35) < 1e-6);
  assert.equal(bloomResources.bloomPassParamsData.length, 4);
  assert.equal(bloomResources.bloomOutputSizeData.length, 2);
  assert.equal(bloomResources.bloomExtractPipeline.getBindGroupLayout(0).entries.length, 6);
  assert.equal(bloomResources.bloomCompositePipeline.getBindGroupLayout(1).entries.length, 7);
  assert.equal(bloomResources.bloomExtractPipeline.getBindGroupLayout(0).entries[3].texture.sampleType, 'float');
  assert.equal(bloomResources.bloomExtractPipeline.getBindGroupLayout(0).entries[4].texture.sampleType, 'unfilterable-float');
  assert.equal(bloomResources.bloomCompositePipeline.getBindGroupLayout(1).entries[3].texture.sampleType, 'float');
  assert.equal(bloomResources.bloomCompositePipeline.getBindGroupLayout(1).entries[4].texture.sampleType, 'float');
  assert.equal(bloomResources.bloomCompositePipeline.getBindGroupLayout(1).entries[5].texture.sampleType, 'unfilterable-float');
  assert.equal(
    bloomResources.bloomCompositePipeline.getBindGroupLayout(3),
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
  );
});

test('createBloomShadowDebugPipeline builds a grayscale overlay pipeline on the shared shader module path', () => {
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      return {
        layout: descriptor.layout,
        fragment: descriptor.fragment,
        getBindGroupLayout(index) {
          return descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const globalResources = createGlobalResources(device);
  const bloomShadowDebugPipeline = createBloomShadowDebugPipeline(
    device,
    { label: 'shared' },
    'rgba16float',
    globalResources.globalBindGroupLayout,
  );

  assert.ok(bloomShadowDebugPipeline);
  assert.equal(bloomShadowDebugPipeline.getBindGroupLayout(0), globalResources.globalBindGroupLayout);
  assert.deepEqual(bloomShadowDebugPipeline.fragment.targets[0].blend, {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  });
});

test('createBloomShadowDebugResources builds a mask overlay pipeline', () => {
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      return {
        layout: descriptor.layout,
        fragment: descriptor.fragment,
        getBindGroupLayout(index) {
          return descriptor.layout === 'auto'
            ? { entries: [{ binding: 0 }] }
            : descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const bloomShadowDebugResources = createBloomShadowDebugResources(
    device,
    { label: 'bloom' },
    'rgba16float',
    device.createSampler(),
  );

  assert.ok(bloomShadowDebugResources.bloomShadowDebugPipeline);
  assert.equal(bloomShadowDebugResources.bloomShadowDebugPipeline.layout, 'auto');
  assert.deepEqual(bloomShadowDebugResources.bloomShadowDebugPipeline.fragment.targets[0].blend, {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  });
});

test('createBloomColorDebugResources builds a color overlay pipeline', () => {
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      return {
        layout: descriptor.layout,
        fragment: descriptor.fragment,
        getBindGroupLayout(index) {
          return descriptor.layout === 'auto'
            ? { entries: [{ binding: 0 }, { binding: 1 }] }
            : descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const bloomColorDebugResources = createBloomColorDebugResources(
    device,
    { label: 'bloom' },
    'rgba16float',
    device.createSampler(),
  );

  assert.ok(bloomColorDebugResources.bloomColorDebugPipeline);
  assert.equal(bloomColorDebugResources.bloomColorDebugPipeline.layout, 'auto');
  assert.deepEqual(bloomColorDebugResources.bloomColorDebugPipeline.fragment.targets[0].blend, {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  });
});

test('createSsssResources keeps scene mask resolve targets at rgba32float', () => {
  const descriptors = [];
  const device = createMockDevice({
    createRenderPipeline(descriptor) {
      descriptors.push(descriptor);
      return {
        descriptor,
        getBindGroupLayout(index) {
          return descriptor.layout.bindGroupLayouts[index];
        },
      };
    },
  });
  const globalResources = createGlobalResources(device);
  const postEffectGlobalResources = createPostEffectGlobalResources(device, globalResources);

  const resources = createSsssResources(
    device,
    { label: 'sss' },
    { label: 'sss-mask' },
    'rgba16float',
    postEffectGlobalResources.postEffectGlobalBindGroupLayout,
  );

  assert.ok(resources.sssMaskResolvePipeline);
  assert.ok(resources.sssMaskFilterPipeline);
  assert.equal(
    descriptors.find((descriptor) => descriptor.fragment?.entryPoint === 'fs_sss_mask_resolve').fragment.targets[0].format,
    'rgba32float',
  );
  assert.equal(
    descriptors.find((descriptor) => descriptor.fragment?.entryPoint === 'fs_sss_mask_filter').fragment.targets[0].format,
    'rgba32float',
  );
});

/**
 * モック GPU デバイスを作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice(overrides = {}) {
  return {
    textures: [],
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    createTexture(desc) {
      const texture = {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
      this.textures.push(texture);
      return texture;
    },
    createSampler() {
      return { label: 'sampler' };
    },
    createPipelineLayout({ bindGroupLayouts }) {
      return { bindGroupLayouts };
    },
    createRenderPipeline({ layout, fragment }) {
      return {
        layout,
        fragment,
        getBindGroupLayout(index) {
          return layout.bindGroupLayouts[index];
        },
      };
    },
    createBindGroupLayout({ entries }) {
      return { entries };
    },
    createBindGroup({ layout, entries }) {
      return { layout, entries };
    },
    queue: {
      writeBuffer() {},
      writeTexture() {},
    },
    ...overrides,
  };
}
