import assert from 'node:assert/strict';
import test from 'node:test';

import { quat, vec3 } from '../source/lib/esm/index.js';
import {
  applyVmdLightKeyframesToLightObject,
  applyLightManualPose,
  applyLightRotationDelta,
  applyLightTranslationDelta,
  buildLightDirectionLineVertices,
  buildLightIconVertices,
  createDirectionalLightDirectionFromVmdPosition,
  createLightObjectState,
  createVmdLightPositionFromDirectionalLight,
  createVmdLightPositionFromRotation,
  normalizeVmdLightKeyframe,
  rotateLightDirection,
  resolveLightKeyframePose,
  setLightDirection,
  setLightManualPosition,
  setLightManualRotationQuaternion,
  translateLightObject,
} from '../source/core/scene/light-object.js';

test('createLightObjectState normalizes the default light direction', () => {
  const light = createLightObjectState();

  assert.equal(Math.round(vec3.length(light.direction) * 1e6) / 1e6, 1);
  assert.deepEqual(light.position, [0.8, 1.8, 0.8]);
  assert.ok(light.rotation);
});

test('light rotation helpers accept typed array axes', () => {
  const light = createLightObjectState({
    direction: [0, -1, 0],
  });
  const startDirection = light.direction.slice();
  const axis = vec3.fromValues(1, 0, 0);

  rotateLightDirection(light, axis, Math.PI / 2);

  assert.notDeepEqual(light.direction, startDirection);
  assert.equal(Math.round(vec3.length(light.direction) * 1e6) / 1e6, 1);
});

test('applyLightRotationDelta updates the rotation from the start quaternion', () => {
  const light = createLightObjectState({
    direction: [0, -1, 0],
  });
  const axis = vec3.fromValues(0, 0, 1);

  applyLightRotationDelta(light, quat.create(), axis, Math.PI / 2);

  assert.equal(Math.round(vec3.length(light.direction) * 1e6) / 1e6, 1);
  assert.notDeepEqual(light.direction, [0, -1, 0]);
});

test('translation helpers update only the light position', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const delta = vec3.fromValues(4, 5, 6);

  translateLightObject(light, delta);
  assert.deepEqual(light.position, [5, 7, 9]);
  assert.deepEqual(Array.from(light.direction), [0, -1, 0]);

  applyLightTranslationDelta(light, vec3.fromValues(10, 20, 30), delta);
  assert.deepEqual(light.position, [14, 25, 36]);
  assert.deepEqual(Array.from(light.direction), [0, -1, 0]);
});

test('manual light pose persists on the current frame and clears on frame change', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 3);

  setLightManualPosition(light, manualPosition, 12);
  setLightManualRotationQuaternion(light, manualRotation, 12);

  assert.deepEqual(light.manualPosition, manualPosition);
  assert.deepEqual(Array.from(light.manualRotation), Array.from(manualRotation));
  assert.equal(light.manualPoseFrame, 12);

  applyLightManualPose(light, 12);
  assert.deepEqual(light.position, manualPosition);
  assert.deepEqual(Array.from(light.rotation), Array.from(manualRotation));

  applyLightManualPose(light, 13);
  assert.equal(light.manualPosition, null);
  assert.equal(light.manualRotation, null);
  assert.equal(light.manualPoseFrame, null);
});

test('resolveLightKeyframePose prefers manual light state on the keyed frame', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 3);

  setLightManualPosition(light, manualPosition, 12);
  setLightManualRotationQuaternion(light, manualRotation, 12);

  const resolved = resolveLightKeyframePose(light, 12);
  const expectedPosition = createVmdLightPositionFromRotation(manualRotation);

  assert.ok(resolved);
  assert.deepEqual(
    resolved.position.map((value) => Number(value.toFixed(6))),
    expectedPosition.map((value) => Number(value.toFixed(6))),
  );
  assert.deepEqual(resolved.rotation.map((value) => Number(value.toFixed(6))), Array.from(manualRotation).map((value) => Number(value.toFixed(6))));
  assert.equal(Math.round(vec3.length(resolved.direction) * 1e6) / 1e6, 1);
});

test('resolveLightKeyframePose keeps manual position when only translation is edited', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];

  setLightManualPosition(light, manualPosition, 12);

  const resolved = resolveLightKeyframePose(light, 12);

  assert.ok(resolved);
  assert.deepEqual(resolved.position, manualPosition);
});

test('resolveLightKeyframePose in rotation mode does not emit a position key', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 3);

  setLightManualPosition(light, manualPosition, 12);
  setLightManualRotationQuaternion(light, manualRotation, 12);

  const resolved = resolveLightKeyframePose(light, 12, 'rotation');

  assert.ok(resolved);
  assert.equal(resolved.position, null);
  assert.equal(resolved.keyedPosition, false);
  assert.equal(resolved.keyedRotation, true);
  assert.deepEqual(resolved.rotation.map((value) => Number(value.toFixed(6))), Array.from(manualRotation).map((value) => Number(value.toFixed(6))));
});

test('resolveLightKeyframePose lets manual rotation override a mismatched manual position', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 4);

  setLightManualPosition(light, manualPosition, 12);
  setLightManualRotationQuaternion(light, manualRotation, 12);

  const resolved = resolveLightKeyframePose(light, 12);
  const expectedPosition = createVmdLightPositionFromRotation(manualRotation);

  assert.ok(resolved);
  assert.deepEqual(
    resolved.position.map((value) => Number(value.toFixed(6))),
    expectedPosition.map((value) => Number(value.toFixed(6))),
  );
  assert.notDeepEqual(
    resolved.position.map((value) => Number(value.toFixed(6))),
    manualPosition.map((value) => Number(value.toFixed(6))),
  );
});

test('normalizeVmdLightKeyframe keeps position null for rotation-only keys', () => {
  const normalized = normalizeVmdLightKeyframe({
    frameNum: 5,
    color: [1, 1, 1],
    position: null,
    direction: [0, -1, 0],
    rotation: quat.create(),
    keyedPosition: false,
    keyedRotation: true,
  });

  assert.equal(normalized.position, null);
  assert.equal(normalized.keyedPosition, false);
  assert.equal(normalized.keyedRotation, true);
});

test('setLightDirection keeps the quaternion in sync with the direction', () => {
  const light = createLightObjectState({
    direction: [0, -1, 0],
  });

  setLightDirection(light, [0.5, -0.5, 0.5]);

  assert.equal(Math.round(vec3.length(light.direction) * 1e6) / 1e6, 1);
  assert.ok(light.rotation);
});

test('VMD light position converts to the opposite directional light direction', () => {
  const direction = createDirectionalLightDirectionFromVmdPosition([1, -1, 0]);

  assert.deepEqual(direction.map((value) => Number(value.toFixed(6))), [
    Number((-Math.SQRT1_2).toFixed(6)),
    Number((Math.SQRT1_2).toFixed(6)),
    0,
  ]);
});

test('directional light direction converts back to a fixed-length VMD position', () => {
  const position = createVmdLightPositionFromDirectionalLight([0, -1, 0]);

  assert.deepEqual(position.map((value) => Number(value.toFixed(6))), [
    0,
    Number(Math.sqrt(2).toFixed(6)),
    0,
  ]);
});

test('zero-length VMD light position falls back to a valid directional light direction', () => {
  const direction = createDirectionalLightDirectionFromVmdPosition([0, 0, 0]);

  assert.equal(Math.round(vec3.length(direction) * 1e6) / 1e6, 1);
});

test('applyVmdLightKeyframesToLightObject interpolates color and direction', () => {
  const light = createLightObjectState({
    direction: [0, -1, 0],
  });
  const lightColor = [1, 1, 1, 2];
  const applied = applyVmdLightKeyframesToLightObject(light, [
    {
      frameNum: 0,
      color: [1, 0, 0],
      position: [1, -1, 0],
    },
    {
      frameNum: 10,
      color: [0, 0, 1],
      position: [-1, -1, 0],
    },
  ], 5, lightColor);

  assert.ok(applied);
  assert.deepEqual(lightColor.map((value) => Number(value.toFixed(6))), [0.5, 0, 0.5, 2]);
  assert.equal(Math.round(vec3.length(light.direction) * 1e6) / 1e6, 1);
  assert.ok(light.direction[1] > 0.99);
});

test('applyVmdLightKeyframesToLightObject keeps the manual light pose on the keyed frame', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 4);

  setLightManualPosition(light, manualPosition, 5);
  setLightManualRotationQuaternion(light, manualRotation, 5);

  const applied = applyVmdLightKeyframesToLightObject(light, [
    {
      frameNum: 5,
      color: [1, 0, 0],
      position: [1, -1, 0],
    },
    {
      frameNum: 10,
      color: [0, 0, 1],
      position: [-1, -1, 0],
    },
  ], 5);

  assert.ok(applied);
  assert.deepEqual(light.position, manualPosition);
  assert.deepEqual(Array.from(light.rotation), Array.from(manualRotation));
});

test('applyVmdLightKeyframesToLightObject keeps the current position for rotation-only keys', () => {
  const light = createLightObjectState({
    position: [3, 4, 5],
    direction: [0, -1, 0],
  });
  const rotation = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 4);

  const applied = applyVmdLightKeyframesToLightObject(light, [
    {
      frameNum: 5,
      color: [1, 0, 0],
      position: null,
      direction: [0, -1, 0],
      rotation,
      keyedPosition: false,
      keyedRotation: true,
    },
  ], 5);

  assert.ok(applied);
  assert.deepEqual(light.position, [3, 4, 5]);
  assert.deepEqual(Array.from(light.rotation).map((value) => Number(value.toFixed(6))), Array.from(rotation).map((value) => Number(value.toFixed(6))));
});

test('applyVmdLightKeyframesToLightObject keeps position interpolation when a middle key is rotation-only', () => {
  const light = createLightObjectState({
    position: [0, 0, 0],
    direction: [0, -1, 0],
  });
  const middleRotation = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 3);

  const applied = applyVmdLightKeyframesToLightObject(light, [
    {
      frameNum: 0,
      color: [1, 0, 0],
      position: [1, -1, 0],
      keyedPosition: true,
      keyedRotation: true,
    },
    {
      frameNum: 5,
      color: [0, 1, 0],
      position: null,
      rotation: middleRotation,
      direction: [0, -0.5, -0.8660254],
      keyedPosition: false,
      keyedRotation: true,
    },
    {
      frameNum: 10,
      color: [0, 0, 1],
      position: [-1, -1, 0],
      keyedPosition: true,
      keyedRotation: true,
    },
  ], 5);

  assert.ok(applied);
  assert.deepEqual(light.position.map((value) => Number(value.toFixed(6))), [0, -1, 0]);
  assert.deepEqual(Array.from(light.rotation).map((value) => Number(value.toFixed(6))), Array.from(middleRotation).map((value) => Number(value.toFixed(6))));
});

test('applyVmdLightKeyframesToLightObject clears the manual light pose after the keyed frame changes', () => {
  const light = createLightObjectState({
    position: [1, 2, 3],
    direction: [0, -1, 0],
  });
  const manualPosition = [8, 9, 10];
  const manualRotation = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 4);

  setLightManualPosition(light, manualPosition, 5);
  setLightManualRotationQuaternion(light, manualRotation, 5);

  const applied = applyVmdLightKeyframesToLightObject(light, [
    {
      frameNum: 5,
      color: [1, 0, 0],
      position: [1, -1, 0],
    },
    {
      frameNum: 10,
      color: [0, 0, 1],
      position: [-1, -1, 0],
    },
  ], 6);

  assert.ok(applied);
  assert.notDeepEqual(light.position, manualPosition);
  assert.notDeepEqual(Array.from(light.rotation), Array.from(manualRotation));
  assert.equal(light.manualPosition, null);
  assert.equal(light.manualRotation, null);
  assert.equal(light.manualPoseFrame, null);
});

test('buildLightDirectionLineVertices starts outside the icon radius', () => {
  const light = createLightObjectState({
    position: [0, 0, 0],
    direction: [0, 0, 1],
  });
  const camera = {
    center: [0, 0, 8],
    distance: 8,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
  };

  const vertices = buildLightDirectionLineVertices(light, camera);
  assert.ok(vertices.length > 0);

  let minProjection = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertices.length; i += 10) {
    const projection = vertices[i] * light.direction[0]
      + vertices[i + 1] * light.direction[1]
      + vertices[i + 2] * light.direction[2];
    if (projection < minProjection) {
      minProjection = projection;
    }
  }

  assert.ok(minProjection > 0.2);
  assert.ok(minProjection < 0.5);
});

test('buildLightIconVertices keeps the icon visually small', () => {
  const light = createLightObjectState({
    position: [0, 0, 0],
    direction: [0, 0, 1],
  });
  const camera = {
    center: [0, 0, 8],
    distance: 8,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
  };

  const vertices = buildLightIconVertices(light, camera);
  let maxDistance = 0;
  for (let i = 0; i < vertices.length; i += 10) {
    const distance = Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]);
    if (distance > maxDistance) {
      maxDistance = distance;
    }
  }

  assert.ok(maxDistance < 0.35);
});
