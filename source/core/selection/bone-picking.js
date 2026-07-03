import { mat4Vec4Mul, clamp } from '../../shared/math/math-utils.js';
import { getCustomRigCircleTargets } from '../model/custom-rig.js';
import { createBoneDebugLists } from '../model/model-scene.js';
import { resolvePreferredTailBoneIndex } from '../../shared/bones/vrm-child-bone-utils.js';

export const IK_TARGET_CUBE_HALF_EXTENT = 0.5;
const IK_TARGET_CUBE_PICK_HALF_EXTENT = IK_TARGET_CUBE_HALF_EXTENT * 0.1;

const PICK_DISTANCE_PX = 10;
const REPEAT_PICK_SAME_POSITION_THRESHOLD_PX = 16;

/**
 * ボーンピックで使うボーン分類リストを取得します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @returns {object} ボーン分類キャッシュ。
 */
export function getBoneDebugLists(model, scene) {
  if (scene?.boneDebugLists) {
    return scene.boneDebugLists;
  }
  return createBoneDebugLists(model);
}

/**
 * ボーンの描画・ピックで使う tail 位置を返します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {number} index - ボーンインデックス。
 * @returns {number[]|null} tail 位置。
 */
export function getBoneTailPosition(model, scene, index) {
  const bone = model?.bones?.[index] || null;
  if (!bone || !scene) {
    return null;
  }

  const boneCount = scene.boneCount ?? scene.boneWorldPositions?.length ?? (Array.isArray(model?.bones) ? model.bones.length : 0);
  const tailBoneIndex = resolvePreferredTailBoneIndex(model, index, boneCount);
  if (tailBoneIndex >= 0) {
    const tailPosition = scene.boneWorldPositions?.[tailBoneIndex] || null;
    return Array.isArray(tailPosition) ? tailPosition : null;
  }
  if (bone.tailOffset) {
    const offset = bone.tailOffset;
    const worldMat = scene.boneLocalTransforms?.[index]?.worldMatrix || null;
    if (!worldMat) {
      return null;
    }
    return [
      worldMat[0] * offset[0] + worldMat[4] * offset[1] + worldMat[8] * offset[2] + worldMat[12],
      worldMat[1] * offset[0] + worldMat[5] * offset[1] + worldMat[9] * offset[2] + worldMat[13],
      worldMat[2] * offset[0] + worldMat[6] * offset[1] + worldMat[10] * offset[2] + worldMat[14],
    ];
  }

  return null;
}

/**
 * マウス座標のワールド空間距離を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number} 画面上距離。
 */
export function projectDistanceToPointer(mvp, worldPosition, event, rect) {
  const clip = mat4Vec4Mul(mvp, [...worldPosition, 1]);
  if (clip[3] <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const screenX = (clip[0] / clip[3] * 0.5 + 0.5) * rect.width + rect.left;
  const screenY = ((-clip[1] / clip[3]) * 0.5 + 0.5) * rect.height + rect.top;
  return Math.hypot(event.clientX - screenX, event.clientY - screenY);
}

/**
 * マウス座標の線分距離を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} startWorldPosition - 線分の始点。
 * @param {Array<number>} endWorldPosition - 線分の終点。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number} 画面上距離。
 */
export function projectDistanceToPointerSegment(mvp, startWorldPosition, endWorldPosition, event, rect) {
  return projectDistanceToPointerSegmentInfo(mvp, startWorldPosition, endWorldPosition, event, rect).distance;
}

/**
 * 投影後の AABB にポインターが含まれるか判定します。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {object} aabb - AABB。
 * @returns {boolean} ヒット有無。
 */
export function isPointInProjectedAABB(event, rect, mvp, aabb) {
  const corners = [];
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z < 2; z++) {
        corners.push([
          x === 0 ? aabb.min[0] : aabb.max[0],
          y === 0 ? aabb.min[1] : aabb.max[1],
          z === 0 ? aabb.min[2] : aabb.max[2],
          1,
        ]);
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let allInFront = false;
  for (const corner of corners) {
    const clip = mat4Vec4Mul(mvp, corner);
    if (clip[3] > 0) {
      allInFront = true;
      const sx = (clip[0] / clip[3] * 0.5 + 0.5) * rect.width + rect.left;
      const sy = ((-clip[1] / clip[3]) * 0.5 + 0.5) * rect.height + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
  }

  if (!allInFront) {
    return false;
  }

  const pad = 10;
  return event.clientX >= minX - pad
    && event.clientX <= maxX + pad
    && event.clientY >= minY - pad
    && event.clientY <= maxY + pad;
}

/**
 * ボーンピック候補を 1 件選びます。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} boneDebugLists - ボーン分類キャッシュ。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {boolean} includeIkTargets - IK ターゲットを含めるか。
 * @param {number} [pickDistancePx=PICK_DISTANCE_PX] - ヒット許容距離。
 * @param {{clientX: number, clientY: number, boneIndex: number, targetIndex: number}|null} [repeatPickState=null] - 前回のピック状態。
 * @param {number} [ignoredBoneIndex=-1] - 除外するボーンインデックス。
 * @param {boolean} [preferIkTargetCube=false] - IK ターゲットのキューブを優先するか。
 * @param {Array<number>} [alreadySelectedBoneIndices=[]] - すでに選択済みのボーンインデックス。
 * @param {boolean} [instanceVisible=true] - 対象モデルが可視かどうか。
 * @returns {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number}|null} ヒット候補。
 */
export function pickBoneHit(
  model,
  scene,
  boneDebugLists,
  event,
  rect,
  mvp,
  includeIkTargets,
  pickDistancePx = PICK_DISTANCE_PX,
  repeatPickState = null,
  ignoredBoneIndex = -1,
  preferIkTargetCube = false,
  alreadySelectedBoneIndices = [],
  customRigHits = [],
  instanceVisible = true,
) {
  if (!instanceVisible) {
    return null;
  }

  const hits = collectBoneHits(
    model,
    scene,
    boneDebugLists,
    event,
    rect,
    mvp,
    includeIkTargets,
    pickDistancePx,
    ignoredBoneIndex,
    customRigHits,
    instanceVisible,
  );
  if (hits.length === 0) {
    return null;
  }

  hits.sort(compareBoneHitsByPriority);
  const selectedBoneIndexSet = new Set(Array.isArray(alreadySelectedBoneIndices) ? alreadySelectedBoneIndices : []);
  const { selectedCandidate, nonSelectedCandidate } = buildBonePickCandidateBuckets(hits, selectedBoneIndexSet);

  if (nonSelectedCandidate.length > 0) {
    return pickBoneHitFromBucket(nonSelectedCandidate, repeatPickState, event, preferIkTargetCube);
  }

  return pickBoneHitFromBucket(selectedCandidate, repeatPickState, event, preferIkTargetCube);
}

/**
 * ボックス選択用にボーンインデックスを収集します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} selection - 現在の選択状態。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {number} startX - 開始 X 座標。
 * @param {number} startY - 開始 Y 座標。
 * @param {number} endX - 終了 X 座標。
 * @param {number} endY - 終了 Y 座標。
 * @returns {Array<number>} 選択されたボーンインデックス一覧。
 */
export function collectBoneBoxSelectionIndices(instance, selection, rect, mvp, startX, startY, endX, endY) {
  const model = instance?.model || null;
  const scene = instance?.scene || null;
  if (
    instance?.visible === false
    || !model
    || !scene
    || !Array.isArray(model.bones)
    || !Array.isArray(scene.boneWorldPositions)
  ) {
    return [];
  }

  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const hideIk = Boolean(selection?.hideIkBones);
  const hideSpringBones = Boolean(selection?.hideSpringBones);
  const boneDebugLists = getBoneDebugLists(model, scene);
  const selectedBoneIndices = [];
  const selectedBoneIndexSet = new Set();
  const ikBoneIndices = new Set();

  if (hideIk && Array.isArray(model.ik)) {
    for (const ik of model.ik) {
      if (Number.isInteger(ik?.boneIndex) && ik.boneIndex >= 0) {
        ikBoneIndices.add(ik.boneIndex);
      }
      if (Array.isArray(ik?.links)) {
        for (const link of ik.links) {
          if (Number.isInteger(link?.boneIndex) && link.boneIndex >= 0) {
            ikBoneIndices.add(link.boneIndex);
          }
        }
      }
    }
  }

  const addBoneIndexIfInside = (boneIndex, worldPosition) => {
    if (selectedBoneIndexSet.has(boneIndex)) {
      return;
    }
    if (hideSpringBones && boneDebugLists.springBoneBoneIndexSet?.has(boneIndex)) {
      return;
    }
    const screenPosition = projectWorldPositionToScreen(mvp, worldPosition, rect);
    if (!screenPosition) {
      return;
    }
    if (screenPosition[0] < left || screenPosition[0] > right || screenPosition[1] < top || screenPosition[1] > bottom) {
      return;
    }
    selectedBoneIndexSet.add(boneIndex);
    selectedBoneIndices.push(boneIndex);
  };

  if (!hideIk) {
    for (const ikTarget of scene.ikTargets || []) {
      const boneIndex = ikTarget?.boneIndex ?? -1;
      if (boneIndex < 0 || boneDebugLists.hiddenBoneIndexSet.has(boneIndex)) {
        continue;
      }
      const worldPosition = scene.boneWorldPositions[boneIndex];
      if (!Array.isArray(worldPosition)) {
        continue;
      }
      addBoneIndexIfInside(boneIndex, worldPosition);
    }
  }

  for (let i = 0; i < model.bones.length; i++) {
    if (boneDebugLists.hiddenBoneIndexSet.has(i)) {
      continue;
    }
    if (hideIk && ikBoneIndices.has(i)) {
      continue;
    }
    const worldPosition = scene.boneWorldPositions[i];
    if (!Array.isArray(worldPosition)) {
      continue;
    }
    addBoneIndexIfInside(i, worldPosition);
  }

  for (const target of getCustomRigCircleTargets(instance)) {
    const boneIndex = target?.boneIndex ?? -1;
    if (boneIndex < 0 || selectedBoneIndexSet.has(boneIndex)) {
      continue;
    }
    addBoneIndexIfInside(boneIndex, target.center);
  }

  selectedBoneIndices.sort((a, b) => a - b);
  return selectedBoneIndices;
}

/**
 * 画面座標のワールド位置を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number[]|null} スクリーン座標。
 */
function projectWorldPositionToScreen(mvp, worldPosition, rect) {
  const clip = mat4Vec4Mul(mvp, [...worldPosition, 1]);
  if (clip[3] <= 0) {
    return null;
  }

  return [
    (clip[0] / clip[3] * 0.5 + 0.5) * rect.width + rect.left,
    ((-clip[1] / clip[3]) * 0.5 + 0.5) * rect.height + rect.top,
  ];
}

/**
 * ボーンヒット候補の優先順位を比較します。
 * @param {{distance: number, depth: number, kindRank: number, boneIndex: number, targetIndex: number, kind?: string}} a - 候補 A。
 * @param {{distance: number, depth: number, kindRank: number, boneIndex: number, targetIndex: number, kind?: string}} b - 候補 B。
 * @returns {number} 比較結果。
 */
function compareBoneHitsByPriority(a, b) {
  const aKindOrder = getBoneHitKindOrder(a?.kind);
  const bKindOrder = getBoneHitKindOrder(b?.kind);
  if (aKindOrder !== bKindOrder) {
    return aKindOrder - bKindOrder;
  }
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  if (a.kindRank !== b.kindRank) {
    return a.kindRank - b.kindRank;
  }
  if (a.boneIndex !== b.boneIndex) {
    return a.boneIndex - b.boneIndex;
  }
  return a.targetIndex - b.targetIndex;
}

/**
 * ボーンヒット種別の優先順位を返します。
 * @param {string|undefined} kind - ヒット種別。
 * @returns {number} 優先順位。小さいほど先に選ばれます。
 */
function getBoneHitKindOrder(kind) {
  return kind === 'custom-rig' ? 0 : 1;
}

/**
 * ボーン・IK ターゲットのヒット候補を列挙します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} boneDebugLists - ボーン分類キャッシュ。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {boolean} includeIkTargets - IK ターゲットを含めるか。
 * @param {number} pickDistancePx - ヒット許容距離。
 * @param {number} [ignoredBoneIndex=-1] - 除外するボーンインデックス。
 * @param {boolean} [instanceVisible=true] - 対象モデルが可視かどうか。
 * @returns {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number, tailBoneIndex?: number}[]} 候補一覧。
 */
function collectBoneHits(
  model,
  scene,
  boneDebugLists,
  event,
  rect,
  mvp,
  includeIkTargets,
  pickDistancePx,
  ignoredBoneIndex = -1,
  customRigHits = [],
  instanceVisible = true,
) {
  if (!instanceVisible) {
    return [];
  }

  /** @type {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number, tailBoneIndex?: number}[]} */
  const hits = [];
  const ikTargets = Array.isArray(scene?.ikTargets) ? scene.ikTargets : [];
  const boneWorldPositions = Array.isArray(scene?.boneWorldPositions) ? scene.boneWorldPositions : [];
  const bones = Array.isArray(model?.bones) ? model.bones : [];
  const customRigCandidateHits = Array.isArray(customRigHits) ? customRigHits : [];

  for (const hit of customRigCandidateHits) {
    if (!hit || !Number.isInteger(hit.boneIndex) || hit.boneIndex < 0) {
      continue;
    }
    const isHiddenBone = boneDebugLists.hiddenBoneIndexSet.has(hit.boneIndex);
    const isCustomRigBone = boneDebugLists.customRigBoneIndexSet?.has(hit.boneIndex) === true;
    if (isHiddenBone && !isCustomRigBone) {
      continue;
    }
    hits.push(hit);
  }

  if (includeIkTargets) {
    for (let i = 0; i < ikTargets.length; i++) {
      const boneIndex = ikTargets[i].boneIndex;
      if (boneIndex === ignoredBoneIndex) continue;
      if (boneDebugLists.hiddenBoneIndexSet.has(boneIndex)) continue;
      const center = boneWorldPositions[boneIndex];
      if (!Array.isArray(center)) continue;
      const cubeHit = isPointInProjectedAABB(event, rect, mvp, createIkTargetCubeAabb(center));
      if (cubeHit) {
        hits.push({
          boneIndex,
          targetIndex: i,
          distance: projectDistanceToPointer(mvp, center, event, rect),
          depth: getProjectedDepth(mvp, center),
          kind: 'ik-target',
          kindRank: 0,
        });
      }
    }
  }

  for (let i = 0; i < bones.length; i++) {
    if (i === ignoredBoneIndex) continue;
    if (boneDebugLists.hiddenBoneIndexSet.has(i)) continue;
    const worldPosition = boneWorldPositions[i];
    if (!Array.isArray(worldPosition)) continue;
    const distance = projectDistanceToPointer(mvp, worldPosition, event, rect);
    if (distance < pickDistancePx) {
      hits.push({
        boneIndex: i,
        targetIndex: -1,
        distance,
        depth: getProjectedDepth(mvp, worldPosition),
        kind: 'bone-point',
        kindRank: 0,
      });
    }
  }

  for (let i = 0; i < bones.length; i++) {
    if (i === ignoredBoneIndex) continue;
    if (boneDebugLists.hiddenBoneIndexSet.has(i)) continue;
    const startWorldPosition = boneWorldPositions[i];
    const endWorldPosition = getBoneTailPosition(model, scene, i);
    const tailBoneIndex = resolveSegmentTailBoneIndex(model, scene, i);
    if (!Array.isArray(startWorldPosition) || !Array.isArray(endWorldPosition)) continue;
    const hit = projectDistanceToPointerSegmentInfo(
      mvp,
      startWorldPosition,
      endWorldPosition,
      event,
      rect,
    );
    if (hit && hit.distance < pickDistancePx) {
      const worldPosition = [
        startWorldPosition[0] + (endWorldPosition[0] - startWorldPosition[0]) * hit.t,
        startWorldPosition[1] + (endWorldPosition[1] - startWorldPosition[1]) * hit.t,
        startWorldPosition[2] + (endWorldPosition[2] - startWorldPosition[2]) * hit.t,
      ];
      hits.push({
        boneIndex: i,
        targetIndex: -1,
        distance: hit.distance,
        depth: getProjectedDepth(mvp, worldPosition),
        kind: 'bone-segment',
        kindRank: 1,
        tailBoneIndex,
      });
    }
  }

  return hits;
}

/**
 * 線分ヒットが向かう tail 側のボーンインデックスを返します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {number} boneIndex - 線分を所有するボーン。
 * @returns {number} tail 側ボーンインデックス。解決できない場合は -1。
 */
function resolveSegmentTailBoneIndex(model, scene, boneIndex) {
  const boneCount = scene?.boneCount ?? scene?.boneWorldPositions?.length ?? (Array.isArray(model?.bones) ? model.bones.length : 0);
  return resolvePreferredTailBoneIndex(model, boneIndex, boneCount);
}

/**
 * 追加選択時に線分ヒットを tail 側ボーンへ寄せるべきか判定し、実効ボーンを返します。
 * @param {{boneIndex: number, targetIndex: number, kindRank: number, tailBoneIndex?: number}} hit - ヒット候補。
 * @param {Set<number>} selectedBoneIndexSet - 現在の選択ボーン集合。
 * @returns {number} 実効ボーンインデックス。
 */
function resolveEffectiveHitBoneIndex(hit, selectedBoneIndexSet) {
  if (!(selectedBoneIndexSet instanceof Set) || selectedBoneIndexSet.size === 0) {
    return hit.boneIndex;
  }
  if (hit?.targetIndex !== -1 || hit?.kindRank !== 1) {
    return hit.boneIndex;
  }
  if (!selectedBoneIndexSet.has(hit.boneIndex)) {
    return hit.boneIndex;
  }
  if (!Number.isInteger(hit.tailBoneIndex) || hit.tailBoneIndex < 0) {
    return hit.boneIndex;
  }
  if (selectedBoneIndexSet.has(hit.tailBoneIndex)) {
    return hit.boneIndex;
  }
  return hit.tailBoneIndex;
}

/**
 * 選択状態に応じて候補を selected / nonSelected に振り分けます。
 * @param {Array<{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number, tailBoneIndex?: number}>} hits - 候補一覧。
 * @param {Set<number>} selectedBoneIndexSet - 現在の選択ボーン集合。
 * @returns {{selectedCandidate: Array<object>, nonSelectedCandidate: Array<object>}} 振り分け結果。
 */
function buildBonePickCandidateBuckets(hits, selectedBoneIndexSet) {
  /** @type {Array<object>} */
  const selectedCandidate = [];
  /** @type {Array<object>} */
  const nonSelectedCandidate = [];

  for (const hit of hits) {
    if (hit?.kind === 'custom-rig') {
      nonSelectedCandidate.push(hit);
      continue;
    }
    const effectiveBoneIndex = resolveEffectiveHitBoneIndex(hit, selectedBoneIndexSet);
    const resolvedHit = effectiveBoneIndex === hit.boneIndex
      ? hit
      : { ...hit, boneIndex: effectiveBoneIndex };
    if (selectedBoneIndexSet.has(resolvedHit.boneIndex)) {
      selectedCandidate.push(resolvedHit);
    } else {
      nonSelectedCandidate.push(resolvedHit);
    }
  }

  return {
    selectedCandidate,
    nonSelectedCandidate,
  };
}

/**
 * 候補バケットから 1 件のヒットを選びます。
 * @param {Array<{boneIndex: number, targetIndex: number}>} candidates - 既に選別済みの候補。
 * @param {{clientX: number, clientY: number, boneIndex: number, targetIndex: number}|null} repeatPickState - 直前のピック状態。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {boolean} preferIkTargetCube - IK ターゲットキューブを優先するか。
 * @returns {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number, tailBoneIndex?: number}|null} 選択候補。
 */
function pickBoneHitFromBucket(candidates, repeatPickState, event, preferIkTargetCube) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  if (preferIkTargetCube) {
    const ikTargetHit = candidates.find((hit) => hit.kind === 'ik-target');
    if (ikTargetHit) {
      return ikTargetHit;
    }
  }

  if (!isRepeatPickPosition(repeatPickState, event)) {
    return candidates[0];
  }

  const previousHitIndex = candidates.findIndex((hit) => hit.boneIndex === repeatPickState.boneIndex
    && hit.targetIndex === repeatPickState.targetIndex);
  if (previousHitIndex === -1) {
    return candidates[0];
  }

  const sameBoneHits = candidates.filter((hit) => hit.boneIndex === repeatPickState.boneIndex);
  if (sameBoneHits.length > 1) {
    const previousSameBoneIndex = sameBoneHits.findIndex((hit) => hit.targetIndex === repeatPickState.targetIndex);
    if (previousSameBoneIndex !== -1) {
      return sameBoneHits[(previousSameBoneIndex + 1) % sameBoneHits.length];
    }
  }

  return candidates[(previousHitIndex + 1) % candidates.length];
}

/**
 * IK ターゲットのキューブに対応する AABB を作成します。
 * @param {Array<number>} center - キューブ中心。
 * @returns {{min: number[], max: number[]}} AABB。
 */
function createIkTargetCubeAabb(center) {
  return {
    min: [
      center[0] - IK_TARGET_CUBE_PICK_HALF_EXTENT,
      center[1] - IK_TARGET_CUBE_PICK_HALF_EXTENT,
      center[2] - IK_TARGET_CUBE_PICK_HALF_EXTENT,
    ],
    max: [
      center[0] + IK_TARGET_CUBE_PICK_HALF_EXTENT,
      center[1] + IK_TARGET_CUBE_PICK_HALF_EXTENT,
      center[2] + IK_TARGET_CUBE_PICK_HALF_EXTENT,
    ],
  };
}

/**
 * 投影後の深度値を取得します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @returns {number} 正規化深度。
 */
function getProjectedDepth(mvp, worldPosition) {
  const projected = mat4Vec4Mul(mvp, [worldPosition[0], worldPosition[1], worldPosition[2], 1]);
  if (!Number.isFinite(projected[3]) || projected[3] === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return projected[2] / projected[3];
}

/**
 * 投影後の線分の距離と最近傍位置を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} startWorldPosition - 線分の始点。
 * @param {Array<number>} endWorldPosition - 線分の終点。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {{distance: number, t: number}|null} 画面上距離と最近傍係数。
 */
function projectDistanceToPointerSegmentInfo(mvp, startWorldPosition, endWorldPosition, event, rect) {
  const startClip = mat4Vec4Mul(mvp, [...startWorldPosition, 1]);
  const endClip = mat4Vec4Mul(mvp, [...endWorldPosition, 1]);
  if (startClip[3] <= 0 || endClip[3] <= 0) {
    return null;
  }

  const startScreenX = (startClip[0] / startClip[3] * 0.5 + 0.5) * rect.width + rect.left;
  const startScreenY = ((-startClip[1] / startClip[3]) * 0.5 + 0.5) * rect.height + rect.top;
  const endScreenX = (endClip[0] / endClip[3] * 0.5 + 0.5) * rect.width + rect.left;
  const endScreenY = ((-endClip[1] / endClip[3]) * 0.5 + 0.5) * rect.height + rect.top;
  const dx = endScreenX - startScreenX;
  const dy = endScreenY - startScreenY;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-6) {
    return {
      distance: Math.hypot(event.clientX - startScreenX, event.clientY - startScreenY),
      t: 0,
    };
  }

  const t = clamp(
    ((event.clientX - startScreenX) * dx + (event.clientY - startScreenY) * dy) / lengthSq,
    0,
    1,
  );
  const nearestX = startScreenX + dx * t;
  const nearestY = startScreenY + dy * t;
  return {
    distance: Math.hypot(event.clientX - nearestX, event.clientY - nearestY),
    t,
  };
}

/**
 * 再クリックを同じ位置とみなすか判定します。
 * @param {{clientX: number, clientY: number}|null} previousPick - 前回のピック位置。
 * @param {PointerEvent|object} event - 現在のポインターイベント相当。
 * @param {number} [thresholdPx=REPEAT_PICK_SAME_POSITION_THRESHOLD_PX] - 許容距離。
 * @returns {boolean} 同じ位置かどうか。
 */
function isRepeatPickPosition(previousPick, event, thresholdPx = REPEAT_PICK_SAME_POSITION_THRESHOLD_PX) {
  if (!previousPick) {
    return false;
  }
  const dx = event.clientX - previousPick.clientX;
  const dy = event.clientY - previousPick.clientY;
  return dx * dx + dy * dy <= thresholdPx * thresholdPx;
}
