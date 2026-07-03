import assert from 'node:assert/strict';
import test from 'node:test';

import { BgmManager } from '../source/application/playback/bgm-manager.js';

/**
 * Creates a fake audio element for BGM tests.
 * @param {object} [options] - Fake audio options.
 * @param {Set<string>} [options.supportedMimeTypes] - Supported MIME types.
 * @returns {object} Fake audio element.
 */
function createFakeAudio(options = {}) {
  const supportedMimeTypes = options.supportedMimeTypes || new Set(['audio/mpeg']);
  const listeners = new Map();

  return {
    paused: true,
    currentTime: 0,
    duration: 12,
    loop: false,
    preload: '',
    src: '',
    volume: 1,
    canPlayType(mimeType) {
      return supportedMimeTypes.has(mimeType) ? 'probably' : '';
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
    load() {},
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    trigger(type) {
      listeners.get(type)?.();
    },
  };
}

/**
 * Creates a BGM manager test harness.
 * @param {object} [options] - Harness options.
 * @param {Set<string>} [options.supportedMimeTypes] - Supported MIME types.
 * @param {object} [options.controller] - Playback controller.
 * @returns {object} Harness.
 */
function createHarness(options = {}) {
  const audios = [];
  const urlApi = {
    createObjectURL() {
      return 'blob:fake-url';
    },
    revokeObjectURL() {},
  };

  const manager = new BgmManager({
    audioFactory: () => {
      const audio = createFakeAudio({
        supportedMimeTypes: options.supportedMimeTypes,
      });
      audios.push(audio);
      return audio;
    },
    urlApi,
    getPlaybackController: () => options.controller || null,
    getPlaybackRange: () => ({
      start: options.controller?.playbackRangeStart ?? 0,
      end: options.controller?.playbackRangeEnd ?? null,
    }),
  });

  return {
    audios,
    manager,
  };
}

test('BgmManager rejects unsupported audio formats', async () => {
  const { manager } = createHarness({
    supportedMimeTypes: new Set(),
  });

  const result = await manager.loadFile({
    name: 'bgm.wav',
    type: 'audio/wav',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'unsupported-format');
  assert.equal(manager.getState().hasSource, false);
  assert.equal(manager.getState().errorMessage, 'Unsupported audio format.');
});

test('BgmManager follows playback state and stops after the audio ends when loop is off', async () => {
  const controller = {
    isPlaying: true,
    currentFrame: 45,
    playbackRangeStart: 15,
    playbackRangeEnd: null,
  };
  const { audios, manager } = createHarness({
    controller,
  });

  const result = await manager.loadFile({
    name: 'bgm.mp3',
    type: 'audio/mpeg',
  });

  assert.equal(result.accepted, true);
  assert.equal(audios.length, 2);

  const audio = audios[1];
  audio.duration = 12;
  audio.trigger('loadedmetadata');

  assert.equal(audio.currentTime, 1);
  assert.equal(audio.paused, false);
  assert.equal(manager.getState().isPlaying, true);
  assert.equal(audio.loop, false);

  manager.setVolume(0.35);
  assert.equal(audio.volume, 0.35);

  controller.currentFrame = 450;
  manager.syncFromActivePlayback({ forceSeek: true });

  assert.equal(audio.paused, true);
  assert.equal(manager.getState().isPlaying, false);
  assert.ok(audio.currentTime >= 11.99 && audio.currentTime <= 12);

  manager.setLoop(true);
  controller.currentFrame = 795;
  controller.isPlaying = true;
  audio.duration = 12;
  manager.syncFromActivePlayback({ forceSeek: true });

  assert.equal(audio.loop, true);
  assert.equal(manager.getState().isPlaying, true);
  assert.ok(audio.currentTime >= 0 && audio.currentTime < 12);
});

test('BgmManager keeps detected candidates available and switches between them', async () => {
  const controller = {
    isPlaying: false,
    currentFrame: 0,
    playbackRangeStart: 0,
    playbackRangeEnd: null,
  };
  const { manager } = createHarness({
    supportedMimeTypes: new Set(['audio/mpeg', 'audio/ogg']),
    controller,
  });

  const first = new File(['first'], 'first.mp3', { type: 'audio/mpeg' });
  const second = new File(['second'], 'second.ogg', { type: 'audio/ogg' });

  await manager.setCandidateFiles([first, second]);
  assert.equal(manager.getState().candidateCount, 2);
  assert.equal(manager.getState().fileName, 'first.mp3');
  assert.equal(manager.getState().selectedCandidateIndex, 0);

  await manager.selectCandidate(1);
  assert.equal(manager.getState().fileName, 'second.ogg');
  assert.equal(manager.getState().selectedCandidateIndex, 1);
});
