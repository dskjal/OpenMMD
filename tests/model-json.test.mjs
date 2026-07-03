import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildModelSettingsJson,
  collectModelShaderSelectValues,
  loadModelSettingsFile,
  parseModelSettingsJsonText,
  validateModelSettingsData,
} from '../source/infrastructure/serialization/model-json.js';
import { resetDefaultsForTests } from '../source/infrastructure/config/defaults/defaults-manager.js';

function createMaterialState(overrides = {}) {
  return {
    diffuse: [1, 1, 1, 1],
    ambient: [0, 0, 0, 1],
    specular: [0, 0, 0],
    specularity: 0,
    metalic: 0,
    roughness: 0.5,
    emissive: [0, 0, 0],
    emissiveStrength: 0,
    emissiveSource: 'color',
    emissiveTexture: { kind: 'none' },
    edgeColor: [0, 0, 0, 1],
    edgeSize: 1,
    textureTint: [1, 1, 1, 1],
    environmentTint: [1, 1, 1, 1],
    toonTint: [1, 1, 1, 1],
    ...overrides,
  };
}

function createTestInstance() {
  const model = {
    name: '初音ミク',
    bones: [
      { name: 'センター', ikRotationLocks: { x: false, y: false, z: false } },
      { name: '右ひじ', ikRotationLocks: { x: true, y: false, z: true } },
      { name: '右ひじ', ikRotationLocks: { x: false, y: false, z: false } },
    ],
    materials: [
      {
        name: 'cloth',
        shaderName: 'mmd-shader.wgsl',
        diffuse: [1, 0, 0, 1],
        receiveShadow: true,
        noCull: false,
        hasEdge: false,
        toonTexture: { kind: 'internal', toonIndex: 0 },
        metalic: 0,
        roughness: 1,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0, 0, 0],
        emissiveStrength: 0,
      },
      {
        name: 'skin',
        shaderName: 'mmd-shader.wgsl',
        diffuse: [1, 0, 0, 1],
        receiveShadow: true,
        noCull: false,
        hasEdge: false,
        toonTexture: { kind: 'internal', toonIndex: 0 },
        metalic: 0,
        roughness: 1,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0, 0, 0],
        emissiveStrength: 0,
      },
      {
        name: '頭',
        shaderName: 'mmd-shader.wgsl',
        diffuse: [1, 0, 0, 1],
        receiveShadow: true,
        noCull: false,
        hasEdge: false,
        toonTexture: { kind: 'internal', toonIndex: 0 },
        metalic: 0,
        roughness: 1,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0, 0, 0],
        emissiveStrength: 0,
      },
    ],
  };

  return {
    model,
    scene: {},
    fileProvider: null,
    modelPath: '',
    materialVisibility: [true, true, true],
    ssssMaterialVisibility: [true, true, true],
    materialCastShadow: [true, true, true],
    morphController: {
      dirty: false,
      materialStates: [
        createMaterialState(),
        createMaterialState(),
        createMaterialState(),
      ],
    },
    pipelineResources: {
      materials: [
        { noCull: false, hasEdge: false },
        { noCull: false, hasEdge: false },
        { noCull: false, hasEdge: false },
      ],
    },
  };
}

test('buildModelSettingsJson matches the canonical sample model JSON format', async () => {
  const instance = createTestInstance();
  const sampleText = await readFile(new URL('../test-data/model.json', import.meta.url), 'utf8');
  const expected = JSON.parse(sampleText);
  const actual = buildModelSettingsJson(instance);

  assert.deepEqual(actual, expected);
});

test('validateModelSettingsData rejects legacy keys and non-canonical shapes', () => {
  assert.throws(() => validateModelSettingsData(parseModelSettingsJsonText(JSON.stringify({
    type: 'model',
    'model-name': '初音ミク',
    material: {},
  }))));
  assert.throws(() => validateModelSettingsData(parseModelSettingsJsonText(JSON.stringify({
    type: 'model',
    targetModel: { name: '初音ミク' },
    materials: [
      {
        name: 'cloth',
        'material-visible': 1,
      },
    ],
  }))));
  assert.throws(() => validateModelSettingsData(parseModelSettingsJsonText(JSON.stringify({
    type: 'model',
    targetModel: { name: '初音ミク' },
    materials: [
      {
        name: 'cloth',
        diffuse: [255, 0, 0],
      },
    ],
  }))));
});

test('collectModelShaderSelectValues returns canonical shader names', () => {
  const values = collectModelShaderSelectValues({
    type: 'model',
    targetModel: { name: '初音ミク' },
    materials: [
      { name: 'cloth', shader: 'mmd-shader.wgsl' },
      { name: 'skin', shader: 'mmd-shader.wgsl' },
      { name: 'face', shader: 'custom-outline.wgsl' },
    ],
  });

  assert.deepEqual(values, ['mmd-shader.wgsl', 'custom-outline.wgsl']);
});

test('loadModelSettingsFile applies canonical material and bone settings to the named model', async () => {
  const instance = createTestInstance();
  const payload = {
    type: 'model',
    targetModel: { name: '初音ミク' },
    bones: [
      {
        name: '右ひじ',
        ikRotationLocks: {
          x: false,
          y: true,
        },
      },
      {
        name: '右ひじ',
        ikRotationLocks: {
          z: true,
        },
      },
    ],
    materials: [
      {
        name: 'cloth',
        shader: 'custom/mmd-shader-hdr-ao.wgsl',
        visibility: {
          visible: false,
          ssss: true,
          castShadow: false,
          receiveShadow: false,
        },
        raster: {
          noCull: true,
          hasEdge: true,
        },
        toonTexture: { kind: 'path', path: 'toon-textures/toon04.bmp', colorSpace: 'gamma-2.2' },
        diffuse: [64 / 255, 128 / 255, 1, 1],
        metallic: 0.25,
        roughness: 0.75,
        emissive: {
          source: 'texture',
          color: [32 / 255, 64 / 255, 96 / 255],
          strength: 1.5,
          texture: { kind: 'path', path: 'toon-textures/toon05.bmp', colorSpace: 'gamma-2.2' },
        },
      },
      {
        name: 'missing-material',
        visibility: {
          visible: true,
        },
      },
    ],
  };
  const rebuildCalls = [];
  const bufferCalls = [];

  const result = await loadModelSettingsFile({
    text: async () => JSON.stringify(payload),
  }, {
    modelManager: {
      instances: [instance],
    },
    rebuildMaterialPipelines: async (targetInstance) => {
      rebuildCalls.push(targetInstance.model.name);
    },
    updateMaterialStateBuffers: (targetInstance, indices) => {
      bufferCalls.push({ targetInstance, indices });
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.targetModelName, '初音ミク');
  assert.deepEqual(result.appliedMaterials, ['cloth']);
  assert.deepEqual(result.skippedMaterials, ['missing-material']);
  assert.deepEqual(result.appliedBones, ['右ひじ', '右ひじ']);
  assert.deepEqual(instance.model.bones[1].ikRotationLocks, { x: false, y: true, z: true });
  assert.deepEqual(instance.model.bones[2].ikRotationLocks, { x: false, y: false, z: true });
  assert.equal(instance.model.materials[0].shaderName, 'custom/mmd-shader-hdr-ao.wgsl');
  assert.equal(instance.materialVisibility[0], false);
  assert.equal(instance.ssssMaterialVisibility[0], true);
  assert.equal(instance.materialCastShadow[0], false);
  assert.equal(instance.model.materials[0].receiveShadow, false);
  assert.equal(instance.model.materials[0].noCull, true);
  assert.equal(instance.model.materials[0].hasEdge, true);
  assert.deepEqual(instance.model.materials[0].toonTexture, { kind: 'path', path: 'toon-textures/toon04.bmp', colorSpace: 'gamma-2.2' });
  assert.deepEqual(instance.model.materials[0].diffuse, [64 / 255, 128 / 255, 1, 1]);
  assert.equal(instance.model.materials[0].metalic, 0.25);
  assert.equal(instance.model.materials[0].roughness, 0.75);
  assert.equal(instance.model.materials[0].emissiveSource, 'texture');
  assert.deepEqual(instance.model.materials[0].emissiveTexture, { kind: 'path', path: 'toon-textures/toon05.bmp', colorSpace: 'gamma-2.2' });
  assert.deepEqual(instance.model.materials[0].emissive, [32 / 255, 64 / 255, 96 / 255]);
  assert.equal(instance.model.materials[0].emissiveStrength, 1.5);
  assert.equal(instance.morphController.materialStates[0].metalic, 0.25);
  assert.equal(instance.morphController.materialStates[0].roughness, 0.75);
  assert.equal(instance.morphController.materialStates[0].emissiveSource, 'texture');
  assert.deepEqual(instance.morphController.materialStates[0].emissiveTexture, { kind: 'path', path: 'toon-textures/toon05.bmp', colorSpace: 'gamma-2.2' });
  assert.deepEqual(instance.morphController.materialStates[0].emissive, [32 / 255, 64 / 255, 96 / 255]);
  assert.equal(instance.morphController.materialStates[0].emissiveStrength, 1.5);
  assert.equal(instance.morphController.dirty, true);
  assert.deepEqual(rebuildCalls, ['初音ミク']);
  assert.deepEqual(bufferCalls[0].indices, [0]);
});

test('loadModelSettingsFile fills omitted material fields from defaults', async () => {
  const instance = createTestInstance();
  instance.model.materials[0].metalic = 0.9;
  instance.model.materials[0].roughness = 0.1;
  instance.model.materials[0].emissive = [1, 1, 1];
  instance.model.materials[0].emissiveStrength = 2.0;
  instance.model.materials[0].emissiveSource = 'texture';
  instance.model.materials[0].emissiveTexture = { kind: 'path', path: 'old.bmp', colorSpace: 'gamma-2.2' };
  instance.materialVisibility[0] = true;
  instance.ssssMaterialVisibility[0] = true;
  instance.materialCastShadow[0] = false;
  const payload = {
    type: 'model',
    targetModel: { name: '初音ミク' },
    materials: [
      {
        name: 'cloth',
        visibility: {
          visible: false,
        },
      },
    ],
  };
  const defaultsText = await readFile(new URL('../source/infrastructure/config/defaults/defaults.json', import.meta.url), 'utf8');
  const parsedDefaults = JSON.parse(defaultsText);
  parsedDefaults.material.roughness = 0.33;
  const originalFetch = globalThis.fetch;
  try {
    resetDefaultsForTests();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => parsedDefaults,
    });

    const result = await loadModelSettingsFile({
      text: async () => JSON.stringify(payload),
    }, {
      modelManager: {
        instances: [instance],
      },
      rebuildMaterialPipelines: async () => {},
      updateMaterialStateBuffers: () => {},
    });

    assert.equal(result.applied, true);
    assert.equal(instance.materialVisibility[0], false);
    assert.equal(instance.ssssMaterialVisibility[0], false);
    assert.equal(instance.model.materials[0].receiveShadow, true);
    assert.equal(instance.materialCastShadow[0], true);
    assert.equal(instance.model.materials[0].noCull, false);
    assert.equal(instance.model.materials[0].hasEdge, false);
    assert.deepEqual(instance.model.materials[0].toonTexture, { kind: 'none' });
    assert.equal(instance.model.materials[0].metalic, 0);
    assert.equal(instance.model.materials[0].roughness, 0.33);
    assert.equal(instance.model.materials[0].emissiveSource, 'color');
    assert.deepEqual(instance.model.materials[0].emissiveTexture, { kind: 'none' });
    assert.deepEqual(instance.model.materials[0].emissive, [0, 0, 0]);
    assert.equal(instance.model.materials[0].emissiveStrength, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadModelSettingsFile fails when the target model does not exist', async () => {
  const instance = createTestInstance();
  const payload = {
    type: 'model',
    targetModel: { name: '存在しないモデル' },
    materials: [
      {
        name: 'cloth',
        visibility: {
          visible: false,
        },
      },
    ],
  };

  const result = await loadModelSettingsFile({
    text: async () => JSON.stringify(payload),
  }, {
    modelManager: {
      instances: [instance],
    },
    rebuildMaterialPipelines: async () => {
      throw new Error('should not rebuild');
    },
    updateMaterialStateBuffers: () => {
      throw new Error('should not update');
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.skippedReason, 'model-not-found');
  assert.equal(instance.materialVisibility[0], true);
});

test('loadModelSettingsFile applies bone IK rotation locks without rebuilding material resources', async () => {
  const instance = createTestInstance();
  const payload = {
    type: 'model',
    targetModel: { name: '初音ミク' },
    bones: [
      {
        name: '右ひじ',
        ikRotationLocks: {
          x: false,
          y: true,
        },
      },
      {
        name: '右ひじ',
        ikRotationLocks: {
          z: true,
        },
      },
    ],
  };
  let rebuildCount = 0;
  let bufferCount = 0;

  const result = await loadModelSettingsFile({
    text: async () => JSON.stringify(payload),
  }, {
    modelManager: {
      instances: [instance],
    },
    rebuildMaterialPipelines: async () => {
      rebuildCount += 1;
    },
    updateMaterialStateBuffers: () => {
      bufferCount += 1;
    },
  });

  assert.equal(result.applied, true);
  assert.deepEqual(instance.model.bones[1].ikRotationLocks, { x: false, y: true, z: true });
  assert.deepEqual(instance.model.bones[2].ikRotationLocks, { x: false, y: false, z: true });
  assert.equal(rebuildCount, 0);
  assert.equal(bufferCount, 0);
});
