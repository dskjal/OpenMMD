import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadTextureFromPath } from '../source/infrastructure/gpu/material-resources.js';

/**
 実行結果:

  - PNG: 9.78 ms
  - TGA: 19.75 ms
  - 差分: 9.97 ms (TGA - PNG)
 */

globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
};

globalThis.ImageData ??= class ImageData {
  /**
   * @param {Uint8ClampedArray} data - RGBA pixel data.
   * @param {number} width - Image width.
   * @param {number} height - Image height.
   */
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

test('Alicia_face.png と Alicia_face.tga の load+texture 化時間を比較する', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const device = createMockDevice();

  globalThis.fetch = createFileFetchMock();
  globalThis.createImageBitmap = createImageBitmapMock;
  globalThis.document = createDocumentMock();

  try {
    const png = await measureLoadTexture(device, './test-data/alicia/Alicia_face.png');
    const tga = await measureLoadTexture(device, './test-data/alicia/Alicia_face.tga');
    const diff = tga.elapsedMs - png.elapsedMs;

    assert.ok(png.texture, 'PNG texture should be created');
    assert.ok(tga.texture, 'TGA texture should be created');

    console.log(`PNG load+texture: ${formatElapsed(png.elapsedMs)} ms`);
    console.log(`TGA load+texture: ${formatElapsed(tga.elapsedMs)} ms`);
    console.log(`Difference (TGA - PNG): ${formatElapsed(diff)} ms`);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

/**
 * 指定パスの画像読み込みと texture 化の時間を測定します。
 * @param {object} device - GPU device mock.
 * @param {string} path - Texture path.
 * @returns {Promise<{texture: object|null, elapsedMs: number}>} Result.
 */
async function measureLoadTexture(device, path) {
  const start = performance.now();
  const texture = await loadTextureFromPath(device, path, null);
  const elapsedMs = performance.now() - start;
  return { texture, elapsedMs };
}

/**
 * ローカルファイルを返す fetch モックを作成します。
 * @returns {function(string|URL): Promise<object>} fetch 互換関数。
 */
function createFileFetchMock() {
  return async (input) => {
    const url = new URL(input, pathToFileURL(`${process.cwd()}/`));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async blob() {
        return new Blob([data]);
      },
      async arrayBuffer() {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    };
  };
}

/**
 * PNG はヘッダから寸法を読み取り、TGA は ImageData から寸法を引き継ぐ createImageBitmap モックです。
 * @param {Blob|ImageData} source - 画像ソース。
 * @returns {Promise<{width: number, height: number}>} ImageBitmap 互換オブジェクト。
 */
async function createImageBitmapMock(source) {
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    return {
      width: source.width,
      height: source.height,
    };
  }

  const buffer = new Uint8Array(await source.arrayBuffer());
  const pngSignature = '\x89PNG\r\n\x1a\n';
  const signature = String.fromCharCode(...buffer.subarray(0, 8));
  if (signature !== pngSignature) {
    throw new Error('Unexpected image format in test mock.');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

/**
 * モック GPU device を作成します。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice() {
  return {
    textures: [],
    createTexture(desc) {
      const texture = {
        desc,
        createView() {
          return { texture };
        },
        destroy() {},
      };
      this.textures.push(texture);
      return texture;
    },
    queue: {
      copyExternalImageToTexture() {},
      writeTexture() {},
    },
  };
}

/**
 * TGA デコード用の document モックを作成します。
 * @returns {object} document 互換オブジェクト。
 */
function createDocumentMock() {
  return {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        return {};
      }

      const canvas = {
        width: 0,
        height: 0,
        toDataURL() {
          return 'data:image/png;base64,';
        },
      };
      const context = {
        clearRect() {},
        drawImage() {},
        getImageData(x, y, width, height) {
          return {
            width,
            height,
            data: new Uint8ClampedArray(Math.max(0, width * height * 4)).fill(255),
          };
        },
        putImageData() {},
        createImageData(width, height) {
          return {
            width,
            height,
            data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
          };
        },
      };

      return {
        getContext(contextName) {
          if (contextName !== '2d') {
            return null;
          }

          return context;
        },
        ...canvas,
      };
    },
  };
}

/**
 * 経過時間を見やすく整形します。
 * @param {number} value - elapsed milliseconds.
 * @returns {string} formatted elapsed milliseconds.
 */
function formatElapsed(value) {
  return Number(value).toFixed(2);
}
