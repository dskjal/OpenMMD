import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { createZipFileViews, loadZipArchive, resolveDroppedInput } from '../source/infrastructure/io/file-loading.js';
import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';

test('PMX inspector ZIP loading handles Chinese-path archives', async () => {
  const zipData = await fs.readFile('./test-data/中文路径测试.zip');
  const zip = await loadZipArchive(zipData);
  const files = createZipFileViews(zip.files);

  const targetFiles = files.filter((file) => (file.name || file.path || '').toLowerCase().match(/\.(pmx|pmd|vmd)$/));
  assert.equal(targetFiles.length, 1, 'The Chinese-path ZIP should expose exactly one model file');
  assert.equal(targetFiles[0].name, '中文路径测试/miku_v2.pmd');

  const buffer = await targetFiles[0].async('arraybuffer');
  const model = new PMDLoader().parse(buffer);

  assert.equal(model.name, '初音ミク');
  assert.ok(Array.isArray(model.bones));
  assert.ok(model.bones.length > 0);
});

test('shared drop resolver keeps single files as files and multi-file drops as ZIP input', () => {
  const singleFile = resolveDroppedInput({
    files: [{ name: '中文路径测试.zip' }],
    zipFiles: {},
    hasDirectory: false,
  });
  assert.equal(singleFile?.kind, 'file');
  assert.equal(singleFile?.file?.name, '中文路径测试.zip');

  const zipInput = resolveDroppedInput({
    files: [{ name: 'model-a.pmx' }, { name: 'model-b.vmd' }],
    zipFiles: {
      'model-a.pmx': { async: async () => null },
      'model-b.vmd': { async: async () => null },
    },
    hasDirectory: false,
  });
  assert.equal(zipInput?.kind, 'zip');
  assert.deepEqual(Object.keys(zipInput?.zipFiles || {}), ['model-a.pmx', 'model-b.vmd']);
});
