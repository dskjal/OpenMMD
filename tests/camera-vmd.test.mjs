import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationController } from '../source/core/animation/animation.js';
import {
  applyCameraKeyframesToCamera,
  applyCameraManualFov,
  applyCameraManualPose,
  clearCameraManualPose,
  computeCameraFitDistance,
  createCameraState,
  createAxisAlignedCameraView,
  createCameraRotation,
  setCameraManualFov,
  setCameraManualPose,
  setCameraManualView,
} from '../source/core/scene/camera.js';
import {
  applyVmdLightKeyframesToLightObject,
  createLightObjectState,
  createLightRotationFromVmdPosition,
} from '../source/core/scene/light-object.js';
import { VMDLoader } from '../source/infrastructure/loaders/vmd-loader.js';
import { VMDWriter } from '../source/infrastructure/loaders/vmd-writer.js';
import { TimelineManager } from '../source/application/timeline/timeline-manager.js';
import {
  createTracksFromAnimationSource,
  upsertCameraKeyframe,
  upsertLightKeyframe,
} from '../source/core/animation/timeline-data.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';

test('upsertCameraKeyframe updates the same frame and creates default interpolation', () => {
  const vmd = upsertCameraKeyframe(null, 12, {
    distance: 30,
    target: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    fov: 44.5,
    perspective: 1,
  });

  const updated = upsertCameraKeyframe(vmd, 12, {
    distance: 31,
    target: [4, 5, 6],
    rotation: [0.4, 0.5, 0.6],
    fov: 45.5,
    perspective: 0,
  });

  assert.equal(updated.cameraKeyframes.length, 1);
  assert.equal(updated.cameraKeyframes[0].distance, 31);
  assert.deepEqual(updated.cameraKeyframes[0].target, [4, 5, 6]);
  assert.deepEqual(updated.cameraKeyframes[0].rotation, [0.4, 0.5, 0.6]);
  assert.equal(updated.cameraKeyframes[0].fov, 45.5);
  assert.equal(updated.cameraKeyframes[0].perspective, 0);
  assert.equal(updated.cameraKeyframes[0].interpolation.length, 24);
});

test('upsertLightKeyframe updates the same frame and preserves light data', () => {
  const source = upsertLightKeyframe(null, 3, {
    color: [1, 0.5, 0.25],
    position: [1, -1, 0],
    rotation: [0, 0, 0, 1],
  });

  const updated = upsertLightKeyframe(source, 3, {
    color: [0.2, 0.4, 0.6],
    position: [2, -2, 0],
    direction: [0, -1, 0],
    rotation: [0.5, 0.5, 0.5, 0.5],
  });

  assert.equal(updated.lightKeyframes.length, 1);
  assert.equal(updated.lightKeyframes[0].frameNum, 3);
  assert.deepEqual(updated.lightKeyframes[0].color, [0.2, 0.4, 0.6]);
  assert.deepEqual(updated.lightKeyframes[0].position, [2, -2, 0]);
  assert.deepEqual(updated.lightKeyframes[0].direction, [0, -1, 0]);
  assert.deepEqual(updated.lightKeyframes[0].rotation, [0.5, 0.5, 0.5, 0.5]);
});

test('upsertLightKeyframe can update only rotation on the same frame', () => {
  const source = upsertLightKeyframe(null, 3, {
    color: [1, 0.5, 0.25],
    position: [1, -1, 0],
    rotation: [0, 0, 0, 1],
  });

  const updated = upsertLightKeyframe(source, 3, {
    color: [0.2, 0.4, 0.6],
    direction: [0, -1, 0],
    rotation: [0.5, 0.5, 0.5, 0.5],
    keyedPosition: false,
    keyedRotation: true,
  });

  assert.equal(updated.lightKeyframes.length, 1);
  assert.deepEqual(updated.lightKeyframes[0].color, [0.2, 0.4, 0.6]);
  assert.equal(updated.lightKeyframes[0].position, null);
  assert.equal(updated.lightKeyframes[0].keyedPosition, false);
  assert.deepEqual(updated.lightKeyframes[0].rotation, [0.5, 0.5, 0.5, 0.5]);
  assert.equal(updated.lightKeyframes[0].keyedRotation, true);
});

test('createTracksFromAnimationSource keeps light-only VMD sources visible in the timeline', () => {
  const tracks = createTracksFromAnimationSource({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'LightOnly',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 5,
        color: [1, 1, 1],
        position: [1, -1, 0],
      },
    ],
    selfShadowKeyframes: [],
  }, null);

  assert.equal(tracks.some((track) => track.id === 'light'), true);
  const lightTrack = tracks.find((track) => track.id === 'light');
  assert.equal(lightTrack.keyframes.length, 1);
  assert.equal(lightTrack.keyframes[0].frame, 5);
});

test('VMDWriter rounds camera FOV to an integer on export', () => {
  const source = upsertCameraKeyframe(null, 0, {
    distance: 10,
    target: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    fov: 44.5,
    perspective: 1,
  });

  const writer = new VMDWriter();
  const buffer = writer.write(source);
  const loader = new VMDLoader();
  const parsed = loader.parse(buffer);

  assert.equal(parsed.cameraKeyframes.length, 1);
  assert.equal(parsed.cameraKeyframes[0].fov, 45);
});

test('VMDWriter warns and skips unsupported scale channels during export', () => {
  const clip = createEmptyAnimationClip({
    name: 'ScaleClip',
    metadata: {
      modelName: 'ScaleClip',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'Root',
      path: 'scale',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 1, 1] },
        { time: 1 / 30, frameNum: 1, value: [2, 2, 2] },
      ],
    },
  });

  const writer = new VMDWriter();
  const buffer = writer.write(clip);
  const parsed = new VMDLoader().parse(buffer);

  assert.equal(parsed.boneKeyframes.length, 0);
  assert.equal(writer.lastWarnings.length, 1);
  assert.equal(writer.lastWarnings[0].code, 'unsupported-scale-channel');
});

test('VMDWriter resamples step morph channels and reports a warning', () => {
  const clip = createEmptyAnimationClip({
    name: 'MorphClip',
    metadata: {
      modelName: 'MorphClip',
    },
  });
  clip.channels.push({
    target: {
      kind: 'morph',
      name: 'Smile',
      path: 'weights',
    },
    sampler: {
      interpolation: 'STEP',
      keyframes: [
        { time: 0, frameNum: 0, value: 0 },
        { time: 2 / 30, frameNum: 2, value: 1 },
      ],
    },
  });

  const writer = new VMDWriter();
  const buffer = writer.write(clip);
  const parsed = new VMDLoader().parse(buffer);

  assert.equal(writer.lastWarnings.length, 1);
  assert.equal(writer.lastWarnings[0].code, 'resampled-morph-channel');
  assert.deepEqual(parsed.faceKeyframes.map((keyframe) => keyframe.frameNum), [0, 1, 2]);
  assert.deepEqual(parsed.faceKeyframes.map((keyframe) => keyframe.weight), [0, 0, 1]);
});

test('VMD light keyframes keep directional-light helper data on load and save from rotation', () => {
  const writer = new VMDWriter();
  const buffer = writer.write({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'Light',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 0,
        color: [0.2, 0.4, 0.6],
        position: [1, -1, 0],
        rotation: createLightRotationFromVmdPosition([1, -1, 0]),
      },
    ],
    selfShadowKeyframes: [],
  });
  const parsed = new VMDLoader().parse(buffer);

  assert.equal(parsed.lightKeyframes.length, 1);
  assert.deepEqual(parsed.lightKeyframes[0].color.map((value) => Number(value.toFixed(6))), [0.2, 0.4, 0.6]);
  assert.deepEqual(parsed.lightKeyframes[0].position.map((value) => Number(value.toFixed(6))), [1, -1, 0]);
  assert.ok(Array.isArray(parsed.lightKeyframes[0].direction));
  assert.equal(parsed.lightKeyframes[0].rotation.length, 4);
});

test('VMDWriter keeps the stored light position when rotation helper data is present', () => {
  const writer = new VMDWriter();
  const buffer = writer.write({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'Light',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 0,
        color: [0.2, 0.4, 0.6],
        position: [1, -1, 0],
        rotation: createLightRotationFromVmdPosition([0, -1, 0]),
      },
    ],
    selfShadowKeyframes: [],
  });
  const parsed = new VMDLoader().parse(buffer);

  assert.equal(parsed.lightKeyframes.length, 1);
  assert.deepEqual(parsed.lightKeyframes[0].position.map((value) => Number(value.toFixed(6))), [1, -1, 0]);
});

test('VMDWriter reconstructs light position from rotation when the position key is omitted', () => {
  const writer = new VMDWriter();
  const rotation = createLightRotationFromVmdPosition([0, -1, -1]);
  const buffer = writer.write({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'Light',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [
      {
        frameNum: 0,
        color: [0.2, 0.4, 0.6],
        position: null,
        rotation,
        keyedPosition: false,
        keyedRotation: true,
      },
    ],
    selfShadowKeyframes: [],
  });
  const parsed = new VMDLoader().parse(buffer);

  assert.equal(parsed.lightKeyframes.length, 1);
  assert.deepEqual(
    parsed.lightKeyframes[0].position.map((value) => Number(value.toFixed(6))),
    [0, -1, -1].map((value) => Number(value.toFixed(6))),
  );
});

test('loaded camera and light keyframes move with the timeline', () => {
  const writer = new VMDWriter();
  const parsed = new VMDLoader().parse(writer.write({
    signature: 'Vocaloid Motion Data 0002',
    modelName: 'TimelineMotion',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [
      {
        frameNum: 0,
        distance: 20,
        target: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        interpolation: new Uint8Array(24).fill(20),
        fov: 45,
        perspective: 1,
      },
      {
        frameNum: 10,
        distance: 30,
        target: [4, 5, 6],
        rotation: [0.4, 0.5, 0.6],
        interpolation: new Uint8Array(24).fill(20),
        fov: 55,
        perspective: 0,
      },
    ],
    lightKeyframes: [
      {
        frameNum: 0,
        color: [1, 0.5, 0.25],
        position: [1, -1, 0],
      },
      {
        frameNum: 10,
        color: [0.25, 0.5, 1],
        position: [-1, -1, 0],
      },
    ],
    selfShadowKeyframes: [],
  }));

  const camera = createCameraState(1);
  applyCameraKeyframesToCamera(camera, parsed.cameraKeyframes, 0);
  assert.deepEqual(camera.center, [1, 2, 3]);
  assert.equal(camera.distance, 20);
  assert.deepEqual(
    [camera.phi, camera.theta, camera.roll].map((value) => Number(value.toFixed(6))),
    [-0.1, 0.2, 0.3],
  );
  assert.equal(Math.round(camera.fovY * 180 / Math.PI), 45);

  applyCameraKeyframesToCamera(camera, parsed.cameraKeyframes, 10);
  assert.deepEqual(camera.center, [4, 5, 6]);
  assert.equal(camera.distance, 30);
  assert.deepEqual(
    [camera.phi, camera.theta, camera.roll].map((value) => Number(value.toFixed(6))),
    [-0.4, 0.5, 0.6],
  );
  assert.equal(Math.round(camera.fovY * 180 / Math.PI), 55);

  const light = createLightObjectState({
    position: [0, 0, 0],
    direction: [0, -1, 0],
  });
  applyVmdLightKeyframesToLightObject(light, parsed.lightKeyframes, 0);
  const firstLightRotation = Array.from(light.rotation).map((value) => Number(value.toFixed(6)));
  assert.deepEqual(light.position.map((value) => Number(value.toFixed(6))), [1, -1, 0]);

  applyVmdLightKeyframesToLightObject(light, parsed.lightKeyframes, 10);
  assert.deepEqual(light.position.map((value) => Number(value.toFixed(6))), [-1, -1, 0]);
  assert.notDeepEqual(Array.from(light.rotation).map((value) => Number(value.toFixed(6))), firstLightRotation);
});

test('applyCameraKeyframesToCamera uses internal FOV interpolation data', () => {
  const baseKeyframes = [
    {
      frameNum: 0,
      distance: 10,
      target: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      fov: 30,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
    {
      frameNum: 10,
      distance: 10,
      target: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      fov: 60,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
  ];

  const linearCamera = createCameraState(1);
  const curvedCamera = createCameraState(1);

  applyCameraKeyframesToCamera(linearCamera, baseKeyframes.map((keyframe) => ({
    ...keyframe,
    fovInterpolation: null,
  })), 5);
  applyCameraKeyframesToCamera(curvedCamera, baseKeyframes.map((keyframe, index) => (
    index === 0
      ? { ...keyframe, fovInterpolation: Uint8Array.from([0, 0, 0, 127]) }
      : keyframe
  )), 5);

  assert.equal(curvedCamera.distance, 10);
  assert.deepEqual(curvedCamera.center, [1, 2, 3]);
  assert.equal(curvedCamera.phi, -0.1);
  assert.equal(curvedCamera.theta, 0.2);
  assert.equal(curvedCamera.roll, 0.3);
  assert.notEqual(curvedCamera.fovY, linearCamera.fovY);
});

test('manual camera FOV overrides VMD on the current frame and clears on frame change', () => {
  const camera = createCameraState(1);
  const keyframes = [
    {
      frameNum: 0,
      distance: 10,
      target: [0, 0, 0],
      rotation: [0, 0, 0],
      fov: 30,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
    {
      frameNum: 20,
      distance: 10,
      target: [0, 0, 0],
      rotation: [0, 0, 0],
      fov: 60,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
  ];

  applyCameraKeyframesToCamera(camera, keyframes, 10);
  const animatedFov = camera.fovY;

  setCameraManualFov(camera, 75 * Math.PI / 180, 10);
  assert.equal(applyCameraManualFov(camera, 10), true);
  assert.equal(camera.fovY, 75 * Math.PI / 180);

  applyCameraKeyframesToCamera(camera, keyframes, 12);
  assert.equal(applyCameraManualFov(camera, 12), false);
  assert.notEqual(camera.fovY, 75 * Math.PI / 180);
  assert.notEqual(camera.fovY, animatedFov);
});

test('manual camera pose overrides VMD on the current frame and clears on frame change', () => {
  const camera = createCameraState(1);
  const keyframes = [
    {
      frameNum: 0,
      distance: 10,
      target: [0, 0, 0],
      rotation: [0, 0, 0],
      fov: 30,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
    {
      frameNum: 20,
      distance: 20,
      target: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      fov: 60,
      interpolation: Uint8Array.from([20, 20, 107, 107]),
      perspective: 1,
    },
  ];

  applyCameraKeyframesToCamera(camera, keyframes, 10);
  const animatedCenter = camera.center.slice();
  const animatedDistance = camera.distance;
  const animatedPhi = camera.phi;
  const animatedTheta = camera.theta;

  setCameraManualPose(camera, [4, 5, 6], 33, 0.4, 0.5, 0.6, 10);
  assert.equal(applyCameraManualPose(camera, 10), true);
  assert.deepEqual(camera.center, [4, 5, 6]);
  assert.equal(camera.distance, 33);
  assert.equal(camera.phi, 0.4);
  assert.equal(camera.theta, 0.5);
  assert.equal(camera.roll, 0.6);

  applyCameraKeyframesToCamera(camera, keyframes, 12);
  assert.equal(applyCameraManualPose(camera, 12), false);
  assert.notDeepEqual(camera.center, [4, 5, 6]);
  assert.notEqual(camera.distance, 33);
  assert.notEqual(camera.phi, 0.4);
  assert.notEqual(camera.theta, 0.5);
  assert.notEqual(camera.roll, 0.6);
  assert.notDeepEqual(camera.center, animatedCenter);
  assert.notEqual(camera.distance, animatedDistance);
  assert.notEqual(camera.phi, animatedPhi);
  assert.notEqual(camera.theta, animatedTheta);
});

test('setCameraManualView converts eye and target into manual orbit pose', () => {
  const camera = createCameraState(1);
  const eye = [10, 20, 30];
  const target = [4, 6, 8];

  setCameraManualView(camera, eye, target, 0.25, 7);
  assert.equal(applyCameraManualPose(camera, 7), true);
  assert.deepEqual(camera.center, target);
  assert.ok(Math.abs(camera.distance - Math.hypot(6, 14, 22)) < 1e-6);
  assert.deepEqual(createCameraRotation(camera).map((value) => Number(value.toFixed(6))), [
    Number((-camera.phi).toFixed(6)),
    Number(camera.theta.toFixed(6)),
    Number(camera.roll.toFixed(6)),
  ]);
  assert.equal(camera.roll, 0.25);

  const rebuiltEye = [
    camera.center[0] + camera.distance * Math.cos(camera.phi) * Math.sin(camera.theta),
    camera.center[1] + camera.distance * Math.sin(camera.phi),
    camera.center[2] + camera.distance * Math.cos(camera.phi) * Math.cos(camera.theta),
  ];
  assert.ok(Math.abs(rebuiltEye[0] - eye[0]) < 1e-6);
  assert.ok(Math.abs(rebuiltEye[1] - eye[1]) < 1e-6);
  assert.ok(Math.abs(rebuiltEye[2] - eye[2]) < 1e-6);
});

test('clearCameraManualPose removes manual camera state immediately', () => {
  const camera = createCameraState(1);
  setCameraManualPose(camera, [4, 5, 6], 33, 0.4, 0.5, 0.6, 10);
  clearCameraManualPose(camera);

  assert.equal(camera.manualCenter, null);
  assert.equal(camera.manualDistance, null);
  assert.equal(camera.manualPhi, null);
  assert.equal(camera.manualTheta, null);
  assert.equal(camera.manualRoll, null);
  assert.equal(camera.manualPoseFrame, null);
});

test('createAxisAlignedCameraView frames the active model from fixed directions', () => {
  const camera = createCameraState(1);
  camera.fovY = 90 * Math.PI / 180;
  const sceneBounds = {
    min: [0, 0, 0],
    max: [8, 6, 4],
  };

  const frontView = createAxisAlignedCameraView(sceneBounds, camera, 'z', 1, 1);
  assert.deepEqual(frontView.target, [4, 3, 2]);
  assert.ok(Math.abs(frontView.distance - 2.4) < 1e-9);
  assert.ok(Math.abs(frontView.eye[0] - 4) < 1e-9);
  assert.ok(Math.abs(frontView.eye[1] - 3) < 1e-9);
  assert.ok(Math.abs(frontView.eye[2] - 4.4) < 1e-9);

  const topView = createAxisAlignedCameraView(sceneBounds, camera, 'y', 1, 1);
  assert.deepEqual(topView.target, [4, 3, 2]);
  assert.ok(Math.abs(topView.distance - 2.4) < 1e-9);
  assert.ok(Math.abs(topView.eye[0] - 4) < 1e-9);
  assert.ok(Math.abs(topView.eye[1] - 5.4) < 1e-9);
  assert.ok(Math.abs(topView.eye[2] - 2) < 1e-9);
});

test('computeCameraFitDistance grows with the visible half extents', () => {
  const sceneBounds = {
    min: [-2, -1, -3],
    max: [2, 1, 3],
  };

  const distance = computeCameraFitDistance(sceneBounds, 60 * Math.PI / 180, 16 / 9, 'z');
  const verticalHalfSize = 1;
  const horizontalHalfSize = 2;
  const tanHalfVFov = Math.tan(60 * Math.PI / 360);
  const tanHalfHFov = tanHalfVFov * (16 / 9);
  const expected = Math.max(horizontalHalfSize / tanHalfHFov, verticalHalfSize / tanHalfVFov) * 0.6;

  assert.ok(Math.abs(distance - expected) < 1e-9);
});

test('AnimationController uses camera keyframes for playback range and next-key navigation', () => {
  const controller = new AnimationController({ bones: [] }, null, 60);
  const originalNow = Date.now;

  controller.setVmd({
    cameraKeyframes: [
      {
        frameNum: 0,
        distance: 10,
        target: [0, 0, 0],
        rotation: [0, 0, 0],
        fov: 30,
      },
      {
        frameNum: 20,
        distance: 10,
        target: [0, 0, 0],
        rotation: [0, 0, 0],
        fov: 60,
      },
    ],
  });

  assert.equal(controller.maxFrame, 20);

  controller.seek(0);
  controller.stepNextKeyframe();
  assert.equal(controller.currentFrame, 20);

  controller.currentFrame = 18;
  controller.isPlaying = true;
  controller.lastFrameTime = 0;

  Date.now = () => 1000;
  try {
    controller.update(1, []);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(controller.currentFrame, 8);
  assert.equal(controller.isPlaying, true);
});

test('TimelineManager refreshes the animation controller after registering a camera keyframe', () => {
  const instance = {
    model: {
      name: 'CameraOnly',
      bones: [],
      morphs: [],
      displayFrames: [],
    },
    scene: {},
    animationController: new AnimationController({ bones: [] }, null, 60),
    morphController: {
      resetManualWeight() {},
      update() {},
      modifiedMaterials: new Set(),
      materialStates: [],
      vmBuffer: null,
    },
    vmd: null,
    vmdName: null,
  };
  instance.animationController.currentFrame = 20;

  const modelManager = {
    instances: [instance],
  };
  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    selectedRigidbodyIndex: -1,
  };
  const vmdManager = {
    vmds: new Map(),
  };

  const manager = new TimelineManager({
    modelManager,
    selection,
    timelineView: null,
    interpolationPanel: null,
    vmdManager,
    refreshScene() {},
    updateVmdListUI() {},
  });
  manager.currentFrame = 20;

  manager.registerCameraKeyframe({
    distance: 10,
    target: [0, 0, 0],
    rotation: [0, 0, 0],
    fov: 45,
    interpolation: null,
    perspective: 1,
  });

  const source = manager.getSceneAnimationSource('camera');
  assert.equal(source.data.cameraKeyframes.length, 1);
  assert.equal(manager.getMaxFrame(), 20);
  assert.equal(manager.currentFrame, 20);
  assert.equal(instance.animationController.currentFrame, 20);
});
