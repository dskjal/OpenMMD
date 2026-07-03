import assert from 'node:assert/strict';
import test from 'node:test';

import { installDebugPanelController } from '../source/ui/panels/debug-panel-controller.js';

/**
 * Creates a lightweight mock element.
 * @param {string} tagName - Element tag name.
 * @returns {object} Mock element.
 */
function createMockElement(tagName) {
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  return {
    tagName,
    children: [],
    innerHTML: '',
    checked: false,
    style: {},
    textContent: '',
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

/**
 * Creates a mock document for debug panel tests.
 * @param {object} options - Mock document options.
 * @returns {{documentRef: object, animationDebugOutput: object, showAnimationDebugCheckbox: object}} Mock document.
 */
function createMockDocument(options = {}) {
  const animationDebugOutput = createMockElement('tbody');
  const showAnimationDebugCheckbox = createMockElement('input');
  showAnimationDebugCheckbox.checked = Boolean(options.checked);
  const elements = new Map([
    ['animation-debug-output', animationDebugOutput],
    ['show-animation-debug', showAnimationDebugCheckbox],
  ]);
  return {
    documentRef: {
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      createElement(tagName) {
        return createMockElement(tagName);
      },
    },
    animationDebugOutput,
    showAnimationDebugCheckbox,
  };
}

test('debug panel controller keeps animation debug output unchanged while disabled', () => {
  const { documentRef, animationDebugOutput } = createMockDocument({ checked: false });
  animationDebugOutput.innerHTML = 'seed';
  animationDebugOutput.children.push({ sentinel: true });

  const controller = installDebugPanelController({
    documentRef,
    readModelService: {
      getAnimationDebugState() {
        return {
          message: null,
          rows: [{
            sourceName: 'src',
            targetName: 'dst',
            eulerDegrees: ['1.000', '2.000', '3.000'],
          }],
        };
      },
    },
    animationDebugUiState: {
      checkbox: documentRef.getElementById('show-animation-debug'),
      output: animationDebugOutput,
    },
  });

  controller.syncAnimationDebugUi();

  assert.equal(animationDebugOutput.innerHTML, 'seed');
  assert.equal(animationDebugOutput.children.length, 1);
});

test('debug panel controller refreshes animation debug output when enabled', () => {
  const { documentRef, animationDebugOutput, showAnimationDebugCheckbox } = createMockDocument({ checked: true });
  const controller = installDebugPanelController({
    documentRef,
    readModelService: {
      getAnimationDebugState() {
        return {
          message: null,
          rows: [{
            sourceName: 'src',
            targetName: 'dst',
            eulerDegrees: ['1.000', '2.000', '3.000'],
          }],
        };
      },
    },
    animationDebugUiState: {
      checkbox: showAnimationDebugCheckbox,
      output: animationDebugOutput,
    },
  });

  assert.equal(showAnimationDebugCheckbox.listeners.get('change')?.length, 1);

  controller.syncAnimationDebugUi();

  assert.equal(animationDebugOutput.innerHTML, '');
  assert.equal(animationDebugOutput.children.length, 1);
  assert.equal(animationDebugOutput.children[0].children[0].children[0].textContent, 'src ->');
  assert.equal(animationDebugOutput.children[0].children[0].children[1].textContent, 'dst');
  assert.equal(animationDebugOutput.children[0].children[1].textContent, '1.000');

  showAnimationDebugCheckbox.checked = false;
  showAnimationDebugCheckbox.listeners.get('change')[0]();
  assert.equal(animationDebugOutput.children.length, 1);
});
