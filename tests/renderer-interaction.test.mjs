import assert from 'node:assert/strict';
import test from 'node:test';
import { quat } from '../source/lib/esm/index.js';
import { collectBoneBoxSelectionIndices, pickBoneHit, setupInputHandlers } from '../source/application/interaction/renderer-interaction.js';
import { createGizmoState } from '../source/core/selection/gizmo.js';
import { createViewProjection } from '../source/core/scene/camera.js';
import { getCustomRigCircleTargets } from '../source/core/model/custom-rig.js';
import { mat4Vec4Mul } from '../source/shared/math/math-utils.js';

function assertQuatRotationClose(actual, expected, epsilon = 1e-6) {
  const directDelta = Math.abs(actual[0] - expected[0]) + Math.abs(actual[1] - expected[1]) + Math.abs(actual[2] - expected[2]) + Math.abs(actual[3] - expected[3]);
  const negatedDelta = Math.abs(actual[0] + expected[0]) + Math.abs(actual[1] + expected[1]) + Math.abs(actual[2] + expected[2]) + Math.abs(actual[3] + expected[3]);
  assert.ok(Math.min(directDelta, negatedDelta) < epsilon);
}

function createEventTarget() {
  return {
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
  };
}

function createCanvasStub() {
  return {
    ...createEventTarget(),
    width: 128,
    height: 128,
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 128, height: 128 };
    },
    setPointerCapture() {},
  };
}

function createOverlayStub() {
  return {
    style: {
      display: 'none',
      left: '0px',
      top: '0px',
      width: '0px',
      height: '0px',
    },
  };
}

function createBaseEvent(overrides = {}) {
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    deltaY: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    preventDefault() {},
    ...overrides,
  };
}

function projectWorldToScreen(canvas, camera, worldPosition) {
  const mvp = createViewProjection(canvas, camera);
  const clip = mat4Vec4Mul(mvp, [...worldPosition, 1]);
  return {
    clientX: (clip[0] / clip[3] * 0.5 + 0.5) * canvas.width,
    clientY: ((-clip[1] / clip[3]) * 0.5 + 0.5) * canvas.height,
  };
}

function createGizmoInstance() {
  return {
    model: {
      bones: [
        { parentIndex: -1, flags: 0x000A },
        { parentIndex: -1, flags: 0x0008 },
      ],
    },
    scene: {
      ikTargets: [],
      boneWorldPositions: [
        [0, 0, 0],
        [0, 0, -0.5],
      ],
      boneLocalTransforms: [
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
      ],
    },
  };
}

function createCustomRigPickInstance() {
  return {
    model: {
      bones: [
        { name: '全ての親', parentIndex: -1, flags: 0x0008 },
        { name: 'overlap-point', parentIndex: -1, flags: 0x0008 },
      ],
    },
    scene: {
      ikTargets: [],
      boneWorldPositions: [
        [0, 0, 0],
        [2.5, 0, 0],
      ],
      boneLocalTransforms: [
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
      ],
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        customRigBoneIndexByName: new Map([
          ['全ての親', 0],
        ]),
      },
    },
  };
}

function createChildPickInstances() {
  const createScene = (worldPosition) => ({
    ikTargets: [],
    boneWorldPositions: [worldPosition],
    boneLocalTransforms: [
      {
        worldRotation: [0, 0, 0, 1],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        manualRotation: [0, 0, 0, 1],
        manualTranslation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ],
    boneDebugLists: {
      hiddenBoneIndexSet: new Set(),
      customRigBoneIndexByName: new Map(),
    },
  });

  return [
    {
      model: {
        bones: [
          { name: 'active-bone', parentIndex: -1, flags: 0x0008 },
        ],
      },
      scene: createScene([6, 0, 0]),
      visible: true,
      aabb: null,
    },
    {
      model: {
        bones: [
          { name: 'picked-bone', parentIndex: -1, flags: 0x0008 },
        ],
      },
      scene: createScene([0, 0, 0]),
      visible: true,
      aabb: null,
    },
  ];
}

function createGizmoInteractionHarness() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const overlay = createOverlayStub();
  const boxOverlay = createOverlayStub();
  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: 0,
    selectedTargetIndex: -1,
    useWorldCoordinate: false,
  };
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
    clipPlanes: {
      near: 0.1,
      far: 1000,
    },
    isDragging: false,
    isPanning: false,
  };
  const gizmoState = createGizmoState();
  let refreshCount = 0;

  globalThis.window = {
    addEventListener(type, handler) {
      this.listeners = this.listeners || new Map();
      this.listeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById(id) {
      if (id === 'camera-range-zoom-overlay') {
        return overlay;
      }
      if (id === 'bone-box-selection-overlay') {
        return boxOverlay;
      }
      return null;
    },
  };

  const harness = {
    canvas,
    camera,
    gizmoState,
    overlay,
    refreshScene() {
      refreshCount += 1;
    },
    restore() {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
    selection,
    get refreshCount() {
      return refreshCount;
    },
    modelManager: {
      instances: [createGizmoInstance()],
      setManualLocalRotationQuaternion() {},
      setManualLocalPosition() {},
    },
  };

  setupInputHandlers({
    canvas,
    camera,
    selection,
    modelManager: harness.modelManager,
    physicsEngine: {},
    refreshScene() {
      refreshCount += 1;
    },
    activateInstance() {},
    timelineManager: null,
    gizmoState,
    depthPickState: { enabled: false },
    queueDepthPick() {},
    clearCameraLookAtTarget() {
      return false;
    },
  });

  return harness;
}

function createCustomRigInteractionHarness(instanceFactory = createCustomRigPickInstance) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const overlay = createOverlayStub();
  const boxOverlay = createOverlayStub();
  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    useWorldCoordinate: false,
  };
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
    clipPlanes: {
      near: 0.1,
      far: 1000,
    },
    isDragging: false,
    isPanning: false,
  };
  const gizmoState = createGizmoState();
  let refreshCount = 0;

  globalThis.window = {
    addEventListener(type, handler) {
      this.listeners = this.listeners || new Map();
      this.listeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById(id) {
      if (id === 'camera-range-zoom-overlay') {
        return overlay;
      }
      if (id === 'bone-box-selection-overlay') {
        return boxOverlay;
      }
      return null;
    },
  };

  const harness = {
    canvas,
    camera,
    gizmoState,
    overlay,
    restore() {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
    selection,
    get refreshCount() {
      return refreshCount;
    },
    modelManager: {
      instances: [instanceFactory()],
      setManualLocalRotationQuaternion() {},
      setManualLocalPosition() {},
    },
  };

  setupInputHandlers({
    canvas,
    camera,
    selection,
    modelManager: harness.modelManager,
    physicsEngine: {
      rayTest() {
        return null;
      },
    },
    refreshScene() {
      refreshCount += 1;
    },
    activateInstance() {},
    timelineManager: null,
    gizmoState,
    depthPickState: { enabled: false },
    queueDepthPick() {},
    clearCameraLookAtTarget() {
      return false;
    },
  });

  return harness;
}

function createAabbInteractionHarness() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const overlay = createOverlayStub();
  const boxOverlay = createOverlayStub();
  const selection = {
    activeInstanceIndex: 0,
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
    selectedRigidbodyIndex: -1,
    selectedLight: false,
    hideIkBones: false,
    showPhysics: false,
  };
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    roll: 0,
    fovY: 45 * Math.PI / 180,
    clipPlanes: {
      near: 0.1,
      far: 1000,
    },
    isDragging: false,
    isPanning: false,
  };
  let refreshCount = 0;
  const instances = [
    {
      model: {
        bones: [],
      },
      scene: {
        ikTargets: [],
        boneWorldPositions: [],
        boneDebugLists: {
          hiddenBoneIndexSet: new Set(),
        },
      },
      visible: true,
      aabb: {
        min: [-8, -8, -8],
        max: [8, 8, 8],
      },
    },
    {
      model: {
        bones: [],
      },
      scene: {
        ikTargets: [],
        boneWorldPositions: [],
        boneDebugLists: {
          hiddenBoneIndexSet: new Set(),
        },
      },
      visible: true,
      aabb: {
        min: [-8, -8, -8],
        max: [8, 8, 8],
      },
    },
  ];

  globalThis.window = {
    addEventListener(type, handler) {
      this.listeners = this.listeners || new Map();
      this.listeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById(id) {
      if (id === 'camera-range-zoom-overlay') {
        return overlay;
      }
      if (id === 'bone-box-selection-overlay') {
        return boxOverlay;
      }
      return null;
    },
  };

  const harness = {
    canvas,
    camera,
    overlay,
    refreshScene() {
      refreshCount += 1;
    },
    restore() {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
    selection,
    get refreshCount() {
      return refreshCount;
    },
    modelManager: {
      instances,
      setManualLocalRotationQuaternion() {},
      setManualLocalPosition() {},
    },
    lightObject: {
      position: [100, 100, 100],
    },
  };

  setupInputHandlers({
    canvas,
    camera,
    selection,
    modelManager: harness.modelManager,
    physicsEngine: {
      rayTest() {
        return null;
      },
    },
    refreshScene() {
      refreshCount += 1;
    },
    activateInstance(index) {
      selection.activeInstanceIndex = index;
    },
    timelineManager: null,
    gizmoState: { isDragging: false },
    depthPickState: { enabled: false },
    queueDepthPick() {},
    clearCameraLookAtTarget() {
      return false;
    },
    lightObject: harness.lightObject,
  });

  return harness;
}

test('pickBoneHit selects the parent bone when clicking between parent and child', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: 0 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 2,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 75, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, -1);
  assert.equal(hit.distance, 0);
});

test('pickBoneHit selects the bone that owns a tailIndex segment', () => {
  const model = {
    bones: [
      { parentIndex: -1, tailIndex: 2 },
      { parentIndex: 0 },
      { parentIndex: 0 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 3,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set([2]),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 12.5 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit ignores hidden model instances', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 1,
    boneWorldPositions: [
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const customRigHits = [
    {
      boneIndex: 0,
      targetIndex: 0,
      distance: 0,
      depth: 0,
      kind: 'custom-rig',
      kindRank: -1,
    },
  ];

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    false,
    20,
    null,
    -1,
    false,
    [],
    customRigHits,
    false,
  );

  assert.equal(hit, null);
});

test('pickBoneHit ignores SpringBone bones when the visibility toggle is enabled', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 2,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
    springBoneBoneIndexSet: new Set([1]),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 100, clientY: 50 };
  const selection = {
    hideSpringBones: true,
  };

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    false,
    20,
    null,
    -1,
    false,
    [],
    [],
    true,
    selection,
  );

  assert.equal(hit, null);
});

test('pickBoneHit resolves a selected parent segment to its child during additive selection', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: 0 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 2,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 75, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false, 20, null, -1, false, [0]);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit selects the bone that owns a tailOffset segment', () => {
  const model = {
    bones: [
      { parentIndex: -1, tailOffset: [0, 1, 0] },
    ],
  };
  const scene = {
    ikTargets: [],
    boneCount: 1,
    boneWorldPositions: [
      [0, 0, 0],
    ],
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
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 12.5 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit rotates through overlapping bones when the pointer stays within the repeat threshold', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const previousPick = { clientX: 50, clientY: 50, boneIndex: 0, targetIndex: -1 };

  const nextHit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false, 20, previousPick);

  assert.ok(nextHit);
  assert.equal(nextHit.boneIndex, 1);
  assert.equal(nextHit.targetIndex, -1);
});

test('pickBoneHit does not rotate when the pointer moves beyond the repeat threshold', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const previousPick = { clientX: 80, clientY: 80, boneIndex: 0, targetIndex: -1 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false, 20, previousPick);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit skips selected bone variants during additive repeat picking when another bone is available', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const previousPick = { clientX: 50, clientY: 50, boneIndex: 0, targetIndex: -1 };

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    true,
    20,
    previousPick,
    -1,
    false,
    [0],
  );

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit keeps IK and normal variants adjacent even when a parent segment is also hittable', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: 0 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 1 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    true,
    20,
    { clientX: 50, clientY: 50, boneIndex: 1, targetIndex: 0 },
  );

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit treats IK and normal bones as peer rotation candidates', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };

  const firstHit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, true, 20);
  const secondHit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    true,
    20,
    { clientX: 50, clientY: 50, boneIndex: 0, targetIndex: -1 },
  );

  assert.ok(firstHit);
  assert.equal(firstHit.boneIndex, 0);
  assert.equal(firstHit.targetIndex, -1);
  assert.ok(secondHit);
  assert.equal(secondHit.boneIndex, 0);
  assert.equal(secondHit.targetIndex, 0);
});

test('pickBoneHit prefers the IK target cube when additive selection is requested', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, true, 20, null, -1, true);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, 0);
});

test('pickBoneHit chooses the nearest IK target cube during additive selection when cubes overlap', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
      { boneIndex: 1 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
      [0.12, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 60, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, true, 20, null, -1, true);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, 1);
});

test('pickBoneHit prefers an unselected bone during additive selection when overlapping bones are clicked repeatedly', () => {
  const model = {
    bones: [
      { parentIndex: 1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false, 20, null, -1, false, [0]);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, -1);
});

test('pickBoneHit prefers an unselected IK target cube during additive selection when front and back overlap', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
      { boneIndex: 1 },
    ],
    boneWorldPositions: [
      [0, 0, -2],
      [0, 0, -1],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, true, 20, null, -1, true, [0]);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 1);
  assert.equal(hit.targetIndex, 1);
});

test('pickBoneHit selects the IK target cube within the rendered cube bounds', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [
      { boneIndex: 0 },
    ],
    boneWorldPositions: [
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const nearEvent = { clientX: 52, clientY: 50 };
  const farEvent = { clientX: 64, clientY: 50 };

  const hit = pickBoneHit(model, scene, boneDebugLists, nearEvent, rect, mvp, true, 10, null, -1, true);

  assert.ok(hit);
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, 0);
  assert.ok(hit.distance <= 10);

  const miss = pickBoneHit(model, scene, boneDebugLists, farEvent, rect, mvp, true, 10, null, -1, true);
  assert.equal(miss, null);
});

test('pickBoneHit rotates from custom rig circle hits to the underlying bone at the same cursor position', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const customRigHits = [
    {
      boneIndex: 0,
      targetIndex: 0,
      distance: 0,
      depth: 0,
      kind: 'custom-rig',
      kindRank: -1,
    },
  ];

  const firstHit = pickBoneHit(model, scene, boneDebugLists, event, rect, mvp, false, 20, null, -1, false, [], customRigHits);
  const secondHit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    false,
    20,
    { clientX: 50, clientY: 50, boneIndex: 0, targetIndex: 0 },
    -1,
    false,
    [],
    customRigHits,
  );

  assert.ok(firstHit);
  assert.equal(firstHit.kind, 'custom-rig');
  assert.equal(firstHit.boneIndex, 0);
  assert.equal(firstHit.targetIndex, 0);
  assert.ok(secondHit);
  assert.equal(secondHit.kind, 'bone-point');
  assert.equal(secondHit.boneIndex, 0);
  assert.equal(secondHit.targetIndex, -1);
});

test('pickBoneHit keeps custom rig circles pickable even when the bone is already selected and another bone overlaps it', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const customRigHits = [
    {
      boneIndex: 0,
      targetIndex: 0,
      distance: 0,
      depth: 0,
      kind: 'custom-rig',
      kindRank: -1,
    },
  ];

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    false,
    20,
    null,
    -1,
    false,
    [0],
    customRigHits,
  );

  assert.ok(hit);
  assert.equal(hit.kind, 'custom-rig');
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, 0);
});

test('setupInputHandlers picks the custom rig circle before an overlapping bone point on the real click path', () => {
  const harness = createCustomRigInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const instance = harness.modelManager.instances[0];
    const customRigTarget = getCustomRigCircleTargets(instance).find((target) => target.boneIndex === 0);
    assert.ok(customRigTarget);

    const hitPoint = [
      customRigTarget.center[0] + customRigTarget.radius,
      customRigTarget.center[1],
      customRigTarget.center[2],
    ];
    const targetPoint = projectWorldToScreen(harness.canvas, harness.camera, hitPoint);

    down(createBaseEvent({
      button: 0,
      clientX: targetPoint.clientX,
      clientY: targetPoint.clientY,
      pointerId: 41,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: targetPoint.clientX,
      clientY: targetPoint.clientY,
      pointerId: 41,
      pointerType: 'mouse',
    }));

    assert.equal(harness.selection.selectedBoneIndex, 0);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.ok(harness.refreshCount >= 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers keeps custom rig circles clickable even when the mapped bone is hidden', () => {
  const harness = createCustomRigInteractionHarness(() => ({
    model: {
      bones: [
        { name: '全ての親', parentIndex: -1, flags: 0x0008 },
        { name: 'overlap-point', parentIndex: -1, flags: 0x0008 },
      ],
    },
    scene: {
      ikTargets: [],
      boneWorldPositions: [
        [0, 0, 0],
        [2.5, 0, 0],
      ],
      boneLocalTransforms: [
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        {
          worldRotation: [0, 0, 0, 1],
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          manualTranslation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
      ],
      boneDebugLists: {
        hiddenBoneIndexSet: new Set([0]),
        customRigBoneIndexSet: new Set([0]),
        customRigBoneIndexByName: new Map([
          ['全ての親', 0],
        ]),
      },
    },
  }));
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const instance = harness.modelManager.instances[0];
    const customRigTarget = getCustomRigCircleTargets(instance).find((target) => target.boneIndex === 0);
    assert.ok(customRigTarget);

    const clickPoint = projectWorldToScreen(harness.canvas, harness.camera, customRigTarget.center);
    down(createBaseEvent({
      button: 0,
      clientX: clickPoint.clientX,
      clientY: clickPoint.clientY,
      pointerId: 37,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: clickPoint.clientX,
      clientY: clickPoint.clientY,
      pointerId: 37,
      pointerType: 'mouse',
    }));

    assert.equal(harness.selection.selectedBoneIndex, 0);
    assert.equal(harness.selection.activeBoneIndex, 0);
    assert.equal(harness.selection.selectedTargetIndex, -1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers rotates active AABB hits on repeated same-position clicks', () => {
  const harness = createAabbInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const centerPoint = projectWorldToScreen(harness.canvas, harness.camera, [0, 0, 0]);
    const offsetPoint = projectWorldToScreen(harness.canvas, harness.camera, [6, 0, 0]);

    const click = (point, pointerId) => {
      down(createBaseEvent({
        button: 0,
        clientX: point.clientX,
        clientY: point.clientY,
        pointerId,
        pointerType: 'mouse',
      }));
      up(createBaseEvent({
        button: 0,
        clientX: point.clientX,
        clientY: point.clientY,
        pointerId,
        pointerType: 'mouse',
      }));
    };

    click(centerPoint, 51);
    assert.equal(harness.selection.activeInstanceIndex, 0);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.equal(harness.selection.selectedRigidbodyIndex, -1);

    click(centerPoint, 52);
    assert.equal(harness.selection.activeInstanceIndex, 1);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.equal(harness.selection.selectedRigidbodyIndex, -1);

    click(offsetPoint, 53);
    assert.equal(harness.selection.activeInstanceIndex, 0);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.equal(harness.selection.selectedRigidbodyIndex, -1);

    click(offsetPoint, 54);
    assert.equal(harness.selection.activeInstanceIndex, 1);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.equal(harness.selection.selectedRigidbodyIndex, -1);
    assert.ok(harness.refreshCount >= 4);
  } finally {
    harness.restore();
  }
});

test('pickBoneHit keeps custom rig hits available even when the underlying bone index is ignored', () => {
  const model = {
    bones: [
      { parentIndex: -1 },
      { parentIndex: -1 },
    ],
  };
  const scene = {
    ikTargets: [],
    boneWorldPositions: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const boneDebugLists = {
    hiddenBoneIndexSet: new Set(),
  };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const event = { clientX: 50, clientY: 50 };
  const customRigHits = [
    {
      boneIndex: 0,
      targetIndex: 0,
      distance: 0,
      depth: 0,
      kind: 'custom-rig',
      kindRank: -1,
    },
  ];

  const hit = pickBoneHit(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    false,
    20,
    null,
    0,
    false,
    [],
    customRigHits,
  );

  assert.ok(hit);
  assert.equal(hit.kind, 'custom-rig');
  assert.equal(hit.boneIndex, 0);
  assert.equal(hit.targetIndex, 0);
});

test('collectBoneBoxSelectionIndices selects bones whose projected positions are inside the rectangle', () => {
  const instance = {
    model: {
      bones: [
        { parentIndex: -1 },
        { parentIndex: -1 },
        { parentIndex: -1 },
        { parentIndex: -1 },
      ],
      ik: [],
    },
    scene: {
      boneWorldPositions: [
        [-0.2, 0, 0],
        [0, 0, 0],
        [0.2, 0, 0],
        [0.8, 0, 0],
      ],
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        nonVisibleBoneIndexSet: new Set(),
      },
      ikTargets: [],
    },
  };
  const selection = {
    hideIkBones: false,
  };
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  const indices = collectBoneBoxSelectionIndices(instance, selection, rect, mvp, 35, 35, 65, 65);

  assert.deepEqual(indices, [0, 1, 2]);
});

test('collectBoneBoxSelectionIndices ignores hidden model instances', () => {
  const instance = {
    visible: false,
    model: {
      bones: [
        { parentIndex: -1 },
        { parentIndex: -1 },
      ],
      ik: [],
    },
    scene: {
      boneWorldPositions: [
        [0, 0, 0],
        [0.2, 0, 0],
      ],
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        nonVisibleBoneIndexSet: new Set(),
      },
      ikTargets: [],
    },
  };
  const selection = {
    hideIkBones: false,
  };
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const mvp = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  const indices = collectBoneBoxSelectionIndices(instance, selection, rect, mvp, 35, 35, 65, 65);

  assert.deepEqual(indices, []);
});

test('setupInputHandlers treats a gizmo click as a bone pick on mouse release', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');

    harness.selection.selectedBoneIndex = -1;
    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 9,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 9,
      pointerType: 'mouse',
    }));

    harness.selection.selectedBoneIndex = 0;
    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 1,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 1,
      pointerType: 'mouse',
    }));

    assert.equal(harness.gizmoState.isDragging, false);
    assert.equal(harness.selection.selectedBoneIndex, 1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.ok(harness.refreshCount >= 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers does not auto-advance from a glTF bone to its _leaf helper after gizmo release', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const instance = harness.modelManager.instances[0];

    instance.model.bones = [
      { name: 'Bone', parentIndex: -1, flags: 0x0008 },
      { name: 'Bone001', parentIndex: 0, flags: 0x0008 },
      { name: 'Bone001_leaf', parentIndex: 1, flags: 0x0008 },
    ];
    instance.scene.boneWorldPositions = [
      [0, 0, 0],
      [0, 0, -0.5],
      [0, 2, 0],
    ];
    instance.scene.boneLocalTransforms = [
      {
        worldRotation: [0, 0, 0, 1],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        manualRotation: [0, 0, 0, 1],
        manualTranslation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
      {
        worldRotation: [0, 0, 0, 1],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        manualRotation: [0, 0, 0, 1],
        manualTranslation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
      {
        worldRotation: [0, 0, 0, 1],
        localX: [1, 0, 0],
        localY: [0, 1, 0],
        localZ: [0, 0, 1],
        manualRotation: [0, 0, 0, 1],
        manualTranslation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      },
    ];

    harness.selection.selectedBoneIndex = 1;
    harness.selection.selectedBoneIndices = [1];
    harness.selection.activeBoneIndex = 1;

    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 11,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 11,
      pointerType: 'mouse',
    }));

    assert.equal(harness.gizmoState.isDragging, false);
    assert.equal(harness.selection.selectedBoneIndex, 1);
    assert.deepEqual(harness.selection.selectedBoneIndices, [1]);
    assert.equal(harness.selection.activeBoneIndex, 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers does not pick or advance bones from a hidden model after gizmo release', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');

    harness.modelManager.instances[0].visible = false;
    harness.selection.selectedBoneIndex = 0;
    harness.selection.selectedBoneIndices = [0];
    harness.selection.activeBoneIndex = 0;

    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 41,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 41,
      pointerType: 'mouse',
    }));

    assert.equal(harness.gizmoState.isDragging, false);
    assert.equal(harness.selection.selectedBoneIndex, 0);
    assert.deepEqual(harness.selection.selectedBoneIndices, [0]);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.equal(harness.selection.activeBoneIndex, 0);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers keeps additive selection on shift-click through gizmo release', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');

    harness.selection.selectedBoneIndex = 0;
    harness.selection.selectedBoneIndices = [0];
    harness.selection.activeBoneIndex = 0;

    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 31,
      pointerType: 'mouse',
      shiftKey: true,
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 31,
      pointerType: 'mouse',
      shiftKey: true,
    }));

    assert.deepEqual(harness.selection.selectedBoneIndices.sort((a, b) => a - b), [0, 1]);
    assert.equal(harness.selection.activeBoneIndex, 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers keeps additive selection on non-gizmo shift-click even when shift is released before pointerup', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    harness.modelManager.instances[0].scene.boneWorldPositions = [
      [0.3, 0, 0],
      [0, 0, -0.5],
    ];
    const targetPoint = projectWorldToScreen(
      harness.canvas,
      harness.camera,
      harness.modelManager.instances[0].scene.boneWorldPositions[0],
    );

    harness.selection.selectedBoneIndex = 1;
    harness.selection.selectedBoneIndices = [1];
    harness.selection.activeBoneIndex = 1;

    down(createBaseEvent({
      button: 0,
      clientX: targetPoint.clientX,
      clientY: targetPoint.clientY,
      pointerId: 35,
      pointerType: 'mouse',
      shiftKey: true,
    }));
    up(createBaseEvent({
      button: 0,
      clientX: targetPoint.clientX,
      clientY: targetPoint.clientY,
      pointerId: 35,
      pointerType: 'mouse',
      shiftKey: false,
    }));

    assert.deepEqual(harness.selection.selectedBoneIndices.sort((a, b) => a - b), [0, 1]);
    assert.equal(harness.selection.activeBoneIndex, 0);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers keeps additive selection on shift-click through gizmo release when selection array is empty', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');

    harness.selection.selectedBoneIndex = 0;
    harness.selection.selectedBoneIndices = [];
    harness.selection.activeBoneIndex = 0;

    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 33,
      pointerType: 'mouse',
      shiftKey: true,
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 33,
      pointerType: 'mouse',
      shiftKey: true,
    }));

    assert.deepEqual(harness.selection.selectedBoneIndices.sort((a, b) => a - b), [0, 1]);
    assert.equal(harness.selection.activeBoneIndex, 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers toggles a selected bone on additive gizmo release when no unselected bone is hit', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const instance = harness.modelManager.instances[0];
    instance.model.bones.length = 1;
    instance.scene.boneWorldPositions.length = 1;
    instance.scene.boneLocalTransforms.length = 1;

    harness.selection.selectedBoneIndex = 0;
    harness.selection.selectedBoneIndices = [0];
    harness.selection.activeBoneIndex = 0;

    down(createBaseEvent({
      button: 0,
      clientX: 64,
      clientY: 64,
      pointerId: 32,
      pointerType: 'mouse',
      shiftKey: true,
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 64,
      clientY: 64,
      pointerId: 32,
      pointerType: 'mouse',
      shiftKey: true,
    }));

    assert.deepEqual(harness.selection.selectedBoneIndices, []);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.activeBoneIndex, -1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers toggles a selected bone on additive gizmo release when selection array is empty', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');
    const instance = harness.modelManager.instances[0];
    instance.model.bones.length = 1;
    instance.scene.boneWorldPositions.length = 1;
    instance.scene.boneLocalTransforms.length = 1;

    harness.selection.selectedBoneIndex = 0;
    harness.selection.selectedBoneIndices = [];
    harness.selection.activeBoneIndex = 0;

    down(createBaseEvent({
      button: 0,
      clientX: 64,
      clientY: 64,
      pointerId: 34,
      pointerType: 'mouse',
      shiftKey: true,
    }));
    up(createBaseEvent({
      button: 0,
      clientX: 64,
      clientY: 64,
      pointerId: 34,
      pointerType: 'mouse',
      shiftKey: true,
    }));

    assert.deepEqual(harness.selection.selectedBoneIndices, []);
    assert.equal(harness.selection.selectedBoneIndex, -1);
    assert.equal(harness.selection.activeBoneIndex, -1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers treats a gizmo tap as a bone pick on touch release', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const up = harness.canvas.listeners.get('pointerup');

    harness.selection.selectedBoneIndex = -1;
    down(createBaseEvent({
      clientX: 46,
      clientY: 58,
      pointerId: 19,
      pointerType: 'touch',
    }));
    up(createBaseEvent({
      clientX: 46,
      clientY: 58,
      pointerId: 19,
      pointerType: 'touch',
    }));

    harness.selection.selectedBoneIndex = 0;
    down(createBaseEvent({
      clientX: 46,
      clientY: 58,
      pointerId: 11,
      pointerType: 'touch',
    }));
    up(createBaseEvent({
      clientX: 46,
      clientY: 58,
      pointerId: 11,
      pointerType: 'touch',
    }));

    assert.equal(harness.gizmoState.isDragging, false);
    assert.equal(harness.selection.selectedBoneIndex, 1);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.ok(harness.refreshCount >= 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers promotes a gizmo press to drag after moving past the threshold', () => {
  const harness = createGizmoInteractionHarness();
  try {
    const down = harness.canvas.listeners.get('pointerdown');
    const move = harness.canvas.listeners.get('pointermove');
    const up = harness.canvas.listeners.get('pointerup');

    down(createBaseEvent({
      button: 0,
      clientX: 46,
      clientY: 58,
      pointerId: 2,
      pointerType: 'mouse',
    }));
    move(createBaseEvent({
      button: 0,
      clientX: 60,
      clientY: 58,
      pointerId: 2,
      pointerType: 'mouse',
    }));

    assert.equal(harness.gizmoState.isDragging, true);

    up(createBaseEvent({
      button: 0,
      clientX: 60,
      clientY: 58,
      pointerId: 2,
      pointerType: 'mouse',
    }));

    assert.equal(harness.gizmoState.isDragging, false);
    assert.equal(harness.selection.selectedBoneIndex, 0);
    assert.equal(harness.selection.selectedTargetIndex, -1);
    assert.ok(harness.refreshCount >= 1);
  } finally {
    harness.restore();
  }
});

test('setupInputHandlers dollies camera on Alt+right drag', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const overlay = createOverlayStub();
  const windowListeners = new Map();
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    isDragging: false,
    isPanning: false,
  };
  let refreshCount = 0;

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById(id) {
      return id === 'camera-range-zoom-overlay' ? overlay : null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera,
      selection: { activeInstanceIndex: 0 },
      modelManager: { instances: [{}] },
      physicsEngine: {},
      refreshScene() {
        refreshCount += 1;
      },
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    canvas.listeners.get('pointerdown')(createBaseEvent({
      button: 2,
      altKey: true,
      clientY: 10,
      pointerId: 7,
    }));
    canvas.listeners.get('pointermove')(createBaseEvent({
      button: 2,
      altKey: true,
      clientY: 30,
      pointerId: 7,
    }));
    canvas.listeners.get('pointerup')(createBaseEvent({
      button: 2,
      altKey: true,
      clientY: 30,
      pointerId: 7,
    }));

    assert.equal(camera.distance, 10.2);
    assert.equal(camera.isDragging, false);
    assert.ok(refreshCount >= 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers zooms to the dragged rectangle on Alt+Ctrl+left drag', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const overlay = createOverlayStub();
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    isDragging: false,
    isPanning: false,
  };
  let refreshCount = 0;

  globalThis.window = {
    addEventListener() {},
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById(id) {
      return id === 'camera-range-zoom-overlay' ? overlay : null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera,
      selection: { activeInstanceIndex: 0 },
      modelManager: { instances: [{}] },
      physicsEngine: {},
      refreshScene() {
        refreshCount += 1;
      },
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    canvas.listeners.get('pointerdown')(createBaseEvent({
      button: 0,
      altKey: true,
      ctrlKey: true,
      clientX: 32,
      clientY: 32,
      pointerId: 11,
    }));
    canvas.listeners.get('pointermove')(createBaseEvent({
      button: 0,
      altKey: true,
      ctrlKey: true,
      clientX: 96,
      clientY: 96,
      pointerId: 11,
    }));

    assert.equal(overlay.style.display, 'block');
    assert.equal(overlay.style.left, '32px');
    assert.equal(overlay.style.top, '32px');
    assert.equal(overlay.style.width, '64px');
    assert.equal(overlay.style.height, '64px');

    canvas.listeners.get('pointerup')(createBaseEvent({
      button: 0,
      altKey: true,
      ctrlKey: true,
      clientX: 96,
      clientY: 96,
      pointerId: 11,
    }));

    assert.equal(camera.center[0], 0);
    assert.equal(camera.center[1], 0);
    assert.equal(camera.center[2], 0);
    assert.equal(camera.distance, 5);
    assert.equal(overlay.style.display, 'none');
    assert.equal(refreshCount >= 1, true);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers captures manual camera pose during viewport rotation', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const camera = {
    center: [1, 2, 3],
    distance: 10,
    phi: 0,
    theta: 0,
    isDragging: false,
    isPanning: false,
    lastX: 0,
    lastY: 0,
  };

  globalThis.window = {
    addEventListener(type, handler) {
      this.listeners = this.listeners || new Map();
      this.listeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera,
      selection: { activeInstanceIndex: 0 },
      modelManager: { instances: [{}] },
      appFacade: {
        editing: {
          getActiveInstance() {
            return {
              animationController: {
                currentFrame: 12,
              },
            };
          },
        },
      },
      physicsEngine: {},
      refreshScene() {},
      activateInstance() {},
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    canvas.listeners.get('pointerdown')(createBaseEvent({
      button: 2,
      clientX: 10,
      clientY: 10,
      pointerId: 3,
    }));
    canvas.listeners.get('pointermove')(createBaseEvent({
      button: 2,
      clientX: 20,
      clientY: 30,
      pointerId: 3,
    }));

    assert.equal(camera.manualPoseFrame, 12);
    assert.equal(camera.manualDistance, 10);
    assert.equal(camera.manualPhi, 0.2);
    assert.equal(camera.manualTheta, -0.1);
    assert.deepEqual(camera.manualCenter, [1, 2, 3]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers reports clicked mouse position', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const clickedPositions = [];
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 128, height: 128 });

  globalThis.window = {
    addEventListener() {},
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, hideIkBones: false },
      modelManager: { instances: [] },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
      onClickPositionChanged(clientX, clientY, canvasX, canvasY) {
        clickedPositions.push([clientX, clientY, canvasX, canvasY]);
      },
    });

    canvas.listeners.get('pointerdown')(createBaseEvent({
      button: 0,
      clientX: 12,
      clientY: 34,
      pointerId: 5,
    }));

    assert.deepEqual(clickedPositions, [[12, 34, 2, 14]]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers reports touch pointerdown position', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const clickedPositions = [];

  globalThis.window = {
    addEventListener() {},
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, hideIkBones: false },
      modelManager: { instances: [] },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
      onClickPositionChanged(clientX, clientY, canvasX, canvasY) {
        clickedPositions.push([clientX, clientY, canvasX, canvasY]);
      },
    });

    canvas.listeners.get('pointerdown')(createBaseEvent({
      button: 0,
      clientX: 21,
      clientY: 43,
      pointerId: 9,
      pointerType: 'touch',
    }));

    assert.deepEqual(clickedPositions, [[21, 43, 21, 43]]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers lets the Child picker capture a bone without changing selection', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const pickedBones = [];
  const childBonePickState = { enabled: true };
  const instances = createChildPickInstances();
  const selection = {
    activeInstanceIndex: 0,
    activeBoneIndex: 0,
    selectedBoneIndex: 0,
    selectedBoneIndices: [0],
    hideIkBones: false,
    showPhysics: false,
  };
  const camera = {
    center: [0, 0, 0],
    distance: 10,
    phi: 0,
    theta: 0,
    isDragging: false,
    isPanning: false,
    fovY: 45 * Math.PI / 180,
    clipPlanes: {
      near: 0.1,
      far: 1000,
    },
  };
  const worldToScreen = projectWorldToScreen(canvas, camera, [0, 0, 0]);

  globalThis.window = {
    addEventListener() {},
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
        toggle() {},
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera,
      selection,
      modelManager: {
        instances,
      },
      physicsEngine: {
        rayTest() {
          return null;
        },
      },
      refreshScene() {},
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      childBonePickState,
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
      onChildBonePicked(instance, boneIndex) {
        pickedBones.push([instance?.model?.bones?.[boneIndex]?.name ?? null, boneIndex]);
      },
    });

    const down = canvas.listeners.get('pointerdown');
    const up = canvas.listeners.get('pointerup');
    assert.ok(down);
    assert.ok(up);

    down(createBaseEvent({
      button: 0,
      clientX: worldToScreen.clientX,
      clientY: worldToScreen.clientY,
      pointerId: 17,
      pointerType: 'mouse',
    }));
    up(createBaseEvent({
      button: 0,
      clientX: worldToScreen.clientX,
      clientY: worldToScreen.clientY,
      pointerId: 17,
      pointerType: 'mouse',
    }));

    assert.deepEqual(pickedBones, [['picked-bone', 0]]);
    assert.equal(childBonePickState.enabled, false);
    assert.equal(selection.activeInstanceIndex, 0);
    assert.equal(selection.selectedBoneIndex, 0);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers delegates Delete to the application facade', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const windowListeners = new Map();
  let deleteCount = 0;
  let preventDefaultCount = 0;

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, hideIkBones: false },
      modelManager: { instances: [{}] },
      appFacade: {
        animation: {
          deleteSelectedKeyframes() {
            deleteCount += 1;
            return true;
          },
        },
      },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    const keydownHandler = windowListeners.get('keydown');
    assert.ok(keydownHandler);

    keydownHandler(createBaseEvent({
      key: 'Delete',
      preventDefault() {
        preventDefaultCount += 1;
      },
    }));

    assert.equal(deleteCount, 1);
    assert.equal(preventDefaultCount, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers skips shortcuts while a shadow-dom number input is focused', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const windowListeners = new Map();
  let deleteCount = 0;
  const stepCalls = [];
  let preventDefaultCount = 0;
  const innerInput = { tagName: 'INPUT' };
  const numberControlHost = {
    tagName: 'OPENMMD-NUMBER-CONTROL',
    shadowRoot: {
      activeElement: innerInput,
    },
  };

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: numberControlHost,
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, hideIkBones: false },
      modelManager: { instances: [{ model: {}, scene: {}, animationController: {} }] },
      appFacade: {
        animation: {
          deleteSelectedKeyframes() {
            deleteCount += 1;
            return true;
          },
        },
        playback: {
          stepFrame(direction) {
            stepCalls.push(direction);
          },
        },
      },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    const keydownHandler = windowListeners.get('keydown');
    assert.ok(keydownHandler);

    keydownHandler(createBaseEvent({
      key: 'Delete',
      preventDefault() {
        preventDefaultCount += 1;
      },
    }));
    keydownHandler(createBaseEvent({
      key: 'ArrowLeft',
      preventDefault() {
        preventDefaultCount += 1;
      },
    }));

    assert.equal(deleteCount, 0);
    assert.deepEqual(stepCalls, []);
    assert.equal(preventDefaultCount, 0);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers routes ctrl+arrow shortcuts to keyframe stepping', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const windowListeners = new Map();
  const stepCalls = [];
  let preventDefaultCount = 0;

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, hideIkBones: false },
      modelManager: { instances: [{ model: {}, scene: {}, animationController: {} }] },
      appFacade: {
        playback: {
          stepKeyframe(direction) {
            stepCalls.push(direction);
          },
        },
      },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    const keydownHandler = windowListeners.get('keydown');
    assert.ok(keydownHandler);

    keydownHandler(createBaseEvent({
      key: 'ArrowRight',
      ctrlKey: true,
      preventDefault() {
        preventDefaultCount += 1;
      },
    }));
    keydownHandler(createBaseEvent({
      key: 'ArrowLeft',
      ctrlKey: true,
      preventDefault() {
        preventDefaultCount += 1;
      },
    }));

    assert.deepEqual(stepCalls, [1, -1]);
    assert.equal(preventDefaultCount, 2);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers local q rotation keeps baseRotation for VRM all-parent style bones', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const windowListeners = new Map();
  const baseRotation = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI);
  const instance = {
    model: {
      bones: [
        { parentIndex: -1, flags: 0x0002, name: '全ての親' },
      ],
    },
    scene: {
      ikTargets: [],
      boneLocalTransforms: [
        {
          localY: [0, 1, 0],
          baseRotation,
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          translation: [0, 0, 0],
          manualTranslation: [0, 0, 0],
        },
      ],
    },
  };
  let capturedRotation = null;

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, activeBoneIndex: 0, selectedBoneIndex: 0, selectedTargetIndex: -1 },
      modelManager: {
        instances: [instance],
        setManualLocalRotationQuaternion(_instance, _boneIndex, rotation) {
          capturedRotation = quat.clone(rotation);
        },
        setManualLocalPosition() {},
      },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {},
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    const keydownHandler = windowListeners.get('keydown');
    assert.ok(keydownHandler);
    keydownHandler(createBaseEvent({ key: 'q' }));

    assert.equal(capturedRotation, null);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('setupInputHandlers local d movement uses unfolded VRM hips display position', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const canvas = createCanvasStub();
  const windowListeners = new Map();
  const instance = {
    model: {
      magic: 'Vrm',
      bones: [
        { parentIndex: -1, flags: 0x0002, name: '全ての親' },
        { parentIndex: 0, flags: 0x0002, name: 'Hips' },
      ],
      vrm: {
        humanoidBoneNameMap: {
          hips: 'Hips',
        },
      },
    },
    scene: {
      ikTargets: [],
      boneLocalTransforms: [
        {
          localY: [0, 1, 0],
          baseRotation: [0, 0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          translation: [1, 0, 1],
          manualTranslation: [0, 0, 0],
        },
        {
          localY: [0, 1, 0],
          baseRotation: [0, 0, 0, 1],
          manualRotation: [0, 0, 0, 1],
          rotation: [0, 0, 0, 1],
          translation: [1, -1, 1],
          manualTranslation: [0, 0, 0],
        },
      ],
    },
  };
  let capturedPosition = null;

  globalThis.window = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    },
    exitAppFullscreen() {},
  };
  globalThis.document = {
    activeElement: { tagName: 'BODY' },
    body: {
      classList: {
        contains() {
          return false;
        },
      },
    },
    getElementById() {
      return null;
    },
  };

  try {
    setupInputHandlers({
      canvas,
      camera: {
        center: [0, 0, 0],
        distance: 10,
        phi: 0,
        theta: 0,
        isDragging: false,
        isPanning: false,
      },
      selection: { activeInstanceIndex: 0, activeBoneIndex: 1, selectedBoneIndex: 1, selectedTargetIndex: -1 },
      modelManager: {
        instances: [instance],
        setManualLocalRotationQuaternion() {},
        setManualLocalPosition(_instance, _boneIndex, position) {
          capturedPosition = Array.from(position);
        },
      },
      physicsEngine: { rayTest() { return null; } },
      refreshScene() {} ,
      activateInstance() {},
      timelineManager: null,
      gizmoState: { isDragging: false },
      depthPickState: { enabled: false },
      queueDepthPick() {},
      clearCameraLookAtTarget() {
        return false;
      },
    });

    const keydownHandler = windowListeners.get('keydown');
    assert.ok(keydownHandler);
    keydownHandler(createBaseEvent({ key: 'd' }));

    assert.equal(capturedPosition, null);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
