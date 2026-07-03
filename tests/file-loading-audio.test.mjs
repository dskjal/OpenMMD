import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectHdrFilesFromZipFiles,
  collectPlayableAudioFilesFromDroppedData,
  collectPlayableAudioFilesFromZipFiles,
  isHdrFileName,
  isModelFileName,
  isPlayableAudioFileName,
} from '../source/infrastructure/io/file-loading.js';

test('audio filename detection follows common browser-playable extensions and mime types', () => {
  assert.equal(isPlayableAudioFileName('bgm.mp3', ''), true);
  assert.equal(isPlayableAudioFileName('bgm.wav', ''), true);
  assert.equal(isPlayableAudioFileName('model.pmx', ''), false);
  assert.equal(isPlayableAudioFileName('track.unknown', 'audio/ogg'), true);
});

test('hdr filename detection matches .hdr files only', () => {
  assert.equal(isHdrFileName('studio.hdr'), true);
  assert.equal(isHdrFileName('STUDIO.HDR'), true);
  assert.equal(isHdrFileName('studio.exr'), false);
  assert.equal(isHdrFileName('studio.hdr.bak'), false);
});

test('model filename detection matches supported model extensions', () => {
  assert.equal(isModelFileName('model.pmx'), true);
  assert.equal(isModelFileName('model.pmd'), true);
  assert.equal(isModelFileName('model.glb'), true);
  assert.equal(isModelFileName('model.gltf'), true);
  assert.equal(isModelFileName('model.vrm'), true);
  assert.equal(isModelFileName('model.vmd'), false);
});

test('collectPlayableAudioFilesFromZipFiles returns File objects for playable audio entries', async () => {
  const zipFiles = {
    'music/ending.mp3': {
      async: async (type) => (type === 'blob'
        ? new Blob(['audio'], { type: 'audio/mpeg' })
        : null),
    },
    'models/model.pmx': {
      async: async () => null,
    },
  };

  const audioFiles = await collectPlayableAudioFilesFromZipFiles(zipFiles);
  assert.equal(audioFiles.length, 1);
  assert.equal(audioFiles[0].name, 'music/ending.mp3');
  assert.equal(audioFiles[0].type, 'audio/mpeg');
});

test('collectHdrFilesFromZipFiles returns File objects for hdr entries', async () => {
  const zipFiles = {
    'lighting/studio.hdr': {
      async: async (type) => (type === 'blob'
        ? new Blob(['hdr'], { type: 'application/octet-stream' })
        : null),
    },
    'models/model.pmx': {
      async: async () => null,
    },
  };

  const hdrFiles = await collectHdrFilesFromZipFiles(zipFiles);
  assert.equal(hdrFiles.length, 1);
  assert.equal(hdrFiles[0].name, 'lighting/studio.hdr');
});

test('collectPlayableAudioFilesFromDroppedData combines plain files and zip audio candidates', async () => {
  const dropped = {
    files: [
      new File(['plain'], 'voice.ogg', { type: 'audio/ogg' }),
      new File(['model'], 'model.pmx', { type: 'application/octet-stream' }),
    ],
    zipFiles: {
      'music/theme.wav': {
        async: async (type) => (type === 'blob'
          ? new Blob(['zip-audio'], { type: 'audio/wav' })
          : null),
      },
    },
    hasDirectory: false,
  };

  const audioFiles = await collectPlayableAudioFilesFromDroppedData(dropped);
  assert.equal(audioFiles.length, 2);
  assert.deepEqual(audioFiles.map((file) => file.name), ['voice.ogg', 'music/theme.wav']);
});
