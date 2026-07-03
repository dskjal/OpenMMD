import assert from 'node:assert/strict';
import test from 'node:test';

import { setupVideoExportUI } from '../source/ui/renderer-ui.js';

/**
 * Creates a fake DOM element.
 * @param {string} [initialValue=''] - Initial value.
 * @returns {object} Fake element.
 */
function createFakeElement(initialValue = '') {
  const listeners = new Map();
  const element = {
    checked: false,
    children: [],
    classList: {
      toggle() {},
    },
    dataset: {},
    disabled: false,
    hidden: false,
    listeners,
    style: {},
    textContent: '',
    value: String(initialValue),
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    remove() {},
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML || '';
    },
    set(value) {
      this._innerHTML = String(value);
      this.children = [];
    },
  });

  Object.defineProperty(element, 'options', {
    get() {
      return this.children;
    },
  });

  return element;
}

/**
 * Installs a fake DOM environment for the video export UI.
 * @returns {{document: object, restore: Function}} Fake DOM helpers.
 */
function installFakeDom() {
  const elements = new Map();
  const viewportCanvas = {
    clientWidth: 1280,
    clientHeight: 720,
    width: 1280,
    height: 720,
  };
  const document = {
    body: createFakeElement(),
    createElement() {
      return createFakeElement();
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    },
    querySelector(selector) {
      return selector === '#viewport canvas' ? viewportCanvas : null;
    },
  };
  const window = {
    addEventListener() {},
    clearTimeout() {},
    setTimeout(handler) {
      handler();
      return 1;
    },
  };

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;

  const ids = [
    'video-export-format',
    'video-export-codec',
    'video-export-quality',
    'video-export-width',
    'video-export-height',
    'video-export-transparent-background',
    'video-export-save-png-button',
    'video-export-include-audio',
    'video-export-button',
    'video-export-cancel',
    'video-export-overlay',
    'video-export-progress',
    'video-export-progress-label',
    'video-export-status',
  ];
  for (const id of ids) {
    document.getElementById(id);
  }
  document.getElementById('video-export-format').value = 'mp4';
  document.getElementById('video-export-format').children = [
    { value: 'mp4', textContent: 'MP4', selected: true },
    { value: 'webm', textContent: 'WebM', selected: false },
    { value: 'mov', textContent: 'MOV', selected: false },
    { value: 'mkv', textContent: 'MKV', selected: false },
  ];
  document.getElementById('video-export-quality').value = 'medium';
  document.getElementById('video-export-width').value = '1280';
  document.getElementById('video-export-height').value = '720';

  return {
    document,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

test('setupVideoExportUI enables transparent background only for supported formats', async () => {
  const dom = installFakeDom();
  const videoExportManager = {
    isExporting: false,
    async getAvailableCodecs({ format }) {
      return format === 'webm' ? ['vp9'] : ['avc'];
    },
    cancel() {},
  };

  try {
    setupVideoExportUI({
      videoExportManager,
      appFacade: {
        editing: {
          getActiveInstance() {
            return null;
          },
        },
      },
      getPlaybackRange() {
        return { start: 0, end: 30 };
      },
      rendererState: {
        internalResolution: 'auto',
        renderingFPS: 60,
      },
      getLangData() {
        return {};
      },
      bgmManager: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const formatSelect = dom.document.getElementById('video-export-format');
    const transparentCheckbox = dom.document.getElementById('video-export-transparent-background');
    assert.equal(transparentCheckbox.disabled, true);

    formatSelect.value = 'webm';
    for (const handler of formatSelect.listeners.get('change') || []) {
      handler({ target: formatSelect });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(transparentCheckbox.disabled, false);

    transparentCheckbox.checked = true;
    formatSelect.value = 'mp4';
    for (const handler of formatSelect.listeners.get('change') || []) {
      handler({ target: formatSelect });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(transparentCheckbox.disabled, true);
    assert.equal(transparentCheckbox.checked, false);
  } finally {
    dom.restore();
  }
});
