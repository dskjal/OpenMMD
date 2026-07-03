import assert from 'node:assert/strict';
import test from 'node:test';
import { quat } from '../source/lib/esm/index.js';
import { updateBoneAxisBuffer, updateBoneLineBuffer, updateIndicatorBuffer } from '../source/ui/ui-overlay.js';

globalThis.GPUBufferUsage ??= { STORAGE: 1, COPY_DST: 2, VERTEX: 4 };

test('updateIndicatorBuffer colors IK target cubes yellow when the IK bone is selected', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub();
  const selection = createSelectionStub({
    selectedBoneIndex: 1,
    selectedTargetIndex: -1,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readVertexColor(writeCalls[0]), [1, 1, 0]);
});

test('updateIndicatorBuffer colors IK target cubes yellow when the IK target is selected', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub();
  const selection = createSelectionStub({
    selectedBoneIndex: -1,
    selectedTargetIndex: 0,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readVertexColor(writeCalls[0]), [1, 1, 0]);
});

test('updateIndicatorBuffer colors IK target cubes red when nothing is selected', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub();
  const selection = createSelectionStub({
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readVertexColor(writeCalls[0]), [1, 0, 0]);
});

test('updateIndicatorBuffer rotates IK target cubes with the bone world rotation', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub({
    scene: {
      boneLocalTransforms: [
        { worldRotation: quat.create() },
        { worldRotation: quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2) },
        { worldRotation: quat.create() },
      ],
    },
  });
  const selection = createSelectionStub({
    selectedBoneIndex: -1,
    selectedTargetIndex: -1,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  const actual = readVertexPosition(writeCalls[0]);
  assert.ok(Math.abs(actual[0] - 1.05) < 1e-5);
  assert.ok(Math.abs(actual[1] + 0.05) < 1e-5);
  assert.ok(Math.abs(actual[2] + 0.05) < 1e-5);
});

test('updateIndicatorBuffer colors the active custom rig bone red', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createCustomRigInstanceStub(['全ての親']);
  const selection = createSelectionStub({
    selectedBoneIndices: [0],
    activeBoneIndex: 0,
    selectedBoneIndex: 0,
    selectedTargetIndex: -1,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readUniqueVertexColors(writeCalls[0]), [[1, 0, 0]]);
});

test('updateIndicatorBuffer colors non-active multi-selected custom rig bones light red', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createCustomRigInstanceStub(['全ての親', 'センター']);
  const selection = createSelectionStub({
    selectedBoneIndices: [0, 1],
    activeBoneIndex: 0,
    selectedBoneIndex: 0,
    selectedTargetIndex: -1,
  });

  updateIndicatorBuffer(device, instance, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readUniqueVertexColors(writeCalls[0]), [[1, 0, 0], [1, 0.4, 0.4]]);
});

test('updateBoneLineBuffer colors the active bone red and multi-selected bones light red', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const model = {
    bones: [
      { name: 'bone-0', parentIndex: -1, tailIndex: 1 },
      { name: 'bone-1', parentIndex: 0, tailIndex: 0 },
    ],
    ik: [],
  };
  const scene = {
    boneCount: 2,
    boneWorldPositions: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    boneDebugLists: {
      hiddenBoneIndexSet: new Set(),
      nonVisibleBoneIndexSet: new Set(),
    },
    uiOverlay: {
      boneLineVertexBuffer: {
        size: 4096,
        destroy() {},
      },
      boneLineVertexCount: 0,
    },
  };
  const selection = createSelectionStub({
    selectedBoneIndices: [0, 1],
    activeBoneIndex: 0,
    selectedBoneIndex: 0,
  });

  updateBoneLineBuffer(device, model, scene, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.deepEqual(readUniqueVertexColors(writeCalls[0]), [[0.6, 0.8, 1], [1, 0, 0], [1, 0.4, 0.4]]);
});

test('updateBoneAxisBuffer draws visible bone axes with gizmo colors', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub({
    scene: {
      boneLocalTransforms: [
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
        {
          worldRotation: quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 2),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
      ],
      boneWorldPositions: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      boneCount: 2,
      uiOverlay: {
        boneAxisVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        boneAxisVertexCount: 0,
      },
    },
    model: {
      bones: [
        { name: 'root', parentIndex: -1 },
        { name: 'child', parentIndex: 0 },
      ],
      ik: [],
    },
  });
  const selection = createSelectionStub({
    showBoneAxes: true,
    hideIkBones: false,
  });

  updateBoneAxisBuffer(device, instance.model, instance.scene, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.equal(instance.scene.uiOverlay.boneAxisVertexCount, 36);
  assert.deepEqual(readUniqueVertexColors(writeCalls[0]), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(readVertexPosition(writeCalls[0]), [0, 0, 0]);
  assert.ok(Math.abs(writeCalls[0][6] - 0.1) < 1e-6);
  assert.ok(Math.abs(writeCalls[0][7]) < 1e-6);
  assert.ok(Math.abs(writeCalls[0][8]) < 1e-6);
  assert.deepEqual(Array.from(writeCalls[0].slice(180, 183)), [1, 0, 0]);
  assert.ok(Math.abs(writeCalls[0][186] - 1) < 1e-6);
  assert.ok(Math.abs(writeCalls[0][187] - 0.1) < 1e-6);
  assert.ok(Math.abs(writeCalls[0][188]) < 1e-6);
});

test('updateBoneAxisBuffer skips hidden bones and IK bones when requested', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub({
    scene: {
      boneDebugLists: {
        hiddenBoneIndexSet: new Set([1]),
        nonVisibleBoneIndexSet: new Set([1]),
      },
      boneLocalTransforms: [
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
      ],
      boneWorldPositions: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      boneCount: 2,
      ikTargets: [],
      uiOverlay: {
        boneAxisVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        boneAxisVertexCount: 0,
      },
    },
    model: {
      bones: [
        { name: 'root', parentIndex: -1 },
        { name: 'hidden', parentIndex: 0 },
      ],
      ik: [
        {
          boneIndex: 0,
          links: [{ boneIndex: 1 }],
        },
      ],
    },
  });
  const selection = createSelectionStub({
    showBoneAxes: true,
    hideIkBones: true,
  });

  updateBoneAxisBuffer(device, instance.model, instance.scene, selection, true);

  assert.equal(writeCalls.length, 0);
  assert.equal(instance.scene.uiOverlay.boneAxisVertexCount, 0);
});

test('updateBoneAxisBuffer skips SpringBone bones when requested', () => {
  const writeCalls = [];
  const device = createDeviceStub(writeCalls);
  const instance = createInstanceStub({
    scene: {
      boneLocalTransforms: [
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
        {
          worldRotation: quat.create(),
          localX: [1, 0, 0],
          localY: [0, 1, 0],
          localZ: [0, 0, 1],
        },
      ],
      boneWorldPositions: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      boneCount: 2,
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        nonVisibleBoneIndexSet: new Set(),
        springBoneBoneIndexSet: new Set([1]),
      },
      ikTargets: [],
      uiOverlay: {
        boneAxisVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        boneAxisVertexCount: 0,
      },
    },
    model: {
      bones: [
        { name: 'root', parentIndex: -1 },
        { name: 'spring', parentIndex: 0 },
      ],
      ik: [],
    },
  });
  const selection = createSelectionStub({
    showBoneAxes: true,
    hideSpringBones: true,
  });

  updateBoneAxisBuffer(device, instance.model, instance.scene, selection, true);

  assert.equal(writeCalls.length, 1);
  assert.equal(instance.scene.uiOverlay.boneAxisVertexCount, 18);
});

/**
 * テスト用の device スタブを作成します。
 * @param {Array<Float32Array>} writeCalls - writeBuffer 呼び出し記録。
 * @returns {object} device スタブ。
 */
function createDeviceStub(writeCalls) {
  return {
    createBuffer({ size }) {
      return {
        size,
        destroy() {},
      };
    },
    queue: {
      writeBuffer(_buffer, _offset, data) {
        writeCalls.push(new Float32Array(data));
      },
    },
  };
}

/**
 * テスト用のインスタンスを作成します。
 * @param {object} [overrides={}] - 上書き設定。
 * @returns {object} モデルインスタンスのスタブ。
 */
function createInstanceStub(overrides = {}) {
  return createInstanceStubWithOverrides(overrides);
}

/**
 * テスト用のインスタンスを作成します。
 * @param {object} overrides - 上書き設定。
 * @returns {object} モデルインスタンスのスタブ。
 */
function createInstanceStubWithOverrides(overrides) {
  const { scene: sceneOverrides = {}, model: modelOverrides = {}, ...rootOverrides } = overrides;
  const baseBoneLocalTransforms = [
    { worldRotation: quat.create() },
    { worldRotation: quat.create() },
    { worldRotation: quat.create() },
  ];
  return {
    ...rootOverrides,
    model: {
      ...modelOverrides,
      bones: Array.isArray(modelOverrides.bones) && modelOverrides.bones.length > 0
        ? modelOverrides.bones
        : [
        { name: 'root', parentIndex: -1 },
        { name: 'ik-bone', parentIndex: 0 },
        { name: 'target-bone', parentIndex: 0 },
        ],
      ik: Array.isArray(modelOverrides.ik) ? modelOverrides.ik : [],
    },
    scene: {
      boneCount: 3,
      boneWorldPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      boneLocalTransforms: baseBoneLocalTransforms,
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        nonVisibleBoneIndexSet: new Set(),
      },
      ikTargets: [
        { boneIndex: 1, targetIndex: 2 },
      ],
      uiOverlay: {
        boneAxisVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        boneAxisVertexCount: 0,
        indicatorVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        indicatorVertexCount: 0,
      },
      ...sceneOverrides,
    },
  };
}

/**
 * テスト用のカスタムリグ表示対象を含むインスタンスを作成します。
 * @returns {object} モデルインスタンスのスタブ。
 */
function createCustomRigInstanceStub(boneNames = ['全ての親', 'センター']) {
  const bones = boneNames.map((name, index) => ({
    name,
    parentIndex: index === 0 ? -1 : 0,
  }));
  const boneWorldPositions = bones.map((_, index) => [index, 0, 0]);
  const customRigBoneIndexByName = new Map();
  for (let index = 0; index < bones.length; index++) {
    customRigBoneIndexByName.set(bones[index].name, index);
  }

  return {
    model: {
      bones,
      ik: [],
    },
    scene: {
      boneCount: bones.length,
      boneWorldPositions,
      boneDebugLists: {
        hiddenBoneIndexSet: new Set(),
        nonVisibleBoneIndexSet: new Set(),
        customRigBoneIndexByName,
      },
      ikTargets: [],
      uiOverlay: {
        boneAxisVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        boneAxisVertexCount: 0,
        indicatorVertexBuffer: {
          size: 4096,
          destroy() {},
        },
        indicatorVertexCount: 0,
      },
    },
  };
}

/**
 * テスト用の選択状態を作成します。
 * @param {object} overrides - 選択状態の上書き。
 * @returns {object} 選択状態。
 */
function createSelectionStub(overrides = {}) {
  return {
    hideIkBones: false,
    hideSpringBones: false,
    showBoneAxes: false,
    ...overrides,
  };
}

/**
 * 頂点バッファから先頭頂点の色を読み取ります。
 * @param {Float32Array} vertices - 頂点配列。
 * @returns {number[]} 先頭頂点の色。
 */
function readVertexColor(vertices) {
  assert.ok(vertices instanceof Float32Array);
  return Array.from(vertices.slice(3, 6));
}

/**
 * 先頭頂点の位置を読み取ります。
 * @param {Float32Array} vertices - 頂点配列。
 * @returns {number[]} 先頭頂点の位置。
 */
function readVertexPosition(vertices) {
  assert.ok(vertices instanceof Float32Array);
  return Array.from(vertices.slice(0, 3));
}

/**
 * 頂点配列に含まれる色の一覧を重複除去して返します。
 * @param {Float32Array} vertices - 頂点配列。
 * @returns {Array<Array<number>>} 色一覧。
 */
function readUniqueVertexColors(vertices) {
  assert.ok(vertices instanceof Float32Array);
  const colors = [];
  for (let offset = 3; offset < vertices.length; offset += 10) {
    const color = [
      roundColorComponent(vertices[offset]),
      roundColorComponent(vertices[offset + 1]),
      roundColorComponent(vertices[offset + 2]),
    ];
    if (colors.some((item) => item[0] === color[0] && item[1] === color[1] && item[2] === color[2])) {
      continue;
    }
    colors.push(color);
  }
  return colors;
}

/**
 * 色成分を比較用に丸めます。
 * @param {number} value - 色成分。
 * @returns {number} 丸め後の値。
 */
function roundColorComponent(value) {
  return Math.round(value * 1000) / 1000;
}
