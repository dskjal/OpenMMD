/**
 * レンダリング用アスペクト比プリセット定義。
 * @typedef {object} RenderAspectPreset
 * @property {string} id - 選択子で使うアスペクト比 ID。
 * @property {string} label - 表示ラベル。
 * @property {string} cssAspectRatio - CSS `aspect-ratio` に指定する値。
 * @property {boolean} isPortrait - 縦長レイアウトかどうか。
 * @property {string} defaultResolution - 既定の内部解像度。
 * @property {string[]} resolutionOptions - 内部解像度候補。
 */

/**
 * レンダリング用のアスペクト比プリセット一覧。
 * @type {ReadonlyArray<RenderAspectPreset>}
 */
export const RENDER_ASPECT_PRESETS = Object.freeze([
  Object.freeze({
    id: '16:9',
    label: '16:9',
    cssAspectRatio: '16 / 9',
    isPortrait: false,
    defaultResolution: '1920x1080',
    resolutionOptions: Object.freeze([
      '960x540',
      '1280x720',
      '1920x1080',
      '2560x1440',
      '3840x2160',
      '5760x3240',
    ]),
  }),
  Object.freeze({
    id: '9:16',
    label: '9:16',
    cssAspectRatio: '9 / 16',
    isPortrait: true,
    defaultResolution: '1080x1920',
    resolutionOptions: Object.freeze([
      '540x960',
      '720x1280',
      '1080x1920',
      '1440x2560',
      '2160x3840',
      '3240x5760',
    ]),
  }),
  Object.freeze({
    id: '2:1',
    label: '2:1',
    cssAspectRatio: '2 / 1',
    isPortrait: false,
    defaultResolution: '2160x1080',
    resolutionOptions: Object.freeze([
      '1440x720',
      '2160x1080',
      '2880x1440',
      '4000x2040',
      '5120x2560',
    ]),
  }),
  Object.freeze({
    id: '1:2',
    label: '1:2',
    cssAspectRatio: '1 / 2',
    isPortrait: true,
    defaultResolution: '1080x2160',
    resolutionOptions: Object.freeze([
      '720x1440',
      '1080x2160',
      '1440x2880',
      '2040x4000',
      '2560x5120',
    ]),
  }),
  Object.freeze({
    id: '3:2',
    label: '3:2',
    cssAspectRatio: '3 / 2',
    isPortrait: false,
    defaultResolution: '1920x1280',
    resolutionOptions: Object.freeze([
      '960x640',
      '1440x960',
      '1920x1280',
      '3840x2560',
      '4800x3200',
    ]),
  }),
  Object.freeze({
    id: '2:3',
    label: '2:3',
    cssAspectRatio: '2 / 3',
    isPortrait: true,
    defaultResolution: '1280x1920',
    resolutionOptions: Object.freeze([
      '640x960',
      '960x1440',
      '1280x1920',
      '2560x3840',
      '3200x4800',
    ]),
  }),
  Object.freeze({
    id: '4:3',
    label: '4:3',
    cssAspectRatio: '4 / 3',
    isPortrait: false,
    defaultResolution: '2048x1536',
    resolutionOptions: Object.freeze([
      '800x600',
      '1024x768',
      '1600x1200',
      '2048x1536',
      '4096x3072',
      '4800x3600',
    ]),
  }),
  Object.freeze({
    id: '3:4',
    label: '3:4',
    cssAspectRatio: '3 / 4',
    isPortrait: true,
    defaultResolution: '1536x2048',
    resolutionOptions: Object.freeze([
      '600x800',
      '768x1024',
      '1200x1600',
      '1536x2048',
      '3072x4096',
      '3600x4800',
    ]),
  }),
  Object.freeze({
    id: '5:4',
    label: '5:4',
    cssAspectRatio: '5 / 4',
    isPortrait: false,
    defaultResolution: '1280x1024',
    resolutionOptions: Object.freeze([
      '1280x1024',
      '2560x2048',
      '3840x3072',
      '5120x4096',
    ]),
  }),
  Object.freeze({
    id: '4:5',
    label: '4:5',
    cssAspectRatio: '4 / 5',
    isPortrait: true,
    defaultResolution: '1024x1280',
    resolutionOptions: Object.freeze([
      '1024x1280',
      '2048x2560',
      '3072x3840',
      '4096x5120',
    ]),
  }),
]);

/**
 * 既定のレンダリング用アスペクト比 ID。
 * @type {string}
 */
export const DEFAULT_RENDER_ASPECT_RATIO = '16:9';

/**
 * 指定したアスペクト比のプリセットを返します。
 * @param {string} aspectRatioId - アスペクト比 ID。
 * @returns {RenderAspectPreset} プリセット。
 */
export function findAspectPreset(aspectRatioId) {
  const normalizedId = String(aspectRatioId || DEFAULT_RENDER_ASPECT_RATIO);
  return RENDER_ASPECT_PRESETS.find((preset) => preset.id === normalizedId)
    ?? RENDER_ASPECT_PRESETS.find((preset) => preset.id === DEFAULT_RENDER_ASPECT_RATIO)
    ?? RENDER_ASPECT_PRESETS[0];
}

/**
 * 指定したアスペクト比の内部解像度候補を返します。
 * @param {string} aspectRatioId - アスペクト比 ID。
 * @returns {string[]} 内部解像度候補。
 */
export function getResolutionOptionsForAspect(aspectRatioId) {
  return [...findAspectPreset(aspectRatioId).resolutionOptions];
}
