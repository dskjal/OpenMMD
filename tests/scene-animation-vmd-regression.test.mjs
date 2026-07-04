import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import * as JSZipModule from '../source/lib/jszip.js';
import { createTracksFromMixedSources, upsertCameraKeyframe, upsertLightKeyframe } from '../source/core/animation/timeline-data.js';
import { VMDManager } from '../source/infrastructure/animation/vmd-manager.js';
import { createVmdAnimationSource } from '../source/application/animation/runtime-animation.js';

/**
 * Creates a File-like object for tests.
 * @param {string} name - File name.
 * @param {ArrayBuffer} buffer - File contents.
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}}
 */
function createFileLike(name, buffer) {
  return {
    name,
    async arrayBuffer() {
      return buffer.slice(0);
    },
  };
}

/**
 * Compares floating-point arrays with a small tolerance.
 * @param {ArrayLike<number>} actual - Actual values.
 * @param {ArrayLike<number>} expected - Expected values.
 * @param {number} [epsilon=1e-6] - Allowed error.
 */
function assertCloseArray(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(Number(actual[i]) - Number(expected[i])) <= epsilon);
  }
}

/**
 * Creates a manager with one camera key and one light key.
 * @returns {VMDManager}
 */
function createSceneAnimationManager() {
  const manager = new VMDManager();

  const cameraData = upsertCameraKeyframe(null, 12, {
    distance: 24,
    target: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    fov: 45,
    perspective: 1,
  });
  const lightData = upsertLightKeyframe(null, 12, {
    color: [0.25, 0.5, 0.75],
    rotation: [0, 0, 0, 1],
  });

  manager.registerAnimationSource(createVmdAnimationSource('Camera.vmd', cameraData, null, {
    targetType: 'camera',
  }));
  manager.registerAnimationSource(createVmdAnimationSource('Light.vmd', lightData, null, {
    targetType: 'light',
  }));

  return manager;
}

/**
 * Loads the light regression fixture as a File-like object.
 * @returns {Promise<{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}>}
 */
async function loadLightFixtureFile() {
  const buffer = await fs.readFile('./test-data/light.vmd');
  return {
    name: 'light.vmd',
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

/**
 * Extracts VMD files from an export ZIP.
 * @param {{blob: Blob, filename: string}} exportData - Export result.
 * @returns {Promise<Map<string, ArrayBuffer>>}
 */
async function extractZipEntries(exportData) {
  const JSZip = JSZipModule.default || JSZipModule;
  const zip = await JSZip.loadAsync(await exportData.blob.arrayBuffer());
  const entries = new Map();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    entries.set(name, await entry.async('arraybuffer'));
  }
  return entries;
}

test('exportVmds exports separate camera and light scene VMDs', async () => {
  const manager = createSceneAnimationManager();

  const exportData = await manager.exportVmds();
  assert.ok(exportData, 'expected camera/light scene sources to be exported as VMD files');
  assert.equal(exportData.filename, 'animations.zip');

  const entries = await extractZipEntries(exportData);
  assert.deepEqual(Array.from(entries.keys()).sort(), ['Camera.vmd', 'Light.vmd']);

  const verifyManager = new VMDManager();
  const cameraSource = await verifyManager.loadVmd(createFileLike('Camera.vmd', entries.get('Camera.vmd')));
  const lightSource = await verifyManager.loadVmd(createFileLike('Light.vmd', entries.get('Light.vmd')));

  assert.equal(Array.isArray(cameraSource), true);
  assert.equal(Array.isArray(lightSource), true);
  assert.equal(verifyManager.getSceneVmdSource('camera', 'Camera.vmd').data.cameraKeyframes.length, 1);
  assert.equal(verifyManager.getSceneVmdSource('light', 'Light.vmd').data.lightKeyframes.length, 1);
});

test('loadVmd restores camera rotation and light translation from exported VMD files', async () => {
  const sourceManager = createSceneAnimationManager();
  const exportData = await sourceManager.exportVmds();
  assert.ok(exportData);

  const entries = await extractZipEntries(exportData);
  const manager = new VMDManager();
  const cameraSource = await manager.loadVmd(createFileLike('Camera.vmd', entries.get('Camera.vmd')));
  const lightSource = await manager.loadVmd(createFileLike('Light.vmd', entries.get('Light.vmd')));

  assert.equal(Array.isArray(cameraSource), true);
  assert.equal(Array.isArray(lightSource), true);
  assert.equal(manager.getSceneVmdSource('camera', 'Camera.vmd').data.cameraKeyframes.length, 1);
  assert.equal(manager.getSceneVmdSource('light', 'Light.vmd').data.lightKeyframes.length, 1);

  const loadedCamera = manager.getSceneVmdSource('camera', 'Camera.vmd').data.cameraKeyframes[0];
  const loadedLight = manager.getSceneVmdSource('light', 'Light.vmd').data.lightKeyframes[0];
  assertCloseArray([loadedCamera.distance], [24]);
  assertCloseArray(loadedCamera.target, [1, 2, 3]);
  assertCloseArray(loadedCamera.rotation, [0.1, 0.2, 0.3]);
  assertCloseArray(loadedLight.rotation, [0, 0, 0, 1]);
  assert.equal(loadedLight.keyedRotation, true);
});

test('loading light.vmd keeps the light track visible in the timeline', async () => {
  const manager = new VMDManager();
  const lightSource = await manager.loadVmd(await loadLightFixtureFile());
  const loadedLightSource = Array.isArray(lightSource)
    ? lightSource.find((source) => source?.targetType === 'light')
    : null;

  assert.ok(loadedLightSource, 'expected a light scene source');
  assert.equal(loadedLightSource.clip?.channels?.length > 0, true);

  const tracks = createTracksFromMixedSources(null, {
    name: 'Dummy',
    bones: [],
    morphs: [],
    displayFrames: [],
    magic: 'Pmx',
  }, {
    light: loadedLightSource,
  });

  const lightTrack = tracks.find((track) => track.id === 'light');
  assert.ok(lightTrack, 'expected a light track');
  assert.equal(loadedLightSource.data.lightKeyframes[0].position, null);
  assert.equal(loadedLightSource.data.lightKeyframes[0].keyedPosition, false);
  assert.equal(lightTrack.keyframes.length, 2);
});
