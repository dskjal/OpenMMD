import assert from 'node:assert/strict';
import test from 'node:test';
import { quat } from '../source/lib/esm/index.js';
import { getBoneInfoDisplayValues, getBoneInfoDisplayWorldPosition } from '../source/shared/bones/bone-display-utils.js';
import { AnimationController } from '../source/core/animation/animation.js';
import { applyAnimationMappingToController } from '../source/core/animation/animation-mapper.js';
import { createEmptyAnimationClip } from '../source/core/animation/animation-clip.js';
import { createSceneState, findBoneIndexByName, loadModelDataFromFile } from '../source/core/model/model-scene.js';
import { ModelManager } from '../source/core/model/model-manager.js';
import { VRMALoader } from '../source/infrastructure/loaders/vrma-loader.js';
import { VRMAWriter } from '../source/infrastructure/loaders/vrma-writer.js';
import { upsertAnimationClipBoneKeyframe } from '../source/infrastructure/animation/gltf-animation.js';
import {
  createFileFetchMock,
  createFileLike,
  createFileReaderMock,
  createMockDevice,
} from './runtime-test-helpers.mjs';

const ALICIA_VRM_PATH = './test-data/AliciaSolid.vrm';
const ALL_PARENT_BONE_NAME = '全ての親';
const HIPS_BONE_NAME = 'hips';
const TIMELINE_FPS = 30;

/**
 * VRMA round-trip テスト用のモデルを読み込みます。
 * @returns {Promise<object>} 読み込み済みモデル。
 */
async function loadAliciaModel() {
  const loaded = await loadModelDataFromFile(createFileLike(ALICIA_VRM_PATH), 1);
  return loaded.model;
}

/**
 * 指定した VRMA クリップを作成します。
 * @param {string} name - クリップ名。
 * @returns {object} 空の VRMA クリップ。
 */
function createVrmaClip(name) {
  return createEmptyAnimationClip({
    name,
    timelineFps: TIMELINE_FPS,
    metadata: {
      sourceFormat: 'vrma',
    },
  });
}

/**
 * ボーンのキーを追加します。
 * @param {object} clip - 対象 clip。
 * @param {string} boneName - ボーン名。
 * @param {object} values - 追加値。
 * @param {ArrayLike<number>|null|undefined} [values.translation] - 移動。
 * @param {ArrayLike<number>|null|undefined} [values.rotation] - 回転 quaternion。
 */
function upsertBoneKeyframeValues(clip, boneName, values) {
  if (values.translation) {
    upsertAnimationClipBoneKeyframe(clip, boneName, 0, {
      translation: Array.from(values.translation),
    });
  }
  if (values.rotation) {
    upsertAnimationClipBoneKeyframe(clip, boneName, 0, {
      rotation: Array.from(values.rotation),
    });
  }
}

/**
 * degree から quaternion を作成します。
 * @param {ArrayLike<number>} degrees - XYZ 度数法。
 * @returns {number[]} quaternion。
 */
function quaternionFromDegrees(degrees) {
  const rotation = quat.create();
  quat.fromEuler(
    rotation,
    Number(degrees?.[0]) || 0,
    Number(degrees?.[1]) || 0,
    Number(degrees?.[2]) || 0,
  );
  quat.normalize(rotation, rotation);
  return Array.from(rotation);
}

/**
 * 新しい VRMA 書き出し環境を作成します。
 * @param {object} model - 対象モデル。
 * @param {object} source - アニメーション source。
 * @returns {object} シーンとインスタンス。
 */
function createPlaybackEnvironment(model, source) {
  const device = createMockDevice();
  const scene = createSceneState(device, model);
  const manager = new ModelManager(device, {}, 'bgra8unorm', 1, {});
  const instance = {
    model,
    scene,
    animationSource: source,
    animationSourceName: source.name,
    animationSourceType: 'vrma',
    animationMappingBySourceKey: new Map(),
    animationController: new AnimationController(model, { setWeight() {} }),
  };

  scene.modelManager = manager;
  manager.instances = [instance];
  instance.animationController.setAnimationClip(source.clip);
  applyAnimationMappingToController(instance, source);
  instance.animationController.update(
    0,
    scene.boneLocalTransforms,
    manager.markBoneLocalTransformDirty.bind(manager),
    {
      currentFrame: 0,
      skipPlaybackAdvance: true,
    },
  );
  manager.recomputeBoneMatrices(model, scene);

  return { device, scene, manager, instance };
}

/**
 * 指定ボーンの UI ワールド姿勢を取り出します。
 * @param {object} model - 対象モデル。
 * @param {object} scene - 対象 scene。
 * @param {object} instance - 対象 instance。
 * @param {string} boneName - ボーン名。
 * @returns {{position: number[], rotation: number[]}} ワールド姿勢。
 */
function captureBoneWorldState(model, scene, instance, boneName) {
  const boneIndex = findBoneIndexByName(model, boneName);
  assert.notEqual(boneIndex, -1, `missing bone: ${boneName}`);
  return {
    position: Array.from(getBoneInfoDisplayWorldPosition(instance, boneIndex) || [0, 0, 0]),
    rotation: Array.from(getBoneInfoDisplayValues(instance, boneIndex, true)?.rotation || [0, 0, 0, 1]),
  };
}

/**
 * 位置を比較します。
 * @param {ArrayLike<number>} actual - 実値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertVectorClose(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs((Number(actual[index]) || 0) - (Number(expected[index]) || 0)) <= epsilon,
      `expected ${Array.from(actual)} to be close to ${Array.from(expected)}`,
    );
  }
}

/**
 * quaternion を比較します。
 * @param {ArrayLike<number>} actual - 実値。
 * @param {ArrayLike<number>} expected - 期待値。
 * @param {number} [epsilon=1e-6] - 許容誤差。
 */
function assertQuaternionClose(actual, expected, epsilon = 1e-6) {
  const normalizedActual = normalizeQuaternion(actual);
  const normalizedExpected = normalizeQuaternion(expected);
  const directDiff = Math.max(
    Math.abs(normalizedActual[0] - normalizedExpected[0]),
    Math.abs(normalizedActual[1] - normalizedExpected[1]),
    Math.abs(normalizedActual[2] - normalizedExpected[2]),
    Math.abs(normalizedActual[3] - normalizedExpected[3]),
  );
  const flippedDiff = Math.max(
    Math.abs(normalizedActual[0] + normalizedExpected[0]),
    Math.abs(normalizedActual[1] + normalizedExpected[1]),
    Math.abs(normalizedActual[2] + normalizedExpected[2]),
    Math.abs(normalizedActual[3] + normalizedExpected[3]),
  );
  assert.ok(
    Math.min(directDiff, flippedDiff) <= epsilon,
    `expected quaternion ${Array.from(normalizedActual)} to be close to ${Array.from(normalizedExpected)}`,
  );
}

/**
 * quaternion を正規化します。
 * @param {ArrayLike<number>} value - 入力 quaternion。
 * @returns {number[]} 正規化済み quaternion。
 */
function normalizeQuaternion(value) {
  const x = Number(value?.[0]) || 0;
  const y = Number(value?.[1]) || 0;
  const z = Number(value?.[2]) || 0;
  const w = Number.isFinite(Number(value?.[3])) ? Number(value[3]) : 1;
  const length = Math.hypot(x, y, z, w);
  if (length <= 1e-8) {
    return [0, 0, 0, 1];
  }
  return [x / length, y / length, z / length, w / length];
}

/**
 * VRMA の round-trip を実行し、指定ボーンのワールド姿勢を返します。
 * @param {object} source - 書き出し元 source。
 * @param {string} boneName - 追跡するボーン名。
 * @param {object} [exportOptions={}] - VRMA export options.
 * @returns {Promise<{baseline: {position: number[], rotation: number[]}, playback: {position: number[], rotation: number[]}}>} 姿勢。
 */
async function roundTripAndCapture(source, boneName, exportOptions = {}) {
  const baselineModel = await loadAliciaModel();
  const baselineEnvironment = createPlaybackEnvironment(baselineModel, source);
  const baseline = captureBoneWorldState(baselineModel, baselineEnvironment.scene, baselineEnvironment.instance, boneName);

  const exported = await new VRMAWriter().write(source, {
    model: baselineModel,
    bakeIkToRotation: false,
    bakeLowerBodyToHumanoid: false,
    ...exportOptions,
  });
  const reparsed = await new VRMALoader().parse(exported, `${source.name}-roundtrip.vrma`);
  const playbackModel = await loadAliciaModel();
  const playbackEnvironment = createPlaybackEnvironment(playbackModel, reparsed);
  const playback = captureBoneWorldState(playbackModel, playbackEnvironment.scene, playbackEnvironment.instance, boneName);

  return { baseline, playback, reparsed };
}

/**
 * 指定ワールド回転を再現する raw VRMA local rotation を求めます。
 * @param {object} clip - 事前設定済み clip。
 * @param {ArrayLike<number>} targetWorldRotation - 目標ワールド回転 quaternion。
 * @returns {Promise<number[]>} raw VRMA local rotation。
 */
async function resolveHipsRawVrmaRotationForWorldTarget(clip, targetWorldRotation) {
  const model = await loadAliciaModel();
  const environment = createPlaybackEnvironment(model, {
    kind: 'vrma',
    name: `${String(clip?.name || 'Clip')}.vrma`,
    clip,
  });
  const hipsBoneIndex = findBoneIndexByName(model, 'Hips');
  assert.notEqual(hipsBoneIndex, -1, 'missing hips bone');
  const parentBoneIndex = Number.isInteger(model?.bones?.[hipsBoneIndex]?.parentIndex)
    ? model.bones[hipsBoneIndex].parentIndex
    : -1;
  assert.notEqual(parentBoneIndex, -1, 'hips must have a parent');
  const parentWorldRotation = environment.scene.boneLocalTransforms[parentBoneIndex]?.worldRotation || [0, 0, 0, 1];
  const inverseParentWorldRotation = quat.invert(quat.create(), parentWorldRotation);
  const localRotation = quat.multiply(quat.create(), inverseParentWorldRotation, normalizeQuaternion(targetWorldRotation));
  quat.normalize(localRotation, localRotation);
  return Array.from(localRotation);
}

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 translation [1,1,1] with IK bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('AllParentTranslationNoBake');
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, { translation: [1, 1, 1] });
    const source = { kind: 'vrma', name: 'AllParentTranslationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 rotation [45,45,45] with IK bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('AllParentRotationNoBake');
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, { rotation: quaternionFromDegrees([45, 45, 45]) });
    const source = { kind: 'vrma', name: 'AllParentRotationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 translation [1,1,1] and rotation [45,45,45] with IK bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('AllParentTranslationRotationNoBake');
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, {
      translation: [1, 1, 1],
      rotation: quaternionFromDegrees([45, 45, 45]),
    });
    const source = { kind: 'vrma', name: 'AllParentTranslationRotationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps hips translation [1,1,1] with lower-body bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('HipsTranslationNoBake');
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, { translation: [1, 1, 1] });
    const source = { kind: 'vrma', name: 'HipsTranslationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps hips rotation [45,45,45] with lower-body bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('HipsRotationNoBake');
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, { rotation: quaternionFromDegrees([45, 45, 45]) });
    const source = { kind: 'vrma', name: 'HipsRotationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps hips translation [1,1,1] and rotation [45,45,45] with lower-body bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('HipsTranslationRotationNoBake');
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, {
      translation: [1, 1, 1],
      rotation: quaternionFromDegrees([45, 45, 45]),
    });
    const source = { kind: 'vrma', name: 'HipsTranslationRotationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 and hips translation stable with IK bake enabled and lower-body bake disabled', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('RootAndHipsTranslationBakeIkNoLowerBody');
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, {
      translation: [1, 1, 1],
      rotation: quaternionFromDegrees([45, 45, 45]),
    });
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, {
      translation: [1, 1, 1],
    });
    const source = { kind: 'vrma', name: 'RootAndHipsTranslationBakeIkNoLowerBody.vrma', clip };

    const { baseline, playback, reparsed } = await roundTripAndCapture(source, HIPS_BONE_NAME, {
      bakeIkToRotation: true,
      bakeLowerBodyToHumanoid: false,
    });

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);

    const hipsTranslationChannel = reparsed.clip.channels.find((channel) => (
      channel?.target?.kind === 'bone'
      && channel?.target?.name === HIPS_BONE_NAME
      && channel?.target?.path === 'translation'
    ));
    assert.ok(hipsTranslationChannel);
    assertVectorClose(hipsTranslationChannel.target.bindTranslation, [0, 0.9714602, 0], 1e-6);
    assertVectorClose(hipsTranslationChannel.sampler.keyframes[0].value, [1, 0.0285398, 1], 1e-6);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 translation [1,1,1], rotation [45,45,45], and hips translation [1,1,1] with world position close to the expected value', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('RootAndHipsTranslationNoBake');
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, {
      translation: [1, 1, 1],
      rotation: quaternionFromDegrees([45, 45, 45]),
    });
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, {
      translation: [1, 1, 1],
    });
    const source = { kind: 'vrma', name: 'RootAndHipsTranslationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
    assertVectorClose(
      playback.position,
      [2.207106828689575, 2.207106828689575, 1.2928931713104248],
      1e-6,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});

test('AliciaSolid.vrm VRMA round-trip keeps 全ての親 translation [1,1,1], rotation [45,45,45], and hips translation [1,1,1] plus rotation [45,45,45] with world pose close to the expected value', async () => {
  const originalFetch = globalThis.fetch;
  const originalSelf = globalThis.self;
  const originalFileReader = globalThis.FileReader;
  globalThis.fetch = createFileFetchMock();
  globalThis.self = globalThis;
  globalThis.FileReader = createFileReaderMock();

  try {
    const clip = createVrmaClip('RootAndHipsTranslationRotationNoBake');
    const expectedWorldRotation = [0.4267767369747162, 0.323223352432251, 0.7803300619125366, 0.3232233226299286];
    upsertBoneKeyframeValues(clip, ALL_PARENT_BONE_NAME, {
      translation: [1, 1, 1],
      rotation: quaternionFromDegrees([45, 45, 45]),
    });
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, {
      translation: [1, 1, 1],
    });
    upsertBoneKeyframeValues(clip, HIPS_BONE_NAME, {
      rotation: await resolveHipsRawVrmaRotationForWorldTarget(clip, expectedWorldRotation),
    });
    const source = { kind: 'vrma', name: 'RootAndHipsTranslationRotationNoBake.vrma', clip };

    const { baseline, playback } = await roundTripAndCapture(source, HIPS_BONE_NAME);

    assertVectorClose(playback.position, baseline.position);
    assertQuaternionClose(playback.rotation, baseline.rotation);
    assertVectorClose(
      playback.position,
      [2.207106828689575, 2.207106828689575, 1.2928931713104248],
      1e-6,
    );
    assertQuaternionClose(
      playback.rotation,
      expectedWorldRotation,
      1e-6,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.self = originalSelf;
    globalThis.FileReader = originalFileReader;
  }
});
