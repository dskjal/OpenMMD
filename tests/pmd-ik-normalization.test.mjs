import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadModelData } from '../source/core/model/model-scene.js';

test('PMD IK normalization applies PMX-like knee limits', async () => {
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input : new URL(input, pathToFileURL(process.cwd() + '/'));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };

  const { model } = await loadModelData(null, 1, './test-data/miku_v2.pmd');
  const leftLegIk = model.ik.find((ik) => model.bones[ik.boneIndex]?.name === '左足ＩＫ');

  assert.ok(leftLegIk, '左足ＩＫ が見つからない');
  assert.deepStrictEqual(
    leftLegIk.links.map((link) => model.bones[link.boneIndex]?.name),
    ['左足', '左ひざ'],
    'PMD の左足 IK は PMX 風に親側から並ぶ必要がある',
  );
  assert.strictEqual(leftLegIk.links[1].hasLimit, true, '膝リンクは制約付きである必要がある');
  assert.deepStrictEqual(leftLegIk.links[1].minAngle, [-Math.PI, 0, 0]);
  assert.deepStrictEqual(leftLegIk.links[1].maxAngle, [-0.008, 0, 0]);
});
