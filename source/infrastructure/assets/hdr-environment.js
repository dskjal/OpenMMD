import { DataUtils, FloatType } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const HDR_TEXTURE_FORMAT = 'rgba16float';
const HDR_CHANNEL_COUNT = 4;
const HDR_DEFAULT_INTENSITY = 1.0;
const HDR_DEFAULT_SOURCE_PATH = 'test-data/sundowner_deck_1k.hdr';

/**
 * `.hdr` を WebGPU 用環境マップへ変換します。
 */
export class HdrEnvironmentLoader {
  /**
   * @param {GPUDevice} device - WebGPU デバイス。
   */
  constructor(device) {
    this.device = device;
    this.loader = new HDRLoader();
    this.loader.setDataType(FloatType);
  }

  /**
   * HDR 環境マップを読み込みます。
   * @param {string|Blob|ArrayBuffer|Uint8Array|ArrayLike<number>} [source=HDR_DEFAULT_SOURCE_PATH] - HDR ソース。
   * @param {{sourcePath?: string}} [options={}] - 付加情報。
   * @returns {Promise<object>} 環境マップリソース。
   */
  async load(source = HDR_DEFAULT_SOURCE_PATH, options = {}) {
    const sourcePath = resolveHdrSourcePath(source, options.sourcePath);

    try {
      const arrayBuffer = await readHdrSourceArrayBuffer(source, sourcePath);
      const texData = this.loader.parse(arrayBuffer);
      return createHdrEnvironmentResources(this.device, texData.data, texData.width, texData.height, {
        intensity: HDR_DEFAULT_INTENSITY,
        sourcePath,
        loaded: true,
      });
    } catch (error) {
      console.warn(`Falling back to a black HDR environment for '${sourcePath}'.`, error);
      return createFallbackHdrEnvironmentResources(this.device, {
        sourcePath,
        loaded: false,
      });
    }
  }
}

/**
 * HDR ソースのパスを解決します。
 * @param {string|Blob|ArrayBuffer|Uint8Array|ArrayLike<number>} source - HDR ソース。
 * @param {string|undefined} explicitSourcePath - 明示的なソースパス。
 * @returns {string} ソースパス。
 */
function resolveHdrSourcePath(source, explicitSourcePath) {
  if (typeof explicitSourcePath === 'string' && explicitSourcePath.trim()) {
    return explicitSourcePath.trim();
  }

  if (typeof source === 'string' && source.trim()) {
    return source.trim();
  }

  if (typeof source?.name === 'string' && source.name.trim()) {
    return source.name.trim();
  }

  return HDR_DEFAULT_SOURCE_PATH;
}

/**
 * HDR ソースを ArrayBuffer へ読み出します。
 * @param {string|Blob|ArrayBuffer|Uint8Array|ArrayLike<number>} source - HDR ソース。
 * @param {string} sourcePath - 既知のソースパス。
 * @returns {Promise<ArrayBuffer>} 読み出し済み ArrayBuffer。
 */
async function readHdrSourceArrayBuffer(source, sourcePath) {
  if (typeof source === 'string') {
    const response = await fetch(encodeURI(source));
    if (!response.ok) {
      throw new Error(`Failed to load HDR environment: ${response.status} ${response.statusText} (${sourcePath})`);
    }
    return await response.arrayBuffer();
  }

  if (source instanceof ArrayBuffer) {
    return source;
  }

  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  }

  if (source && typeof source.arrayBuffer === 'function') {
    return await source.arrayBuffer();
  }

  throw new Error(`Unsupported HDR environment source: ${sourcePath}`);
}

/**
 * 環境マップ用サンプラーを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {GPUSampler} サンプラー。
 */
export function createHdrEnvironmentSampler(device) {
  return device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
  });
}

/**
 * 1x1 の黒い HDR テクスチャを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @returns {GPUTexture} テクスチャ。
 */
export function createBlackHdrEnvironmentTexture(device) {
  const texture = device.createTexture({
    size: [1, 1],
    mipLevelCount: 1,
    format: HDR_TEXTURE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint16Array(HDR_CHANNEL_COUNT),
    { bytesPerRow: HDR_CHANNEL_COUNT * 2 },
    [1, 1, 1],
  );
  return texture;
}

/**
 * 黒の HDR 環境マップを作成します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {object} [options={}] - オプション。
 * @returns {object} 環境マップリソース。
 */
export function createFallbackHdrEnvironmentResources(device, options = {}) {
  return createHdrEnvironmentResources(device, new Float32Array(HDR_CHANNEL_COUNT), 1, 1, {
    intensity: HDR_DEFAULT_INTENSITY,
    sourcePath: options.sourcePath || HDR_DEFAULT_SOURCE_PATH,
    loaded: Boolean(options.loaded),
  });
}

/**
 * HDR バッファを WebGPU テクスチャへ変換します。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {Float32Array|ArrayLike<number>} sourceData - RGBA 浮動小数点データ。
 * @param {number} width - 幅。
 * @param {number} height - 高さ。
 * @param {{intensity?: number, sourcePath?: string, loaded?: boolean}} [options={}] - 付加情報。
 * @returns {object} 環境マップリソース。
 */
export function createHdrEnvironmentResources(device, sourceData, width, height, options = {}) {
  const intensity = Number.isFinite(options.intensity) ? options.intensity : HDR_DEFAULT_INTENSITY;
  const sourcePath = typeof options.sourcePath === 'string' ? options.sourcePath : HDR_DEFAULT_SOURCE_PATH;
  const loaded = Boolean(options.loaded);
  const flippedBaseData = flipRgbaVertical(toFloat32Rgba(sourceData), width, height);
  const mipmaps = buildHdrMipmaps(flippedBaseData, width, height);
  const texture = device.createTexture({
    size: [width, height],
    mipLevelCount: mipmaps.length,
    format: HDR_TEXTURE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  for (let i = 0; i < mipmaps.length; i++) {
    const mip = mipmaps[i];
    const halfFloatData = toHalfFloatRgba(mip.data);
    device.queue.writeTexture(
      { texture, mipLevel: i },
      halfFloatData,
      { bytesPerRow: mip.width * HDR_CHANNEL_COUNT * 2 },
      [mip.width, mip.height, 1],
    );
  }

  return {
    texture,
    textureView: texture.createView(),
    sampler: createHdrEnvironmentSampler(device),
    intensity,
    loaded,
    sourcePath,
    width,
    height,
    mipLevelCount: mipmaps.length,
    maxMipLevel: Math.max(0, mipmaps.length - 1),
  };
}

/**
 * 既存データを float32 RGBA 配列へ正規化します。
 * @param {Float32Array|ArrayLike<number>} sourceData - 元データ。
 * @returns {Float32Array} 正規化済みデータ。
 */
function toFloat32Rgba(sourceData) {
  if (sourceData instanceof Float32Array) {
    return sourceData;
  }

  const output = new Float32Array(sourceData.length);
  for (let i = 0; i < sourceData.length; i++) {
    output[i] = Number(sourceData[i]) || 0.0;
  }
  return output;
}

/**
 * RGBA を上下反転します。
 * @param {Float32Array} sourceData - 元データ。
 * @param {number} width - 幅。
 * @param {number} height - 高さ。
 * @returns {Float32Array} 反転後データ。
 */
function flipRgbaVertical(sourceData, width, height) {
  const output = new Float32Array(sourceData.length);
  const rowStride = width * HDR_CHANNEL_COUNT;

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const srcOffset = srcY * rowStride;
    const dstOffset = y * rowStride;
    output.set(sourceData.subarray(srcOffset, srcOffset + rowStride), dstOffset);
  }

  return output;
}

/**
 * 2x2 のボックスフィルタで equirectangular mip を作成します。
 * @param {Float32Array} baseData - 基底レベルの RGBA データ。
 * @param {number} width - 幅。
 * @param {number} height - 高さ。
 * @returns {Array<{width: number, height: number, data: Float32Array}>} mip chain。
 */
function buildHdrMipmaps(baseData, width, height) {
  const mipmaps = [];
  let currentWidth = width;
  let currentHeight = height;
  let currentData = baseData;

  while (true) {
    mipmaps.push({
      width: currentWidth,
      height: currentHeight,
      data: currentData,
    });

    if (currentWidth === 1 && currentHeight === 1) {
      break;
    }

    const nextWidth = Math.max(1, Math.floor(currentWidth / 2));
    const nextHeight = Math.max(1, Math.floor(currentHeight / 2));
    const nextData = new Float32Array(nextWidth * nextHeight * HDR_CHANNEL_COUNT);

    for (let y = 0; y < nextHeight; y++) {
      for (let x = 0; x < nextWidth; x++) {
        const accum = [0.0, 0.0, 0.0, 0.0];
        let sampleCount = 0;

        for (let oy = 0; oy < 2; oy++) {
          const sourceY = Math.min(currentHeight - 1, y * 2 + oy);
          for (let ox = 0; ox < 2; ox++) {
            const sourceX = wrapIndex(x * 2 + ox, currentWidth);
            const sourceIndex = (sourceY * currentWidth + sourceX) * HDR_CHANNEL_COUNT;
            accum[0] += currentData[sourceIndex + 0];
            accum[1] += currentData[sourceIndex + 1];
            accum[2] += currentData[sourceIndex + 2];
            accum[3] += currentData[sourceIndex + 3];
            sampleCount++;
          }
        }

        const targetIndex = (y * nextWidth + x) * HDR_CHANNEL_COUNT;
        nextData[targetIndex + 0] = accum[0] / sampleCount;
        nextData[targetIndex + 1] = accum[1] / sampleCount;
        nextData[targetIndex + 2] = accum[2] / sampleCount;
        nextData[targetIndex + 3] = accum[3] / sampleCount;
      }
    }

    currentWidth = nextWidth;
    currentHeight = nextHeight;
    currentData = nextData;
  }

  return mipmaps;
}

/**
 * 2 の冪で割ったときに範囲内へ畳み込みます。
 * @param {number} value - 対象値。
 * @param {number} size - 配列長。
 * @returns {number} 正規化後の index。
 */
function wrapIndex(value, size) {
  if (size <= 0) {
    return 0;
  }
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

/**
 * float32 RGBA を half float RGBA へ変換します。
 * @param {Float32Array} sourceData - 元データ。
 * @returns {Uint16Array} half float データ。
 */
function toHalfFloatRgba(sourceData) {
  const output = new Uint16Array(sourceData.length);
  for (let i = 0; i < sourceData.length; i++) {
    output[i] = DataUtils.toHalfFloat(sourceData[i]);
  }
  return output;
}
