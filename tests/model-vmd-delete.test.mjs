import assert from 'node:assert/strict';
import test from 'node:test';

import { getVmdReferenceModelNames, setupUIHandlers, updateModelListUI } from '../source/ui/renderer-ui.js';
import { removeModelAtIndex } from '../source/application/models/model-lifecycle-service.js';
import { VMDManager } from '../source/infrastructure/animation/vmd-manager.js';

function createSelection(activeInstanceIndex = 0) {
  return {
    activeInstanceIndex,
    selectedBoneIndex: 12,
    selectedTargetIndex: 3,
    selectedRigidbodyIndex: 7,
    lastSelectedBoneIndex: 4,
    prevEuler: [1, 2, 3],
  };
}

function createModelManager(instances) {
  return {
    instances,
    removeModel(index) {
      this.instances.splice(index, 1);
    },
  };
}

function createFakeElement() {
  const element = {
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    append(...children) {
      for (const child of children) {
        if (child) {
          child.parentElement = this;
          this.children.push(child);
        }
      }
    },
    appendChild(child) {
      this.append(child);
      return child;
    },
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
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    click() {
      this.listeners.click?.({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
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
    attributes: {},
    children: [],
    dataset: {},
    disabled: false,
    focus() {},
    listeners: {},
    parentElement: null,
    style: {},
    textContent: '',
    title: '',
    value: '',
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML || '';
    },
    set(value) {
      this._innerHTML = String(value);
      this.children = [];
    },
    configurable: true,
  });

  return element;
}

function installUiHandlerFakeDom() {
  const elements = new Map();
  const ids = [
    'model-list',
    'vmd-list',
    'delete-vmd',
    'timeline-delete-key',
    'playback-range-start',
    'playback-range-end',
    'play-vmd',
    'rewind-vmd',
    'prev-key-vmd',
    'step-back-vmd',
    'step-forward-vmd',
    'next-key-vmd',
    'go-to-end-vmd',
  ];

  ids.forEach((id) => {
    elements.set(id, createFakeElement());
  });

  for (let i = 1; i <= 4; i++) {
    elements.set(`morph-group-${i}`, createFakeElement());
  }

  const previous = {
    document: globalThis.document,
  };

  globalThis.document = {
    createElement: () => createFakeElement(),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    },
  };

  return {
    elements,
    restore() {
      globalThis.document = previous.document;
    },
  };
}

test('VMDManager.removeVmd removes stored VMD data', () => {
  const manager = new VMDManager();
  manager.vmds.set('Walk.vmd', { id: 1 });
  manager.vmds.set('Run.vmd', { id: 2 });

  assert.equal(manager.removeVmd('Walk.vmd'), true);
  assert.equal(manager.vmds.has('Walk.vmd'), false);
  assert.equal(manager.removeVmd('Missing.vmd'), false);
  assert.equal(manager.vmds.size, 1);
});

test('getVmdReferenceModelNames returns matching model names', () => {
  const modelManager = createModelManager([
    { model: { name: 'Model A' }, vmdName: 'Walk.vmd' },
    { model: { name: 'Model B' }, vmdName: 'Run.vmd' },
    { model: { name: 'Model C' }, vmdName: 'Walk.vmd' },
  ]);

  assert.deepEqual(getVmdReferenceModelNames(modelManager, 'Walk.vmd'), ['Model A', 'Model C']);
  assert.deepEqual(getVmdReferenceModelNames(modelManager, 'Run.vmd'), ['Model B']);
  assert.deepEqual(getVmdReferenceModelNames(modelManager, 'Missing.vmd'), []);
});

test('updateModelListUI renders a visibility toggle before the model label', () => {
  const previous = globalThis.document;
  const listEl = createFakeElement();
  const elements = new Map([
    ['model-list', listEl],
  ]);

  globalThis.document = {
    createElement: () => createFakeElement(),
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  try {
    updateModelListUI({
      activeIndex: 1,
      items: [
        { index: 0, name: 'Model A', visible: true },
        { index: 1, name: 'Model B', visible: false },
      ],
    }, { 'Loaded Models': 'Loaded Models', 'Show Model': 'Show Model', 'Hide Model': 'Hide Model', 'Delete Model': 'Delete Model' });

    assert.equal(listEl.children.length, 2);
    const firstRow = listEl.children[0];
    const firstVisibilityButton = firstRow.children[0];
    const firstLabel = firstRow.children[1];
    const hiddenRow = listEl.children[1];

    assert.equal(firstVisibilityButton.dataset.modelVisibilityIndex, '0');
    assert.equal(firstVisibilityButton.title, 'Hide Model');
    assert.equal(firstVisibilityButton.attributes['aria-pressed'], 'true');
    assert.equal(firstLabel.textContent, 'Model A');
    assert.equal(hiddenRow.classList.contains('is-hidden'), true);
    assert.equal(hiddenRow.attributes['aria-hidden'], 'true');
    assert.equal(hiddenRow.children[0].title, 'Show Model');
  } finally {
    globalThis.document = previous;
  }
});

test('removeModelAtIndex keeps the active instance when removing an earlier row', () => {
  const selection = createSelection(1);
  const modelA = { model: { name: 'Model A', bones: [] }, scene: {}, morphController: {} };
  const modelB = { model: { name: 'Model B', bones: [] }, scene: {}, morphController: {} };
  const modelC = { model: { name: 'Model C', bones: [] }, scene: {}, morphController: {} };
  const modelManager = createModelManager([modelA, modelB, modelC]);

  let renderMorphUiCount = 0;
  let updateModelListCount = 0;
  let updateVmdListCount = 0;
  let updateActiveMorphIndicesCount = 0;
  let refreshSceneCount = 0;

  removeModelAtIndex({
    modelManager,
    physicsEngine: null,
    vmdManager: { vmds: new Map() },
    selection,
    refreshScene: () => { refreshSceneCount += 1; },
    renderMorphUi: () => { renderMorphUiCount += 1; },
    syncMaterialTabUi: () => {},
    timelineManager: null,
    updateActiveMorphIndices: () => { updateActiveMorphIndicesCount += 1; },
    updateModelListUI: () => { updateModelListCount += 1; },
    updateVmdListUI: () => { updateVmdListCount += 1; },
    getLangData: () => ({}),
  }, 0);

  assert.equal(modelManager.instances.length, 2);
  assert.equal(modelManager.instances[0], modelB);
  assert.equal(modelManager.instances[1], modelC);
  assert.equal(selection.activeInstanceIndex, 0);
  assert.equal(selection.selectedBoneIndex, 12);
  assert.equal(selection.selectedTargetIndex, 3);
  assert.equal(selection.selectedRigidbodyIndex, 7);
  assert.equal(renderMorphUiCount, 0);
  assert.equal(updateModelListCount, 1);
  assert.equal(updateVmdListCount, 1);
  assert.equal(updateActiveMorphIndicesCount, 1);
  assert.equal(refreshSceneCount, 1);
});

test('model list visibility toggle flips the instance flag and refreshes the scene', () => {
  const dom = installUiHandlerFakeDom();
  try {
    const calls = [];
    const instance = { model: { name: 'Model A' }, visible: true };
    const modelManager = { instances: [instance] };

    setupUIHandlers({
      appFacade: {
        editing: {
          setModelVisibility(index) {
            calls.push(index);
            instance.visible = !instance.visible;
          },
        },
        ui: {
          getModelListState() {
            return {
              activeIndex: 0,
              items: [{ index: 0, name: 'Model A', visible: instance.visible }],
            };
          },
          getAnimationSourceListState() {
            return { entries: [], selectedValue: '', canDeleteSelected: false };
          },
          getModelDeletionState(index) {
            return { index, details: ['Model A'] };
          },
        },
        playback: {
          getPlaybackRange() {
            return { start: 0, end: null };
          },
        },
      },
      getLangData: () => ({ 'Loaded Models': 'Loaded Models', 'Delete Model': 'Delete Model', 'Show Model': 'Show Model', 'Hide Model': 'Hide Model', Delete: 'Delete', Cancel: 'Cancel', None: 'None', 'Loaded Animations': 'Loaded Animations' }),
    });

    const modelList = dom.elements.get('model-list');
    const visibilityButton = modelList.children[0].children[0];
    modelList.listeners.click({
      target: visibilityButton,
      preventDefault() {},
      stopPropagation() {},
    });

    assert.equal(instance.visible, false);
    assert.deepEqual(calls, [0]);
  } finally {
    dom.restore();
  }
});

test('removeModelAtIndex switches to the next model when removing the active row', () => {
  const selection = createSelection(0);
  const modelA = { model: { name: 'Model A', bones: [] }, scene: {}, morphController: {} };
  const modelB = { model: { name: 'Model B', bones: [] }, scene: {}, morphController: {} };
  const modelManager = createModelManager([modelA, modelB]);

  let renderMorphUiArgs = null;
  let updateModelListCount = 0;
  let updateVmdListCount = 0;
  let refreshSceneCount = 0;

  removeModelAtIndex({
    modelManager,
    physicsEngine: null,
    vmdManager: { vmds: new Map() },
    selection,
    refreshScene: () => { refreshSceneCount += 1; },
    renderMorphUi: (model, morphController) => {
      renderMorphUiArgs = { model, morphController };
    },
    syncMaterialTabUi: () => {},
    timelineManager: null,
    updateActiveMorphIndices: () => {},
    updateModelListUI: () => { updateModelListCount += 1; },
    updateVmdListUI: () => { updateVmdListCount += 1; },
    getLangData: () => ({}),
  }, 0);

  assert.equal(modelManager.instances.length, 1);
  assert.equal(modelManager.instances[0], modelB);
  assert.equal(selection.activeInstanceIndex, 0);
  assert.equal(selection.selectedBoneIndex, -1);
  assert.equal(selection.selectedTargetIndex, -1);
  assert.equal(selection.selectedRigidbodyIndex, -1);
  assert.deepEqual(renderMorphUiArgs, { model: modelB.model, morphController: modelB.morphController });
  assert.equal(updateModelListCount, 1);
  assert.equal(updateVmdListCount, 1);
  assert.equal(refreshSceneCount, 1);
});

test('timeline delete button reuses the selected keyframe deletion handler', async () => {
  const dom = installUiHandlerFakeDom();
  try {
    let deleteCount = 0;

    setupUIHandlers({
      appFacade: {
        animation: {
          deleteSelectedKeyframes() {
            deleteCount += 1;
            return true;
          },
        },
        ui: {
          getModelListState() {
            return { activeIndex: -1, items: [] };
          },
          getAnimationSourceListState() {
            return { entries: [], selectedValue: '', canDeleteSelected: false };
          },
        },
        playback: {
          getPlaybackRange() {
            return { start: 0, end: null };
          },
        },
      },
      getLangData: () => ({ Delete: 'Delete', 'Loaded Models': 'Loaded Models', 'Loaded Animations': 'Loaded Animations', None: 'None' }),
    });

    dom.elements.get('timeline-delete-key').listeners.click({});

    assert.equal(deleteCount, 1);
    assert.equal(dom.elements.get('timeline-delete-key').title, 'Delete');
    assert.equal(dom.elements.get('timeline-delete-key').attributes['aria-label'], 'Delete');
  } finally {
    dom.restore();
  }
});

test('timeline key navigation buttons reuse the shared keyframe step handler', async () => {
  const dom = installUiHandlerFakeDom();
  try {
    const stepCalls = [];

    setupUIHandlers({
      appFacade: {
        playback: {
          stepKeyframe(direction) {
            stepCalls.push(direction);
          },
          getPlaybackRange() {
            return { start: 0, end: null };
          },
        },
        ui: {
          getModelListState() {
            return { activeIndex: -1, items: [] };
          },
          getAnimationSourceListState() {
            return { entries: [], selectedValue: '', canDeleteSelected: false };
          },
        },
      },
      getLangData: () => ({ Delete: 'Delete', 'Loaded Models': 'Loaded Models', 'Loaded Animations': 'Loaded Animations', None: 'None' }),
    });

    dom.elements.get('prev-key-vmd').listeners.click({});
    dom.elements.get('next-key-vmd').listeners.click({});

    assert.deepEqual(stepCalls, [-1, 1]);
  } finally {
    dom.restore();
  }
});

test('animation list change delegates source selection to appFacade.animation', () => {
  const dom = installUiHandlerFakeDom();
  try {
    const calls = [];

    setupUIHandlers({
      appFacade: {
        animation: {
          selectAnimationSource(selectionInfo) {
            calls.push(selectionInfo);
          },
        },
        ui: {
          getModelListState() {
            return { activeIndex: -1, items: [] };
          },
          getAnimationSourceListState() {
            return { entries: [], selectedValue: '', canDeleteSelected: false };
          },
        },
        playback: {
          getPlaybackRange() {
            return { start: 0, end: null };
          },
        },
      },
      getLangData: () => ({ Delete: 'Delete', 'Loaded Models': 'Loaded Models', 'Loaded Animations': 'Loaded Animations', None: 'None' }),
    });

    dom.elements.get('vmd-list').listeners.change({
      target: {
        value: 'vrma:model:Walk.vrma',
      },
    });

    assert.deepEqual(calls, [{
      kind: 'vrma',
      targetType: 'model',
      name: 'Walk.vrma',
      index: null,
    }]);
  } finally {
    dom.restore();
  }
});

test('delete VMD button delegates removal to appFacade.animation after confirmation', async () => {
  const dom = installUiHandlerFakeDom();
  try {
    const calls = [];
    const vmdList = dom.elements.get('vmd-list');
    vmdList.value = 'vmd:model:Walk.vmd';

    setupUIHandlers({
      appFacade: {
        animation: {
          removeAnimationSource(selectionInfo) {
            calls.push(selectionInfo);
            return true;
          },
        },
        ui: {
          getModelListState() {
            return { activeIndex: -1, items: [] };
          },
          getAnimationSourceListState() {
            return {
              entries: [{ value: 'vmd:model:Walk.vmd', label: 'Walk.vmd' }],
              selectedValue: 'vmd:model:Walk.vmd',
              canDeleteSelected: true,
            };
          },
          getAnimationDeletionState(selectionInfo) {
            return {
              selectionInfo,
              references: [],
              canDelete: true,
            };
          },
        },
        playback: {
          getPlaybackRange() {
            return { start: 0, end: null };
          },
        },
      },
      getLangData: () => ({ Delete: 'Delete', Cancel: 'Cancel', 'Delete VMD Confirmation': 'Delete this VMD?', 'Loaded Models': 'Loaded Models', 'Loaded Animations': 'Loaded Animations', None: 'None' }),
    });

    const deletePromise = dom.elements.get('delete-vmd').listeners.click({});
    dom.elements.get('delete-confirm-confirm').click();
    await deletePromise;

    assert.deepEqual(calls, [{
      kind: 'vmd',
      targetType: 'model',
      name: 'Walk.vmd',
      index: null,
    }]);
  } finally {
    dom.restore();
  }
});
