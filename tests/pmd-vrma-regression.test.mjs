import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';
import {
  createResolvedAnimationBoneMappings,
  ensureAnimationMappingState,
} from '../source/core/animation/animation-mapper.js';
import { loadModelData } from '../source/core/model/model-scene.js';

/**
 * クォータニオンが期待値と一致することを符号違い込みで確認します。
 * @param {ArrayLike<number>} actual - 実値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuaternionClose(actual, expected, epsilon = 1e-6) {
  const directDiff = Math.max(
    Math.abs(actual[0] - expected[0]),
    Math.abs(actual[1] - expected[1]),
    Math.abs(actual[2] - expected[2]),
    Math.abs(actual[3] - expected[3]),
  );
  const flippedDiff = Math.max(
    Math.abs(actual[0] + expected[0]),
    Math.abs(actual[1] + expected[1]),
    Math.abs(actual[2] + expected[2]),
    Math.abs(actual[3] + expected[3]),
  );
  assert.ok(
    Math.min(directDiff, flippedDiff) <= epsilon,
    `expected quaternion ${Array.from(actual)} to be close to ${Array.from(expected)}`,
  );
}

/**
 * ローカルファイルを読む fetch 互換関数を作成します。
 * @returns {function(input: string|URL): Promise<object>} fetch 互換関数。
 */
function createFileFetchMock() {
  return async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(input, pathToFileURL(`${process.cwd()}/`));
    const data = await fs.readFile(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
}

test('PMD + VRMA uses PMX-style defaults and identity target rest rotations', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createFileFetchMock();

  try {
    const { model } = await loadModelData(null, 1, './test-data/miku_v2.pmd');
    const clip = createEmptyAnimationClip({
      name: 'Walk',
      metadata: {
        sourceFormat: 'vrma',
        vrmAnimation: {
          humanBoneRestRotations: {
            hips: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
            leftUpperArm: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
            rightIndexProximal: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
          },
        },
      },
    });
    clip.channels.push(
      { target: { kind: 'bone', name: 'hips', path: 'translation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
      { target: { kind: 'bone', name: 'leftUpperArm', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
      { target: { kind: 'bone', name: 'rightIndexProximal', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
    );

    const instance = {
      model,
      animationSource: {
        kind: 'vrma',
        name: 'Walk',
        clip,
      },
      animationMappingBySourceKey: new Map(),
    };

    const state = ensureAnimationMappingState(instance);
    assert.equal(state.entries.get('hips').targetBoneName, 'センター');
    assert.equal(state.entries.get('leftUpperArm').targetBoneName, '左腕');
    assert.equal(state.entries.get('rightIndexProximal').targetBoneName, '右人差指１');
    assert.deepEqual(state.entries.get('hips').rotationFlipAxes, { x: false, y: false, z: false });
    assert.deepEqual(state.entries.get('leftUpperArm').rotationFlipAxes, { x: false, y: false, z: false });
    assert.deepEqual(state.entries.get('rightIndexProximal').rotationFlipAxes, { x: false, y: false, z: false });

    const mappings = createResolvedAnimationBoneMappings(instance);
    const mappingBySourceBoneName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));
    for (const sourceBoneName of ['hips', 'leftUpperArm', 'rightIndexProximal']) {
      const mapping = mappingBySourceBoneName.get(sourceBoneName);
      assert.ok(mapping, `missing mapping for ${sourceBoneName}`);
      assertQuaternionClose(mapping.targetLocalRestRotation, [0, 0, 0, 1]);
      assertQuaternionClose(mapping.targetWorldRestRotation, [0, 0, 0, 1]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
