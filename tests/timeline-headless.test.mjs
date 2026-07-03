import assert from 'node:assert/strict';
import test from 'node:test';

import { TimelineHeadlessController, TimelineHeadlessViewState } from '../source/application/timeline/timeline-headless.js';

const groupedModel = {
  bones: [
    { name: 'Root' },
    { name: 'Arm' },
    { name: 'Leg' },
  ],
  morphs: [],
  displayFrames: [
    {
      name: 'Upper',
      specialFlag: 0,
      frames: [
        { type: 0, index: 1 },
        { type: 0, index: 2 },
      ],
    },
  ],
};

const groupedVmd = {
  boneKeyframes: [
    {
      boneName: 'Arm',
      frameNum: 12,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    },
    {
      boneName: 'Leg',
      frameNum: 12,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    },
    {
      boneName: 'Arm',
      frameNum: 20,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    },
  ],
  faceKeyframes: [],
  cameraKeyframes: [],
  lightKeyframes: [],
  selfShadowKeyframes: [],
};

test('TimelineHeadlessViewState keeps display frames collapsed and supports grouped selection', () => {
  const state = new TimelineHeadlessViewState();

  state.setSource(groupedVmd, groupedModel);
  assert.equal(state.collapsedTrackIds.has('display-frame:0:Upper'), true);

  const groupTrack = state.findTrackById('display-frame:0:Upper');
  assert.ok(groupTrack);
  state.toggleTrackCollapse(groupTrack);
  assert.equal(state.collapsedTrackIds.has('display-frame:0:Upper'), false);

  const hit = state.findKeyframeHit(24, 12, {
    pixelsPerFrame: 2,
    rowHeight: 24,
    scrollLeft: 0,
    scrollTop: 0,
  });
  assert.ok(hit);
  assert.equal(hit.track.id, 'display-frame:0:Upper');
  assert.deepEqual(
    hit.entries.map((entry) => entry.track.id).sort(),
    ['bone:Arm', 'bone:Leg'],
  );
});

test('TimelineHeadlessViewState collects marquee selections without DOM access', () => {
  const state = new TimelineHeadlessViewState();

  state.setSource(groupedVmd, groupedModel, { collapseState: [] });
  const entries = state.collectKeyframeEntriesInRange(
    { x: 8, y: 32 },
    { x: 30, y: 68 },
    {
      pixelsPerFrame: 2,
      rowHeight: 24,
      scrollLeft: 0,
      scrollTop: 0,
    },
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.track.id).sort(),
    ['bone:Arm', 'bone:Leg'],
  );
});

test('TimelineHeadlessController syncs playback state across instances', () => {
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

  const controller = new TimelineHeadlessController({
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

  controller.seek(24, { keepManualValues: true });
  controller.setPlaybackRange(10, 40);
  controller.play();

  assert.equal(controller.currentFrame, 24);
  assert.deepEqual(controller.getPlaybackRange(), { start: 10, end: 40 });
  instances.forEach((instance) => {
    assert.equal(instance.animationController.currentFrame, 24);
    assert.equal(instance.animationController.isPlaying, true);
    assert.equal(instance.animationController.playbackRangeStart, 10);
    assert.equal(instance.animationController.playbackRangeEnd, 40);
  });
});

test('TimelineHeadlessController stores camera and light keyframes in separate scene sources', () => {
  const instance = {
    model: { bones: [], morphs: [], displayFrames: [] },
    scene: { boneLocalTransforms: [] },
    morphController: { resetManualWeight() {} },
    animationController: {
      currentFrame: 0,
      isPlaying: false,
      playbackRangeStart: 0,
      playbackRangeEnd: null,
      maxFrame: 0,
    },
    vmd: null,
    animationSource: null,
  };

  const controller = new TimelineHeadlessController({
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
      registerAnimationSource() {},
      getSceneVmdSource() {
        return null;
      },
      selectedListValue: '',
    },
    refreshScene() {},
    updateVmdListUI() {},
  });

  controller.seek(12, { keepManualValues: true });
  controller.registerCameraKeyframe({
    distance: 35,
    target: [0, 8, 0],
    rotation: [0, 0, 0],
    fov: 50,
    perspective: 1,
  });
  controller.registerLightKeyframe({
    color: [1, 0.9, 0.8],
    direction: [0, -1, 0],
    rotation: [0, 0, 0, 1],
    mode: 'rotation',
  });

  const cameraSource = controller.getSceneAnimationSource('camera');
  const lightSource = controller.getSceneAnimationSource('light');
  assert.ok(cameraSource);
  assert.ok(lightSource);
  assert.equal(instance.animationSource, null);
  assert.equal(instance.vmd, null);
  assert.deepEqual(
    cameraSource.data.cameraKeyframes.map((keyframe) => keyframe.frameNum),
    [12],
  );
  assert.deepEqual(
    lightSource.data.lightKeyframes.map((keyframe) => keyframe.frameNum),
    [12],
  );
});
