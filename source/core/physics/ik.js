import { quat, vec3 } from '../../lib/esm/index.js';
import { projectElbowRotationToPreferredAxis } from '../../shared/bones/elbow-rotation-utils.js';
import {
  quaternionFromBasis,
  quaternionFromEulerXYZ,
  quaternionToEulerXYZ,
} from '../../shared/math/math-utils.js';

export {
  quaternionFromEulerForBone,
  quaternionFromEulerXYZ,
  quaternionFromEulerYXZ,
  quaternionToEulerForBone,
  quaternionToEulerXYZ,
  quaternionToEulerYXZ,
} from '../../shared/math/math-utils.js';

const IK_DISTANCE_EPSILON = 0.01;
const IK_VECTOR_EPSILON = 1e-6;
const IK_ANGLE_CANDIDATE_OFFSETS = [-2, -1, 0, 1, 2];

export function solveIk(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty) {
  return _fabrikSolver(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty);
}

function _fabrikSolver(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty) {
  const runtimeRotationGoal = vec3.create();

  for (const chain of scene.ikChains) {
    if (chain.enabled === false) {
      continue;
    }

    const shouldApplyRuntimeRotation = hasRuntimeRotationTarget(scene, chain);
    if (shouldApplyRuntimeRotation) {
      recomputeWorldTransforms();
      vec3.copy(runtimeRotationGoal, scene.boneWorldPositions[chain.rotationTargetBoneIndex]);
    }

    if (shouldUseCcdFallback(chain, shouldApplyRuntimeRotation)) {
      solveChainWithCcd(
        model,
        scene,
        chain,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
    } else if (chain.links.length === 1) {
      solveSingleLinkChain(
        model,
        scene,
        chain,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
    } else {
      solveMultiLinkFabrikChain(
        model,
        scene,
        chain,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
      refineChainWithCcd(
        model,
        scene,
        chain,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
    }

    if (shouldApplyRuntimeRotation) {
      applyRuntimeEffectorRotation(
        model,
        scene,
        chain,
        runtimeRotationGoal,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
    }
  }

  recomputeWorldTransforms();
}

function shouldUseCcdFallback(chain, shouldApplyRuntimeRotation) {
  return shouldApplyRuntimeRotation
    || chain.links.length <= 1
    || chain.links.some((link) => link.hasLimit);
}

function solveMultiLinkFabrikChain(
  model,
  scene,
  chain,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
) {
  const orderedLinks = getFabrikOrderedLinks(model, chain);
  const maxIterations = Math.max(1, chain.loopCount || 1);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    recomputeWorldTransforms();

    const goal = scene.boneWorldPositions[chain.targetBoneIndex];
    const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
    if (vec3.distance(goal, effector) <= getChainDistanceEpsilon(chain)) {
      break;
    }

    const chainState = captureChainState(scene, orderedLinks, chain.effectorBoneIndex);
    if (!chainState) {
      break;
    }

    const solvedPositions = solveFabrikPositions(chainState.rootPosition, goal, chainState.lengths);
    const changed = applySolvedChainRotations(
      model,
      scene,
      orderedLinks,
      chain.effectorBoneIndex,
      chain.targetBoneIndex,
      solvedPositions,
      recomputeWorldTransforms,
      markBoneLocalTransformDirty,
    );
    if (!changed) {
      break;
    }
  }
}

function solveSingleLinkChain(
  model,
  scene,
  chain,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
) {
  const link = chain.links[0];
  const boneIndex = link.boneIndex;
  const bone = model.bones[boneIndex];
  if (!bone) {
    return;
  }

  const localDelta = quat.create();
  const parentInverse = quat.create();
  const worldDelta = quat.create();
  const currentDirection = vec3.create();
  const desiredDirection = vec3.create();
  const maxIterations = Math.max(1, chain.loopCount || 1);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    recomputeWorldTransforms();

    const goal = scene.boneWorldPositions[chain.targetBoneIndex];
    const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
    if (vec3.distance(goal, effector) <= getChainDistanceEpsilon(chain)) {
      break;
    }

    vec3.sub(currentDirection, effector, scene.boneWorldPositions[boneIndex]);
    vec3.sub(desiredDirection, goal, scene.boneWorldPositions[boneIndex]);
    if (!buildRotationBetweenVectors(worldDelta, currentDirection, desiredDirection)) {
      break;
    }

    applyWorldRotationToLocalRotation(
      scene,
      bone,
      boneIndex,
      link,
      localDelta,
      parentInverse,
      worldDelta,
      markBoneLocalTransformDirty,
    );
    projectRotationToBonePreference(model, scene, boneIndex);
  }
}

/**
 * FABRIK が使う link 順序を root-to-effector に正規化します。
 * PMX の IK links は effector 側から root 側へ並ぶことがあるため、
 * 階層を見て FABRIK 用にだけ順序を補正します。
 * @param {object} model - モデルデータ。
 * @param {object} chain - IK チェーン。
 * @returns {Array<object>} FABRIK 用の link 配列。
 */
function getFabrikOrderedLinks(model, chain) {
  const links = Array.isArray(chain?.links) ? chain.links : [];
  if (links.length <= 1) {
    return links;
  }

  const firstBone = model?.bones?.[links[0]?.boneIndex];
  const secondBone = model?.bones?.[links[1]?.boneIndex];
  if (!firstBone || !secondBone) {
    return links;
  }

  if (firstBone.parentIndex === links[1].boneIndex) {
    return [...links].reverse();
  }

  return links;
}

function captureChainState(scene, orderedLinks, effectorBoneIndex) {
  const positions = [];
  for (const link of orderedLinks) {
    const position = scene.boneWorldPositions[link.boneIndex];
    if (!position) {
      return null;
    }
    positions.push(vec3.clone(position));
  }

  const effectorPosition = scene.boneWorldPositions[effectorBoneIndex];
  if (!effectorPosition) {
    return null;
  }
  positions.push(vec3.clone(effectorPosition));

  const lengths = [];
  for (let i = 0; i < positions.length - 1; i += 1) {
    lengths.push(Math.max(vec3.distance(positions[i], positions[i + 1]), IK_VECTOR_EPSILON));
  }

  return {
    rootPosition: vec3.clone(positions[0]),
    lengths,
    positions,
  };
}

function solveFabrikPositions(rootPosition, goalPosition, lengths) {
  const positions = [vec3.clone(rootPosition)];
  for (let i = 0; i < lengths.length; i += 1) {
    positions.push(vec3.create());
  }

  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const rootToGoal = vec3.distance(rootPosition, goalPosition);
  if (rootToGoal >= totalLength - IK_VECTOR_EPSILON) {
    const direction = vec3.create();
    vec3.sub(direction, goalPosition, rootPosition);
    if (vec3.length(direction) <= IK_VECTOR_EPSILON) {
      vec3.set(direction, 0, -1, 0);
    } else {
      vec3.normalize(direction, direction);
    }

    for (let i = 0; i < lengths.length; i += 1) {
      const nextPosition = vec3.scaleAndAdd(vec3.create(), positions[i], direction, lengths[i]);
      positions[i + 1] = nextPosition;
    }

    return positions;
  }

  positions[positions.length - 1] = vec3.clone(goalPosition);
  for (let i = positions.length - 2; i >= 0; i -= 1) {
    const direction = vec3.create();
    vec3.sub(direction, positions[i], positions[i + 1]);
    normalizeVectorWithFallback(direction);
    positions[i] = vec3.scaleAndAdd(vec3.create(), positions[i + 1], direction, lengths[i]);
  }

  positions[0] = vec3.clone(rootPosition);
  for (let i = 0; i < lengths.length; i += 1) {
    const direction = vec3.create();
    vec3.sub(direction, positions[i + 1], positions[i]);
    normalizeVectorWithFallback(direction);
    positions[i + 1] = vec3.scaleAndAdd(vec3.create(), positions[i], direction, lengths[i]);
  }

  return positions;
}

function applySolvedChainRotations(
  model,
  scene,
  orderedLinks,
  effectorBoneIndex,
  targetBoneIndex,
  solvedPositions,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
) {
  const useStableTwist = shouldUseStableTwistForChain(model, targetBoneIndex);
  const localDelta = quat.create();
  const parentInverse = quat.create();
  const worldDelta = quat.create();
  const currentDirection = vec3.create();
  const desiredDirection = vec3.create();
  let changed = false;

  for (let linkIndex = 0; linkIndex < orderedLinks.length; linkIndex += 1) {
    recomputeWorldTransforms();

    const link = orderedLinks[linkIndex];
    const boneIndex = link.boneIndex;
    const bone = model.bones[boneIndex];
    if (!bone) {
      continue;
    }
    if (isIkRotationFullyLocked(bone)) {
      continue;
    }

    const currentStart = scene.boneWorldPositions[boneIndex];
    const currentEnd = getCurrentChildWorldPosition(scene, orderedLinks, linkIndex, effectorBoneIndex);
    const desiredEnd = solvedPositions[linkIndex + 1];
    if (!currentStart || !currentEnd || !desiredEnd) {
      continue;
    }

    vec3.sub(currentDirection, currentEnd, currentStart);
    vec3.sub(desiredDirection, desiredEnd, currentStart);
    const rotationChanged = useStableTwist
      ? buildStableHairRotationDelta(
        worldDelta,
        scene,
        boneIndex,
        currentDirection,
        desiredDirection,
      )
      : buildRotationBetweenVectors(worldDelta, currentDirection, desiredDirection);
    if (!rotationChanged) {
      continue;
    }

    applyWorldRotationToLocalRotation(
      scene,
      bone,
      boneIndex,
      link,
      localDelta,
      parentInverse,
      worldDelta,
      markBoneLocalTransformDirty,
    );
    projectRotationToBonePreference(model, scene, boneIndex);
    changed = true;
  }

  return changed;
}

function getCurrentChildWorldPosition(scene, chain, linkIndex, effectorBoneIndex) {
  if (linkIndex + 1 < chain.length) {
    return scene.boneWorldPositions[chain[linkIndex + 1].boneIndex];
  }

  return scene.boneWorldPositions[effectorBoneIndex];
}

/**
 * 髪 IK チェーンに安定 twist 復元を適用するかを返します。
 * @param {object} model - モデルデータ。
 * @param {number} targetBoneIndex - IK ターゲットボーン index。
 * @returns {boolean} 安定 twist を使うなら true。
 */
function shouldUseStableTwistForChain(model, targetBoneIndex) {
  const targetBoneName = String(model?.bones?.[targetBoneIndex]?.name || '');
  return targetBoneName.includes('髪ＩＫ') || targetBoneName.toLowerCase().includes('hair');
}

/**
 * 髪チェーン向けに、現在の参照軸を保った swing 回転を構築します。
 * @param {quat} out - 出力先 quaternion。
 * @param {object} scene - シーン状態。
 * @param {number} boneIndex - 対象ボーン index。
 * @param {vec3} currentDirection - 現在のセグメント方向。
 * @param {vec3} desiredDirection - 目標セグメント方向。
 * @returns {boolean} 有効な回転が作れたなら true。
 */
function buildStableHairRotationDelta(out, scene, boneIndex, currentDirection, desiredDirection) {
  const currentPrimary = vec3.clone(currentDirection);
  const desiredPrimary = vec3.clone(desiredDirection);
  const currentLength = vec3.length(currentPrimary);
  const desiredLength = vec3.length(desiredPrimary);
  if (currentLength <= IK_VECTOR_EPSILON || desiredLength <= IK_VECTOR_EPSILON) {
    quat.identity(out);
    return false;
  }

  vec3.scale(currentPrimary, currentPrimary, 1 / currentLength);
  vec3.scale(desiredPrimary, desiredPrimary, 1 / desiredLength);

  const currentWorldRotation = scene?.boneLocalTransforms?.[boneIndex]?.worldRotation;
  if (!Array.isArray(currentWorldRotation) && !ArrayBuffer.isView(currentWorldRotation)) {
    return buildRotationBetweenVectors(out, currentPrimary, desiredPrimary);
  }

  const referenceVector = vec3.transformQuat(vec3.create(), vec3.fromValues(1, 0, 0), currentWorldRotation);
  const currentBasis = buildStableSegmentBasis(currentPrimary, referenceVector);
  const desiredBasis = buildStableSegmentBasis(desiredPrimary, referenceVector);
  if (!currentBasis || !desiredBasis) {
    return buildRotationBetweenVectors(out, currentPrimary, desiredPrimary);
  }

  const inverseCurrentBasis = quat.invert(quat.create(), currentBasis);
  if (!inverseCurrentBasis) {
    return buildRotationBetweenVectors(out, currentPrimary, desiredPrimary);
  }

  quat.multiply(out, desiredBasis, inverseCurrentBasis);
  quat.normalize(out, out);

  return Math.abs(out[0]) > IK_VECTOR_EPSILON
    || Math.abs(out[1]) > IK_VECTOR_EPSILON
    || Math.abs(out[2]) > IK_VECTOR_EPSILON
    || Math.abs(out[3] - 1) > IK_VECTOR_EPSILON;
}

/**
 * セグメント方向と参照軸から安定した world 基底 quaternion を作成します。
 * @param {vec3} primaryAxis - セグメント主軸。
 * @param {vec3} referenceVector - twist 参照ベクトル。
 * @returns {quat|null} 基底 quaternion。構築失敗時は null。
 */
function buildStableSegmentBasis(primaryAxis, referenceVector) {
  const yAxis = vec3.clone(primaryAxis);
  normalizeVectorWithFallback(yAxis);

  let xAxis = projectVectorOntoPlane(vec3.create(), referenceVector, yAxis);
  if (vec3.length(xAxis) <= IK_VECTOR_EPSILON) {
    xAxis = projectVectorOntoPlane(vec3.create(), vec3.fromValues(1, 0, 0), yAxis);
  }
  if (vec3.length(xAxis) <= IK_VECTOR_EPSILON) {
    xAxis = projectVectorOntoPlane(vec3.create(), vec3.fromValues(0, 0, 1), yAxis);
  }
  if (vec3.length(xAxis) <= IK_VECTOR_EPSILON) {
    return null;
  }
  vec3.normalize(xAxis, xAxis);

  let zAxis = vec3.cross(vec3.create(), xAxis, yAxis);
  if (vec3.length(zAxis) <= IK_VECTOR_EPSILON) {
    return null;
  }
  vec3.normalize(zAxis, zAxis);

  const correctedXAxis = vec3.cross(vec3.create(), yAxis, zAxis);
  if (vec3.length(correctedXAxis) <= IK_VECTOR_EPSILON) {
    return null;
  }
  vec3.normalize(correctedXAxis, correctedXAxis);

  return quaternionFromBasis(
    Array.from(correctedXAxis),
    Array.from(yAxis),
    Array.from(zAxis),
  );
}

/**
 * ベクトルを法線に直交する平面へ射影します。
 * @param {vec3} out - 出力先。
 * @param {vec3} vector - 入力ベクトル。
 * @param {vec3} planeNormal - 平面法線。
 * @returns {vec3} 射影結果。
 */
function projectVectorOntoPlane(out, vector, planeNormal) {
  const dot = vec3.dot(vector, planeNormal);
  out[0] = vector[0] - planeNormal[0] * dot;
  out[1] = vector[1] - planeNormal[1] * dot;
  out[2] = vector[2] - planeNormal[2] * dot;
  return out;
}

function buildRotationBetweenVectors(out, fromVector, toVector) {
  const from = vec3.clone(fromVector);
  const to = vec3.clone(toVector);
  const fromLength = vec3.length(from);
  const toLength = vec3.length(to);
  if (fromLength <= IK_VECTOR_EPSILON || toLength <= IK_VECTOR_EPSILON) {
    quat.identity(out);
    return false;
  }

  vec3.scale(from, from, 1 / fromLength);
  vec3.scale(to, to, 1 / toLength);

  const dot = clamp(vec3.dot(from, to), -1, 1);
  if (dot >= 1 - IK_VECTOR_EPSILON) {
    quat.identity(out);
    return false;
  }

  if (dot <= -1 + IK_VECTOR_EPSILON) {
    const axis = findOrthogonalAxis(from);
    quat.setAxisAngle(out, axis, Math.PI);
    return true;
  }

  const axis = vec3.cross(vec3.create(), from, to);
  const axisLength = vec3.length(axis);
  if (axisLength <= IK_VECTOR_EPSILON) {
    quat.identity(out);
    return false;
  }

  vec3.scale(axis, axis, 1 / axisLength);
  const angle = Math.acos(dot);
  quat.setAxisAngle(out, axis, angle);
  return true;
}

function findOrthogonalAxis(vector) {
  const axis = vec3.fromValues(1, 0, 0);
  if (Math.abs(vector[0]) >= 0.9) {
    vec3.set(axis, 0, 1, 0);
  }
  vec3.cross(axis, vector, axis);
  normalizeVectorWithFallback(axis);
  return axis;
}

function normalizeVectorWithFallback(vector) {
  const length = vec3.length(vector);
  if (length <= IK_VECTOR_EPSILON) {
    vec3.set(vector, 0, -1, 0);
    return vector;
  }

  vec3.scale(vector, vector, 1 / length);
  return vector;
}

function refineChainWithCcd(
  model,
  scene,
  chain,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
  baseDamping = 0.1,
) {
  const axis = vec3.create();
  const toEffector = vec3.create();
  const toTarget = vec3.create();
  const worldDelta = quat.create();
  const parentInverse = quat.create();
  const localDelta = quat.create();
  const refinementIterations = Math.max(1, Math.min(chain.loopCount || 1, 8));

  baseDamping = clamp(baseDamping, 0.0, 1.0);

  for (let iteration = 0; iteration < refinementIterations; iteration += 1) {
    recomputeWorldTransforms();

    const goal = scene.boneWorldPositions[chain.targetBoneIndex];
    const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
    const dist = vec3.distance(goal, effector);
    if (dist <= getChainDistanceEpsilon(chain)) {
      break;
    }

    let damping = clamp(baseDamping * Math.min(1.0, dist * 2.0), 0.05, 1.0);
    if (isTwoLinkConstrainedChain(chain)) {
      damping = Math.max(damping, 0.3);
    }
    if (chain.links.length === 1) {
      damping = 1.0;
    }

    for (let linkIndex = 0; linkIndex < chain.links.length; linkIndex += 1) {
      const link = chain.links[linkIndex];
      const boneIndex = link.boneIndex;
      const bone = model.bones[boneIndex];
      if (!bone || isIkRotationFullyLocked(bone)) {
        continue;
      }

      vec3.sub(toTarget, scene.boneWorldPositions[chain.targetBoneIndex], scene.boneWorldPositions[boneIndex]);
      vec3.sub(toEffector, scene.boneWorldPositions[chain.effectorBoneIndex], scene.boneWorldPositions[boneIndex]);

      const targetLength = vec3.length(toTarget);
      const effectorLength = vec3.length(toEffector);
      if (targetLength <= IK_VECTOR_EPSILON || effectorLength <= IK_VECTOR_EPSILON) {
        continue;
      }

      if (link.hasLimit && isSingleAxisXConstraint(link)) {
        const mid = (link.minAngle[0] + link.maxAngle[0]) / 2;
        const currentAngle = normalizeAngle(extractXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation), mid);
        const desiredAngle = computeDesiredHingeAngle(scene, chain, bone, link, currentAngle);

        const maxAngle = Math.max(chain.limitAngle, 1e-4);
        let deltaAngle = clamp(
          normalizeRadians(desiredAngle - currentAngle),
          -maxAngle,
          maxAngle,
        );

        const sign = Math.sign(deltaAngle);
        deltaAngle = sign * Math.max(Math.abs(deltaAngle * damping), 0.001);

        const nextAngle = clamp(
          currentAngle + deltaAngle,
          link.minAngle[0],
          link.maxAngle[0],
        );

        setXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation, nextAngle);
        markBoneLocalTransformDirty(scene.boneLocalTransforms[boneIndex]);

        recomputeWorldTransforms();
        continue;
      }

      vec3.scale(toTarget, toTarget, 1 / targetLength);
      vec3.scale(toEffector, toEffector, 1 / effectorLength);
      vec3.cross(axis, toEffector, toTarget);

      const axisLength = vec3.length(axis);
      if (axisLength <= IK_VECTOR_EPSILON) {
        continue;
      }

      vec3.scale(axis, axis, 1 / axisLength);

      const dot = clamp(vec3.dot(toEffector, toTarget), -1, 1);
      let angle = Math.acos(dot);
      const maxAngle = Math.max(chain.limitAngle, 1e-4);
      angle = Math.min(angle, maxAngle);
      angle = Math.max(angle * damping, 0.001);

      quat.setAxisAngle(worldDelta, axis, angle);
      applyWorldRotationToLocalRotation(
        scene,
        bone,
        boneIndex,
        link,
        localDelta,
        parentInverse,
        worldDelta,
        markBoneLocalTransformDirty,
      );
      recomputeWorldTransforms();
    }
  }
}

function solveChainWithCcd(
  model,
  scene,
  chain,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
  baseDamping = 0.1,
) {
  const axis = vec3.create();
  const toEffector = vec3.create();
  const toTarget = vec3.create();
  const worldDelta = quat.create();
  const parentInverse = quat.create();
  const localDelta = quat.create();

  baseDamping = clamp(baseDamping, 0.0, 1.0);

  for (let iteration = 0; iteration < chain.loopCount; iteration += 1) {
    recomputeWorldTransforms();

    const goal = scene.boneWorldPositions[chain.targetBoneIndex];
    const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
    const dist = vec3.distance(goal, effector);
    if (dist <= getChainDistanceEpsilon(chain)) {
      break;
    }

    let damping = clamp(baseDamping * Math.min(1.0, dist * 2.0), 0.05, 1.0);
    if (isTwoLinkConstrainedChain(chain)) {
      damping = Math.max(damping, 0.3);
    }
    if (chain.links.length === 1) {
      damping = 1.0;
    }

    for (let linkIndex = 0; linkIndex < chain.links.length; linkIndex += 1) {
      const link = chain.links[linkIndex];
      const boneIndex = link.boneIndex;
      const bone = model.bones[boneIndex];
      if (!bone || isIkRotationFullyLocked(bone)) {
        continue;
      }

      vec3.sub(toTarget, scene.boneWorldPositions[chain.targetBoneIndex], scene.boneWorldPositions[boneIndex]);
      vec3.sub(toEffector, scene.boneWorldPositions[chain.effectorBoneIndex], scene.boneWorldPositions[boneIndex]);

      const targetLength = vec3.length(toTarget);
      const effectorLength = vec3.length(toEffector);
      if (targetLength <= IK_VECTOR_EPSILON || effectorLength <= IK_VECTOR_EPSILON) {
        continue;
      }

      if (link.hasLimit && isSingleAxisXConstraint(link)) {
        const mid = (link.minAngle[0] + link.maxAngle[0]) / 2;
        const currentAngle = normalizeAngle(extractXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation), mid);
        const desiredAngle = computeDesiredHingeAngle(scene, chain, bone, link, currentAngle);

        const maxAngle = Math.max(chain.limitAngle, 1e-4);
        let deltaAngle = clamp(
          normalizeRadians(desiredAngle - currentAngle),
          -maxAngle,
          maxAngle,
        );

        const sign = Math.sign(deltaAngle);
        deltaAngle = sign * Math.max(Math.abs(deltaAngle * damping), 0.001);

        const nextAngle = clamp(
          currentAngle + deltaAngle,
          link.minAngle[0],
          link.maxAngle[0],
        );

        setXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation, nextAngle);
        markBoneLocalTransformDirty(scene.boneLocalTransforms[boneIndex]);

        recomputeWorldTransforms();
        continue;
      }

      vec3.scale(toTarget, toTarget, 1 / targetLength);
      vec3.scale(toEffector, toEffector, 1 / effectorLength);
      vec3.cross(axis, toEffector, toTarget);

      const axisLength = vec3.length(axis);
      if (axisLength <= IK_VECTOR_EPSILON) {
        continue;
      }

      vec3.scale(axis, axis, 1 / axisLength);

      const dot = clamp(vec3.dot(toEffector, toTarget), -1, 1);
      let angle = Math.acos(dot);
      const maxAngle = Math.max(chain.limitAngle, 1e-4);
      angle = Math.min(angle, maxAngle);
      angle = Math.max(angle * damping, 0.001);

      quat.setAxisAngle(worldDelta, axis, angle);
      applyWorldRotationToLocalRotation(
        scene,
        bone,
        boneIndex,
        link,
        localDelta,
        parentInverse,
        worldDelta,
        markBoneLocalTransformDirty,
      );
      recomputeWorldTransforms();
    }
  }
}

function _ccdSolver(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty, baseDamping = 0.1) {
  const axis = vec3.create();
  const toEffector = vec3.create();
  const toTarget = vec3.create();
  const worldDelta = quat.create();
  const parentInverse = quat.create();
  const localDelta = quat.create();
  const runtimeRotationGoal = vec3.create();

  baseDamping = clamp(baseDamping, 0.0, 1.0);

  for (const chain of scene.ikChains) {
    if (chain.enabled === false) {
      continue;
    }

    const shouldApplyRuntimeRotation = hasRuntimeRotationTarget(scene, chain);
    if (shouldApplyRuntimeRotation) {
      recomputeWorldTransforms();
      vec3.copy(runtimeRotationGoal, scene.boneWorldPositions[chain.rotationTargetBoneIndex]);
    }

    for (let iteration = 0; iteration < chain.loopCount; iteration += 1) {
      recomputeWorldTransforms();

      const goal = scene.boneWorldPositions[chain.targetBoneIndex];
      const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
      const dist = vec3.distance(goal, effector);
      if (dist <= getChainDistanceEpsilon(chain)) {
        break;
      }

      let damping = clamp(baseDamping * Math.min(1.0, dist * 2.0), 0.05, 1.0);
      if (isTwoLinkConstrainedChain(chain)) {
        damping = Math.max(damping, 0.3);
      }
      if (chain.links.length === 1) {
        damping = 1.0;
      }

      for (let linkIndex = 0; linkIndex < chain.links.length; linkIndex += 1) {
        const link = chain.links[linkIndex];
        const boneIndex = link.boneIndex;
        const bone = model.bones[boneIndex];

        vec3.sub(toTarget, scene.boneWorldPositions[chain.targetBoneIndex], scene.boneWorldPositions[boneIndex]);
        vec3.sub(toEffector, scene.boneWorldPositions[chain.effectorBoneIndex], scene.boneWorldPositions[boneIndex]);

        const targetLength = vec3.length(toTarget);
        const effectorLength = vec3.length(toEffector);
        if (targetLength <= IK_VECTOR_EPSILON || effectorLength <= IK_VECTOR_EPSILON) {
          continue;
        }

        if (link.hasLimit && isSingleAxisXConstraint(link)) {
          const mid = (link.minAngle[0] + link.maxAngle[0]) / 2;
          const currentAngle = normalizeAngle(extractXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation), mid);
          const desiredAngle = computeDesiredHingeAngle(scene, chain, bone, link, currentAngle);

          const maxAngle = Math.max(chain.limitAngle, 1e-4);
          let deltaAngle = clamp(
            normalizeRadians(desiredAngle - currentAngle),
            -maxAngle,
            maxAngle,
          );

          const sign = Math.sign(deltaAngle);
          deltaAngle = sign * Math.max(Math.abs(deltaAngle * damping), 0.001);

          const nextAngle = clamp(
            currentAngle + deltaAngle,
            link.minAngle[0],
            link.maxAngle[0],
          );

          setXAxisRotation(scene.boneLocalTransforms[boneIndex].rotation, nextAngle);
          markBoneLocalTransformDirty(scene.boneLocalTransforms[boneIndex]);

          recomputeWorldTransforms();
          continue;
        }

        vec3.scale(toTarget, toTarget, 1 / targetLength);
        vec3.scale(toEffector, toEffector, 1 / effectorLength);
        vec3.cross(axis, toEffector, toTarget);

        const axisLength = vec3.length(axis);
        if (axisLength <= IK_VECTOR_EPSILON) {
          continue;
        }

        vec3.scale(axis, axis, 1 / axisLength);

        const dot = clamp(vec3.dot(toEffector, toTarget), -1, 1);
        let angle = Math.acos(dot);
        const maxAngle = Math.max(chain.limitAngle, 1e-4);
        angle = Math.min(angle, maxAngle);
        angle = Math.max(angle * damping, 0.001);

        quat.setAxisAngle(worldDelta, axis, angle);

        applyWorldRotationToLocalRotation(
          scene,
          bone,
          boneIndex,
          link,
          localDelta,
          parentInverse,
          worldDelta,
          markBoneLocalTransformDirty,
        );
        recomputeWorldTransforms();
      }
    }

    if (shouldApplyRuntimeRotation) {
      applyRuntimeEffectorRotation(
        model,
        scene,
        chain,
        runtimeRotationGoal,
        recomputeWorldTransforms,
        markBoneLocalTransformDirty,
      );
    }
  }

  recomputeWorldTransforms();
}

/**
 * 膝制約を持つ 2 リンクの脚 IK チェーンかどうかを判定します。
 * @param {object} chain - IK チェーン。
 * @returns {boolean} 2 リンクの脚 IK なら true。
 */
function isTwoLinkConstrainedChain(chain) {
  return chain.links.length === 2
    && Boolean(chain.links[0]?.hasLimit)
    && !chain.links[1]?.hasLimit;
}

function getChainDistanceEpsilon(chain) {
  const distanceEpsilon = Number(chain?.distanceEpsilon);
  if (!Number.isFinite(distanceEpsilon) || distanceEpsilon <= 0) {
    return IK_DISTANCE_EPSILON;
  }

  return distanceEpsilon;
}

function applyWorldRotationToLocalRotation(
  scene,
  bone,
  boneIndex,
  link,
  localDelta,
  parentInverse,
  worldDelta,
  markBoneLocalTransformDirty,
) {
  if (bone.parentIndex !== -1) {
    quat.invert(parentInverse, scene.boneLocalTransforms[bone.parentIndex].worldRotation);
  } else {
    quat.identity(parentInverse);
  }

  quat.multiply(localDelta, parentInverse, worldDelta);
  if (bone.parentIndex !== -1) {
    quat.multiply(localDelta, localDelta, scene.boneLocalTransforms[bone.parentIndex].worldRotation);
  }

  quat.multiply(scene.boneLocalTransforms[boneIndex].rotation, localDelta, scene.boneLocalTransforms[boneIndex].rotation);
  markBoneLocalTransformDirty(scene.boneLocalTransforms[boneIndex]);

  if (link.hasLimit) {
    constrainLinkRotation(scene.boneLocalTransforms[boneIndex].rotation, link);
  }

  quat.normalize(scene.boneLocalTransforms[boneIndex].rotation, scene.boneLocalTransforms[boneIndex].rotation);
}

function applyRuntimeEffectorRotation(
  model,
  scene,
  chain,
  runtimeRotationGoal,
  recomputeWorldTransforms,
  markBoneLocalTransformDirty,
) {
  const setupBoneIndex = chain.effectorBoneIndex;
  const rotationTargetBoneIndex = chain.rotationTargetBoneIndex;
  const bone = model.bones[setupBoneIndex];
  const local = scene.boneLocalTransforms[setupBoneIndex];
  const currentEffectorPosition = scene.boneWorldPositions[setupBoneIndex];
  const currentTargetPosition = scene.boneWorldPositions[rotationTargetBoneIndex];
  if (!bone || !local || !currentEffectorPosition || !currentTargetPosition) {
    return;
  }

  const from = vec3.sub(vec3.create(), currentTargetPosition, currentEffectorPosition);
  const to = vec3.sub(vec3.create(), runtimeRotationGoal, currentEffectorPosition);
  const fromLength = vec3.length(from);
  const toLength = vec3.length(to);
  if (fromLength <= IK_VECTOR_EPSILON || toLength <= IK_VECTOR_EPSILON) {
    return;
  }

  vec3.scale(from, from, 1 / fromLength);
  vec3.scale(to, to, 1 / toLength);
  const axis = vec3.cross(vec3.create(), from, to);
  const axisLength = vec3.length(axis);
  if (axisLength <= IK_VECTOR_EPSILON) {
    return;
  }

  vec3.scale(axis, axis, 1 / axisLength);
  const angle = Math.acos(clamp(vec3.dot(from, to), -1, 1));
  if (!Number.isFinite(angle) || angle <= IK_VECTOR_EPSILON) {
    return;
  }

  const worldDelta = quat.setAxisAngle(quat.create(), axis, angle);
  const parentInverse = quat.create();
  const localDelta = quat.create();
  applyWorldRotationToLocalRotation(
    scene,
    bone,
    setupBoneIndex,
    { hasLimit: false },
    localDelta,
    parentInverse,
    worldDelta,
    markBoneLocalTransformDirty,
  );
  projectRotationToBonePreference(model, scene, setupBoneIndex);
  recomputeWorldTransforms();
}

function hasRuntimeRotationTarget(scene, chain) {
  return Number.isInteger(chain?.rotationTargetBoneIndex)
    && chain.rotationTargetBoneIndex >= 0
    && chain.rotationTargetBoneIndex < (scene?.boneWorldPositions?.length ?? 0)
    && Number.isInteger(chain?.effectorBoneIndex)
    && chain.effectorBoneIndex >= 0;
}

function projectRotationToBonePreference(model, scene, boneIndex) {
  const bone = model.bones[boneIndex];
  const local = scene.boneLocalTransforms[boneIndex];
  if (!bone || !local) {
    return;
  }

  const rotationLocks = getEffectiveIkRotationLocks(bone);
  const unlockedAxes = ['x', 'y', 'z'].filter((axis) => rotationLocks[axis] !== true);
  if (unlockedAxes.length !== 1) {
    return;
  }

  if (unlockedAxes[0] === 'y' && isElbowBoneName(bone.name)) {
    quat.copy(local.rotation, projectElbowRotationToPreferredAxis(local.rotation, local, bone));
    quat.normalize(local.rotation, local.rotation);
    return;
  }

  const euler = quaternionToEulerXYZ(local.rotation);
  const nextEuler = [0, 0, 0];
  const unlockedAxis = unlockedAxes[0];
  if (unlockedAxis === 'x') {
    nextEuler[0] = euler[0];
  } else if (unlockedAxis === 'y') {
    nextEuler[1] = euler[1];
  } else {
    nextEuler[2] = euler[2];
  }
  quaternionFromEulerXYZ(nextEuler, local.rotation);
  quat.normalize(local.rotation, local.rotation);
}

/**
 * IK 計算時に使う実効回転ロックを返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {{x: boolean, y: boolean, z: boolean}} 実効ロック状態。
 */
function getEffectiveIkRotationLocks(bone) {
  const rotationLocks = bone?.rotationLocks || {};
  const ikRotationLocks = bone?.ikRotationLocks || {};
  return {
    x: Boolean(rotationLocks.x) || Boolean(ikRotationLocks.x),
    y: Boolean(rotationLocks.y) || Boolean(ikRotationLocks.y),
    z: Boolean(rotationLocks.z) || Boolean(ikRotationLocks.z),
  };
}

/**
 * IK 計算時に全軸がロックされているかを返します。
 * @param {object|null|undefined} bone - ボーン。
 * @returns {boolean} 全軸ロックなら true。
 */
function isIkRotationFullyLocked(bone) {
  const rotationLocks = getEffectiveIkRotationLocks(bone);
  return rotationLocks.x && rotationLocks.y && rotationLocks.z;
}

function isElbowBoneName(name) {
  return typeof name === 'string' && (name.includes('ひじ') || name.includes('肘') || name.toLowerCase().includes('elbow'));
}

export function worldDeltaToLocalDelta(scene, model, boneIndex, deltaWorld) {
  const delta = vec3.fromValues(deltaWorld[0], deltaWorld[1], deltaWorld[2]);
  const bone = model.bones[boneIndex];

  if (bone.parentIndex === -1) {
    return Array.from(delta);
  }

  const parentRotationInverse = quat.create();
  quat.invert(parentRotationInverse, scene.boneLocalTransforms[bone.parentIndex].worldRotation);
  vec3.transformQuat(delta, delta, parentRotationInverse);
  return Array.from(delta);
}

const _tempEulerQuat = quat.create();

function normalizeRadians(angle) {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

function constrainLinkRotation(rotation, link) {
  if (isSingleAxisXConstraint(link)) {
    constrainToXAxis(rotation, link);
    return;
  }

  const euler = quaternionToEulerXYZ(rotation);
  for (let i = 0; i < 3; i += 1) {
    const mid = (link.minAngle[i] + link.maxAngle[i]) / 2;
    euler[i] = clamp(normalizeAngle(euler[i], mid), link.minAngle[i], link.maxAngle[i]);
  }

  quaternionFromEulerXYZ(euler, _tempEulerQuat);
  quat.copy(rotation, _tempEulerQuat);
}

function constrainToXAxis(rotation, link) {
  const mid = (link.minAngle[0] + link.maxAngle[0]) / 2;
  let angle = normalizeAngle(extractXAxisRotation(rotation), mid);
  angle = clamp(angle, link.minAngle[0], link.maxAngle[0]);
  setXAxisRotation(rotation, angle);
}

function normalizeAngle(angle, mid) {
  let normalized = angle;
  while (normalized > mid + Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < mid - Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}

function extractXAxisRotation(rotation) {
  const twistX = rotation[0];
  const twistW = rotation[3];
  const twistLength = Math.hypot(twistX, twistW);
  if (twistLength <= IK_VECTOR_EPSILON) {
    return 0;
  }
  return -2 * Math.atan2(twistX / twistLength, twistW / twistLength);
}

function setXAxisRotation(rotation, angle) {
  quat.setAxisAngle(rotation, [1, 0, 0], -angle);
  quat.normalize(rotation, rotation);
}

function computeDesiredHingeAngle(scene, chain, bone, link, fallbackAngle) {
  if (bone.parentIndex === -1) {
    return fallbackAngle;
  }

  const root = scene.boneWorldPositions[bone.parentIndex];
  const joint = scene.boneWorldPositions[link.boneIndex];
  const effector = scene.boneWorldPositions[chain.effectorBoneIndex];
  const goal = scene.boneWorldPositions[chain.targetBoneIndex];

  const upperLength = vec3.distance(root, joint);
  const lowerLength = vec3.distance(joint, effector);
  if (upperLength <= IK_VECTOR_EPSILON || lowerLength <= IK_VECTOR_EPSILON) {
    return fallbackAngle;
  }

  const targetDistance = vec3.distance(root, goal);
  const desiredInternalAngle = Math.acos(clamp(
    (upperLength * upperLength + lowerLength * lowerLength - targetDistance * targetDistance)
    / (2 * upperLength * lowerLength),
    -1,
    1,
  ));

  const parentWorldRotation = scene.boneLocalTransforms[bone.parentIndex]?.worldRotation;
  if (!parentWorldRotation) {
    return fallbackAngle;
  }

  const parentInverseRotation = quat.create();
  const upper = vec3.create();
  const lower = vec3.create();
  const lowerReference = vec3.create();

  quat.invert(parentInverseRotation, parentWorldRotation);
  vec3.sub(upper, root, joint);
  vec3.transformQuat(upper, upper, parentInverseRotation);
  vec3.sub(lower, effector, joint);
  vec3.transformQuat(lower, lower, parentInverseRotation);
  rotateVectorAroundLocalXAxis(lowerReference, lower, -fallbackAngle);

  return solveSingleAxisXHingeAngle(
    upper,
    lowerReference,
    desiredInternalAngle,
    link.minAngle[0],
    link.maxAngle[0],
    fallbackAngle,
  );
}

/**
 * 単軸 X ヒンジが届く角度を脚セグメントの実ベクトルから求めます。
 * @param {vec3} upper - 親ローカル空間の関節→親ベクトル。
 * @param {vec3} lowerReference - X 回転 0 のときの関節→エフェクタ参照ベクトル。
 * @param {number} desiredInternalAngle - 目標の関節内角。
 * @param {number} minAngle - 下限角。
 * @param {number} maxAngle - 上限角。
 * @param {number} fallbackAngle - 現在角度。
 * @returns {number} 目標に最も近いヒンジ角。
 */
function solveSingleAxisXHingeAngle(
  upper,
  lowerReference,
  desiredInternalAngle,
  minAngle,
  maxAngle,
  fallbackAngle,
) {
  const cosineCoefficient = upper[1] * lowerReference[1] + upper[2] * lowerReference[2];
  const sineCoefficient = upper[1] * lowerReference[2] - upper[2] * lowerReference[1];
  const amplitude = Math.hypot(cosineCoefficient, sineCoefficient);
  if (amplitude <= IK_VECTOR_EPSILON) {
    return clamp(fallbackAngle, minAngle, maxAngle);
  }

  const rhs = clamp(
    (
      vec3.length(upper) * vec3.length(lowerReference) * Math.cos(desiredInternalAngle)
      - upper[0] * lowerReference[0]
    ) / amplitude,
    -1,
    1,
  );
  const phase = Math.atan2(sineCoefficient, cosineCoefficient);
  const offset = Math.acos(rhs);
  const candidates = [minAngle, maxAngle, clamp(fallbackAngle, minAngle, maxAngle)];

  addEquivalentAngleCandidates(candidates, phase + offset, minAngle, maxAngle);
  addEquivalentAngleCandidates(candidates, phase - offset, minAngle, maxAngle);

  let bestAngle = candidates[0];
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = scoreSingleAxisXAngleCandidate(
      upper,
      lowerReference,
      desiredInternalAngle,
      candidate,
      fallbackAngle,
    );
    if (score < bestScore) {
      bestScore = score;
      bestAngle = candidate;
    }
  }

  return bestAngle;
}

/**
 * 単軸ヒンジ角候補のスコアを返します。
 * @param {vec3} upper - 親ローカル空間の関節→親ベクトル。
 * @param {vec3} lowerReference - X 回転 0 のときの関節→エフェクタ参照ベクトル。
 * @param {number} desiredInternalAngle - 目標の関節内角。
 * @param {number} candidateAngle - 候補角。
 * @param {number} fallbackAngle - 現在角度。
 * @returns {number} 小さいほど良いスコア。
 */
function scoreSingleAxisXAngleCandidate(
  upper,
  lowerReference,
  desiredInternalAngle,
  candidateAngle,
  fallbackAngle,
) {
  const rotatedLower = vec3.create();
  rotateVectorAroundLocalXAxis(rotatedLower, lowerReference, candidateAngle);
  const denominator = Math.max(vec3.length(upper) * vec3.length(rotatedLower), IK_VECTOR_EPSILON);
  const currentInternalAngle = Math.acos(clamp(vec3.dot(upper, rotatedLower) / denominator, -1, 1));
  const angleError = Math.abs(currentInternalAngle - desiredInternalAngle);
  const angleDelta = Math.abs(normalizeRadians(candidateAngle - fallbackAngle));
  return angleError + angleDelta * 1e-4;
}

/**
 * 指定角に等価な候補を範囲内へ追加します。
 * @param {Array<number>} candidates - 候補配列。
 * @param {number} angle - 基準角。
 * @param {number} minAngle - 下限角。
 * @param {number} maxAngle - 上限角。
 */
function addEquivalentAngleCandidates(candidates, angle, minAngle, maxAngle) {
  for (const offset of IK_ANGLE_CANDIDATE_OFFSETS) {
    const candidate = angle + offset * Math.PI * 2;
    if (candidate < minAngle - 1e-6 || candidate > maxAngle + 1e-6) {
      continue;
    }
    candidates.push(clamp(candidate, minAngle, maxAngle));
  }
}

/**
 * ローカル X 軸ヒンジ角をベクトルへ適用します。
 * @param {vec3} out - 出力先。
 * @param {vec3} vector - 入力ベクトル。
 * @param {number} angle - ヒンジ角。
 * @returns {vec3} 回転後ベクトル。
 */
function rotateVectorAroundLocalXAxis(out, vector, angle) {
  const rotation = quat.create();
  quat.setAxisAngle(rotation, [1, 0, 0], -angle);
  vec3.transformQuat(out, vector, rotation);
  return out;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isSingleAxisXConstraint(link) {
  return isLockedAxis(link.minAngle[1], link.maxAngle[1])
    && isLockedAxis(link.minAngle[2], link.maxAngle[2]);
}

function isLockedAxis(min, max) {
  return Math.abs(min) <= 1e-3 && Math.abs(max) <= 1e-3;
}
