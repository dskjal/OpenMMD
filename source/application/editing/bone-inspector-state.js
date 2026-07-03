import { createBoneInfoUiState } from '../../ui/panels/bone-info-ui.js';
import { createWorldRotationUiState } from '../../ui/panels/world-rotation-ui.js';

/**
 * Creates state owned by the bone inspector instead of the shared selection object.
 * @returns {object} Bone inspector state.
 */
export function createBoneInspectorState() {
  return {
    useWorldCoordinate: false,
    lastSelectedBoneIndex: -1,
    prevEuler: [0, 0, 0],
    worldRotationUiState: createWorldRotationUiState(),
    boneInfoUiState: createBoneInfoUiState(),
  };
}

/**
 * Resets cached bone inspector selection-dependent state.
 * @param {object|null|undefined} state - Bone inspector state.
 */
export function resetBoneInspectorSelectionState(state) {
  if (!state) {
    return;
  }
  state.lastSelectedBoneIndex = -1;
  state.prevEuler[0] = 0;
  state.prevEuler[1] = 0;
  state.prevEuler[2] = 0;
}
