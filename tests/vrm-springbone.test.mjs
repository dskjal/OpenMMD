import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelManager } from '../source/core/model/model-manager.js';
import { createSceneState } from '../source/core/model/model-scene.js';
import {
  parseVrmSpringBone,
  resetVrmSpringBoneState,
  updateVrmSpringBone,
} from '../source/core/physics/vrm-springbone.js';

globalThis.GPUShaderStage ??= { VERTEX: 1 };
globalThis.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, VERTEX: 4 };

test('parseVrmSpringBone normalizes colliders and springs against bone node indices', () => {
  const model = createModel();
  const springBone = parseVrmSpringBone(model, {
    extensions: {
      VRMC_springBone: {
        specVersion: '1.0',
        colliders: [
          {
            node: 1,
            shape: {
              sphere: {
                offset: [0.1, 0.2, 0.3],
                radius: 0.5,
              },
            },
          },
          {
            node: 2,
            shape: {
              capsule: {
                offset: [0, 0, 0],
                tail: [0, 0.5, 0],
                radius: 0.25,
              },
            },
          },
          {
            node: 99,
            shape: {
              sphere: {
                offset: [0, 0, 0],
                radius: 1,
              },
            },
          },
        ],
        colliderGroups: [
          {
            name: 'hair',
            colliders: [0, 1, 4],
          },
        ],
        springs: [
          {
            name: 'frontHair',
            center: 0,
            colliderGroups: [0],
            joints: [
              {
                node: 0,
                hitRadius: 0.05,
                stiffness: 0.7,
                gravityPower: 1.2,
                gravityDir: [1, 0, 0],
                dragForce: 0.25,
              },
              {
                node: 1,
              },
              {
                node: 2,
              },
            ],
          },
        ],
      },
    },
  });

  assert.ok(springBone);
  assert.equal(springBone.specVersion, '1.0');
  assert.equal(springBone.colliders.length, 2);
  assert.deepEqual(springBone.colliders[0].shape, {
    type: 'sphere',
    offset: [0.1, 0.2, 0.3],
    radius: 0.5,
  });
  assert.deepEqual(springBone.colliders[1].shape, {
    type: 'capsule',
    offset: [0, 0, 0],
    tail: [0, 0.5, 0],
    radius: 0.25,
  });
  assert.deepEqual(springBone.colliderGroups[0].colliders, [0, 1]);
  assert.equal(springBone.springs.length, 1);
  assert.equal(springBone.springs[0].centerBoneIndex, 0);
  assert.deepEqual(
    springBone.springs[0].joints.map((joint) => joint.boneIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    Array.from(springBone.springs[0].joints[0].gravityDir).map((value) => Number(value.toFixed(3))),
    [1, 0, 0],
  );
  assert.equal(springBone.sourceVersion, 'vrm1-springBone');
});

test('parseVrmSpringBone expands VRM 0.x secondaryAnimation roots into independent springs', () => {
  const model = createBranchingModel();
  const springBone = parseVrmSpringBone(model, {
    extensions: {
      VRM: {
        secondaryAnimation: {
          boneGroups: [
            {
              comment: 'hairGroup',
              stiffiness: 0.6,
              gravityPower: 0.4,
              gravityDir: { x: 0, y: -1, z: 0 },
              dragForce: 0.25,
              center: -1,
              hitRadius: 0.05,
              bones: [0, 2, 4],
              colliderGroups: [0],
            },
          ],
          colliderGroups: [
            {
              node: 5,
              colliders: [
                {
                  offset: { x: 0.1, y: 0.2, z: 0.3 },
                  radius: 0.4,
                },
              ],
            },
          ],
        },
      },
    },
  });

  assert.ok(springBone);
  assert.equal(springBone.sourceVersion, 'vrm0-secondaryAnimation');
  assert.equal(springBone.colliders.length, 1);
  assert.deepEqual(springBone.colliders[0].shape, {
    type: 'sphere',
    offset: [0.1, 0.2, 0.3],
    radius: 0.4,
  });
  assert.deepEqual(springBone.colliderGroups[0].colliders, [0]);
  assert.equal(springBone.springs.length, 3);
  assert.deepEqual(springBone.springs.map((spring) => spring.joints.map((joint) => joint.boneIndex)), [
    [0, 1],
    [2, 3],
    [4],
  ]);
  assert.equal(springBone.springs[2].joints[0].stiffness, 0.6);
  assert.equal(springBone.springs[2].joints[0].hitRadius, 0.05);
});

test('updateVrmSpringBone supports VRM 0.x childless roots through a virtual tail', () => {
  const model = createBranchingModel();
  model.vrm = {
    springBone: parseVrmSpringBone(model, {
      extensions: {
        VRM: {
          secondaryAnimation: {
            boneGroups: [
              {
                comment: 'leafRoot',
                stiffiness: 0,
                gravityPower: 1,
                gravityDir: { x: 1, y: 0, z: 0 },
                dragForce: 0,
                center: -1,
                hitRadius: 0.05,
                bones: [4],
                colliderGroups: [],
              },
            ],
            colliderGroups: [],
          },
        },
      },
    }),
  };

  const device = createDevice();
  const scene = createSceneState(device, model);
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  scene.modelManager = manager;

  manager.recomputeBoneMatrices(model, scene);
  resetVrmSpringBoneState(model, scene, scene.vrmSpringBoneState);
  const segment = scene.vrmSpringBoneState.springs[0].segments[0];
  const initialDistance = vecLength(subtractVec3(segment.currentTail, scene.boneWorldPositions[4]));

  updateVrmSpringBone(model, scene, manager, 30, 30);

  const finalDistance = vecLength(subtractVec3(segment.currentTail, scene.boneWorldPositions[4]));
  assert.equal(segment.hasVirtualTail, true);
  assert.ok(segment.currentTail[0] > 0.5, `expected virtual tail to swing toward +X, got ${segment.currentTail.join(', ')}`);
  assert.ok(Math.abs(finalDistance - initialDistance) < 1e-4, `expected virtual tail length to stay ${initialDistance}, got ${finalDistance}`);
});

test('updateVrmSpringBone rotates the head bone toward gravity while preserving tail length', () => {
  const model = createModel();
  model.vrm = {
    springBone: parseVrmSpringBone(model, {
      extensions: {
        VRMC_springBone: {
          specVersion: '1.0',
          colliders: [],
          colliderGroups: [],
          springs: [
            {
              joints: [
                {
                  node: 0,
                  hitRadius: 0,
                  stiffness: 0,
                  gravityPower: 1,
                  gravityDir: [1, 0, 0],
                  dragForce: 0,
                },
                {
                  node: 1,
                },
              ],
            },
          ],
        },
      },
    }),
  };

  const device = createDevice();
  const scene = createSceneState(device, model);
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  scene.modelManager = manager;

  manager.recomputeBoneMatrices(model, scene);
  resetVrmSpringBoneState(model, scene, scene.vrmSpringBoneState);
  updateVrmSpringBone(model, scene, manager, 30, 30);

  const childPosition = scene.boneWorldPositions[1];
  const childDistance = Math.hypot(childPosition[0], childPosition[1], childPosition[2]);
  assert.ok(childPosition[0] > 0.6, `expected child to swing toward +X, got ${childPosition.join(', ')}`);
  assert.ok(childPosition[1] < 0.8, `expected child Y to decrease after swing, got ${childPosition.join(', ')}`);
  assert.ok(Math.abs(childDistance - 1) < 1e-4, `expected tail length to stay 1, got ${childDistance}`);
});

function createDevice() {
  return {
    createBindGroupLayout() {
      return {};
    },
    createBuffer() {
      return createBuffer();
    },
    queue: {
      writeBuffer() {},
    },
  };
}

function createBuffer() {
  return {
    destroy() {},
  };
}

function createModel() {
  return {
    name: 'SpringModel',
    magic: 'Vrm',
    bones: [
      createBone('Root', -1, [0, 0, 0], 0, 0),
      createBone('Mid', 0, [0, 1, 0], 1, 1),
      createBone('Tip', 1, [0, 2, 0], 2, 2),
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(3),
  };
}

function createBranchingModel() {
  return {
    name: 'BranchingSpringModel',
    magic: 'Vrm',
    bones: [
      createBone('RootA', -1, [0, 0, 0], 0, 0),
      createBone('RootAChild', 0, [0, 1, 0], 1, 1),
      createBone('RootB', -1, [2, 0, 0], 0, 2),
      createBone('RootBChild', 2, [2, 1, 0], 1, 3),
      createBone('LeafRoot', 5, [0, 2, 0], 1, 4),
      createBone('ColliderHost', -1, [0, 0, 0], 0, 5),
    ],
    materials: [],
    rigidBodies: [],
    ik: [],
    customRigBones: [],
    boneReferencedByRigidBody: new Uint8Array(6),
  };
}

function createBone(name, parentIndex, position, transformLevel, gltfNodeIndex) {
  return {
    name,
    parentIndex,
    inheritParentIndex: -1,
    inheritInfluence: 0,
    flags: 0,
    position,
    localX: [1, 0, 0],
    localY: [0, 1, 0],
    localZ: [0, 0, 1],
    transformLevel,
    gltfNodeIndex,
  };
}

function subtractVec3(a, b) {
  return [
    (a?.[0] ?? 0) - (b?.[0] ?? 0),
    (a?.[1] ?? 0) - (b?.[1] ?? 0),
    (a?.[2] ?? 0) - (b?.[2] ?? 0),
  ];
}

function vecLength(value) {
  return Math.hypot(value[0], value[1], value[2]);
}
