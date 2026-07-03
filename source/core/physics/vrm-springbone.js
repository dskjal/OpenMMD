import { mat4, quat, vec3 } from '../../lib/esm/index.js';

const IDENTITY_QUATERNION = quat.fromValues(0, 0, 0, 1);
const DEFAULT_GRAVITY_DIRECTION = vec3.fromValues(0, -1, 0);
const MIN_DRAG_FORCE = 0;
const MAX_DRAG_FORCE = 1;
const MIN_SEGMENT_LENGTH = 0.01;
const EPSILON = 1e-6;

/**
 * VRM SpringBone メタデータを OpenMMD 用へ正規化します。
 * @param {object} model - 変換済みモデル。
 * @param {object|null} gltfJson - 元の glTF JSON。
 * @returns {object|null} 正規化済み SpringBone 情報。
 */
export function parseVrmSpringBone(model, gltfJson) {
  const vrm1SpringBone = gltfJson?.extensions?.VRMC_springBone;
  if (vrm1SpringBone && typeof vrm1SpringBone === 'object') {
    return normalizeVrm1SpringBone(model, vrm1SpringBone);
  }

  const vrm0SecondaryAnimation = gltfJson?.extensions?.VRM?.secondaryAnimation;
  if (vrm0SecondaryAnimation && typeof vrm0SecondaryAnimation === 'object') {
    return normalizeVrm0SecondaryAnimation(model, vrm0SecondaryAnimation);
  }

  return null;
}

/**
 * SpringBone 実行時 state を初期化します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @returns {object|null} 実行時 state。
 */
export function createVrmSpringBoneState(model, scene) {
  const springBone = model?.vrm?.springBone;
  if (!springBone || !Array.isArray(springBone.springs) || springBone.springs.length === 0) {
    return null;
  }

  const colliders = springBone.colliders.map((collider) => ({
    boneIndex: collider.boneIndex,
    shape: collider.shape.type,
    offset: vec3.fromValues(collider.shape.offset[0], collider.shape.offset[1], collider.shape.offset[2]),
    tail: collider.shape.type === 'capsule'
      ? vec3.fromValues(collider.shape.tail[0], collider.shape.tail[1], collider.shape.tail[2])
      : null,
    radius: collider.shape.radius,
  }));

  const springs = [];
  for (const spring of springBone.springs) {
    const segments = [];
    for (let index = 0; index < spring.joints.length - 1; index++) {
      const headJoint = spring.joints[index];
      const tailJoint = spring.joints[index + 1] || null;
      const segment = createSpringSegment(model, spring, headJoint, tailJoint);
      if (segment) {
        segments.push(segment);
      }
    }

    if (spring.joints.length === 1) {
      const singleSegment = createSpringSegment(model, spring, spring.joints[0], null);
      if (singleSegment) {
        segments.push(singleSegment);
      }
    }

    if (segments.length === 0) {
      continue;
    }

    springs.push({
      centerBoneIndex: spring.centerBoneIndex,
      colliderGroups: spring.colliderGroups.slice(),
      segments,
    });
  }

  if (springs.length === 0) {
    return null;
  }

  const state = {
    colliders,
    colliderGroups: springBone.colliderGroups.map((group) => group.colliders.slice()),
    springs,
    initialized: false,
    scratch: createScratchState(),
  };
  resetVrmSpringBoneState(model, scene, state);
  return state;
}

/**
 * SpringBone 実行時 state を現在姿勢へリセットします。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object|null} state - 実行時 state。
 */
export function resetVrmSpringBoneState(model, scene, state) {
  if (!state) {
    return;
  }

  for (const spring of state.springs) {
    for (const segment of spring.segments) {
      const tailPosition = getSegmentTailWorldPosition(model, scene, segment, state.scratch.nextTail);
      if (tailPosition) {
        vec3.copy(segment.prevTail, tailPosition);
        vec3.copy(segment.currentTail, tailPosition);
      } else {
        vec3.set(segment.prevTail, 0, 0, 0);
        vec3.set(segment.currentTail, 0, 0, 0);
      }
    }
  }

  state.initialized = true;
}

/**
 * VRM SpringBone を 1 フレーム更新します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} modelManager - ModelManager。
 * @param {number} deltaFrame - 進行フレーム数。
 * @param {number} [timelineFps=30] - 基準 FPS。
 */
export function updateVrmSpringBone(model, scene, modelManager, deltaFrame, timelineFps = 30) {
  const state = scene?.vrmSpringBoneState;
  if (!state) {
    return;
  }

  if (!state.initialized) {
    resetVrmSpringBoneState(model, scene, state);
  }

  const deltaTime = Math.max(0, Number(deltaFrame) || 0) / Math.max(1, Number(timelineFps) || 30);
  if (deltaTime <= 0) {
    return;
  }

  for (const spring of state.springs) {
    for (const segment of spring.segments) {
      updateSpringSegment(model, scene, modelManager, state, spring, segment, deltaTime);
    }
  }
}

/**
 * VRM 1.0 spring bone を正規化します。
 * @param {object} model - モデルデータ。
 * @param {object} springBone - VRMC_springBone。
 * @returns {object|null} 正規化済み spring bone。
 */
function normalizeVrm1SpringBone(model, springBone) {
  const colliders = normalizeVrm1Colliders(model, springBone.colliders);
  const colliderGroups = normalizeColliderGroups(springBone.colliderGroups, colliders.length);
  const springs = normalizeVrm1Springs(model, springBone.springs, colliderGroups.length);
  if (springs.length === 0) {
    return null;
  }

  return {
    specVersion: String(springBone.specVersion || ''),
    sourceVersion: 'vrm1-springBone',
    colliders,
    colliderGroups,
    springs,
  };
}

/**
 * VRM 0.x secondaryAnimation を正規化します。
 * @param {object} model - モデルデータ。
 * @param {object} secondaryAnimation - secondaryAnimation。
 * @returns {object|null} 正規化済み spring bone。
 */
function normalizeVrm0SecondaryAnimation(model, secondaryAnimation) {
  const colliderState = normalizeVrm0ColliderGroups(model, secondaryAnimation.colliderGroups);
  const springs = normalizeVrm0BoneGroups(model, secondaryAnimation.boneGroups, colliderState.groups.length);
  if (springs.length === 0) {
    return null;
  }

  return {
    specVersion: '',
    sourceVersion: 'vrm0-secondaryAnimation',
    colliders: colliderState.colliders,
    colliderGroups: colliderState.groups,
    springs,
  };
}

/**
 * VRM 1.0 collider 配列を正規化します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>|null|undefined} colliders - 元 collider 配列。
 * @returns {Array<object>} 正規化済み collider 配列。
 */
function normalizeVrm1Colliders(model, colliders) {
  if (!Array.isArray(colliders)) {
    return [];
  }

  const result = [];
  for (const collider of colliders) {
    const nodeIndex = Number.isInteger(collider?.node) ? collider.node : -1;
    const boneIndex = findBoneIndexByGltfNodeIndex(model, nodeIndex);
    if (boneIndex < 0) {
      continue;
    }

    const shape = normalizeVrm1ColliderShape(collider?.shape);
    if (!shape) {
      continue;
    }

    result.push({
      boneIndex,
      gltfNodeIndex: nodeIndex,
      shape,
    });
  }
  return result;
}

/**
 * VRM 1.0 collider shape を正規化します。
 * @param {object|null|undefined} shape - 元 shape。
 * @returns {object|null} 正規化済み shape。
 */
function normalizeVrm1ColliderShape(shape) {
  if (shape?.sphere && typeof shape.sphere === 'object') {
    return {
      type: 'sphere',
      offset: normalizeVec3(shape.sphere.offset, [0, 0, 0]),
      radius: Math.max(0, toFiniteNumber(shape.sphere.radius, 0)),
    };
  }

  if (shape?.capsule && typeof shape.capsule === 'object') {
    return {
      type: 'capsule',
      offset: normalizeVec3(shape.capsule.offset, [0, 0, 0]),
      tail: normalizeVec3(shape.capsule.tail, [0, 0, 0]),
      radius: Math.max(0, toFiniteNumber(shape.capsule.radius, 0)),
    };
  }

  return null;
}

/**
 * VRM 0.x colliderGroups を共通表現へ展開します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>|null|undefined} colliderGroups - 元 colliderGroups。
 * @returns {{colliders: Array<object>, groups: Array<object>}} 展開済み collider 情報。
 */
function normalizeVrm0ColliderGroups(model, colliderGroups) {
  if (!Array.isArray(colliderGroups)) {
    return { colliders: [], groups: [] };
  }

  const colliders = [];
  const groups = [];
  for (let groupIndex = 0; groupIndex < colliderGroups.length; groupIndex++) {
    const group = colliderGroups[groupIndex];
    const nodeIndex = Number.isInteger(group?.node) ? group.node : -1;
    const boneIndex = findBoneIndexByGltfNodeIndex(model, nodeIndex);
    if (boneIndex < 0) {
      groups.push({ name: '', colliders: [] });
      continue;
    }

    const colliderIndices = [];
    const groupColliders = Array.isArray(group?.colliders) ? group.colliders : [];
    for (const collider of groupColliders) {
      const radius = Math.max(0, toFiniteNumber(collider?.radius, 0));
      colliders.push({
        boneIndex,
        gltfNodeIndex: nodeIndex,
        shape: {
          type: 'sphere',
          offset: normalizeVrm0Vec3(collider?.offset, [0, 0, 0]),
          radius,
        },
      });
      colliderIndices.push(colliders.length - 1);
    }

    groups.push({
      name: String(group?.name || ''),
      colliders: colliderIndices,
    });
  }

  return { colliders, groups };
}

/**
 * collider group 配列を正規化します。
 * @param {Array<object>|null|undefined} colliderGroups - 元 collider group 配列。
 * @param {number} colliderCount - 利用可能 collider 数。
 * @returns {Array<object>} 正規化済み collider group 配列。
 */
function normalizeColliderGroups(colliderGroups, colliderCount) {
  if (!Array.isArray(colliderGroups)) {
    return [];
  }

  return colliderGroups.map((group) => ({
    name: String(group?.name || ''),
    colliders: Array.isArray(group?.colliders)
      ? group.colliders.filter((index) => Number.isInteger(index) && index >= 0 && index < colliderCount)
      : [],
  }));
}

/**
 * VRM 1.0 spring 配列を正規化します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>|null|undefined} springs - 元 spring 配列。
 * @param {number} colliderGroupCount - 利用可能 collider group 数。
 * @returns {Array<object>} 正規化済み spring 配列。
 */
function normalizeVrm1Springs(model, springs, colliderGroupCount) {
  if (!Array.isArray(springs)) {
    return [];
  }

  const result = [];
  for (const spring of springs) {
    const joints = normalizeVrm1SpringJoints(model, spring?.joints);
    if (joints.length < 2) {
      continue;
    }

    result.push({
      name: String(spring?.name || ''),
      centerBoneIndex: findBoneIndexByGltfNodeIndex(model, Number.isInteger(spring?.center) ? spring.center : -1),
      colliderGroups: normalizeColliderGroupIndices(spring?.colliderGroups, colliderGroupCount),
      joints,
    });
  }
  return result;
}

/**
 * VRM 1.0 spring joint 配列を正規化します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>|null|undefined} joints - 元 joint 配列。
 * @returns {Array<object>} 正規化済み joint 配列。
 */
function normalizeVrm1SpringJoints(model, joints) {
  if (!Array.isArray(joints)) {
    return [];
  }

  const result = [];
  for (const joint of joints) {
    const normalizedJoint = createNormalizedJoint(
      model,
      Number.isInteger(joint?.node) ? joint.node : -1,
      {
        hitRadius: joint?.hitRadius,
        stiffness: joint?.stiffness,
        gravityPower: joint?.gravityPower,
        gravityDir: joint?.gravityDir,
        dragForce: joint?.dragForce,
      },
    );
    if (normalizedJoint) {
      result.push(normalizedJoint);
    }
  }
  return result;
}

/**
 * VRM 0.x boneGroups を共通 spring へ展開します。
 * @param {object} model - モデルデータ。
 * @param {Array<object>|null|undefined} boneGroups - 元 boneGroups。
 * @param {number} colliderGroupCount - 利用可能 collider group 数。
 * @returns {Array<object>} 正規化済み spring 配列。
 */
function normalizeVrm0BoneGroups(model, boneGroups, colliderGroupCount) {
  if (!Array.isArray(boneGroups)) {
    return [];
  }

  const result = [];
  for (let groupIndex = 0; groupIndex < boneGroups.length; groupIndex++) {
    const group = boneGroups[groupIndex];
    const jointDefaults = {
      hitRadius: group?.hitRadius,
      stiffness: group?.stiffiness,
      gravityPower: group?.gravityPower,
      gravityDir: group?.gravityDir,
      dragForce: group?.dragForce,
    };
    const centerBoneIndex = findBoneIndexByGltfNodeIndex(model, Number.isInteger(group?.center) ? group.center : -1);
    const colliderGroups = normalizeColliderGroupIndices(group?.colliderGroups, colliderGroupCount);
    const rootNodes = Array.isArray(group?.bones) ? group.bones : [];

    for (let rootIndex = 0; rootIndex < rootNodes.length; rootIndex++) {
      const rootNodeIndex = Number.isInteger(rootNodes[rootIndex]) ? rootNodes[rootIndex] : -1;
      if (rootNodeIndex < 0) {
        continue;
      }

      const chainNodeIndices = collectSingleChildChainNodeIndices(model, rootNodeIndex);
      const joints = chainNodeIndices
        .map((nodeIndex) => createNormalizedJoint(model, nodeIndex, jointDefaults))
        .filter(Boolean);
      if (joints.length === 0) {
        continue;
      }

      result.push({
        name: String(group?.comment || `secondaryAnimation-${groupIndex}-${rootIndex}`),
        centerBoneIndex,
        colliderGroups,
        joints,
      });
    }
  }

  return result;
}

/**
 * 共通 joint を生成します。
 * @param {object} model - モデルデータ。
 * @param {number} nodeIndex - glTF node index。
 * @param {object} source - パラメータ元。
 * @returns {object|null} 正規化済み joint。
 */
function createNormalizedJoint(model, nodeIndex, source) {
  const boneIndex = findBoneIndexByGltfNodeIndex(model, nodeIndex);
  if (boneIndex < 0) {
    return null;
  }

  return {
    boneIndex,
    gltfNodeIndex: nodeIndex,
    hitRadius: Math.max(0, toFiniteNumber(source?.hitRadius, 0)),
    stiffness: Math.max(0, toFiniteNumber(source?.stiffness, 0)),
    gravityPower: Math.max(0, toFiniteNumber(source?.gravityPower, 0)),
    gravityDir: normalizeDirection(source?.gravityDir),
    dragForce: clamp(toFiniteNumber(source?.dragForce, 0), MIN_DRAG_FORCE, MAX_DRAG_FORCE),
  };
}

/**
 * collider group index 配列を正規化します。
 * @param {Array<number>|null|undefined} indices - 元 index 配列。
 * @param {number} colliderGroupCount - 利用可能数。
 * @returns {Array<number>} 正規化済み index 配列。
 */
function normalizeColliderGroupIndices(indices, colliderGroupCount) {
  return Array.isArray(indices)
    ? indices.filter((index) => Number.isInteger(index) && index >= 0 && index < colliderGroupCount)
    : [];
}

/**
 * 1 root から single-child chain を収集します。
 * @param {object} model - モデルデータ。
 * @param {number} rootNodeIndex - root node index。
 * @returns {Array<number>} chain node index 配列。
 */
function collectSingleChildChainNodeIndices(model, rootNodeIndex) {
  const result = [];
  const visited = new Set();
  let currentNodeIndex = rootNodeIndex;

  while (Number.isInteger(currentNodeIndex) && currentNodeIndex >= 0 && !visited.has(currentNodeIndex)) {
    visited.add(currentNodeIndex);
    result.push(currentNodeIndex);

    const currentBoneIndex = findBoneIndexByGltfNodeIndex(model, currentNodeIndex);
    if (currentBoneIndex < 0) {
      break;
    }

    const childBoneIndices = collectChildBoneIndices(model, currentBoneIndex);
    if (childBoneIndices.length !== 1) {
      break;
    }

    currentNodeIndex = model.bones[childBoneIndices[0]]?.gltfNodeIndex ?? -1;
  }

  return result;
}

/**
 * 指定ボーンの子ボーン index 一覧を返します。
 * @param {object} model - モデルデータ。
 * @param {number} parentBoneIndex - 親ボーン index。
 * @returns {Array<number>} 子ボーン index 一覧。
 */
function collectChildBoneIndices(model, parentBoneIndex) {
  const result = [];
  for (let boneIndex = 0; boneIndex < (Array.isArray(model?.bones) ? model.bones.length : 0); boneIndex++) {
    if (model.bones[boneIndex]?.parentIndex === parentBoneIndex) {
      result.push(boneIndex);
    }
  }
  return result;
}

/**
 * SpringBone runtime segment を生成します。
 * @param {object} model - モデルデータ。
 * @param {object} spring - spring 設定。
 * @param {object} headJoint - head joint。
 * @param {object|null} tailJoint - tail joint。
 * @returns {object|null} runtime segment。
 */
function createSpringSegment(model, spring, headJoint, tailJoint) {
  const headBone = model.bones[headJoint?.boneIndex];
  if (!headBone) {
    return null;
  }

  const headRotation = getBoneBaseRotation(headBone);
  const tailInfo = tailJoint
    ? createRealTailInfo(model, headJoint, tailJoint, headRotation)
    : createVirtualTailInfo(model, spring, headJoint, headRotation);
  if (!tailInfo) {
    return null;
  }

  return {
    headBoneIndex: headJoint.boneIndex,
    tailBoneIndex: tailInfo.tailBoneIndex,
    hasVirtualTail: tailInfo.hasVirtualTail,
    virtualTailOffsetLocal: tailInfo.virtualTailOffsetLocal,
    initialLocalRotation: headRotation,
    initialLocalMatrix: createInitialLocalMatrix(model, headJoint.boneIndex, headRotation),
    boneAxis: tailInfo.boneAxis,
    boneLength: tailInfo.boneLength,
    hitRadius: headJoint.hitRadius,
    stiffness: headJoint.stiffness,
    gravityPower: headJoint.gravityPower,
    gravityDir: vec3.clone(headJoint.gravityDir),
    dragForce: headJoint.dragForce,
    prevTail: vec3.create(),
    currentTail: vec3.create(),
  };
}

/**
 * 実 bone tail 用の segment 情報を返します。
 * @param {object} model - モデルデータ。
 * @param {object} headJoint - head joint。
 * @param {object} tailJoint - tail joint。
 * @param {quat} headRotation - head のベース回転。
 * @returns {object|null} tail 情報。
 */
function createRealTailInfo(model, headJoint, tailJoint, headRotation) {
  const headBone = model.bones[headJoint.boneIndex];
  const tailBone = model.bones[tailJoint.boneIndex];
  if (!headBone || !tailBone) {
    return null;
  }

  const restDelta = vec3.sub(vec3.create(), tailBone.position, headBone.position);
  const boneLength = vec3.length(restDelta);
  if (boneLength <= EPSILON) {
    return null;
  }

  const inverseHeadRotation = quat.invert(quat.create(), headRotation);
  const boneAxis = vec3.transformQuat(vec3.create(), restDelta, inverseHeadRotation);
  vec3.normalize(boneAxis, boneAxis);

  return {
    tailBoneIndex: tailJoint.boneIndex,
    hasVirtualTail: false,
    virtualTailOffsetLocal: null,
    boneAxis,
    boneLength,
  };
}

/**
 * 仮想 tail 用の segment 情報を返します。
 * @param {object} model - モデルデータ。
 * @param {object} spring - spring 設定。
 * @param {object} headJoint - head joint。
 * @param {quat} headRotation - head のベース回転。
 * @returns {object|null} tail 情報。
 */
function createVirtualTailInfo(model, spring, headJoint, headRotation) {
  const headBone = model.bones[headJoint.boneIndex];
  if (!headBone) {
    return null;
  }

  const headDirection = resolveVirtualTailDirection(model, headJoint.boneIndex);
  const boneLength = resolveVirtualTailLength(model, spring, headJoint);
  if (boneLength <= EPSILON || vec3.length(headDirection) <= EPSILON) {
    return null;
  }

  const worldOffset = vec3.scale(vec3.create(), headDirection, boneLength);
  const inverseHeadRotation = quat.invert(quat.create(), headRotation);
  const localOffset = vec3.transformQuat(vec3.create(), worldOffset, inverseHeadRotation);
  if (vec3.length(localOffset) <= EPSILON) {
    return null;
  }

  vec3.normalize(localOffset, localOffset);
  vec3.scale(localOffset, localOffset, boneLength);
  const boneAxis = vec3.normalize(vec3.create(), localOffset);

  return {
    tailBoneIndex: -1,
    hasVirtualTail: true,
    virtualTailOffsetLocal: localOffset,
    boneAxis,
    boneLength,
  };
}

/**
 * 仮想 tail の方向を解決します。
 * @param {object} model - モデルデータ。
 * @param {number} boneIndex - 対象ボーン index。
 * @returns {vec3} 仮想 tail 方向。
 */
function resolveVirtualTailDirection(model, boneIndex) {
  const bone = model.bones[boneIndex];
  if (!bone) {
    return vec3.fromValues(0, 1, 0);
  }

  const parentBone = bone.parentIndex >= 0 ? model.bones[bone.parentIndex] : null;
  if (parentBone) {
    const parentDelta = vec3.sub(vec3.create(), bone.position, parentBone.position);
    if (vec3.length(parentDelta) > EPSILON) {
      return vec3.normalize(parentDelta, parentDelta);
    }
  }

  const localYAxis = vec3.fromValues(
    toFiniteNumber(bone.localY?.[0], 0),
    toFiniteNumber(bone.localY?.[1], 1),
    toFiniteNumber(bone.localY?.[2], 0),
  );
  if (vec3.length(localYAxis) > EPSILON) {
    return vec3.normalize(localYAxis, localYAxis);
  }

  return vec3.fromValues(0, 1, 0);
}

/**
 * 仮想 tail の長さを解決します。
 * @param {object} model - モデルデータ。
 * @param {object} spring - spring 設定。
 * @param {object} headJoint - head joint。
 * @returns {number} 仮想 tail 長。
 */
function resolveVirtualTailLength(model, spring, headJoint) {
  const headBone = model.bones[headJoint.boneIndex];
  if (!headBone) {
    return Math.max(headJoint.hitRadius * 2, MIN_SEGMENT_LENGTH);
  }

  const parentBone = headBone.parentIndex >= 0 ? model.bones[headBone.parentIndex] : null;
  if (parentBone) {
    const distance = vec3.distance(headBone.position, parentBone.position);
    if (distance > EPSILON) {
      return distance;
    }
  }

  const springLengths = [];
  const joints = Array.isArray(spring?.joints) ? spring.joints : [];
  for (let index = 0; index < joints.length - 1; index++) {
    const currentBone = model.bones[joints[index]?.boneIndex];
    const nextBone = model.bones[joints[index + 1]?.boneIndex];
    if (!currentBone || !nextBone) {
      continue;
    }
    const distance = vec3.distance(currentBone.position, nextBone.position);
    if (distance > EPSILON) {
      springLengths.push(distance);
    }
  }

  if (springLengths.length > 0) {
    return computeMedian(springLengths);
  }

  return Math.max(headJoint.hitRadius * 2, MIN_SEGMENT_LENGTH);
}

/**
 * 1 セグメント分の SpringBone を更新します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} modelManager - ModelManager。
 * @param {object} state - 実行時 state。
 * @param {object} spring - Spring 設定。
 * @param {object} segment - セグメント state。
 * @param {number} deltaTime - 経過秒。
 */
function updateSpringSegment(model, scene, modelManager, state, spring, segment, deltaTime) {
  const scratch = state.scratch;
  const headLocal = scene.boneLocalTransforms[segment.headBoneIndex];
  if (!headLocal) {
    return;
  }

  const worldPosition = getWorldPosition(headLocal.worldMatrix, scratch.worldPosition);
  const inertia = computeInertia(scene, spring.centerBoneIndex, segment, scratch);
  const parentWorldRotation = resolveParentWorldRotation(model, scene, segment.headBoneIndex, scratch.parentWorldRotation);
  quat.multiply(scratch.segmentRotation, parentWorldRotation, segment.initialLocalRotation);
  vec3.transformQuat(scratch.stiffnessDirection, segment.boneAxis, scratch.segmentRotation);
  vec3.scale(scratch.stiffnessDirection, scratch.stiffnessDirection, segment.stiffness * deltaTime);

  vec3.scaleAndAdd(scratch.nextTail, segment.currentTail, inertia, 1);
  vec3.add(scratch.nextTail, scratch.nextTail, scratch.stiffnessDirection);
  vec3.scaleAndAdd(scratch.nextTail, scratch.nextTail, segment.gravityDir, segment.gravityPower * deltaTime);
  constrainTailLength(worldPosition, scratch.nextTail, segment.boneLength);
  resolveSpringCollisions(scene, state, spring, segment, scratch.nextTail);

  vec3.copy(segment.prevTail, segment.currentTail);
  vec3.copy(segment.currentTail, scratch.nextTail);

  const parentMatrix = resolveParentWorldMatrix(model, scene, segment.headBoneIndex, scratch.parentMatrix);
  const restHeadWorldMatrix = mat4.multiply(scratch.restHeadWorldMatrix, parentMatrix, segment.initialLocalMatrix);
  const inverseRestHeadWorldMatrix = mat4.invert(scratch.inverseRestHeadWorldMatrix, restHeadWorldMatrix);
  if (!inverseRestHeadWorldMatrix) {
    return;
  }

  vec3.transformMat4(scratch.localTail, scratch.nextTail, inverseRestHeadWorldMatrix);
  if (vec3.length(scratch.localTail) <= EPSILON) {
    return;
  }
  vec3.normalize(scratch.localTail, scratch.localTail);
  quat.rotationTo(scratch.deltaRotation, segment.boneAxis, scratch.localTail);
  quat.multiply(headLocal.rotation, segment.initialLocalRotation, scratch.deltaRotation);
  modelManager.markBoneLocalTransformDirty(headLocal);
  modelManager.recomputeBoneMatrices(model, scene);
}

/**
 * 現フレームの慣性ベクトルを計算します。
 * @param {object} scene - シーン状態。
 * @param {number} centerBoneIndex - center bone index。
 * @param {object} segment - セグメント state。
 * @param {object} scratch - scratch state。
 * @returns {vec3} 慣性ベクトル。
 */
function computeInertia(scene, centerBoneIndex, segment, scratch) {
  if (centerBoneIndex >= 0) {
    const centerLocal = scene.boneLocalTransforms[centerBoneIndex];
    if (centerLocal) {
      const inverseCenterMatrix = mat4.invert(scratch.inverseCenterMatrix, centerLocal.worldMatrix);
      if (inverseCenterMatrix) {
        vec3.transformMat4(scratch.currentCenterTail, segment.currentTail, inverseCenterMatrix);
        vec3.transformMat4(scratch.prevCenterTail, segment.prevTail, inverseCenterMatrix);
        vec3.sub(scratch.inertia, scratch.currentCenterTail, scratch.prevCenterTail);
        vec3.scale(scratch.inertia, scratch.inertia, 1 - segment.dragForce);
        mat4.getRotation(scratch.centerRotation, centerLocal.worldMatrix);
        vec3.transformQuat(scratch.inertia, scratch.inertia, scratch.centerRotation);
        return scratch.inertia;
      }
    }
  }

  vec3.sub(scratch.inertia, segment.currentTail, segment.prevTail);
  vec3.scale(scratch.inertia, scratch.inertia, 1 - segment.dragForce);
  return scratch.inertia;
}

/**
 * SpringBone collider との衝突を解決します。
 * @param {object} scene - シーン状態。
 * @param {object} state - 実行時 state。
 * @param {object} spring - Spring 設定。
 * @param {object} segment - セグメント state。
 * @param {vec3} nextTail - 次 tail 位置。
 */
function resolveSpringCollisions(scene, state, spring, segment, nextTail) {
  const scratch = state.scratch;
  const worldPosition = getWorldPosition(scene.boneLocalTransforms[segment.headBoneIndex].worldMatrix, scratch.worldPositionForCollision);

  for (const colliderGroupIndex of spring.colliderGroups) {
    const colliderIndices = state.colliderGroups[colliderGroupIndex] || [];
    for (const colliderIndex of colliderIndices) {
      const collider = state.colliders[colliderIndex];
      if (!collider) {
        continue;
      }

      const distance = getSpringColliderPenetration(scene, collider, segment.hitRadius, nextTail, scratch);
      if (distance >= 0) {
        continue;
      }

      vec3.scaleAndAdd(nextTail, nextTail, scratch.collisionDirection, -distance);
      constrainTailLength(worldPosition, nextTail, segment.boneLength);
    }
  }
}

/**
 * collider と tail の距離を返します。
 * @param {object} scene - シーン状態。
 * @param {object} collider - collider state。
 * @param {number} jointRadius - joint 半径。
 * @param {vec3} nextTail - tail 位置。
 * @param {object} scratch - scratch state。
 * @returns {number} 距離。負ならめり込み。
 */
function getSpringColliderPenetration(scene, collider, jointRadius, nextTail, scratch) {
  const colliderLocal = scene.boneLocalTransforms[collider.boneIndex];
  if (!colliderLocal) {
    return Infinity;
  }

  const origin = transformPoint(colliderLocal.worldMatrix, collider.offset, scratch.colliderOrigin);
  if (collider.shape === 'sphere') {
    vec3.sub(scratch.collisionDelta, nextTail, origin);
    return finalizeCollisionDistance(collider.radius, jointRadius, scratch);
  }

  const tail = transformPoint(colliderLocal.worldMatrix, collider.tail, scratch.colliderTail);
  vec3.sub(scratch.colliderAxis, tail, origin);
  vec3.sub(scratch.collisionDelta, nextTail, origin);
  const axisLengthSquared = vec3.squaredLength(scratch.colliderAxis);
  if (axisLengthSquared > 1e-8) {
    const dot = vec3.dot(scratch.collisionDelta, scratch.colliderAxis);
    if (dot > 0 && dot < axisLengthSquared) {
      vec3.scale(scratch.projectedAxis, scratch.colliderAxis, dot / axisLengthSquared);
      vec3.sub(scratch.collisionDelta, scratch.collisionDelta, scratch.projectedAxis);
    } else if (dot >= axisLengthSquared) {
      vec3.sub(scratch.collisionDelta, nextTail, tail);
    }
  }
  return finalizeCollisionDistance(collider.radius, jointRadius, scratch);
}

/**
 * 衝突距離を確定します。
 * @param {number} colliderRadius - collider 半径。
 * @param {number} jointRadius - joint 半径。
 * @param {object} scratch - scratch state。
 * @returns {number} 距離。負ならめり込み。
 */
function finalizeCollisionDistance(colliderRadius, jointRadius, scratch) {
  const magnitude = vec3.length(scratch.collisionDelta);
  if (magnitude <= 1e-8) {
    vec3.set(scratch.collisionDirection, 0, 1, 0);
    return -(colliderRadius + jointRadius);
  }

  vec3.scale(scratch.collisionDirection, scratch.collisionDelta, 1 / magnitude);
  return magnitude - colliderRadius - jointRadius;
}

/**
 * tail の長さ拘束を適用します。
 * @param {vec3} worldPosition - head のワールド位置。
 * @param {vec3} nextTail - tail 位置。
 * @param {number} boneLength - 長さ。
 */
function constrainTailLength(worldPosition, nextTail, boneLength) {
  vec3.sub(nextTail, nextTail, worldPosition);
  if (vec3.length(nextTail) <= 1e-8) {
    nextTail[1] = boneLength;
  } else {
    vec3.normalize(nextTail, nextTail);
    vec3.scale(nextTail, nextTail, boneLength);
  }
  vec3.add(nextTail, worldPosition, nextTail);
}

/**
 * 親ワールド回転を解決します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {number} boneIndex - ボーン index。
 * @param {quat} out - 出力先。
 * @returns {quat} out。
 */
function resolveParentWorldRotation(model, scene, boneIndex, out) {
  const bone = model.bones[boneIndex];
  const parentIndex = bone?.parentIndex ?? -1;
  if (parentIndex < 0) {
    return quat.copy(out, IDENTITY_QUATERNION);
  }
  const parentLocal = scene.boneLocalTransforms[parentIndex];
  return parentLocal ? quat.copy(out, parentLocal.worldRotation) : quat.copy(out, IDENTITY_QUATERNION);
}

/**
 * 親ワールド行列を解決します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {number} boneIndex - ボーン index。
 * @param {mat4} out - 出力先。
 * @returns {mat4} out。
 */
function resolveParentWorldMatrix(model, scene, boneIndex, out) {
  const bone = model.bones[boneIndex];
  const parentIndex = bone?.parentIndex ?? -1;
  if (parentIndex < 0) {
    return mat4.identity(out);
  }
  const parentLocal = scene.boneLocalTransforms[parentIndex];
  return parentLocal ? mat4.copy(out, parentLocal.worldMatrix) : mat4.identity(out);
}

/**
 * 現在姿勢から segment の tail world 位置を返します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} segment - セグメント state。
 * @param {vec3} out - 出力先。
 * @returns {vec3|null} tail world 位置。
 */
function getSegmentTailWorldPosition(model, scene, segment, out) {
  if (!segment.hasVirtualTail && segment.tailBoneIndex >= 0) {
    const tailPosition = scene?.boneWorldPositions?.[segment.tailBoneIndex];
    if (tailPosition) {
      return vec3.set(out, tailPosition[0], tailPosition[1], tailPosition[2]);
    }
  }

  const headLocal = scene?.boneLocalTransforms?.[segment.headBoneIndex];
  if (!headLocal) {
    return null;
  }

  if (segment.hasVirtualTail && segment.virtualTailOffsetLocal) {
    return transformPoint(headLocal.worldMatrix, segment.virtualTailOffsetLocal, out);
  }

  return getWorldPosition(headLocal.worldMatrix, out);
}

/**
 * ボーンの初期ローカル行列を作成します。
 * @param {object} model - モデルデータ。
 * @param {number} boneIndex - ボーン index。
 * @param {quat} rotation - 初期ローカル回転。
 * @returns {mat4} 初期ローカル行列。
 */
function createInitialLocalMatrix(model, boneIndex, rotation) {
  const bone = model.bones[boneIndex];
  const parent = bone?.parentIndex >= 0 ? model.bones[bone.parentIndex] : null;
  const translation = parent
    ? [bone.position[0] - parent.position[0], bone.position[1] - parent.position[1], bone.position[2] - parent.position[2]]
    : [bone.position[0], bone.position[1], bone.position[2]];
  return mat4.fromRotationTranslation(mat4.create(), rotation, translation);
}

/**
 * ボーンのベース回転を返します。
 * @param {object} bone - ボーン。
 * @returns {quat} ベース回転。
 */
function getBoneBaseRotation(bone) {
  const matrix = [
    bone?.localX?.[0] ?? 1,
    bone?.localX?.[1] ?? 0,
    bone?.localX?.[2] ?? 0,
    bone?.localY?.[0] ?? 0,
    bone?.localY?.[1] ?? 1,
    bone?.localY?.[2] ?? 0,
    bone?.localZ?.[0] ?? 0,
    bone?.localZ?.[1] ?? 0,
    bone?.localZ?.[2] ?? 1,
  ];
  return quat.normalize(quat.create(), quat.fromMat3(quat.create(), matrix));
}

/**
 * glTF node index から bone index を返します。
 * @param {object} model - モデルデータ。
 * @param {number} nodeIndex - glTF node index。
 * @returns {number} bone index。見つからない場合は -1。
 */
function findBoneIndexByGltfNodeIndex(model, nodeIndex) {
  if (!Array.isArray(model?.bones) || nodeIndex < 0) {
    return -1;
  }

  for (let index = 0; index < model.bones.length; index++) {
    if (model.bones[index]?.gltfNodeIndex === nodeIndex) {
      return index;
    }
  }
  return -1;
}

/**
 * vec3 を正規化して返します。
 * @param {Array<number>|null|undefined} value - 元配列。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} vec3。
 */
function normalizeVec3(value, fallback) {
  return [
    toFiniteNumber(value?.[0], fallback[0]),
    toFiniteNumber(value?.[1], fallback[1]),
    toFiniteNumber(value?.[2], fallback[2]),
  ];
}

/**
 * VRM 0.x の vec3 オブジェクトを配列へ変換します。
 * @param {object|null|undefined} value - 元値。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} vec3 配列。
 */
function normalizeVrm0Vec3(value, fallback) {
  return [
    toFiniteNumber(value?.x, fallback[0]),
    toFiniteNumber(value?.y, fallback[1]),
    toFiniteNumber(value?.z, fallback[2]),
  ];
}

/**
 * 重力方向を正規化します。
 * @param {Array<number>|object|null|undefined} value - 元重力方向。
 * @returns {vec3} 正規化済み方向。
 */
function normalizeDirection(value) {
  const direction = Array.isArray(value)
    ? vec3.fromValues(
      toFiniteNumber(value[0], DEFAULT_GRAVITY_DIRECTION[0]),
      toFiniteNumber(value[1], DEFAULT_GRAVITY_DIRECTION[1]),
      toFiniteNumber(value[2], DEFAULT_GRAVITY_DIRECTION[2]),
    )
    : vec3.fromValues(
      toFiniteNumber(value?.x, DEFAULT_GRAVITY_DIRECTION[0]),
      toFiniteNumber(value?.y, DEFAULT_GRAVITY_DIRECTION[1]),
      toFiniteNumber(value?.z, DEFAULT_GRAVITY_DIRECTION[2]),
    );
  if (vec3.length(direction) <= 1e-8) {
    return vec3.clone(DEFAULT_GRAVITY_DIRECTION);
  }
  return vec3.normalize(direction, direction);
}

/**
 * 点を行列変換します。
 * @param {mat4} matrix - 変換行列。
 * @param {vec3|Array<number>} point - ローカル座標。
 * @param {vec3} out - 出力先。
 * @returns {vec3} out。
 */
function transformPoint(matrix, point, out) {
  return vec3.transformMat4(out, point, matrix);
}

/**
 * ワールド行列から位置を取り出します。
 * @param {mat4} matrix - ワールド行列。
 * @param {vec3} out - 出力先。
 * @returns {vec3} out。
 */
function getWorldPosition(matrix, out) {
  out[0] = matrix[12];
  out[1] = matrix[13];
  out[2] = matrix[14];
  return out;
}

/**
 * 配列の中央値を返します。
 * @param {Array<number>} values - 数値配列。
 * @returns {number} 中央値。
 */
function computeMedian(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[center - 1] + sorted[center]) * 0.5;
  }
  return sorted[center];
}

/**
 * 数値を有限値へ変換します。
 * @param {unknown} value - 元値。
 * @param {number} fallback - 既定値。
 * @returns {number} 数値。
 */
function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * 数値をクランプします。
 * @param {number} value - 入力値。
 * @param {number} min - 最小値。
 * @param {number} max - 最大値。
 * @returns {number} クランプ済み値。
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * scratch state を作成します。
 * @returns {object} scratch state。
 */
function createScratchState() {
  return {
    worldPosition: vec3.create(),
    worldPositionForCollision: vec3.create(),
    inertia: vec3.create(),
    currentCenterTail: vec3.create(),
    prevCenterTail: vec3.create(),
    nextTail: vec3.create(),
    stiffnessDirection: vec3.create(),
    parentWorldRotation: quat.create(),
    centerRotation: quat.create(),
    segmentRotation: quat.create(),
    parentMatrix: mat4.create(),
    restHeadWorldMatrix: mat4.create(),
    inverseRestHeadWorldMatrix: mat4.create(),
    inverseCenterMatrix: mat4.create(),
    localTail: vec3.create(),
    deltaRotation: quat.create(),
    colliderOrigin: vec3.create(),
    colliderTail: vec3.create(),
    colliderAxis: vec3.create(),
    projectedAxis: vec3.create(),
    collisionDelta: vec3.create(),
    collisionDirection: vec3.create(),
  };
}
