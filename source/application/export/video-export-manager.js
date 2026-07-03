import {
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
} from '../../lib/mediabunny.min.mjs';
import {
  VIDEO_EXPORT_CODEC_ORDER,
  filterVideoExportAudioCodecsForFormat,
  buildVideoExportFramePlan,
  computeVideoExportPhysicsStep,
  filterVideoExportCodecsForFormat,
  isVideoExportCodecCompatible,
  normalizeVideoExportCodec,
  normalizeVideoExportFormat,
  normalizeVideoExportTransparentBackground,
  resolveVideoExportAudioBitrate,
  resolveVideoExportAudioCodec,
  resolveVideoExportQuality,
  supportsVideoExportTransparency,
} from '../../shared/export/video-export-utils.js';

/** @type {Record<VideoExportFormatName, { fileExtension: string, mimeType: string, ctor: typeof Mp4OutputFormat }>} */
const VIDEO_EXPORT_FORMATS = Object.freeze({
  mp4: {
    fileExtension: '.mp4',
    mimeType: 'video/mp4',
    ctor: Mp4OutputFormat,
  },
  webm: {
    fileExtension: '.webm',
    mimeType: 'video/webm',
    ctor: WebMOutputFormat,
  },
  mov: {
    fileExtension: '.mov',
    mimeType: 'video/quicktime',
    ctor: MovOutputFormat,
  },
  mkv: {
    fileExtension: '.mkv',
    mimeType: 'video/x-matroska',
    ctor: MkvOutputFormat,
  },
});

/**
 * Video export manager.
 */
export class VideoExportManager {
  /**
   * @param {object} options - 管理オプション。
   * @param {HTMLCanvasElement} options.canvas - 現在の描画 canvas。
   * @param {object} options.canvasTargets - WebGPU canvas targets。
   * @param {GPUCanvasContext} options.gpuContext - WebGPU canvas context。
   * @param {GPUTextureFormat} options.presentationFormat - プレゼンテーション format。
   * @param {object} options.device - WebGPU device。
   * @param {object} options.rendererState - レンダラー state。
   * @param {object} options.exportRuntimeService - Export runtime service。
   * @param {object} options.physicsEngine - 物理エンジン。
   * @param {object} options.camera - Camera state。
   * @param {object} [options.getLangData] - ローカライズ取得関数。
   * @param {function(number, number): (HTMLCanvasElement|OffscreenCanvas)} [options.createExportCanvas] - export canvas factory。
   * @param {function(HTMLCanvasElement|OffscreenCanvas): Promise<Blob>} [options.canvasToBlob] - Blob conversion adapter。
   */
  constructor(options) {
    this.canvas = options.canvas;
    this.canvasTargets = options.canvasTargets;
    this.gpuContext = options.gpuContext;
    this.presentationFormat = options.presentationFormat;
    this.device = options.device;
    this.rendererState = options.rendererState;
    this.exportRuntimeService = options.exportRuntimeService;
    this.physicsEngine = options.physicsEngine;
    this.camera = options.camera;
    this.getLangData = options.getLangData || (() => ({}));
    this.getBgmManager = typeof options.getBgmManager === 'function' ? options.getBgmManager : (() => null);
    this.createExportCanvasAdapter = typeof options.createExportCanvas === 'function' ? options.createExportCanvas : null;
    this.canvasToBlobAdapter = typeof options.canvasToBlob === 'function' ? options.canvasToBlob : null;
    this.isExporting = false;
    this.cancelRequested = false;
    this.codecProbeCache = new Map();
  }

  /**
   * export 中断を要求します。
   */
  cancel() {
    this.cancelRequested = true;
  }

  /**
   * 指定フォーマットで利用可能な codec を返します。
   * @param {object} options - probe オプション。
   * @param {number} options.width - 出力幅。
   * @param {number} options.height - 出力高さ。
   * @param {VideoExportFormatName} options.format - 出力形式。
   * @param {string} [options.quality='medium'] - 品質プリセット。
   * @returns {Promise<VideoExportCodecName[]>} 利用可能 codec 一覧。
   */
  async getAvailableCodecs(options) {
    const format = normalizeVideoExportFormat(options.format);
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    const qualityName = String(options.quality || 'medium').toLowerCase();
    const quality = resolveVideoExportQuality(qualityName);
    const cacheKey = `${format}:${qualityName}:${width}x${height}`;
    if (this.codecProbeCache.has(cacheKey)) {
      return this.codecProbeCache.get(cacheKey);
    }

    if (typeof getEncodableVideoCodecs !== 'function') {
      const fallback = filterVideoExportCodecsForFormat(format);
      this.codecProbeCache.set(cacheKey, fallback);
      return fallback;
    }

    const supported = filterVideoExportCodecsForFormat(format);
    const available = await getEncodableVideoCodecs(supported, {
      width,
      height,
      bitrate: quality,
    });
    const filtered = available.filter((codec) => isVideoExportCodecCompatible(format, codec));
    this.codecProbeCache.set(cacheKey, filtered);
    return filtered;
  }

  /**
   * 動画を書き出します。
   * @param {object} options - export オプション。
   * @param {VideoExportFormatName} options.format - 出力形式。
   * @param {VideoExportCodecName} options.codec - codec。
   * @param {number} options.width - 出力幅。
   * @param {number} options.height - 出力高さ。
   * @param {number} options.exportFps - 出力 fps。
   * @param {number} options.startFrame - 開始フレーム。
   * @param {number} options.endFrame - 終了フレーム。
   * @param {boolean} [options.includeAudio=false] - BGM audio を含めるかどうか。
   * @param {boolean} [options.transparentBackground=false] - 背景透過で書き出すかどうか。
   * @param {string} [options.quality='medium'] - 品質プリセット。
   * @param {(progress: number, message?: string) => void} [options.onProgress] - 進捗通知。
   * @param {(locked: boolean) => void} [options.onUiLockChange] - UI lock 通知。
   * @returns {Promise<{ blob: Blob, filename: string, mimeType: string }>} 書き出し結果。
   */
  async exportVideo(options) {
    if (this.isExporting) {
      throw new Error('Video export is already running.');
    }

    this.isExporting = true;
    this.cancelRequested = false;
    try {
      const formatName = normalizeVideoExportFormat(options.format);
      const codecName = normalizeVideoExportCodec(options.codec);
      if (!isVideoExportCodecCompatible(formatName, codecName)) {
        throw new Error(`Codec ${codecName} is not compatible with ${formatName}.`);
      }

      const formatInfo = VIDEO_EXPORT_FORMATS[formatName];
      const exportFps = Math.max(1, Math.round(Number.isFinite(options.exportFps) ? options.exportFps : 60));
      const width = Math.max(1, Math.round(options.width));
      const height = Math.max(1, Math.round(options.height));
      const quality = resolveVideoExportQuality(options.quality);
      const activeInstance = this.exportRuntimeService?.getActiveInstance?.() ?? null;
      if (!activeInstance) {
        throw new Error('No active model to export.');
      }

      const playbackRange = this.exportRuntimeService?.getPlaybackRange?.() ?? { start: 0, end: null };
      const resolvedEndFrame = Number.isFinite(options.endFrame)
        ? options.endFrame
        : (Number.isFinite(playbackRange.end) ? playbackRange.end : this.exportRuntimeService?.getMaxFrame?.());
      const framePlan = buildVideoExportFramePlan({
        startFrame: Number.isFinite(options.startFrame) ? options.startFrame : playbackRange.start,
        endFrame: resolvedEndFrame,
        exportFps,
      });
      const includeAudio = options.includeAudio === true;
      const transparentBackground = normalizeVideoExportTransparentBackground(formatName, options.transparentBackground);
      const bgmManager = this.getBgmManager?.() ?? null;
      const exportStartFrame = Number.isFinite(options.startFrame) ? options.startFrame : playbackRange.start;
      const exportEndFrame = Number.isFinite(options.endFrame)
        ? options.endFrame
        : (Number.isFinite(playbackRange.end) ? playbackRange.end : this.exportRuntimeService?.getMaxFrame?.());
      const audioDurationSeconds = Math.max(0, (exportEndFrame - exportStartFrame) / 30);
      const originalState = this.exportRuntimeService?.snapshotExportState?.() ?? null;
      const exportCanvas = this.createExportCanvas(width, height);
      const output = new Output({
        format: new formatInfo.ctor(),
        target: new BufferTarget(),
      });
      const videoSource = new CanvasSource(exportCanvas, {
        codec: codecName,
        bitrate: quality,
        sizeChangeBehavior: 'deny',
        alpha: transparentBackground ? 'keep' : 'discard',
      });
      output.addVideoTrack(videoSource);
      let pendingAudioBuffer = null;
      let audioSource = null;

      if (includeAudio && bgmManager?.hasSource) {
        const audioBuffer = await bgmManager.getExportAudioBuffer(audioDurationSeconds, {
          offsetSeconds: Math.max(0, exportStartFrame / 30),
        });
        if (!audioBuffer) {
          throw new Error('Failed to build export audio buffer.');
        }

        const supportedAudioCodecs = filterVideoExportAudioCodecsForFormat(formatName);
        const availableAudioCodecs = typeof getEncodableAudioCodecs === 'function'
          ? await getEncodableAudioCodecs(supportedAudioCodecs, {
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
          })
          : supportedAudioCodecs;
        const audioCodec = resolveVideoExportAudioCodec(formatName, availableAudioCodecs);
        if (!audioCodec) {
          throw new Error(`No encodable audio codec is available for ${formatName}.`);
        }

        audioSource = new AudioBufferSource({
          codec: audioCodec,
          bitrate: resolveVideoExportAudioBitrate(audioCodec) ?? 128000,
        });
        output.addAudioTrack(audioSource, {
          name: bgmManager.fileName || 'BGM',
        });
        pendingAudioBuffer = audioBuffer;
      }

      try {
        this.onUiLockChange(options, true);
        this.exportRuntimeService?.prepareExportState?.(width, height, transparentBackground);
        await output.start();
        if (audioSource && pendingAudioBuffer) {
          await audioSource.add(pendingAudioBuffer);
        }

        let previousFrame = null;
        for (let i = 0; i < framePlan.length; i++) {
          if (this.cancelRequested) {
            await output.cancel();
            throw new Error('Video export canceled.');
          }

          const item = framePlan[i];
          const physicsStep = computeVideoExportPhysicsStep({
            previousFrame,
            currentFrame: item.frame,
            physicsTargetSpf: this.physicsEngine?.targetSPF,
          });
          this.exportRuntimeService?.seek?.(item.frame);
          this.exportRuntimeService?.refreshFrame?.(physicsStep);
          await this.exportRuntimeService?.waitForNextFrame?.();
          await this.exportRuntimeService?.waitForGpuIdle?.();
          await this.copyCurrentFrameToCanvas(exportCanvas, width, height, this.getCaptureTexture());
          await videoSource.add(item.timestamp, item.duration);
          options.onProgress?.((i + 1) / framePlan.length, `${i + 1}/${framePlan.length}`);
          previousFrame = item.frame;
        }

        await output.finalize();
        const buffer = output.target.buffer;
        if (!buffer) {
          throw new Error('Export buffer was not produced.');
        }

        const blob = new Blob([buffer], { type: formatInfo.mimeType });
        const filename = `openmmd-export${formatInfo.fileExtension}`;
        return { blob, filename, mimeType: formatInfo.mimeType };
      } finally {
        this.onUiLockChange(options, false);
        if (originalState) {
          this.exportRuntimeService?.restoreExportState?.(originalState);
        }
      }
    } finally {
      this.isExporting = false;
    }
  }

  /**
   * 現在フレームを PNG で保存します。
   * @param {object} options - 保存オプション。
   * @param {number} options.width - 出力幅。
   * @param {number} options.height - 出力高さ。
   * @returns {Promise<{ blob: Blob, filename: string, mimeType: string }>} 保存結果。
   */
  async saveCurrentFrameAsPng(options) {
    if (this.isExporting) {
      throw new Error('Video export is already running.');
    }

    this.isExporting = true;
    this.cancelRequested = false;
    try {
      const width = Math.max(1, Math.round(options.width));
      const height = Math.max(1, Math.round(options.height));
      const activeInstance = this.exportRuntimeService?.getActiveInstance?.() ?? null;
      if (!activeInstance) {
        throw new Error('No active model to export.');
      }

      const snapshot = this.exportRuntimeService?.snapshotExportState?.() ?? null;
      const currentFrame = this.exportRuntimeService?.getCurrentFrame?.()
        ?? activeInstance.animationController.currentFrame
        ?? 0;
      const exportCanvas = this.createExportCanvas(width, height);

      try {
        this.exportRuntimeService?.prepareExportState?.(width, height, 0);
        this.exportRuntimeService?.seek?.(currentFrame);
        this.exportRuntimeService?.refreshFrame?.(0);
        await this.exportRuntimeService?.waitForNextFrame?.();
        await this.exportRuntimeService?.waitForGpuIdle?.();

        await this.copyCurrentFrameToCanvas(exportCanvas, width, height, this.getCaptureTexture());
        const blob = await this.canvasToBlob(exportCanvas);
        return {
          blob,
          filename: 'openmmd-frame.png',
          mimeType: 'image/png',
        };
      } finally {
        if (snapshot) {
          this.exportRuntimeService?.restoreExportState?.(snapshot);
        }
      }
    } finally {
      this.isExporting = false;
    }
  }

  /**
   * 現在の表示フレームを保持している texture を返します。
   * @returns {GPUTexture|null} capture texture。
   */
  getCaptureTexture() {
    return typeof this.canvasTargets?.getCaptureTexture === 'function'
      ? this.canvasTargets.getCaptureTexture()
      : null;
  }

  /**
   * export 用の canvas を作成します。
   * @param {number} width - 幅。
   * @param {number} height - 高さ。
   * @returns {HTMLCanvasElement|OffscreenCanvas} export canvas。
   */
  createExportCanvas(width, height) {
    if (this.createExportCanvasAdapter) {
      return this.createExportCanvasAdapter(width, height);
    }
    throw new Error('Video export canvas adapter is not configured.');
  }

  /**
   * 現在の WebGPU フレームを export canvas にコピーします。
   * @param {HTMLCanvasElement|OffscreenCanvas} exportCanvas - 書き出し先 canvas。
   * @param {number} width - 幅。
   * @param {number} height - 高さ。
   * @param {GPUTexture|null|undefined} sourceTexture - 読み出し元 texture。
   * @returns {Promise<void>} 完了 Promise。
   */
  async copyCurrentFrameToCanvas(exportCanvas, width, height, sourceTexture) {
    const canvas = exportCanvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Failed to create 2D context for video export.');
    }

    if (!sourceTexture) {
      context.clearRect(0, 0, width, height);
      return;
    }

    const bytesPerPixel = 4;
    const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: sourceTexture },
      {
        buffer,
        bytesPerRow,
        rowsPerImage: height,
      },
      {
        width,
        height,
        depthOrArrayLayers: 1,
      },
    );
    this.device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    try {
      const mapped = new Uint8Array(buffer.getMappedRange());
      const pixels = new Uint8ClampedArray(width * height * bytesPerPixel);
      const isBgra = this.isBgraPresentationFormat();
      for (let y = 0; y < height; y++) {
        const sourceRowOffset = y * bytesPerRow;
        const targetRowOffset = y * width * bytesPerPixel;
        for (let x = 0; x < width; x++) {
          const sourceIndex = sourceRowOffset + (x * bytesPerPixel);
          const targetIndex = targetRowOffset + (x * bytesPerPixel);
          if (isBgra) {
            pixels[targetIndex + 0] = mapped[sourceIndex + 2] ?? 0;
            pixels[targetIndex + 1] = mapped[sourceIndex + 1] ?? 0;
            pixels[targetIndex + 2] = mapped[sourceIndex + 0] ?? 0;
            pixels[targetIndex + 3] = mapped[sourceIndex + 3] ?? 255;
          } else {
            pixels[targetIndex + 0] = mapped[sourceIndex + 0] ?? 0;
            pixels[targetIndex + 1] = mapped[sourceIndex + 1] ?? 0;
            pixels[targetIndex + 2] = mapped[sourceIndex + 2] ?? 0;
            pixels[targetIndex + 3] = mapped[sourceIndex + 3] ?? 255;
          }
        }
      }

      canvas.width = width;
      canvas.height = height;
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
    } finally {
      buffer.unmap();
      buffer.destroy();
    }
  }

  /**
   * canvas を PNG Blob に変換します。
   * @param {HTMLCanvasElement|OffscreenCanvas} exportCanvas - 変換対象 canvas。
   * @returns {Promise<Blob>} PNG Blob。
   */
  async canvasToBlob(exportCanvas) {
    if (this.canvasToBlobAdapter) {
      return this.canvasToBlobAdapter(exportCanvas);
    }
    throw new Error('Video export PNG adapter is not configured.');
  }

  /**
   * 現在の presentation format が BGRA 系かを返します。
   * @returns {boolean} BGRA 系かどうか。
   */
  isBgraPresentationFormat() {
    return this.presentationFormat === 'bgra8unorm' || this.presentationFormat === 'bgra8unorm-srgb';
  }

  /**
   * 背景透過書き出しに対応する形式かどうか返します。
   * @param {VideoExportFormatName|string} formatName - コンテナ形式。
   * @returns {boolean} 対応有無。
   */
  supportsTransparentBackground(formatName) {
    return supportsVideoExportTransparency(normalizeVideoExportFormat(formatName));
  }

  /**
   * UI lock を切り替えます。
   * @param {object} options - export オプション。
   * @param {boolean} locked - ロック状態。
   */
  onUiLockChange(options, locked) {
    if (typeof options.onUiLockChange === 'function') {
      options.onUiLockChange(locked);
    }
  }
}
