import { DEFAULT_RENDER_ASPECT_RATIO, findAspectPreset } from '../shared/render/render-aspect-presets.js';

/**
 * 現在のレンダリングアスペクト比に応じて body クラスと CSS 変数を同期します。
 * @param {object} [options={}] - 同期オプション。
 * @param {string} [options.aspectRatioId] - レンダリング用アスペクト比 ID。
 * @param {boolean} [options.isFullscreen] - フルスクリーン状態。
 */
export function syncViewportLayout(options = {}) {
  if (typeof document === 'undefined' || !document.body || !document.documentElement) {
    return;
  }

  const aspectRatioId = options.aspectRatioId
    || document.body.dataset.renderAspectRatio
    || DEFAULT_RENDER_ASPECT_RATIO;
  const preset = findAspectPreset(aspectRatioId);
  const isFullscreen = typeof options.isFullscreen === 'boolean'
    ? options.isFullscreen
    : document.body.classList.contains('app-fullscreen');

  document.body.classList.toggle('app-fullscreen', isFullscreen);
  document.body.classList.toggle('is-portrait-render-layout', preset.isPortrait);
  document.body.dataset.renderAspectRatio = preset.id;
  document.documentElement.style.setProperty('--render-aspect-ratio', preset.cssAspectRatio);
}
