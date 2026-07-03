import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { HdrEnvironmentLoader, createBlackHdrEnvironmentTexture } from '../source/infrastructure/assets/hdr-environment.js';

globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
};

test('HdrEnvironmentLoader loads test-data/sundowner_deck_1k.hdr into a mipmapped texture', async () => {
  const writes = [];
  const device = createMockDevice((entry) => {
    writes.push(entry);
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const loader = new HdrEnvironmentLoader(device);
    const resources = await loader.load('./test-data/sundowner_deck_1k.hdr');

    assert.equal(resources.loaded, true);
    assert.equal(resources.width, 1024);
    assert.equal(resources.height, 512);
    assert.equal(resources.mipLevelCount > 1, true);
    assert.equal(resources.maxMipLevel, resources.mipLevelCount - 1);
    assert.equal(resources.texture.desc.format, 'rgba16float');
    assert.equal(resources.texture.desc.mipLevelCount, resources.mipLevelCount);
    assert.equal(writes.length, resources.mipLevelCount);
    assert.equal(writes[0].bytesPerRow, 1024 * 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HdrEnvironmentLoader loads a File input into a mipmapped texture', async () => {
  const writes = [];
  const device = createMockDevice((entry) => {
    writes.push(entry);
  });
  const fileBytes = await fs.readFile('./test-data/sundowner_deck_1k.hdr');
  const file = new File([fileBytes], 'custom-environment.hdr');
  const loader = new HdrEnvironmentLoader(device);

  const resources = await loader.load(file);

  assert.equal(resources.loaded, true);
  assert.equal(resources.sourcePath, 'custom-environment.hdr');
  assert.equal(resources.width, 1024);
  assert.equal(resources.height, 512);
  assert.equal(resources.mipLevelCount > 1, true);
  assert.equal(writes.length, resources.mipLevelCount);
});

test('createBlackHdrEnvironmentTexture creates a 1x1 black texture', () => {
  const writes = [];
  const device = createMockDevice((entry) => {
    writes.push(entry);
  });

  const texture = createBlackHdrEnvironmentTexture(device);

  assert.equal(texture.desc.format, 'rgba16float');
  assert.equal(texture.desc.mipLevelCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].bytesPerRow, 8);
});

/**
 * モック GPU デバイスを作成します。
 * @param {(entry: object) => void} [writeTextureHandler=null] - writeTexture 監視。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice(writeTextureHandler = null) {
  return {
    createTexture(desc) {
      return {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
    },
    createSampler() {
      return { label: 'sampler' };
    },
    queue: {
      writeTexture(destination, data, layout, size) {
        if (writeTextureHandler) {
          writeTextureHandler({
            destination,
            data,
            bytesPerRow: layout.bytesPerRow,
            size,
          });
        }
      },
      writeBuffer() {},
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
      async arrayBuffer() {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    };
  };
}
