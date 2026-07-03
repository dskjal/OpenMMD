import assert from 'node:assert/strict';
import test from 'node:test';

import { createImportCandidateService } from '../source/application/assets/import-candidate-service.js';

test('import candidate service keeps HDR candidates and loads the selected entry', async () => {
  const calls = [];
  const service = createImportCandidateService({
    async loadEnvironmentHdrFile(file, options) {
      calls.push({ name: file.name, preserveCandidates: options?.preserveCandidates === true });
    },
  });
  const files = [
    new File(['a'], 'first.hdr', { type: 'application/octet-stream' }),
    new File(['b'], 'second.hdr', { type: 'application/octet-stream' }),
  ];

  await service.setEnvironmentHdrCandidateFiles(files);
  await service.selectEnvironmentHdrCandidate(1);

  const state = service.getState();
  assert.equal(state.environmentHdrCandidateFiles.length, 2);
  assert.equal(state.environmentHdrSelectedCandidateIndex, 1);
  assert.deepEqual(calls, [
    { name: 'first.hdr', preserveCandidates: true },
    { name: 'second.hdr', preserveCandidates: true },
  ]);
});

test('import candidate service loads checked file and zip model candidates then clears them', async () => {
  const loadedFiles = [];
  const loadedZips = [];
  const service = createImportCandidateService({
    async loadModelFile(file) {
      loadedFiles.push(file.name);
    },
    async loadZipModel(zipFiles) {
      loadedZips.push(Object.keys(zipFiles).sort());
    },
    async consumePendingSettingsFiles() {},
    async consumePendingPoseFiles() {},
    clearPendingImports() {},
  });

  await service.setModelCandidateFiles([
    { kind: 'file', file: new File(['a'], 'hero.pmx') },
    {
      kind: 'zip',
      zipFiles: {
        'models/a.pmx': { async: async () => null },
        'models/b.vrm': { async: async () => null },
        'models/model.json': { async: async () => null },
      },
      modelPath: 'models/a.pmx',
      sourceLabel: 'pack.zip',
    },
  ]);
  service.setModelCandidateChecked(1, false);
  await service.loadSelectedModelCandidates();

  assert.deepEqual(loadedFiles, ['hero.pmx']);
  assert.deepEqual(loadedZips, []);
  assert.equal(service.getState().modelCandidateFiles.length, 0);
});
