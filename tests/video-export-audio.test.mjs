import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeAudioBufferChannelData,
  filterVideoExportAudioCodecsForFormat,
  resolveVideoExportAudioBitrate,
  resolveVideoExportAudioCodec,
} from '../source/shared/export/video-export-utils.js';

/**
 * Builds a mock audio buffer for helper tests.
 * @param {number[]} samples - Sample data.
 * @param {number} sampleRate - Sample rate.
 * @returns {object} Mock buffer.
 */
function createMockAudioBuffer(samples, sampleRate = 4) {
  const channelData = Float32Array.from(samples);
  return {
    length: channelData.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData() {
      return channelData;
    },
  };
}

test('composeAudioBufferChannelData trims, pads, loops, and applies gain', () => {
  const source = createMockAudioBuffer([0.5, -0.5, 1, -1], 4);

  const noLoop = composeAudioBufferChannelData(source, 1.5, { loop: false, gain: 0.5 });
  assert.equal(noLoop.sampleRate, 4);
  assert.equal(noLoop.length, 6);
  assert.deepEqual(Array.from(noLoop.channelData[0]), [0.25, -0.25, 0.5, -0.5, 0, 0]);

  const looped = composeAudioBufferChannelData(source, 1.5, { loop: true, gain: 1 });
  assert.deepEqual(Array.from(looped.channelData[0]), [0.5, -0.5, 1, -1, 0.5, -0.5]);

  const offset = composeAudioBufferChannelData(source, 1, { offsetSeconds: 0.5 });
  assert.deepEqual(Array.from(offset.channelData[0]), [1, -1, 0, 0]);

  const offsetLooped = composeAudioBufferChannelData(source, 1, { offsetSeconds: 0.5, loop: true });
  assert.deepEqual(Array.from(offsetLooped.channelData[0]), [1, -1, 0.5, -0.5]);
});

test('audio codec resolver prefers container-compatible codecs in order', () => {
  assert.deepEqual(filterVideoExportAudioCodecsForFormat('mp4'), ['aac']);
  assert.deepEqual(filterVideoExportAudioCodecsForFormat('webm'), ['opus']);
  assert.deepEqual(filterVideoExportAudioCodecsForFormat('mkv'), ['aac', 'opus', 'mp3', 'vorbis', 'flac']);

  assert.equal(resolveVideoExportAudioCodec('mp4', ['opus', 'aac']), 'aac');
  assert.equal(resolveVideoExportAudioCodec('webm', ['aac', 'opus']), 'opus');
  assert.equal(resolveVideoExportAudioCodec('mkv', ['vorbis', 'flac']), 'vorbis');
  assert.equal(resolveVideoExportAudioBitrate('aac'), 128000);
  assert.equal(resolveVideoExportAudioBitrate('opus'), 64000);
  assert.equal(resolveVideoExportAudioBitrate('mp3'), 160000);
  assert.equal(resolveVideoExportAudioBitrate('flac'), null);
});
