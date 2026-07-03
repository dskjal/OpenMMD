import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasTargets } from '../source/infrastructure/gpu/renderer-resources.js';

globalThis.GPUTextureUsage ??= {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  STORAGE_BINDING: 8,
  COPY_SRC: 16,
};

test('createCanvasTargets allocates linear intermediate color textures', () => {
  const createdTextures = [];
  const device = createMockDevice(createdTextures);
  const canvas = {
    clientWidth: 128,
    clientHeight: 72,
    width: 0,
    height: 0,
  };

  const targets = createCanvasTargets(device, canvas, 'bgra8unorm', 1);

  assert.equal(canvas.width, 128);
  assert.equal(canvas.height, 72);
  assert.equal(createdTextures[0].format, 'rgba16float');
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 128 && texture.size[1] === 72));
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 64 && texture.size[1] === 36));
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 32 && texture.size[1] === 18));
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 16 && texture.size[1] === 9));
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 8 && texture.size[1] === 4));
  assert.ok(createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 4 && texture.size[1] === 2));
  assert.equal(targets.getRenderView() !== null, true);
  assert.equal(targets.getBloomLevelCount(), 5);
  assert.equal(targets.getDofBlurView() !== null, true);
  assert.equal(targets.getBloomDownsampleView(0) !== null, true);
  assert.equal(targets.getBloomUpsampleView(4) !== null, true);
  assert.deepEqual(targets.getBloomLevelSize(0), { width: 64, height: 36 });
  assert.deepEqual(targets.getBloomLevelSize(4), { width: 4, height: 2 });
  assert.equal(
    createdTextures.some((texture) => texture.format === 'rgba16float' && texture.size[0] === 128 && texture.size[1] === 72),
    true,
  );
  assert.equal(
    createdTextures.filter((texture) => texture.format === 'rgba32float' && texture.size[0] === 128 && texture.size[1] === 72).length,
    5,
  );
});

/**
 * モック GPU デバイスを作成します。
 * @param {object[]} createdTextures - 作成された texture の記録先。
 * @returns {object} GPUDevice 互換オブジェクト。
 */
function createMockDevice(createdTextures) {
  return {
    createTexture(desc) {
      createdTextures.push(desc);
      return {
        desc,
        createView() {
          return { texture: this };
        },
        destroy() {},
      };
    },
    createSampler() {
      return {};
    },
    queue: {
      writeBuffer() {},
      writeTexture() {},
    },
  };
}
