import assert from 'node:assert/strict';
import test from 'node:test';
import { sortTransparentMaterialsByRenderOrder } from '../source/core/model/model-manager.js';

test('sortTransparentMaterialsByRenderOrder keeps PMX enumeration order', () => {
  const materials = [
    { sortIndex: 2, name: 'late' },
    { sortIndex: 0, name: 'first' },
    { sortIndex: 1, name: 'middle' },
  ];

  const sorted = sortTransparentMaterialsByRenderOrder(materials);

  assert.deepEqual(sorted.map((material) => material.name), ['first', 'middle', 'late']);
  assert.deepEqual(materials.map((material) => material.name), ['late', 'first', 'middle']);
});
