import assert from 'node:assert/strict';
import test from 'node:test';

import { mat4, quat, vec3 } from '../source/lib/esm/index.js';
import { AnimationController } from '../source/core/animation/animation.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';
import { quaternionFromEulerXYZ } from '../source/shared/math/math-utils.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { PhysicsEngine } from '../source/core/physics/physics.js';
import { MorphController } from '../source/core/model/morphing.js';

globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('AnimationController keeps jump state until the caller consumes it', () => {
  const controller = new AnimationController({ bones: [] }, null);
  const localTransform = createLocalTransform();

  controller.setVmd({ boneKeyframes: [] });
  assert.equal(controller.jumped, true);

  controller.jumped = false;
  controller.seek(12);
  assert.equal(controller.jumped, true);

  controller.update(1, [localTransform]);
  assert.equal(controller.jumped, true);
});

test('AnimationController marks interpolated bone transforms dirty during update', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Root',
      },
    ],
  }, null, 60);
  const localTransform = createLocalTransform();
  const dirtyCalls = [];

  controller.setVmd({
    boneKeyframes: [
      {
        boneName: 'Root',
        frameNum: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        interpolation: new Array(16).fill(0),
      },
      {
        boneName: 'Root',
        frameNum: 10,
        position: [10, 0, 0],
        rotation: [0, 0, 0, 1],
        interpolation: new Array(16).fill(0),
      },
    ],
  });
  controller.currentFrame = 5;

  controller.update(1, [localTransform], (local) => {
    dirtyCalls.push(local);
  });

  assert.equal(dirtyCalls.length, 2);
  assert.equal(dirtyCalls[0], localTransform);
  assert.equal(dirtyCalls[1], localTransform);
});

test('AnimationController stops at the playback range end', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Root',
      },
    ],
  }, null, 60);
  const localTransform = createLocalTransform();
  const originalNow = Date.now;

  controller.setVmd({
    boneKeyframes: [
      {
        boneName: 'Root',
        frameNum: 20,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
  });
  controller.setPlaybackRange(0, 10);
  controller.currentFrame = 9;
  controller.isPlaying = true;
  controller.lastFrameTime = 0;

  Date.now = () => 1000;
  try {
    controller.update(1, [localTransform]);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(controller.currentFrame, 10);
  assert.equal(controller.isPlaying, false);
});

test('AnimationController loops from the playback range start when end is not set', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Root',
      },
    ],
  }, null, 60);
  const localTransform = createLocalTransform();
  const originalNow = Date.now;

  controller.setVmd({
    boneKeyframes: [
      {
        boneName: 'Root',
        frameNum: 20,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
  });
  controller.setPlaybackRange(5, null);
  controller.currentFrame = 18;
  controller.isPlaying = true;
  controller.lastFrameTime = 0;

  Date.now = () => 600;
  try {
    controller.update(1, [localTransform]);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(controller.currentFrame, 6);
  assert.equal(controller.isPlaying, true);
});

test('AnimationController allows seeking past the last loaded VMD keyframe', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Root',
      },
    ],
  }, null, 60);

  controller.setVmd({
    boneKeyframes: [
      {
        boneName: 'Root',
        frameNum: 20,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
  });

  controller.setPlaybackRange(0, 40);

  assert.equal(controller.playbackRangeEnd, 40);

  controller.seek(35);

  assert.equal(controller.currentFrame, 35);
});

test('AnimationController treats light-only VMD as playable and loopable', () => {
  const controller = new AnimationController({
    bones: [],
  }, null, 60);
  const originalNow = Date.now;

  controller.setVmd({
    lightKeyframes: [
      {
        frameNum: 4,
        color: [1, 1, 1],
        position: [1, -1, 0],
      },
      {
        frameNum: 12,
        color: [0.5, 0.5, 0.5],
        position: [-1, -1, 0],
      },
    ],
  });

  assert.ok(controller.animationClip);
  assert.equal(controller.maxFrame, 12);

  controller.stepNextKeyframe();
  assert.equal(controller.currentFrame, 4);

  controller.stepNextKeyframe();
  assert.equal(controller.currentFrame, 12);

  controller.setPlaybackRange(0, null);
  controller.currentFrame = 11;
  controller.isPlaying = true;
  controller.lastFrameTime = 0;
  controller.loop = true;

  Date.now = () => 600;
  try {
    controller.update(1, []);
  } finally {
    Date.now = originalNow;
  }

  assert.ok(controller.currentFrame >= 0);
  assert.ok(controller.currentFrame < 12);
  assert.equal(controller.isPlaying, true);
});

test('AnimationController applies generic scale channels to bone local transforms', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Root',
      },
    ],
  }, null, 60);
  const localTransform = createLocalTransform();
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
        { time: 10 / 30, frameNum: 10, value: [3, 5, 7] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.currentFrame = 5;
  controller.update(1, [localTransform]);

  assert.deepEqual(Array.from(localTransform.scale), [2, 3, 4]);
});

test('AnimationController applies explicit animation bone mappings with offsets', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'Center',
      },
      {
        name: 'ArmTarget',
      },
    ],
  }, null, 60);
  const centerTransform = createLocalTransform();
  const armTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'MappedClip',
    metadata: {
      modelName: 'MappedClip',
    },
  });
  clip.channels.push(
    {
      target: {
        kind: 'bone',
        name: 'SourceArm',
        path: 'translation',
      },
      sampler: {
        interpolation: 'LINEAR',
        keyframes: [
          { time: 0, frameNum: 0, value: [1, 2, 3] },
        ],
      },
    },
    {
      target: {
        kind: 'bone',
        name: 'SourceArm',
        path: 'rotation',
      },
      sampler: {
        interpolation: 'LINEAR',
        keyframes: [
          { time: 0, frameNum: 0, value: [0, 0, 0, 1] },
        ],
      },
    },
    {
      target: {
        kind: 'bone',
        name: 'SourceArm',
        path: 'scale',
      },
      sampler: {
        interpolation: 'LINEAR',
        keyframes: [
          { time: 0, frameNum: 0, value: [2, 3, 4] },
        ],
      },
    },
  );

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceBoneName: 'SourceArm',
    targetBoneName: 'ArmTarget',
    targetBoneIndex: 1,
    rotationOffsetQuaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    translationOffset: [10, 20, 30],
    scaleOffset: [5, 6, 7],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [centerTransform, armTransform]);

  assert.deepEqual(Array.from(centerTransform.translation), [0, 0, 0]);
  assert.deepEqual(Array.from(armTransform.translation), [11, 22, 33]);
  assert.deepEqual(Array.from(armTransform.scale), [10, 18, 28]);
  assert.ok(Math.abs(armTransform.rotation[0]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[1]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[2] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[3] - Math.SQRT1_2) < 1e-6);
});

test('AnimationController applies basis correction before the explicit rotation offset', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'ArmTarget',
      },
    ],
  }, null, 60);
  const armTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'MappedClip',
    metadata: {
      modelName: 'MappedClip',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'SourceArm',
      path: 'rotation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceBoneName: 'SourceArm',
    targetBoneName: 'ArmTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [1, 0, 0, 0],
    basisCorrectionInverseQuaternion: [-1, 0, 0, 0],
    rotationOffsetQuaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [armTransform]);

  const expectedCorrected = quat.multiply(
    quat.create(),
    quat.fromValues(1, 0, 0, 0),
    quat.fromValues(0, Math.SQRT1_2, 0, Math.SQRT1_2),
  );
  quat.multiply(expectedCorrected, expectedCorrected, quat.fromValues(-1, 0, 0, 0));
  const expectedFinal = quat.multiply(
    quat.create(),
    quat.fromValues(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    expectedCorrected,
  );

  assert.ok(Math.abs(armTransform.rotation[0] - expectedFinal[0]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[1] - expectedFinal[1]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[2] - expectedFinal[2]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[3] - expectedFinal[3]) < 1e-6);
});

test('AnimationController applies basis correction to explicit VMD translation mapping', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'FootIkTarget',
      },
    ],
  }, null, 60);
  const footTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'MappedClip',
    metadata: {
      modelName: 'MappedClip',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'SourceFootIK',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 2, 3] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceBoneName: 'SourceFootIK',
    targetBoneName: 'FootIkTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [0, 1, 0, 0],
    basisCorrectionInverseQuaternion: [0, -1, 0, 0],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [footTransform]);

  assert.deepEqual(
    Array.from(footTransform.translation),
    [-1, 2, -3],
  );
});

test('AnimationController flips VMD explicit mapping translation axes before basis correction', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'CenterTarget',
      },
    ],
  }, null, 60);
  const centerTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'MappedClip',
    metadata: {
      modelName: 'MappedClip',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'SourceCenter',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 2, 3] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vmd',
    sourceBoneName: 'SourceCenter',
    targetBoneName: 'CenterTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [0, 0, 0, 1],
    basisCorrectionInverseQuaternion: [0, 0, 0, 1],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    rotationFlipAxes: { x: true, y: false, z: true },
    translationOffset: [10, 20, 30],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [centerTransform]);

  assert.deepEqual(
    Array.from(centerTransform.translation),
    [9, 22, 27],
  );
});

test('AnimationController flips VMD explicit mapping Euler axes before basis correction', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'ArmTarget',
      },
    ],
  }, null, 60);
  const armTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'MappedClip',
    metadata: {
      modelName: 'MappedClip',
    },
  });
  const sourceEuler = [0.2, -0.3, 0.4];
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'SourceArm',
      path: 'rotation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: Array.from(quaternionFromEulerXYZ(sourceEuler)) },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vmd',
    sourceBoneName: 'SourceArm',
    targetBoneName: 'ArmTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [1, 0, 0, 0],
    basisCorrectionInverseQuaternion: [-1, 0, 0, 0],
    rotationOffsetQuaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    rotationFlipAxes: { x: true, y: false, z: true },
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [armTransform]);

  const flippedRotation = quaternionFromEulerXYZ([-sourceEuler[0], sourceEuler[1], -sourceEuler[2]]);
  const expectedCorrected = quat.multiply(
    quat.create(),
    quat.fromValues(1, 0, 0, 0),
    flippedRotation,
  );
  quat.multiply(expectedCorrected, expectedCorrected, quat.fromValues(-1, 0, 0, 0));
  const expectedFinal = quat.multiply(
    quat.create(),
    quat.fromValues(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    expectedCorrected,
  );
  quat.normalize(expectedFinal, expectedFinal);

  assert.ok(Math.abs(armTransform.rotation[0] - expectedFinal[0]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[1] - expectedFinal[1]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[2] - expectedFinal[2]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[3] - expectedFinal[3]) < 1e-6);
});

test('AnimationController ignores rotationFlipAxes for VRMA explicit translation mapping', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'HipTarget',
      },
    ],
  }, null, 60);
  const hipTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'VrmaClip',
    metadata: {
      modelName: 'VrmaClip',
      sourceFormat: 'vrma',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'hips',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 2, 3] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vrma',
    sourceBoneName: 'hips',
    targetBoneName: 'HipTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [0, 0, 0, 1],
    basisCorrectionInverseQuaternion: [0, 0, 0, 1],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    rotationFlipAxes: { x: true, y: true, z: true },
    translationOffset: [10, 20, 30],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [hipTransform]);

  assert.deepEqual(
    Array.from(hipTransform.translation),
    [11, 22, 33],
  );
});

test('AnimationController applies VRMA translationScale before translationOffset', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'HipTarget',
      },
    ],
  }, null, 60);
  const hipTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'VrmaClip',
    metadata: {
      modelName: 'VrmaClip',
      sourceFormat: 'vrma',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'hips',
      path: 'translation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 2, 3] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vrma',
    sourceBoneName: 'hips',
    targetBoneName: 'HipTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [0, 0, 0, 1],
    basisCorrectionInverseQuaternion: [0, 0, 0, 1],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    translationCorrectionQuaternion: [0, 0, 0, 1],
    translationScale: [2, 3, 4],
    translationOffset: [10, 20, 30],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [hipTransform]);

  assert.deepEqual(
    Array.from(hipTransform.translation),
    [12, 26, 42],
  );
});

test('AnimationController resolves VRMA bindTranslation to model local delta', () => {
  const controller = new AnimationController({
    magic: 'Vrm',
    bones: [
      {
        name: 'HipTarget',
      },
    ],
  }, null, 60);
  const hipTransform = createLocalTransform();
  hipTransform.baseTranslation = vec3.fromValues(0, 0.9714602, 0);
  const clip = createEmptyAnimationClip({
    name: 'VrmaClip',
    metadata: {
      modelName: 'VrmaClip',
      sourceFormat: 'vrma',
    },
  });
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'hips',
      path: 'translation',
      bindTranslation: [0, 0.9714602, 0],
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: [1, 0.0285398, 1] },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vrma',
    sourceBoneName: 'hips',
    targetBoneName: 'HipTarget',
    targetBoneIndex: 0,
    basisCorrectionQuaternion: [0, 0, 0, 1],
    basisCorrectionInverseQuaternion: [0, 0, 0, 1],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    translationCorrectionQuaternion: [0, 0, 0, 1],
    translationScale: [1, 1, 1],
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [hipTransform]);

  assert.ok(Math.abs(hipTransform.translation[0] - 1) < 1e-6);
  assert.ok(Math.abs(hipTransform.translation[1] - 0.0285398) < 1e-6);
  assert.ok(Math.abs(hipTransform.translation[2] - 1) < 1e-6);
});

test('AnimationController applies rotationFlipAxes for VRMA explicit mapping', () => {
  const controller = new AnimationController({
    bones: [
      {
        name: 'ArmTarget',
      },
    ],
  }, null, 60);
  const armTransform = createLocalTransform();
  const clip = createEmptyAnimationClip({
    name: 'VrmaClip',
    metadata: {
      modelName: 'VrmaClip',
      sourceFormat: 'vrma',
    },
  });
  const sourceRotation = quaternionFromEulerXYZ([0.2, -0.3, 0.4]);
  clip.channels.push({
    target: {
      kind: 'bone',
      name: 'leftUpperArm',
      path: 'rotation',
    },
    sampler: {
      interpolation: 'LINEAR',
      keyframes: [
        { time: 0, frameNum: 0, value: Array.from(sourceRotation) },
      ],
    },
  });

  controller.setAnimationClip(clip);
  controller.setBoneMappings([{
    sourceKind: 'vrma',
    sourceBoneName: 'leftUpperArm',
    targetBoneName: 'ArmTarget',
    targetBoneIndex: 0,
    rotationFlipAxes: { x: true, y: true, z: true },
    sourceLocalRestRotation: [0, 0, 0, 1],
    sourceWorldRestRotation: [0, 0, 0, 1],
    targetLocalRestRotation: [0, 0, 0, 1],
    targetWorldRestRotation: [0, 0, 0, 1],
    vrmaBasisCorrectionQuaternion: [0, 0, 0, 1],
    vrmaBasisCorrectionInverseQuaternion: [0, 0, 0, 1],
    rotationOffsetQuaternion: [0, 0, 0, 1],
    vrmaRightLegPostCorrectionQuaternion: [0, 0, 0, 1],
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  }]);
  controller.currentFrame = 0;
  controller.update(1, [armTransform]);

  const expectedRotation = quaternionFromEulerXYZ([-0.2, 0.3, -0.4]);
  assert.ok(Math.abs(armTransform.rotation[0] - expectedRotation[0]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[1] - expectedRotation[1]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[2] - expectedRotation[2]) < 1e-6);
  assert.ok(Math.abs(armTransform.rotation[3] - expectedRotation[3]) < 1e-6);
});

test('ModelManager resets physics after bone matrices have been recomputed', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const localTransform = createLocalTransform();
  localTransform.translation[0] = 10;

  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        flags: 0,
        position: [0, 0, 0],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };

  const instance = {
    model,
    scene,
    animationController: {
      jumped: true,
      update() {},
    },
    morphController: {
      modifiedMaterials: new Set(),
      materialStates: [],
      update() {},
      resetManualWeight() {},
      vmBuffer: makeBuffer(),
    },
    pipelineResources: {
      materials: [],
    },
    fileProvider: null,
    modelPath: '',
    aabb: null,
    vmd: null,
    vmdName: null,
  };

  manager.instances = [instance];

  const order = [];
  const physicsEngine = {
    models: [
      {
        model,
        scene,
        bodies: [],
        joints: [],
        boneToBodiesMap: {},
        boneToPostSimulationBodyMap: {},
      },
    ],
    resetModel(entry) {
      order.push('reset');
      assert.equal(entry.scene.boneLocalTransforms[0].worldMatrix[12], 10);
    },
    update(step) {
      order.push(`update:${step}`);
      assert.deepEqual(order, ['reset', 'update:1']);
    },
  };

  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    selectedRigidbodyIndex: -1,
    hideIkBones: false,
    showBones: false,
    showPhysics: false,
  };

  manager.update(physicsEngine, selection, 1, null);

  assert.deepEqual(order, ['reset', 'update:1']);
  assert.equal(instance.animationController.jumped, false);
  assert.equal(scene.boneLocalTransforms[0].worldMatrix[12], 10);
});

test('ModelManager resets physics when the animation controller jumps during update', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const localTransform = createLocalTransform();
  localTransform.translation[0] = 10;

  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        flags: 0,
        position: [0, 0, 0],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };

  const instance = {
    model,
    scene,
    animationController: {
      jumped: false,
      update() {
        this.jumped = true;
      },
    },
    morphController: {
      modifiedMaterials: new Set(),
      materialStates: [],
      update() {},
      resetManualWeight() {},
      vmBuffer: makeBuffer(),
    },
    pipelineResources: {
      materials: [],
    },
    fileProvider: null,
    modelPath: '',
    aabb: null,
    vmd: null,
    vmdName: null,
  };

  manager.instances = [instance];

  const order = [];
  const physicsEngine = {
    models: [
      {
        model,
        scene,
        bodies: [],
        joints: [],
        boneToBodiesMap: {},
        boneToPostSimulationBodyMap: {},
      },
    ],
    resetModel(entry) {
      order.push('reset');
      assert.equal(entry.scene.boneLocalTransforms[0].worldMatrix[12], 10);
    },
    update(step) {
      order.push(`update:${step}`);
    },
  };

  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    selectedRigidbodyIndex: -1,
    hideIkBones: false,
    showBones: false,
    showPhysics: false,
  };

  manager.update(physicsEngine, selection, 1, null);

  assert.deepEqual(order, ['reset', 'update:1']);
  assert.equal(instance.animationController.jumped, false);
});

test('ModelManager skips physics synchronization when physics is disabled', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const localTransform = createLocalTransform();
  localTransform.translation[0] = 10;

  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        flags: 0,
        position: [0, 0, 0],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };

  const instance = {
    model,
    scene,
    animationController: {
      jumped: false,
      update() {
        this.jumped = true;
      },
    },
    morphController: {
      modifiedMaterials: new Set(),
      materialStates: [],
      update() {},
      resetManualWeight() {},
      vmBuffer: makeBuffer(),
    },
    pipelineResources: {
      materials: [],
    },
    fileProvider: null,
    modelPath: '',
    aabb: null,
    vmd: null,
    vmdName: null,
  };

  manager.instances = [instance];

  const order = [];
  const physicsEngine = {
    enabled: false,
    isEnabled() {
      return this.enabled;
    },
    models: [
      {
        model,
        scene,
        bodies: [],
        joints: [],
        boneToBodiesMap: {},
        boneToPostSimulationBodyMap: {},
      },
    ],
    resetModel() {
      order.push('reset');
    },
    update(step) {
      order.push(`update:${step}`);
    },
  };

  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    selectedRigidbodyIndex: -1,
    hideIkBones: false,
    showBones: false,
    showPhysics: false,
  };

  manager.update(physicsEngine, selection, 1, null);

  assert.deepEqual(order, []);
  assert.equal(instance.animationController.jumped, false);
});

test('ModelManager.recomputeBoneMatrices preserves frozen physics-driven bones while physics is disabled', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const localTransform = createLocalTransform();
  localTransform.translation[0] = 20;
  localTransform.worldMatrix = mat4.fromTranslation(mat4.create(), [10, 0, 0]);
  localTransform.physicsDriven = true;

  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        flags: 0,
        position: [0, 0, 0],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };

  manager.recomputeBoneMatrices(model, scene, true);

  assert.equal(scene.boneLocalTransforms[0].worldMatrix[12], 10);
  assert.equal(scene.boneLocalTransforms[0].physicsDriven, true);
  assert.equal(scene.boneLocalTransforms[0].localDirty, false);
});

test('ModelManager rewrites restored material buffers after alpha morphs are cleared', () => {
  const writes = [];
  const device = createDevice((buffer, offset, data) => {
    writes.push({
      buffer,
      offset,
      data: Array.from(data),
    });
  });
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const materialBuffer = makeBuffer();

  const instance = {
    model: {
      materials: [
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          receiveShadow: false,
          hasEdge: false,
          alphaMode: 'opaque',
        },
      ],
    },
    pipelineResources: {
      materials: [
        {
          buffer: materialBuffer,
          sphereMode: 0,
        },
      ],
    },
    morphController: {
      modifiedMaterials: new Set(),
      previousModifiedMaterials: new Set([0]),
      materialStates: [
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 1],
          specular: [0, 0, 0],
          specularity: 0,
          edgeColor: [0, 0, 0, 1],
          edgeSize: 1,
          textureTint: [1, 1, 1, 1],
          environmentTint: [1, 1, 1, 1],
          toonTint: [1, 1, 1, 1],
        },
      ],
    },
  };

  manager.updateMaterialBuffers(instance);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].buffer, materialBuffer);
  assert.equal(writes[0].data[3], 1);
  assert.equal(writes[0].data[18], 1);
  assert.equal(writes[0].data[23], 0);
  assert.equal(instance.morphController.previousModifiedMaterials.size, 0);
});

test('ModelManager.updateMaterialStateBuffers writes receiveShadow, toon presence, and SSSS visibility', () => {
  const writes = [];
  const device = createDevice((buffer, offset, data) => {
    writes.push({
      buffer,
      offset,
      data: Array.from(data),
    });
  });
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const instance = {
    model: {
      materials: [
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          emissiveSource: 'texture',
          emissiveTexture: { kind: 'path', path: 'emissive.png', colorSpace: 'gamma-2.2' },
          receiveShadow: false,
          hasEdge: false,
          alphaMode: 'opaque',
          noCull: false,
        },
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0],
          specular: [0, 0, 0],
          shininess: 0,
          emissiveSource: 'color',
          emissiveTexture: { kind: 'none' },
          receiveShadow: true,
          hasEdge: false,
          alphaMode: 'cutout',
          noCull: true,
        },
      ],
    },
    pipelineResources: {
      materials: [
        {
          buffer: makeBuffer(),
          sphereMode: 2,
          hasToonTexture: false,
          hasEmissiveTexture: true,
        },
        {
          buffer: makeBuffer(),
          sphereMode: 0,
          hasToonTexture: true,
          hasEmissiveTexture: false,
        },
      ],
    },
    morphController: {
      materialStates: [
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 1],
          specular: [0, 0, 0],
          specularity: 0,
          emissiveSource: 'texture',
          emissiveTexture: { kind: 'path', path: 'emissive.png', colorSpace: 'gamma-2.2' },
        },
        {
          diffuse: [1, 1, 1, 1],
          ambient: [0, 0, 0, 1],
          specular: [0, 0, 0],
          specularity: 0,
          emissiveSource: 'color',
          emissiveTexture: { kind: 'none' },
        },
      ],
    },
    ssssMaterialVisibility: [false, true],
  };

  manager.updateMaterialStateBuffers(instance, [0, 1]);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].data[12], 0);
  assert.equal(writes[0].data[14], 0);
  assert.equal(writes[0].data[15], 0);
  assert.equal(writes[0].data[16], 0);
  assert.equal(writes[0].data[18], 1);
  assert.equal(writes[0].data[19], 1);
  assert.equal(writes[0].data[23], 0);
  assert.equal(writes[0].data[24], 1);
  assert.equal(writes[1].data[12], 1);
  assert.equal(writes[1].data[14], 1);
  assert.equal(writes[1].data[15], 1);
  assert.equal(writes[1].data[16], 1);
  assert.equal(writes[1].data[18], 1);
  assert.equal(writes[1].data[19], 0);
  assert.equal(writes[1].data[23], 0);
  assert.equal(writes[1].data[24], 0);
});

test('MorphController refreshes cached material PBR state after model material edits', () => {
  globalThis.GPUBufferUsage ??= {
    VERTEX: 1,
    COPY_DST: 16,
  };
  const device = createDevice();
  const model = {
    vertices: new Float32Array(27),
    vertexCount: 1,
    materials: [
      {
        diffuse: [1, 1, 1, 1],
        ambient: [0, 0, 0],
        specular: [0, 0, 0],
        shininess: 0,
        metalic: 0.1,
        roughness: 0.2,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0.1, 0.2, 0.3],
        emissiveStrength: 0.4,
      },
    ],
    morphs: [],
  };
  const controller = new MorphController(device, model);

  model.materials[0].metalic = 0.9;
  model.materials[0].roughness = 0.8;
  model.materials[0].emissiveSource = 'texture';
  model.materials[0].emissiveTexture = { kind: 'internal', toonIndex: 1 };
  model.materials[0].emissive = [0.7, 0.6, 0.5];
  model.materials[0].emissiveStrength = 2.0;
  controller.dirty = true;
  controller.update();

  assert.equal(controller.materialStates[0].metalic, 0.9);
  assert.equal(controller.materialStates[0].roughness, 0.8);
  assert.equal(controller.materialStates[0].emissiveSource, 'texture');
  assert.deepEqual(controller.materialStates[0].emissiveTexture, { kind: 'internal', toonIndex: 1 });
  assert.deepEqual(controller.materialStates[0].emissive, [0.7, 0.6, 0.5]);
  assert.equal(controller.materialStates[0].emissiveStrength, 2.0);
});

test('MorphController uses the default roughness when a model material omits it', () => {
  globalThis.GPUBufferUsage ??= {
    VERTEX: 1,
    COPY_DST: 16,
  };
  const device = createDevice();
  const model = {
    vertices: new Float32Array(27),
    vertexCount: 1,
    materials: [
      {
        diffuse: [1, 1, 1, 1],
        ambient: [0, 0, 0],
        specular: [0, 0, 0],
        shininess: 0,
        metalic: 0.1,
        emissiveSource: 'color',
        emissiveTexture: { kind: 'none' },
        emissive: [0.1, 0.2, 0.3],
        emissiveStrength: 0.4,
      },
    ],
    morphs: [],
  };
  const controller = new MorphController(device, model);

  assert.equal(controller.materialStates[0].roughness, 1);
});

test('ModelManager.drawShadowInstance skips materials marked as no cast shadow', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {
    shadowGlobalBindGroup: { label: 'shadow-global' },
  });
  const drawCalls = [];
  const pass = {
    setPipeline(value) {
      drawCalls.push(['pipeline', value]);
    },
    setBindGroup(slot, value) {
      drawCalls.push(['bindGroup', slot, value]);
    },
    setVertexBuffer(slot, value) {
      drawCalls.push(['vertexBuffer', slot, value]);
    },
    setIndexBuffer(buffer, format) {
      drawCalls.push(['indexBuffer', buffer, format]);
    },
    drawIndexed(count, instanceCount, firstIndex) {
      drawCalls.push(['drawIndexed', count, instanceCount, firstIndex]);
    },
  };
  const instance = {
    materialVisibility: [true, true],
    materialCastShadow: [true, false],
    morphController: {
      materialStates: [
        {
          diffuse: [1, 1, 1, 1],
        },
        {
          diffuse: [1, 1, 1, 1],
        },
      ],
      vmBuffer: makeBuffer(),
    },
    meshBuffers: {
      vertexBuffer: makeBuffer(),
      indexBuffer: makeBuffer(),
      indexFormat: 'uint16',
    },
    pipelineResources: {
      shadowPipeline: { label: 'shadow-pipeline' },
      materials: [
        {
          bindGroup: { label: 'mat-0' },
          indexCount: 6,
          indexOffset: 0,
          alphaMode: 'opaque',
          alpha: 1,
        },
        {
          bindGroup: { label: 'mat-1' },
          indexCount: 6,
          indexOffset: 6,
          alphaMode: 'opaque',
          alpha: 1,
        },
      ],
    },
  };

  manager.drawShadowInstance(pass, instance);

  assert.deepEqual(drawCalls.filter(([type]) => type === 'drawIndexed'), [
    ['drawIndexed', 6, 1, 0],
  ]);
});

test('ModelManager.drawShadowInstance draws transparent materials when cast shadow is enabled', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {
    shadowGlobalBindGroup: { label: 'shadow-global' },
  });
  const drawCalls = [];
  const pass = {
    setPipeline(value) {
      drawCalls.push(['pipeline', value]);
    },
    setBindGroup(slot, value) {
      drawCalls.push(['bindGroup', slot, value]);
    },
    setVertexBuffer(slot, value) {
      drawCalls.push(['vertexBuffer', slot, value]);
    },
    setIndexBuffer(buffer, format) {
      drawCalls.push(['indexBuffer', buffer, format]);
    },
    drawIndexed(count, instanceCount, firstIndex) {
      drawCalls.push(['drawIndexed', count, instanceCount, firstIndex]);
    },
  };
  const instance = {
    materialVisibility: [true],
    materialCastShadow: [true],
    morphController: {
      materialStates: [
        {
          diffuse: [1, 1, 1, 0.35],
        },
      ],
      vmBuffer: makeBuffer(),
    },
    meshBuffers: {
      vertexBuffer: makeBuffer(),
      indexBuffer: makeBuffer(),
      indexFormat: 'uint16',
    },
    pipelineResources: {
      shadowPipeline: { label: 'shadow-pipeline' },
      materials: [
        {
          bindGroup: { label: 'mat-0' },
          indexCount: 6,
          indexOffset: 0,
          alphaMode: 'transparent',
          alpha: 0.35,
        },
      ],
    },
  };

  manager.drawShadowInstance(pass, instance);

  assert.deepEqual(drawCalls.filter(([type]) => type === 'drawIndexed'), [
    ['drawIndexed', 6, 1, 0],
  ]);
});

test('ModelManager skips hidden models in visible passes and bounds calculations', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {
    globalBindGroup: { label: 'global' },
    edgeBindGroup: { label: 'edge' },
    shadowGlobalBindGroup: { label: 'shadow-global' },
  });
  const createPass = () => {
    const calls = [];
    return {
      calls,
      setPipeline(value) {
        calls.push(['pipeline', value?.name || value?.label || 'pipeline']);
      },
      setBindGroup(slot, value) {
        calls.push(['bindGroup', slot, value?.label || value?.name || 'bindGroup']);
      },
      setVertexBuffer(slot, value) {
        calls.push(['vertexBuffer', slot, value?.label || value?.name || 'vertexBuffer']);
      },
      setIndexBuffer(buffer, format) {
        calls.push(['indexBuffer', buffer?.label || buffer?.name || 'indexBuffer', format]);
      },
      draw(count) {
        calls.push(['draw', count]);
      },
      drawIndexed(count, instanceCount, firstIndex) {
        calls.push(['drawIndexed', count, instanceCount, firstIndex]);
      },
    };
  };
  const makeInstance = (visible) => ({
    visible,
    aabb: visible ? { min: [0, 0, 0], max: [1, 1, 1] } : { min: [10, 10, 10], max: [11, 11, 11] },
    materialVisibility: [true],
    materialCastShadow: [true],
    scene: {
      uiOverlay: {
        boneLineVertexBuffer: { label: visible ? 'visible-bone-line' : 'hidden-bone-line' },
        boneLineVertexCount: 1,
        boneAxisVertexBuffer: { label: visible ? 'visible-bone-axis' : 'hidden-bone-axis' },
        boneAxisVertexCount: 1,
        indicatorVertexBuffer: { label: visible ? 'visible-indicator' : 'hidden-indicator' },
        indicatorVertexCount: 1,
        gizmoVertexBuffer: { label: visible ? 'visible-gizmo' : 'hidden-gizmo' },
        gizmoVertexCount: 1,
        physicsWireframeVertexBuffer: { label: visible ? 'visible-physics' : 'hidden-physics' },
        physicsWireframeVertexCount: 1,
      },
    },
    meshBuffers: {
      vertexBuffer: { label: visible ? 'visible-vertex' : 'hidden-vertex' },
      indexBuffer: { label: visible ? 'visible-index' : 'hidden-index' },
      indexFormat: 'uint16',
    },
    morphController: {
      materialStates: [
        {
          diffuse: [1, 1, 1, 1],
        },
      ],
      vmBuffer: { label: visible ? 'visible-vm' : 'hidden-vm' },
    },
    model: {
      materials: [
        {
          drawShadow: true,
        },
      ],
    },
    pipelineResources: {
      defaultShaderName: 'shader-a',
      boneBindGroup: { label: visible ? 'visible-bone' : 'hidden-bone' },
      shadowPipeline: { name: visible ? 'visible-shadow' : 'hidden-shadow' },
      depthPickPipeline: { name: visible ? 'visible-depth-pick' : 'hidden-depth-pick' },
      msaa: {
        pipeline: { name: visible ? 'visible-pipeline' : 'hidden-pipeline' },
        opaqueNoCullPipeline: { name: visible ? 'visible-opaque-no-cull' : 'hidden-opaque-no-cull' },
        transparentPipeline: { name: visible ? 'visible-transparent' : 'hidden-transparent' },
        transparentNoCullPipeline: { name: visible ? 'visible-transparent-no-cull' : 'hidden-transparent-no-cull' },
        edgePipeline: { name: visible ? 'visible-edge' : 'hidden-edge' },
      },
      nonMsaa: {
        pipeline: { name: visible ? 'visible-pipeline' : 'hidden-pipeline' },
        opaqueNoCullPipeline: { name: visible ? 'visible-opaque-no-cull' : 'hidden-opaque-no-cull' },
        transparentPipeline: { name: visible ? 'visible-transparent' : 'hidden-transparent' },
        transparentNoCullPipeline: { name: visible ? 'visible-transparent-no-cull' : 'hidden-transparent-no-cull' },
        edgePipeline: { name: visible ? 'visible-edge' : 'hidden-edge' },
      },
      shaderPipelines: {
        'shader-a': {
          msaa: {
            pipeline: { name: visible ? 'visible-shader-pipeline' : 'hidden-shader-pipeline' },
            opaqueNoCullPipeline: { name: visible ? 'visible-shader-opaque-no-cull' : 'hidden-shader-opaque-no-cull' },
            transparentPipeline: { name: visible ? 'visible-shader-transparent' : 'hidden-shader-transparent' },
            transparentNoCullPipeline: { name: visible ? 'visible-shader-transparent-no-cull' : 'hidden-shader-transparent-no-cull' },
            edgePipeline: { name: visible ? 'visible-shader-edge' : 'hidden-shader-edge' },
          },
          nonMsaa: {
            pipeline: { name: visible ? 'visible-shader-pipeline' : 'hidden-shader-pipeline' },
            opaqueNoCullPipeline: { name: visible ? 'visible-shader-opaque-no-cull' : 'hidden-shader-opaque-no-cull' },
            transparentPipeline: { name: visible ? 'visible-shader-transparent' : 'hidden-shader-transparent' },
            transparentNoCullPipeline: { name: visible ? 'visible-shader-transparent-no-cull' : 'hidden-shader-transparent-no-cull' },
            edgePipeline: { name: visible ? 'visible-shader-edge' : 'hidden-shader-edge' },
          },
          depthPrepassMsaa: {
            depthPrepassPipeline: { name: visible ? 'visible-depth-prepass' : 'hidden-depth-prepass' },
            depthPrepassNoCullPipeline: { name: visible ? 'visible-depth-prepass-no-cull' : 'hidden-depth-prepass-no-cull' },
          },
          depthPrepassNonMsaa: {
            depthPrepassPipeline: { name: visible ? 'visible-depth-prepass' : 'hidden-depth-prepass' },
            depthPrepassNoCullPipeline: { name: visible ? 'visible-depth-prepass-no-cull' : 'hidden-depth-prepass-no-cull' },
          },
        },
      },
      materials: [
        {
          bindGroup: { label: visible ? 'visible-material' : 'hidden-material' },
          indexCount: 6,
          indexOffset: 0,
          alphaMode: 'opaque',
          alpha: 1,
          hasEdge: false,
          noCull: false,
          shaderName: 'shader-a',
          sortIndex: 0,
        },
      ],
    },
  });

  manager.instances = [makeInstance(false), makeInstance(true)];

  const drawPass = createPass();
  manager.draw(drawPass, {}, false);
  assert.deepEqual(drawPass.calls.filter(([type]) => type === 'drawIndexed').length, 1);

  const depthPrepassPass = createPass();
  manager.drawDepthPrepass(depthPrepassPass, false);
  assert.deepEqual(depthPrepassPass.calls.filter(([type]) => type === 'drawIndexed').length, 1);

  const depthPickPass = createPass();
  manager.drawDepthPick(depthPickPass);
  assert.deepEqual(depthPickPass.calls.filter(([type]) => type === 'drawIndexed').length, 1);

  const shadowPass = createPass();
  manager.drawShadow(shadowPass);
  assert.deepEqual(shadowPass.calls.filter(([type]) => type === 'drawIndexed').length, 1);

  const uiOverlayPass = createPass();
  manager.uiOverlayPipeline = { name: 'ui-overlay' };
  manager.drawUiOverlay(uiOverlayPass, {
    showBones: true,
    showPhysics: true,
  });
  assert.deepEqual(uiOverlayPass.calls.filter(([type]) => type === 'draw').length, 4);

  assert.deepEqual(manager.getCombinedAabb(), { min: [0, 0, 0], max: [1, 1, 1] });
});

test('ModelManager.drawInstance draws transparent edge after the transparent surface', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {
    globalBindGroup: { label: 'global' },
    edgeBindGroup: { label: 'edge-global' },
  });
  const drawCalls = [];
  const pass = {
    setPipeline(value) {
      drawCalls.push(['pipeline', value.name]);
    },
    setBindGroup(slot, value) {
      drawCalls.push(['bindGroup', slot, value.label]);
    },
    setVertexBuffer(slot, value) {
      drawCalls.push(['vertexBuffer', slot, value]);
    },
    setIndexBuffer(buffer, format) {
      drawCalls.push(['indexBuffer', buffer, format]);
    },
    drawIndexed(count, instanceCount, firstIndex) {
      drawCalls.push(['drawIndexed', count, instanceCount, firstIndex]);
    },
  };
  const opaqueMaterial = {
    bindGroup: { label: 'opaque-bind' },
    indexCount: 3,
    indexOffset: 0,
    alphaMode: 'opaque',
    alpha: 1,
    hasEdge: true,
    noCull: false,
    shaderName: 'shader-a',
    sortIndex: 0,
  };
  const transparentEdgeMaterial = {
    bindGroup: { label: 'transparent-edge-bind' },
    indexCount: 6,
    indexOffset: 3,
    alphaMode: 'transparent',
    alpha: 0.5,
    hasEdge: true,
    noCull: false,
    shaderName: 'shader-a',
    sortIndex: 1,
  };
  const transparentMaterial = {
    bindGroup: { label: 'transparent-bind' },
    indexCount: 6,
    indexOffset: 9,
    alphaMode: 'transparent',
    alpha: 0.4,
    hasEdge: false,
    noCull: false,
    shaderName: 'shader-a',
    sortIndex: 2,
  };
  const pipelineSet = {
    pipeline: { name: 'opaque' },
    opaqueNoCullPipeline: { name: 'opaque-no-cull' },
    transparentPipeline: { name: 'transparent' },
    transparentNoCullPipeline: { name: 'transparent-no-cull' },
    edgePipeline: { name: 'edge' },
  };
  const shaderPipelines = {
    'shader-a': {
      msaa: pipelineSet,
      nonMsaa: pipelineSet,
    },
  };
  const instance = {
    materialVisibility: [true, true, true],
    morphController: {
      materialStates: [
        { diffuse: [1, 1, 1, 1] },
        { diffuse: [1, 1, 1, 0.5] },
        { diffuse: [1, 1, 1, 0.4] },
      ],
      vmBuffer: makeBuffer(),
    },
    meshBuffers: {
      vertexBuffer: 'vertex-buffer',
      indexBuffer: 'index-buffer',
      indexFormat: 'uint16',
    },
    pipelineResources: {
      defaultShaderName: 'shader-a',
      boneBindGroup: { label: 'bone' },
      materials: [opaqueMaterial, transparentEdgeMaterial, transparentMaterial],
      msaa: pipelineSet,
      nonMsaa: pipelineSet,
      shaderPipelines,
    },
  };

  manager.drawInstance(pass, instance, {}, false);

  assert.deepEqual(drawCalls.filter(([type]) => type === 'pipeline'), [
    ['pipeline', 'opaque'],
    ['pipeline', 'edge'],
    ['pipeline', 'transparent'],
    ['pipeline', 'edge'],
    ['pipeline', 'transparent'],
  ]);
  assert.deepEqual(drawCalls.filter(([type]) => type === 'bindGroup').map(([, slot, label]) => [slot, label]), [
    [0, 'global'],
    [2, 'bone'],
    [1, 'opaque-bind'],
    [0, 'edge-global'],
    [2, 'bone'],
    [1, 'opaque-bind'],
    [0, 'global'],
    [2, 'bone'],
    [1, 'transparent-edge-bind'],
    [0, 'edge-global'],
    [2, 'bone'],
    [1, 'transparent-edge-bind'],
    [0, 'global'],
    [2, 'bone'],
    [1, 'transparent-bind'],
  ]);
  assert.deepEqual(drawCalls.filter(([type]) => type === 'drawIndexed'), [
    ['drawIndexed', 3, 1, 0],
    ['drawIndexed', 3, 1, 0],
    ['drawIndexed', 6, 1, 3],
    ['drawIndexed', 6, 1, 3],
    ['drawIndexed', 6, 1, 9],
  ]);
});

test('ModelManager.drawDepthPrepass keeps edge materials in the AO source pass', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {
    globalBindGroup: { label: 'global' },
    edgeBindGroup: { label: 'edge-global' },
  });
  const drawCalls = [];
  const pass = {
    setPipeline(value) {
      drawCalls.push(['pipeline', value.name]);
    },
    setBindGroup(slot, value) {
      drawCalls.push(['bindGroup', slot, value.label]);
    },
    setVertexBuffer(slot, value) {
      drawCalls.push(['vertexBuffer', slot, value]);
    },
    setIndexBuffer(buffer, format) {
      drawCalls.push(['indexBuffer', buffer, format]);
    },
    drawIndexed(count, instanceCount, firstIndex) {
      drawCalls.push(['drawIndexed', count, instanceCount, firstIndex]);
    },
  };
  const opaqueEdgeMaterial = {
    bindGroup: { label: 'opaque-edge-bind' },
    indexCount: 3,
    indexOffset: 0,
    alphaMode: 'opaque',
    alpha: 1,
    hasEdge: true,
    noCull: false,
    shaderName: 'shader-a',
    sortIndex: 0,
  };
  const pipelineSet = {
    pipeline: { name: 'opaque' },
    opaqueNoCullPipeline: { name: 'opaque-no-cull' },
    transparentPipeline: { name: 'transparent' },
    transparentNoCullPipeline: { name: 'transparent-no-cull' },
    edgePipeline: { name: 'edge' },
  };
  const shaderPipelines = {
    'shader-a': {
      msaa: pipelineSet,
      nonMsaa: pipelineSet,
      depthPrepassMsaa: {
        depthPrepassPipeline: { name: 'depth-prepass' },
        depthPrepassNoCullPipeline: { name: 'depth-prepass-no-cull' },
      },
      depthPrepassNonMsaa: {
        depthPrepassPipeline: { name: 'depth-prepass' },
        depthPrepassNoCullPipeline: { name: 'depth-prepass-no-cull' },
      },
    },
  };
  const instance = {
    visible: true,
    materialVisibility: [true],
    morphController: {
      materialStates: [
        { diffuse: [1, 1, 1, 1] },
      ],
      vmBuffer: makeBuffer(),
    },
    meshBuffers: {
      vertexBuffer: 'vertex-buffer',
      indexBuffer: 'index-buffer',
      indexFormat: 'uint16',
    },
    pipelineResources: {
      defaultShaderName: 'shader-a',
      boneBindGroup: { label: 'bone' },
      materials: [opaqueEdgeMaterial],
      msaa: pipelineSet,
      nonMsaa: pipelineSet,
      shaderPipelines,
    },
  };

  manager.instances = [instance];
  manager.drawDepthPrepass(pass, false);

  assert.deepEqual(drawCalls.filter(([type]) => type === 'pipeline'), [
    ['pipeline', 'depth-prepass'],
  ]);
  assert.deepEqual(drawCalls.filter(([type]) => type === 'drawIndexed'), [
    ['drawIndexed', 3, 1, 0],
  ]);
});

test('PhysicsEngine.resetModel clears teleported body state', () => {
  const engine = createPhysicsEngineStub();
  const worldMatrix = mat4.fromTranslation(mat4.create(), [3, 4, 5]);
  const scene = createScene(createLocalTransform());
  scene.boneLocalTransforms[0].worldMatrix = worldMatrix;

  const body = createRigidBodyStub();
  body.boneIndex = 0;
  body.boneOffsetMat = mat4.create();

  const entry = {
    scene,
    bodies: [body],
  };

  PhysicsEngine.prototype.resetModel.call(engine, entry);

  assert.equal(body.centerOfMassTransform.origin.x, 3);
  assert.equal(body.centerOfMassTransform.origin.y, 4);
  assert.equal(body.centerOfMassTransform.origin.z, 5);
  assert.equal(body.motionState.worldTransform.origin.x, 3);
  assert.equal(body.linearVelocity.x, 0);
  assert.equal(body.linearVelocity.y, 0);
  assert.equal(body.linearVelocity.z, 0);
  assert.equal(body.angularVelocity.x, 0);
  assert.equal(body.angularVelocity.y, 0);
  assert.equal(body.angularVelocity.z, 0);
  assert.equal(body.interpolationWorldTransform.origin.x, 3);
  assert.equal(body.clearForcesCount, 1);
  assert.equal(body.activateCount, 1);
  assert.equal(engine.world.updateSingleAabbCalls.length, 1);
});

test('PhysicsEngine.update returns immediately when physics is disabled', () => {
  const engine = {
    enabled: false,
    world: {
      stepSimulationCalls: [],
      stepSimulation(...args) {
        this.stepSimulationCalls.push(args);
      },
    },
    targetSPF: 1 / 60,
    maxSubSteps: 20,
    simulationMultiplier: 4,
    models: [],
    _preSimulation() {
      throw new Error('preSimulation should not run while physics is disabled');
    },
    _processCollisions() {
      throw new Error('collision processing should not run while physics is disabled');
    },
    _postSimulation() {
      throw new Error('postSimulation should not run while physics is disabled');
    },
  };

  PhysicsEngine.prototype.update.call(engine, 1);

  assert.equal(engine.world.stepSimulationCalls.length, 0);
});

test('PhysicsEngine.rebuildModel resolves penetration and syncs the separated pose', () => {
  const engine = createPhysicsEngineStub();
  const dirtyLocals = [];
  const contactPoint = createContactPointStub(-0.2, [1, 0, 0]);
  const body0 = createRigidBodyStub('body-0');
  const body1 = createRigidBodyStub('body-1');
  const manifold = createManifoldStub(body0, body1, [contactPoint]);
  const world = createRebuildWorldStub(manifold, [contactPoint]);
  const localTransform = createLocalTransform();
  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        flags: 0,
        position: [0, 0, 0],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };
  const entry = {
    model,
    scene,
    bodies: [body0],
    joints: [],
    boneToBodiesMap: {},
    boneToPostSimulationBodyMap: {
      0: body0,
    },
  };

  body0.boneIndex = 0;
  body0.rbData = {
    physicsMode: 1,
    mass: 1,
  };
  body0.boneOffsetMat = mat4.create();
  body0.invBoneOffsetMat = mat4.create();
  body0.ammoBody.pointer = 'body-0';
  body1.ammoBody.pointer = 'body-1';

  engine.world = world;
  engine.pointerToBodyMap = new Map([
    ['body-0', body0],
    ['body-1', body1],
  ]);
  engine.modelManager = {
    markBoneLocalTransformDirty(local) {
      dirtyLocals.push(local);
    },
  };

  PhysicsEngine.prototype.rebuildModel.call(engine, entry);

  assert.equal(world.performDiscreteCollisionDetectionCalls, 2);
  assert.ok(Math.abs(body0.centerOfMassTransform.origin.x - 0.201) < 1e-5);
  assert.equal(body0.centerOfMassTransform.origin.y, 0);
  assert.equal(body0.centerOfMassTransform.origin.z, 0);
  assert.equal(body0.linearVelocity.x, 0);
  assert.equal(body0.angularVelocity.x, 0);
  assert.equal(body0.clearForcesCount, 2);
  assert.equal(body0.activateCount, 2);
  assert.equal(engine.world.updateSingleAabbCalls.length, 2);
  assert.equal(localTransform.physicsDriven, true);
  assert.ok(Math.abs(localTransform.translation[0] - 0.0201) < 1e-5);
  assert.ok(Math.abs(localTransform.worldMatrix[12] - 0.0201) < 1e-5);
  assert.deepEqual(dirtyLocals, [localTransform]);
});

test('ModelManager.rebuildPhysics delegates to the physics engine rebuild path', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const calls = [];
  const physicsEngine = {
    rebuild() {
      calls.push('rebuild');
    },
  };

  manager.rebuildPhysics(physicsEngine);
  manager.resetPhysics(physicsEngine);

  assert.deepEqual(calls, ['rebuild', 'rebuild']);
});

test('PhysicsEngine converts rigid body Euler rotations with YXZ order', () => {
  const engine = createPhysicsEngineStub();
  const eulerRadians = [Math.PI / 4, Math.PI / 3, Math.PI / 6];
  const expected = quat.fromEuler(quat.create(), 45, 60, 30, 'yxz');
  const xyzOrder = quat.fromEuler(quat.create(), 45, 60, 30, 'xyz');

  const actual = PhysicsEngine.prototype._setQuatFromMmdEulerRadians.call(engine, quat.create(), eulerRadians);

  assert.ok(quat.equals(actual, expected), 'Rigid body rotations should match YXZ order');
  assert.ok(!quat.equals(actual, xyzOrder), 'Rigid body rotations should not use XYZ order');
});

test('PhysicsEngine.addModel tracks all rigid bodies per bone and picks the last non-kinematic body for writeback', () => {
  const createdBodies = [];
  const resetEntries = [];
  const rigidBodies = [
    { name: 'kinematic', boneIndex: 0, physicsMode: 0, groupId: 0, collisionMask: 1 },
    { name: 'dynamic-a', boneIndex: 0, physicsMode: 1, groupId: 0, collisionMask: 1 },
    { name: 'dynamic-b', boneIndex: 0, physicsMode: 2, groupId: 0, collisionMask: 1 },
    { name: 'unbound', boneIndex: -1, physicsMode: 1, groupId: 0, collisionMask: 1 },
  ];
  const engine = {
    world: {
      addRigidBody() {},
      addConstraint() {},
    },
    Ammo: {
      getPointer(value) {
        return value.pointer;
      },
    },
    pointerToBodyMap: new Map(),
    models: [],
    _createRigidBody(rbData) {
      const body = {
        rbData,
        boneIndex: rbData.boneIndex,
        ammoBody: { pointer: `${rbData.name}-ptr` },
      };
      createdBodies.push(body);
      return body;
    },
    _createJoint() {
      throw new Error('joint creation should not be called in this test');
    },
    resetModel(entry) {
      resetEntries.push(entry);
    },
  };
  const model = {
    rigidBodies,
    joints: [],
  };
  const scene = {};

  PhysicsEngine.prototype.addModel.call(engine, model, scene);

  assert.equal(engine.models.length, 1);
  assert.equal(resetEntries.length, 1);

  const [entry] = engine.models;
  assert.deepEqual(entry.boneToBodiesMap[0], createdBodies.slice(0, 3));
  assert.equal(entry.boneToPostSimulationBodyMap[0], createdBodies[2]);
  assert.equal(entry.boneToBodiesMap[-1], undefined);
  assert.equal(entry.boneToPostSimulationBodyMap[-1], undefined);
  assert.equal(engine.pointerToBodyMap.get('kinematic-ptr'), createdBodies[0]);
  assert.equal(engine.pointerToBodyMap.get('dynamic-b-ptr'), createdBodies[2]);
});

test('PhysicsEngine._postSimulation uses the selected post-simulation body when a bone has multiple rigid bodies', () => {
  const engine = createPhysicsEngineStub();
  const localTransform = createLocalTransform();
  const scene = createScene(localTransform);
  const model = {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
      },
    ],
  };
  const kinematicBody = createPostSimulationRigidBodyStub(0, [10, 20, 30], 0);
  const dynamicBody = createPostSimulationRigidBodyStub(0, [1, 2, 3], 1);
  const dirtyLocals = [];
  engine.modelManager = {
    markBoneLocalTransformDirty(local) {
      dirtyLocals.push(local);
    },
  };

  PhysicsEngine.prototype._postSimulation.call(engine, {
    model,
    scene,
    bodies: [kinematicBody, dynamicBody],
    boneToPostSimulationBodyMap: {
      0: dynamicBody,
    },
  });

  assert.ok(Math.abs(localTransform.translation[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(localTransform.translation[1] - 0.2) < 1e-6);
  assert.ok(Math.abs(localTransform.translation[2] - 0.3) < 1e-6);
  assert.equal(localTransform.physicsDriven, true);
  assert.ok(Math.abs(localTransform.worldMatrix[12] - 0.1) < 1e-6);
  assert.ok(Math.abs(localTransform.worldMatrix[13] - 0.2) < 1e-6);
  assert.ok(Math.abs(localTransform.worldMatrix[14] - 0.3) < 1e-6);
  assert.ok(Math.abs(scene.boneWorldPositions[0][0] - 0.1) < 1e-6);
  assert.ok(Math.abs(scene.boneWorldPositions[0][1] - 0.2) < 1e-6);
  assert.ok(Math.abs(scene.boneWorldPositions[0][2] - 0.3) < 1e-6);
  assert.deepEqual(dirtyLocals, [localTransform]);
});

test('PhysicsEngine._finalizeBoneWorldTransform rotates child position when the target parent rotates', () => {
  const engine = createPhysicsEngineStub();
  const localTransform = createLocalTransform();
  const scene = createScene(localTransform);
  const targetLocalTransform = createLocalTransform();
  const targetScene = createScene(targetLocalTransform);
  const targetRotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2);

  mat4.fromRotationTranslationScale(
    localTransform.worldMatrix,
    quat.create(),
    vec3.fromValues(5, 0, 0),
    localTransform.scale,
  );
  scene.modelManager = {
    instances: [
      { scene },
      { scene: targetScene },
    ],
  };

  localTransform.childEnabled = true;
  localTransform.childSourceInstanceIndex = 1;
  localTransform.childSourceBoneIndex = 0;
  localTransform.childInfluence = 1;
  localTransform.childInverseEnabled = true;
  vec3.set(localTransform.childInversePosition, 10, 0, 0);
  quat.identity(localTransform.childInverseRotation);

  quat.copy(targetLocalTransform.worldRotation, targetRotation);
  targetScene.boneWorldPositions[0] = [0, 10, 0];

  PhysicsEngine.prototype._finalizeBoneWorldTransform.call(engine, scene, 0, localTransform);

  assert.ok(Math.abs(scene.boneWorldPositions[0][0]) < 1e-6);
  assert.ok(Math.abs(scene.boneWorldPositions[0][1] - 5) < 1e-6);
  assert.ok(Math.abs(scene.boneWorldPositions[0][2]) < 1e-6);
});

function createDevice(writeBufferHandler = null) {
  return {
    createBindGroupLayout() {
      return {};
    },
    createBuffer(descriptor) {
      return makeBuffer(descriptor?.size ?? 0);
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        if (writeBufferHandler) {
          writeBufferHandler(buffer, offset, data);
        }
      },
    },
  };
}

function makeBuffer(size = 4096) {
  return {
    size,
    destroy() {},
  };
}

function createLocalTransform() {
  return {
    translation: vec3.fromValues(0, 0, 0),
    rotation: quat.create(),
    manualTranslation: vec3.fromValues(0, 0, 0),
    manualRotation: quat.create(),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix: mat4.create(),
    skinMatrix: mat4.create(),
    worldRotation: quat.create(),
    baseTranslation: vec3.fromValues(0, 0, 0),
    localDirty: true,
    worldDirty: true,
    physicsMode: -1,
    physicsDriven: false,
    childEnabled: false,
    childSourceInstanceIndex: -1,
    childSourceBoneIndex: -1,
    childInfluence: 1,
    childInverseEnabled: true,
    childInversePosition: vec3.fromValues(0, 0, 0),
    childInverseRotation: quat.fromValues(0, 0, 0, 1),
  };
}

function createScene(localTransform) {
  return {
    boneCount: 1,
    physicsRootBoneIndex: 0,
    physicsPoseBoneIndices: [],
    uiOverlay: {
      boneLineVertexBuffer: makeBuffer(),
      boneLineVertexCount: 0,
      boneAxisVertexBuffer: makeBuffer(),
      boneAxisVertexCount: 0,
      physicsWireframeVertexBuffer: makeBuffer(),
      physicsWireframeVertexCount: 0,
      indicatorVertexBuffer: makeBuffer(),
      indicatorVertexCount: 0,
      gizmoVertexBuffer: makeBuffer(),
      gizmoVertexCount: 0,
    },
    boneLocalTransforms: [localTransform],
    boneMatricesBuffer: makeBuffer(),
    boneWorldPositions: [[0, 0, 0]],
    sortedBoneIndices: [0],
    ikChains: [],
    ikTargets: [],
    inverseBindMatrices: [mat4.create()],
    previousBoneWorldMatrices: [mat4.create()],
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
}

function createPhysicsEngineStub() {
  return {
    _setBTTransformFromMat4: PhysicsEngine.prototype._setBTTransformFromMat4,
    _readRootWorldPosition: PhysicsEngine.prototype._readRootWorldPosition,
    _updateEntryRootWorldPosition: PhysicsEngine.prototype._updateEntryRootWorldPosition,
    _updateScenePreviousBoneWorldMatrices: PhysicsEngine.prototype._updateScenePreviousBoneWorldMatrices,
    _resolveChangedAncestorBoneIndex: PhysicsEngine.prototype._resolveChangedAncestorBoneIndex,
    _finalizeBoneWorldTransform: PhysicsEngine.prototype._finalizeBoneWorldTransform,
    _writeBodyTransform: PhysicsEngine.prototype._writeBodyTransform,
    _readBodyTransform: PhysicsEngine.prototype._readBodyTransform,
    _resolveEntryPenetrations: PhysicsEngine.prototype._resolveEntryPenetrations,
    _addPenetrationCorrection: PhysicsEngine.prototype._addPenetrationCorrection,
    _applyPenetrationCorrection: PhysicsEngine.prototype._applyPenetrationCorrection,
    _getBodyInverseMass: PhysicsEngine.prototype._getBodyInverseMass,
    _readContactNormal: PhysicsEngine.prototype._readContactNormal,
    _postSimulation: PhysicsEngine.prototype._postSimulation,
    resetModel: PhysicsEngine.prototype.resetModel,
    Ammo: {
      getPointer(value) {
        return value.pointer;
      },
    },
    world: {
      updateSingleAabbCalls: [],
      updateSingleAabb(body) {
        this.updateSingleAabbCalls.push(body);
      },
    },
    _tempMatA: mat4.create(),
    _tempMatB: mat4.create(),
    _tempMatC: mat4.create(),
    _tempVec3: vec3.create(),
    _tempQuat: quat.create(),
    _tempBTTr: createTransform(),
    _tempBTTr2: createTransform(),
    _tempBTVec: createBtVector3(),
    _tempBTVec2: createBtVector3(),
    _tempBTQuat: createBtQuaternion(),
  };
}

function createRigidBodyStub(pointer = 'body') {
  const body = {
    boneIndex: -1,
    boneOffsetMat: mat4.create(),
    centerOfMassTransform: null,
    interpolationWorldTransform: null,
    linearVelocity: null,
    angularVelocity: null,
    clearForcesCount: 0,
    activateCount: 0,
    motionState: {
      worldTransform: null,
      interpolationWorldTransform: null,
      getWorldTransform(transform) {
        if (this.worldTransform) {
          transform.setOrigin(createBtVector3(this.worldTransform.origin));
          transform.setRotation(createBtQuaternion(this.worldTransform.rotation));
        }
      },
      setWorldTransform(transform) {
        this.worldTransform = cloneTransform(transform);
      },
      setInterpolationWorldTransform(transform) {
        this.interpolationWorldTransform = cloneTransform(transform);
      },
    },
    setCenterOfMassTransform(transform) {
      this.centerOfMassTransform = cloneTransform(transform);
    },
    getMotionState() {
      return this.motionState;
    },
    setInterpolationWorldTransform(transform) {
      this.interpolationWorldTransform = cloneTransform(transform);
    },
    setLinearVelocity(value) {
      this.linearVelocity = cloneBtVector3(value);
    },
    setAngularVelocity(value) {
      this.angularVelocity = cloneBtVector3(value);
    },
    setInterpolationLinearVelocity() {},
    setInterpolationAngularVelocity() {},
    clearForces() {
      this.clearForcesCount += 1;
    },
    activate() {
      this.activateCount += 1;
    },
    pointer,
  };
  body.ammoBody = body;
  return body;
}

function createContactPointStub(distance, normal) {
  const normalVector = createBtVector3();
  normalVector.setValue(normal[0], normal[1], normal[2]);
  return {
    distance,
    getDistance() {
      return this.distance;
    },
    setDistance(nextDistance) {
      this.distance = nextDistance;
    },
    get_m_normalWorldOnB() {
      return normalVector;
    },
  };
}

function createManifoldStub(body0, body1, contactPoints) {
  return {
    getBody0() {
      return body0.ammoBody;
    },
    getBody1() {
      return body1.ammoBody;
    },
    getNumContacts() {
      return contactPoints.length;
    },
    getContactPoint(index) {
      return contactPoints[index];
    },
  };
}

function createRebuildWorldStub(manifold, contactPoints = []) {
  let detectionCount = 0;
  return {
    performDiscreteCollisionDetectionCalls: 0,
    updateSingleAabbCalls: [],
    performDiscreteCollisionDetection() {
      this.performDiscreteCollisionDetectionCalls += 1;
      detectionCount += 1;
      if (detectionCount > 1) {
        for (const contactPoint of contactPoints) {
          contactPoint.setDistance?.(0);
        }
      }
    },
    getDispatcher() {
      return {
        getNumManifolds() {
          return 1;
        },
        getManifoldByIndexInternal() {
          return manifold;
        },
      };
    },
    updateSingleAabb(body) {
      this.updateSingleAabbCalls.push(body);
    },
  };
}

function createPostSimulationRigidBodyStub(boneIndex, translation, physicsMode) {
  const origin = createBtVector3();
  origin.setValue(translation[0], translation[1], translation[2]);
  const rotation = createBtQuaternion();
  rotation.setValue(0, 0, 0, 1);

  return {
    boneIndex,
    rbData: {
      physicsMode,
    },
    invBoneOffsetMat: mat4.create(),
    ammoBody: {
      getMotionState() {
        return {
          getWorldTransform(transform) {
            transform.setOrigin(origin);
            transform.setRotation(rotation);
          },
        };
      },
    },
  };
}

function createTransform() {
  return {
    origin: createBtVector3(),
    rotation: createBtQuaternion(),
    getOrigin() {
      return this.origin;
    },
    getRotation() {
      return this.rotation;
    },
    setOrigin(value) {
      this.origin = value;
    },
    setRotation(value) {
      this.rotation = value;
    },
  };
}

function createBtVector3(value = null) {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value;
  return {
    _x: Number.isFinite(source?.x) ? source.x : 0,
    _y: Number.isFinite(source?.y) ? source.y : 0,
    _z: Number.isFinite(source?.z) ? source.z : 0,
    x() {
      return this._x;
    },
    y() {
      return this._y;
    },
    z() {
      return this._z;
    },
    setValue(x, y, z) {
      this._x = x;
      this._y = y;
      this._z = z;
    },
  };
}

function createBtQuaternion(value = null) {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2], w: value[3] }
    : value;
  return {
    _x: Number.isFinite(source?.x) ? source.x : 0,
    _y: Number.isFinite(source?.y) ? source.y : 0,
    _z: Number.isFinite(source?.z) ? source.z : 0,
    _w: Number.isFinite(source?.w) ? source.w : 1,
    x() {
      return this._x;
    },
    y() {
      return this._y;
    },
    z() {
      return this._z;
    },
    w() {
      return this._w;
    },
    setValue(x, y, z, w) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
    },
  };
}

function cloneTransform(transform) {
  return {
    origin: cloneBtVector3(transform.origin),
    rotation: cloneBtQuaternion(transform.rotation),
  };
}

function cloneBtVector3(value) {
  return {
    x: typeof value.x === 'function' ? value.x() : value.x,
    y: typeof value.y === 'function' ? value.y() : value.y,
    z: typeof value.z === 'function' ? value.z() : value.z,
  };
}

function cloneBtQuaternion(value) {
  return {
    x: typeof value.x === 'function' ? value.x() : value.x,
    y: typeof value.y === 'function' ? value.y() : value.y,
    z: typeof value.z === 'function' ? value.z() : value.z,
    w: typeof value.w === 'function' ? value.w() : value.w,
  };
}
