/**
 * Reverses triangle winding in place.
 * @param {Uint16Array|Uint32Array|Int32Array|Array<number>} indices - Triangle index buffer.
 * @returns {Uint16Array|Uint32Array|Int32Array|Array<number>} The updated index buffer.
 */
export function reverseTriangleWinding(indices) {
  if (!indices || typeof indices.length !== 'number') {
    return indices;
  }

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tmp = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = tmp;
  }

  return indices;
}
