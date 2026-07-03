import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  collectModelCompanionShaderFilesFromZipFiles,
  collectShaderFilesFromZipFiles,
  isShaderFileName,
} from '../source/infrastructure/io/file-loading.js';

test('isShaderFileName matches WGSL files only', () => {
  assert.equal(isShaderFileName('shader.wgsl'), true);
  assert.equal(isShaderFileName('shader.WGSL'), true);
  assert.equal(isShaderFileName('shader.glsl'), false);
  assert.equal(isShaderFileName('shader.wgsl.bak'), false);
});

test('collectShaderFilesFromZipFiles returns WGSL files from folder-style paths and ignores __MACOSX', async () => {
  const shaderData = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let ambientOcclusionFactor = 0.5;
  let finalColor = vec3<f32>(ambientOcclusionFactor);
  return vec4<f32>(finalColor, 1.0);
}
`;
  const zipFiles = {
    'miku/mmd-shader-hdr-ao.wgsl': {
      async: async (type) => (type === 'blob'
        ? new Blob([shaderData], { type: 'text/plain' })
        : null),
    },
    'miku/textures/cloth.png': {
      async: async () => null,
    },
    '__MACOSX/._mmd-shader-hdr-ao.wgsl': {
      async: async () => null,
    },
  };

  const shaderFiles = await collectShaderFilesFromZipFiles(zipFiles);
  assert.equal(shaderFiles.length, 1);
  assert.equal(shaderFiles[0].name, 'miku/mmd-shader-hdr-ao.wgsl');
  assert.equal(shaderFiles[0].type, 'text/plain');
});

test('collectModelCompanionShaderFilesFromZipFiles resolves sibling WGSL from model JSON content', async () => {
  const modelText = await fs.readFile(new URL('../test-data/miku-shader-model.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(modelText);
  const shaderData = `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let ambientOcclusionFactor = 0.5;
  let finalColor = vec3<f32>(ambientOcclusionFactor);
  return vec4<f32>(finalColor, 1.0);
}
  `;
  const zipFiles = {
    'test-data/miku-shader-model.json': {
      async: async (type) => (type === 'blob'
        ? new Blob([modelText], { type: 'application/json' })
        : null),
    },
    'test-data/miku/mmd-shader-hdr-ao.wgsl': {
      async: async (type) => (type === 'blob'
        ? new Blob([shaderData], { type: 'text/plain' })
        : null),
    },
    'test-data/textures/cloth.png': {
      async: async () => null,
    },
  };

  const shaderFiles = await collectModelCompanionShaderFilesFromZipFiles(parsed, 'test-data/miku/custom-settings.json', zipFiles);
  assert.equal(shaderFiles.length, 1);
  assert.equal(shaderFiles[0].name, 'test-data/miku/mmd-shader-hdr-ao.wgsl');
  assert.equal(shaderFiles[0].type, 'text/plain');
});
