import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAnimationMappingToController,
  collectAnimationSourceBoneNames,
  createResolvedAnimationBoneMappings,
  ensureAnimationMappingState,
  getAnimationSourceKey,
  setupAnimationMappingTab,
} from '../source/core/animation/animation-mapper.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';

/**
 * クォータニオンが期待値と一致することを符号違い込みで確認します。
 * @param {ArrayLike<number>} actual - 実値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuaternionClose(actual, expected, epsilon = 1e-6) {
  const directDiff = Math.max(
    Math.abs(actual[0] - expected[0]),
    Math.abs(actual[1] - expected[1]),
    Math.abs(actual[2] - expected[2]),
    Math.abs(actual[3] - expected[3]),
  );
  const flippedDiff = Math.max(
    Math.abs(actual[0] + expected[0]),
    Math.abs(actual[1] + expected[1]),
    Math.abs(actual[2] + expected[2]),
    Math.abs(actual[3] + expected[3]),
  );
  assert.ok(
    Math.min(directDiff, flippedDiff) <= epsilon,
    `expected quaternion ${Array.from(actual)} to be close to ${Array.from(expected)}`,
  );
}

function createFakeElement() {
  const element = {
    addEventListener() {},
    appendChild(child) {
      if (child && typeof child === 'object') {
        child.parentNode = element;
        element.children.push(child);
      }
      return child;
    },
    children: [],
    className: '',
    disabled: false,
    innerHTML: '',
    insertBefore(child, beforeChild) {
      if (!child || typeof child !== 'object') {
        return child;
      }
      const index = element.children.indexOf(beforeChild);
      child.parentNode = element;
      if (index < 0) {
        element.children.push(child);
      } else {
        element.children.splice(index, 0, child);
      }
      return child;
    },
    querySelector(selector) {
      if (selector !== '.animation-mapping-bulk-controls') {
        return null;
      }
      return element.children.find((child) => String(child?.className || '') === 'animation-mapping-bulk-controls') || null;
    },
    setAttribute() {},
    style: {},
    textContent: '',
    value: '',
  };
  return element;
}

function installFakeAnimationMappingDom() {
  const container = createFakeElement();
  const grid = createFakeElement();
  grid.parentNode = container;
  const elements = new Map([
    ['tab-animation-mapping', container],
    ['animation-mapping-status', createFakeElement()],
    ['animation-mapping-grid', grid],
  ]);

  const previousDocument = globalThis.document;
  const document = {
    createElement: () => createFakeElement(),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createFakeElement());
      }
      return elements.get(id);
    },
  };

  globalThis.document = document;
  return () => {
    globalThis.document = previousDocument;
  };
}

test('collectAnimationSourceBoneNames keeps first-seen bone channel order', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: 'Hip', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: 'Hip', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: 'Arm', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );

  assert.deepEqual(collectAnimationSourceBoneNames(clip), ['Hip', 'Arm']);
});

test('setupAnimationMappingTab handles missing active instance without throwing', () => {
  const restoreDocument = installFakeAnimationMappingDom();
  try {
    assert.doesNotThrow(() => {
      setupAnimationMappingTab({
        getModelManager: () => ({ instances: [] }),
        getSelection: () => ({ activeInstanceIndex: 0 }),
      });
    });
  } finally {
    restoreDocument();
  }
});

test('ensureAnimationMappingState seeds default entries for source bones', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  clip.channels.push({
    target: { kind: 'bone', name: 'Hip', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    animationSource: {
      kind: 'gltf',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  assert.equal(state.sourceKey, 'gltf:Walk');
  assert.equal(state.entries.has('Hip'), true);
  assert.deepEqual(state.entries.get('Hip'), {
    sourceBoneName: 'Hip',
    targetBoneName: '',
    rotationOffsetEuler: [0, 0, 0],
    rotationFlipAxes: { x: false, y: false, z: false },
    translationOffset: [0, 0, 0],
    scaleOffset: [1, 1, 1],
  });
});

test('ensureAnimationMappingState seeds VMD defaults for VRM humanoid target bones', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '全ての親', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: 'センター', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右目', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右親指０', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右人差指１', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右足ＩＫ', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親' },
        { name: 'Hips' },
        { name: 'Head' },
        { name: 'RightEye' },
        { name: 'RightThumb0' },
        { name: 'RightIndex1' },
        { name: '右足ＩＫ' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
          head: 'Head',
          rightEye: 'RightEye',
          rightThumbMetacarpal: 'RightThumb0',
          rightIndexProximal: 'RightIndex1',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  assert.equal(state.entries.get('全ての親').targetBoneName, '全ての親');
  assert.deepEqual(state.entries.get('全ての親').rotationOffsetEuler, [0, 0, 0]);
  assert.deepEqual(state.entries.get('全ての親').rotationFlipAxes, { x: false, y: false, z: false });
  assert.equal(state.entries.get('センター').targetBoneName, 'hips');
  assert.equal(state.entries.get('右目').targetBoneName, 'rightEye');
  assert.equal(state.entries.get('右親指０').targetBoneName, 'rightThumbMetacarpal');
  assert.equal(state.entries.get('右人差指１').targetBoneName, 'rightIndexProximal');
  assert.equal(state.entries.get('右足ＩＫ').targetBoneName, '右足ＩＫ');
});

test('ensureAnimationMappingState normalizes VMD 人指 aliases for VRM humanoid finger targets', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '右人指１', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右人指２', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右人指３', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左人指１', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左人指２', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左人指３', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右親指先', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左親指先', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'RightIndex1' },
        { name: 'RightIndex2' },
        { name: 'RightIndex3' },
        { name: 'RightThumb3' },
        { name: 'LeftIndex1' },
        { name: 'LeftIndex2' },
        { name: 'LeftIndex3' },
        { name: 'LeftThumb3' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          rightIndexProximal: 'RightIndex1',
          rightIndexIntermediate: 'RightIndex2',
          rightIndexDistal: 'RightIndex3',
          rightThumbDistal: 'RightThumb3',
          leftIndexProximal: 'LeftIndex1',
          leftIndexIntermediate: 'LeftIndex2',
          leftIndexDistal: 'LeftIndex3',
          leftThumbDistal: 'LeftThumb3',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  assert.equal(state.entries.get('右人指１').targetBoneName, 'rightIndexProximal');
  assert.equal(state.entries.get('右人指２').targetBoneName, 'rightIndexIntermediate');
  assert.equal(state.entries.get('右人指３').targetBoneName, 'rightIndexDistal');
  assert.equal(state.entries.get('左人指１').targetBoneName, 'leftIndexProximal');
  assert.equal(state.entries.get('左人指２').targetBoneName, 'leftIndexIntermediate');
  assert.equal(state.entries.get('左人指３').targetBoneName, 'leftIndexDistal');
  assert.equal(state.entries.get('右親指先').targetBoneName, 'rightThumbDistal');
  assert.equal(state.entries.get('左親指先').targetBoneName, 'leftThumbDistal');
});

test('ensureAnimationMappingState keeps canonical thumb tracks when thumb tip aliases collide with them', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '右親指２', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右親指先', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左親指２', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '左親指先', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'RightThumb3' },
        { name: 'LeftThumb3' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          rightThumbDistal: 'RightThumb3',
          leftThumbDistal: 'LeftThumb3',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  assert.equal(state.entries.has('右親指２'), true);
  assert.equal(state.entries.has('左親指２'), true);
  assert.equal(state.entries.has('右親指先'), false);
  assert.equal(state.entries.has('左親指先'), false);
});

test('ensureAnimationMappingState seeds VRMA defaults for PMX models with no flip on', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '全ての親', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: 'センター', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Pmx',
      bones: [
        { name: '全ての親' },
        { name: 'センター' },
      ],
    },
    animationSource: {
      kind: 'vrma',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  assert.equal(state.entries.get('全ての親').targetBoneName, '');
  assert.deepEqual(state.entries.get('全ての親').rotationOffsetEuler, [0, 0, 0]);
  assert.deepEqual(state.entries.get('全ての親').rotationFlipAxes, { x: false, y: false, z: false });
  assert.equal(state.entries.get('センター').targetBoneName, '');
});

test('createResolvedAnimationBoneMappings resolves offsets and target indices', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  clip.channels.push({
    target: { kind: 'bone', name: 'Hip', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      bones: [
        { name: 'Center' },
        { name: 'HipTarget' },
      ],
    },
    animationSource: {
      kind: 'gltf',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  state.entries.get('Hip').targetBoneName = 'HipTarget';
  state.entries.get('Hip').rotationOffsetEuler = [90, 0, 0];
  state.entries.get('Hip').rotationFlipAxes = { x: true, y: false, z: true };
  state.entries.get('Hip').translationOffset = [1, 2, 3];
  state.entries.get('Hip').scaleOffset = [2, 3, 4];

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].targetBoneIndex, 1);
  assert.deepEqual(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assert.deepEqual(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  assert.deepEqual(mappings[0].rotationFlipAxes, { x: true, y: false, z: true });
  assert.deepEqual(mappings[0].translationOffset, [1, 2, 3]);
  assert.deepEqual(mappings[0].scaleOffset, [2, 3, 4]);
  assert.ok(Math.abs(mappings[0].rotationOffsetQuaternion[0] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(mappings[0].rotationOffsetQuaternion[3] - Math.SQRT1_2) < 1e-6);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD spine bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push({
    target: { kind: 'bone', name: '上半身', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'Chest', localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          chest: 'Chest',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);
  state.entries.get('上半身').rotationOffsetEuler = [90, 0, 0];
  state.entries.get('上半身').rotationFlipAxes = { x: true, y: true, z: true };

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].rotationOffsetQuaternion, [0, 0, 0, 1]);
  assert.deepEqual(mappings[0].rotationFlipAxes, { x: true, y: true, z: true });
  assertQuaternionClose(mappings[0].targetApplyCorrectionQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD center bones on VRM hips', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push({
    target: { kind: 'bone', name: 'センター', path: 'translation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'Hips', localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD lower arm bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push({
    target: { kind: 'bone', name: '左ひじ', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'LeftLowerArm', localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftLowerArm: 'LeftLowerArm',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD upper arm bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '左腕', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右腕', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'LeftUpperArm', localX: [-1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, -1] },
        { name: 'RightUpperArm', localX: [1, 0, 0], localY: [0, -1, 0], localZ: [0, 0, -1] },
      ],
      vrm: {
        version: 'vrm0',
        humanoidBoneNameMap: {
          leftUpperArm: 'LeftUpperArm',
          rightUpperArm: 'RightUpperArm',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const leftMapping = mappings.find((mapping) => mapping.sourceBoneName === '左腕');
  const rightMapping = mappings.find((mapping) => mapping.sourceBoneName === '右腕');

  assert.ok(leftMapping);
  assert.ok(rightMapping);
  assertQuaternionClose(leftMapping.basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(rightMapping.basisCorrectionQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD shoulder and hand bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '左肩', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右手首', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'LeftShoulder', localX: [-1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, -1] },
        { name: 'RightHand', localX: [1, 0, 0], localY: [0, -1, 0], localZ: [0, 0, -1] },
      ],
      vrm: {
        version: 'vrm0',
        humanoidBoneNameMap: {
          leftShoulder: 'LeftShoulder',
          rightHand: 'RightHand',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const leftShoulder = mappings.find((mapping) => mapping.sourceBoneName === '左肩');
  const rightHand = mappings.find((mapping) => mapping.sourceBoneName === '右手首');

  assert.ok(leftShoulder);
  assert.ok(rightHand);
  assertQuaternionClose(leftShoulder.basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(rightHand.basisCorrectionQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD finger bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push({
    target: { kind: 'bone', name: '右人差指１', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'RightIndex1', localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          rightIndexProximal: 'RightIndex1',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD IK bones on VRM', () => {
  const sourceBoneNames = ['右足ＩＫ', '左足ＩＫ', '右つま足ＩＫ', '左つま足ＩＫ'];

  for (const sourceBoneName of sourceBoneNames) {
    const clip = createEmptyAnimationClip({ name: 'Dance' });
    clip.channels.push({
      target: { kind: 'bone', name: sourceBoneName, path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    });
    const instance = {
      model: {
        magic: 'Vrm',
        bones: [
          { name: sourceBoneName, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1] },
        ],
      },
      animationSource: {
        kind: 'vmd',
        name: 'Dance',
        clip,
      },
      animationMappingBySourceKey: new Map(),
    };

    const mappings = createResolvedAnimationBoneMappings(instance);
    assert.equal(mappings.length, 1, `expected a resolved mapping for ${sourceBoneName}`);
    assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
    assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  }
});

test('setupAnimationMappingTab keeps bulk rotation buttons visible and enabled for VMD on VRM', () => {
  const restoreDocument = installFakeAnimationMappingDom();
  try {
    const clip = createEmptyAnimationClip({ name: 'Dance' });
    clip.channels.push({
      target: { kind: 'bone', name: 'センター', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    });
    const instance = {
      model: {
        magic: 'Vrm',
        bones: [
          { name: 'Hips' },
        ],
        vrm: {
          humanoidBoneNameMap: {
            hips: 'Hips',
          },
        },
      },
      animationSource: {
        kind: 'vmd',
        name: 'Dance',
        clip,
      },
      animationMappingBySourceKey: new Map(),
      animationController: {
        setBoneMappings() {},
      },
    };

    setupAnimationMappingTab({
      getModelManager: () => ({ instances: [instance] }),
      getSelection: () => ({ activeInstanceIndex: 0 }),
      refreshScene: () => {},
    });

    const container = globalThis.document.getElementById('tab-animation-mapping');
    const bulkControls = container.children.find((child) => child.className === 'animation-mapping-bulk-controls') || null;
    assert.ok(bulkControls);
    assert.equal(bulkControls.children.length >= 4, true);
    const bulkButtons = bulkControls.children.filter((child) => child.className === 'animation-mapping-bulk-button');
    assert.equal(bulkButtons.length, 3);
    assert.equal(bulkButtons.every((button) => button.disabled === false), true);
  } finally {
    restoreDocument();
  }
});

test('createResolvedAnimationBoneMappings disables rotation mapping for VMD toe bones on VRM', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push({
    target: { kind: 'bone', name: '左つま先', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: 'LeftToes', localX: [1, 0, 0], localY: [0, -1, 0], localZ: [0, 0, -1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftToes: 'LeftToes',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings resolves VMD defaults through VRM humanoid names', () => {
  const clip = createEmptyAnimationClip({ name: 'Dance' });
  clip.channels.push(
    {
      target: { kind: 'bone', name: '全ての親', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: 'センター', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右目', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右親指０', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右人差指１', path: 'rotation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
    {
      target: { kind: 'bone', name: '右足ＩＫ', path: 'translation' },
      sampler: { interpolation: 'LINEAR', keyframes: [] },
    },
  );
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親' },
        { name: 'Hips' },
        { name: 'Head' },
        { name: 'RightEye' },
        { name: 'RightThumb0' },
        { name: 'RightIndex1' },
        { name: '右足ＩＫ' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
          head: 'Head',
          rightEye: 'RightEye',
          rightThumbMetacarpal: 'RightThumb0',
          rightIndexProximal: 'RightIndex1',
        },
      },
    },
    animationSource: {
      kind: 'vmd',
      name: 'Dance',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const mappingBySourceName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));

  assert.equal(mappings.length, 6);
  assert.equal(mappingBySourceName.get('全ての親').targetBoneIndex, 0);
  assert.equal(mappingBySourceName.get('センター').targetBoneIndex, 1);
  assert.equal(mappingBySourceName.get('右目').targetBoneIndex, 3);
  assert.equal(mappingBySourceName.get('右親指０').targetBoneIndex, 4);
  assert.equal(mappingBySourceName.get('右人差指１').targetBoneIndex, 5);
  assert.equal(mappingBySourceName.get('右足ＩＫ').targetBoneIndex, 6);
  assert.deepEqual(mappingBySourceName.get('全ての親').rotationOffsetQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings keeps current VRMA upperArm basis correction and excludes synthetic VRM root rotation from target rest space', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          leftUpperArm: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'leftUpperArm', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'ShoulderRoot', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'LeftUpperArm', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftUpperArm: 'LeftUpperArm',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);

  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].sourceKind, 'vrma');
  assertQuaternionClose(mappings[0].basisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].basisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].sourceLocalRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].sourceWorldRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].targetLocalRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].targetWorldRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings keeps current VRMA upperLeg basis correction', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          rightUpperLeg: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'rightUpperLeg', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'Hips', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'RightUpperLeg', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          rightUpperLeg: 'RightUpperLeg',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);

  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].targetWorldRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings keeps VRMA lowerArm basis correction as identity', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          rightLowerArm: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'rightLowerArm', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'RightUpperArm', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'RightLowerArm', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          rightUpperArm: 'RightUpperArm',
          rightLowerArm: 'RightLowerArm',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);

  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings keeps current VRMA spine and lower body basis correction', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          hips: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
          spine: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'hips', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'spine', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'Hips', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'Spine', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
          spine: 'Spine',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const mappingBySourceBoneName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));

  assertQuaternionClose(mappingBySourceBoneName.get('hips').vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('hips').vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('spine').vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('spine').vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings uses VRMA world-rest retarget for feet and toes', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          leftFoot: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
          rightFoot: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
          leftToes: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
          rightToes: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'leftFoot', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'rightFoot', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'leftToes', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'rightToes', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'LeftFoot', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'RightFoot', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'LeftToes', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'RightToes', parentIndex: 2, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftFoot: 'LeftFoot',
          rightFoot: 'RightFoot',
          leftToes: 'LeftToes',
          rightToes: 'RightToes',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const mappingBySourceBoneName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));

  for (const sourceBoneName of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']) {
    assert.equal(mappingBySourceBoneName.get(sourceBoneName).vrmaUseWorldRestRetarget, true);
    assertQuaternionClose(mappingBySourceBoneName.get(sourceBoneName).vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
    assertQuaternionClose(mappingBySourceBoneName.get(sourceBoneName).vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
  }
});

test('createResolvedAnimationBoneMappings keeps current VRMA finger basis correction', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          leftIndexProximal: {
            localRotation: [0, 0, 0, 1],
            worldRotation: [0, 0, 0, 1],
          },
        },
      },
    },
  });
  clip.channels.push({
    target: { kind: 'bone', name: 'leftIndexProximal', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { name: '全ての親', parentIndex: -1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'LeftHand', parentIndex: 0, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: 'LeftIndex1', parentIndex: 1, localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
      vrm: {
        humanoidBoneNameMap: {
          leftHand: 'LeftHand',
          leftIndexProximal: 'LeftIndex1',
        },
      },
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);

  assert.equal(mappings.length, 1);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionQuaternion, [0, 0, 0, 1]);
  assertQuaternionClose(mappings[0].vrmaBasisCorrectionInverseQuaternion, [0, 0, 0, 1]);
});

test('ensureAnimationMappingState seeds VRMA defaults for PMX models', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          hips: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
          leftUpperArm: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
          rightIndexProximal: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
        },
      },
    },
  });
  clip.channels.push(
    { target: { kind: 'bone', name: 'hips', path: 'translation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
    { target: { kind: 'bone', name: 'leftUpperArm', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
    { target: { kind: 'bone', name: 'rightIndexProximal', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
  );
  const instance = {
    model: {
      magic: 'Pmx',
      bones: [
        { name: 'センター' },
        { name: '左腕' },
        { name: '右人差指１' },
      ],
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const state = ensureAnimationMappingState(instance);

  assert.equal(state.entries.get('hips').targetBoneName, 'センター');
  assert.equal(state.entries.get('leftUpperArm').targetBoneName, '左腕');
  assert.equal(state.entries.get('rightIndexProximal').targetBoneName, '右人差指１');
});

test('createResolvedAnimationBoneMappings normalizes PMX target rest rotations for VRMA', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        hipsRestPosition: [0, 10, 0],
        humanBoneRestRotations: {
          hips: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
          leftLowerLeg: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
        },
      },
    },
  });
  clip.channels.push(
    { target: { kind: 'bone', name: 'hips', path: 'translation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
    { target: { kind: 'bone', name: 'leftLowerLeg', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
  );
  const instance = {
    model: {
      magic: 'Pmx',
      bones: [
        { name: 'センター', parentIndex: -1, position: [0, 12, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: '左足', parentIndex: 0, position: [0, 9, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: '左ひざ', parentIndex: 1, position: [0, 5, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: '左足首', parentIndex: 2, position: [0, 0, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const mappingBySourceBoneName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));

  assert.equal(mappingBySourceBoneName.get('hips').targetBoneName, 'センター');
  assert.deepEqual(mappingBySourceBoneName.get('hips').translationScale, [0.9, 0.9, 0.9]);
  assert.equal(mappingBySourceBoneName.get('leftLowerLeg').vrmaUseWorldRestRetarget, true);
  assertQuaternionClose(mappingBySourceBoneName.get('hips').targetLocalRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('hips').targetWorldRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('leftLowerLeg').targetLocalRestRotation, [0, 0, 0, 1]);
  assertQuaternionClose(mappingBySourceBoneName.get('leftLowerLeg').targetWorldRestRotation, [0, 0, 0, 1]);
});

test('createResolvedAnimationBoneMappings uses world-rest retarget only for PMX VRMA thumb metacarpals', () => {
  const clip = createEmptyAnimationClip({
    name: 'Walk',
    metadata: {
      vrmAnimation: {
        humanBoneRestRotations: {
          rightThumbMetacarpal: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
          rightThumbProximal: { localRotation: [0, 0, 0, 1], worldRotation: [0, 0, 0, 1] },
        },
      },
    },
  });
  clip.channels.push(
    { target: { kind: 'bone', name: 'rightThumbMetacarpal', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
    { target: { kind: 'bone', name: 'rightThumbProximal', path: 'rotation' }, sampler: { interpolation: 'LINEAR', keyframes: [] } },
  );
  const instance = {
    model: {
      magic: 'Pmx',
      bones: [
        { name: '右手首', parentIndex: -1, position: [0, 10, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: '右親指０', parentIndex: 0, position: [1, 9, 0], localX: [0, 1, 0], localY: [-1, 0, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
        { name: '右親指１', parentIndex: 1, position: [2, 8, 0], localX: [1, 0, 0], localY: [0, 1, 0], localZ: [0, 0, 1], baseRotationQuaternion: [0, 0, 0, 1] },
      ],
    },
    animationSource: {
      kind: 'vrma',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
  };

  const mappings = createResolvedAnimationBoneMappings(instance);
  const mappingBySourceBoneName = new Map(mappings.map((mapping) => [mapping.sourceBoneName, mapping]));

  assert.equal(mappingBySourceBoneName.get('rightThumbMetacarpal').vrmaUseWorldRestRetarget, true);
  assert.equal(mappingBySourceBoneName.get('rightThumbProximal').vrmaUseWorldRestRetarget, false);
});

test('applyAnimationMappingToController forwards resolved mappings to the controller', () => {
  const clip = createEmptyAnimationClip({ name: 'Walk' });
  clip.channels.push({
    target: { kind: 'bone', name: 'Hip', path: 'rotation' },
    sampler: { interpolation: 'LINEAR', keyframes: [] },
  });
  const forwarded = [];
  const instance = {
    model: {
      bones: [
        { name: 'HipTarget' },
      ],
    },
    animationSource: {
      kind: 'gltf',
      name: 'Walk',
      clip,
    },
    animationMappingBySourceKey: new Map(),
    animationController: {
      setBoneMappings(mappings) {
        forwarded.push(mappings);
      },
    },
  };

  const state = ensureAnimationMappingState(instance);
  state.entries.get('Hip').targetBoneName = 'HipTarget';
  state.entries.get('Hip').rotationFlipAxes = { x: false, y: true, z: false };
  applyAnimationMappingToController(instance);

  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0][0].sourceBoneName, 'Hip');
  assert.equal(forwarded[0][0].targetBoneIndex, 0);
  assert.deepEqual(forwarded[0][0].rotationFlipAxes, { x: false, y: true, z: false });
  assert.equal(getAnimationSourceKey(instance.animationSource), 'gltf:Walk');
});
