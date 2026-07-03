import assert from 'node:assert/strict';
import test from 'node:test';

import { MESSAGE_NAMESPACE } from '../source/application/integration/openmmd-bridge-protocol.js';
import { createControlPanelApp } from '../source/application/integration/control-panel.js';

function createFakeElement() {
  return {
    files: [],
    listeners: new Map(),
    textContent: '',
    value: '',
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      this.listeners.set(type, handlers.filter((entry) => entry !== handler));
    },
  };
}

function createFakeEventTarget() {
  return {
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      this.listeners.set(type, handlers.filter((entry) => entry !== handler));
    },
    emit(type, payload = {}) {
      for (const handler of this.listeners.get(type) || []) {
        handler(payload);
      }
    },
  };
}

function createTestDom() {
  const elements = new Map();
  const ids = [
    'command-log',
    'viewer-status',
    'stream-status',
    'open-viewer',
    'refresh-queue',
    'load-zip',
    'load-vmd',
    'toggle-playback',
    'play',
    'pause',
    'rewind',
    'step-back',
    'step-forward',
    'go-end',
    'reset-physics',
    'enter-fullscreen',
    'exit-fullscreen',
    'seek-submit',
    'seek-frame',
  ];
  for (const id of ids) {
    elements.set(id, createFakeElement());
  }
  return {
    getElementById(id) {
      return elements.get(id) || null;
    },
    elements,
  };
}

test('control panel installs explicit listeners and disposes them cleanly', async () => {
  const documentObject = createTestDom();
  const windowObject = createFakeEventTarget();
  const postedMessages = [];
  const openedWindows = [];
  const eventSources = [];
  const viewerWindow = {
    closed: false,
    focus() {},
    postMessage(message, origin) {
      postedMessages.push({ message, origin });
    },
  };

  windowObject.location = {
    origin: 'https://example.test',
    href: 'https://example.test/',
  };
  windowObject.open = () => {
    openedWindows.push(true);
    return viewerWindow;
  };
  windowObject.setTimeout = globalThis.setTimeout;
  windowObject.clearTimeout = globalThis.clearTimeout;

  const app = createControlPanelApp({
    windowObject,
    documentObject,
    eventSourceFactory(url) {
      const source = createFakeEventTarget();
      source.url = url;
      source.closed = false;
      source.close = () => {
        source.closed = true;
      };
      eventSources.push(source);
      return source;
    },
  }).install();

  assert.equal(eventSources.length, 1);
  assert.equal(eventSources[0].url, 'https://example.test/api/events');
  assert.equal(documentObject.getElementById('stream-status').textContent, 'connecting');

  const loadZipInput = documentObject.getElementById('load-zip');
  loadZipInput.files = [new File(['zip-data'], 'scene.zip', { type: 'application/zip' })];

  const changePromise = loadZipInput.listeners.get('change')[0]({
    target: loadZipInput,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(openedWindows.length, 1);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].origin, 'https://example.test');
  assert.equal(postedMessages[0].message.namespace, MESSAGE_NAMESPACE);
  assert.equal(postedMessages[0].message.command, 'load-zip');

  app.handleViewerResponse({
    namespace: MESSAGE_NAMESPACE,
    type: 'response',
    id: postedMessages[0].message.id,
    ok: true,
    result: null,
  });
  await changePromise;

  eventSources[0].emit('ready');
  assert.equal(documentObject.getElementById('stream-status').textContent, 'open');

  app.dispose();
  assert.equal(eventSources[0].closed, true);
  assert.equal((windowObject.listeners.get('message') || []).length, 0);
});
