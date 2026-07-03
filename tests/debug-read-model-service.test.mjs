import assert from 'node:assert/strict';
import test from 'node:test';

import { createDebugReadModelService } from '../source/application/debug/debug-read-model-service.js';

test('debug read model service returns empty-state messages when no runtime data exists', () => {
  const service = createDebugReadModelService({
    camera: null,
    getActiveInstance: () => null,
    clickedMousePositionUiState: {},
  });

  assert.equal(service.getCameraDebugState().clickedMouseText, 'No click recorded.');
  assert.equal(service.getCameraDebugState().cameraText, 'Camera debug data is not available.');
  assert.equal(service.getBoneDebugState().message, 'Bone debug data is not available.');
  assert.equal(service.getAnimationDebugState().message, 'Animation debug data is not available.');
});

test('debug read model service serializes camera and animation debug rows', () => {
  const activeInstance = {
    model: {
      bones: [
        {
          name: '全ての親',
          baseRotationQuaternion: [0.1, 0.2, 0.3, 0.4],
        },
      ],
    },
    animationController: {
      animationSourceKind: 'vmd',
      getAnimationDebugRotations() {
        return [{
          sourceBoneName: 'src',
          targetBoneName: 'dst',
          euler: [Math.PI / 2, 0, -Math.PI / 4],
        }];
      },
    },
  };
  const service = createDebugReadModelService({
    camera: {
      center: [1, 2, 3],
      distance: 4,
      phi: 0.1,
      theta: 0.2,
      roll: 0.3,
      fovY: 0.4,
      clipPlanes: { near: 0.5, far: 6 },
    },
    getActiveInstance: () => activeInstance,
    clickedMousePositionUiState: {
      clientX: 10,
      clientY: 20,
      canvasX: 30,
      canvasY: 40,
    },
  });

  assert.match(service.getCameraDebugState().clickedMouseText, /Client: 10.0, 20.0/);
  assert.equal(service.getBoneDebugState().rows[0].components[0], '0.100000');
  assert.equal(service.getAnimationDebugState().rows[0].sourceName, 'src');
  assert.equal(service.getAnimationDebugState().rows[0].eulerDegrees[0], '90.000');
});
