import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createTracksFromAnimationSource, createTracksFromMixedSources, createTracksFromVmd } from '../source/core/animation/timeline-data.js';
import {
  createEmptyAnimationClip,
  upsertAnimationClipCameraKeyframe,
  upsertAnimationClipLightKeyframe,
} from '../source/core/animation/animation-clip.js';
import { createResolvedAnimationBoneMappings } from '../source/core/animation/animation-mapper.js';
import { upsertAnimationClipBoneKeyframe } from '../source/infrastructure/animation/gltf-animation.js';
import { VRMALoader } from '../source/infrastructure/loaders/vrma-loader.js';
import { VRMAWriter } from '../source/infrastructure/loaders/vrma-writer.js';
import { loadModelDataFromFile } from '../source/core/model/model-scene.js';

const model = {
  bones: [
    { name: 'Root' },
    { name: 'Arm' },
    { name: 'Leg' },
    { name: 'Spare' }
  ],
  morphs: [
    { name: 'Smile' },
    { name: 'Blink' }
  ],
  displayFrames: [
    {
      name: 'Upper',
      specialFlag: 0,
      frames: [
        { type: 0, index: 1 },
        { type: 1, index: 0 }
      ]
    },
    {
      name: 'Lower',
      specialFlag: 0,
      frames: [
        { type: 0, index: 2 }
      ]
    }
  ]
};

test('createTracksFromVmd builds display frame structure without VMD data', () => {
  const tracks = createTracksFromVmd(null, model);

  const topLevelLabels = tracks.filter((track) => !track.parentId).map((track) => track.label);
  assert.deepEqual(topLevelLabels, ['Upper', 'Lower', 'Other']);

  const upper = tracks.find((track) => track.id === 'display-frame:0:Upper');
  const lower = tracks.find((track) => track.id === 'display-frame:1:Lower');
  const other = tracks.find((track) => track.id === 'display-frame:other');

  assert.ok(upper);
  assert.ok(lower);
  assert.ok(other);
  assert.deepEqual(upper.children.map((track) => track.label), ['Arm', 'Smile']);
  assert.deepEqual(lower.children.map((track) => track.label), ['Leg']);
  assert.deepEqual(other.children.map((track) => track.label), ['Root', 'Spare', 'Blink']);
  assert.equal(upper.keyframes.length, 0);
  assert.equal(other.keyframes.length, 0);
});

test('createTracksFromVmd aggregates keyframes into display frame groups and Other', () => {
  const vmd = {
    boneKeyframes: [
      { boneName: 'Arm', frameNum: 12 },
      { boneName: 'Leg', frameNum: 24 },
      { boneName: 'Spare', frameNum: 30 }
    ],
    faceKeyframes: [
      { name: 'Smile', frameNum: 18 },
      { name: 'Blink', frameNum: 42 }
    ]
  };

  const tracks = createTracksFromVmd(vmd, model);

  const upper = tracks.find((track) => track.id === 'display-frame:0:Upper');
  const lower = tracks.find((track) => track.id === 'display-frame:1:Lower');
  const other = tracks.find((track) => track.id === 'display-frame:other');

  assert.ok(upper);
  assert.ok(lower);
  assert.ok(other);
  assert.deepEqual(upper.keyframes.map((kf) => kf.frame), [12, 18]);
  assert.deepEqual(lower.keyframes.map((kf) => kf.frame), [24]);
  assert.deepEqual(other.keyframes.map((kf) => kf.frame), [30, 42]);
  assert.deepEqual(upper.children.map((track) => track.id), ['bone:Arm', 'morph:Smile']);
  assert.deepEqual(other.children.map((track) => track.label), ['Root', 'Spare', 'Blink']);
});

test('createTracksFromAnimationSource groups generic bone and morph channels by frame', () => {
  const clip = createEmptyAnimationClip({ name: 'glTF', timelineFps: 30 });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'Arm',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [0, 0, 0] },
        { time: 1, frameNum: 30, value: [1, 0, 0] },
      ],
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'Arm',
      path: 'rotation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 1, frameNum: 30, value: [0, 0, 0, 1] },
      ],
    },
  });
  clip.channels.push({
    target: {
      kind: 'morph',
      name: 'Smile',
      path: 'weights',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0.5, frameNum: 15, value: 0.8 },
      ],
    },
  });

  const tracks = createTracksFromAnimationSource(clip, model);
  const upper = tracks.find((track) => track.id === 'display-frame:0:Upper');

  assert.ok(upper);
  assert.deepEqual(upper.keyframes.map((keyframe) => keyframe.frame), [0, 15, 30]);
  assert.deepEqual(upper.children.map((track) => track.id), ['bone:Arm', 'morph:Smile']);
});

test('createTracksFromVmd places VRM expression morphs under Expressions', () => {
  const modelWithExpressions = {
    bones: [
      { name: 'Root' },
      { name: 'Arm' },
      { name: 'Leg' },
    ],
    morphs: [
      { name: 'happy', type: 100, vrmExpressionName: 'happy' },
      { name: 'aa', type: 100, vrmExpressionName: 'aa' },
      { name: 'Blink' },
    ],
    displayFrames: [
      {
        name: 'Body',
        nameEn: 'Body',
        specialFlag: 0,
        frames: [
          { type: 0, index: 1 },
        ],
      },
      {
        name: 'Expressions',
        nameEn: 'Expressions',
        specialFlag: 0,
        frames: [
          { type: 1, index: 0 },
          { type: 1, index: 1 },
        ],
      },
    ],
  };
  const vmd = {
    boneKeyframes: [
      { boneName: 'Arm', frameNum: 12 },
    ],
    faceKeyframes: [
      { name: 'happy', frameNum: 18 },
      { name: 'aa', frameNum: 24 },
      { name: 'Blink', frameNum: 30 },
    ],
  };

  const tracks = createTracksFromVmd(vmd, modelWithExpressions);
  const expressions = tracks.find((track) => track.id === 'display-frame:1:Expressions');
  const other = tracks.find((track) => track.id === 'display-frame:other');

  assert.ok(expressions);
  assert.deepEqual(expressions.children.map((track) => track.id), ['morph:happy', 'morph:aa']);
  assert.deepEqual(expressions.keyframes.map((kf) => kf.frame), [18, 24]);
  assert.ok(other);
  assert.deepEqual(other.children.map((track) => track.id), ['bone:Root', 'bone:Leg', 'morph:Blink']);
  assert.deepEqual(other.keyframes.map((kf) => kf.frame), [30]);
});

test('createTracksFromAnimationSource keeps glTF bone tracks visible without display frames', () => {
  const clip = createEmptyAnimationClip({ name: 'glTF', timelineFps: 30 });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'Bone001',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [0, 0, 0] },
        { time: 1, frameNum: 30, value: [1, 0, 0] },
      ],
    },
  });

  const gltfModel = {
    bones: [
      { name: 'Bone001' },
    ],
    morphs: [],
    displayFrames: [],
  };

  const tracks = createTracksFromAnimationSource(clip, gltfModel);

  assert.deepEqual(tracks.map((track) => track.id), ['bone:Bone001']);
  assert.equal(tracks[0].parentId, null);
  assert.deepEqual(tracks[0].keyframes.map((keyframe) => keyframe.frame), [0, 30]);
});

test('createTracksFromAnimationSource maps VRMA humanoid bones onto AliciaSolid display frames', async () => {
  const originalSelf = globalThis.self;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });

  try {
    const { model } = await loadModelDataFromFile(createFileLike('./test-data/AliciaSolid.vrm'), 1);
    const vrmaBuffer = await fs.readFile('./test-data/rotation-test.vrma');
    const source = await new VRMALoader().parse(
      vrmaBuffer.buffer.slice(vrmaBuffer.byteOffset, vrmaBuffer.byteOffset + vrmaBuffer.byteLength),
      'rotation-test.vrma',
    );

    const tracks = createTracksFromAnimationSource(source.clip, model);
    const topLevelTracks = tracks.filter((track) => !track.parentId);
    const bodyTrack = topLevelTracks.find((track) => track.id === 'display-frame:0:胴');
    const hipsTrack = tracks.find((track) => track.id === 'bone:Hips');
    const leftArmTrack = tracks.find((track) => track.id === 'bone:LeftArm');
    const rightArmTrack = tracks.find((track) => track.id === 'bone:RightArm');

    assert.ok(bodyTrack);
    assert.ok(hipsTrack);
    assert.ok(leftArmTrack);
    assert.ok(rightArmTrack);
    assert.equal(hipsTrack.keyframes.length > 0, true);
    assert.equal(leftArmTrack.keyframes.length > 0, true);
    assert.equal(rightArmTrack.keyframes.length > 0, true);
    assert.equal(bodyTrack.keyframes.length > 0, true);
  } finally {
    globalThis.self = originalSelf;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('createTracksFromMixedSources merges model and scene animation tracks without cross-contamination', () => {
  const modelClip = createEmptyAnimationClip({ name: 'model', timelineFps: 30 });
  upsertAnimationClipBoneKeyframe(modelClip, 'Arm', 10, {
    translation: [1, 2, 3],
    rotation: [0, 0, 0, 1],
  });

  const cameraSource = {
    kind: 'vmd',
    name: 'Camera.vmd',
    targetType: 'camera',
    clip: createEmptyAnimationClip({
      name: 'camera',
      timelineFps: 30,
      metadata: {
        sourceFormat: 'vmd',
      },
    }),
  };
  cameraSource.clip.metadata.cameraKeyframes = [
    { frameNum: 18, distance: 30, target: [0, 1, 2], rotation: [0, 0, 0], fov: 45, perspective: 1 },
  ];
  upsertAnimationClipCameraKeyframe(cameraSource.clip, 18, {
    distance: 30,
    target: [0, 1, 2],
    rotation: [0, 0, 0],
    fov: 45,
    perspective: 1,
  });

  const lightSource = {
    kind: 'vmd',
    name: 'Light.vmd',
    targetType: 'light',
    clip: createEmptyAnimationClip({
      name: 'light',
      timelineFps: 30,
      metadata: {
        sourceFormat: 'vmd',
      },
    }),
  };
  lightSource.clip.metadata.lightKeyframes = [
    { frameNum: 24, color: [1, 1, 1], direction: [0, -1, 0] },
  ];
  upsertAnimationClipLightKeyframe(lightSource.clip, 24, {
    color: [1, 1, 1],
    direction: [0, -1, 0],
    rotation: [0, 0, 0, 1],
  });

  const tracks = createTracksFromMixedSources(
    { kind: 'vmd', name: 'Model.vmd', targetType: 'model', clip: modelClip },
    model,
    {
      camera: cameraSource,
      light: lightSource,
      shadow: null,
    },
  );

  assert.ok(tracks.find((track) => track.id === 'bone:Arm'));
  assert.deepEqual(tracks.find((track) => track.id === 'camera')?.keyframes.map((keyframe) => keyframe.frame), [18]);
  assert.deepEqual(tracks.find((track) => track.id === 'light')?.keyframes.map((keyframe) => keyframe.frame), [24]);
  assert.equal(Boolean(tracks.find((track) => track.id === 'shadow')), false);
});

test('createTracksFromAnimationSource maps PMX round-tripped VRMA hips keys onto センター so the timeline key remains visible', async () => {
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const loaded = await loadModelDataFromFile(createFileLike('./test-data/Alicia_solid.pmx'), 1);
    const clip = createEmptyAnimationClip({
      name: 'PmxRootYMinus90',
      timelineFps: 30,
      metadata: {
        sourceFormat: 'vmd',
      },
    });
    const radians = -90 * Math.PI / 180;
    upsertAnimationClipBoneKeyframe(clip, '全ての親', 0, {
      rotation: [0, Math.sin(radians / 2), 0, Math.cos(radians / 2)],
    });

    const source = {
      kind: 'vmd',
      name: 'PmxRootYMinus90.vmd',
      clip,
    };
    const instance = {
      model: loaded.model,
      animationSource: source,
      animationMappingBySourceKey: new Map(),
      animationController: {
        maxFrame: 0,
        resolvedBoneMappings: createResolvedAnimationBoneMappings({
          model: loaded.model,
          animationSource: source,
          animationMappingBySourceKey: new Map(),
        }),
      },
    };
    const exported = await new VRMAWriter().write(null, {
      instance,
      model: loaded.model,
      bakeIkToRotation: false,
    });
    const reparsed = await new VRMALoader().parse(exported, 'PmxRootYMinus90.vrma');
    const tracks = createTracksFromAnimationSource(reparsed.clip, loaded.model);
    const centerTrack = tracks.find((track) => track.id === 'bone:センター');
    const hipsTrack = tracks.find((track) => track.id === 'bone:hips');

    assert.ok(centerTrack);
    assert.equal(centerTrack.keyframes.length > 0, true);
    assert.equal(hipsTrack, undefined);
  } finally {
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

/**
 * ローカルファイルを読む File 互換オブジェクトを作成します。
 * @param {string} path - ファイルパス。
 * @returns {{name: string, arrayBuffer: function(): Promise<ArrayBuffer>}} File 互換オブジェクト。
 */
function createFileLike(path) {
  return {
    name: path.split(/[\\/]/).pop(),
    arrayBuffer: async () => {
      const data = await fs.readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
  };
}

function createFileReaderMock() {
  return class FileReaderMock {
    constructor() {
      this.result = null;
      this.onloadend = null;
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}
