import assert from 'node:assert/strict';
import test from 'node:test';

import { TimelineManager } from '../source/application/timeline/timeline-manager.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';
import { upsertAnimationClipBoneKeyframe } from '../source/infrastructure/animation/gltf-animation.js';
import { createVmdAnimationSource } from '../source/application/animation/runtime-animation.js';

test('shared timeline syncs frame, playback range, and play state to every model', () => {
  const instances = [
    {
      model: { bones: [], morphs: [] },
      scene: { boneLocalTransforms: [] },
      morphController: { resetManualWeight() {} },
      animationController: {
        currentFrame: 0,
        isPlaying: false,
        playbackRangeStart: 0,
        playbackRangeEnd: null,
        maxFrame: 48,
      },
      vmd: null,
      animationSource: null,
    },
    {
      model: { bones: [], morphs: [] },
      scene: { boneLocalTransforms: [] },
      morphController: { resetManualWeight() {} },
      animationController: {
        currentFrame: 3,
        isPlaying: false,
        playbackRangeStart: 0,
        playbackRangeEnd: null,
        maxFrame: 96,
      },
      vmd: null,
      animationSource: null,
    },
  ];

  const manager = new TimelineManager({
    modelManager: {
      instances,
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });

  manager.seek(24, { keepManualValues: true });
  manager.setPlaybackRange(10, 40);
  manager.play();

  assert.equal(manager.currentFrame, 24);
  assert.equal(manager.isPlaying, true);
  assert.deepEqual(manager.getPlaybackRange(), { start: 10, end: 40 });
  for (const instance of instances) {
    assert.equal(instance.animationController.currentFrame, 24);
    assert.equal(instance.animationController.isPlaying, true);
    assert.equal(instance.animationController.playbackRangeStart, 10);
    assert.equal(instance.animationController.playbackRangeEnd, 40);
  }

  manager.stop();
  for (const instance of instances) {
    assert.equal(instance.animationController.isPlaying, false);
  }
});

test('stepKeyframe moves to the next keyframe from the active instance source', () => {
  const instance = {
    model: { bones: [], morphs: [] },
    scene: { boneLocalTransforms: [] },
    morphController: { resetManualWeight() {} },
    animationController: {
      currentFrame: 5,
      keyframesByFrame: [6, 30],
      stepNextKeyframe() {
        throw new Error('stepNextKeyframe should not be called');
      },
      stepPreviousKeyframe() {
        throw new Error('stepPreviousKeyframe should not be called');
      },
    },
    vmd: {
      signature: 'Vocaloid Motion Data 0002',
      modelName: 'ActiveModel',
      boneKeyframes: [
        { boneName: 'Root', frameNum: 5, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { boneName: 'Root', frameNum: 10, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { boneName: 'Root', frameNum: 20, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      ],
      faceKeyframes: [],
      cameraKeyframes: [],
      lightKeyframes: [],
      selfShadowKeyframes: [],
    },
    vmdName: 'ActiveModel.vmd',
    animationSource: null,
    animationSourceType: 'vmd',
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;
  const originalSeek = manager.seek.bind(manager);
  const seekCalls = [];
  manager.seek = (frame, options) => {
    seekCalls.push(frame);
    return originalSeek(frame, options);
  };

  manager.stepKeyframe(1);
  assert.deepEqual(seekCalls, [10]);
  assert.equal(manager.currentFrame, 10);
  assert.equal(instance.animationController.currentFrame, 10);

  manager.stepKeyframe(-1);
  assert.deepEqual(seekCalls, [10, 5]);
  assert.equal(manager.currentFrame, 5);
});

test('assignAnimationSourceToActiveInstance preserves the shared frame on the assigned controller', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  const setAnimationClipCalls = [];
  const instance = {
    model: { bones: [], morphs: [] },
    scene: { boneLocalTransforms: [] },
    morphController: { resetManualWeight() {} },
    animationController: {
      currentFrame: 0,
      isPlaying: false,
      playbackRangeStart: 0,
      playbackRangeEnd: null,
      setAnimationClip(assignedClip) {
        setAnimationClipCalls.push(assignedClip);
      },
      setVmd() {},
      setBoneMappings() {},
    },
    vmd: null,
    animationSource: null,
    animationSourceType: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });

  manager.seek(18, { keepManualValues: true });
  manager.assignAnimationSourceToActiveInstance({
    kind: 'gltf',
    name: 'Walk',
    clip,
  });

  assert.equal(setAnimationClipCalls.length, 1);
  assert.equal(instance.animationController.currentFrame, 18);
  assert.equal(manager.currentFrame, 18);
});

test('registerBoneKeyframe applies the same frame to every selected bone', () => {
  const resetCalls = [];
  const setVmdCalls = [];
  const seekCalls = [];
  const instance = {
    model: {
      name: 'TestModel',
      bones: [
        { name: 'BoneA' },
        { name: 'BoneB' },
      ],
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 2, 3],
          manualTranslation: [0.5, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
        },
        {
          translation: [4, 5, 6],
          manualTranslation: [0, 0.5, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
        },
      ],
    },
    animationController: {
      currentFrame: 12.4,
      setVmd(vmd) {
        setVmdCalls.push(vmd);
      },
      seek(frame) {
        seekCalls.push(frame);
      },
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform(_inst, boneIndex) {
        resetCalls.push(boneIndex);
      },
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0, 1],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: {
      getInterpolationArray() {
        return [0, 0, 0, 0, 0, 0, 0, 0];
      },
    },
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;

  manager.registerBoneKeyframe();

  assert.equal(instance.vmd.boneKeyframes.length, 2);
  assert.deepEqual(instance.vmd.boneKeyframes.map((keyframe) => keyframe.boneName), ['BoneA', 'BoneB']);
  assert.deepEqual(resetCalls, [0, 1]);
  assert.equal(setVmdCalls.length, 1);
  assert.equal(seekCalls.length, 0);
});

test('registerLightKeyframe stores a keyed light pose at the current frame', () => {
  const setVmdCalls = [];
  const seekCalls = [];
  const instance = {
    model: {
      name: 'LightModel',
      bones: [],
      morphs: [],
    },
    scene: {
      boneLocalTransforms: [],
    },
    animationController: {
      currentFrame: 18.2,
      setVmd(vmd) {
        setVmdCalls.push(vmd);
      },
      seek(frame) {
        seekCalls.push(frame);
      },
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;

  manager.registerLightKeyframe({
    color: [0.25, 0.5, 0.75, 1],
    position: [1, -1, 0],
    rotation: [0, 0, 0, 1],
  });

  const source = manager.getSceneAnimationSource('light');
  assert.equal(source.data.lightKeyframes.length, 1);
  assert.equal(source.data.lightKeyframes[0].frameNum, 18);
  assert.deepEqual(source.data.lightKeyframes[0].color, [0.25, 0.5, 0.75]);
  assert.deepEqual(source.data.lightKeyframes[0].position, [1, -1, 0]);
  assert.deepEqual(source.data.lightKeyframes[0].rotation, [0, 0, 0, 1]);
  assert.equal(setVmdCalls.length, 0);
  assert.equal(seekCalls.length, 0);
});

test('registerLightKeyframe in rotation mode does not create a position key', () => {
  const instance = {
    model: {
      name: 'LightModel',
      bones: [],
      morphs: [],
    },
    scene: {
      boneLocalTransforms: [],
    },
    animationController: {
      currentFrame: 18.2,
      setVmd() {},
      seek() {},
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;

  manager.registerLightKeyframe({
    mode: 'rotation',
    color: [0.25, 0.5, 0.75, 1],
    position: null,
    direction: [0, -1, 0],
    rotation: [0, 0, 0, 1],
  });

  const source = manager.getSceneAnimationSource('light');
  assert.equal(source.data.lightKeyframes.length, 1);
  assert.equal(source.data.lightKeyframes[0].frameNum, 18);
  assert.equal(source.data.lightKeyframes[0].position, null);
  assert.equal(source.data.lightKeyframes[0].keyedPosition, false);
  assert.deepEqual(source.data.lightKeyframes[0].rotation, [0, 0, 0, 1]);
  assert.equal(source.data.lightKeyframes[0].keyedRotation, true);
});

test('registerLightKeyframe updates the existing light keyframe on the same frame', () => {
  const instance = {
    model: {
      name: 'LightModel',
      bones: [],
      morphs: [],
    },
    scene: {
      boneLocalTransforms: [],
    },
    animationController: {
      currentFrame: 18.2,
      setVmd() {},
      seek() {},
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;
  manager.assignSceneAnimationSource('light', createVmdAnimationSource('Light.vmd', {
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'LightModel',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 18,
        color: [1, 1, 1],
        position: [1, -1, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
    selfShadowKeyframes: [],
  }, null, { targetType: 'light' }));

  manager.registerLightKeyframe({
    color: [0.25, 0.5, 0.75, 1],
    position: [0, 1, -1],
    rotation: [0.5, 0.5, 0.5, 0.5],
  });

  const source = manager.getSceneAnimationSource('light');
  assert.equal(source.data.lightKeyframes.length, 1);
  assert.equal(source.data.lightKeyframes[0].frameNum, 18);
  assert.deepEqual(source.data.lightKeyframes[0].color, [0.25, 0.5, 0.75]);
  assert.deepEqual(source.data.lightKeyframes[0].position, [0, 1, -1]);
  assert.deepEqual(source.data.lightKeyframes[0].rotation, [0.5, 0.5, 0.5, 0.5]);
});

test('registerLightKeyframe in rotation mode clears the existing position key', () => {
  const instance = {
    model: {
      name: 'LightModel',
      bones: [],
      morphs: [],
    },
    scene: {
      boneLocalTransforms: [],
    },
    animationController: {
      currentFrame: 18.2,
      setVmd() {},
      seek() {},
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;
  manager.assignSceneAnimationSource('light', createVmdAnimationSource('Light.vmd', {
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'LightModel',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 18,
        color: [1, 1, 1],
        position: [1, -1, 0],
        rotation: [0, 0, 0, 1],
        keyedPosition: true,
        keyedRotation: true,
      },
    ],
    selfShadowKeyframes: [],
  }, null, { targetType: 'light' }));

  manager.registerLightKeyframe({
    mode: 'rotation',
    color: [0.25, 0.5, 0.75, 1],
    position: null,
    direction: [0, -1, 0],
    rotation: [0.5, 0.5, 0.5, 0.5],
  });

  const source = manager.getSceneAnimationSource('light');
  assert.equal(source.data.lightKeyframes.length, 1);
  assert.equal(source.data.lightKeyframes[0].position, null);
  assert.equal(source.data.lightKeyframes[0].keyedPosition, false);
  assert.deepEqual(source.data.lightKeyframes[0].rotation, [0.5, 0.5, 0.5, 0.5]);
});

test('registerBoneKeyframe filters non-translatable bones in translation mode', () => {
  const instance = {
    model: {
      name: 'TestModel',
      bones: [
        { name: 'BoneA', flags: 0x0002 },
        { name: 'BoneB', flags: 0x0004 },
      ],
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 2, 3],
          manualTranslation: [0.5, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
        },
        {
          translation: [4, 5, 6],
          manualTranslation: [0, 0.5, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
        },
      ],
    },
    animationController: {
      currentFrame: 18.9,
      setVmd() {},
      seek() {},
    },
    vmd: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0, 1],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: {
      getInterpolationArray() {
        return null;
      },
    },
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;

  manager.registerBoneKeyframe({ mode: 'translation' });

  assert.equal(instance.vmd.boneKeyframes.length, 1);
  assert.equal(instance.vmd.boneKeyframes[0].boneName, 'BoneB');
});

test('registerBoneKeyframe updates an active glTF clip without creating VMD data', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk', timelineFps: 30 });
  const instance = {
    model: {
      name: 'TestModel',
      bones: [
        { name: 'BoneA', flags: 0x0006 },
      ],
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 2, 3],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    animationController: {
      currentFrame: 9,
      setAnimationClipCalls: [],
      seekCalls: [],
      setAnimationClip(nextClip) {
        this.setAnimationClipCalls.push(nextClip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for active glTF clips');
      },
      seek(frame) {
        this.seekCalls.push(frame);
      },
    },
    vmd: null,
    vmdName: null,
    animationSource: {
      kind: 'gltf',
      name: 'Walk',
      clip,
    },
    animationSourceType: 'gltf',
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = instance.animationController.currentFrame;

  manager.registerBoneKeyframe();

  assert.equal(instance.vmd, null);
  assert.equal(instance.animationSource.clip.channels.length >= 2, true);
  assert.equal(instance.animationController.setAnimationClipCalls.length, 1);
  assert.deepEqual(instance.animationController.seekCalls, []);
});

test('registerCameraKeyframe creates a dedicated camera VMD source for VRM models', () => {
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'Avatar',
      vrm: {
        humanoidBoneNameMap: {},
      },
    },
    animationController: {
      currentFrame: 12,
      setAnimationClipCalls: [],
      setAnimationClip(clip) {
        this.setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called');
      },
      setBoneMappings() {},
    },
    vmd: null,
    animationSource: null,
    animationSourceType: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 12;

  manager.registerCameraKeyframe({
    distance: 8,
    target: [1, 2, 3],
    rotation: [0.25, 0.5, 0.75],
    fov: 45,
    perspective: 1,
  });

  const source = manager.getSceneAnimationSource('camera');
  assert.equal(instance.animationSourceType, null);
  assert.equal(source.targetType, 'camera');
  assert.equal(source.data.cameraKeyframes.length, 1);
  assert.equal(source.clip.channels.some((channel) => channel.target.kind === 'camera'), true);
});

test('registerLightKeyframe creates a dedicated light VMD source for VRM models', () => {
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'Avatar',
      vrm: {
        humanoidBoneNameMap: {},
      },
    },
    animationController: {
      currentFrame: 18,
      setAnimationClipCalls: [],
      setAnimationClip(clip) {
        this.setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called');
      },
      setBoneMappings() {},
    },
    vmd: null,
    animationSource: null,
    animationSourceType: null,
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 18;

  manager.registerLightKeyframe({
    color: [0.25, 0.5, 0.75],
    position: [1, -1, 0],
    rotation: [0, 0, 0, 1],
    direction: [0, -1, 0],
  });

  const source = manager.getSceneAnimationSource('light');
  assert.equal(instance.animationSourceType, null);
  assert.equal(source.targetType, 'light');
  assert.equal(source.data.lightKeyframes.length, 1);
  assert.equal(source.clip.channels.some((channel) => channel.target.kind === 'light'), true);
});

test('assignAnimationSourceToActiveInstance applies resolved animation mapping to the controller', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'SourceHip',
      path: 'rotation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [0, 0, 0, 1] },
      ],
    },
  });

  const setBoneMappingsCalls = [];
  const instance = {
    model: {
      bones: [
        { name: 'MappedHip' },
      ],
    },
    animationController: {
      setAnimationClip() {},
      setVmd() {
        throw new Error('setVmd should not be called for glTF sources');
      },
      setBoneMappings(mappings) {
        setBoneMappingsCalls.push(mappings);
      },
    },
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map([
      ['gltf:Walk', {
        sourceKey: 'gltf:Walk',
        entries: new Map([
          ['SourceHip', {
            sourceBoneName: 'SourceHip',
            targetBoneName: 'MappedHip',
            rotationOffsetEuler: [0, 0, 0],
            translationOffset: [1, 2, 3],
            scaleOffset: [1, 1, 1],
          }],
        ]),
      }],
    ]),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });

  manager.assignAnimationSourceToActiveInstance({
    kind: 'gltf',
    name: 'Walk',
    clip,
  });

  assert.equal(setBoneMappingsCalls.length, 1);
  assert.equal(setBoneMappingsCalls[0].length, 1);
  assert.equal(setBoneMappingsCalls[0][0].sourceBoneName, 'SourceHip');
  assert.equal(setBoneMappingsCalls[0][0].targetBoneIndex, 0);
  assert.deepEqual(setBoneMappingsCalls[0][0].translationOffset, [1, 2, 3]);
});

test('registerBoneKeyframe creates a VRMA source for VRM models', () => {
  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: 'Hips', flags: 0x0006 },
      ],
      morphs: [],
      ik: [
        { enabled: true },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 2, 3],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 12,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 12;

  manager.registerBoneKeyframe();

  assert.equal(instance.animationSourceType, 'vrma');
  assert.equal(instance.vmd, null);
  assert.equal(setAnimationClipCalls.length, 1);
  assert.equal(instance.animationSource.preserveIkEnabled, true);
  assert.deepEqual(instance.model.ik.map((ik) => ik.enabled), [true]);
  assert.equal(instance.animationSource.clip.channels.length >= 2, true);
  assert.equal(instance.animationSource.clip.channels.some((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === 'hips'
    && channel?.target?.path === 'translation'
  )), true);
});

test('registerBoneKeyframe stores VRM hips translation bindTranslation for Alicia-style base offsets', () => {
  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: 'Hips', flags: 0x0006 },
      ],
      morphs: [],
      ik: [
        { enabled: true },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          baseTranslation: [0, 0.9714602, 0],
          translation: [0, 0, 0],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 12,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 12;

  manager.registerBoneKeyframe();

  assert.equal(instance.animationSourceType, 'vrma');
  assert.equal(setAnimationClipCalls.length, 1);
  const hipsTranslationChannel = instance.animationSource.clip.channels.find((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === 'hips'
    && channel?.target?.path === 'translation'
  ));
  assert.ok(hipsTranslationChannel);
  assert.deepEqual(hipsTranslationChannel.target.bindTranslation, [0, 0.9714602, 0]);
  assert.deepEqual(hipsTranslationChannel.sampler.keyframes[0].value, [0, 0, 0]);
});

test('registerBoneKeyframe stores VRM hips translation in raw VRMA space when 全ての親 translation exists', () => {
  const clip = createEmptyAnimationClip({
    name: 'ExistingVrma',
    timelineFps: 30,
    metadata: {
      sourceFormat: 'vrma',
      vrmAnimation: {
        humanBones: {
          hips: 'hips',
        },
        expressions: {},
      },
    },
  });
  upsertAnimationClipBoneKeyframe(clip, '全ての親', 12, {
    translation: [10, 0, 0],
  });

  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: '全ての親', flags: 0x0006 },
        { name: 'Hips', flags: 0x0006 },
      ],
      morphs: [],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [10, 0, 0],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        {
          translation: [11, 2, 3],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 12,
      setAnimationClip(clipValue) {
        setAnimationClipCalls.push(clipValue);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: {
      kind: 'vrma',
      name: 'ExistingVrma.vrma',
      clip,
    },
    animationSourceName: 'ExistingVrma.vrma',
    animationSourceType: 'vrma',
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [1],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map([['ExistingVrma.vrma', instance.animationSource]]),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 12;

  manager.registerBoneKeyframe({ mode: 'translation' });

  assert.equal(setAnimationClipCalls.length, 1);
  const hipsTranslationChannel = instance.animationSource.clip.channels.find((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === 'hips'
    && channel?.target?.path === 'translation'
  ));
  assert.ok(hipsTranslationChannel);
  assert.deepEqual(hipsTranslationChannel.sampler.keyframes[0].value, [11, 2, 3]);
});

test('registerBoneKeyframe stores folded VRM hips translation when 全ての親 has [1,0,1]', () => {
  const clip = createEmptyAnimationClip({
    name: 'ExistingVrmaRootAndHips',
    timelineFps: 30,
    metadata: {
      sourceFormat: 'vrma',
      vrmAnimation: {
        humanBones: {
          hips: 'hips',
        },
        expressions: {},
      },
    },
  });
  upsertAnimationClipBoneKeyframe(clip, '全ての親', 12, {
    translation: [1, 0, 1],
  });

  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: '全ての親', flags: 0x0006 },
        { name: 'Hips', flags: 0x0006 },
      ],
      morphs: [],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [1, 0, 1],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        {
          translation: [1, -1, 1],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 12,
      setAnimationClip(clipValue) {
        setAnimationClipCalls.push(clipValue);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: {
      kind: 'vrma',
      name: 'ExistingVrmaRootAndHips.vrma',
      clip,
    },
    animationSourceName: 'ExistingVrmaRootAndHips.vrma',
    animationSourceType: 'vrma',
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [1],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map([['ExistingVrmaRootAndHips.vrma', instance.animationSource]]),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 12;

  manager.registerBoneKeyframe({ mode: 'translation' });

  assert.equal(setAnimationClipCalls.length, 1);
  const hipsTranslationChannel = instance.animationSource.clip.channels.find((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === 'hips'
    && channel?.target?.path === 'translation'
  ));
  assert.ok(hipsTranslationChannel);
  assert.deepEqual(hipsTranslationChannel.sampler.keyframes[0].value, [1, -1, 1]);
});

test('registerBoneKeyframe keeps VRM all-parent channels editable in VRMA mode', () => {
  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: '全ての親', flags: 0x0006 },
      ],
      morphs: [],
      vrm: {
        humanoidBoneNameMap: {},
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [4, 5, 6],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 8,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 8;

  manager.registerBoneKeyframe({ mode: 'all' });

  assert.equal(instance.animationSourceType, 'vrma');
  assert.equal(instance.vmd, null);
  assert.equal(setAnimationClipCalls.length, 1);
  assert.equal(instance.animationSource.clip.channels.some((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === '全ての親'
    && channel?.target?.path === 'translation'
  )), true);
  assert.equal(instance.animationSource.clip.channels.some((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === '全ての親'
    && channel?.target?.path === 'rotation'
  )), true);
});

test('registerBoneKeyframe keeps VRM 下半身 channels editable in VRMA mode', () => {
  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [
        { name: '下半身', flags: 0x0006 },
      ],
      morphs: [],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      boneLocalTransforms: [
        {
          translation: [0, 0, 0],
          manualTranslation: [0, 0, 0],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    },
    morphController: {
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 8,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [0],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 8;

  manager.registerBoneKeyframe({ mode: 'rotation' });

  assert.equal(instance.animationSourceType, 'vrma');
  assert.equal(instance.vmd, null);
  assert.equal(setAnimationClipCalls.length, 1);
  assert.equal(instance.animationSource.clip.channels.some((channel) => (
    channel?.target?.kind === 'bone'
    && channel?.target?.name === '下半身'
    && channel?.target?.path === 'rotation'
  )), true);
});

test('registerMorphKeyframe appends morph weights to a VRMA source for VRM models', () => {
  const setAnimationClipCalls = [];
  const manualWeightCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [],
      morphs: [
        { name: 'happy' },
      ],
      vrm: {
        humanoidBoneNameMap: {},
      },
    },
    scene: {
      boneLocalTransforms: [],
    },
    morphController: {
      setManualWeight(index, value) {
        manualWeightCalls.push([index, value]);
      },
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 15,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 15;

  manager.registerMorphKeyframe('happy', 0.75);

  assert.equal(instance.animationSourceType, 'vrma');
  assert.equal(setAnimationClipCalls.length, 1);
  assert.deepEqual(manualWeightCalls, [[0, -1]]);
  const morphChannel = instance.animationSource.clip.channels.find((channel) => channel?.target?.kind === 'morph');
  assert.ok(morphChannel);
  assert.equal(morphChannel.target.name, 'happy');
  assert.equal(morphChannel.target.vrmaExpressionName, 'happy');
  assert.equal(morphChannel.target.vrmaExpressionType, 'preset');
  assert.equal(morphChannel.sampler.keyframes[0].value, 0.75);
});

test('registerMorphKeyframe blocks non-animatable VRMA lookAt expressions', () => {
  const setAnimationClipCalls = [];
  const instance = {
    model: {
      magic: 'Vrm',
      name: 'VrmModel',
      bones: [],
      morphs: [
        {
          name: 'lookUp',
          vrmExpressionName: 'lookUp',
          vrmExpressionType: 'preset',
        },
      ],
      vrm: {
        humanoidBoneNameMap: {},
      },
    },
    scene: {
      boneLocalTransforms: [],
    },
    morphController: {
      setManualWeight() {},
      resetManualWeight() {},
    },
    animationController: {
      currentFrame: 15,
      setAnimationClip(clip) {
        setAnimationClipCalls.push(clip);
      },
      setVmd() {
        throw new Error('setVmd should not be called for VRMA editing');
      },
      setBoneMappings() {},
    },
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceType: null,
    animationMappingBySourceKey: new Map(),
  };

  const manager = new TimelineManager({
    modelManager: {
      instances: [instance],
      resetManualTransform() {},
    },
    selection: {
      activeInstanceIndex: 0,
      selectedBoneIndices: [],
      activeBoneIndex: -1,
    },
    timelineView: null,
    interpolationPanel: null,
    vmdManager: {
      vmds: new Map(),
      vrmas: new Map(),
    },
    refreshScene() {},
    updateVmdListUI() {},
  });

  manager.currentFrame = 15;
  manager.registerMorphKeyframe('lookUp', 0.75);

  assert.equal(instance.animationSource, null);
  assert.equal(setAnimationClipCalls.length, 0);
});
