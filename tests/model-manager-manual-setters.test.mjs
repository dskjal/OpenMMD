import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelManager } from '../source/core/model/model-manager.js';
import {
  quaternionFromEulerXYZ,
  quaternionFromEulerYXZ,
  quaternionToEulerXYZ,
} from '../source/shared/math/math-utils.js';
import { mat4, quat, vec3 } from '../source/lib/esm/index.js';

globalThis.GPUShaderStage ??= { VERTEX: 1 };

test('ModelManager manual setters update local and world position consistently', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  const scene = createScene(model);
  const instance = { model, scene };

  scene.boneLocalTransforms[0].rotation = quat.create();
  scene.boneLocalTransforms[0].translation = vec3.fromValues(3, 4, 5);
  manager.recomputeBoneMatrices(model, scene);

  manager.setManualLocalPosition(instance, 0, [4, 5, 6]);
  assert.deepEqual(Array.from(scene.boneLocalTransforms[0].manualTranslation), [1, 1, 1]);
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);

  manager.resetManualTransform(instance, 0);
  scene.boneLocalTransforms[0].translation = vec3.fromValues(0, 0, 0);
  manager.recomputeBoneMatrices(model, scene);

  manager.setManualWorldPosition(instance, 1, [10, 4, 5]);
  assert.deepEqual(Array.from(scene.boneLocalTransforms[1].manualTranslation), [6, 0, 0]);
  assert.equal(scene.boneLocalTransforms[1].localDirty, true);
  assert.equal(scene.boneLocalTransforms[1].worldDirty, true);
});

test('ModelManager manual rotation setters convert Euler and quaternion inputs', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  model.bones[0].baseRotationQuaternion = Array.from(quaternionFromEulerXYZ([0, Math.PI / 2, 0]));
  model.bones[1].baseRotationQuaternion = Array.from(quaternionFromEulerXYZ([0.15, -0.25, 0.05]));
  const scene = createScene(model);
  const instance = { model, scene };

  manager.recomputeBoneMatrices(model, scene);

  const animationRotation = quaternionFromEulerXYZ([0.2, -0.1, 0.3]);
  scene.boneLocalTransforms[0].rotation = quat.clone(animationRotation);

  const localEuler = [0.6, -0.4, 0.2];
  const targetLocalRotation = quaternionFromEulerXYZ(localEuler);
  const invLocalBaseRotation = quat.invert(quat.create(), scene.boneLocalTransforms[0].baseRotation);
  const expectedLocalManual = quat.multiply(quat.create(), targetLocalRotation, quat.invert(quat.create(), animationRotation));
  quat.multiply(expectedLocalManual, invLocalBaseRotation, expectedLocalManual);
  manager.setManualLocalRotationEuler(instance, 0, localEuler);
  assertQuatClose(scene.boneLocalTransforms[0].manualRotation, expectedLocalManual);
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);

  const localQuatTarget = quaternionFromEulerXYZ([0.1, 0.25, -0.5]);
  const expectedLocalManualQuat = quat.multiply(quat.create(), localQuatTarget, quat.invert(quat.create(), animationRotation));
  quat.multiply(expectedLocalManualQuat, invLocalBaseRotation, expectedLocalManualQuat);
  manager.setManualLocalRotationQuaternion(instance, 0, localQuatTarget);
  assertQuatClose(scene.boneLocalTransforms[0].manualRotation, expectedLocalManualQuat);

  manager.recomputeBoneMatrices(model, scene);
  assertQuatClose(manager.getWorldRotationQuaternion(instance, 0), localQuatTarget);

  const parentWorldRotation = quaternionFromEulerXYZ([0.3, 0.15, -0.2]);
  scene.boneLocalTransforms[0].rotation = quat.clone(parentWorldRotation);
  manager.recomputeBoneMatrices(model, scene);

  const childGlobalEuler = [0.25, -0.35, 0.45];
  const childGlobalTarget = quaternionFromEulerXYZ(childGlobalEuler);
  const invParent = quat.invert(quat.create(), scene.boneLocalTransforms[0].worldRotation);
  const invChildBaseRotation = quat.invert(quat.create(), scene.boneLocalTransforms[1].baseRotation);
  const expectedChildManualEuler = quat.multiply(quat.create(), invParent, childGlobalTarget);
  quat.multiply(expectedChildManualEuler, invChildBaseRotation, expectedChildManualEuler);
  manager.setManualWorldRotationEuler(instance, 1, childGlobalEuler);
  assertQuatClose(scene.boneLocalTransforms[1].manualRotation, expectedChildManualEuler);

  const childGlobalQuatTarget = quaternionFromEulerXYZ([-0.1, 0.2, 0.3]);
  const expectedChildManualQuat = quat.multiply(quat.create(), invParent, childGlobalQuatTarget);
  quat.multiply(expectedChildManualQuat, invChildBaseRotation, expectedChildManualQuat);
  manager.setManualWorldRotationQuaternion(instance, 1, childGlobalQuatTarget);
  assertQuatClose(scene.boneLocalTransforms[1].manualRotation, expectedChildManualQuat);
  manager.recomputeBoneMatrices(model, scene);
  assertQuatClose(manager.getWorldRotationQuaternion(instance, 1), childGlobalQuatTarget);
});

test('ModelManager world rotation getters return quaternion and Euler from world rotation', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  const scene = createScene(model);
  const instance = { model, scene };

  const parentEuler = [0.3, -0.25, 0.4];
  const childEuler = [-0.15, 0.2, 0.35];
  const parentRotation = quaternionFromEulerXYZ(parentEuler);
  const childRotation = quaternionFromEulerXYZ(childEuler);
  const expectedGlobalRotation = quat.multiply(quat.create(), parentRotation, childRotation);
  const expectedGlobalEuler = quaternionToEulerXYZ(expectedGlobalRotation);

  scene.boneLocalTransforms[0].rotation = quat.clone(parentRotation);
  scene.boneLocalTransforms[1].rotation = quat.clone(childRotation);
  manager.recomputeBoneMatrices(model, scene);

  const readQuaternion = manager.getWorldRotationQuaternion(instance, 1);
  const readEuler = manager.getWorldRotationEuler(instance, 1);

  assertQuatClose(readQuaternion, expectedGlobalRotation);
  assertEulerClose(readEuler, expectedGlobalEuler);
});

test('ModelManager world rotation setters use YXZ for torso bones and preserve round-trip readback', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  model.bones[0].name = '下半身';
  model.bones[1].name = '上半身';
  const scene = createScene(model);
  const instance = { model, scene };

  scene.boneLocalTransforms[0].rotation = quat.create();
  scene.boneLocalTransforms[1].rotation = quat.create();
  manager.recomputeBoneMatrices(model, scene);

  const torsoEuler = [0.24, -0.31, 0.18];
  const expectedTorsoRotation = quaternionFromEulerYXZ(torsoEuler);
  manager.setManualWorldRotationEuler(instance, 1, torsoEuler);
  manager.recomputeBoneMatrices(model, scene);

  const readQuaternion = manager.getWorldRotationQuaternion(instance, 1);
  const readEuler = manager.getWorldRotationEuler(instance, 1);

  assertQuatClose(readQuaternion, expectedTorsoRotation);
  assertEulerClose(readEuler, torsoEuler);
});

test('ModelManager resetManualTransform clears manual offsets', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  const scene = createScene(model);
  const instance = { model, scene };

  scene.boneLocalTransforms[0].manualTranslation = vec3.fromValues(1, 2, 3);
  scene.boneLocalTransforms[0].manualRotation = quaternionFromEulerXYZ([0.1, 0.2, 0.3]);
  scene.boneLocalTransforms[0].localDirty = false;
  scene.boneLocalTransforms[0].worldDirty = false;

  manager.resetManualTransform(instance, 0);

  assert.deepEqual(Array.from(scene.boneLocalTransforms[0].manualTranslation), [0, 0, 0]);
  assertQuatClose(scene.boneLocalTransforms[0].manualRotation, quat.fromValues(0, 0, 0, 1));
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);
});

test('ModelManager partial reset methods clear only their respective manual offsets', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  const scene = createScene(model);
  const instance = { model, scene };

  scene.boneLocalTransforms[0].manualTranslation = vec3.fromValues(1, 2, 3);
  scene.boneLocalTransforms[0].manualRotation = quaternionFromEulerXYZ([0.1, 0.2, 0.3]);
  scene.boneLocalTransforms[0].localDirty = false;
  scene.boneLocalTransforms[0].worldDirty = false;

  manager.resetManualTranslation(instance, 0);

  assert.deepEqual(Array.from(scene.boneLocalTransforms[0].manualTranslation), [0, 0, 0]);
  assertQuatClose(scene.boneLocalTransforms[0].manualRotation, quaternionFromEulerXYZ([0.1, 0.2, 0.3]));
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);

  scene.boneLocalTransforms[0].localDirty = false;
  scene.boneLocalTransforms[0].worldDirty = false;

  manager.resetManualRotation(instance, 0);

  assert.deepEqual(Array.from(scene.boneLocalTransforms[0].manualTranslation), [0, 0, 0]);
  assertQuatClose(scene.boneLocalTransforms[0].manualRotation, quat.fromValues(0, 0, 0, 1));
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);
});

test('ModelManager dirty helpers mark local transforms through public APIs', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const model = createModel();
  const scene = createScene(model);
  const instance = { model, scene };

  scene.boneLocalTransforms[0].localDirty = false;
  scene.boneLocalTransforms[0].worldDirty = false;
  manager.markBoneTransformDirty(instance, 0);
  assert.equal(scene.boneLocalTransforms[0].localDirty, true);
  assert.equal(scene.boneLocalTransforms[0].worldDirty, true);

  scene.boneLocalTransforms[1].localDirty = false;
  scene.boneLocalTransforms[1].worldDirty = false;
  manager.markBoneLocalTransformDirty(scene.boneLocalTransforms[1]);
  assert.equal(scene.boneLocalTransforms[1].localDirty, true);
  assert.equal(scene.boneLocalTransforms[1].worldDirty, true);
});

test('ModelManager child offsets combine external parent motion and preserve manual world setters', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const parentModel = createSingleBoneModel('Parent');
  const childModel = createSingleBoneModel('Child');
  const parentScene = createFlatScene(parentModel);
  const childScene = createFlatScene(childModel);
  const parentInstance = { model: parentModel, scene: parentScene };
  const childInstance = { model: childModel, scene: childScene };

  parentScene.modelManager = manager;
  childScene.modelManager = manager;
  manager.instances = [childInstance, parentInstance];

  parentScene.boneLocalTransforms[0].translation = vec3.fromValues(10, 0, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);

  manager.setChild(childInstance, 0, 1, 0, 1);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [0, 0, 0]);

  parentScene.boneLocalTransforms[0].translation = vec3.fromValues(20, 0, 0);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [10, 0, 0]);

  manager.setManualWorldPosition(childInstance, 0, [15, 0, 0]);
  assert.deepEqual(Array.from(childScene.boneLocalTransforms[0].manualTranslation), [5, 0, 0]);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [15, 0, 0]);

  parentScene.boneLocalTransforms[0].rotation = quaternionFromEulerXYZ([0, 0, Math.PI / 2]);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.notDeepEqual(Array.from(childScene.boneWorldPositions[0]).map((value) => Number(value.toFixed(3))), [15, 0, 0]);

  parentScene.boneLocalTransforms[0].rotation = quat.create();
  parentScene.boneLocalTransforms[0].translation = vec3.fromValues(30, 0, 0);
  manager.setChildInfluence(childInstance, 0, 0.5);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [15, 0, 0]);

  manager.clearChildInverse(childInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [20, 0, 0]);

  const targetRotation = quaternionFromEulerXYZ([0.25, -0.5, 0.1]);
  parentScene.boneLocalTransforms[0].rotation = quaternionFromEulerXYZ([0, 0, Math.PI / 2]);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.setManualWorldRotationQuaternion(childInstance, 0, targetRotation);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assertQuatClose(manager.getWorldRotationQuaternion(childInstance, 0), targetRotation);
});

test('ModelManager child inverse rotates the child position when the target parent rotates', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const parentModel = createModel();
  const childModel = createSingleBoneModel('Child');
  const parentScene = createFlatScene(parentModel);
  const childScene = createFlatScene(childModel);
  const parentInstance = { model: parentModel, scene: parentScene };
  const childInstance = { model: childModel, scene: childScene };

  parentScene.modelManager = manager;
  childScene.modelManager = manager;
  manager.instances = [childInstance, parentInstance];

  parentScene.boneLocalTransforms[0].baseTranslation = vec3.fromValues(0, 0, 0);
  parentScene.boneLocalTransforms[1].baseTranslation = vec3.fromValues(10, 0, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);

  manager.setChild(childInstance, 0, 1, 1, 1);
  manager.setManualWorldPosition(childInstance, 0, [5, 0, 0]);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]).map((value) => Number(value.toFixed(3))), [5, 0, 0]);

  parentScene.boneLocalTransforms[0].rotation = quaternionFromEulerXYZ([0, 0, Math.PI / 2]);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]).map((value) => Number(value.toFixed(3))), [0, 5, 0]);
});

test('ModelManager child enablement can be checked before selecting a parent target', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const parentModel = createSingleBoneModel('Parent');
  const childModel = createSingleBoneModel('Child');
  const parentScene = createFlatScene(parentModel);
  const childScene = createFlatScene(childModel);
  const parentInstance = { model: parentModel, scene: parentScene };
  const childInstance = { model: childModel, scene: childScene };

  parentScene.modelManager = manager;
  childScene.modelManager = manager;
  manager.instances = [childInstance, parentInstance];

  manager.setChildEnabled(childInstance, 0, true, 0.5);
  assert.equal(childScene.boneLocalTransforms[0].childEnabled, true);
  assert.equal(childScene.boneLocalTransforms[0].childInfluence, 0.5);

  parentScene.boneLocalTransforms[0].translation = vec3.fromValues(12, 0, 0);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [0, 0, 0]);

  manager.setChildTarget(childInstance, 0, 1, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [0, 0, 0]);

  parentScene.boneLocalTransforms[0].translation = vec3.fromValues(20, 0, 0);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]), [4, 0, 0]);
});

test('ModelManager clear inverse preserves manual editing when the parent rotates', () => {
  const device = createDevice();
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const parentModel = createModel();
  const childModel = createSingleBoneModel('Child');
  const parentScene = createFlatScene(parentModel);
  const childScene = createFlatScene(childModel);
  const parentInstance = { model: parentModel, scene: parentScene };
  const childInstance = { model: childModel, scene: childScene };

  parentScene.modelManager = manager;
  childScene.modelManager = manager;
  manager.instances = [childInstance, parentInstance];

  parentScene.boneLocalTransforms[0].baseTranslation = vec3.fromValues(0, 0, 0);
  parentScene.boneLocalTransforms[1].baseTranslation = vec3.fromValues(10, 0, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);

  manager.setChild(childInstance, 0, 1, 1, 1);
  manager.clearChildInverse(childInstance, 0);
  manager.setManualWorldPosition(childInstance, 0, [15, 0, 0]);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]).map((value) => Number(value.toFixed(3))), [15, 0, 0]);

  parentScene.boneLocalTransforms[0].rotation = quaternionFromEulerXYZ([0, 0, Math.PI / 2]);
  manager.markBoneTransformDirty(parentInstance, 0);
  manager.recomputeBoneMatrices(parentModel, parentScene);
  manager.recomputeBoneMatrices(childModel, childScene);
  assert.deepEqual(Array.from(childScene.boneWorldPositions[0]).map((value) => Number(value.toFixed(3))), [0, 15, 0]);
});

function createDevice(writeBufferHandler = null) {
  return {
    createBindGroupLayout() {
      return {};
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

function createModel() {
  return {
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        inheritInfluence: 1,
        flags: 0,
        position: [3, 4, 5],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        transformLevel: 0,
      },
      {
        name: 'Child',
        parentIndex: 0,
        inheritParentIndex: -1,
        inheritInfluence: 1,
        flags: 0,
        position: [4, 4, 5],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        transformLevel: 1,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(2),
  };
}

/**
 * Creates a single-bone model for Child tests.
 * @param {string} name - Model name.
 * @returns {object} Model data.
 */
function createSingleBoneModel(name) {
  return {
    name,
    bones: [
      {
        name: 'Root',
        parentIndex: -1,
        inheritParentIndex: -1,
        inheritInfluence: 1,
        flags: 0,
        position: [0, 0, 0],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        transformLevel: 0,
      },
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(1),
  };
}

/**
 * Creates a single-bone scene with zero local offsets.
 * @param {object} model - Model data.
 * @returns {object} Scene state.
 */
function createFlatScene(model) {
  const boneLocalTransforms = model.bones.map((bone) => ({
    translation: vec3.fromValues(0, 0, 0),
    rotation: quat.create(),
    manualTranslation: vec3.fromValues(0, 0, 0),
    manualRotation: quat.fromValues(0, 0, 0, 1),
    childEnabled: false,
    childSourceInstanceIndex: -1,
    childSourceBoneIndex: -1,
    childInfluence: 1,
    childInverseEnabled: true,
    childInversePosition: vec3.fromValues(0, 0, 0),
    childInverseRotation: quat.fromValues(0, 0, 0, 1),
    childStoredTranslation: vec3.fromValues(0, 0, 0),
    childStoredRotation: quat.fromValues(0, 0, 0, 1),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix: mat4.create(),
    skinMatrix: mat4.create(),
    worldRotation: quat.create(),
    localX: bone.localX,
    localY: bone.localY,
    localZ: bone.localZ,
    baseTranslation: vec3.fromValues(0, 0, 0),
    localDirty: true,
    worldDirty: true,
    physicsMode: -1,
    physicsDriven: false,
  }));

  return {
    boneCount: boneLocalTransforms.length,
    modelManager: null,
    boneLocalTransforms,
    boneWorldPositions: Array.from({ length: boneLocalTransforms.length }, () => vec3.create()),
    sortedBoneIndices: boneLocalTransforms.map((_, index) => index),
    inverseBindMatrices: model.bones.map(() => mat4.create()),
    ikChains: [],
    uiOverlay: {
      boneLineVertexBuffer: createBuffer(),
      boneLineVertexCount: 0,
      boneAxisVertexBuffer: createBuffer(),
      boneAxisVertexCount: 0,
      physicsWireframeVertexBuffer: createBuffer(),
      physicsWireframeVertexCount: 0,
      indicatorVertexBuffer: createBuffer(),
      indicatorVertexCount: 0,
      gizmoVertexBuffer: createBuffer(),
      gizmoVertexCount: 0,
    },
    boneMatricesBuffer: createBuffer(),
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
}

function createScene(model) {
  const boneLocalTransforms = model.bones.map((bone, index) => createLocalTransform(model, bone, index));
  const boneCount = boneLocalTransforms.length;
  return {
    boneCount,
    modelManager: null,
    boneLocalTransforms,
    boneWorldPositions: Array.from({ length: boneCount }, () => vec3.create()),
    sortedBoneIndices: Array.from({ length: boneCount }, (_, index) => index),
    inverseBindMatrices: model.bones.map(() => mat4.create()),
    ikChains: [],
    uiOverlay: {
      boneLineVertexBuffer: createBuffer(),
      boneLineVertexCount: 0,
      boneAxisVertexBuffer: createBuffer(),
      boneAxisVertexCount: 0,
      physicsWireframeVertexBuffer: createBuffer(),
      physicsWireframeVertexCount: 0,
      indicatorVertexBuffer: createBuffer(),
      indicatorVertexCount: 0,
      gizmoVertexBuffer: createBuffer(),
      gizmoVertexCount: 0,
    },
    boneMatricesBuffer: createBuffer(),
    _tempMat: mat4.create(),
    _tempQuat: quat.create(),
    _tempQuat2: quat.create(),
    _tempVec3: vec3.create(),
    _identityQuat: quat.create(),
  };
}

function createLocalTransform(model, bone, index) {
  const parent = bone.parentIndex !== -1 ? model.bones[bone.parentIndex] : null;
  const baseTranslation = vec3.create();
  const baseRotation = Array.isArray(bone.baseRotationQuaternion) || ArrayBuffer.isView(bone.baseRotationQuaternion)
    ? quat.normalize(
      quat.fromValues(
        Number(bone.baseRotationQuaternion[0]) || 0,
        Number(bone.baseRotationQuaternion[1]) || 0,
        Number(bone.baseRotationQuaternion[2]) || 0,
        Number.isFinite(Number(bone.baseRotationQuaternion[3])) ? Number(bone.baseRotationQuaternion[3]) : 1,
      ),
      quat.create(),
    )
    : quat.create();
  if (parent) {
    vec3.set(
      baseTranslation,
      bone.position[0] - parent.position[0],
      bone.position[1] - parent.position[1],
      bone.position[2] - parent.position[2],
    );
  } else {
    vec3.set(baseTranslation, bone.position[0], bone.position[1], bone.position[2]);
  }

  return {
    translation: vec3.fromValues(index === 0 ? 3 : 0, index === 0 ? 4 : 0, index === 0 ? 5 : 0),
    rotation: index === 0 ? quaternionFromEulerXYZ([0.3, 0.15, -0.2]) : quat.create(),
    manualTranslation: vec3.fromValues(0, 0, 0),
    manualRotation: quat.fromValues(0, 0, 0, 1),
    childEnabled: false,
    childSourceInstanceIndex: -1,
    childSourceBoneIndex: -1,
    childInfluence: 1,
    childInverseEnabled: true,
    childInversePosition: vec3.fromValues(0, 0, 0),
    childInverseRotation: quat.fromValues(0, 0, 0, 1),
    childStoredTranslation: vec3.fromValues(0, 0, 0),
    childStoredRotation: quat.fromValues(0, 0, 0, 1),
    scale: vec3.fromValues(1, 1, 1),
    worldMatrix: mat4.create(),
    skinMatrix: mat4.create(),
    worldRotation: quat.clone(baseRotation),
    localX: bone.localX,
    localY: bone.localY,
    localZ: bone.localZ,
    baseTranslation,
    baseRotation,
    localDirty: true,
    worldDirty: true,
    physicsMode: -1,
    physicsDriven: false,
  };
}

function createBuffer(size = 4096) {
  return {
    size,
    destroy() {},
  };
}

function assertQuatClose(actual, expected, epsilon = 1e-6) {
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `quaternion mismatch at ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}

/**
 * Compares two Euler angle arrays.
 * @param {ArrayLike<number>} actual - Actual Euler angles.
 * @param {ArrayLike<number>} expected - Expected Euler angles.
 * @param {number} [epsilon=1e-6] - Comparison tolerance.
 */
function assertEulerClose(actual, expected, epsilon = 1e-6) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `euler mismatch at ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}
