import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectModelTextureCandidates,
  collectTextureCandidates,
  collectToonTextureCandidates,
  createEmptyTexture,
  createMaterialResources,
  loadTexture,
  loadTextureFromPath,
  loadTextureFromReference,
} from '../source/infrastructure/gpu/material-resources.js';

globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
};
globalThis.GPUBufferUsage ??= {
  UNIFORM: 1,
  COPY_DST: 2,
};

test('createEmptyTexture uses an sRGB fallback texture', () => {
  const device = createMockDevice();

  const texture = createEmptyTexture(device);

  assert.equal(texture.desc.format, 'rgba8unorm-srgb');
});

test('loadTexture creates sRGB color textures for image sources', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });

  try {
    const texture = await loadTexture(
      device,
      './',
      { textures: ['albedo.png'] },
      0,
      new Map(),
      {
        async getFile() {
          return {};
        },
      },
    );

    assert.equal(texture?.desc.format, 'rgba8unorm-srgb');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('loadTextureFromPath skips zero-sized image bitmaps', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 0, height: 0 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const texture = await loadTextureFromPath(device, './albedo.png', null);
    assert.equal(texture, null);
    assert.equal(device.textures.length, 0);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('loadTextureFromPath uploads TGA pixels with writeTexture without createImageBitmap', async () => {
  const device = createMockDevice();
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalImageData = globalThis.ImageData;
  let createImageBitmapCalled = false;
  globalThis.ImageData = class ImageDataMock {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  globalThis.document = createDocumentMock(globalThis.ImageData);
  globalThis.createImageBitmap = async () => {
    createImageBitmapCalled = true;
    return { width: 1, height: 1 };
  };
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return new Blob([createMinimalTgaBytes()]);
    },
  });

  try {
    const texture = await loadTextureFromPath(device, './albedo.tga', null);
    assert.ok(texture);
    assert.equal(createImageBitmapCalled, false);
    assert.equal(device.writeTextures.length, 1);
    assert.equal(device.copyExternalImageCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    globalThis.ImageData = originalImageData;
  }
});

test('createMaterialResources falls back to the empty texture when a decoded image is zero-sized', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 0, height: 0 });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel(),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.textureResources[0], null);
    assert.equal(device.textures.length, 1);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('loadTextureFromReference resolves relative texture paths against the model path', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return {
      ok: true,
      async blob() {
        return {};
      },
    };
  };

  try {
    await loadTextureFromReference(
      device,
      'models/miku/',
      { kind: 'path', path: '3000/textures/hair02.png', colorSpace: 'gamma-2.2' },
      new Map(),
      null,
    );

    assert.equal(requestedUrls[0], 'models/miku/3000/textures/hair02.png');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources applies gamma 2.2 texture conversion by default', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });

  try {
    await createMaterialResources(
      device,
      './',
      createTextureModel(),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(device.textures[1].format, 'rgba8unorm-srgb');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('createMaterialResources can keep textures unconverted', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });

  try {
    await createMaterialResources(
      device,
      './',
      createTextureModel(),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['none'],
    );

    assert.equal(device.textures[1].format, 'rgba8unorm');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('createMaterialResources uses the default roughness when the model omits it', async () => {
  const writes = [];
  const device = createMockDevice((buffer, offset, data) => {
    writes.push({
      buffer,
      offset,
      data: Array.from(data),
    });
  });
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonMode: 0,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: undefined,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.ok(writes.length > 0);
    assert.equal(writes[0].data[18], 1);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources uses the MToon GI equalization default when omitted', async () => {
  const writes = [];
  const device = createMockDevice((buffer, offset, data) => {
    writes.push({
      buffer,
      offset,
      data: Array.from(data),
    });
  });
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonMode: 0,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
          mtoon: {
            enabled: true,
          },
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.ok(writes.length > 0);
    assert.equal(Number(writes[0].data[37].toFixed(3)), 0.9);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources marks toon textures as present when an explicit toon reference is used', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonTexture: { kind: 'internal', toonIndex: 0 },
          toonMode: 1,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.materials[0].hasToonTexture, true);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources clears toon presence when toon is explicitly disabled', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonTexture: { kind: 'none' },
          toonMode: 1,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.materials[0].hasToonTexture, false);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources does not infer toon textures for VRM materials without explicit toonTexture', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        magic: 'Vrm',
        materials: [{
          textureIndex: 0,
          toonMode: 1,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.materials[0].hasToonTexture, false);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources loads shadeMultiplyTexture separately from toonTexture', async () => {
  const writes = [];
  const device = createMockDevice((buffer, offset, data) => {
    writes.push({
      buffer,
      offset,
      data: Array.from(data),
    });
  });
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonTexture: { kind: 'none' },
          shadeMultiplyTexture: { kind: 'path', path: 'shade.png', colorSpace: 'gamma-2.2' },
          toonMode: 1,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
          mtoon: {
            enabled: true,
            hasShadeMultiplyTexture: true,
          },
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.materials[0].hasShadeMultiplyTexture, true);
    assert.equal(resources.materials[0].hasToonTexture, false);
    assert.equal(resources.materials[0].bindGroup.desc.entries.length, 6);
    assert.equal(writes.length > 0, true);
    assert.equal(writes[0].data[52], 1);
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources loads emissive texture when emissive source is texture', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        materials: [{
          textureIndex: 0,
          toonMode: 0,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissiveSource: 'texture',
          emissiveTexture: { kind: 'internal', toonIndex: 0 },
          emissive: [0, 0, 0],
          emissiveStrength: 2,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.materials[0].hasEmissiveTexture, true);
    assert.equal(resources.materials[0].emissiveSource, 'texture');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('createMaterialResources collects toon texture candidates at model load time', async () => {
  const device = createMockDevice();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  globalThis.createImageBitmap = async () => ({ width: 2, height: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    async blob() {
      return {};
    },
  });

  try {
    const resources = await createMaterialResources(
      device,
      './',
      createTextureModel({
        textures: ['toonA.bmp', 'albedo.png'],
        materials: [{
          textureIndex: 1,
          toonMode: 0,
          toonIndex: 0,
          sphereIndex: -1,
          sphereMode: 0,
          indexCount: 3,
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: true,
          hasEdge: false,
          metalic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          emissiveStrength: 0,
          alphaMode: 'opaque',
        }],
      }),
      { createBindGroup() { return {}; } },
      {
        async getFile() {
          return {};
        },
      },
      new Map(),
      ['gamma-2.2'],
    );

    assert.equal(resources.toonTextureCandidates[0].texturePath, 'toonA.bmp');
    assert.equal(resources.toonTextureCandidates[0].toonTexture.path, 'toonA.bmp');
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  }
});

test('collectModelTextureCandidates collects all texture paths from a model', () => {
  const candidates = collectModelTextureCandidates('models/active/', {
    name: 'Active Model',
    textures: ['models/active/albedo.png', 'models/active/normal.png'],
    textureColorSpaces: ['gamma-2.2', 'none'],
  }, [
    { previewUrl: 'data:image/png;base64,albedo' },
    { previewUrl: 'data:image/png;base64,normal' },
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].texturePath, 'models/active/albedo.png');
  assert.equal(candidates[0].previewUrl, 'data:image/png;base64,albedo');
  assert.equal(candidates[1].texturePath, 'models/active/normal.png');
  assert.equal(candidates[1].textureColorSpace, 'none');
});

test('collectToonTextureCandidates orders active model, other models, then defaults', () => {
  const candidates = collectToonTextureCandidates([
    {
      modelPath: 'models/active/',
      model: {
        name: 'Active Model',
        textures: ['models/active/shadeA.bmp', 'models/active/albedo.png'],
        textureColorSpaces: ['gamma-2.2', 'gamma-2.2'],
        materials: [
          {
            textureIndex: 1,
            toonMode: 0,
            toonIndex: 0,
          },
        ],
      },
      pipelineResources: {
        textureResources: [
          { previewUrl: 'data:image/png;base64,active-toon' },
          { previewUrl: 'data:image/png;base64,active-albedo' },
        ],
        toonTextureCandidates: [
          {
            label: 'shadeA.bmp',
            modelName: 'Active Model',
            modelPath: 'models/active/',
            textureIndex: 0,
            texturePath: 'models/active/shadeA.bmp',
            textureColorSpace: 'gamma-2.2',
            previewUrl: 'data:image/png;base64,active-toon',
            toonTexture: { kind: 'path', path: 'models/active/shadeA.bmp', colorSpace: 'gamma-2.2' },
          },
        ],
      },
    },
    {
      modelPath: 'models/other/',
      model: {
        name: 'Other Model',
        textures: ['models/other/shadeB.bmp'],
        textureColorSpaces: ['none'],
        materials: [
          {
            textureIndex: 0,
            toonMode: 0,
            toonIndex: 0,
          },
        ],
      },
      pipelineResources: {
        textureResources: [
          { previewUrl: 'data:image/png;base64,other-toon' },
        ],
        toonTextureCandidates: [
          {
            label: 'shadeB.bmp',
            modelName: 'Other Model',
            modelPath: 'models/other/',
            textureIndex: 0,
            texturePath: 'models/other/shadeB.bmp',
            textureColorSpace: 'none',
            previewUrl: 'data:image/png;base64,other-toon',
            toonTexture: { kind: 'path', path: 'models/other/shadeB.bmp', colorSpace: 'none' },
          },
        ],
      },
    },
  ], 0);

  assert.equal(candidates.activeModelCandidates[0].texturePath, 'models/active/shadeA.bmp');
  assert.equal(candidates.otherModelCandidates[0].texturePath, 'models/other/shadeB.bmp');
  assert.equal(candidates.defaultCandidates[0].toonIndex, 0);
  assert.equal(candidates.candidates[0].group, 'active-model');
  assert.equal(candidates.candidates[1].group, 'other-model');
  assert.equal(candidates.candidates.at(-1).group, 'default');
});

test('collectTextureCandidates orders active model textures before other model textures', () => {
  const candidates = collectTextureCandidates([
    {
      modelPath: 'models/active/',
      model: {
        name: 'Active Model',
        textures: ['models/active/albedo.png', 'models/active/detail.png'],
        textureColorSpaces: ['gamma-2.2', 'none'],
      },
      pipelineResources: {
        textureResources: [
          { previewUrl: 'data:image/png;base64,active-albedo' },
          { previewUrl: 'data:image/png;base64,active-detail' },
        ],
        textureCandidates: [
          {
            label: 'albedo.png',
            modelName: 'Active Model',
            modelPath: 'models/active/',
            textureIndex: 0,
            texturePath: 'models/active/albedo.png',
            textureColorSpace: 'gamma-2.2',
            previewUrl: 'data:image/png;base64,active-albedo',
            textureReference: { kind: 'path', path: 'models/active/albedo.png', colorSpace: 'gamma-2.2' },
            toonTexture: { kind: 'path', path: 'models/active/albedo.png', colorSpace: 'gamma-2.2' },
          },
          {
            label: 'detail.png',
            modelName: 'Active Model',
            modelPath: 'models/active/',
            textureIndex: 1,
            texturePath: 'models/active/detail.png',
            textureColorSpace: 'none',
            previewUrl: 'data:image/png;base64,active-detail',
            textureReference: { kind: 'path', path: 'models/active/detail.png', colorSpace: 'none' },
            toonTexture: { kind: 'path', path: 'models/active/detail.png', colorSpace: 'none' },
          },
        ],
      },
    },
    {
      modelPath: 'models/other/',
      model: {
        name: 'Other Model',
        textures: ['models/other/emissive.png'],
        textureColorSpaces: ['gamma-2.2'],
      },
      pipelineResources: {
        textureResources: [
          { previewUrl: 'data:image/png;base64,other-emissive' },
        ],
        textureCandidates: [
          {
            label: 'emissive.png',
            modelName: 'Other Model',
            modelPath: 'models/other/',
            textureIndex: 0,
            texturePath: 'models/other/emissive.png',
            textureColorSpace: 'gamma-2.2',
            previewUrl: 'data:image/png;base64,other-emissive',
            textureReference: { kind: 'path', path: 'models/other/emissive.png', colorSpace: 'gamma-2.2' },
            toonTexture: { kind: 'path', path: 'models/other/emissive.png', colorSpace: 'gamma-2.2' },
          },
        ],
      },
    },
  ], 0);

  assert.equal(candidates.activeModelCandidates.length, 2);
  assert.equal(candidates.otherModelCandidates.length, 1);
  assert.equal(candidates.candidates[0].group, 'active-model');
  assert.equal(candidates.candidates[1].group, 'active-model');
  assert.equal(candidates.candidates[2].group, 'other-model');
});

/**
 * モック GPU デバイスを作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice(writeBufferHandler = null) {
  const textures = [];
  const writeTextures = [];
  const copyExternalImageCalls = [];
  return {
    createBuffer(desc) {
      return { desc, destroy() {} };
    },
    createBindGroup(desc) {
      return { desc };
    },
    createTexture(desc) {
      textures.push(desc);
      return {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
    },
    queue: {
      copyExternalImageToTexture(source, destination, size) {
        copyExternalImageCalls.push({ source, destination, size });
      },
      writeBuffer(buffer, offset, data) {
        if (writeBufferHandler) {
          writeBufferHandler(buffer, offset, data);
        }
      },
      writeTexture(destination, data, layout, size) {
        writeTextures.push({ destination, data, layout, size });
      },
    },
    textures,
    writeTextures,
    copyExternalImageCalls,
  };
}

/**
 * TGA decode 用の最小 document モックを作成します。
 * @param {typeof ImageData} ImageDataCtor - ImageData コンストラクタ。
 * @returns {object} document モック。
 */
function createDocumentMock(ImageDataCtor) {
  return {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        return {};
      }
      return {
        width: 0,
        height: 0,
        toDataURL() {
          return 'data:image/png;base64,mock';
        },
        getContext(contextName) {
          if (contextName !== '2d') {
            return null;
          }
          return {
            createImageData(width, height) {
              return new ImageDataCtor(new Uint8ClampedArray(width * height * 4), width, height);
            },
            putImageData() {},
            drawImage() {},
            clearRect() {},
            getImageData(x, y, width, height) {
              return new ImageDataCtor(new Uint8ClampedArray(width * height * 4).fill(255), width, height);
            },
          };
        },
      };
    },
  };
}

/**
 * 1x1 32-bit TGA バイト列を返します。
 * @returns {Uint8Array} TGA バイト列。
 */
function createMinimalTgaBytes() {
  return new Uint8Array([
    0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 0,
    0, 0, 255, 255,
  ]);
}

/**
 * テクスチャを 1 枚持つ最小モデルを作成します。
 * @returns {object} モデルデータ。
 */
function createTextureModel(overrides = {}) {
  return {
    textures: ['albedo.png'],
    materials: [{
      textureIndex: 0,
      toonMode: 0,
      toonIndex: 0,
      sphereIndex: -1,
      sphereMode: 0,
      indexCount: 3,
      diffuse: [1, 1, 1, 1],
      ambient: [0, 0, 0, 0],
      specular: [0, 0, 0],
      shininess: 0,
      receiveShadow: true,
      hasEdge: false,
      metalic: 0,
      roughness: 0.5,
      emissive: [0, 0, 0],
      emissiveStrength: 0,
      alphaMode: 'opaque',
      ...overrides.materials?.[0],
    }],
    vertices: [0, 0, 0],
    indices: [0, 0, 0],
    ...overrides,
  };
}
