import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelManager } from '../source/core/model/model-manager.js';

test('updateMaterialEmissiveTexture rewires the emissive bind group without recreating pipeline resources', async () => {
  const device = createMockDevice();
  const emptyTexture = createMockTexture('empty');
  const baseTexture = createMockTexture('base');
  const toonTexture = createMockTexture('toon');
  const sphereTexture = createMockTexture('sphere');
  const shadeMultiplyTexture = createMockTexture('shade');
  const oldEmissiveTexture = createMockTexture('old-emissive');
  const nextEmissiveTexture = createMockTexture('next-emissive');
  const internalToonTextureCache = new Map([
    ['toon-textures/toon01.bmp', {
      texture: nextEmissiveTexture,
      alphaMode: 'opaque',
      colorSpace: 'gamma-2.2',
      previewUrl: '',
    }],
  ]);
  const pipelineResources = {
    emptyTexture,
    textureCache: new Map(),
    materials: [{
      buffer: { label: 'material-buffer' },
      bindGroup: { desc: { entries: [{ binding: 4, resource: oldEmissiveTexture.createView() }] } },
      baseTexture,
      toonTexture,
      sphereTexture,
      emissiveTexture: oldEmissiveTexture,
      shadeMultiplyTexture,
      hasEmissiveTexture: true,
      emissiveSource: 'texture',
    }],
  };
  const instance = {
    modelPath: 'models/hero/',
    model: {
      materials: [{
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
      }],
    },
    morphController: {
      materialStates: [{
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
      }],
    },
    pipelineResources,
  };
  const updatedMaterialIndices = [];
  const manager = {
    device,
    globalResources: {
      matBindGroupLayout: { label: 'mat-layout' },
      internalToonTextureCache,
    },
    updateMaterialStateBuffers(targetInstance, materialIndices) {
      updatedMaterialIndices.push({ targetInstance, materialIndices });
    },
  };

  await ModelManager.prototype.updateMaterialEmissiveTexture.call(
    manager,
    instance,
    [0],
    { kind: 'internal', toonIndex: 0 },
  );

  assert.equal(instance.pipelineResources, pipelineResources);
  assert.deepEqual(instance.model.materials[0].emissiveTexture, { kind: 'internal', toonIndex: 0 });
  assert.deepEqual(instance.morphController.materialStates[0].emissiveTexture, { kind: 'internal', toonIndex: 0 });
  assert.equal(instance.model.materials[0].emissiveSource, 'texture');
  assert.equal(instance.morphController.materialStates[0].emissiveSource, 'texture');
  assert.equal(instance.pipelineResources.materials[0].hasEmissiveTexture, true);
  assert.equal(instance.pipelineResources.materials[0].emissiveTexture, nextEmissiveTexture);
  assert.equal(instance.pipelineResources.materials[0].bindGroup.desc.entries[4].resource.texture, nextEmissiveTexture);
  assert.equal(device.createBindGroupCalls.length, 1);
  assert.deepEqual(updatedMaterialIndices, [{ targetInstance: instance, materialIndices: [0] }]);
});

/**
 * 材質更新テスト用のモック device を作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice() {
  const createBindGroupCalls = [];
  return {
    createBindGroupCalls,
    createBindGroup(desc) {
      createBindGroupCalls.push(desc);
      return { desc };
    },
  };
}

/**
 * モック texture を作成します。
 * @param {string} label - 識別子。
 * @returns {object} GPUTexture 互換オブジェクト。
 */
function createMockTexture(label) {
  return {
    label,
    createView() {
      return { texture: this };
    },
  };
}
