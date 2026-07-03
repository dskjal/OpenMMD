import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RENDER_ASPECT_RATIO,
  findAspectPreset,
  getResolutionOptionsForAspect,
} from '../source/shared/render/render-aspect-presets.js';
import { syncViewportLayout } from '../source/ui/viewport-layout.js';

test('render aspect presets expose the default 16:9 layout and candidate list', () => {
  assert.equal(findAspectPreset(DEFAULT_RENDER_ASPECT_RATIO).id, '16:9');
  assert.equal(findAspectPreset('invalid-id').id, '16:9');
  assert.deepEqual(getResolutionOptionsForAspect('2:1'), [
    '1440x720',
    '2160x1080',
    '2880x1440',
    '4000x2040',
    '5120x2560',
  ]);
  assert.deepEqual(getResolutionOptionsForAspect('9:16'), [
    '540x960',
    '720x1280',
    '1080x1920',
    '1440x2560',
    '2160x3840',
    '3240x5760',
  ]);
});

test('syncViewportLayout toggles portrait and fullscreen body classes', () => {
  const classNames = new Set();
  const cssVars = new Map();
  const previousDocument = globalThis.document;

  globalThis.document = {
    body: {
      dataset: {},
      classList: {
        toggle(name, force) {
          if (force) {
            classNames.add(name);
          } else {
            classNames.delete(name);
          }
        },
        contains(name) {
          return classNames.has(name);
        },
      },
    },
    documentElement: {
      style: {
        setProperty(name, value) {
          cssVars.set(name, value);
        },
      },
    },
  };

  try {
    syncViewportLayout({ aspectRatioId: '9:16', isFullscreen: true });
    assert.equal(classNames.has('app-fullscreen'), true);
    assert.equal(classNames.has('is-portrait-render-layout'), true);
    assert.equal(globalThis.document.body.dataset.renderAspectRatio, '9:16');
    assert.equal(cssVars.get('--render-aspect-ratio'), '9 / 16');

    syncViewportLayout({ aspectRatioId: '16:9', isFullscreen: false });
    assert.equal(classNames.has('app-fullscreen'), false);
    assert.equal(classNames.has('is-portrait-render-layout'), false);
    assert.equal(globalThis.document.body.dataset.renderAspectRatio, '16:9');
    assert.equal(cssVars.get('--render-aspect-ratio'), '16 / 9');
  } finally {
    globalThis.document = previousDocument;
  }
});
