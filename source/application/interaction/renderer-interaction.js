import { mat4, quat, vec3 } from '../../lib/esm/index.js';
import { worldDeltaToLocalDelta } from '../../core/physics/ik.js';
import {
  clamp,
  cross,
  mat4Invert,
  mat4Vec4Mul,
  normalize,
  vec4Scale,
} from '../../shared/math/math-utils.js';
import { createViewProjection, setCameraManualPose } from '../../core/scene/camera.js';
import { getGizmoScale, pickGizmo, pickCircularHandleHit, beginGizmoDrag, updateGizmoDrag, endGizmoDrag } from '../../core/selection/gizmo.js';
import { getCustomRigCircleTargets } from '../../core/model/custom-rig.js';
import { pickLightObject } from '../../core/scene/light-object.js';
import { applyBoneBoxSelection as sharedApplyBoneBoxSelection, applyBoneSelectionFromHit, clearBoneSelection, clearLightSelection, getSelectedBoneIndices, setLightSelection, setMultiBoneSelection, setSingleBoneSelection } from '../../core/selection/renderer-selection.js';
import { IK_TARGET_CUBE_HALF_EXTENT, getBoneDebugLists, getBoneTailPosition } from '../../ui/ui-overlay.js';
import {
  collectBoneBoxSelectionIndices as sharedCollectBoneBoxSelectionIndices,
  isPointInProjectedAABB as sharedIsPointInProjectedAABB,
  pickBoneHit as sharedPickBoneHit,
  projectDistanceToPointer as sharedProjectDistanceToPointer,
  projectDistanceToPointerSegment as sharedProjectDistanceToPointerSegment,
} from '../../core/selection/bone-picking.js';
import { resolvePreferredTailBoneIndex } from '../../shared/bones/vrm-child-bone-utils.js';
import { getBoneInfoDisplayLocalPosition, getLocalPositionFromBoneInfoDisplayPosition } from '../../shared/bones/bone-display-utils.js';

/*
 * 「ボーン中心の点ヒット」と「ボーン線分のヒット」の両方に共通の許容距離
 */
const PICK_DISTANCE_PX = 10;
/**
 * 同じ位置の再クリックとみなす許容距離です。
 * タブレットやスタイラスの入力揺れを吸収するため、ピクセル単位で少し広めに取ります。
 */
const REPEAT_PICK_SAME_POSITION_THRESHOLD_PX = 16;
/**
 * ギズモをクリックではなくドラッグとして扱い始める移動距離です。
 */
const GIZMO_CLICK_DRAG_THRESHOLD_PX = 4;
const BOX_SELECTION_DRAG_THRESHOLD_PX = 0.1;
const CUSTOM_RIG_PICK_THICKNESS = 0.35;
const CAMERA_DOLLY_STEP = 0.001;  // ホイールドラッグ（ドリーズーム）量
const DOLLY_ZOOM_MIN_SIZE = 0.3;
const RANGE_ZOOM_MIN_SIZE_PX = 1;
const IK_TARGET_CUBE_PICK_HALF_EXTENT = IK_TARGET_CUBE_HALF_EXTENT * 0.1;

/**
 * ベクトルを任意軸回りに回転します。
 * @param {ArrayLike<number>} vector - 回転対象ベクトル。
 * @param {ArrayLike<number>} axis - 回転軸。
 * @param {number} radians - 回転角。
 * @returns {number[]} 回転後ベクトル。
 */
function rotateVectorAroundAxis(vector, axis, radians) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dot = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const crossVec = cross(axis, vector);
  return [
    vector[0] * cos + crossVec[0] * sin + axis[0] * dot * (1 - cos),
    vector[1] * cos + crossVec[1] * sin + axis[1] * dot * (1 - cos),
    vector[2] * cos + crossVec[2] * sin + axis[2] * dot * (1 - cos),
  ];
}

/**
 * 正規化可能なベクトルだけを返します。
 * @param {ArrayLike<number>} vector - 入力ベクトル。
 * @returns {number[]|null} 正規化結果。
 */
function normalizeOrNull(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-8) {
    return null;
  }
  return normalize(vector);
}

/**
 * 要素がテキスト編集系の入力かどうかを判定します。
 * @param {EventTarget|null} element - 判定対象。
 * @returns {boolean} 編集系入力なら true。
 */
function isEditableInputElement(element) {
  if (!element || typeof element !== 'object') {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = String(element.tagName ?? '').toUpperCase();
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA';
}

/**
 * shadow DOM を含めた現在の編集対象要素を返します。
 * @param {Document|undefined|null} rootDocument - 判定対象 document。
 * @returns {EventTarget|null} 編集対象要素。
 */
function getFocusedEditableElement(rootDocument) {
  let currentElement = rootDocument?.activeElement ?? null;

  while (currentElement) {
    if (isEditableInputElement(currentElement)) {
      return currentElement;
    }

    const shadowRoot = currentElement.shadowRoot;
    if (!shadowRoot || !('activeElement' in shadowRoot)) {
      return null;
    }
    currentElement = shadowRoot.activeElement;
  }

  return null;
}

/**
 * キーイベントが編集系入力上で発生したかどうかを判定します。
 * @param {KeyboardEvent|object} event - 判定対象。
 * @returns {boolean} 編集系入力なら true。
 */
function isEditingNumericInputEvent(event) {
  if (typeof event?.composedPath === 'function') {
    try {
      const path = event.composedPath();
      if (Array.isArray(path) && path.some((element) => isEditableInputElement(element))) {
        return true;
      }
    } catch {
      // composedPath 非対応のテスト環境ではフォールバックへ進む。
    }
  }

  return Boolean(getFocusedEditableElement(typeof document !== 'undefined' ? document : null));
}

/**
 * カメラを視線平面上で平行移動します。
 * @param {object} camera - カメラ状態。
 * @param {number} dx - 画面上の X 差分。
 * @param {number} dy - 画面上の Y 差分。
 */
function translateCameraInViewPlane(camera, dx, dy) {
  const { right, up } = getCameraBasis(camera);
  const scale = camera.distance * 0.001;
  camera.center[0] -= (dx * right[0] - dy * up[0]) * scale;
  camera.center[1] -= (dx * right[1] - dy * up[1]) * scale;
  camera.center[2] -= (dx * right[2] - dy * up[2]) * scale;
}

/**
 * カメラ距離を前後に移動します。
 * @param {object} camera - カメラ状態。
 * @param {number} delta - 距離変化量。
 */
function dollyCamera(camera, delta) {
  camera.distance = Math.max(DOLLY_ZOOM_MIN_SIZE, camera.distance + delta);
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

/**
 * カメラの右方向・上方向・前方向の基底を取得します。
 * @param {object} camera - カメラ状態。
 * @returns {{forward: number[], right: number[], up: number[]}} 基底ベクトル。
 */
function getCameraBasis(camera) {
  const forward = normalize([
    Math.cos(camera.phi) * Math.sin(camera.theta),
    Math.sin(camera.phi),
    Math.cos(camera.phi) * Math.cos(camera.theta),
  ]);
  const right = normalizeOrNull(cross([0, 1, 0], forward)) || normalizeOrNull(cross([0, 0, 1], forward)) || [1, 0, 0];
  const up = cross(forward, right);
  const roll = Number.isFinite(camera.roll) ? camera.roll : 0;
  if (Math.abs(roll) < 1e-8) {
    return { forward, right, up };
  }

  const rolledRight = rotateVectorAroundAxis(right, forward, roll);
  const rolledUp = rotateVectorAroundAxis(up, forward, roll);
  return {
    forward,
    right: normalize(rolledRight) || right,
    up: normalize(rolledUp) || up,
  };
}

/**
 * 画面座標からカメラ中心平面との交点を返します。
 * @param {HTMLCanvasElement} canvas - キャンバス。
 * @param {object} camera - カメラ状態。
 * @param {number} clientX - 画面 X 座標。
 * @param {number} clientY - 画面 Y 座標。
 * @returns {number[]|null} 平面との交点。
 */
function projectScreenPointToCameraPlane(canvas, camera, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * 2 - 1;
  const y = -((clientY - rect.top) / rect.height * 2 - 1);

  const mvp = createViewProjection(canvas, camera);
  const invMvp = mat4Invert(mvp);
  if (!invMvp) {
    return null;
  }

  const start = mat4Vec4Mul(invMvp, [x, y, 0, 1]);
  const end = mat4Vec4Mul(invMvp, [x, y, 1, 1]);
  vec4Scale(start, 1 / start[3], start);
  vec4Scale(end, 1 / end[3], end);
  const rayOrigin = [start[0], start[1], start[2]];
  const rayDirection = normalize([
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ]);
  const { forward } = getCameraBasis(camera);
  const denom = rayDirection[0] * forward[0] + rayDirection[1] * forward[1] + rayDirection[2] * forward[2];
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const diffX = camera.center[0] - rayOrigin[0];
  const diffY = camera.center[1] - rayOrigin[1];
  const diffZ = camera.center[2] - rayOrigin[2];
  const t = (diffX * forward[0] + diffY * forward[1] + diffZ * forward[2]) / denom;
  if (!Number.isFinite(t)) {
    return null;
  }

  return [
    rayOrigin[0] + rayDirection[0] * t,
    rayOrigin[1] + rayDirection[1] * t,
    rayOrigin[2] + rayDirection[2] * t,
  ];
}

/**
 * 範囲ズームのターゲットを計算します。
 * @param {HTMLCanvasElement} canvas - キャンバス。
 * @param {object} camera - カメラ状態。
 * @param {number} startX - 開始 X 座標。
 * @param {number} startY - 開始 Y 座標。
 * @param {number} endX - 終了 X 座標。
 * @param {number} endY - 終了 Y 座標。
 * @returns {{center: number[], distance: number}|null} ズーム結果。
 */
function computeRangeZoomTarget(canvas, camera, startX, startY, endX, endY) {
  const rect = canvas.getBoundingClientRect();
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const width = right - left;
  const height = bottom - top;
  if (width < RANGE_ZOOM_MIN_SIZE_PX || height < RANGE_ZOOM_MIN_SIZE_PX) {
    return null;
  }

  const center = projectScreenPointToCameraPlane(
    canvas,
    camera,
    (left + right) * 0.5,
    (top + bottom) * 0.5,
  );
  if (!center) {
    return null;
  }

  const scale = Math.max(width / rect.width, height / rect.height);
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  return {
    center,
    distance: Math.max(1, camera.distance * scale),
  };
}

/**
 * 範囲ズーム用の矩形オーバーレイを更新します。
 * @param {HTMLElement|null} overlay - オーバーレイ要素。
 * @param {HTMLCanvasElement} canvas - キャンバス。
 * @param {number} startX - 開始 X 座標。
 * @param {number} startY - 開始 Y 座標。
 * @param {number} endX - 終了 X 座標。
 * @param {number} endY - 終了 Y 座標。
 */
function updateRangeZoomOverlay(overlay, canvas, startX, startY, endX, endY) {
  if (!overlay) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const left = Math.min(startX, endX) - rect.left;
  const top = Math.min(startY, endY) - rect.top;
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  overlay.style.display = 'block';
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
}

/**
 * 範囲ズーム用の矩形オーバーレイを非表示にします。
 * @param {HTMLElement|null} overlay - オーバーレイ要素。
 */
function hideRangeZoomOverlay(overlay) {
  if (!overlay) {
    return;
  }

  overlay.style.display = 'none';
  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.width = '0px';
  overlay.style.height = '0px';
}

/**
 * ボックス選択用の矩形オーバーレイを更新します。
 * @param {HTMLElement|null} overlay - オーバーレイ要素。
 * @param {HTMLCanvasElement} canvas - キャンバス。
 * @param {number} startX - 開始 X 座標。
 * @param {number} startY - 開始 Y 座標。
 * @param {number} endX - 終了 X 座標。
 * @param {number} endY - 終了 Y 座標。
 */
function updateBoxSelectionOverlay(overlay, canvas, startX, startY, endX, endY) {
  if (!overlay) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const left = Math.min(startX, endX) - rect.left;
  const top = Math.min(startY, endY) - rect.top;
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  overlay.style.display = 'block';
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
}

/**
 * ボックス選択用の矩形オーバーレイを非表示にします。
 * @param {HTMLElement|null} overlay - オーバーレイ要素。
 */
function hideBoxSelectionOverlay(overlay) {
  if (!overlay) {
    return;
  }

  overlay.style.display = 'none';
  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.width = '0px';
  overlay.style.height = '0px';
}

/**
 * ワールド座標を画面座標へ投影します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number[]|null} 画面座標。範囲外や裏側の場合は null。
 */
function projectWorldPositionToScreen(mvp, worldPosition, rect) {
  const clip = mat4Vec4Mul(mvp, [...worldPosition, 1]);
  if (!Number.isFinite(clip[3]) || clip[3] <= 0) {
    return null;
  }

  return [
    (clip[0] / clip[3] * 0.5 + 0.5) * rect.width + rect.left,
    ((-clip[1] / clip[3]) * 0.5 + 0.5) * rect.height + rect.top,
  ];
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
  return sharedCollectBoneBoxSelectionIndices(instance, selection, rect, mvp, startX, startY, endX, endY);
}

/**
 * SpringBone の表示設定を反映したボーン分類を返します。
 * @param {object} boneDebugLists - 基本のボーン分類。
 * @param {object} selection - 現在の選択状態。
 * @returns {object} SpringBone 非表示を反映したボーン分類。
 */
function getSpringBoneAwareBoneDebugLists(boneDebugLists, selection) {
  if (!selection?.hideSpringBones || !boneDebugLists?.springBoneBoneIndexSet?.size) {
    return boneDebugLists;
  }

  const hiddenBoneIndexSet = new Set(boneDebugLists.hiddenBoneIndexSet || []);
  for (const boneIndex of boneDebugLists.springBoneBoneIndexSet) {
    hiddenBoneIndexSet.add(boneIndex);
  }

  return {
    ...boneDebugLists,
    hiddenBoneIndexSet,
  };
}

/**
 * ボックス選択結果を selection に反映します。
 * @param {object} selection - 現在の選択状態。
 * @param {Array<number>} boneIndices - 選択されたボーン一覧。
 * @param {boolean} additive - 追加選択かどうか。
 */
function applyBoneBoxSelection(selection, boneIndices, additive) {
  sharedApplyBoneBoxSelection(selection, boneIndices, additive);
}

/**
 * 入力イベントハンドラーを設定します。
 * @param {object} options - 入力処理オプション。
 */
export function setupInputHandlers(options) {
  const {
    canvas,
    camera,
    selection,
    inspectorState = null,
    modelManager,
    physicsEngine,
    appFacade,
    lightObject,
    refreshScene,
    activateInstance,
    gizmoState,
    depthPickState,
    queueDepthPick,
    colorTemperaturePickState,
    queueColorTemperaturePick,
    childBonePickState,
    clearCameraLookAtTarget,
    onClickPositionChanged = () => {},
    onChildBonePicked = () => {},
    getBgmManager = () => null,
    windowTarget = globalThis.window ?? null,
    documentRef = globalThis.document ?? null,
    rangeZoomOverlay = null,
    boxSelectionOverlay = null,
    exitAppFullscreen = null,
  } = options;
  const resolvedRangeZoomOverlay = rangeZoomOverlay ?? documentRef?.getElementById?.('camera-range-zoom-overlay') ?? null;
  const resolvedBoxSelectionOverlay = boxSelectionOverlay ?? documentRef?.getElementById?.('bone-box-selection-overlay') ?? null;

  /**
   * 動画書き出し中かどうかを返します。
   * @returns {boolean} ロック状態。
   */
  function isVideoExportLocked() {
    return Boolean(documentRef?.body?.classList?.contains('is-video-exporting'));
  }

  /**
   * 現在の camera 姿勢を current frame に固定します。
   */
  function syncCameraManualPose() {
    const activeInstance = appFacade?.editing?.getActiveInstance?.();
    const currentFrame = activeInstance?.animationController?.currentFrame;
    if (!Number.isFinite(currentFrame)) {
      return;
    }
    setCameraManualPose(camera, camera.center, camera.distance, camera.phi, camera.theta, camera.roll, currentFrame);
  }

  /**
   * クリック位置を記録します。
   * @param {PointerEvent|object} event - ポインターイベント相当。
   */
  function recordClickPosition(event) {
    const rect = canvas.getBoundingClientRect();
    onClickPositionChanged(
      event.clientX,
      event.clientY,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  /**
   * Child ピックモードかどうかを返します。
   * @returns {boolean} Child ピックモードかどうか。
   */
  function isChildBonePickMode() {
    return Boolean(childBonePickState?.enabled);
  }

  /**
   * 色温度ピックモードかどうかを返します。
   * @returns {boolean} 色温度ピックモードかどうか。
   */
  function isColorTemperaturePickMode() {
    return Boolean(colorTemperaturePickState?.enabled);
  }

  /**
   * Child ピックモードを解除します。
   */
  function clearChildBonePickMode() {
    if (childBonePickState) {
      childBonePickState.enabled = false;
    }
  }

  /**
   * 保留中のギズモ操作を破棄します。
   */
  function clearPendingGizmoInteraction() {
    pendingGizmoInteraction = null;
  }

  /**
   * 保留中の gizmo クリック情報を取り出し、必要なら解除します。
   * @param {number} pointerId - 対象ポインター ID。
   * @returns {{additiveSelection: boolean, selectionSnapshotIndices: Array<number>, ignoreBoneIndex: number}|null} クリック情報。
   */
  function consumePendingGizmoClickState(pointerId) {
    if (!pendingGizmoInteraction || pendingGizmoInteraction.pointerId !== pointerId) {
      return null;
    }

    const pendingSelection = pendingGizmoInteraction.selection;
    const additiveSelection = Boolean(pendingGizmoInteraction.shiftKey);
    const selectionSnapshotIndices = getSelectedBoneIndices(pendingSelection, null);
    const ignoreBoneIndex = additiveSelection ? -1 : (Number.isInteger(pendingSelection?.selectedBoneIndex) ? pendingSelection.selectedBoneIndex : -1);
    clearPendingGizmoInteraction();
    return {
      additiveSelection,
      selectionSnapshotIndices,
      ignoreBoneIndex,
    };
  }

  /**
   * クリック確定の共通後処理を実行します。
   * @param {object} options - クリック確定オプション。
   * @param {PointerEvent|object} options.event - ポインターイベント相当。
   * @param {number} options.ignoreBoneIndex - ピックから除外するボーンインデックス。
   * @param {boolean} options.additiveSelection - 追加選択かどうか。
   * @param {Array<number>} options.selectionSnapshotIndices - クリック開始時の選択スナップショット。
   * @param {{clientX: number, clientY: number, boneIndex: number, targetIndex: number}|null} options.previousBonePick - 直前のボーンピック。
   * @param {(value: {clientX: number, clientY: number, boneIndex: number, targetIndex: number}|null) => void} options.setPreviousBonePick - 前回ピックの更新関数。
   */
  function commitSceneClickSelection(options) {
    const {
      event,
      ignoreBoneIndex,
      additiveSelection,
      selectionSnapshotIndices,
      previousBonePick,
      setPreviousBonePick,
    } = options;
    const previousBoneIndex = selection.selectedBoneIndex;
    const previousTargetIndex = selection.selectedTargetIndex;
    recordClickPosition(event);
    pickSceneElement({
      event,
      canvas,
      camera,
      selection,
      modelManager,
      physicsEngine,
      activateInstance,
      lightObject,
      previousBonePick,
      previousAabbPick,
      ignoreBoneIndex,
      additiveSelection,
      selectionSnapshotIndices,
      setPreviousBonePick,
      setPreviousAabbPick(value) {
        previousAabbPick = value;
      },
    });

    let advancedAfterGizmoRelease = false;
    if (selection.selectedBoneIndex === previousBoneIndex && selection.selectedTargetIndex === previousTargetIndex) {
      advanceSelectionAfterGizmoRelease(previousBoneIndex);
      advancedAfterGizmoRelease = selection.selectedBoneIndex !== previousBoneIndex
        || selection.selectedTargetIndex !== previousTargetIndex;
    }
    if (additiveSelection && advancedAfterGizmoRelease && selectionSnapshotIndices.length > 0) {
      const mergedIndices = Array.from(new Set([
        ...selectionSnapshotIndices,
        ...(Array.isArray(selection.selectedBoneIndices) ? selection.selectedBoneIndices : []),
      ]));
      selection.selectedBoneIndices = mergedIndices;
      if (!mergedIndices.includes(selection.activeBoneIndex)) {
        selection.activeBoneIndex = mergedIndices[mergedIndices.length - 1] ?? -1;
      }
      if (!mergedIndices.includes(selection.selectedBoneIndex)) {
        selection.selectedBoneIndex = selection.activeBoneIndex;
      }
    }
    refreshScene();
  }

  /**
   * Child ピックモードで bone を 1 件選びます。
   * @param {PointerEvent|object} event - ポインターイベント相当。
   * @returns {boolean} ピックできたかどうか。
   */
  function commitChildBonePick(event) {
    const picked = pickSceneElement({
      event,
      canvas,
      camera,
      selection,
      modelManager,
      physicsEngine,
      activateInstance,
      lightObject,
      previousBonePick: null,
      previousAabbPick: null,
      suppressSelection: true,
      skipPhysicsPick: true,
      skipCustomRigHits: true,
      onBonePicked: (hit) => {
        onChildBonePicked(hit?.instance ?? null, hit?.boneIndex ?? -1, hit?.targetIndex ?? -1);
      },
      setPreviousBonePick(value) {
        previousBonePick = value;
      },
      setPreviousAabbPick(value) {
        previousAabbPick = value;
      },
    });
    if (picked) {
      clearChildBonePickMode();
      previousBonePick = null;
      previousAabbPick = null;
      return true;
    }
    return false;
  }

  /**
   * gizmo リリース後に選択が変わらなかった場合のフォールバックで、
   * 同一モデル内の次のボーンへ進めます。
   * @param {number} previousBoneIndex - リリース前の選択ボーン。
   */
  function advanceSelectionAfterGizmoRelease(previousBoneIndex) {
    if (!Number.isInteger(previousBoneIndex) || previousBoneIndex < 0) {
      return;
    }

    const activeInst = modelManager.instances[selection.activeInstanceIndex];
    if (activeInst?.visible === false) {
      return;
    }

    if (getSelectedBoneIndices(selection, activeInst).length > 1) {
      return;
    }

    const boneCount = activeInst?.model?.bones?.length ?? 0;
    if (boneCount <= 1) {
      return;
    }

    const nextBoneIndex = getNextGizmoReleaseBoneIndex(activeInst.model, previousBoneIndex);
    if (nextBoneIndex === -1) {
      return;
    }

    setSingleBoneSelection(selection, nextBoneIndex);
    selection.selectedTargetIndex = -1;
  }

  /**
   * gizmo リリース後に進める次のボーン index を返します。
   * glTF の terminal helper bone は自動遷移の対象にしません。
   * @param {object} model - モデルデータ。
   * @param {number} previousBoneIndex - リリース前の選択ボーン。
   * @returns {number} 次のボーン index。該当なしの場合は -1。
   */
  function getNextGizmoReleaseBoneIndex(model, previousBoneIndex) {
    const bones = Array.isArray(model?.bones) ? model.bones : [];
    if (!Number.isInteger(previousBoneIndex) || previousBoneIndex < 0 || bones.length <= 1) {
      return -1;
    }

    const nextBoneIndex = (previousBoneIndex + 1) % bones.length;
    const nextBone = bones[nextBoneIndex];
    if (isGltfLeafHelperBone(nextBone)) {
      return -1;
    }

    return nextBoneIndex;
  }

  /**
   * glTF の terminal helper bone かどうかを判定します。
   * @param {object|null|undefined} bone - 判定対象ボーン。
   * @returns {boolean} helper bone なら true。
   */
  function isGltfLeafHelperBone(bone) {
    return typeof bone?.name === 'string' && bone.name.endsWith('_leaf');
  }

  /**
   * 現在のポインタ位置でギズモヒットを試行し、ヒットしたら保留状態にします。
   * @param {PointerEvent|object} event - ポインターイベント相当。
   * @returns {boolean} 保留状態を開始したかどうか。
   */
  function tryBeginPendingGizmoInteraction(event) {
    const ray = getRayFromMouse(event, canvas, camera);
    const activeInst = selection.selectedLight ? null : modelManager.instances[selection.activeInstanceIndex];
    if (!selection.selectedLight && (!activeInst || activeInst.visible === false)) {
      return false;
    }

    const tempSelection = selection.selectedLight
      ? { ...selection }
      : {
        ...selection,
        selectedBoneIndices: getSelectedBoneIndices(selection, activeInst),
      };
    const gizmoHit = pickGizmo(ray, activeInst, tempSelection, lightObject, inspectorState);
    if (!gizmoHit) {
      return false;
    }

    pendingGizmoInteraction = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hit: gizmoHit,
      instance: activeInst,
      lightObject: lightObject ?? null,
      selection: tempSelection,
      shiftKey: Boolean(event.shiftKey),
    };
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  /**
   * 保留中のギズモ操作がドラッグへ昇格する距離まで移動したかを判定します。
   * @param {PointerEvent|object} event - ポインターイベント相当。
   * @returns {boolean} 昇格したかどうか。
   */
  function promotePendingGizmoDragIfNeeded(event) {
    if (!pendingGizmoInteraction) {
      return false;
    }

    const dx = event.clientX - pendingGizmoInteraction.startClientX;
    const dy = event.clientY - pendingGizmoInteraction.startClientY;
    if (dx * dx + dy * dy < GIZMO_CLICK_DRAG_THRESHOLD_PX * GIZMO_CLICK_DRAG_THRESHOLD_PX) {
      return false;
    }

    const pending = pendingGizmoInteraction;
    clearPendingGizmoInteraction();
    beginGizmoDrag(gizmoState, pending.hit, pending.instance, pending.selection, modelManager, pending.lightObject, inspectorState);
    return true;
  }

  windowTarget?.addEventListener?.('keydown', (event) => {
    if (isVideoExportLocked()) {
      return;
    }

    if (event.key && event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey && documentRef?.body?.classList?.contains('app-fullscreen')) {
      event.preventDefault();
      if (typeof exitAppFullscreen === 'function') {
        exitAppFullscreen();
      }
      return;
    }

    // Skip if focused on an editable control, including inputs inside shadow DOM.
    if (isEditingNumericInputEvent(event)) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      appFacade?.animation?.deleteSelectedKeyframes?.();
      return;
    }

    const inst = modelManager.instances[selection.activeInstanceIndex];
    if (!inst) {
      return;
    }

    if (event.key === ' ') {
      if (appFacade?.playback?.togglePlayback) {
        appFacade.playback.togglePlayback();
        getBgmManager?.()?.syncFromActivePlayback?.({ forceSeek: true });
        refreshScene?.({ step: 0 });
      }
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.shiftKey ? -10 : -1;
      if (appFacade?.playback) {
        if (event.ctrlKey){
          appFacade.playback.stepKeyframe?.(-1);
        }
        else {
          appFacade.playback.stepFrame?.(delta);
        }
        getBgmManager?.()?.syncFromActivePlayback?.({ forceSeek: true });
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.shiftKey ? 10 : 1;
      if (appFacade?.playback) {
        if (event.ctrlKey){
          appFacade.playback.stepKeyframe?.(1);
        }
        else {
          appFacade.playback.stepFrame?.(delta);
        }
        getBgmManager?.()?.syncFromActivePlayback?.({ forceSeek: true });
      }
      return;
    }

    const didChangeTarget = handleTargetKeydown(event, selection, inst.scene, inst.model, modelManager, inst);
    const didChangeMorph = handleMorphKeydown(event, inst.model, inst.morphController);
    if (didChangeTarget || didChangeMorph) {
      refreshScene();
    }
  });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    if (isVideoExportLocked()) {
      return;
    }
    event.preventDefault();
    dollyCamera(camera, event.deltaY * CAMERA_DOLLY_STEP);
    syncCameraManualPose();
  }, { passive: false });

  let prevTouchDistance = -1;
  let isTouchDragging = false;
  let touchLastX = 0;
  let touchLastY = 0;
  let touchMoved = false;
  let isTouchPinching = false;
  let prevTouchCenterX = -1;
  let prevTouchCenterY = -1;
  let isMouseZoomDragging = false;
  let mouseZoomLastY = 0;
  let isMouseDollyDragging = false;
  let mouseDollyLastY = 0;
  let isBoneBoxSelectionPending = false;
  let isBoneBoxSelectionDragging = false;
  let boneBoxSelectionStartX = 0;
  let boneBoxSelectionStartY = 0;
  let boneBoxSelectionCurrentX = 0;
  let boneBoxSelectionCurrentY = 0;
  let boneBoxSelectionAdditiveSelection = false;
  /** @type {Array<number>} */
  let boneBoxSelectionSelectionSnapshotIndices = [];
  /** @type {{pointerId: number, startClientX: number, startClientY: number, hit: object, instance: object, selection: object}|null} */
  let pendingGizmoInteraction = null;
  /** @type {{clientX: number, clientY: number, boneIndex: number, targetIndex: number}|null} */
  let previousBonePick = null;
  /** @type {{clientX: number, clientY: number, instanceIndex: number}|null} */
  let previousAabbPick = null;
  let isRangeZoomDragging = false;
  let rangeZoomStartX = 0;
  let rangeZoomStartY = 0;
  let rangeZoomCurrentX = 0;
  let rangeZoomCurrentY = 0;
  windowTarget?.addEventListener?.('wheel', (event) => {
    if (isVideoExportLocked()) {
      return;
    }
    if (event.ctrlKey && !event.defaultPrevented) {
      event.preventDefault();
      camera.distance = Math.max(DOLLY_ZOOM_MIN_SIZE, camera.distance + event.deltaY * 0.05);
      syncCameraManualPose();
      refreshScene();
    }
  }, { passive: false });

  const activePointers = new Map();
  canvas.addEventListener('pointerdown', (event) => {
    if (isVideoExportLocked()) {
      return;
    }

    if (isChildBonePickMode() && event.pointerType !== 'touch' && event.button === 0) {
      previousBonePick = null;
      previousAabbPick = null;
      recordClickPosition(event);
      activePointers.set(event.pointerId, event);
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    recordClickPosition(event);
    activePointers.set(event.pointerId, event);
    if (activePointers.size < 2) {
      prevTouchDistance = -1;
    }

    if (event.pointerType !== 'touch' && event.button === 0 && event.altKey && event.ctrlKey) {
      previousBonePick = null;
      previousAabbPick = null;
      if (typeof clearCameraLookAtTarget === 'function' && clearCameraLookAtTarget()) {
        refreshScene();
      }
      isRangeZoomDragging = true;
      rangeZoomStartX = event.clientX;
      rangeZoomStartY = event.clientY;
      rangeZoomCurrentX = event.clientX;
      rangeZoomCurrentY = event.clientY;
      updateRangeZoomOverlay(
        resolvedRangeZoomOverlay,
        canvas,
        rangeZoomStartX,
        rangeZoomStartY,
        rangeZoomCurrentX,
        rangeZoomCurrentY,
      );
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (event.pointerType !== 'touch' && event.button === 0 && event.shiftKey && event.altKey) {
      previousBonePick = null;
      previousAabbPick = null;
      if (typeof queueDepthPick === 'function') {
        queueDepthPick(event.clientX, event.clientY, 'camera-center');
      }
      return;
    }

    if (event.pointerType !== 'touch' && event.button === 0 && depthPickState?.enabled) {
      previousBonePick = null;
      previousAabbPick = null;
      if (typeof queueDepthPick === 'function') {
        queueDepthPick(event.clientX, event.clientY);
      }
      return;
    }

    if (event.pointerType !== 'touch' && event.button === 0 && isColorTemperaturePickMode()) {
      previousBonePick = null;
      previousAabbPick = null;
      if (typeof queueColorTemperaturePick === 'function') {
        queueColorTemperaturePick(event.clientX, event.clientY);
      }
      return;
    }

    if (event.pointerType === 'touch') {
      if (activePointers.size === 1) {
        if (tryBeginPendingGizmoInteraction(event)) {
          return;
        }

        previousBonePick = null;
        previousAabbPick = null;
        isTouchDragging = true;
        touchMoved = false;
        touchLastX = event.clientX;
        touchLastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      if (activePointers.size === 2) {
        previousBonePick = null;
        previousAabbPick = null;
        clearPendingGizmoInteraction();
        if (typeof clearCameraLookAtTarget === 'function' && clearCameraLookAtTarget()) {
          refreshScene();
        }
        const pointers = Array.from(activePointers.values());
        prevTouchCenterX = (pointers[0].clientX + pointers[1].clientX) * 0.5;
        prevTouchCenterY = (pointers[0].clientY + pointers[1].clientY) * 0.5;
        const dx = pointers[0].clientX - pointers[1].clientX;
        const dy = pointers[0].clientY - pointers[1].clientY;
        prevTouchDistance = Math.sqrt(dx * dx + dy * dy);
        isTouchDragging = false;
        if (!isTouchPinching) {
          isTouchPinching = true;
          console.log('[input] pinch start', {
            pointerId: event.pointerId,
            pointerCount: activePointers.size,
            distance: prevTouchDistance,
          });
        }
        return;
      }

      return;
    }

    if (event.button === 0) {
      if (tryBeginPendingGizmoInteraction(event)) {
        return;
      }

      hideBoxSelectionOverlay(resolvedBoxSelectionOverlay);
      isBoneBoxSelectionPending = true;
      isBoneBoxSelectionDragging = false;
      boneBoxSelectionStartX = event.clientX;
      boneBoxSelectionStartY = event.clientY;
      boneBoxSelectionCurrentX = event.clientX;
      boneBoxSelectionCurrentY = event.clientY;
      boneBoxSelectionAdditiveSelection = Boolean(event.shiftKey);
      boneBoxSelectionSelectionSnapshotIndices = getSelectedBoneIndices(selection, modelManager.instances[selection.activeInstanceIndex] ?? null);
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button === 2) {
      previousBonePick = null;
      previousAabbPick = null;
      if (event.altKey) {
        isMouseDollyDragging = true;
        mouseDollyLastY = event.clientY;
      } else {
        camera.isDragging = true;
      }
    } else if (event.button === 1) {
      previousBonePick = null;
      previousAabbPick = null;
      if (typeof clearCameraLookAtTarget === 'function' && clearCameraLookAtTarget()) {
        refreshScene();
      }
      camera.isPanning = true;
    } else {
      return;
    }

    camera.lastX = event.clientX;
    camera.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (isVideoExportLocked()) {
      return;
    }
    activePointers.set(event.pointerId, event);

    if (pendingGizmoInteraction) {
      if (activePointers.size > 1 || event.pointerId !== pendingGizmoInteraction.pointerId) {
        clearPendingGizmoInteraction();
      } else if (!promotePendingGizmoDragIfNeeded(event)) {
        return;
      } else {
        if (event.pointerType === 'touch') {
          touchMoved = true;
        }
        const ray = getRayFromMouse(event, canvas, camera);
        const activeInst = modelManager.instances[selection.activeInstanceIndex];
        // Note: gizmoState.boneIndex is already set in beginGizmoDrag,
        // which we updated to handle IK target bone indices.
        if (updateGizmoDrag(gizmoState, activeInst, ray, selection, modelManager, inspectorState)) {
          refreshScene();
        }
        return;
      }
    }

    if (gizmoState.isDragging) {
      const ray = getRayFromMouse(event, canvas, camera);
      const activeInst = modelManager.instances[selection.activeInstanceIndex];
      // Note: gizmoState.boneIndex is already set in beginGizmoDrag, 
      // which we updated to handle IK target bone indices.
      if (updateGizmoDrag(gizmoState, activeInst, ray, selection, modelManager, inspectorState)) {
        refreshScene();
      }
      return;
    }

    if (isBoneBoxSelectionPending && event.pointerType !== 'touch') {
      const dx = event.clientX - boneBoxSelectionStartX;
      const dy = event.clientY - boneBoxSelectionStartY;
      if (!isBoneBoxSelectionDragging && dx * dx + dy * dy >= BOX_SELECTION_DRAG_THRESHOLD_PX * BOX_SELECTION_DRAG_THRESHOLD_PX) {
        isBoneBoxSelectionDragging = true;
        previousBonePick = null;
        previousAabbPick = null;
      }

      if (isBoneBoxSelectionDragging) {
        boneBoxSelectionCurrentX = event.clientX;
        boneBoxSelectionCurrentY = event.clientY;
        updateBoxSelectionOverlay(
          resolvedBoxSelectionOverlay,
          canvas,
          boneBoxSelectionStartX,
          boneBoxSelectionStartY,
          boneBoxSelectionCurrentX,
          boneBoxSelectionCurrentY,
        );
      }
      return;
    }

    if (isRangeZoomDragging && event.pointerType !== 'touch') {
      rangeZoomCurrentX = event.clientX;
      rangeZoomCurrentY = event.clientY;
      updateRangeZoomOverlay(
        resolvedRangeZoomOverlay,
        canvas,
        rangeZoomStartX,
        rangeZoomStartY,
        rangeZoomCurrentX,
        rangeZoomCurrentY,
      );
      return;
    }

    if (isMouseZoomDragging && event.pointerType !== 'touch') {
      const delta = (event.clientY - mouseZoomLastY) * CAMERA_DOLLY_STEP;
      dollyCamera(camera, delta);
      syncCameraManualPose();
      console.log('[input] shift+drag zoom move', {
        pointerId: event.pointerId,
        y: event.clientY,
        delta,
        distance: camera.distance,
      });
      mouseZoomLastY = event.clientY;
      refreshScene();
      return;
    }

    if (isMouseDollyDragging && event.pointerType !== 'touch') {
      const delta = (event.clientY - mouseDollyLastY) * CAMERA_DOLLY_STEP * 10;
      dollyCamera(camera, delta);
      mouseDollyLastY = event.clientY;
      syncCameraManualPose();
      refreshScene();
      return;
    }

    if (event.pointerType === 'touch') {
      if (activePointers.size === 2) {
        const pointers = Array.from(activePointers.values());
        const centroidX = (pointers[0].clientX + pointers[1].clientX) * 0.5;
        const centroidY = (pointers[0].clientY + pointers[1].clientY) * 0.5;
        const dx = pointers[0].clientX - pointers[1].clientX;
        const dy = pointers[0].clientY - pointers[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let needsRefresh = false;
        if (prevTouchCenterX >= 0 && prevTouchCenterY >= 0) {
          translateCameraInViewPlane(
            camera,
            centroidX - prevTouchCenterX,
            centroidY - prevTouchCenterY,
          );
          needsRefresh = true;
        }
        if (prevTouchDistance > 0) {
          const delta = (prevTouchDistance - distance) * 0.2;
          camera.distance = Math.max(DOLLY_ZOOM_MIN_SIZE, camera.distance + delta);
          needsRefresh = true;
        }
        if (needsRefresh) {
          syncCameraManualPose();
          refreshScene();
        }
        prevTouchCenterX = centroidX;
        prevTouchCenterY = centroidY;
        prevTouchDistance = distance;
        isTouchDragging = false;
        touchMoved = true;
        return;
      }

      if (isTouchDragging && activePointers.size === 1) {
        const dx = event.clientX - touchLastX;
        const dy = event.clientY - touchLastY;
        camera.theta -= dx * 0.01;
        camera.phi = clamp(camera.phi + dy * 0.01, -1.5, 1.5);
        touchLastX = event.clientX;
        touchLastY = event.clientY;
        touchMoved = touchMoved || Math.abs(dx) > 0 || Math.abs(dy) > 0;
        syncCameraManualPose();
        refreshScene();
        return;
      }
    }

    if (activePointers.size === 2) {
      const pointers = Array.from(activePointers.values());
      const centroidX = (pointers[0].clientX + pointers[1].clientX) * 0.5;
      const centroidY = (pointers[0].clientY + pointers[1].clientY) * 0.5;
      const dx = pointers[0].clientX - pointers[1].clientX;
      const dy = pointers[0].clientY - pointers[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let needsRefresh = false;
      if (prevTouchCenterX >= 0 && prevTouchCenterY >= 0) {
        translateCameraInViewPlane(
          camera,
          centroidX - prevTouchCenterX,
          centroidY - prevTouchCenterY,
        );
        needsRefresh = true;
      }
      if (prevTouchDistance > 0) {
        const delta = (prevTouchDistance - distance) * 0.2;
        camera.distance = Math.max(1, camera.distance + delta);
        needsRefresh = true;
      }
      if (needsRefresh) {
        syncCameraManualPose();
        refreshScene();
      }
      prevTouchCenterX = centroidX;
      prevTouchCenterY = centroidY;
      prevTouchDistance = distance;
      touchMoved = true;
      return;
    }

    const dx = event.clientX - camera.lastX;
    const dy = event.clientY - camera.lastY;
    if (camera.isDragging) {
      camera.theta -= dx * 0.01;
      camera.phi = clamp(camera.phi + dy * 0.01, -1.5, 1.5);
    } else if (camera.isPanning) {
      translateCameraInViewPlane(camera, dx, dy);
    }

    if (camera.isDragging || camera.isPanning) {
      camera.lastX = event.clientX;
      camera.lastY = event.clientY;
      syncCameraManualPose();
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    if (isVideoExportLocked()) {
      return;
    }
    activePointers.delete(event.pointerId);
    if (isChildBonePickMode() && event.pointerType !== 'touch' && event.button === 0) {
      commitChildBonePick(event);
      return;
    }
    prevTouchDistance = -1;
    prevTouchCenterX = -1;
    prevTouchCenterY = -1;
    let ignoredBoneIndex = -1;

    if (isMouseZoomDragging && event.pointerType !== 'touch') {
      console.log('[input] shift+drag zoom end', {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });
      isMouseZoomDragging = false;
    }

    if (isMouseDollyDragging && event.pointerType !== 'touch') {
      isMouseDollyDragging = false;
    }

    if (event.pointerType === 'touch') {
      if (activePointers.size === 0) {
        isTouchDragging = false;
        if (isTouchPinching) {
          console.log('[input] pinch end', {
            pointerId: event.pointerId,
          });
        }
        isTouchPinching = false;
      } else if (activePointers.size === 1) {
        const remainingPointer = Array.from(activePointers.values())[0];
        if (remainingPointer.pointerType === 'touch') {
          isTouchDragging = true;
          touchLastX = remainingPointer.clientX;
          touchLastY = remainingPointer.clientY;
          prevTouchCenterX = -1;
          prevTouchCenterY = -1;
          canvas.setPointerCapture(remainingPointer.pointerId);
        } else {
          isTouchDragging = false;
        }
      }

      const pendingGizmoClickState = consumePendingGizmoClickState(event.pointerId);
      if (pendingGizmoClickState) {
        ignoredBoneIndex = pendingGizmoClickState.ignoreBoneIndex;
      }

      if (gizmoState.isDragging) {
        endGizmoDrag(gizmoState);
        touchMoved = false;
        return;
      }

      if (!touchMoved && activePointers.size === 0) {
        if (pendingGizmoClickState) {
          commitSceneClickSelection({
            event,
            ignoreBoneIndex: ignoredBoneIndex,
            additiveSelection: pendingGizmoClickState.additiveSelection,
            selectionSnapshotIndices: pendingGizmoClickState.selectionSnapshotIndices,
            previousBonePick,
            setPreviousBonePick(value) {
              previousBonePick = value;
            },
            setPreviousAabbPick(value) {
              previousAabbPick = value;
            },
          });
        }
      }

      touchMoved = false;
      return;
    }

    if (event.pointerType !== 'touch' && event.button === 0 && isBoneBoxSelectionPending) {
      const wasDragging = isBoneBoxSelectionDragging;
      isBoneBoxSelectionPending = false;
      isBoneBoxSelectionDragging = false;
      hideBoxSelectionOverlay(resolvedBoxSelectionOverlay);

      if (wasDragging) {
        const activeInst = modelManager.instances[selection.activeInstanceIndex];
        if (activeInst) {
          const rect = canvas.getBoundingClientRect();
          const mvp = createViewProjection(canvas, camera);
          const selectedBoneIndices = collectBoneBoxSelectionIndices(
            activeInst,
            selection,
            rect,
            mvp,
            boneBoxSelectionStartX,
            boneBoxSelectionStartY,
            event.clientX,
            event.clientY,
          );
          applyBoneBoxSelection(selection, selectedBoneIndices, boneBoxSelectionAdditiveSelection);
          previousBonePick = null;
          refreshScene();
        }
        boneBoxSelectionSelectionSnapshotIndices = [];
        return;
      }

      const pickEvent = {
        ...event,
        clientX: boneBoxSelectionStartX,
        clientY: boneBoxSelectionStartY,
      };
      pickSceneElement({
        event: pickEvent,
        canvas,
        camera,
        selection,
        modelManager,
        physicsEngine,
        activateInstance,
        lightObject,
        previousBonePick,
        previousAabbPick,
        additiveSelection: boneBoxSelectionAdditiveSelection,
        selectionSnapshotIndices: boneBoxSelectionSelectionSnapshotIndices,
        setPreviousBonePick(value) {
          previousBonePick = value;
        },
        setPreviousAabbPick(value) {
          previousAabbPick = value;
        },
      });
      boneBoxSelectionSelectionSnapshotIndices = [];
      refreshScene();
      return;
    }

    const pendingGizmoClickState = consumePendingGizmoClickState(event.pointerId);
    if (pendingGizmoClickState) {
      ignoredBoneIndex = pendingGizmoClickState.ignoreBoneIndex;
      if (!gizmoState.isDragging) {
        commitSceneClickSelection({
          event,
          ignoreBoneIndex: ignoredBoneIndex,
          additiveSelection: pendingGizmoClickState.additiveSelection,
          selectionSnapshotIndices: pendingGizmoClickState.selectionSnapshotIndices,
          previousBonePick,
          setPreviousBonePick(value) {
            previousBonePick = value;
          },
          setPreviousAabbPick(value) {
            previousAabbPick = value;
          },
        });
        return;
      }
    }

    if (gizmoState.isDragging) {
      endGizmoDrag(gizmoState);
      return;
    }

    if (isRangeZoomDragging && event.pointerType !== 'touch') {
      isRangeZoomDragging = false;
      hideRangeZoomOverlay(resolvedRangeZoomOverlay);
      const zoomTarget = computeRangeZoomTarget(
        canvas,
        camera,
        rangeZoomStartX,
        rangeZoomStartY,
        event.clientX,
        event.clientY,
      );
      if (zoomTarget) {
        vec3.copy(camera.center, zoomTarget.center);
        camera.distance = zoomTarget.distance;
        syncCameraManualPose();
        refreshScene();
      } else if (typeof refreshScene === 'function') {
        refreshScene();
      }
      return;
    }

    if (event.button === 2) {
      camera.isDragging = false;
    } else if (event.button === 1) {
      camera.isPanning = false;
    }
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (isVideoExportLocked()) {
      return;
    }
    activePointers.delete(event.pointerId);
    clearPendingGizmoInteraction();
    isBoneBoxSelectionPending = false;
    isBoneBoxSelectionDragging = false;
    boneBoxSelectionSelectionSnapshotIndices = [];
    hideBoxSelectionOverlay(resolvedBoxSelectionOverlay);
    prevTouchDistance = -1;
    prevTouchCenterX = -1;
    prevTouchCenterY = -1;
    isTouchDragging = false;
    touchMoved = false;
    if (isTouchPinching) {
      console.log('[input] pinch cancel', {
        pointerId: event.pointerId,
      });
    }
    isTouchPinching = false;
    if (isMouseZoomDragging) {
      console.log('[input] shift+drag zoom cancel', {
        pointerId: event.pointerId,
      });
    }
    isMouseZoomDragging = false;
    isMouseDollyDragging = false;
    previousAabbPick = null;
    if (isRangeZoomDragging) {
      isRangeZoomDragging = false;
      hideRangeZoomOverlay(resolvedRangeZoomOverlay);
    }
    endGizmoDrag(gizmoState);
  });
}

/**
 * ワールド座標の画面距離を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number} 画面上距離。
 */
export function projectDistanceToPointer(mvp, worldPosition, event, rect) {
  return sharedProjectDistanceToPointer(mvp, worldPosition, event, rect);
}

/**
 * ワールド座標の線分の画面距離を返します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} startWorldPosition - 線分の始点。
 * @param {Array<number>} endWorldPosition - 線分の終点。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @returns {number} 画面上距離。
 */
export function projectDistanceToPointerSegment(mvp, startWorldPosition, endWorldPosition, event, rect) {
  return sharedProjectDistanceToPointerSegment(mvp, startWorldPosition, endWorldPosition, event, rect);
}

/**
 * ワールド座標の線分の画面距離と最近傍位置を返します。
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
 * ボーンと親子線分を含めた最寄りヒット候補を返します。
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
 * @param {boolean} [preferIkTargetCube=false] - IK ターゲットのキューブを優先するかどうか。
 * @param {Array<number>} [alreadySelectedBoneIndices=[]] - すでに選択済みのボーンインデックス。
 * @param {Array<object>} [customRigHits=[]] - custom rig のヒット候補。
 * @param {object|null} [selection=null] - 現在の選択状態。
 * @returns {{boneIndex: number, targetIndex: number, distance: number}|null} ヒット候補。
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
  selection = null,
) {
  const effectiveBoneDebugLists = getSpringBoneAwareBoneDebugLists(boneDebugLists, selection);
  return sharedPickBoneHit(
    model,
    scene,
    effectiveBoneDebugLists,
    event,
    rect,
    mvp,
    includeIkTargets,
    pickDistancePx,
    repeatPickState,
    ignoredBoneIndex,
    preferIkTargetCube,
    alreadySelectedBoneIndices,
    customRigHits,
    instanceVisible,
  );
}

/**
 * ボーンピック候補を深度と距離付きで列挙します。
 * @param {object} model - モデルデータ。
 * @param {object} scene - シーン状態。
 * @param {object} boneDebugLists - ボーン分類キャッシュ。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {boolean} includeIkTargets - IK ターゲットを含めるか。
 * @param {number} pickDistancePx - ヒット許容距離。
 * @returns {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number}[]} 候補一覧。
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
) {
  /** @type {{boneIndex: number, targetIndex: number, distance: number, depth: number, kindRank: number}[]} */
  const hits = [];

  if (includeIkTargets) {
    for (let i = 0; i < scene.ikTargets.length; i++) {
      const boneIndex = scene.ikTargets[i].boneIndex;
      if (boneIndex === ignoredBoneIndex) continue;
      if (boneDebugLists.hiddenBoneIndexSet.has(boneIndex)) continue;
      const center = scene.boneWorldPositions[boneIndex];
      if (!center) continue;
      const cubeHit = isPointInProjectedAABB(event, rect, mvp, createIkTargetCubeAabb(center));
      if (cubeHit) {
        hits.push({
          boneIndex,
          targetIndex: i,
          // Prefer the cube whose center is closest to the pointer when multiple IK cubes overlap.
          distance: projectDistanceToPointer(mvp, center, event, rect),
          depth: getProjectedDepth(mvp, center),
          kindRank: 0,
        });
      }
    }
  }

  for (let i = 0; i < model.bones.length; i++) {
    if (i === ignoredBoneIndex) continue;
    if (boneDebugLists.hiddenBoneIndexSet.has(i)) continue;
    const distance = projectDistanceToPointer(mvp, scene.boneWorldPositions[i], event, rect);
    if (distance < pickDistancePx) {
      hits.push({
        boneIndex: i,
        targetIndex: -1,
        distance,
        depth: getProjectedDepth(mvp, scene.boneWorldPositions[i]),
        kindRank: 0,
      });
    }
  }

  for (let i = 0; i < model.bones.length; i++) {
    if (i === ignoredBoneIndex) continue;
    const bone = model.bones[i];
    if (boneDebugLists.hiddenBoneIndexSet.has(i)) continue;
    const startWorldPosition = scene.boneWorldPositions[i];
    const endWorldPosition = getBoneTailPosition(model, scene, i);
    const tailBoneIndex = resolveSegmentTailBoneIndex(model, scene, i);
    if (!startWorldPosition || !endWorldPosition) continue;
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
  const boneCount = scene?.boneCount ?? scene?.boneWorldPositions?.length ?? model.bones.length;
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
    const ikTargetHit = candidates.find((hit) => hit.targetIndex >= 0);
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
 * 深度順の比較関数です。
 * @param {{distance: number, depth: number, kindRank: number, boneIndex: number, targetIndex: number}} a - 候補 A。
 * @param {{distance: number, depth: number, kindRank: number, boneIndex: number, targetIndex: number}} b - 候補 B。
 * @returns {number} 比較結果。
 */
function compareBoneHitsByDepth(a, b) {
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
 * 投影後の AABB にポインターが含まれるか判定します。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {object} aabb - AABB。
 * @returns {boolean} ヒット有無。
 */
export function isPointInProjectedAABB(event, rect, mvp, aabb) {
  return sharedIsPointInProjectedAABB(event, rect, mvp, aabb);
}

/**
 * マウス座標からワールド空間レイを生成します。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {HTMLCanvasElement} canvas - キャンバス。
 * @param {object} camera - カメラ状態。
 * @returns {{start: Array<number>, end: Array<number>}} レイ始点終点。
 */
export function getRayFromMouse(event, canvas, camera) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height * 2 - 1);

  const mvp = createViewProjection(canvas, camera);
  const invMvp = mat4Invert(mvp);
  if (!invMvp) {
    return { start: [0, 0, 0], end: [0, 0, 0] };
  }

  const start = mat4Vec4Mul(invMvp, [x, y, 0, 1]);
  const end = mat4Vec4Mul(invMvp, [x, y, 1, 1]);
  vec4Scale(start, 1 / start[3], start);
  vec4Scale(end, 1 / end[3], end);
  return {
    start: [start[0], start[1], start[2]],
    end: [end[0], end[1], end[2]],
  };
}

/**
 * ボーン選択を切り替えます。
 * @param {number} index - 新しいアクティブインスタンス番号。
 * @param {object} selection - 現在の選択状態。
 * @param {function(number): void} activateInstance - インスタンス切り替え関数。
 */
function switchActiveInstance(index, selection, activateInstance) {
  if (selection.activeInstanceIndex !== index) {
    activateInstance(index);
  }
}

/**
 * AABB ヒット候補から、再クリック状態を考慮して 1 件を選びます。
 * @param {Array<{instanceIndex: number, instance: object}>} candidates - AABB ヒット候補。
 * @param {{clientX: number, clientY: number, instanceIndex: number}|null} repeatPickState - 直前の AABB ピック状態。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @returns {{instanceIndex: number, instance: object}|null} 選択された候補。
 */
function pickAabbInstanceHit(candidates, repeatPickState, event) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  if (!isRepeatPickPosition(repeatPickState, event)) {
    return candidates[0];
  }

  const previousHitIndex = candidates.findIndex((hit) => hit.instanceIndex === repeatPickState.instanceIndex);
  if (previousHitIndex === -1) {
    return candidates[0];
  }

  return candidates[(previousHitIndex + 1) % candidates.length];
}

/**
 * 画面上の点に重なる AABB ヒット候補を収集します。
 * @param {Array<object>} instances - モデルインスタンス一覧。
 * @param {PointerEvent|object} event - ポインターイベント相当。
 * @param {DOMRect|object} rect - キャンバス矩形。
 * @param {Array<number>} mvp - MVP 行列。
 * @returns {Array<{instanceIndex: number, instance: object}>} AABB ヒット候補。
 */
function collectAabbInstanceHits(instances, event, rect, mvp) {
  const hits = [];
  for (let instIdx = 0; instIdx < instances.length; instIdx++) {
    const inst = instances[instIdx];
    if (inst?.visible === false || !inst?.aabb) {
      continue;
    }
    if (isPointInProjectedAABB(event, rect, mvp, inst.aabb)) {
      hits.push({
        instanceIndex: instIdx,
        instance: inst,
      });
    }
  }
  return hits;
}

/**
 * ボーン選択をヒット結果に反映します。
 * @param {object} selection - 現在の選択状態。
 * @param {number} boneIndex - 選択対象ボーン。
 * @param {number} targetIndex - IK ターゲット index。
 * @param {boolean} additive - 追加選択かどうか。
 */
function applyBoneSelection(selection, boneIndex, targetIndex, additive) {
  applyBoneSelectionFromHit(selection, boneIndex, targetIndex, additive);
}

/**
 * custom rig の円形ヒット候補を収集します。
 * @param {object} instance - モデルインスタンス。
 * @param {object} ray - レイ。
 * @param {Array<number>} mvp - MVP 行列。
 * @returns {Array<object>} custom rig ヒット候補。
 */
function collectCustomRigBoneHits(instance, ray, mvp) {
  const hits = [];
  for (const [targetIndex, target] of getCustomRigCircleTargets(instance).entries()) {
    if (!target || !Number.isInteger(target.boneIndex) || target.boneIndex < 0) {
      continue;
    }
    const scale = getGizmoScale(ray.start, target.center);
    const hit = pickCircularHandleHit(
      ray,
      target.center,
      target.normal,
      'custom',
      target.radius,
      CUSTOM_RIG_PICK_THICKNESS * scale,
      'custom-select',
    );
    if (!hit) {
      continue;
    }
    hits.push({
      boneIndex: target.boneIndex,
      targetIndex,
      distance: hit.distance,
      depth: getProjectedDepthForPick(mvp, target.center),
      kind: 'custom-rig',
      kindRank: -1,
    });
  }
  return hits;
}

/**
 * 投影深度を計算します。
 * @param {Array<number>} mvp - MVP 行列。
 * @param {Array<number>} worldPosition - ワールド座標。
 * @returns {number} 正規化深度。
 */
function getProjectedDepthForPick(mvp, worldPosition) {
  const projected = mat4Vec4Mul(mvp, [worldPosition[0], worldPosition[1], worldPosition[2], 1]);
  if (!Number.isFinite(projected[3]) || projected[3] === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return projected[2] / projected[3];
}

/**
 * シーン要素を選択します。
 * @param {object} options - 選択処理オプション。
 */
function pickSceneElement(options) {
  const {
    event,
    canvas,
    camera,
    selection,
    modelManager,
    physicsEngine,
    activateInstance,
    lightObject,
  } = options;
  const previousBonePick = options.previousBonePick ?? null;
  const setPreviousBonePick = options.setPreviousBonePick ?? null;
  const previousAabbPick = options.previousAabbPick ?? null;
  const setPreviousAabbPick = options.setPreviousAabbPick ?? null;
  const ignoreBoneIndex = Number.isInteger(options.ignoreBoneIndex) ? options.ignoreBoneIndex : -1;
  const additiveSelection = Boolean(options.additiveSelection ?? event.shiftKey);
  const selectionSnapshotIndices = Array.isArray(options.selectionSnapshotIndices) ? options.selectionSnapshotIndices : [];
  const suppressSelection = Boolean(options.suppressSelection);
  const skipPhysicsPick = Boolean(options.skipPhysicsPick);
  const skipCustomRigHits = Boolean(options.skipCustomRigHits);
  const onBonePicked = typeof options.onBonePicked === 'function' ? options.onBonePicked : null;
  const additiveSelectedBoneIndices = additiveSelection
    ? (selectionSnapshotIndices.length > 0
      ? selectionSnapshotIndices.slice()
      : getSelectedBoneIndices(selection, null))
    : [];

  const rect = canvas.getBoundingClientRect();
  const mvp = createViewProjection(canvas, camera);
  const ray = getRayFromMouse(event, canvas, camera);

  if (!skipPhysicsPick && selection.showPhysics) {
    const hit = physicsEngine.rayTest(ray.start, ray.end);
    if (hit) {
      setPreviousBonePick?.(null);
      setPreviousAabbPick?.(null);
      const hitInstIdx = modelManager.instances.findIndex((inst) => inst.model === hit.entry.model);
      if (hitInstIdx !== -1 && modelManager.instances[hitInstIdx]?.visible !== false) {
        switchActiveInstance(hitInstIdx, selection, activateInstance);
        selection.selectedRigidbodyIndex = hit.bodyIndex;
        clearBoneSelection(selection);
        clearLightSelection(selection);
        selection.selectedTargetIndex = -1;
        return true;
      }
    }
  }

  const activeInst = modelManager.instances[selection.activeInstanceIndex];
  if (activeInst?.visible !== false) {
    const boneDebugLists = getBoneDebugLists(activeInst.model, activeInst.scene);
    const customRigHits = skipCustomRigHits ? [] : collectCustomRigBoneHits(activeInst, ray, mvp);

    const bestBoneHit = pickBoneHit(
      activeInst.model,
      activeInst.scene,
      boneDebugLists,
      event,
      rect,
      mvp,
      !selection.hideIkBones,
      PICK_DISTANCE_PX,
      previousBonePick,
      ignoreBoneIndex,
      additiveSelection,
      additiveSelectedBoneIndices,
      customRigHits,
      activeInst.visible !== false,
      selection,
    );
    if (bestBoneHit) {
      setPreviousBonePick?.({
        clientX: event.clientX,
        clientY: event.clientY,
        boneIndex: bestBoneHit.boneIndex,
        targetIndex: bestBoneHit.targetIndex,
      });
      setPreviousAabbPick?.(null);
      onBonePicked?.({
        instance: activeInst,
        boneIndex: bestBoneHit.boneIndex,
        targetIndex: bestBoneHit.targetIndex,
      });
      if (suppressSelection) {
        return true;
      }
      if (additiveSelection && selectionSnapshotIndices.length > 0 && (!Array.isArray(selection.selectedBoneIndices) || selection.selectedBoneIndices.length === 0)) {
        selection.selectedBoneIndices = selectionSnapshotIndices.slice();
      }
      applyBoneSelection(
        selection,
        bestBoneHit.boneIndex,
        bestBoneHit.kind === 'custom-rig' ? -1 : bestBoneHit.targetIndex,
        additiveSelection,
      );
      return true;
    }
  }

  let bestInstIdx = -1;
  let bestBoneIdx = -1;
  let bestTargetIdx = -1;
  let minDistanceOverall = PICK_DISTANCE_PX;
  for (let instIdx = 0; instIdx < modelManager.instances.length; instIdx++) {
    const inst = modelManager.instances[instIdx];
    if (inst?.visible === false) {
      continue;
    }
    const boneDebugLists = getBoneDebugLists(inst.model, inst.scene);
    const hit = pickBoneHit(
      inst.model,
      inst.scene,
      boneDebugLists,
      event,
      rect,
      mvp,
      !selection.hideIkBones,
      minDistanceOverall,
      previousBonePick,
      ignoreBoneIndex,
      additiveSelection,
      additiveSelectedBoneIndices,
      [],
      inst.visible !== false,
      selection,
    );
    if (!hit) {
      continue;
    }
    minDistanceOverall = hit.distance;
    bestInstIdx = instIdx;
    bestBoneIdx = hit.boneIndex;
    bestTargetIdx = hit.targetIndex;
  }

  if (bestInstIdx !== -1) {
    const bestInst = modelManager.instances[bestInstIdx];
    onBonePicked?.({
      instance: bestInst,
      boneIndex: bestBoneIdx,
      targetIndex: bestTargetIdx,
    });
    if (suppressSelection) {
      return true;
    }
    switchActiveInstance(bestInstIdx, selection, activateInstance);
    setPreviousBonePick?.({
      clientX: event.clientX,
      clientY: event.clientY,
      boneIndex: bestBoneIdx,
      targetIndex: bestTargetIdx,
    });
    setPreviousAabbPick?.(null);
    if (additiveSelection && selectionSnapshotIndices.length > 0 && (!Array.isArray(selection.selectedBoneIndices) || selection.selectedBoneIndices.length === 0)) {
      selection.selectedBoneIndices = selectionSnapshotIndices.slice();
    }
    applyBoneSelection(selection, bestBoneIdx, bestTargetIdx, additiveSelection);
    return true;
  }

  const lightHit = pickLightObject(ray, camera, lightObject);
  if (lightHit) {
    setPreviousBonePick?.(null);
    setPreviousAabbPick?.(null);
    setLightSelection(selection);
    selection.selectedTargetIndex = -1;
    selection.selectedRigidbodyIndex = -1;
    return true;
  }

  const aabbHits = collectAabbInstanceHits(modelManager.instances, event, rect, mvp);
  const bestAabbHit = pickAabbInstanceHit(aabbHits, previousAabbPick, event);
  if (bestAabbHit) {
    setPreviousBonePick?.(null);
    setPreviousAabbPick?.({
      clientX: event.clientX,
      clientY: event.clientY,
      instanceIndex: bestAabbHit.instanceIndex,
    });
    switchActiveInstance(bestAabbHit.instanceIndex, selection, activateInstance);
    clearBoneSelection(selection);
    clearLightSelection(selection);
    selection.selectedTargetIndex = -1;
    selection.selectedRigidbodyIndex = -1;
    return true;
  }

  setPreviousBonePick?.(null);
  setPreviousAabbPick?.(null);
  return false;
}

/**
 * IK ターゲット操作キー入力を処理します。
 * @param {KeyboardEvent} event - キーイベント。
 * @param {object} selection - 現在の選択状態。
 * @param {object} scene - シーン状態。
 * @param {object} model - モデルデータ。
 * @returns {boolean} 適用有無。
 */
function handleTargetKeydown(event, selection, scene, model, modelManager, instance) {
  if (selection.selectedTargetIndex === -1) {
    return false;
  }

  const target = scene.ikTargets[selection.selectedTargetIndex];
  const step = 0.1;
  const deltaWorld = [0, 0, 0];
  const local = scene.boneLocalTransforms[target.boneIndex];
  switch (event.key) {
    case 'w':
      deltaWorld[1] += step;
      break;
    case 's':
      deltaWorld[1] -= step;
      break;
    case 'a':
      deltaWorld[0] -= step;
      break;
    case 'd':
      deltaWorld[0] += step;
      break;
    case 'z':
      deltaWorld[2] -= step;
      break;
    case 'c':
      deltaWorld[2] += step;
      break;
    case 'r':
      modelManager.resetManualTransform(instance, target.boneIndex);
      vec3.set(local.translation, 0, 0, 0);
      quat.identity(local.rotation);
      vec3.set(local.scale, 1, 1, 1);
      break;
    default:
      return false;
  }

  const localDelta = worldDeltaToLocalDelta(scene, model, target.boneIndex, deltaWorld);
  const position = getBoneInfoDisplayLocalPosition(instance, target.boneIndex);
  position[0] += localDelta[0];
  position[1] += localDelta[1];
  position[2] += localDelta[2];
  modelManager.setManualLocalPosition(
    instance,
    target.boneIndex,
    getLocalPositionFromBoneInfoDisplayPosition(instance, target.boneIndex, position),
  );
  return true;
}

/**
 * モーフ操作キー入力を処理します。
 * @param {KeyboardEvent} event - キーイベント。
 * @param {object} model - モデルデータ。
 * @param {object} morphController - モーフコントローラー。
 * @returns {boolean} 適用有無。
 */
function handleMorphKeydown(event, model, morphController) {
  if (event.key !== 'm') {
    return false;
  }

  const morphIndex = model.morphs.findIndex((morph) => morph.name === 'まばたき');
  if (morphIndex === -1) {
    return false;
  }

  const current = morphController.getWeight(morphIndex);
  morphController.setWeight(morphIndex, current > 0.5 ? 0 : 1);
  return true;
}
