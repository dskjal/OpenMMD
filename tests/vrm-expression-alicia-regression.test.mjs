import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { loadModelDataFromFile } from '../source/core/model/model-scene.js';
import { pathToFileURL } from 'node:url';

test('AliciaSolid.vrm normalizes VRM0 expressions to VRM1 names and keeps their morph targets', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const expressionNames = model.morphs.map((morph) => morph.name);

    assert.ok(expressionNames.includes('aa'));
    assert.ok(expressionNames.includes('ih'));
    assert.ok(expressionNames.includes('ou'));
    assert.ok(expressionNames.includes('ee'));
    assert.ok(expressionNames.includes('oh'));
    assert.ok(expressionNames.includes('happy'));
    assert.ok(expressionNames.includes('sad'));
    assert.ok(expressionNames.includes('relaxed'));
    assert.ok(expressionNames.includes('blinkLeft'));
    assert.ok(expressionNames.includes('blinkRight'));

    assert.ok((findExpressionMorph(model, 'aa')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'ih')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'ou')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'ee')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'oh')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'happy')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'sad')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
    assert.ok((findExpressionMorph(model, 'relaxed')?.vrmExpressionDefinition?.vertexOffsets?.length || 0) > 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

/**
 * expression morph を名前で探します。
 * @param {object} model - モデル。
 * @param {string} name - expression 名。
 * @returns {object|null} 見つかった morph。
 */
function findExpressionMorph(model, name) {
  return model.morphs.find((morph) => morph.name === name) || null;
}

/**
 * File 互換オブジェクトを作成します。
 * @param {string} path - ファイルパス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} File 互換オブジェクト。
 */
function createFileLike(path) {
  return {
    name: path.split(/[\\/]/).pop(),
    arrayBuffer: async () => {
      const data = await fs.readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
  };
}

/**
 * ローカルファイル用 fetch モックを返します。
 * @returns {function(*): Promise<object>} fetch モック。
 */
function createFileFetchMock() {
  return async (input) => {
    const url = input instanceof URL ? input : new URL(input, pathToFileURL(`${process.cwd()}/`));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => data.toString('utf8'),
    };
  };
}
