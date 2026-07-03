import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('index.html contains dedicated VRM morph accordion groups', async () => {
  const indexHtml = await fs.readFile('./index.html', 'utf8');

  assert.ok(indexHtml.includes('id="mmd-morph-groups"'));
  assert.ok(indexHtml.includes('id="vrm-morph-groups" hidden'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-emotion"'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-lip-sync"'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-blink"'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-look-at"'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-other"'));
  assert.ok(indexHtml.includes('id="vrm-morph-group-custom"'));
});
