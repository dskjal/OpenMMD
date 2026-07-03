import assert from 'node:assert/strict';
import test from 'node:test';

import { setupUIHandlers } from '../source/ui/renderer-ui.js';

function createFakeElement(initialValue = '') {
  const listeners = new Map();
  const element = {
    attributes: {},
    checked: false,
    children: [],
    classList: {
      _values: new Set(),
      add(...values) {
        for (const value of values) {
          this._values.add(value);
        }
      },
      remove(...values) {
        for (const value of values) {
          this._values.delete(value);
        }
      },
      contains(value) {
        return this._values.has(value);
      },
      toggle(value, force) {
        if (force === true) {
          this._values.add(value);
          return true;
        }
        if (force === false) {
          this._values.delete(value);
          return false;
        }
        if (this._values.has(value)) {
          this._values.delete(value);
          return false;
        }
        this._values.add(value);
        return true;
      },
    },
    dataset: {},
    disabled: false,
    hidden: false,
    listeners,
    parentElement: null,
    style: {},
    textContent: '',
    title: '',
    value: String(initialValue),
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    append(...nodes) {
      for (const node of nodes) {
        if (!node) {
          continue;
        }
        node.parentElement = this;
        this.children.push(node);
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    contains(node) {
      let current = node;
      while (current) {
        if (current === this) {
          return true;
        }
        current = current.parentElement || null;
      }
      return false;
    },
    click() {
      for (const handler of listeners.get('click') || []) {
        handler({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
      }
    },
    focus() {
      this.isFocused = true;
    },
    remove() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'aria-hidden') {
        this.ariaHidden = String(value);
      }
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (selector === '[data-model-visibility-index]' && current.dataset.modelVisibilityIndex !== undefined) {
          return current;
        }
        if (selector === '[data-model-delete-index]' && current.dataset.modelDeleteIndex !== undefined) {
          return current;
        }
        if (selector === '[data-model-index]' && current.dataset.modelIndex !== undefined) {
          return current;
        }
        current = current.parentElement || null;
      }
      return null;
    },
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

  return element;
}

function installFakeDom() {
  const elements = new Map();
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
  };
  const window = {
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    listeners: {},
  };

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;

  const ids = [
    'model-list',
    'vmd-list',
    'save-vmd',
    'delete-vmd',
    'timeline-delete-key',
    'playback-range-start',
    'playback-range-end',
    'animation-export-overlay',
    'animation-export-dialog',
    'animation-export-title',
    'animation-export-format-group',
    'animation-export-format-legend',
    'animation-export-format-vmd',
    'animation-export-format-vrma',
    'animation-export-vrma-options',
    'animation-export-vrma-ik-group',
    'animation-export-vrma-ik-legend',
    'animation-export-vrma-ik-to-rotation',
    'animation-export-vrma-ik-as-is',
    'animation-export-vrma-lower-body-group',
    'animation-export-vrma-lower-body-legend',
    'animation-export-vrma-lower-body-bake',
    'animation-export-vrma-lower-body-skip',
    'animation-export-save',
  ];
  for (const id of ids) {
    document.getElementById(id);
  }

  return {
    document,
    elements,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

function createModelManager(magic) {
  return {
    instances: [
      {
        model: {
          magic,
          name: `${magic} Model`,
        },
        animationSourceType: magic === 'Vrm' ? 'vrma' : 'vmd',
        animationSourceName: `${magic} Motion`,
        animationSource: {
          kind: magic === 'Vrm' ? 'vrma' : 'vmd',
          name: `${magic} Motion`,
        },
        gltfAnimationSources: [],
        visible: true,
      },
    ],
  };
}

function createCommonOptions(modelManager, selection, downloadSpy) {
  const activeInstance = modelManager.instances[selection.activeInstanceIndex] || null;
  return {
    appFacade: {
      export: {
        downloadSceneAnimationSource: async (...args) => downloadSpy?.scene?.(...args),
        downloadActiveAnimationSource: async (...args) => downloadSpy?.active?.(...args),
      },
      playback: {
        togglePlayback() {},
        rewind() {},
        stepFrame() {},
        stepKeyframe() {},
        goToEnd() {},
        setPlaybackRange() {},
        getPlaybackRange() { return { start: 0, end: null }; },
        syncBgmPlayback() {},
      },
      editing: {
        activateInstance() {},
        removeModelAtIndex() {},
        setModelVisibility() {},
      },
      ui: {
        getModelListState() {
          return {
            activeIndex: selection.activeInstanceIndex,
            items: modelManager.instances.map((instance, index) => ({
              index,
              name: instance.model?.name || `Model ${index}`,
              visible: instance.visible !== false,
            })),
          };
        },
        getAnimationSourceListState() {
          return { entries: [], selectedValue: '', canDeleteSelected: false };
        },
        getActiveAnimationExportState() {
          if (!activeInstance) {
            return null;
          }
          return {
            activeInstance,
            exportMode: activeInstance.animationSourceType === 'gltf' && activeInstance.model?.magic !== 'Vrm'
              ? 'direct'
              : 'dialog',
            defaultFormat: activeInstance.model?.magic === 'Vrm' ? 'vrma' : 'vmd',
            defaultBakeIkToRotation: true,
            defaultBakeLowerBodyToHumanoid: true,
          };
        },
      },
    },
    getLangData() {
      return {};
    },
  };
}

test('animation export dialog defaults to VRMA for VRM models and forwards the selected options', async () => {
  const dom = installFakeDom();
  const modelManager = createModelManager('Vrm');
  const selection = { activeInstanceIndex: 0 };
  const downloadCalls = [];

  try {
    setupUIHandlers(createCommonOptions(modelManager, selection, {
      active: async (options) => {
        downloadCalls.push(options);
      },
    }));

    dom.document.getElementById('save-vmd').click();
    assert.equal(dom.document.getElementById('animation-export-overlay').hidden, false);
    assert.equal(dom.document.getElementById('animation-export-format-vmd').checked, false);
    assert.equal(dom.document.getElementById('animation-export-format-vrma').checked, true);
    assert.equal(dom.document.getElementById('animation-export-vrma-options').hidden, false);
    assert.equal(dom.document.getElementById('animation-export-vrma-ik-to-rotation').checked, true);
    assert.equal(dom.document.getElementById('animation-export-vrma-lower-body-bake').checked, true);

    dom.document.getElementById('animation-export-save').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(dom.document.getElementById('animation-export-overlay').hidden, true);
    assert.deepEqual(downloadCalls, [
      {
        exportFormat: 'vrma',
        bakeIkToRotation: true,
        bakeLowerBodyToHumanoid: true,
      },
    ]);
  } finally {
    dom.restore();
  }
});

test('animation export dialog stays hidden until the save button is clicked', async () => {
  const dom = installFakeDom();
  const modelManager = createModelManager('Vrm');
  const selection = { activeInstanceIndex: 0 };

  try {
    dom.document.getElementById('animation-export-overlay').hidden = true;
    dom.document.getElementById('animation-export-vrma-options').hidden = true;
    setupUIHandlers(createCommonOptions(modelManager, selection));

    assert.equal(dom.document.getElementById('animation-export-overlay').hidden, true);
    assert.equal(dom.document.getElementById('animation-export-vrma-options').hidden, true);
  } finally {
    dom.restore();
  }
});

test('animation export dialog defaults to VMD for PMX models and hides VRMA options until selected', async () => {
  const dom = installFakeDom();
  const modelManager = createModelManager('Pmx');
  const selection = { activeInstanceIndex: 0 };
  const downloadCalls = [];

  try {
    setupUIHandlers(createCommonOptions(modelManager, selection, {
      active: async (options) => {
        downloadCalls.push(options);
      },
    }));

    dom.document.getElementById('save-vmd').click();
    assert.equal(dom.document.getElementById('animation-export-format-vmd').checked, true);
    assert.equal(dom.document.getElementById('animation-export-format-vrma').checked, false);
    assert.equal(dom.document.getElementById('animation-export-vrma-options').hidden, true);

    dom.document.getElementById('animation-export-format-vrma').checked = true;
    for (const handler of dom.document.getElementById('animation-export-format-vrma').listeners.get('change') || []) {
      handler({ target: dom.document.getElementById('animation-export-format-vrma') });
    }
    assert.equal(dom.document.getElementById('animation-export-vrma-options').hidden, false);

    dom.document.getElementById('animation-export-save').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(downloadCalls, [
      {
        exportFormat: 'vrma',
        bakeIkToRotation: true,
        bakeLowerBodyToHumanoid: true,
      },
    ]);
  } finally {
    dom.restore();
  }
});
