import assert from 'node:assert/strict';
import test from 'node:test';
import { quat } from '../source/lib/esm/index.js';
import { createBoneInfoUiState } from '../source/ui/panels/bone-info-ui.js';
import { createWorldRotationUiState } from '../source/ui/panels/world-rotation-ui.js';
import { createBoneInspectorService } from '../source/application/editing/bone-inspector-service.js';

function createLocalTransform(overrides = {}) {
  return {
    translation: [0, 0, 0],
    manualTranslation: [0, 0, 0],
    rotation: quat.create(),
    manualRotation: quat.create(),
    baseRotation: quat.create(),
    worldRotation: quat.create(),
    worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ...overrides,
  };
}

test('bone inspector service returns empty disabled state without a selected bone', () => {
  const selection = {
    selectedBoneIndex: -1,
    selectedBoneIndices: [],
    activeBoneIndex: -1,
    activeInstanceIndex: 0,
    useWorldCoordinate: false,
    prevEuler: [0, 0, 0],
    worldRotationUiState: createWorldRotationUiState(),
    boneInfoUiState: createBoneInfoUiState(),
  };
  const service = createBoneInspectorService({
    modelManager: { instances: [] },
    selection,
    boneService: {},
    getBoneEditTargets: () => [],
    filterBoneEditTargetsByMode: () => [],
    getBoneRotationLocks: () => ({ x: false, y: false, z: false }),
    getBoneIkRotationLocks: () => ({ x: false, y: false, z: false }),
    childBonePickState: { enabled: false },
    getKeyframeBackgroundColor: () => '',
  });

  const state = service.getPanelState(null, { None: 'None' }, {});
  assert.equal(state.saveVpdDisabled, true);
  assert.equal(state.child.controlsEnabled, false);
  assert.equal(state.ik.controlsEnabled, false);
  assert.equal(state.positionInputs.every((input) => input.disabled), true);
  assert.equal(state.rotationInputs.every((input) => input.disabled), true);
});

test('bone inspector service exposes child and IK panel state for the active bone', () => {
  const activeInstance = {
    model: {
      name: 'Hero',
      bones: [
        { name: 'Center', parentIndex: -1, ikRotationLocks: { x: true, y: false, z: false } },
        { name: 'Target', parentIndex: 0 },
      ],
      bindBones: [
        { rotation: quat.create() },
        { rotation: quat.create() },
      ],
      ik: [
        {
          boneIndex: 0,
          targetBoneIndex: 1,
          links: [{ boneIndex: 1 }],
          loopCount: 4,
          runtimeGeneratedIk: true,
          enabled: true,
        },
      ],
    },
    scene: {
      boneLocalTransforms: [
        createLocalTransform({
          childEnabled: true,
          childInfluence: 0.5,
          childSourceInstanceIndex: 1,
          childSourceBoneIndex: 0,
        }),
        createLocalTransform(),
      ],
      boneWorldPositions: [[0, 0, 0], [0, 0, 0]],
    },
    animationController: {
      currentFrame: 12,
      animationClip: {
        channels: [
          {
            target: { kind: 'bone', name: 'Center' },
            sampler: { keyframes: [{ frameNum: 12 }] },
          },
        ],
      },
    },
  };
  const targetInstance = {
    model: {
      name: 'Support',
      bones: [{ name: 'Chest' }],
    },
  };
  const selection = {
    selectedBoneIndex: 0,
    selectedBoneIndices: [0],
    activeBoneIndex: 0,
    activeInstanceIndex: 0,
    useWorldCoordinate: false,
    prevEuler: [0, 0, 0],
    worldRotationUiState: createWorldRotationUiState(),
    boneInfoUiState: createBoneInfoUiState(),
  };
  const service = createBoneInspectorService({
    modelManager: { instances: [activeInstance, targetInstance] },
    selection,
    boneService: {
      resolveActiveIkContext: () => ({
        instance: activeInstance,
        activeBoneIndex: 0,
        bone: activeInstance.model.bones[0],
        ikIndex: 0,
        ik: activeInstance.model.ik[0],
      }),
    },
    getBoneEditTargets: () => [{
      instance: activeInstance,
      boneIndex: 0,
      bone: activeInstance.model.bones[0],
    }],
    filterBoneEditTargetsByMode: (targets) => targets,
    getBoneRotationLocks: () => ({ x: false, y: true, z: false }),
    getBoneIkRotationLocks: (bone) => bone.ikRotationLocks || { x: false, y: false, z: false },
    childBonePickState: { enabled: true },
    getKeyframeBackgroundColor: () => 'var(--on-key-color)',
  });

  const state = service.getPanelState(activeInstance, { None: 'None', 'Pick Child Bone': 'Pick Child Bone' }, {
    isBoneInfoEditing: false,
    isWorldRotationEditing: false,
  });

  assert.equal(state.saveVpdDisabled, false);
  assert.equal(state.child.controlsEnabled, true);
  assert.equal(state.child.modelValue, '1');
  assert.equal(state.child.boneValue, '0');
  assert.equal(state.child.pickButtonPressed, true);
  assert.equal(state.ik.controlsEnabled, true);
  assert.equal(state.ik.targetValue, '1');
  assert.equal(state.ik.iterationCount, 4);
  assert.equal(state.rotationInputs[1].disabled, true);
  assert.equal(state.positionInputs[0].backgroundColor, 'var(--on-key-color)');
});

test('bone inspector service falls back to the selected bone when no active bone is set', () => {
  const activeInstance = {
    model: {
      name: 'Hero',
      bones: [
        { name: 'Center', parentIndex: -1 },
        { name: 'Arm', parentIndex: 0 },
      ],
      bindBones: [
        { rotation: quat.create() },
        { rotation: quat.create() },
      ],
    },
    scene: {
      boneLocalTransforms: [
        createLocalTransform(),
        createLocalTransform(),
      ],
      boneWorldPositions: [[0, 0, 0], [0, 0, 0]],
    },
    animationController: {
      currentFrame: 0,
    },
  };
  const selection = {
    selectedBoneIndex: 1,
    selectedBoneIndices: [1],
    activeBoneIndex: -1,
    activeInstanceIndex: 0,
    useWorldCoordinate: false,
    prevEuler: [0, 0, 0],
    worldRotationUiState: createWorldRotationUiState(),
    boneInfoUiState: createBoneInfoUiState(),
  };
  const service = createBoneInspectorService({
    modelManager: { instances: [activeInstance] },
    selection,
    boneService: {},
    getBoneEditTargets: () => [{
      instance: activeInstance,
      boneIndex: 1,
      bone: activeInstance.model.bones[1],
    }],
    filterBoneEditTargetsByMode: (targets) => targets,
    getBoneRotationLocks: () => ({ x: false, y: false, z: false }),
    getBoneIkRotationLocks: () => ({ x: false, y: false, z: false }),
    childBonePickState: { enabled: false },
    getKeyframeBackgroundColor: () => '',
  });

  const state = service.getPanelState(activeInstance, { None: 'None' }, {});

  assert.equal(state.saveVpdDisabled, false);
  assert.equal(state.parentBoneName, 'Center');
  assert.equal(state.positionInputs.every((input) => input.disabled === false), true);
});

test('bone inspector service can resolve the selected bone from the provided active instance', () => {
  const activeInstance = {
    model: {
      name: 'Hero',
      bones: [
        { name: 'Center', parentIndex: -1 },
        { name: 'Arm', parentIndex: 0 },
      ],
      bindBones: [
        { rotation: quat.create() },
        { rotation: quat.create() },
      ],
    },
    scene: {
      boneLocalTransforms: [
        createLocalTransform(),
        createLocalTransform(),
      ],
      boneWorldPositions: [[0, 0, 0], [0, 0, 0]],
    },
    animationController: {
      currentFrame: 0,
    },
  };
  const selection = {
    selectedBoneIndex: 1,
    selectedBoneIndices: [1],
    activeBoneIndex: -1,
    activeInstanceIndex: 99,
    useWorldCoordinate: false,
    prevEuler: [0, 0, 0],
    worldRotationUiState: createWorldRotationUiState(),
    boneInfoUiState: createBoneInfoUiState(),
  };
  const service = createBoneInspectorService({
    modelManager: { instances: [] },
    selection,
    boneService: {},
    getBoneEditTargets: () => [{
      instance: activeInstance,
      boneIndex: 1,
      bone: activeInstance.model.bones[1],
    }],
    filterBoneEditTargetsByMode: (targets) => targets,
    getBoneRotationLocks: () => ({ x: false, y: false, z: false }),
    getBoneIkRotationLocks: () => ({ x: false, y: false, z: false }),
    childBonePickState: { enabled: false },
    getKeyframeBackgroundColor: () => '',
  });

  const state = service.getPanelState(activeInstance, { None: 'None' }, {});

  assert.equal(state.saveVpdDisabled, false);
  assert.equal(state.parentBoneName, 'Center');
  assert.equal(state.positionInputs[0].value, 0);
});
