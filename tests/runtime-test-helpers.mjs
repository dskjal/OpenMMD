import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSceneState } from '../source/core/model/model-scene.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  INDEX: 2,
  COPY_DST: 4,
  STORAGE: 8,
};
globalThis.GPUShaderStage ??= {
  VERTEX: 1,
};

/**
 * ローカルファイルを読む File 互換オブジェクトを作成します。
 * @param {string} filePath - ファイルパス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>, text: function(): Promise<string>}} File 互換オブジェクト。
 */
export function createFileLike(filePath) {
  return {
    name: filePath.split(/[\\/]/).pop() || filePath,
    async arrayBuffer() {
      const buffer = await fs.readFile(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    async text() {
      return await fs.readFile(filePath, 'utf8');
    },
  };
}

/**
 * runtime テスト用の最小 GPU デバイスを作成します。
 * @returns {object} モック GPU デバイス。
 */
export function createMockDevice() {
  return {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    createBindGroupLayout() {
      return {};
    },
    queue: {
      writeBuffer() {},
    },
  };
}

/**
 * ローカルファイルへ委譲する fetch モックを返します。
 * @returns {function} fetch 互換関数。
 */
export function createFileFetchMock() {
  return async (input) => {
    const url = new URL(input, pathToFileURL(`${process.cwd()}/`));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => data.toString('utf-8'),
    };
  };
}

/**
 * テスト実行中だけ fetch をローカルファイル読み込みへ差し替えます。
 * @returns {() => void} 復元関数。
 */
export function installFileFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * runtime scene を作るテスト用の最小 GPU デバイスを返します。
 * @returns {object} モック GPU デバイス。
 */
export function createSceneTestDevice() {
  return {
    createBuffer(options = {}) {
      return {
        size: options.size || 4096,
        destroy() {},
      };
    },
    createBindGroupLayout() {
      return {};
    },
    createRenderPipeline() {
      return {
        getBindGroupLayout() {
          return {};
        },
      };
    },
    createSampler() {
      return {};
    },
    createTexture() {
      return {
        createView() {
          return {};
        },
      };
    },
    createPipelineLayout() {
      return {};
    },
    createShaderModule() {
      return {};
    },
    createCommandEncoder() {
      return {
        finish() {
          return {};
        },
      };
    },
    queue: {
      writeBuffer() {},
      copyExternalImageToTexture() {},
      submit() {},
    },
  };
}

/**
 * 実モデルから runtime scene を作成します。
 * @param {object} model - 実モデルデータ。
 * @returns {object} シーン状態。
 */
export function createManagedScene(model) {
  return createSceneState(createSceneTestDevice(), model);
}

/**
 * GLTFExporter 用の FileReader モックを返します。
 * @returns {typeof FileReader} FileReader 互換クラス。
 */
export function createFileReaderMock() {
  return class FileReaderMock {
    constructor() {
      this.result = null;
      this.onloadend = null;
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}
