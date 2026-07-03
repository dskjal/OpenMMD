import { reverseTriangleWinding } from './triangle-winding.js';

/**
 * 左手系の position を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} position - 左手系の position。
 * @returns {number[]} 右手系の position。
 */
export function convertLeftHandedPositionToRightHanded(position) {
  const source = Array.isArray(position) || ArrayBuffer.isView(position) ? position : [0, 0, 0];
  return [
    Number(source[0]) || 0,
    Number(source[1]) || 0,
    -(Number(source[2]) || 0),
  ];
}

/**
 * 左手系の VRMA position を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} position - 左手系の position。
 * @returns {number[]} 右手系の position。
 */
export function convertLeftHandedPositionToRightHandedForVRMA(position) {
  const source = Array.isArray(position) || ArrayBuffer.isView(position) ? position : [0, 0, 0];
  return [
    -(Number(source[0]) || 0),
    Number(source[1]) || 0,
    -(Number(source[2]) || 0),
  ];
}

/**
 * 左手系の quaternion を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} rotation - 左手系の quaternion。
 * @returns {number[]} 右手系の quaternion。
 */
export function convertLeftHandedQuaternionToRightHanded(rotation) {
  const source = Array.isArray(rotation) || ArrayBuffer.isView(rotation) ? rotation : [0, 0, 0, 1];
  const w = Number(source[3]);
  return [
    -(Number(source[0]) || 0),
    -(Number(source[1]) || 0),
    Number(source[2]) || 0,
    Number.isFinite(w) ? w : 1,
  ];
}

/**
 * 左手系の Euler を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} rotation - 左手系の Euler。
 * @returns {number[]} 右手系の Euler。
 */
export function convertLeftHandedEulerToRightHandedForVRMA(rotation) {
  const source = Array.isArray(rotation) || ArrayBuffer.isView(rotation) ? rotation : [0, 0, 0];
  return [
    -(Number(source[0]) || 0),
    (Number(source[1]) || 0),
    -Number(source[2]) || 0,
  ];
}

/**
 * 左手系の quaternion を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} rotation - 左手系の quaternion。
 * @returns {number[]} 右手系の quaternion。
 */
export function convertLeftHandedQuaternionToRightHandedForVRMA(rotation) {
  const source = Array.isArray(rotation) || ArrayBuffer.isView(rotation) ? rotation : [0, 0, 0, 1];
  const w = Number(source[3]);
  return [
    -(Number(source[0]) || 0),
    (Number(source[1]) || 0),
    -Number(source[2]) || 0,
    Number.isFinite(w) ? w : 1,
  ];
}

/**
 * 左手系の Euler を OpenMMD の右手系へ変換します。
 * @param {Array<number>|Float32Array|undefined|null} rotation - 左手系の Euler。
 * @returns {number[]} 右手系の Euler。
 */
export function convertLeftHandedEulerToRightHanded(rotation) {
  const source = Array.isArray(rotation) || ArrayBuffer.isView(rotation) ? rotation : [0, 0, 0];
  return [
    -(Number(source[0]) || 0),
    -(Number(source[1]) || 0),
    Number(source[2]) || 0,
  ];
}

/**
 * VRM を OpenMMD の内部向きへ正規化します。
 * @param {object} model - 変換済みモデル。
 * @returns {object} 更新後モデル。
 */
export function convertModelToPositiveZFacing(model) {
  if (!model || typeof model !== 'object') {
    return model;
  }

  convertModelVerticesToPositiveZ(model.vertices);
  reverseTriangleWinding(model.indices);
  convertModelBonesToPositiveZ(model.bones);
  convertModelMorphsToPositiveZ(model.morphs);
  convertModelRigidBodiesToPositiveZ(model.rigidBodies);
  convertModelJointsToPositiveZ(model.joints);
  convertVrmSpringBoneToPositiveZ(model?.vrm?.springBone);
  convertGltfAnimationSourcesToPositiveZ(model.gltfAnimationSources);
  convertGltfSceneToPositiveZ(model.gltfAssetContext?.scene);
  markModelAsRightHanded(model);
  return model;
}

/**
 * モデルを右手系として扱うことを明示します。
 * @param {object} model - 変換済みモデル。
 * @returns {object} 更新後モデル。
 */
export function markModelAsRightHanded(model) {
  if (!model || typeof model !== 'object') {
    return model;
  }

  model.gltfAssetContext = {
    ...(model.gltfAssetContext || {}),
    sourceHandedness: 'right',
  };
  return model;
}

/**
 * 頂点配列を OpenMMD の内部向きへ正規化します。
 * @param {ArrayLike<number>|null|undefined} vertices - 頂点配列。
 */
function convertModelVerticesToPositiveZ(vertices) {
  if (!vertices || typeof vertices.length !== 'number') {
    return;
  }

  const stride = 27;
  if (vertices.length % stride !== 0) {
    return;
  }

  for (let offset = 0; offset < vertices.length; offset += stride) {
    vertices[offset + 2] = flipNumber(vertices[offset + 2]);
    vertices[offset + 5] = flipNumber(vertices[offset + 5]);
    vertices[offset + 19] = flipNumber(vertices[offset + 19]);
    vertices[offset + 22] = flipNumber(vertices[offset + 22]);
    vertices[offset + 25] = flipNumber(vertices[offset + 25]);
  }
}

/**
 * ボーン配列を OpenMMD の内部向きへ正規化します。
 * @param {Array<object>|null|undefined} bones - ボーン配列。
 */
function convertModelBonesToPositiveZ(bones) {
  if (!Array.isArray(bones)) {
    return;
  }

  for (const bone of bones) {
    if (!bone || typeof bone !== 'object') {
      continue;
    }

    convertVector3LikeInPlace(bone.position, true);
    convertVector3LikeInPlace(bone.tailOffset, true);
    convertVector3LikeInPlace(bone.localX, true);
    convertVector3LikeInPlace(bone.localY, true);
    if (Array.isArray(bone.localX) && Array.isArray(bone.localY)) {
      bone.localZ = normalizeVector3(crossVector3(bone.localX, bone.localY), bone.localZ || [0, 0, 1]);
    }
  }
}

/**
 * morph 配列を OpenMMD の内部向きへ正規化します。
 * @param {Array<object>|null|undefined} morphs - morph 配列。
 */
function convertModelMorphsToPositiveZ(morphs) {
  if (!Array.isArray(morphs)) {
    return;
  }

  for (const morph of morphs) {
    if (!morph || typeof morph !== 'object' || !Array.isArray(morph.offsets)) {
      continue;
    }

    for (const offset of morph.offsets) {
      if (!offset || typeof offset !== 'object') {
        continue;
      }

      convertVector3LikeInPlace(offset.position, true);
      convertVector3LikeInPlace(offset.translation, true);
      convertQuaternionLikeInPlace(offset.rotation);
    }
  }
}

/**
 * rigidBody 配列を OpenMMD の内部向きへ正規化します。
 * @param {Array<object>|null|undefined} rigidBodies - rigidBody 配列。
 */
function convertModelRigidBodiesToPositiveZ(rigidBodies) {
  if (!Array.isArray(rigidBodies)) {
    return;
  }

  for (const rigidBody of rigidBodies) {
    if (!rigidBody || typeof rigidBody !== 'object') {
      continue;
    }

    convertVector3LikeInPlace(rigidBody.position, true);
    convertEulerLikeInPlace(rigidBody.rotation);
  }
}

/**
 * joint 配列を OpenMMD の内部向きへ正規化します。
 * @param {Array<object>|null|undefined} joints - joint 配列。
 */
function convertModelJointsToPositiveZ(joints) {
  if (!Array.isArray(joints)) {
    return;
  }

  for (const joint of joints) {
    if (!joint || typeof joint !== 'object') {
      continue;
    }

    convertVector3LikeInPlace(joint.position, true);
    convertEulerLikeInPlace(joint.rotation);
  }
}

/**
 * VRM SpringBone を OpenMMD の内部向きへ正規化します。
 * @param {object|null|undefined} springBone - springBone データ。
 */
function convertVrmSpringBoneToPositiveZ(springBone) {
  if (!springBone || typeof springBone !== 'object') {
    return;
  }

  for (const collider of Array.isArray(springBone.colliders) ? springBone.colliders : []) {
    if (!collider || typeof collider !== 'object' || !collider.shape || typeof collider.shape !== 'object') {
      continue;
    }

    convertVector3LikeInPlace(collider.shape.offset, true);
    convertVector3LikeInPlace(collider.shape.tail, true);
  }

  for (const spring of Array.isArray(springBone.springs) ? springBone.springs : []) {
    if (!spring || typeof spring !== 'object' || !Array.isArray(spring.joints)) {
      continue;
    }

    for (const joint of spring.joints) {
      if (!joint || typeof joint !== 'object') {
        continue;
      }
      convertVector3LikeInPlace(joint.gravityDir, true);
    }
  }
}

/**
 * glTF animation source を OpenMMD の内部向きへ正規化します。
 * @param {Array<object>|null|undefined} sources - animation source 配列。
 */
function convertGltfAnimationSourcesToPositiveZ(sources) {
  if (!Array.isArray(sources)) {
    return;
  }

  for (const source of sources) {
    const clip = source?.clip;
    if (!clip || !Array.isArray(clip.channels)) {
      continue;
    }

    for (const channel of clip.channels) {
      const target = channel?.target || null;
      const path = String(target?.path || '');
      if (path === 'translation') {
        convertVector3LikeInPlace(target.bindTranslation, true);
      } else if (path === 'rotation') {
        convertQuaternionLikeInPlace(target.bindRotation);
      }

      const keyframes = channel?.sampler?.keyframes;
      if (!Array.isArray(keyframes)) {
        continue;
      }

      for (const keyframe of keyframes) {
        if (!keyframe || typeof keyframe !== 'object') {
          continue;
        }

        if (path === 'translation') {
          convertVector3LikeInPlace(keyframe.value, true);
        } else if (path === 'rotation') {
          convertQuaternionLikeInPlace(keyframe.value);
        }
      }
    }
  }
}

/**
 * glTF scene を OpenMMD の内部向きへ正規化します。
 * @param {object|null|undefined} scene - scene オブジェクト。
 */
function convertGltfSceneToPositiveZ(scene) {
  if (!scene || typeof scene !== 'object' || !scene.scale) {
    return;
  }

  if (typeof scene.scale.z === 'number') {
    scene.scale.z = -scene.scale.z;
  } else if (typeof scene.scale.set === 'function') {
    const x = Number(scene.scale.x) || 1;
    const y = Number(scene.scale.y) || 1;
    const z = Number(scene.scale.z) || 1;
    scene.scale.set(x, y, -z);
  }

  if (typeof scene.updateMatrixWorld === 'function') {
    scene.updateMatrixWorld(true);
  }
}

/**
 * 配列上の vec3 を Z 反転します。
 * @param {Array<number>|Float32Array|null|undefined} value - 変換対象。
 * @param {boolean} flipZ - Z 反転フラグ。
 */
function convertVector3LikeInPlace(value, flipZ) {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return;
  }

  value[0] = Number(value[0]) || 0;
  value[1] = Number(value[1]) || 0;
  if (flipZ) {
    value[2] = flipNumber(value[2]);
  } else {
    value[2] = Number(value[2]) || 0;
  }
}

/**
 * 配列上の quaternion を X/Y 反転します。
 * @param {Array<number>|Float32Array|null|undefined} value - 変換対象。
 */
function convertQuaternionLikeInPlace(value) {
  if (!value || typeof value.length !== 'number' || value.length < 4) {
    return;
  }

  value[0] = flipNumber(value[0]);
  value[1] = flipNumber(value[1]);
  value[2] = Number(value[2]) || 0;
  value[3] = Number.isFinite(Number(value[3])) ? Number(value[3]) : 1;
}

/**
 * 配列上の Euler を X/Y 反転します。
 * @param {Array<number>|Float32Array|null|undefined} value - 変換対象。
 */
function convertEulerLikeInPlace(value) {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return;
  }

  value[0] = flipNumber(value[0]);
  value[1] = flipNumber(value[1]);
  value[2] = Number(value[2]) || 0;
}

/**
 * 3 次元ベクトルの外積を返します。
 * @param {Array<number>|Float32Array} left - 左ベクトル。
 * @param {Array<number>|Float32Array} right - 右ベクトル。
 * @returns {number[]} 外積。
 */
function crossVector3(left, right) {
  const lx = Number(left?.[0]) || 0;
  const ly = Number(left?.[1]) || 0;
  const lz = Number(left?.[2]) || 0;
  const rx = Number(right?.[0]) || 0;
  const ry = Number(right?.[1]) || 0;
  const rz = Number(right?.[2]) || 0;
  return [
    ly * rz - lz * ry,
    lz * rx - lx * rz,
    lx * ry - ly * rx,
  ];
}

/**
 * 3 次元ベクトルを正規化します。
 * @param {Array<number>} value - 入力ベクトル。
 * @param {Array<number>} fallback - 既定値。
 * @returns {number[]} 正規化済みベクトル。
 */
function normalizeVector3(value, fallback) {
  const x = Number(value?.[0]) || 0;
  const y = Number(value?.[1]) || 0;
  const z = Number(value?.[2]) || 0;
  const length = Math.hypot(x, y, z);
  if (length <= 1e-8) {
    return [
      Number(fallback?.[0]) || 0,
      Number(fallback?.[1]) || 0,
      Number(fallback?.[2]) || 0,
    ];
  }

  return [x / length, y / length, z / length];
}

/**
 * 数値を反転します。
 * @param {unknown} value - 入力値。
 * @returns {number} 反転値。
 */
function flipNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  return -numeric;
}
