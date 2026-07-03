import { quaternionToEulerForBone } from '../../shared/math/math-utils.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';

const WORLD_ROTATION_DEFAULTS_SECTION = 'worldRotationUi';

/**
 * ワールド回転 UI の表示状態を作成します。
 * @returns {{boneIndex: number, euler: number[]|null}} 表示状態。
 */
export function createWorldRotationUiState() {
  const defaults = getDefaultsSnapshot(WORLD_ROTATION_DEFAULTS_SECTION);
  return {
    boneIndex: Number.isInteger(defaults.boneIndex) ? defaults.boneIndex : -1,
    euler: Array.isArray(defaults.euler) ? [defaults.euler[0], defaults.euler[1], defaults.euler[2]] : null,
  };
}

/**
 * ワールド回転 UI の表示値を更新します。
 * 編集中は直前の入力値を維持し、それ以外はワールド回転から再計算します。
 * @param {{boneIndex: number, euler: number[]|null}} state - 表示状態。
 * @param {number} boneIndex - ボーン番号。
 * @param {ArrayLike<number>} worldRotation - ワールド回転クォータニオン。
 * @param {boolean} isEditing - 編集中かどうか。
 * @param {ArrayLike<number>|null} [prevEuler=null] - 前回の Euler。
 * @param {string|null|undefined} [boneName=null] - ボーン名。
 * @returns {number[]} 表示する Euler。
 */
export function syncWorldRotationDisplay(state, boneIndex, worldRotation, isEditing, prevEuler = null, boneName = null) {
  if (isEditing && state.boneIndex === boneIndex && state.euler) {
    return state.euler;
  }

  const euler = quaternionToEulerForBone(
    worldRotation,
    boneName,
    prevEuler ? [prevEuler[0], prevEuler[1], prevEuler[2]] : null
  );
  state.boneIndex = boneIndex;
  state.euler = [euler[0], euler[1], euler[2]];
  return state.euler;
}

/**
 * ワールド回転 UI の表示値を明示的に更新します。
 * @param {{boneIndex: number, euler: number[]|null}} state - 表示状態。
 * @param {number} boneIndex - ボーン番号。
 * @param {ArrayLike<number>} euler - 表示する Euler。
 * @returns {number[]} 更新後の Euler。
 */
export function setWorldRotationDisplay(state, boneIndex, euler) {
  state.boneIndex = boneIndex;
  state.euler = [euler[0], euler[1], euler[2]];
  return state.euler;
}

/**
 * ワールド回転 UI の表示値をクリアします。
 * @param {{boneIndex: number, euler: number[]|null}} state - 表示状態。
 */
export function clearWorldRotationDisplay(state) {
  state.boneIndex = -1;
  state.euler = null;
}
