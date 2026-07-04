import assert from 'node:assert/strict';
import test from 'node:test';

import JSZipModule from '../source/lib/jszip.js';
import { createDroppedInputService } from '../source/application/assets/dropped-input-service.js';

/**
 * テスト用 ZIP を構築します。
 * @param {Record<string, string>} entries - ZIP エントリ一覧。
 * @returns {Promise<File>} ZIP ファイル。
 */
async function createZipFixture(entries) {
  const zip = new JSZipModule();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'fixture.zip', { type: 'application/zip' });
}

test('direct zip file and folder-style drop both use the shared ZIP model path', async () => {
  const directZipCalls = [];
  const folderZipCalls = [];
  const directLoader = createDroppedInputService({
    loadZipModel: async (zipFiles) => {
      directZipCalls.push(Object.keys(zipFiles).filter((key) => !key.endsWith('/')).sort());
    },
    applySettingsFiles: async () => {},
  });
  const folderLoader = createDroppedInputService({
    loadZipModel: async (zipFiles) => {
      folderZipCalls.push(Object.keys(zipFiles).sort());
    },
    applySettingsFiles: async () => {},
  });

  const zipFile = await createZipFixture({
    'models/hero.pmx': 'pmx',
    'textures/tex.png': 'png',
  });
  await directLoader.processFileBatch([zipFile]);
  await folderLoader.processDroppedData({
    files: [],
    zipFiles: {
      'models/hero.pmx': { async: async () => null },
      'textures/tex.png': { async: async () => null },
    },
    hasDirectory: true,
  });

  assert.deepEqual(directZipCalls, [[
    'models/hero.pmx',
    'textures/tex.png',
  ]]);
  assert.deepEqual(folderZipCalls, [[
    'models/hero.pmx',
    'textures/tex.png',
  ]]);
});

test('multiple model candidates from direct zip are staged through the same pending flow as folder drops', async () => {
  const stagedCandidates = [];
  const stagedSettings = [];
  const stagedPoses = [];
  const loader = createDroppedInputService({
    setModelCandidateFiles: async (files) => {
      stagedCandidates.push(files.map((candidate) => candidate.label));
    },
    setPendingSettingsFiles: (files, zipFiles) => {
      stagedSettings.push({
        files: files.map((file) => file.name),
        zipKeys: Object.keys(zipFiles || {}).filter((key) => !key.endsWith('/')).sort(),
      });
    },
    setPendingPoseFiles: (files, zipFiles) => {
      stagedPoses.push({
        files: files.map((file) => file.name),
        zipKeys: Object.keys(zipFiles || {}).filter((key) => !key.endsWith('/')).sort(),
      });
    },
    applySettingsFiles: async () => {},
  });

  const zipFile = await createZipFixture({
    'pack/a.pmx': 'pmx-a',
    'pack/b.vrm': 'vrm-b',
    'pack/model.json': '{"type":"model"}',
    'pack/pose.vpd': 'pose',
  });
  await loader.processFileBatch([zipFile]);

  assert.equal(stagedCandidates.length, 1);
  assert.deepEqual(stagedCandidates[0], [
    'fixture.zip/pack/a.pmx',
    'fixture.zip/pack/b.vrm',
  ]);
  assert.deepEqual(stagedSettings, [{
    files: ['pack/model.json'],
    zipKeys: ['pack/a.pmx', 'pack/b.vrm', 'pack/model.json', 'pack/pose.vpd'],
  }]);
  assert.deepEqual(stagedPoses, [{
    files: [],
    zipKeys: ['pack/a.pmx', 'pack/b.vrm', 'pack/model.json', 'pack/pose.vpd'],
  }]);
});

test('single direct zip with one model applies settings through the same shared loader execution', async () => {
  const loadedModels = [];
  const appliedSettings = [];
  const loader = createDroppedInputService({
    loadZipModel: async (zipFiles) => {
      loadedModels.push(Object.keys(zipFiles).filter((key) => !key.endsWith('/')).sort());
    },
    applySettingsFiles: async (files, zipFiles) => {
      appliedSettings.push({
        files: files.map((file) => file.name),
        zipKeys: Object.keys(zipFiles || {}).filter((key) => !key.endsWith('/')).sort(),
      });
    },
  });

  const zipFile = await createZipFixture({
    'solo/hero.pmx': 'pmx',
    'solo/model.json': '{"type":"model"}',
  });
  await loader.processFileBatch([zipFile]);

  assert.deepEqual(loadedModels, [[
    'solo/hero.pmx',
    'solo/model.json',
  ]]);
  assert.deepEqual(appliedSettings, [{
    files: ['solo/model.json'],
    zipKeys: ['solo/hero.pmx', 'solo/model.json'],
  }]);
});

test('folder-style drops still open zip archives that sit alongside other files', async () => {
  const loadedModels = [];
  const loader = createDroppedInputService({
    loadZipModel: async (zipFiles) => {
      loadedModels.push(Object.keys(zipFiles).filter((key) => !key.endsWith('/')).sort());
    },
    applySettingsFiles: async () => {},
  });

  const zipFile = await createZipFixture({
    'models/hero.pmx': 'pmx',
    'models/model.json': '{"type":"model"}',
  });

  await loader.processDroppedData({
    files: [zipFile],
    zipFiles: {
      'models/@pmx-vrma-test/alicia.zip': {
        async: async () => null,
      },
      'models/@pmx-vrma-test/VRMA_07.vrma': {
        async: async () => null,
      },
    },
    hasDirectory: true,
  });

  assert.deepEqual(loadedModels, [[
    'models/hero.pmx',
    'models/model.json',
  ]]);
});
