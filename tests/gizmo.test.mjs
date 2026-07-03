import assert from 'node:assert/strict';
import test from 'node:test';

import { quat } from '../source/lib/esm/index.js';
import { buildGizmoVertices, beginGizmoDrag, createGizmoState, getGizmoScale, pickGizmo, resolveGizmoPose, updateGizmoDrag } from '../source/core/selection/gizmo.js';
import { getRayFromMouse } from '../source/application/interaction/renderer-interaction.js';

function assertQuatRotationClose(actual, expected, epsilon = 1e-6) {
  const directDelta = Math.abs(actual[0] - expected[0]) + Math.abs(actual[1] - expected[1]) + Math.abs(actual[2] - expected[2]) + Math.abs(actual[3] - expected[3]);
  const negatedDelta = Math.abs(actual[0] + expected[0]) + Math.abs(actual[1] + expected[1]) + Math.abs(actual[2] + expected[2]) + Math.abs(actual[3] + expected[3]);
  assert.ok(Math.min(directDelta, negatedDelta) < epsilon);
}

function createInstance(flags, overrides = {}) {
  return {
    model: {
      bones: [
        {
          name: 'TestBone',
          flags,
          parentIndex: -1,
          ...overrides.bone,
        },
      ],
    },
    scene: {
      boneWorldPositions: [overrides.worldPosition || [0, 0, 0]],
      boneLocalTransforms: [
        {
          worldRotation: quat.create(),
          localX: overrides.localX || [1, 0, 0],
          localY: overrides.localY || [0, 1, 0],
          localZ: overrides.localZ || [0, 0, 1],
          baseRotation: overrides.baseRotation ? quat.clone(overrides.baseRotation) : quat.create(),
          manualRotation: overrides.manualRotation ? quat.clone(overrides.manualRotation) : quat.create(),
          manualTranslation: overrides.manualTranslation ? [...overrides.manualTranslation] : [0, 0, 0],
          rotation: overrides.rotation ? quat.clone(overrides.rotation) : quat.create(),
          translation: overrides.translation ? [...overrides.translation] : [0, 0, 0],
        },
      ],
    },
  };
}

function createMultiInstance() {
  const quarterTurn = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 4);

  return {
    model: {
      bones: [
        {
          name: 'BoneA',
          flags: 0x0002 | 0x0004,
          parentIndex: -1,
        },
        {
          name: 'BoneB',
          flags: 0x0002 | 0x0004,
          parentIndex: -1,
        },
      ],
    },
    scene: {
      boneWorldPositions: [
        [0, 0, 0],
        [2, 0, 0],
      ],
      boneLocalTransforms: [
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: quat.create(),
          manualTranslation: [0, 0, 0],
          rotation: quat.create(),
          translation: [0, 0, 0],
        },
        {
          worldRotation: quat.create(),
          localX: [0, 1, 0],
          localY: [-1, 0, 0],
          localZ: [0, 0, 1],
          manualRotation: quarterTurn,
          manualTranslation: [1, 0, 0],
          rotation: quat.create(),
          translation: [1, 0, 0],
        },
      ],
    },
  };
}

function createRotatedMultiInstance() {
  const halfTurn = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2);

  return {
    model: {
      bones: [
        {
          name: 'BoneA',
          flags: 0x0002 | 0x0004,
          parentIndex: -1,
        },
        {
          name: 'BoneB',
          flags: 0x0002 | 0x0004,
          parentIndex: 0,
        },
      ],
    },
    scene: {
      boneWorldPositions: [
        [0, 0, 0],
        [2, 0, 0],
      ],
      boneLocalTransforms: [
        {
          worldRotation: quat.clone(halfTurn),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: quat.create(),
          manualTranslation: [0, 0, 0],
          rotation: quat.create(),
          translation: [0, 0, 0],
        },
        {
          worldRotation: quat.clone(halfTurn),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: quat.create(),
          manualTranslation: [0, 0, 0],
          rotation: quat.create(),
          translation: [0, 0, 0],
        },
      ],
    },
  };
}

function createSelection(overrides = {}) {
  return {
    selectedBoneIndex: 0,
    selectedBoneIndices: [0],
    activeBoneIndex: 0,
    useWorldCoordinate: false,
    ...overrides,
  };
}

/**
 * Generates a test ray that reaches the gizmo ring without depending on a fixed radius constant.
 * @param {Array<number>} vertices - Gizmo vertices returned by buildGizmoVertices().
 * @returns {number} Estimated ring radius.
 */
function getGizmoRingRadius(vertices) {
  let maxDistance = 0;
  for (let i = 0; i < vertices.length; i += 10) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    const distance = Math.hypot(x, y, z);
    if (distance > maxDistance) {
      maxDistance = distance;
    }
  }
  return maxDistance;
}

test('buildGizmoVertices shows both gizmos when bone flags are absent', () => {
  const instance = createInstance(undefined);
  const vertices = buildGizmoVertices(instance, createSelection(), [0, 0, 10]);
  assert.equal(vertices.length, 13140);
});

test('buildGizmoVertices shows only rotation gizmo for rotatable bones', () => {
  const instance = createInstance(0x0002);
  const vertices = buildGizmoVertices(instance, createSelection(), [0, 0, 10]);
  assert.equal(vertices.length, 11520);
});

test('buildGizmoVertices shows only translation gizmo for translatable bones', () => {
  const instance = createInstance(0x0004);
  const vertices = buildGizmoVertices(instance, createSelection(), [0, 0, 10]);
  assert.equal(vertices.length, 1620);
});

test('buildGizmoVertices hides gizmo when neither rotation nor translation is allowed', () => {
  const instance = createInstance(0);
  const vertices = buildGizmoVertices(instance, createSelection(), [0, 0, 10]);
  assert.deepEqual(vertices, []);
});

test('pickGizmo hides gizmo when neither rotation nor translation is allowed', () => {
  const instance = createInstance(0);
  const hit = pickGizmo(
    {
      start: [0, 0, 10],
      end: [0, 0, 0],
    },
    instance,
    createSelection(),
  );
  assert.equal(hit, null);
});

test('getGizmoScale clamps the gizmo size at close camera distances', () => {
  const scale = getGizmoScale([0, 0, 0.001], [0, 0, 0]);
  assert.equal(scale, 0.05);
});

test('buildGizmoVertices keeps the light gizmo about the same size as the bone gizmo', () => {
  const boneInstance = createInstance(0x0002 | 0x0004);
  const boneSelection = createSelection();
  const boneVertices = buildGizmoVertices(boneInstance, boneSelection, [0, 0, 10]);
  const boneRadius = getGizmoRingRadius(boneVertices);

  const lightSelection = createSelection({ selectedLight: true });
  const lightVertices = buildGizmoVertices(
    null,
    lightSelection,
    [0, 0, 10],
    {
      position: [0, 0, 0],
      direction: [0, -1, 0],
      rotation: quat.create(),
    },
  );
  const lightRadius = getGizmoRingRadius(lightVertices);

  assert.ok(lightRadius > 0);
  assert.ok(Math.abs((lightRadius / boneRadius) - 1.0) < 0.03);
});

test('pickGizmo still returns a rotation hit when the camera is extremely close', () => {
  const instance = createInstance(0x0002);
  const selection = createSelection();
  const canvas = {
    width: 128,
    height: 128,
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 128, height: 128 };
    },
  };
  const camera = {
    center: [0, 0, 0],
    distance: 0.001,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
    clipPlanes: {
      near: 0.0001,
      far: 1000,
    },
  };

  const ray = getRayFromMouse({
    clientX: 40,
    clientY: 0,
  }, canvas, camera);
  const hit = pickGizmo(ray, instance, selection);

  assert.ok(hit);
  assert.equal(hit.mode, 'rotate');
});

test('rotationLocks show only the unlocked elbow Y rotation ring', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection();
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  assert.equal(vertices.length, 3840);
});

test('rotationLocks keep all rotation rings when no axis is locked', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: false, y: false, z: false };
  const selection = createSelection();
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  assert.equal(vertices.length, 11520);
});

test('rotationLocks still apply in world coordinate mode', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection({ useWorldCoordinate: true });
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  assert.equal(vertices.length, 3840);
});

test('pickGizmo returns the unlocked Y rotation hit', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection();
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  const gizmoRadius = getGizmoRingRadius(vertices);
  const hit = pickGizmo(
    {
      start: [gizmoRadius, 10, 0],
      end: [gizmoRadius, -10, 0],
    },
    instance,
    selection,
  );
  assert.ok(hit);
  assert.equal(hit.axis, 'y');
});

test('pickGizmo blocks locked rotation hits in local coordinate mode', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection();
  const hit = pickGizmo(
    {
      start: [10, 0.4, 0],
      end: [-10, 0.4, 0],
    },
    instance,
    selection,
  );
  assert.equal(hit, null);
});

test('pickGizmo still respects rotation locks in world coordinate mode', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection({
    useWorldCoordinate: true,
  });
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  const gizmoRadius = getGizmoRingRadius(vertices);
  const hit = pickGizmo(
    {
      start: [10, 0, gizmoRadius],
      end: [-10, 0, gizmoRadius],
    },
    instance,
    selection,
  );
  assert.ok(hit);
  assert.equal(hit.axis, 'y');
});

test('pickGizmo falls back to edge-on ring hits', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection();
  const hit = pickGizmo(
    {
      start: [0.01, 0, 10],
      end: [0.01, 0, -10],
    },
    instance,
    selection,
  );
  assert.ok(hit);
  assert.equal(hit.axis, 'y');
  assert.equal(hit.dragKind, 'edge-on-ring');
});

test('pickGizmo uses the common unlocked axes across multiple selected bones', () => {
  const instance = createMultiInstance();
  instance.model.bones[0].flags = 0x0002;
  instance.model.bones[1].flags = 0x0002;
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  instance.model.bones[1].rotationLocks = { x: false, y: false, z: true };
  const selection = createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  });
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  assert.equal(vertices.length, 3840);

  const gizmoRadius = getGizmoRingRadius(vertices);
  const hit = pickGizmo(
    {
      start: [gizmoRadius, 10, 0],
      end: [gizmoRadius, -10, 0],
    },
    instance,
    selection,
  );
  assert.ok(hit);
  assert.equal(hit.axis, 'y');
});

test('resolveGizmoPose averages multiple selected bones', () => {
  const instance = createMultiInstance();
  const pose = resolveGizmoPose(instance, createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  }));

  assert.ok(pose);
  assert.deepEqual(pose.position, [1, 0, 0]);
  assert.ok(Math.abs(pose.worldAxes.x[0] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.x[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.y[0] + Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.y[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.z[2] - 1) < 1e-6);
});

test('resolveGizmoPose aggregates multi-selection display axes in world space', () => {
  const instance = createRotatedMultiInstance();
  const pose = resolveGizmoPose(instance, createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  }));

  assert.ok(pose);
  assert.ok(Math.abs(pose.worldAxes.x[0]) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.x[1] - 1) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.y[0] + 1) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.y[1]) < 1e-6);
  assert.ok(Math.abs(pose.worldAxes.z[2] - 1) < 1e-6);
});

test('pickGizmo uses the aggregate pose for multiple selected bones', () => {
  const instance = createMultiInstance();
  const selection = createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  });
  const vertices = buildGizmoVertices(instance, selection, [0, 0, 10]);
  const gizmoRadius = getGizmoRingRadius(vertices);
  const hit = pickGizmo(
    {
      start: [gizmoRadius, 10, 0],
      end: [gizmoRadius, -10, 0],
    },
    instance,
    selection,
  );

  assert.ok(hit);
});

test('edge-on ring drag still updates rotation', () => {
  const instance = createInstance(0x0002);
  instance.model.bones[0].rotationLocks = { x: true, y: false, z: true };
  const selection = createSelection();
  const hit = pickGizmo(
    {
      start: [0.01, 0, 10],
      end: [0.01, 0, -10],
    },
    instance,
    selection,
  );
  assert.ok(hit);
  assert.equal(hit.dragKind, 'edge-on-ring');

  const state = createGizmoState();
  let capturedRotation = null;
  const modelManager = {
    setManualLocalRotationQuaternion(_instance, _boneIndex, rotation) {
      capturedRotation = quat.clone(rotation);
    },
  };

  beginGizmoDrag(state, hit, instance, selection, modelManager);
  const updated = updateGizmoDrag(
    state,
    instance,
    {
      start: [-0.01, 0, 10],
      end: [-0.01, 0, -10],
    },
    selection,
    modelManager,
  );

  assert.equal(updated, true);
  assert.ok(capturedRotation);
  assert.notDeepEqual(Array.from(capturedRotation), [0, 0, 0, 1]);
});

test('multi-selection rotation applies the same delta to every bone', () => {
  const instance = createMultiInstance();
  const selection = createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  });
  const hit = {
    mode: 'rotate',
    axis: 'z',
    hitPoint: [2, 0, 0],
    normal: [0, 0, 1],
  };
  const state = createGizmoState();
  const captured = [];
  const modelManager = {
    setManualLocalRotationQuaternion(_instance, boneIndex, rotation) {
      captured.push({
        boneIndex,
        rotation: quat.clone(rotation),
      });
    },
  };

  beginGizmoDrag(state, hit, instance, selection, modelManager);
  const updated = updateGizmoDrag(
    state,
    instance,
    {
      start: [1, 1, 10],
      end: [1, 1, -10],
    },
    selection,
    modelManager,
  );

  assert.equal(updated, true);
  assert.equal(captured.length, 2);
  const expected0 = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2);
  const expected1 = quat.setAxisAngle(quat.create(), [0, 0, 1], (Math.PI / 4) + (Math.PI / 2));
  assert.ok(Math.abs(captured[0].rotation[2] - expected0[2]) < 1e-6);
  assert.ok(Math.abs(captured[0].rotation[3] - expected0[3]) < 1e-6);
  assert.ok(Math.abs(captured[1].rotation[2] - expected1[2]) < 1e-6);
  assert.ok(Math.abs(captured[1].rotation[3] - expected1[3]) < 1e-6);
});

test('local rotation drag keeps VRM all-parent baseRotation in the target rotation', () => {
  const baseRotation = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI);
  const instance = createInstance(0x0002, {
    baseRotation,
  });
  const selection = createSelection();
  const hit = {
    mode: 'rotate',
    axis: 'z',
    hitPoint: [2, 0, 0],
    normal: [0, 0, 1],
  };
  const state = createGizmoState();
  let capturedRotation = null;
  const modelManager = {
    setManualLocalRotationQuaternion(_instance, _boneIndex, rotation) {
      capturedRotation = quat.clone(rotation);
    },
  };

  beginGizmoDrag(state, hit, instance, selection, modelManager);
  const updated = updateGizmoDrag(
    state,
    instance,
    {
      start: [1, 1, 10],
      end: [1, 1, -10],
    },
    selection,
    modelManager,
  );

  assert.equal(updated, true);
  assert.ok(capturedRotation);
  assertQuatRotationClose(state.startBoneStates[0].startLocalRotation, baseRotation);
  const legacyRotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2);
  const directDelta = Math.abs(capturedRotation[0] - legacyRotation[0]) + Math.abs(capturedRotation[1] - legacyRotation[1]) + Math.abs(capturedRotation[2] - legacyRotation[2]) + Math.abs(capturedRotation[3] - legacyRotation[3]);
  const negatedDelta = Math.abs(capturedRotation[0] + legacyRotation[0]) + Math.abs(capturedRotation[1] + legacyRotation[1]) + Math.abs(capturedRotation[2] + legacyRotation[2]) + Math.abs(capturedRotation[3] + legacyRotation[3]);
  assert.ok(Math.min(directDelta, negatedDelta) > 0.1);
});

test('multi-selection translation applies the same delta to every bone', () => {
  const instance = createMultiInstance();
  const selection = createSelection({
    selectedBoneIndex: -1,
    selectedBoneIndices: [0, 1],
    activeBoneIndex: -1,
  });
  const hit = {
    mode: 'translate',
    axis: 'x',
    hitPoint: [0, 0, 0],
    normal: [1, 0, 0],
  };
  const state = createGizmoState();
  const captured = [];
  const modelManager = {
    setManualLocalPosition(_instance, boneIndex, position) {
      captured.push({
        boneIndex,
        position: [...position],
      });
    },
  };

  beginGizmoDrag(state, hit, instance, selection, modelManager);
  const updated = updateGizmoDrag(
    state,
    instance,
    {
      start: [2, 1, 10],
      end: [2, 1, -10],
    },
    selection,
    modelManager,
  );

  assert.equal(updated, true);
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0].position, [2, 0, 0]);
  assert.deepEqual(captured[1].position, [4, 0, 0]);
});
