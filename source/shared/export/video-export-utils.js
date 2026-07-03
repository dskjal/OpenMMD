import {
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  QUALITY_VERY_LOW,
} from '../../lib/mediabunny.min.mjs';

/** @typedef {'mp4'|'webm'|'mov'|'mkv'} VideoExportFormatName */
/** @typedef {'avc'|'hevc'|'vp9'|'av1'|'vp8'} VideoExportCodecName */
/** @typedef {'aac'|'opus'|'mp3'|'vorbis'|'flac'} VideoExportAudioCodecName */
/** @typedef {'very-low'|'low'|'medium'|'high'|'very-high'} VideoExportQualityName */

/** @type {readonly VideoExportCodecName[]} */
export const VIDEO_EXPORT_CODEC_ORDER = Object.freeze(['avc', 'hevc', 'vp9', 'av1', 'vp8']);

/** @type {readonly VideoExportAudioCodecName[]} */
export const VIDEO_EXPORT_AUDIO_CODEC_ORDER = Object.freeze(['aac', 'opus', 'mp3', 'vorbis', 'flac']);

/** @type {readonly VideoExportQualityName[]} */
export const VIDEO_EXPORT_QUALITY_ORDER = Object.freeze(['very-low', 'low', 'medium', 'high', 'very-high']);

/** @type {Record<VideoExportFormatName, readonly VideoExportCodecName[]>} */
const VIDEO_EXPORT_FORMAT_CODECS = Object.freeze({
  mp4: Object.freeze(['avc', 'hevc', 'av1']),
  webm: Object.freeze(['vp9', 'av1', 'vp8']),
  mov: Object.freeze(['avc', 'hevc', 'av1']),
  mkv: Object.freeze(['avc', 'hevc', 'vp9', 'av1', 'vp8']),
});

/** @type {Record<VideoExportFormatName, readonly VideoExportAudioCodecName[]>} */
const VIDEO_EXPORT_FORMAT_AUDIO_CODECS = Object.freeze({
  mp4: Object.freeze(['aac']),
  webm: Object.freeze(['opus']),
  mov: Object.freeze(['aac']),
  mkv: Object.freeze(['opus', 'aac', 'mp3', 'vorbis', 'flac']),
});

/** @type {readonly VideoExportFormatName[]} */
const VIDEO_EXPORT_TRANSPARENT_FORMATS = Object.freeze(['webm', 'mkv']);

/** @type {Record<VideoExportAudioCodecName, number>} */
const VIDEO_EXPORT_AUDIO_CODEC_BITRATES = Object.freeze({
  aac: 128_000,
  opus: 64_000,
  mp3: 160_000,
  vorbis: 64_000,
  flac: 0,
});

/** @type {Record<VideoExportQualityName, import('./lib/mediabunny.min.mjs').Quality>} */
const VIDEO_EXPORT_QUALITIES = Object.freeze({
  'very-low': QUALITY_VERY_LOW,
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  'very-high': QUALITY_VERY_HIGH,
});

const EXPORT_SOURCE_FPS = 30;

/**
 * Video export format 名を正規化します。
 * @param {string} value - 入力値。
 * @returns {VideoExportFormatName} 正規化された形式。
 */
export function normalizeVideoExportFormat(value) {
  const normalized = String(value || '').toLowerCase();
  return /** @type {VideoExportFormatName} */ (VIDEO_EXPORT_FORMAT_CODECS[normalized] ? normalized : 'mp4');
}

/**
 * Video export codec 名を正規化します。
 * @param {string} value - 入力値。
 * @returns {VideoExportCodecName} 正規化された codec。
 */
export function normalizeVideoExportCodec(value) {
  const normalized = String(value || '').toLowerCase();
  return /** @type {VideoExportCodecName} */ (VIDEO_EXPORT_CODEC_ORDER.includes(normalized) ? normalized : 'avc');
}

/**
 * Video export quality 名を正規化します。
 * @param {string} value - 入力値。
 * @returns {VideoExportQualityName} 正規化された quality。
 */
export function normalizeVideoExportQuality(value) {
  const normalized = String(value || '').toLowerCase();
  return /** @type {VideoExportQualityName} */ (VIDEO_EXPORT_QUALITY_ORDER.includes(normalized) ? normalized : 'medium');
}

/**
 * Video export quality 文字列から Mediabunny の Quality を返します。
 * @param {string} value - 入力値。
 * @returns {import('./lib/mediabunny.min.mjs').Quality} Quality。
 */
export function resolveVideoExportQuality(value) {
  const normalized = normalizeVideoExportQuality(value);
  return VIDEO_EXPORT_QUALITIES[normalized];
}

/**
 * コンテナが codec を受け入れるか判定します。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @param {VideoExportCodecName} codecName - codec 名。
 * @returns {boolean} 対応有無。
 */
export function isVideoExportCodecCompatible(formatName, codecName) {
  return VIDEO_EXPORT_FORMAT_CODECS[formatName]?.includes(codecName) ?? false;
}

/**
 * フォーマットに対して使える codec 候補を返します。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @param {readonly VideoExportCodecName[]} codecs - 候補一覧。
 * @returns {VideoExportCodecName[]} 対応 codec 一覧。
 */
export function filterVideoExportCodecsForFormat(formatName, codecs = VIDEO_EXPORT_CODEC_ORDER) {
  return codecs.filter((codec) => isVideoExportCodecCompatible(formatName, codec));
}

/**
 * コンテナに対して使える audio codec 候補を返します。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @param {readonly VideoExportAudioCodecName[]} [codecs=VIDEO_EXPORT_AUDIO_CODEC_ORDER] - 候補一覧。
 * @returns {VideoExportAudioCodecName[]} 対応 audio codec 一覧。
 */
export function filterVideoExportAudioCodecsForFormat(formatName, codecs = VIDEO_EXPORT_AUDIO_CODEC_ORDER) {
  const supported = VIDEO_EXPORT_FORMAT_AUDIO_CODECS[formatName] ?? [];
  return codecs.filter((codec) => supported.includes(codec));
}

/**
 * コンテナが背景透過動画を書き出せるか返します。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @returns {boolean} 対応有無。
 */
export function supportsVideoExportTransparency(formatName) {
  return VIDEO_EXPORT_TRANSPARENT_FORMATS.includes(formatName);
}

/**
 * 背景透過指定をフォーマットに合わせて正規化します。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @param {boolean|undefined|null} enabled - 指定値。
 * @returns {boolean} 正規化された指定。
 */
export function normalizeVideoExportTransparentBackground(formatName, enabled) {
  return supportsVideoExportTransparency(formatName) && enabled === true;
}

/**
 * audio codec の優先順位に従って利用可能な codec を選びます。
 * @param {VideoExportFormatName} formatName - コンテナ形式。
 * @param {readonly VideoExportAudioCodecName[]} [availableCodecs=VIDEO_EXPORT_AUDIO_CODEC_ORDER] - 利用可能 codec。
 * @returns {VideoExportAudioCodecName|null} 選択された codec。
 */
export function resolveVideoExportAudioCodec(formatName, availableCodecs = VIDEO_EXPORT_AUDIO_CODEC_ORDER) {
  const supported = VIDEO_EXPORT_FORMAT_AUDIO_CODECS[formatName] ?? [];
  const availableSet = new Set(availableCodecs);
  for (const codec of supported) {
    if (availableSet.has(codec)) {
      return codec;
    }
  }
  return null;
}

/**
 * audio codec の既定 bitrate を返します。
 * @param {VideoExportAudioCodecName} codecName - audio codec 名。
 * @returns {number|null} 既定 bitrate。
 */
export function resolveVideoExportAudioBitrate(codecName) {
  const bitrate = VIDEO_EXPORT_AUDIO_CODEC_BITRATES[codecName];
  return bitrate > 0 ? bitrate : null;
}

/**
 * AudioBuffer からチャネルごとの export 用データを構築します。
 * @param {object} sourceBuffer - source buffer。
 * @param {number} durationSeconds - 出力時間。
 * @param {object} [options] - 生成オプション。
 * @param {boolean} [options.loop=false] - ループ時は先頭から繰り返す。
 * @param {number} [options.gain=1] - 出力音量。
 * @param {number} [options.offsetSeconds=0] - source の読み出し開始秒。
 * @returns {{ channelData: Float32Array[], sampleRate: number, length: number, numberOfChannels: number }} 生成結果。
 */
export function composeAudioBufferChannelData(sourceBuffer, durationSeconds, options = {}) {
  const sampleRate = Math.max(1, Math.round(Number(sourceBuffer?.sampleRate) || 48000));
  const numberOfChannels = Math.max(1, Math.round(Number(sourceBuffer?.numberOfChannels) || 1));
  const sourceLength = Math.max(0, Math.floor(Number(sourceBuffer?.length) || 0));
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const length = Math.max(0, Math.round(duration * sampleRate));
  const loop = options.loop === true;
  const gain = Number.isFinite(options.gain) ? options.gain : 1;
  const offsetSeconds = Math.max(0, Number(options.offsetSeconds) || 0);
  const offsetFrames = Math.max(0, Math.floor(offsetSeconds * sampleRate));
  const channelData = [];

  for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex++) {
    const target = new Float32Array(length);
    const source = typeof sourceBuffer?.getChannelData === 'function'
      ? sourceBuffer.getChannelData(channelIndex)
      : null;
    if (!source || sourceLength === 0) {
      channelData.push(target);
      continue;
    }

    for (let frameIndex = 0; frameIndex < length; frameIndex++) {
      let sourceIndex = offsetFrames + frameIndex;
      if (sourceIndex >= sourceLength) {
        if (!loop) {
          break;
        }
        sourceIndex %= sourceLength;
      }
      target[frameIndex] = (source[sourceIndex] || 0) * gain;
    }
    channelData.push(target);
  }

  return {
    channelData,
    sampleRate,
    length,
    numberOfChannels,
  };
}

/**
 * 書き出しフレーム列を構築します。
 * @param {object} options - 生成オプション。
 * @param {number} options.startFrame - 開始フレーム。
 * @param {number} options.endFrame - 終了フレーム。
 * @param {number} options.exportFps - 出力 fps。
 * @param {number} [options.sourceFps=30] - 元のフレーム系 fps。
 * @returns {Array<{ frame: number, timestamp: number, duration: number }>} フレーム計画。
 */
export function buildVideoExportFramePlan(options) {
  const startFrame = Number.isFinite(options.startFrame) ? options.startFrame : 0;
  const endFrame = Number.isFinite(options.endFrame) ? Math.max(startFrame, options.endFrame) : startFrame;
  const exportFps = Math.max(1, Number.isFinite(options.exportFps) ? options.exportFps : 60);
  const sourceFps = Math.max(1, Number.isFinite(options.sourceFps) ? options.sourceFps : EXPORT_SOURCE_FPS);
  const step = sourceFps / exportFps;
  const duration = 1 / exportFps;
  const frames = [];
  const frameCount = Math.max(1, Math.ceil((endFrame - startFrame) / step) + 1);

  for (let index = 0; index < frameCount; index++) {
    const frame = Math.min(endFrame, startFrame + (index * step));
    frames.push({
      frame,
      timestamp: index * duration,
      duration,
    });
  }

  return frames;
}

/**
 * 書き出しフレーム差分から物理演算ステップ量を算出します。
 * @param {object} options - 算出オプション。
 * @param {number|null|undefined} options.previousFrame - 直前に書き出したフレーム。
 * @param {number} options.currentFrame - 現在の書き出しフレーム。
 * @param {number} [options.sourceFps=30] - VMD フレーム系 fps。
 * @param {number} [options.physicsTargetSpf=1 / 60] - PhysicsEngine.targetSPF。
 * @returns {number} PhysicsEngine.update に渡すステップ量。
 */
export function computeVideoExportPhysicsStep(options) {
  const currentFrame = Number.isFinite(options.currentFrame) ? options.currentFrame : 0;
  const previousFrame = Number.isFinite(options.previousFrame) ? options.previousFrame : null;
  if (previousFrame === null) {
    return 0;
  }

  const sourceFps = Math.max(1, Number.isFinite(options.sourceFps) ? options.sourceFps : EXPORT_SOURCE_FPS);
  const physicsTargetSpf = Math.max(1e-6, Number.isFinite(options.physicsTargetSpf) ? options.physicsTargetSpf : (1 / 60));
  const deltaFrame = Math.max(0, currentFrame - previousFrame);
  const deltaSeconds = deltaFrame / sourceFps;
  return deltaSeconds / physicsTargetSpf;
}
