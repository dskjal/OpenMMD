import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CustomShaderManager } from '../source/infrastructure/gpu/custom-shader-manager.js';

const FOLDER_SHADER_SOURCE = `struct VertexOutput {
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

test('CustomShaderManager loads shader templates and defaults glTF to glTF shader', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const manager = new CustomShaderManager(createMockDevice());
    await manager.init();

    assert.equal(manager.getDefaultShaderNameForModel({ magic: 'Pmd' }), 'mmd-shader.wgsl');
    assert.equal(manager.getDefaultShaderNameForModel({ magic: 'Gltf' }), 'gltf-shader.wgsl');
    assert.equal(manager.getDefaultShaderNameForModel(null), 'mmd-shader.wgsl');
    assert.equal(manager.getDefaultShaderNameForModel({}), 'mmd-shader.wgsl');
    assert.equal(manager.getDefaultMmdShaderName(), 'mmd-shader.wgsl');
    assert.deepEqual(manager.getShaderDefinitions().map((definition) => definition.name), ['mmd-shader.wgsl', 'gltf-shader.wgsl', 'mtoon-shader.wgsl']);

    const module = await manager.getShaderModule('mmd-shader.wgsl');
    assert.ok(module);
    assert.equal(module.code.includes('CUSTOM_SHADER_BODY'), false);
    assert.equal(module.code.includes('return out;'), true);
    assert.equal(module.code.includes('@fragment'), true);
    assert.equal(module.code.includes('fn fs_main'), true);
    assert.equal(module.code.includes('sample_outline_alpha(in.uv)'), true);
    assert.equal(module.code.includes('out.position.z += edgeScale * edgeOffset * 0.01;'), true);
    assert.equal(module.code.includes('out.normal = vec4<f32>(0.0);'), true);
    assert.equal(module.code.includes('out.mask = vec4<f32>(0.0);'), true);

    const gltfModule = await manager.getShaderModule('gltf-shader.wgsl');
    assert.ok(gltfModule);
    assert.equal(gltfModule.code.includes('CUSTOM_SHADER_BODY'), false);
    assert.equal(gltfModule.code.includes('sample_outline_alpha(in.uv)'), true);
    assert.equal(gltfModule.code.includes('environmentData'), true);
    assert.equal(gltfModule.code.includes('sample_environment('), true);
    assert.equal(gltfModule.code.includes('uniforms.cameraWorldPosition.xyz - in.worldPos'), true);
    assert.equal(gltfModule.code.includes('normalize(-in.viewPos)'), false);
    assert.equal(gltfModule.code.includes('let dynamicRange = uniforms.shadowPowerParams.y;'), true);
    assert.equal(gltfModule.code.includes('clamp(uniforms.environmentParams.z, 0.0, dynamicRange)'), true);
    assert.equal(gltfModule.code.includes('out.normal = vec4<f32>(0.0);'), true);
    assert.equal(gltfModule.code.includes('out.mask = vec4<f32>(0.0);'), true);

    const mmdSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/custom-shaders/mmd-shader.wgsl', import.meta.url), 'utf8');
    assert.equal(mmdSource.includes('let bloomShadowFactor = select(1.0, clamp(dotNL, 0.0, 1.0) * shadowMapFactor * contactShadowFactor, material_receive_shadow() > 0.5);'), true);
    assert.equal(mmdSource.includes('out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), bloomShadowFactor, 1.0);'), true);

    const gltfSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/custom-shaders/gltf-shader.wgsl', import.meta.url), 'utf8');
    assert.equal(gltfSource.includes('let bloomViewNormal = normalize(in.viewNormal);'), true);
    assert.equal(gltfSource.includes('let bloomViewLightDir = -normalize((uniforms.view * vec4<f32>(normalize(uniforms.lightingParams.xyz), 0.0)).xyz);'), true);
    assert.equal(gltfSource.includes('let bloomNdotL = clamp(dot(bloomViewNormal, bloomViewLightDir), 0.0, 1.0);'), true);
    assert.equal(gltfSource.includes('let bloomShadowFactor = select(1.0, bloomNdotL * shadowFactor * contactShadowFactor, material_receive_shadow() > 0.5);'), true);
    assert.equal(gltfSource.includes('let bloomShadowDebugMode = i32(round(uniforms.shadowPowerParams.w));'), false);
    assert.equal(gltfSource.includes('bloomShadowDebugValue'), false);
    assert.equal(gltfSource.includes('bloomShadowDebugMode == 1'), false);
    assert.equal(gltfSource.includes('bloomShadowDebugMode == 2'), false);
    assert.equal(gltfSource.includes('bloomShadowDebugMode == 3'), false);
    assert.equal(gltfSource.includes('bloomShadowDebugMode == 4'), false);
    assert.equal(gltfSource.includes('out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), clamp(bloomShadowFactor, 0.0, 1.0), 1.0);'), true);

    const mtoonSourcePath = new URL('../source/infrastructure/gpu/shaders/custom-shaders/mtoon-shader.wgsl', import.meta.url);
    const mtoonSource = await fs.readFile(mtoonSourcePath, 'utf8');
    assert.equal(mtoonSource.includes('let metallic = clamp(material_metalic(), 0.0, 1.0);'), true);
    assert.equal(mtoonSource.includes('let roughness = clamp(material_roughness(), 0.0, 1.0);'), true);
    assert.equal(mtoonSource.includes('let giEqualization = clamp(material.mtoonParams1.y, 0.0, 1.0);'), true);
    assert.equal(
      mtoonSource.includes('var shadeColorFactor = material.mtoonShadeColor.rgb;'),
      true,
    );
    assert.equal(
      mtoonSource.includes('var shadeColor = pow(shadeColorFactor * shadeMultiplier, vec3<f32>(uniforms.shadowPowerParams.x));'),
      true,
    );
    assert.equal(mtoonSource.includes('let diffuseColor = mix(shadeColor, baseColor, shadeMix);'), true);
    assert.equal(mtoonSource.includes('let rawGi = sample_environment(normal, 1.0);'), true);
    assert.equal(mtoonSource.includes('let uniformedGi = 0.5 * ('), true);
    assert.equal(mtoonSource.includes('let gi = mix(rawGi, uniformedGi, giEqualization) * ambientOcclusionFactor;'), true);
    assert.equal(mtoonSource.includes('litColor += gi * diffuseColor;'), true);
    assert.equal(mtoonSource.includes('let baseSpecular = mix(material_specular(), baseColor, metallic);'), true);
    assert.equal(mtoonSource.includes('let envDiffuse = sample_environment(normal, 1.0) * diffuseColor * (1.0 - metallic);'), true);
    assert.equal(mtoonSource.includes('let envSpecular = sample_environment(reflect(-viewDir, normal), roughness * roughness) * fresnel * mix(1.0, 0.12, roughness);'), true);
    assert.equal(mtoonSource.includes('let specularTerm = pow(max(dot(normal, halfDir), 0.0), specularPower) * mix(0.03, 0.35, metallic);'), true);
    assert.equal(mtoonSource.includes('0.25 + indirectLight'), false);
    assert.equal(mtoonSource.includes('var bloomShadowFactor = select(0.0, clamp(nDotL, 0.0, 1.0) * shadowFactor * contactShadowFactor, receiveShadow);'), true);
    assert.equal(mtoonSource.includes('out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), bloomShadowFactor, 1.0);'), true);

    manager.setDefaultMmdShaderName('mtoon-shader.wgsl');
    assert.equal(manager.getDefaultMmdShaderName(), 'mtoon-shader.wgsl');
    assert.equal(manager.getDefaultShaderNameForModel({ magic: 'Pmd' }), 'mtoon-shader.wgsl');
    assert.equal(manager.getDefaultShaderNameForModel({ magic: 'Gltf' }), 'gltf-shader.wgsl');
    assert.equal((await manager.getShaderDefinition('')).name, 'mtoon-shader.wgsl');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CustomShaderManager reloads a dropped WGSL file from in-memory source', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const manager = new CustomShaderManager(createMockDevice());
    await manager.init();

    const shaderSource = `var out: MainFragmentOutput;\nout.color = vec4<f32>(0.25, 0.5, 0.75, 1.0);\nreturn out;`;
    const registered = await manager.loadDroppedShaderFile(new File([shaderSource], 'mmd-shader.wgsl', {
      type: 'text/plain',
    }));

    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, 'mmd-shader.wgsl');
    assert.equal(registered[0].label, 'mmd-shader.wgsl');

    const module = await manager.reloadShader('mmd-shader.wgsl');
    assert.ok(module);
    assert.equal(module.code.includes('0.25, 0.5, 0.75, 1.0'), true);
    assert.equal(module.code.includes('return out;'), true);
    assert.equal(manager.getShaderDefinitions().filter((definition) => definition.name === 'mmd-shader.wgsl').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CustomShaderManager loads folder-style shader bundles from models/miku', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const manager = new CustomShaderManager(createMockDevice());
    await manager.init();

    const zipFiles = {
      'miku/mmd-shader-hdr-ao.wgsl': {
        async: async (type) => (type === 'blob'
          ? new Blob([FOLDER_SHADER_SOURCE], { type: 'text/plain' })
          : null),
      },
    };

    const registered = await manager.loadDroppedShaderBundle(zipFiles);

    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, 'miku/mmd-shader-hdr-ao.wgsl');
    assert.equal(registered[0].label, 'miku/mmd-shader-hdr-ao.wgsl');

    const module = await manager.reloadShader('miku/mmd-shader-hdr-ao.wgsl');
    assert.ok(module);
    assert.equal(module.code.includes('ambientOcclusionFactor'), true);
    assert.equal(module.code.includes('finalColor = vec3<f32>(ambientOcclusionFactor);'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CustomShaderManager prefers manifest-driven shader bundles over loose files', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const manager = new CustomShaderManager(createMockDevice());
    await manager.init();

    const manifest = [
      {
        name: 'lighting.wgsl',
        label: 'Lighting',
        entryPath: 'custom-shaders/lighting.wgsl',
        defaultFor: ['default'],
      },
      {
        name: 'cell.wgsl',
        label: 'Cell',
        entryPath: 'custom-shaders/cell.wgsl',
      },
    ];

    const lightingSource = `var out: MainFragmentOutput;\nout.color = vec4<f32>(1.0, 0.1, 0.2, 1.0);\nreturn out;`;
    const cellSource = `var out: MainFragmentOutput;\nout.color = vec4<f32>(0.2, 0.9, 0.3, 1.0);\nreturn out;`;
    const ignoredSource = `var out: MainFragmentOutput;\nout.color = vec4<f32>(0.0, 0.0, 0.0, 1.0);\nreturn out;`;
    const zipFiles = {
      'custom-shaders/manifest.json': createZipEntry(JSON.stringify(manifest), 'application/json'),
      'custom-shaders/lighting.wgsl': createZipEntry(lightingSource, 'text/plain'),
      'custom-shaders/cell.wgsl': createZipEntry(cellSource, 'text/plain'),
      'custom-shaders/ignored.wgsl': createZipEntry(ignoredSource, 'text/plain'),
    };

    const registered = await manager.loadDroppedShaderBundle(zipFiles);

    assert.deepEqual(registered.map((definition) => definition.name), ['lighting.wgsl', 'cell.wgsl']);
    assert.deepEqual(
      manager.getShaderDefinitions()
        .filter((definition) => ['lighting.wgsl', 'cell.wgsl'].includes(definition.name))
        .map((definition) => definition.label),
      ['Lighting', 'Cell'],
    );

    const lightingModule = await manager.reloadShader('lighting.wgsl');
    assert.ok(lightingModule);
    assert.equal(lightingModule.code.includes('1.0, 0.1, 0.2, 1.0'), true);
    assert.equal(lightingModule.code.includes('0.0, 0.0, 0.0, 1.0'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * モック GPU デバイスを作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice() {
  return {
    createShaderModule(desc) {
      return {
        code: desc.code,
        async getCompilationInfo() {
          return { messages: [] };
        },
      };
    },
  };
}

/**
 * fetch をファイル読み込みへ差し替えます。
 * @returns {function} fetch 互換関数。
 */
function createFileFetchMock() {
  return async (input) => {
    const url = new URL(input, pathToFileURL(`${process.cwd()}/`));
    url.search = '';
    url.hash = '';
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return JSON.parse(data.toString('utf-8'));
      },
      async text() {
        return data.toString('utf-8');
      },
    };
  };
}

/**
 * ZIP エントリ用の blob を返すモックを作成します。
 * @param {string} text - ファイル内容。
 * @param {string} [type='text/plain'] - MIME type。
 * @returns {{async: function(string): Promise<(ArrayBuffer|Blob|null)>}} ZIP エントリモック。
 */
function createZipEntry(text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  return {
    async: async (requestedType) => {
      if (requestedType === 'blob') {
        return blob;
      }
      return null;
    },
  };
}
