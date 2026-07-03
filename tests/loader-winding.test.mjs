import assert from 'node:assert/strict';
import test from 'node:test';

import { PMDLoader } from '../source/infrastructure/loaders/pmd-loader.js';
import { PMXLoader } from '../source/infrastructure/loaders/pmx-loader.js';

test('PMD loader reverses triangle winding when normalizing indices', () => {
  const loader = new PMDLoader();
  const buffer = createMinimalPmdBuffer();
  const model = loader.parse(buffer);

  assert.equal(model.indices instanceof Uint16Array, true);
  assert.deepEqual(Array.from(model.indices.slice(0, 3)), [0, 2, 1]);
});

test('PMX loader reverses triangle winding when normalizing indices', async () => {
  const loader = new PMXLoader();
  const buffer = createMinimalPmxBuffer();
  const model = await loader.parse(buffer);

  assert.equal(model.indices instanceof Uint16Array, true);
  assert.deepEqual(Array.from(model.indices.slice(0, 3)), [0, 2, 1]);
});

/**
 * Creates a minimal PMD buffer with a single triangle.
 * @returns {ArrayBuffer} Minimal PMD data.
 */
function createMinimalPmdBuffer() {
  const buffer = new ArrayBuffer(1400);
  const view = new DataView(buffer);
  let offset = 0;

  writeAscii(view, offset, 'Pmd');
  offset += 3;
  view.setFloat32(offset, 1.0, true);
  offset += 4;
  offset += 20;
  offset += 256;

  view.setUint32(offset, 0, true);
  offset += 4;

  view.setUint32(offset, 3, true);
  offset += 4;
  view.setUint16(offset, 0, true);
  view.setUint16(offset + 2, 1, true);
  view.setUint16(offset + 4, 2, true);
  offset += 6;

  view.setUint32(offset, 0, true);
  offset += 4;
  view.setUint16(offset, 0, true);
  offset += 2;
  view.setUint16(offset, 0, true);
  offset += 2;
  view.setUint16(offset, 0, true);
  offset += 2;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint32(offset, 0, true);
  offset += 4;

  offset += 1000;

  view.setUint32(offset, 0, true);
  offset += 4;
  view.setUint32(offset, 0, true);

  return buffer;
}

/**
 * Creates a minimal PMX buffer with a single triangle.
 * @returns {ArrayBuffer} Minimal PMX data.
 */
function createMinimalPmxBuffer() {
  const buffer = new ArrayBuffer(2048);
  const view = new DataView(buffer);
  let offset = 0;

  writeAscii(view, offset, 'PMX ');
  offset += 4;
  view.setFloat32(offset, 2.0, true);
  offset += 4;
  view.setUint8(offset, 8);
  offset += 1;
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 1);

  offset += writePmxText(view, offset, '');
  offset += writePmxText(view, offset, '');
  offset += writePmxText(view, offset, '');
  offset += writePmxText(view, offset, '');

  view.setInt32(offset, 3, true);
  offset += 4;
  for (let i = 0; i < 3; i++) {
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 0, true);
    offset += 12;
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 1, true);
    offset += 12;
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    offset += 8;
    view.setUint8(offset++, 0);
    view.setInt8(offset++, -1);
    view.setFloat32(offset, 1, true);
    offset += 4;
  }

  view.setInt32(offset, 3, true);
  offset += 4;
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 2);

  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;

  return buffer.slice(0, offset);
}

/**
 * Writes an ASCII string at the current offset.
 * @param {DataView} view - Target view.
 * @param {number} offset - Write offset.
 * @param {string} value - ASCII string.
 */
function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i) & 0xFF);
  }
}

/**
 * Writes a PMX text field and returns the bytes consumed.
 * @param {DataView} view - Target view.
 * @param {number} offset - Write offset.
 * @param {string} value - Text value.
 * @returns {number} Bytes written.
 */
function writePmxText(view, offset, value) {
  const encoded = new TextEncoder().encode(value);
  view.setUint32(offset, encoded.length, true);
  for (let i = 0; i < encoded.length; i++) {
    view.setUint8(offset + 4 + i, encoded[i]);
  }
  return 4 + encoded.length;
}
