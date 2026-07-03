import assert from 'node:assert/strict';
import test from 'node:test';

import { buildViewerStateSnapshot } from '../source/infrastructure/api/api-state.js';

test('buildViewerStateSnapshot serializes loaded models and bone transforms', () => {
  const instance = {
    model: {
      name: 'Model One',
      bones: [
        {
          name: 'Root',
        },
      ],
    },
    vmdName: 'Walk',
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 2, 3],
          rotation: [0, 0, 0, 1],
          manualTranslation: [0.25, -0.5, 1],
          manualRotation: [0, 0, 0, 1],
          worldRotation: [0, 0, 0, 1],
        },
      ],
      boneWorldPositions: [
        [4, 5, 6],
      ],
    },
  };

  const snapshot = buildViewerStateSnapshot({
    selection: {
      activeInstanceIndex: 0,
    },
    rendererState: {
      environmentHdrPath: 'test-data/sundowner_deck_1k.hdr',
      environmentHdrName: 'sundowner_deck_1k.hdr',
      environmentHdrIntensity: 1.5,
      environmentHdrLoaded: true,
    },
    modelManager: {
      instances: [instance],
    },
    vmdManager: {
      vmds: new Map([['Walk', {}]]),
    },
  });

  assert.equal(typeof snapshot.timestamp, 'number');
  assert.equal(snapshot.activeInstanceIndex, 0);
  assert.equal(snapshot.activeModelName, 'Model One');
  assert.deepEqual(snapshot.modelNames, ['Model One']);
  assert.deepEqual(snapshot.vmdNames, ['Walk']);
  assert.equal(snapshot.models.length, 1);
  assert.equal(snapshot.models[0].bones.length, 1);
  assert.deepEqual(snapshot.models[0].bones[0].local.position, [1.25, 1.5, 4]);
  assert.deepEqual(snapshot.models[0].bones[0].local.rotation, [0, 0, 0, 1]);
  assert.deepEqual(snapshot.models[0].bones[0].world.position, [4, 5, 6]);
  assert.deepEqual(snapshot.models[0].bones[0].world.rotation, [0, 0, 0, 1]);
  assert.equal(snapshot.environmentHdrPath, 'test-data/sundowner_deck_1k.hdr');
  assert.equal(snapshot.environmentHdrName, 'sundowner_deck_1k.hdr');
  assert.equal(snapshot.environmentHdrIntensity, 1.5);
  assert.equal(snapshot.environmentHdrLoaded, true);
});

test('buildViewerStateSnapshot stores raw world position for VRM hips', () => {
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        {
          name: '全ての親',
          position: [0, 0, 0],
        },
        {
          name: 'Hips',
          position: [0, 1.9714602, 0],
        },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    animationSource: {
      clip: {
        timelineFps: 30,
        metadata: {
          sourceFormat: 'vrma',
        },
        channels: [
          {
            target: { kind: 'bone', name: '全ての親', path: 'translation' },
            sampler: {
              interpolation: 'LINEAR',
              keyframes: [{ time: 0, value: [1, 0, 1] }],
            },
          },
        ],
      },
    },
    animationController: {
      currentFrame: 0,
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 0, 1],
          rotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          worldRotation: [0, 0, 0, 1],
          worldMatrix: new Float32Array(16),
        },
        {
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          worldRotation: [0, 0, 0, 1],
          worldMatrix: Object.assign(new Float32Array(16), {
            12: 1,
            13: 0.9714602,
            14: 1,
          }),
        },
      ],
      boneWorldPositions: [
        [1, 0, 1],
        [1, 0.9714602, 1],
      ],
    },
  };

  const snapshot = buildViewerStateSnapshot({
    selection: {
      activeInstanceIndex: 0,
    },
    modelManager: {
      instances: [instance],
    },
    vmdManager: {
      vmds: new Map(),
    },
  });

  assert.deepEqual(
    snapshot.models[0].bones[1].world.position.map((value) => Number(value.toFixed(6))),
    [1, 0.97146, 1],
  );
});

test('buildViewerStateSnapshot does not fall back to timeline state for the active instance', () => {
  const activeInstance = {
    model: {
      name: 'Ignored',
      bones: [],
    },
    scene: {
      boneLocalTransforms: [],
      boneWorldPositions: [],
    },
  };

  const snapshot = buildViewerStateSnapshot({
    selection: {
      activeInstanceIndex: 99,
    },
    modelManager: {
      instances: [activeInstance],
    },
    getActiveInstance() {
      return null;
    },
    timelineManager: {
      getActiveInstance() {
        return activeInstance;
      },
    },
  });

  assert.equal(snapshot.activeInstanceIndex, -1);
  assert.equal(snapshot.activeModelName, '');
  assert.equal(snapshot.models[0].isActive, false);
});
