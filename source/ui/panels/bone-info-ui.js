/**
 * ボーン情報タブの表示用 state を作成します。
 * @returns {{boneIndex: number, mode: 'local'|'world', position: number[]|null, rotation: number[]|null}} 表示 state。
 */
export function createBoneInfoUiState() {
  return {
    boneIndex: -1,
    mode: 'local',
    position: null,
    rotation: null,
  };
}

/**
 * ボーン情報タブの編集中表示を更新します。
 * 編集中で同じ bone/mode の場合は、直前の表示値を維持します。
 * @param {{boneIndex: number, mode: 'local'|'world', position: number[]|null, rotation: number[]|null}} state - 表示 state。
 * @param {object} options - 同期オプション。
 * @param {number} options.boneIndex - 対象 bone index。
 * @param {'local'|'world'} options.mode - 表示モード。
 * @param {boolean} options.editing - 編集中かどうか。
 * @param {ArrayLike<number>} options.position - 最新の position 表示値。
 * @param {ArrayLike<number>} options.rotation - 最新の rotation 表示値。
 * @returns {{position: number[], rotation: number[]}} 現在の表示値。
 */
export function syncBoneInfoUiState(state, options) {
  const {
    boneIndex,
    mode,
    editing,
    position,
    rotation,
  } = options;

  const hasCache = state.boneIndex === boneIndex
    && state.mode === mode
    && Array.isArray(state.position)
    && Array.isArray(state.rotation);
  if (editing && hasCache) {
    return {
      position: state.position,
      rotation: state.rotation,
    };
  }

  state.boneIndex = boneIndex;
  state.mode = mode;
  state.position = [position[0], position[1], position[2]];
  state.rotation = [rotation[0], rotation[1], rotation[2]];
  return {
    position: state.position,
    rotation: state.rotation,
  };
}

/**
 * ボーン情報タブの表示 state を明示的に更新します。
 * @param {{boneIndex: number, mode: 'local'|'world', position: number[]|null, rotation: number[]|null}} state - 表示 state。
 * @param {number} boneIndex - 対象 bone index。
 * @param {'local'|'world'} mode - 表示モード。
 * @param {ArrayLike<number>} position - 表示する position。
 * @param {ArrayLike<number>} rotation - 表示する rotation。
 * @returns {{position: number[], rotation: number[]}} 更新後の表示値。
 */
export function setBoneInfoUiState(state, boneIndex, mode, position, rotation) {
  state.boneIndex = boneIndex;
  state.mode = mode;
  state.position = [position[0], position[1], position[2]];
  state.rotation = [rotation[0], rotation[1], rotation[2]];
  return {
    position: state.position,
    rotation: state.rotation,
  };
}

/**
 * ボーン情報タブの表示 state をクリアします。
 * @param {{boneIndex: number, mode: 'local'|'world', position: number[]|null, rotation: number[]|null}} state - 表示 state。
 */
export function clearBoneInfoUiState(state) {
  state.boneIndex = -1;
  state.mode = 'local';
  state.position = null;
  state.rotation = null;
}
