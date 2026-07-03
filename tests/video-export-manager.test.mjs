import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoExportFramePlan,
  computeVideoExportPhysicsStep,
  filterVideoExportCodecsForFormat,
  isVideoExportCodecCompatible,
  normalizeVideoExportTransparentBackground,
  normalizeVideoExportCodec,
  normalizeVideoExportFormat,
  normalizeVideoExportQuality,
  supportsVideoExportTransparency,
} from '../source/shared/export/video-export-utils.js';

test('video export format and codec names normalize to supported defaults', () => {
  assert.equal(normalizeVideoExportFormat('WEBM'), 'webm');
  assert.equal(normalizeVideoExportFormat('unknown'), 'mp4');
  assert.equal(normalizeVideoExportCodec('VP9'), 'vp9');
  assert.equal(normalizeVideoExportCodec('unknown'), 'avc');
  assert.equal(normalizeVideoExportQuality('HIGH'), 'high');
  assert.equal(normalizeVideoExportQuality('unknown'), 'medium');
});

test('video export codec compatibility follows the container matrix', () => {
  assert.equal(isVideoExportCodecCompatible('mp4', 'avc'), true);
  assert.equal(isVideoExportCodecCompatible('mp4', 'vp9'), false);
  assert.deepEqual(filterVideoExportCodecsForFormat('webm'), ['vp9', 'av1', 'vp8']);
});

test('video export transparency follows the container matrix', () => {
  assert.equal(supportsVideoExportTransparency('webm'), true);
  assert.equal(supportsVideoExportTransparency('mkv'), true);
  assert.equal(supportsVideoExportTransparency('mp4'), false);
  assert.equal(normalizeVideoExportTransparentBackground('webm', true), true);
  assert.equal(normalizeVideoExportTransparentBackground('mp4', true), false);
  assert.equal(normalizeVideoExportTransparentBackground('mov', false), false);
});

test('video export frame plans sample the playback range at the requested fps', () => {
  const plan = buildVideoExportFramePlan({
    startFrame: 0,
    endFrame: 1,
    exportFps: 60,
  });

  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((item) => Number(item.frame.toFixed(2))), [0, 0.5, 1]);
  assert.deepEqual(plan.map((item) => Number(item.timestamp.toFixed(5))), [0, 0.01667, 0.03333]);
  assert.deepEqual(plan.map((item) => Number(item.duration.toFixed(5))), [0.01667, 0.01667, 0.01667]);
});

test('video export physics steps follow exported frame deltas instead of wall time', () => {
  assert.equal(computeVideoExportPhysicsStep({
    previousFrame: null,
    currentFrame: 0,
  }), 0);
  assert.equal(computeVideoExportPhysicsStep({
    previousFrame: 0,
    currentFrame: 0.5,
    physicsTargetSpf: 1 / 60,
  }), 1);
  assert.equal(computeVideoExportPhysicsStep({
    previousFrame: 0,
    currentFrame: 1,
    physicsTargetSpf: 1 / 60,
  }), 2);
  assert.equal(computeVideoExportPhysicsStep({
    previousFrame: 1,
    currentFrame: 2,
    physicsTargetSpf: 1 / 120,
  }), 4);
});
