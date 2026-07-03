import assert from 'node:assert/strict';
import test from 'node:test';

import { collectVpdFilesFromZipFiles, isVpdFileName } from '../source/infrastructure/io/file-loading.js';

test('VPD file detection and ZIP collection work for .vpd files', async () => {
  assert.equal(isVpdFileName('pose/test.vpd'), true);
  assert.equal(isVpdFileName('pose/test.vmd'), false);

  const zipFiles = {
    'poses/hero.vpd': {
      async: async (type) => {
        if (type !== 'blob') {
          return null;
        }
        return new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
      },
    },
    '__MACOSX/._hero.vpd': {
      async: async () => null,
    },
  };

  const files = await collectVpdFilesFromZipFiles(zipFiles);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'poses/hero.vpd');
  assert.equal((await files[0].arrayBuffer()).byteLength, 3);
});
