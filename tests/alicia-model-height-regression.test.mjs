import assert from 'node:assert/strict';
import test from 'node:test';

import { loadModelDataFromFile, resolveMmdLengthToMetersScale } from '../source/core/model/model-scene.js';
import { createFileLike } from './runtime-test-helpers.mjs';

globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1 });

test('AliciaSolid.vrm と Alicia_solid.pmx の身長が一致する', async () => {
  const vrm = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
  const pmx = await loadModelDataFromFile(createFileLike('./test-data/Alicia_solid.pmx'), 1);

  const vrmHeight = computeModelHeightFromModel(vrm.model);
  const pmxHeight = computeModelHeightFromModel(pmx.model);

  assert.ok(
    Math.abs(vrmHeight - pmxHeight) < 1e-3,
    `expected Alicia heights to match, but vrm=${vrmHeight} and pmx=${pmxHeight}`,
  );
});

test('resolveMmdLengthToMetersScale uses appState defaults and fallback', () => {
  assert.equal(resolveMmdLengthToMetersScale({ mmdLengthToMetersScale: 0.1 }), 0.1);
  assert.equal(resolveMmdLengthToMetersScale({ mmdLengthToMetersScale: '0.2' }), 0.2);
  assert.equal(resolveMmdLengthToMetersScale({ mmdLengthToMetersScale: 0 }), 0.07876027287775755);
  assert.equal(resolveMmdLengthToMetersScale({}), 0.07876027287775755);
});

/**
 * モデルの頂点高さを返します。
 * @param {object} model - 読み込み済みモデル。
 * @returns {number} 頂点の Y 方向の高さ。
 */
function computeModelHeightFromModel(model) {
  const vertices = model?.vertices || [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (let index = 1; index < vertices.length; index += 27) {
    const y = vertices[index];
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  return maxY - minY;
}
