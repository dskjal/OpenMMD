import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { collectModelCandidatesFromZipFiles, createFileFromZipModelCandidate, shouldLoadZipModelCandidateAsFile } from '../source/infrastructure/io/file-loading.js';

test('collectModelCandidatesFromZipFiles keeps nested model paths for folder-style drops', () => {
  const zipFiles = {
    '銀狼/星穹铁道——银狼/銀狼.pmx': { async: async () => null },
    '銀狼/星穹铁道——银狼/炮.pmx': { async: async () => null },
    '銀狼/星穹铁道——银狼/toon2.png': { async: async () => null },
    '__MACOSX/._銀狼.pmx': { async: async () => null },
  };

  const candidates = collectModelCandidatesFromZipFiles(zipFiles, 'Folder');

  assert.deepEqual(
    candidates.map((candidate) => candidate.modelPath),
    ['銀狼/星穹铁道——银狼/銀狼.pmx', '銀狼/星穹铁道——银狼/炮.pmx'],
  );
  assert.equal(candidates[0].sourceLabel, 'Folder');
  assert.equal(candidates[0].label, 'Folder/銀狼/星穹铁道——银狼/銀狼.pmx');
});

test('single folder VRM candidates are routed through the file-based model load path', async () => {
  const bytes = await fs.readFile('./test-data/alicia/AliciaSolid.vrm');
  const zipFiles = {
    'alicia/AliciaSolid.vrm': {
      async(type) {
        return type === 'blob'
          ? new Blob([bytes], { type: 'application/octet-stream' })
          : null;
      },
    },
  };
  const candidate = collectModelCandidatesFromZipFiles(zipFiles, 'Folder')[0];

  assert.ok(candidate, 'AliciaSolid.vrm should be collected as a folder candidate');
  assert.equal(shouldLoadZipModelCandidateAsFile(candidate), true);

  const file = await createFileFromZipModelCandidate(candidate);
  assert.ok(file instanceof File);
  assert.equal(file.name, 'AliciaSolid.vrm');
  assert.equal(file.size, bytes.byteLength);
});
