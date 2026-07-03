import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  computeAutoClipPlanes,
  createCameraEye,
  createCameraState,
  createViewMatrix,
  createViewProjection,
} from '../source/core/scene/camera.js';
import { loadZipArchive } from '../source/infrastructure/io/file-loading.js';
import { loadModelData } from '../source/core/model/model-scene.js';
import { createGridOverlayPipeline, createGridOverlayPostPipeline, createUiOverlayPipeline, drawUiOverlay, getBoneDebugLists, readGridNumberValue, updateGridBuffer, updatePhysicsWireframe } from '../source/ui/ui-overlay.js';
import { getCustomRigCircleTargets } from '../source/core/model/custom-rig.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { createAabb, expandAabbWithPoint, getAabbCorners, transformPoint, unionAabb } from '../source/shared/math/math-utils.js';
import { isPointInProjectedAABB, projectDistanceToPointer } from '../source/application/interaction/renderer-interaction.js';
import { resolveDefaultSelectedBoneIndex } from '../source/core/selection/renderer-selection.js';
import { createSsssResources } from '../source/infrastructure/gpu/renderer-gpu.js';

test('createCameraState returns deterministic default camera', () => {
  const camera = createCameraState(2);
  assert.deepEqual(camera.center, [0, 2, 0]);
  assert.equal(camera.distance, 3.04138126514911 * 2);
  assert.equal(camera.fovY, Math.PI / 4);
});

test('createCameraEye projects camera orbit state into world position', () => {
  const camera = {
    center: [1, 2, 3],
    distance: 10,
    phi: 0,
    theta: Math.PI / 2,
  };
  const eye = createCameraEye(camera);
  assert.ok(Math.abs(eye[0] - 11) < 1e-6);
  assert.ok(Math.abs(eye[1] - 2) < 1e-6);
  assert.ok(Math.abs(eye[2] - 3) < 1e-6);
});

test('readGridNumberValue preserves UI values above the previous internal clamp', () => {
  const rangeInput = { value: '7.5' };
  const valueInput = { value: '7.5' };

  assert.equal(readGridNumberValue(rangeInput, valueInput, 0.5, 0.1), 7.5);
  assert.equal(readGridNumberValue(rangeInput, valueInput, 0.5, 0.1, true), 8);
});

test('createViewProjection respects camera.fovY', () => {
  const canvas = { width: 100, height: 100 };
  const narrow = createViewProjection(canvas, {
    center: [0, 0, 0],
    distance: 1,
    phi: 0,
    theta: 0,
    fovY: 30 * Math.PI / 180,
  });
  const wide = createViewProjection(canvas, {
    center: [0, 0, 0],
    distance: 1,
    phi: 0,
    theta: 0,
    fovY: 90 * Math.PI / 180,
  });
  assert.ok(narrow[0] > wide[0]);
  assert.ok(narrow[5] > wide[5]);
});

test('computeAutoClipPlanes derives clip planes from scene bounds', () => {
  const camera = {
    center: [0, 10, 0],
    distance: Math.sqrt(925),
    phi: 0,
    theta: 0,
  };
  const sceneBounds = {
    min: [-4, 0, -4],
    max: [4, 20, 4],
  };

  const clipPlanes = computeAutoClipPlanes(camera, sceneBounds);
  assert.ok(clipPlanes.near > 0.2);
  assert.ok(clipPlanes.near <= 0.5);
  assert.ok(clipPlanes.far > 30.0);
  assert.ok(clipPlanes.far > clipPlanes.near);
});

test('computeAutoClipPlanes stays permissive for close-up MMD-scale shots', () => {
  const camera = {
    center: [0, 16, 0],
    distance: 12,
    phi: 0,
    theta: 0,
  };
  const sceneBounds = {
    min: [-1, 13, -1],
    max: [1, 18, 1],
  };

  const clipPlanes = computeAutoClipPlanes(camera, sceneBounds);
  assert.ok(clipPlanes.near <= 0.5);
  assert.ok(clipPlanes.near >= 0.05);
  assert.ok(clipPlanes.far > 10.0);
});

test('computeAutoClipPlanes falls back when scene bounds are missing', () => {
  const clipPlanes = computeAutoClipPlanes({
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
  }, null);

  assert.equal(clipPlanes.near, 0.1);
  assert.equal(clipPlanes.far, 1000);
});

test('projectDistanceToPointer returns zero for projected center hit', () => {
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  assert.equal(projectDistanceToPointer(mvp, [0, 0, 0], event, rect), 0);
});

test('isPointInProjectedAABB detects projected hit area', () => {
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const aabb = { min: [-0.2, -0.2, 0], max: [0.2, 0.2, 0.2] };
  assert.equal(isPointInProjectedAABB({ clientX: 50, clientY: 50 }, rect, mvp, aabb), true);
  assert.equal(isPointInProjectedAABB({ clientX: 95, clientY: 95 }, rect, mvp, aabb), false);
});

test('getBoneDebugLists builds cached hidden bone categories', () => {
  const model = {
    bones: [
      { name: 'hidden', flags: 0 },
      { name: 'physics', flags: 0x8 },
      { name: 'custom', flags: 0x8 },
      { name: 'spring', flags: 0x8 },
    ],
    rigidBodies: [],
    customRigBones: ['custom'],
    boneReferencedByRigidBody: new Uint8Array([0, 1, 0]),
    vrm: {
      springBone: {
        colliders: [
          { boneIndex: 3 },
        ],
        springs: [
          {
            joints: [
              { boneIndex: 2 },
              { boneIndex: 3 },
            ],
          },
        ],
      },
    },
  };

  const lists = getBoneDebugLists(model, null);
  assert.deepEqual(lists.nonVisibleBoneIndices, [0]);
  assert.deepEqual(lists.physicsReferencedBoneIndices, [1]);
  assert.deepEqual(lists.springBoneBoneIndices, [3, 2]);
  assert.deepEqual(lists.customRigBoneIndices, [2]);
  assert.equal(lists.hiddenBoneIndexSet.has(0), true);
  assert.equal(lists.hiddenBoneIndexSet.has(1), true);
  assert.equal(lists.hiddenBoneIndexSet.has(2), true);
  assert.equal(lists.springBoneBoneIndexSet.has(2), true);
  assert.equal(lists.springBoneBoneIndexSet.has(3), true);
});

test('getBoneDebugLists excludes humanoid springbone bones from the hide set', () => {
  const model = {
    magic: 'Vrm',
    bones: [
      { name: 'hips', flags: 0x8 },
      { name: 'spring', flags: 0x8 },
      { name: 'tail', flags: 0x8 },
    ],
    rigidBodies: [],
    boneReferencedByRigidBody: new Uint8Array([0, 0, 0]),
    vrm: {
      humanoidBoneNameMap: {
        hips: 'hips',
      },
      springBone: {
        colliders: [
          { boneIndex: 1 },
        ],
        springs: [
          {
            joints: [
              { boneIndex: 0 },
              { boneIndex: 2 },
            ],
          },
        ],
      },
    },
  };

  const lists = getBoneDebugLists(model, null);
  assert.equal(lists.springBoneBoneIndexSet.has(0), false);
  assert.equal(lists.springBoneBoneIndexSet.has(1), true);
  assert.equal(lists.springBoneBoneIndexSet.has(2), true);
  assert.deepEqual(lists.springBoneBoneIndices, [1, 2]);
});

test('getCustomRigCircleTargets reuses cached custom rig bone indices', () => {
  const model = {
    bones: [
      { name: '全ての親', flags: 0x8 },
      { name: 'unused', flags: 0x8 },
    ],
    rigidBodies: [],
    customRigBones: ['全ての親'],
    boneReferencedByRigidBody: new Uint8Array([0, 0]),
  };
  const scene = {
    boneWorldPositions: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    boneDebugLists: getBoneDebugLists(model, null),
  };

  const targets = getCustomRigCircleTargets({ model, scene });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].boneIndex, 0);
  assert.deepEqual(targets[0].center, [1, 2, 3]);
});

test('resolveDefaultSelectedBoneIndex prefers the dummy bone marker', () => {
  assert.equal(resolveDefaultSelectedBoneIndex({ bones: [{ name: 'Root' }], hasDummyBone: true, dummyBoneIndex: 0 }), 0);
  assert.equal(resolveDefaultSelectedBoneIndex({ bones: [{ name: 'Root' }], hasDummyBone: false, dummyBoneIndex: 0 }), -1);
  assert.equal(resolveDefaultSelectedBoneIndex({ bones: [], hasDummyBone: true, dummyBoneIndex: 0 }), -1);
});

test('drawUiOverlay renders overlay layers in a stable order', () => {
  const calls = [];
  const pass = {
    setVertexBuffer(slot, buffer) {
      calls.push(['setVertexBuffer', slot, buffer.name]);
    },
    draw(count) {
      calls.push(['draw', count]);
    },
  };
  const instance = {
    scene: {
      uiOverlay: {
        boneLineVertexBuffer: { name: 'boneLine' },
        boneLineVertexCount: 2,
        boneAxisVertexBuffer: { name: 'boneAxis' },
        boneAxisVertexCount: 3,
        indicatorVertexBuffer: { name: 'indicator' },
        indicatorVertexCount: 3,
        gizmoVertexBuffer: { name: 'gizmo' },
        gizmoVertexCount: 4,
        physicsWireframeVertexBuffer: { name: 'physics' },
        physicsWireframeVertexCount: 5,
      },
    },
  };
  const selection = {
    showBones: true,
    showPhysics: true,
  };

  drawUiOverlay(pass, instance, selection);

  assert.deepEqual(calls, [
    ['setVertexBuffer', 0, 'boneLine'],
    ['draw', 2],
    ['setVertexBuffer', 0, 'indicator'],
    ['draw', 3],
    ['setVertexBuffer', 0, 'gizmo'],
    ['draw', 4],
    ['setVertexBuffer', 0, 'physics'],
    ['draw', 5],
  ]);
});

test('drawUiOverlay renders bone axes independently of bone visibility', () => {
  const calls = [];
  const pass = {
    setVertexBuffer(slot, buffer) {
      calls.push(['setVertexBuffer', slot, buffer.name]);
    },
    draw(count) {
      calls.push(['draw', count]);
    },
  };
  const instance = {
    scene: {
      uiOverlay: {
        boneLineVertexBuffer: { name: 'boneLine' },
        boneLineVertexCount: 2,
        boneAxisVertexBuffer: { name: 'boneAxis' },
        boneAxisVertexCount: 3,
        indicatorVertexBuffer: { name: 'indicator' },
        indicatorVertexCount: 3,
        gizmoVertexBuffer: { name: 'gizmo' },
        gizmoVertexCount: 4,
        physicsWireframeVertexBuffer: { name: 'physics' },
        physicsWireframeVertexCount: 5,
      },
    },
  };
  const selection = {
    showBones: false,
    showBoneAxes: true,
    showPhysics: false,
  };

  drawUiOverlay(pass, instance, selection);

  assert.deepEqual(calls, [
    ['setVertexBuffer', 0, 'boneAxis'],
    ['draw', 3],
  ]);
});

test('updatePhysicsWireframe converts ammo-space positions back to model space', () => {
  const writtenBuffers = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writtenBuffers.push({ buffer, offset, data: Array.from(data) });
      },
    },
  };
  const identityRotation = {
    x: () => 0,
    y: () => 0,
    z: () => 0,
    w: () => 1,
  };
  const ammoTransform = {
    origin: {
      x: () => 10,
      y: () => 0,
      z: () => 0,
    },
    rotation: identityRotation,
    getOrigin() {
      return this.origin;
    },
    getRotation() {
      return this.rotation;
    },
    setOrigin(origin) {
      this.origin = origin;
    },
    setRotation(rotation) {
      this.rotation = rotation;
    },
  };
  class FakeBtTransform {
    constructor() {
      this.origin = ammoTransform.origin;
      this.rotation = ammoTransform.rotation;
    }
    getOrigin() {
      return this.origin;
    }
    getRotation() {
      return this.rotation;
    }
    setOrigin(origin) {
      this.origin = origin;
    }
    setRotation(rotation) {
      this.rotation = rotation;
    }
  }
  const motionState = {
    getWorldTransform(transform) {
      transform.setOrigin(ammoTransform.origin);
      transform.setRotation(ammoTransform.rotation);
    },
  };
  const body = {
    ammoBody: {
      getMotionState() {
        return motionState;
      },
    },
    rbData: {
      physicsMode: 1,
      shape: 0,
      size: [0.5, 0.5, 0.5],
    },
    capsuleAxis: 'y',
  };
  const instance = {
    model: {},
    scene: {
      uiOverlay: {
        physicsWireframeVertexBuffer: { size: 1024 * 1024, destroy() {} },
        physicsWireframeVertexCount: 0,
      },
    },
  };
  const physicsEngine = {
    Ammo: {
      btTransform: FakeBtTransform,
      destroy() {},
    },
    models: [
      {
        model: instance.model,
        bodies: [body],
      },
    ],
  };
  const selection = {
    showPhysics: true,
  };

  updatePhysicsWireframe(device, instance, physicsEngine, selection);

  assert.equal(writtenBuffers.length, 1);
  assert.equal(writtenBuffers[0].buffer, instance.scene.uiOverlay.physicsWireframeVertexBuffer);
  assert.equal(writtenBuffers[0].offset, 0);
  assert.ok(Math.abs(writtenBuffers[0].data[0] - 1.5) < 1e-6);
  assert.ok(Math.abs(writtenBuffers[0].data[1]) < 1e-6);
  assert.ok(Math.abs(writtenBuffers[0].data[2]) < 1e-6);
});

test('updatePhysicsWireframe renders VRM SpringBone colliders even without Ammo bodies', () => {
  const writtenBuffers = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writtenBuffers.push({ buffer, offset, data: Array.from(data) });
      },
    },
  };
  const instance = {
    model: {},
    scene: {
      boneLocalTransforms: [
        {
          worldMatrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
        },
      ],
      vrmSpringBoneState: {
        colliders: [
          {
            boneIndex: 0,
            shape: 'sphere',
            offset: [0, 0, 0],
            radius: 1,
          },
        ],
      },
      uiOverlay: {
        physicsWireframeVertexBuffer: { size: 1024 * 1024, destroy() {} },
        physicsWireframeVertexCount: 0,
      },
    },
  };
  const physicsEngine = {
    Ammo: {
      btTransform: class {
        getOrigin() {
          return { x: () => 0, y: () => 0, z: () => 0 };
        }
        getRotation() {
          return { x: () => 0, y: () => 0, z: () => 0, w: () => 1 };
        }
      },
      destroy() {},
    },
    models: [],
  };
  const selection = {
    showPhysics: true,
  };

  updatePhysicsWireframe(device, instance, physicsEngine, selection);

  assert.equal(writtenBuffers.length, 1);
  assert.equal(writtenBuffers[0].buffer, instance.scene.uiOverlay.physicsWireframeVertexBuffer);
  assert.ok(Math.abs(writtenBuffers[0].data[0] - 1) < 1e-6);
});

test('updatePhysicsWireframe renders VRM SpringBone capsule colliders', () => {
  const writtenBuffers = [];
  const device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writtenBuffers.push({ buffer, offset, data: Array.from(data) });
      },
    },
  };
  const instance = {
    model: {},
    scene: {
      boneLocalTransforms: [
        {
          worldMatrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
        },
      ],
      vrmSpringBoneState: {
        colliders: [
          {
            boneIndex: 0,
            shape: 'capsule',
            offset: [0, 0, 0],
            tail: [0, 2, 0],
            radius: 0.5,
          },
        ],
      },
      uiOverlay: {
        physicsWireframeVertexBuffer: { size: 1024 * 1024, destroy() {} },
        physicsWireframeVertexCount: 0,
      },
    },
  };
  const physicsEngine = {
    Ammo: {
      btTransform: class {
        getOrigin() {
          return { x: () => 0, y: () => 0, z: () => 0 };
        }
        getRotation() {
          return { x: () => 0, y: () => 0, z: () => 0, w: () => 1 };
        }
      },
      destroy() {},
    },
    models: [],
  };
  const selection = {
    showPhysics: true,
  };

  updatePhysicsWireframe(device, instance, physicsEngine, selection);

  assert.equal(writtenBuffers.length, 1);
  assert.equal(writtenBuffers[0].buffer, instance.scene.uiOverlay.physicsWireframeVertexBuffer);
  assert.ok(Math.abs(writtenBuffers[0].data[0] - 0.5) < 1e-6);
});

test('createUiOverlayPipeline uses 4x MSAA for post-process UI overlay', () => {
  const descriptors = [];
  const manager = {
    device: {
      createPipelineLayout({ bindGroupLayouts }) {
        return { bindGroupLayouts };
      },
      createRenderPipeline(descriptor) {
        descriptors.push(descriptor);
        return { name: 'uiOverlayPipeline' };
      },
    },
    globalResources: {
      globalBindGroupLayout: { name: 'globalBindGroupLayout' },
    },
    shaderModule: { name: 'shaderModule' },
    presentationFormat: 'rgba8unorm',
    msaaSampleCount: 4,
  };

  const pipeline = createUiOverlayPipeline(manager);

  assert.equal(pipeline.name, 'uiOverlayPipeline');
  assert.equal(descriptors[0].multisample.count, 4);
});

test('createGridOverlayPipeline uses a single color target that matches the overlay pass', () => {
  const descriptors = [];
  const manager = {
    device: {
      createPipelineLayout({ bindGroupLayouts }) {
        return { bindGroupLayouts };
      },
      createRenderPipeline(descriptor) {
        descriptors.push(descriptor);
        return { name: 'gridOverlayPipeline' };
      },
    },
    globalResources: {
      globalBindGroupLayout: { name: 'globalBindGroupLayout' },
    },
    shaderModule: { name: 'shaderModule' },
    msaaSampleCount: 4,
  };

  const pipeline = createGridOverlayPipeline(manager);

  assert.equal(pipeline.name, 'gridOverlayPipeline');
  assert.equal(descriptors[0].fragment.entryPoint, 'fs_bone');
  assert.equal(descriptors[0].fragment.targets.length, 1);
  assert.equal(descriptors[0].fragment.targets[0].format, 'rgba16float');
  assert.equal(descriptors[0].multisample.count, 4);
  assert.equal('depthStencil' in descriptors[0], false);
});

test('createGridOverlayPostPipeline uses 4x MSAA for post-process grid overlay', () => {
  const descriptors = [];
  const previousShaderStage = globalThis.GPUShaderStage;
  globalThis.GPUShaderStage = { FRAGMENT: 1 };
  const manager = {
    device: {
      createPipelineLayout({ bindGroupLayouts }) {
        return { bindGroupLayouts };
      },
      createRenderPipeline(descriptor) {
        descriptors.push(descriptor);
        return { name: 'gridOverlayPostPipeline' };
      },
      createBindGroupLayout({ entries }) {
        return { entries };
      },
    },
    globalResources: {
      globalBindGroupLayout: { name: 'globalBindGroupLayout' },
    },
    shaderModule: { name: 'shaderModule' },
    presentationFormat: 'rgba8unorm',
    msaaSampleCount: 4,
  };

  try {
    const pipeline = createGridOverlayPostPipeline(manager);
    assert.equal(pipeline.name, 'gridOverlayPostPipeline');
    assert.equal(descriptors[0].multisample.count, 4);
  } finally {
    globalThis.GPUShaderStage = previousShaderStage;
  }
});

test('createGridOverlayPostPipeline can sample single-sampled depth for FXAA mode', () => {
  const descriptors = [];
  const previousShaderStage = globalThis.GPUShaderStage;
  globalThis.GPUShaderStage = { FRAGMENT: 1 };
  const manager = {
    device: {
      createPipelineLayout({ bindGroupLayouts }) {
        return { bindGroupLayouts };
      },
      createRenderPipeline(descriptor) {
        descriptors.push(descriptor);
        return { name: 'gridOverlayPostSinglePipeline' };
      },
      createBindGroupLayout({ entries }) {
        return { entries };
      },
    },
    globalResources: {
      globalBindGroupLayout: { name: 'globalBindGroupLayout' },
    },
    shaderModule: { name: 'shaderModule' },
    presentationFormat: 'rgba8unorm',
    msaaSampleCount: 4,
  };

  try {
    const pipeline = createGridOverlayPostPipeline(manager, false);
    assert.equal(pipeline.name, 'gridOverlayPostSinglePipeline');
    assert.equal(descriptors[0].fragment.entryPoint, 'fs_grid_post_single');
    assert.equal(descriptors[0].multisample.count, 4);
    assert.equal(descriptors[0].layout.bindGroupLayouts.length, 4);
    assert.equal(descriptors[0].layout.bindGroupLayouts[3].entries[0].texture.multisampled, false);
  } finally {
    globalThis.GPUShaderStage = previousShaderStage;
  }
});

test('createSsssResources exposes a depth-aware mask resolve pipeline', () => {
  const descriptors = [];
  const bindGroups = [];
  const previousShaderStage = globalThis.GPUShaderStage;
  const previousBufferUsage = globalThis.GPUBufferUsage;
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2 };
  globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
  try {
    const manager = {
      createBuffer(desc) {
        return { desc };
      },
      createBindGroupLayout({ entries }) {
        return { entries };
      },
      createPipelineLayout({ bindGroupLayouts }) {
        return { bindGroupLayouts };
      },
      createRenderPipeline(descriptor) {
        descriptors.push(descriptor);
        return {
          descriptor,
          getBindGroupLayout(index) {
            return descriptor.layout.bindGroupLayouts[index];
          },
        };
      },
      createBindGroup({ layout, entries }) {
        const bindGroup = { layout, entries };
        bindGroups.push(bindGroup);
        return bindGroup;
      },
      queue: {
        writeBuffer() {},
      },
    };
    const resources = createSsssResources(
      manager,
      { name: 'sssShaderModule' },
      { name: 'sssMaskShaderModule' },
      'rgba8unorm',
      { name: 'postEffectGlobalBindGroupLayout' },
    );

    assert.equal(resources.sssMaskResolvePipeline.descriptor.fragment.entryPoint, 'fs_sss_mask_resolve');
    assert.equal(resources.sssMaskFilterPipeline.descriptor.fragment.entryPoint, 'fs_sss_mask_filter');
    assert.equal(resources.sssMaskResolvePipeline.descriptor.fragment.targets[0].format, 'rgba32float');
    assert.equal(resources.sssMaskFilterPipeline.descriptor.fragment.targets[0].format, 'rgba32float');

    const resolveBindGroup = resources.createSsssMaskResolveBindGroup(
      manager,
      { name: 'maskView' },
      { name: 'depthView' },
    );
    const filterBindGroup = resources.createSsssMaskFilterBindGroup(
      manager,
      { name: 'maskView' },
      { name: 'depthView' },
    );

    assert.ok(bindGroups.length > 0);
    assert.deepEqual(resolveBindGroup.entries, [
      { binding: 0, resource: { buffer: resources.sssSettingsBuffer } },
      { binding: 1, resource: { name: 'maskView' } },
      { binding: 2, resource: { name: 'depthView' } },
    ]);
    assert.deepEqual(filterBindGroup.entries, [
      { binding: 0, resource: { buffer: resources.sssSettingsBuffer } },
      { binding: 1, resource: { name: 'maskView' } },
      { binding: 2, resource: { name: 'depthView' } },
    ]);
    assert.ok(descriptors.some((descriptor) => descriptor.fragment?.entryPoint === 'fs_sss_mask_resolve'));
    assert.ok(descriptors.some((descriptor) => descriptor.fragment?.entryPoint === 'fs_sss_mask_filter'));
  } finally {
    globalThis.GPUShaderStage = previousShaderStage;
    globalThis.GPUBufferUsage = previousBufferUsage;
  }
});

test('SSS mask MRT does not use channel-wise blend accumulation', async () => {
  const pipelineSource = await fs.readFile(new URL('../source/infrastructure/gpu/model-manager-pipelines.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pipelineSource, /format: 'rgba16float',\s*\n\s*blend:/);
});

test('SSS render loop updates clip planes before the mask pass uses the uniform buffer', async () => {
  const renderLoopSource = await fs.readFile(new URL('../source/infrastructure/gpu/render-loop.js', import.meta.url), 'utf8');
  const nearFarWriteIndex = renderLoopSource.indexOf('ssssResources.sssSettingsData[5] = clipPlanes.near;');
  const maskPassIndex = renderLoopSource.indexOf('const sssMaskPass = encoder.beginRenderPass({');
  assert.notEqual(nearFarWriteIndex, -1);
  assert.notEqual(maskPassIndex, -1);
  assert.ok(nearFarWriteIndex < maskPassIndex);
});

test('SSS render loop resolves the scene mask when BloomShadow debug is enabled', async () => {
  const renderLoopSource = await fs.readFile(new URL('../source/infrastructure/gpu/render-loop.js', import.meta.url), 'utf8');
  assert.match(
    renderLoopSource,
    /const needsResolvedSceneMask = useSsss \|\| useBloom \|\| Boolean\(state\.showBloomShadowDebug\);/,
  );
});

test('Bloom keeps depth when grid is hidden so shadow multiplier can resolve the scene mask', async () => {
  const renderLoopSource = await fs.readFile(new URL('../source/infrastructure/gpu/render-loop.js', import.meta.url), 'utf8');
  assert.match(
    renderLoopSource,
    /const depthStoreOp = \(postEffectPlan\.needsDepthSampling \|\| needsGridDepth \|\| needsResolvedSceneMask\)\s*\?\s*'store'\s*:\s*'discard';/,
  );
});

test('render loop no longer writes bloom shadow debug mode into shadowPowerParams.w', async () => {
  const renderLoopSource = await fs.readFile(new URL('../source/infrastructure/gpu/render-loop.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    renderLoopSource,
    /globalResources\.uniformData\[GLOBAL_UNIFORM_OFFSETS\.shadowPowerParams \+ 3\]/,
  );
  assert.doesNotMatch(
    renderLoopSource,
    /globalResources\.edgeUniformData\[GLOBAL_UNIFORM_OFFSETS\.shadowPowerParams \+ 3\]/,
  );
});

test('SSS MSAA blur decodes sampled depth before averaging neighbor depth', async () => {
  const sssShaderSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/post-effect/sss.wgsl', import.meta.url), 'utf8');
  const msaaFunctionStart = sssShaderSource.indexOf('fn blur_pixel_msaa(');
  const msaaFunctionEnd = sssShaderSource.indexOf('@fragment\nfn fs_sss_blur(', msaaFunctionStart);
  const msaaFunctionSource = sssShaderSource.slice(msaaFunctionStart, msaaFunctionEnd);
  assert.match(msaaFunctionSource, /sampleDepth \+= decode_view_depth\(/);
});

test('SSS raw mask stores normalized view depth and bloom shadow factor', async () => {
  const mmdShaderSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/custom-shaders/mmd-shader.wgsl', import.meta.url), 'utf8');
  assert.match(mmdShaderSource, /out\.mask = vec4<f32>\(material_skin_mask\(\), encode_contact_shadow_depth\(-in\.viewPos\.z\), bloomShadowFactor, 1\.0\);/);
});

test('SSS mask resolve compares normalized view depth and keeps the frontmost sample', async () => {
  const sssMaskShaderSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/post-effect/sss-mask.wgsl', import.meta.url), 'utf8');
  assert.match(sssMaskShaderSource, /fn decode_device_depth\(encodedDepth: f32, nearPlane: f32, farPlane: f32\) -> f32/);
  assert.match(sssMaskShaderSource, /fn encode_mask_view_depth\(viewDepth: f32, nearPlane: f32, farPlane: f32\) -> f32/);
  assert.match(sssMaskShaderSource, /let matchesDepth = abs\(maskSample\.g - encodedSceneDepth\) <= depth_epsilon\(threshold\);/);
  assert.match(sssMaskShaderSource, /let encodedMinDepth = encode_mask_view_depth\(minDepth, nearPlane, farPlane\);/);
  assert.match(sssMaskShaderSource, /let isFrontmost = maskSample\.g <= encodedMinDepth \+ epsilon;/);
  assert.match(sssMaskShaderSource, /fn keep_single_sample\(maskSample: vec4<f32>, encodedSceneDepth: f32, threshold: f32\) -> vec4<f32>/);
  assert.match(sssMaskShaderSource, /if \(maskSample\.a < 0\.5\) \{\s*return vec4<f32>\(0\.0\);\s*\}/);
  assert.match(sssMaskShaderSource, /if \(maskSample\.a < 0\.5\) \{\s*continue;\s*\}/);
  assert.match(sssMaskShaderSource, /return select\(vec4<f32>\(0\.0\), maskSample, matchesDepth\);/);
  assert.match(sssMaskShaderSource, /fn resolve_visible_mask_msaa\(coord: vec2<i32>\) -> vec4<f32>/);
  assert.match(sssMaskShaderSource, /return maskSample;/);
  assert.match(sssMaskShaderSource, /return filteredMask;/);
  assert.match(sssMaskShaderSource, /return resolvedMask;/);
  assert.doesNotMatch(sssMaskShaderSource, /vec4<f32>\(filteredMask, filteredMask, filteredMask, 1\.0\)/);
  assert.doesNotMatch(sssMaskShaderSource, /visibleMask \+= maskSample\.r/);
  assert.doesNotMatch(sssMaskShaderSource, /maskSample\.r <= 0\.0/);
});

test('grid overlay uses its own uniform thickness and does not reuse boneThickness', async () => {
  const shaderSource = await fs.readFile(new URL('../source/infrastructure/gpu/shaders/shaders.wgsl', import.meta.url), 'utf8');
  const gridVertexStart = shaderSource.indexOf('fn vs_grid(');
  const gridFragmentStart = shaderSource.indexOf('@fragment\nfn fs_bone(', gridVertexStart);
  const gridVertexSource = shaderSource.slice(gridVertexStart, gridFragmentStart);

  assert.doesNotMatch(gridVertexSource, /uniforms\.shadowInfo\.z/);
  assert.match(gridVertexSource, /let thickness = max\(0\.0, uniforms\.shadowPowerParams\.z\);/);
});

test('updateGridBuffer builds the expected floor grid and axes', () => {
  const writes = [];
  const destroyed = [];
  const device = {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {
          destroyed.push(desc.size);
        },
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data: Array.from(data) });
      },
    },
  };
  const gridOverlay = {
    gridVertexBuffer: device.createBuffer({ size: 1024 * 1024 }),
    gridVertexCount: 0,
    size: 7.5,
    count: 10,
  };
  const baseSelection = {
    showGridXZ: true,
    showGridXY: false,
    showGridYZ: false,
    gridSize: 7.5,
    gridCount: 10,
  };

  updateGridBuffer(device, gridOverlay, baseSelection);

  assert.equal(gridOverlay.gridVertexCount, 5160);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.slice(0, 10), [-75, 0, -75, 0, 0, 0, -67.5, 0, -75, -1]);

  writes.length = 0;
  const denserSelection = {
    ...baseSelection,
    gridCount: 20,
  };
  gridOverlay.count = denserSelection.gridCount;

  updateGridBuffer(device, gridOverlay, denserSelection);

  assert.equal(gridOverlay.gridVertexCount, 19920);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.slice(0, 10), [-150, 0, -150, 0, 0, 0, -142.5, 0, -150, -1]);

  writes.length = 0;
  const meterSelection = {
    ...baseSelection,
    gridSize: 1,
    gridCount: 10,
  };
  gridOverlay.size = meterSelection.gridSize;
  gridOverlay.count = meterSelection.gridCount;

  updateGridBuffer(device, gridOverlay, meterSelection);

  assert.equal(gridOverlay.gridVertexCount, 5160);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.slice(0, 10), [-10, 0, -10, 0, 0, 0, -9, 0, -10, -1]);

  writes.length = 0;
  const allPlanesSelection = {
    ...baseSelection,
    showGridXY: true,
    showGridYZ: true,
  };
  gridOverlay.size = baseSelection.gridSize;
  gridOverlay.count = baseSelection.gridCount;

  updateGridBuffer(device, gridOverlay, allPlanesSelection);

  assert.equal(gridOverlay.gridVertexCount, 15300);
  assert.equal(writes.length, 1);
  assert.equal(destroyed.length, 0);
});

test('ModelManager.drawGridOverlay renders the grid with the dedicated pipeline', () => {
  const calls = [];
  const pass = {
    setPipeline(pipeline) {
      calls.push(['setPipeline', pipeline.name]);
    },
    setBindGroup(slot, group) {
      calls.push(['setBindGroup', slot, group.name]);
    },
    setVertexBuffer(slot, buffer) {
      calls.push(['setVertexBuffer', slot, buffer.name]);
    },
    draw(count) {
      calls.push(['draw', count]);
    },
  };
  const manager = {
    gridOverlayPipeline: { name: 'gridPipeline' },
    msaaSampleCount: 4,
    globalResources: { globalBindGroup: { name: 'globalBindGroup' } },
    gridOverlay: {
      gridVertexBuffer: { name: 'gridBuffer' },
      gridVertexCount: 2,
    },
  };

  ModelManager.prototype.drawGridOverlay.call(manager, pass);

  assert.deepEqual(calls, [
    ['setPipeline', 'gridPipeline'],
    ['setBindGroup', 0, 'globalBindGroup'],
    ['setVertexBuffer', 0, 'gridBuffer'],
    ['draw', 2],
  ]);
});

test('ModelManager.drawGridOverlay can render after post effects with sampled depth', () => {
  const calls = [];
  const pass = {
    setPipeline(pipeline) {
      calls.push(['setPipeline', pipeline.name]);
    },
    setBindGroup(slot, group) {
      calls.push(['setBindGroup', slot, group.name]);
    },
    setVertexBuffer(slot, buffer) {
      calls.push(['setVertexBuffer', slot, buffer.name]);
    },
    draw(count) {
      calls.push(['draw', count]);
    },
  };
  const manager = {
    device: {
      createBindGroup({ layout, entries }) {
        calls.push(['createBindGroup', layout.name, entries[0].resource.name]);
        return { name: 'depthBindGroup' };
      },
    },
    gridOverlayPostPipeline: {
      name: 'gridPostPipeline',
      getBindGroupLayout(index) {
        return { name: `layout${index}` };
      },
    },
    gridOverlayPostSinglePipeline: {
      name: 'gridPostSinglePipeline',
      getBindGroupLayout(index) {
        return { name: `layout${index}` };
      },
    },
    msaaSampleCount: 4,
    globalResources: { globalBindGroup: { name: 'globalBindGroup' } },
    gridOverlay: {
      gridVertexBuffer: { name: 'gridBuffer' },
      gridVertexCount: 2,
    },
  };

  ModelManager.prototype.drawGridOverlay.call(manager, pass, { name: 'depthView' }, true);

  assert.deepEqual(calls, [
    ['setPipeline', 'gridPostPipeline'],
    ['setBindGroup', 0, 'globalBindGroup'],
    ['createBindGroup', 'layout1', 'depthView'],
    ['setBindGroup', 1, 'depthBindGroup'],
    ['setVertexBuffer', 0, 'gridBuffer'],
    ['draw', 2],
  ]);
});

test('ModelManager.drawGridOverlay can render FXAA mode with single-sampled depth', () => {
  const calls = [];
  const pass = {
    setPipeline(pipeline) {
      calls.push(['setPipeline', pipeline.name]);
    },
    setBindGroup(slot, group) {
      calls.push(['setBindGroup', slot, group.name]);
    },
    setVertexBuffer(slot, buffer) {
      calls.push(['setVertexBuffer', slot, buffer.name]);
    },
    draw(count) {
      calls.push(['draw', count]);
    },
  };
  const manager = {
    device: {
      createBindGroup({ layout, entries }) {
        calls.push(['createBindGroup', layout.name, entries[0].resource.name]);
        return { name: 'depthBindGroup' };
      },
    },
    gridOverlayPostPipeline: {
      name: 'gridPostPipeline',
      getBindGroupLayout(index) {
        return { name: `layout${index}` };
      },
    },
    gridOverlayPostSinglePipeline: {
      name: 'gridPostSinglePipeline',
      getBindGroupLayout(index) {
        return { name: `layout${index}` };
      },
    },
    msaaSampleCount: 4,
    globalResources: { globalBindGroup: { name: 'globalBindGroup' } },
    gridOverlay: {
      gridVertexBuffer: { name: 'gridBuffer' },
      gridVertexCount: 2,
    },
  };

  ModelManager.prototype.drawGridOverlay.call(manager, pass, { name: 'depthView' }, false);

  assert.deepEqual(calls, [
    ['setPipeline', 'gridPostSinglePipeline'],
    ['setBindGroup', 0, 'globalBindGroup'],
    ['createBindGroup', 'layout3', 'depthView'],
    ['setBindGroup', 3, 'depthBindGroup'],
    ['setVertexBuffer', 0, 'gridBuffer'],
    ['draw', 2],
  ]);
});

test('grid vertices stay inside the grid frustum when the camera frames the grid', () => {
  const camera = createCameraState(2);
  camera.center = [0, 0, 0];
  camera.distance = 220;
  camera.phi = 0;
  camera.theta = 0;
  camera.fovY = Math.PI / 4;
  camera.clipPlanes = {
    near: 0.1,
    far: 1000,
  };

  const canvas = { width: 1920, height: 1080 };
  const selection = {
    showGridXZ: true,
    showGridXY: true,
    showGridYZ: true,
    gridSize: 5,
    gridCount: 10,
  };

  const writes = [];
  const device = {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push(Array.from(data));
      },
    },
  };
  const gridOverlay = {
    gridVertexBuffer: device.createBuffer({ size: 1024 * 1024 }),
    gridVertexCount: 0,
    size: selection.gridSize,
    count: selection.gridCount,
  };

  updateGridBuffer(device, gridOverlay, selection);

  const gridClipPlanes = computeGridClipPlanesForTest(camera, selection);
  const gridViewProjection = createViewProjection(canvas, camera, gridClipPlanes);

  assert.ok(gridOverlay.gridVertexCount > 0);
  assert.equal(writes.length, 1);

  for (let index = 0; index < writes[0].length; index += 10) {
    const position = [writes[0][index + 0], writes[0][index + 1], writes[0][index + 2]];
    const other = [writes[0][index + 6], writes[0][index + 7], writes[0][index + 8]];
    assert.ok(isInsideClipSpace(gridViewProjection, position), `position out of frustum: ${position.join(',')}`);
    assert.ok(isInsideClipSpace(gridViewProjection, other), `other out of frustum: ${other.join(',')}`);
  }
});

test('scene auto clip planes are too small for the full grid, but grid clip planes expand enough', () => {
  const camera = createCameraState(1);
  camera.center = [0, 10, 0];
  camera.distance = Math.sqrt(925);
  camera.phi = Math.asin(5 / Math.sqrt(925));
  camera.theta = 0;
  camera.fovY = Math.PI / 4;

  const sceneBounds = {
    min: [-4, 0, -4],
    max: [4, 20, 4],
  };
  const sceneClipPlanes = computeAutoClipPlanes(camera, sceneBounds);
  const gridClipPlanes = computeGridClipPlanesForTest(camera, {
    gridSize: 5,
    gridCount: 10,
  });

  assert.ok(sceneClipPlanes.far < gridClipPlanes.far);
  assert.ok(sceneClipPlanes.far < 50);
  assert.ok(gridClipPlanes.far > 90);
});

test('same camera keeps the grid visibility once Alicia is loaded when clip planes include the grid bounds', async () => {
  const camera = createCameraState(1);
  camera.center = [0, 10, 0];
  camera.distance = 30;
  camera.phi = 9.4 * Math.PI / 180;
  camera.theta = 0;
  camera.fovY = 45 * Math.PI / 180;

  const eye = createCameraEye(camera);
  assert.ok(Math.abs(eye[0] - 0) < 1e-6);
  assert.ok(Math.abs(eye[1] - 15) < 0.2);
  assert.ok(Math.abs(eye[2] - 30) < 0.5);

  const canvas = { width: 1920, height: 1080 };
  const selection = {
    showGridXZ: true,
    showGridXY: false,
    showGridYZ: false,
    gridSize: 5,
    gridCount: 10,
  };

  const writes = [];
  const device = {
    createBuffer(desc) {
      return {
        size: desc.size,
        destroy() {},
      };
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push(Array.from(data));
      },
    },
  };
  const gridOverlay = {
    gridVertexBuffer: device.createBuffer({ size: 1024 * 1024 }),
    gridVertexCount: 0,
    size: selection.gridSize,
    count: selection.gridCount,
  };
  updateGridBuffer(device, gridOverlay, selection);
  assert.equal(writes.length, 1);
  assert.ok(gridOverlay.gridVertexCount > 0);

  const unloadedClipPlanes = computeAutoClipPlanes(camera, null);
  const unloadedViewProjection = createViewProjection(canvas, camera, unloadedClipPlanes);
  const unloadedFrustumCheck = countGridEndpointsInClipSpace(unloadedViewProjection, writes[0]);
  assert.ok(unloadedFrustumCheck.insideCount > 0, 'grid should be visible before loading the model');

  const zip = await loadZipArchive(await fs.readFile('./test-data/alicia.zip'));
  const modelPath = Object.keys(zip.files).find((path) => path.toLowerCase().endsWith('.pmx'));
  assert.ok(modelPath, 'alicia.zip should contain a pmx file');

  const { model } = await loadModelData(zip.files, 1, modelPath);
  const sceneBounds = computeModelSceneBoundsForTest(model);
  const loadedSceneOnlyClipPlanes = computeAutoClipPlanes(camera, sceneBounds);
  const loadedSceneOnlyViewProjection = createViewProjection(canvas, camera, loadedSceneOnlyClipPlanes);
  const loadedSceneOnlyFrustumCheck = countGridEndpointsInClipSpace(loadedSceneOnlyViewProjection, writes[0]);
  assert.ok(loadedSceneOnlyFrustumCheck.insideCount < unloadedFrustumCheck.insideCount, 'scene-only bounds should still reproduce the clipping regression');

  const visibleSceneBounds = createSceneBoundsWithGridForTest(sceneBounds, selection);
  const loadedGridAwareClipPlanes = computeAutoClipPlanes(camera, visibleSceneBounds);
  const loadedGridAwareViewProjection = createViewProjection(canvas, camera, loadedGridAwareClipPlanes);
  const loadedGridAwareFrustumCheck = countGridEndpointsInClipSpace(loadedGridAwareViewProjection, writes[0]);

  assert.equal(loadedGridAwareFrustumCheck.insideCount, unloadedFrustumCheck.insideCount);
  assert.equal(loadedGridAwareFrustumCheck.outsideCount, unloadedFrustumCheck.outsideCount);
});

/**
 * grid 用の clip plane をテスト内で再現します。
 * @param {object} camera - カメラ状態。
 * @param {object} selection - grid 設定。
 * @returns {{near: number, far: number}} clip plane。
 */
function computeGridClipPlanesForTest(camera, selection) {
  const gridSize = Number(selection?.gridSize ?? 5);
  const gridCount = Number(selection?.gridCount ?? 10);
  const safeGridSize = Number.isFinite(gridSize) ? Math.max(0.1, gridSize) : 5;
  const safeGridCount = Number.isFinite(gridCount) ? Math.max(1, gridCount) : 10;
  const gridReach = safeGridSize * safeGridCount;
  const originalNear = camera.clipPlanes?.near ?? 0.1;
  const originalFar = camera.clipPlanes?.far ?? 1000.0;
  const gridBounds = {
    min: [-gridReach, -gridReach, -gridReach],
    max: [gridReach, gridReach, gridReach],
  };
  const view = createViewMatrix(camera);
  let expandedFar = originalFar;
  for (const corner of getAabbCorners(gridBounds)) {
    const viewPoint = transformPoint(view, corner);
    const depth = -viewPoint[2];
    if (depth > 0) {
      expandedFar = Math.max(expandedFar, depth);
    }
  }
  expandedFar = Math.max(originalFar, expandedFar + Math.max(1.0, gridReach * 0.05));
  return {
    near: originalNear,
    far: expandedFar,
  };
}

/**
 * モデルの scene bounds を runtime と同じ考え方で再現します。
 * @param {object} model - PMX モデル。
 * @returns {{min: number[], max: number[]}|null} scene bounds。
 */
function computeModelSceneBoundsForTest(model) {
  const aabb = createAabb();
  for (const bone of model?.bones ?? []) {
    if (!bone?.position) {
      continue;
    }
    expandAabbWithPoint(aabb, bone.position);
  }

  if (!Number.isFinite(aabb.min[0])) {
    return null;
  }

  const margin = model?.shadowBoundsMargin || 0;
  return {
    min: [aabb.min[0] - margin, aabb.min[1] - margin, aabb.min[2] - margin],
    max: [aabb.max[0] + margin, aabb.max[1] + margin, aabb.max[2] + margin],
  };
}

/**
 * scene bounds に grid 範囲を加えた AABB を返します。
 * @param {{min: number[], max: number[]}|null} sceneBounds - モデル由来の bounds。
 * @param {object} selection - grid 設定。
 * @returns {{min: number[], max: number[]}|null} grid を含めた bounds。
 */
function createSceneBoundsWithGridForTest(sceneBounds, selection) {
  const showXZ = selection?.showGridXZ !== false;
  const showXY = Boolean(selection?.showGridXY);
  const showYZ = Boolean(selection?.showGridYZ);
  if (!showXZ && !showXY && !showYZ) {
    return sceneBounds;
  }

  const gridSize = Number(selection?.gridSize ?? 5);
  const gridCount = Number(selection?.gridCount ?? 10);
  const safeGridSize = Number.isFinite(gridSize) ? Math.max(0.1, gridSize) : 5;
  const safeGridCount = Number.isFinite(gridCount) ? Math.max(1, gridCount) : 10;
  const gridReach = safeGridSize * safeGridCount;
  return unionAabb(sceneBounds, {
    min: [-gridReach, -gridReach, -gridReach],
    max: [gridReach, gridReach, gridReach],
  });
}

/**
 * grid 頂点配列の端点が clip space 内にある数を数えます。
 * @param {ArrayLike<number>} mvp - MVP 行列。
 * @param {ArrayLike<number>} vertices - grid 頂点配列。
 * @returns {{insideCount: number, outsideCount: number}} 判定結果。
 */
function countGridEndpointsInClipSpace(mvp, vertices) {
  let insideCount = 0;
  let outsideCount = 0;

  for (let index = 0; index < vertices.length; index += 10) {
    const start = [vertices[index + 0], vertices[index + 1], vertices[index + 2]];
    const end = [vertices[index + 6], vertices[index + 7], vertices[index + 8]];
    if (isInsideClipSpace(mvp, start)) {
      insideCount++;
    } else {
      outsideCount++;
    }
    if (isInsideClipSpace(mvp, end)) {
      insideCount++;
    } else {
      outsideCount++;
    }
  }

  return { insideCount, outsideCount };
}

/**
 * clip space の範囲内かどうかを判定します。
 * @param {ArrayLike<number>} mvp - MVP 行列。
 * @param {ArrayLike<number>} point - 3D 点。
 * @returns {boolean} frustum 内なら true。
 */
function isInsideClipSpace(mvp, point) {
  const clip = [
    mvp[0] * point[0] + mvp[4] * point[1] + mvp[8] * point[2] + mvp[12],
    mvp[1] * point[0] + mvp[5] * point[1] + mvp[9] * point[2] + mvp[13],
    mvp[2] * point[0] + mvp[6] * point[1] + mvp[10] * point[2] + mvp[14],
    mvp[3] * point[0] + mvp[7] * point[1] + mvp[11] * point[2] + mvp[15],
  ];
  return clip[3] > 0
    && clip[0] >= -clip[3] && clip[0] <= clip[3]
    && clip[1] >= -clip[3] && clip[1] <= clip[3]
    && clip[2] >= 0 && clip[2] <= clip[3];
}
