import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeModelInstance } from '../source/core/model/runtime-model.js';
import {
  assignAnimationSourceToRuntimeInstance,
  createVmdAnimationSource,
  deriveAnimationSourceFromRuntimeInstance,
  rebindAnimationSourceToRuntimeInstance,
  splitVmdDocumentIntoAnimationSources,
  syncVrmaIkState,
} from '../source/application/animation/runtime-animation.js';
import { createMockDevice } from './runtime-test-helpers.mjs';

test('assignAnimationSourceToRuntimeInstance applies VMD state through the shared runtime path', () => {
  const setVmdCalls = [];
  const setClipCalls = [];
  const model = {
    magic: 'Pmx',
    name: 'TestModel',
    bones: [],
    materials: [],
    morphs: [],
    ik: [],
    vertices: [],
  };
  const device = createMockDevice();
  const instance = createRuntimeModelInstance({
    model,
    device,
    animationController: {
      setVmd(value) {
        setVmdCalls.push(value);
      },
      setAnimationClip(value) {
        setClipCalls.push(value);
      },
      setBoneMappings() {},
    },
    morphController: {
      setWeight() {},
      vmBuffer: {
        destroy() {},
      },
    },
  });

  const vmd = {
    modelName: 'TestModel',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [],
  };
  const source = createVmdAnimationSource('test.vmd', vmd);
  const assigned = assignAnimationSourceToRuntimeInstance(instance, source);

  assert.equal(assigned.kind, 'vmd');
  assert.equal(instance.animationSourceType, 'vmd');
  assert.equal(instance.vmdName, 'test.vmd');
  assert.equal(instance.vmd, vmd);
  assert.equal(setVmdCalls.length, 1);
  assert.equal(setVmdCalls[0], vmd);
  assert.deepEqual(setClipCalls, []);
});

test('rebindAnimationSourceToRuntimeInstance rebuilds a VMD source from instance state', () => {
  const setVmdCalls = [];
  const model = {
    magic: 'Pmx',
    name: 'TestModel',
    bones: [],
    materials: [],
    morphs: [],
    ik: [],
    vertices: [],
  };
  const device = createMockDevice();
  const instance = createRuntimeModelInstance({
    model,
    device,
    animationController: {
      setVmd(value) {
        setVmdCalls.push(value);
      },
      setAnimationClip() {},
      setBoneMappings() {},
    },
    morphController: {
      setWeight() {},
      vmBuffer: {
        destroy() {},
      },
    },
  });

  instance.vmdName = 'rebuilt.vmd';
  instance.vmd = {
    modelName: 'TestModel',
    boneKeyframes: [],
    faceKeyframes: [],
    cameraKeyframes: [],
    lightKeyframes: [],
  };

  const source = deriveAnimationSourceFromRuntimeInstance(instance);
  assert.equal(source.kind, 'vmd');
  assert.equal(source.name, 'rebuilt.vmd');

  rebindAnimationSourceToRuntimeInstance(instance);
  assert.equal(instance.animationSourceType, 'vmd');
  assert.equal(setVmdCalls.length, 1);
});

test('syncVrmaIkState preserves IK when the VRMA source opts into editable IK', () => {
  const model = {
    magic: 'Vrm',
    name: 'TestModel',
    bones: [],
    materials: [],
    morphs: [],
    ik: [
      { enabled: true },
      { enabled: false },
    ],
    vertices: [],
  };
  const device = createMockDevice();
  const instance = createRuntimeModelInstance({
    model,
    device,
    animationController: {
      setVmd() {},
      setAnimationClip() {},
      setBoneMappings() {},
    },
    morphController: {
      setWeight() {},
      vmBuffer: {
        destroy() {},
      },
    },
  });

  syncVrmaIkState(instance, {
    kind: 'vrma',
    preserveIkEnabled: true,
  });

  assert.deepEqual(instance.model.ik.map((ik) => ik.enabled), [true, false]);
  assert.equal(instance._vrmaStoredIkEnabledStates, null);
});

test('syncVrmaIkState disables IK for regular VRMA sources', () => {
  const model = {
    magic: 'Vrm',
    name: 'TestModel',
    bones: [],
    materials: [],
    morphs: [],
    ik: [
      { enabled: true },
      { enabled: false },
    ],
    vertices: [],
  };
  const device = createMockDevice();
  const instance = createRuntimeModelInstance({
    model,
    device,
    animationController: {
      setVmd() {},
      setAnimationClip() {},
      setBoneMappings() {},
    },
    morphController: {
      setWeight() {},
      vmBuffer: {
        destroy() {},
      },
    },
  });

  syncVrmaIkState(instance, {
    kind: 'vrma',
  });

  assert.deepEqual(instance.model.ik.map((ik) => ik.enabled), [false, false]);
  assert.deepEqual(instance._vrmaStoredIkEnabledStates, [true, false]);
});

test('splitVmdDocumentIntoAnimationSources separates model and scene keyframes', () => {
  const sources = splitVmdDocumentIntoAnimationSources('Mixed.vmd', {
    modelName: 'TestModel',
    signature: 'Vocaloid Motion Data 0002',
    boneKeyframes: [
      { boneName: 'Arm', frameNum: 3, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ],
    faceKeyframes: [
      { name: 'Smile', frameNum: 6, weight: 0.5 },
    ],
    cameraKeyframes: [
      { frameNum: 9, distance: 40, target: [0, 10, 0], rotation: [0, 0, 0], fov: 45, perspective: 1 },
    ],
    lightKeyframes: [
      { frameNum: 12, color: [1, 1, 1], direction: [0, -1, 0] },
    ],
    selfShadowKeyframes: [
      { frameNum: 15, mode: 1, distance: 12 },
    ],
  });

  assert.deepEqual(
    sources.map((source) => source.targetType),
    ['model', 'camera', 'light', 'shadow'],
  );
  assert.equal(sources[0].data.boneKeyframes.length, 1);
  assert.equal(sources[0].data.cameraKeyframes.length, 0);
  assert.equal(sources[1].data.cameraKeyframes.length, 1);
  assert.equal(sources[2].data.lightKeyframes.length, 1);
  assert.equal(sources[3].data.selfShadowKeyframes.length, 1);
});
