import assert from 'node:assert/strict';
import test from 'node:test';
import { MorphController } from '../source/core/model/morphing.js';

globalThis.GPUBufferUsage ??= {
  VERTEX: 1,
  COPY_DST: 2,
};

test('MorphController applies VRM expression vertex/material/texture binds with binary and override rules', () => {
  const device = createDevice();
  const model = {
    vertices: new Float32Array(27 * 2),
    vertexCount: 2,
    materials: [
      {
        diffuse: [1, 1, 1, 1],
        ambient: [0, 0, 0],
        specular: [0, 0, 0],
        shininess: 0,
        metalic: 0,
        roughness: 1,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0, 0, 0],
        emissiveStrength: 0,
        mtoon: {
          shadeColor: [1, 1, 1],
          rimColor: [0, 0, 0],
          outlineColor: [0, 0, 0],
        },
      },
    ],
    morphs: [
      {
        name: 'happy',
        type: 100,
        vrmExpressionName: 'happy',
        vrmExpressionType: 'preset',
        vrmExpressionDefinition: {
          expressionName: 'happy',
          expressionType: 'preset',
          isBinary: true,
          overrideBlink: 'block',
          overrideLookAt: 'none',
          overrideMouth: 'none',
          vertexOffsets: [
            { index: 0, position: [1, 2, 3] },
          ],
          materialColorBinds: [
            { materialIndex: 0, type: 'color', targetValue: [0.5, 0.25, 0.75, 0.6] },
            { materialIndex: 0, type: 'emissionColor', targetValue: [0.1, 0.2, 0.3] },
          ],
          textureTransformBinds: [
            { materialIndex: 0, scale: [1.5, 0.5], offset: [0.2, -0.1] },
          ],
        },
        offsets: [],
      },
      {
        name: 'blink',
        type: 100,
        vrmExpressionName: 'blink',
        vrmExpressionType: 'preset',
        vrmExpressionDefinition: {
          expressionName: 'blink',
          expressionType: 'preset',
          isBinary: false,
          overrideBlink: 'none',
          overrideLookAt: 'none',
          overrideMouth: 'none',
          vertexOffsets: [],
          materialColorBinds: [],
          textureTransformBinds: [],
        },
        offsets: [],
      },
    ],
  };

  const controller = new MorphController(device, model);
  controller.setWeight(0, 0.75);
  controller.setWeight(1, 1.0);
  controller.update();

  assert.deepEqual(Array.from(controller.vmArray.slice(0, 3)), [1, 2, 3]);
  assert.deepEqual(controller.materialStates[0].diffuse, [0.5, 0.25, 0.75, 0.6]);
  assert.deepEqual(controller.materialStates[0].emissive, [0.1, 0.2, 0.3]);
  assert.deepEqual(controller.materialStates[0].textureTransform, {
    offset: [0.2, -0.1],
    scale: [1.5, 0.5],
  });
  assert.equal(controller.effectiveWeights[1], 1.0);
  assert.equal(controller.getWeight(1), 1.0);
  assert.equal(controller.modifiedMaterials.has(0), true);
});

/**
 * 最小の GPU device スタブを返します。
 * @returns {object} device スタブ。
 */
function createDevice() {
  return {
    createBuffer({ size, usage }) {
      return {
        size,
        usage,
        destroy() {},
      };
    },
    queue: {
      writeBuffer() {},
    },
  };
}
