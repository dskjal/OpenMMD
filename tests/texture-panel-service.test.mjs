import assert from 'node:assert/strict';
import test from 'node:test';
import { createTexturePanelService } from '../source/application/material/texture-panel-service.js';

test('texture panel service initializes missing texture color spaces and reports mixed state', () => {
  const instance = {
    model: {
      textures: ['textures/a.png', 'textures/b.png'],
      textureColorSpaces: ['gamma-2.2', 'none'],
    },
    selectedTextureIndices: [0, 1],
    pipelineResources: {
      textureResources: [
        { previewUrl: 'blob:a' },
        { previewUrl: 'blob:b' },
      ],
    },
  };
  const service = createTexturePanelService({
    getActiveInstance: () => instance,
    getLangData: () => ({}),
    modelManager: {},
  });

  const state = service.getPanelState();
  assert.equal(state.gridItems.length, 2);
  assert.equal(state.gridItems[0].name, 'a.png');
  assert.equal(state.colorSpaceState.mixed, true);
  assert.equal(instance.model.textureColorSpaces.length, 2);
});

test('texture panel service applies texture color space to selected textures', async () => {
  const instance = {
    model: {
      textures: ['textures/a.png'],
      textureColorSpaces: [],
    },
    selectedTextureIndices: [0],
    pipelineResources: {
      textureResources: [],
    },
  };
  const calls = [];
  const service = createTexturePanelService({
    getActiveInstance: () => instance,
    getLangData: () => ({}),
    modelManager: {
      updateTextureColorSpaces: (...args) => {
        calls.push(args);
      },
    },
  });

  const applied = await service.applyColorSpace('none');
  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [0]);
  assert.equal(calls[0][2], 'none');
});
