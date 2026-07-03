import assert from 'node:assert/strict';
import test from 'node:test';

import { createPendingImportService } from '../source/application/assets/pending-import-service.js';

test('pending import service stages and consumes settings and pose files independently', async () => {
  const service = createPendingImportService();
  const calls = [];
  const settingsFile = new File(['{}'], 'model.json');
  const poseFile = new File(['pose'], 'pose.vpd');
  const zipFiles = {
    'pack/model.json': { async: async () => null },
  };

  service.setApplySettingsHandler(async (files, nextZipFiles) => {
    calls.push({
      kind: 'settings',
      fileNames: files.map((file) => file.name),
      zipKeys: Object.keys(nextZipFiles || {}).sort(),
    });
  });
  service.setApplyPoseHandler(async (files, nextZipFiles) => {
    calls.push({
      kind: 'pose',
      fileNames: files.map((file) => file.name),
      zipKeys: Object.keys(nextZipFiles || {}).sort(),
    });
  });

  service.setPendingSettingsFiles([settingsFile], zipFiles);
  service.setPendingPoseFiles([poseFile], zipFiles);

  await service.consumePendingSettingsFiles();
  await service.consumePendingPoseFiles();

  assert.deepEqual(calls, [
    {
      kind: 'settings',
      fileNames: ['model.json'],
      zipKeys: ['pack/model.json'],
    },
    {
      kind: 'pose',
      fileNames: ['pose.vpd'],
      zipKeys: ['pack/model.json'],
    },
  ]);
});

test('pending import service clear operations drop staged files before consume', async () => {
  const service = createPendingImportService();
  let consumed = false;

  service.setApplySettingsHandler(async (files) => {
    consumed = files.length > 0;
  });
  service.setPendingSettingsFiles([new File(['{}'], 'model.json')]);
  service.clearAllPendingImports();
  await service.consumePendingSettingsFiles();

  assert.equal(consumed, false);
});
