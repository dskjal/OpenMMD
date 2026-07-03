import assert from 'node:assert/strict';
import test from 'node:test';
import { createMaterialPanelService } from '../source/application/material/material-panel-service.js';

test('material panel service exposes VRM shade texture labeling and shade color state', () => {
  const instance = {
    modelPath: 'models/hero.vrm',
    model: {
      magic: 'Vrm',
      materials: [
        {
          name: 'Face',
          shaderName: 'mtoon-shader.wgsl',
          diffuse: [1, 1, 1, 1],
          roughness: 0.5,
          metalic: 0.2,
          emissive: [0.1, 0.2, 0.3],
          emissiveStrength: 1.5,
          emissiveSource: 'texture',
          mtoon: {
            shadeColor: [0.4, 0.5, 0.6],
          },
          shadeMultiplyTexture: { kind: 'path', path: 'textures/shade.png' },
        },
      ],
    },
    selectedMaterialIndices: [0],
    materialVisibility: [true],
    ssssMaterialVisibility: [true],
    materialCastShadow: [true],
    morphController: {
      materialStates: [
        {
          mtoon: {},
        },
      ],
    },
    pipelineResources: {
      materials: [{}],
    },
  };
  const service = createMaterialPanelService({
    getActiveInstance: () => instance,
    getActiveInstanceIndex: () => 0,
    getInstances: () => [instance],
    getLangData: () => ({}),
    getDefaultsSnapshot: () => ({
      visible: true,
      ssss: false,
      receiveShadow: true,
      castShadow: true,
      noCull: false,
      hasEdge: false,
      metalic: 0,
      roughness: 1,
      emissiveSource: 'color',
      emissive: [0, 0, 0, 1],
      emissiveStrength: 0,
    }),
    shaderManager: {
      getShaderDefinitions: () => [{ name: 'mtoon-shader.wgsl', label: 'MToon' }],
      getDefaultShaderNameForModel: () => 'mtoon-shader.wgsl',
    },
    modelManager: {},
  });

  const state = service.getPanelState();
  assert.equal(state.textureRowLabel, 'Shade Multiply Texture');
  assert.deepEqual(state.colorStates.shade.value.slice(0, 3), [0.4, 0.5, 0.6]);
  assert.equal(state.emissiveSourceState.value, 'texture');
  assert.equal(state.emissiveTextureState.disabled, false);
});

test('material panel service does not fall back to a raw emissive path for previews', () => {
  const instance = {
    modelPath: 'models/hero/',
    model: {
      magic: 'Pmx',
      materials: [
        {
          name: 'Glow',
          emissiveSource: 'texture',
          emissiveTexture: { kind: 'path', path: 'textures/glow.tga', colorSpace: 'gamma-2.2' },
          emissive: [0.2, 0.4, 0.6],
          emissiveStrength: 1,
        },
      ],
    },
    selectedMaterialIndices: [0],
    materialVisibility: [true],
    ssssMaterialVisibility: [true],
    materialCastShadow: [true],
    morphController: {
      materialStates: [
        {
          emissiveSource: 'texture',
          emissiveTexture: { kind: 'path', path: 'textures/glow.tga', colorSpace: 'gamma-2.2' },
        },
      ],
    },
    pipelineResources: {
      textureCandidates: [
        {
          label: 'glow.tga',
          modelName: 'Glow Model',
          modelPath: 'models/hero/',
          textureIndex: 0,
          texturePath: 'models/hero/textures/glow.tga',
          textureColorSpace: 'gamma-2.2',
          previewUrl: '',
          textureReference: { kind: 'path', path: 'textures/glow.tga', colorSpace: 'gamma-2.2' },
          toonTexture: { kind: 'path', path: 'textures/glow.tga', colorSpace: 'gamma-2.2' },
        },
      ],
    },
  };
  const service = createMaterialPanelService({
    getActiveInstance: () => instance,
    getActiveInstanceIndex: () => 0,
    getInstances: () => [instance],
    getLangData: () => ({}),
    getDefaultsSnapshot: () => ({ emissive: [0, 0, 0, 1] }),
    shaderManager: {
      getShaderDefinitions: () => [],
      getDefaultShaderNameForModel: () => 'mmd-shader.wgsl',
    },
    modelManager: {},
  });

  assert.equal(service.openTexturePicker('emissive'), true);
  const state = service.getPanelState();
  assert.equal(state.emissiveTextureState.previewSource, '');
  assert.equal(state.emissiveTextureState.description, 'glow.tga');
  assert.equal(state.pickerState.groups[0].items[0].previewSource, '');
});

test('material panel service keeps model material and morph material state in sync', () => {
  const instance = {
    model: {
      magic: 'Pmx',
      materials: [
        {
          emissiveSource: 'color',
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          mtoon: {},
        },
      ],
    },
    selectedMaterialIndices: [0],
    materialVisibility: [true],
    ssssMaterialVisibility: [true],
    materialCastShadow: [true],
    morphController: {
      dirty: false,
      materialStates: [
        {
          emissiveSource: 'color',
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          mtoon: {},
        },
      ],
    },
  };
  const updatedBuffers = [];
  const service = createMaterialPanelService({
    getActiveInstance: () => instance,
    getActiveInstanceIndex: () => 0,
    getInstances: () => [instance],
    getLangData: () => ({}),
    getDefaultsSnapshot: () => ({ emissive: [0, 0, 0, 1] }),
    shaderManager: {
      getShaderDefinitions: () => [],
      getDefaultShaderNameForModel: () => 'mmd-shader.wgsl',
    },
    modelManager: {
      updateMaterialStateBuffers: (...args) => updatedBuffers.push(args),
    },
  });

  service.applyEmissiveSource('texture');
  service.applyNumeric('emissiveStrength', 2.25);
  service.applyColor('emissive', [0.2, 0.4, 0.6, 1]);
  service.applyColor('shade', [0.7, 0.8, 0.9, 1]);

  assert.equal(instance.model.materials[0].emissiveSource, 'texture');
  assert.equal(instance.morphController.materialStates[0].emissiveSource, 'texture');
  assert.equal(instance.model.materials[0].emissiveStrength, 2.25);
  assert.equal(instance.morphController.materialStates[0].emissiveStrength, 2.25);
  assert.deepEqual(instance.model.materials[0].emissive, [0.2, 0.4, 0.6]);
  assert.deepEqual(instance.morphController.materialStates[0].emissive, [0.2, 0.4, 0.6]);
  assert.deepEqual(instance.model.materials[0].mtoon.shadeColor, [0.7, 0.8, 0.9]);
  assert.deepEqual(instance.morphController.materialStates[0].mtoon.shadeColor, [0.7, 0.8, 0.9]);
  assert.equal(instance.morphController.dirty, true);
  assert.equal(updatedBuffers.length >= 3, true);
});
