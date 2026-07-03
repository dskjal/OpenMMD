const BONE_POSITION_INPUT_IDS = ['bone-pos-x', 'bone-pos-y', 'bone-pos-z'];
const BONE_ROTATION_INPUT_IDS = ['bone-rot-x', 'bone-rot-y', 'bone-rot-z'];
const BONE_POSITION_HEADER_ID = 'bone-pos-header';
const BONE_ROTATION_HEADER_ID = 'bone-rot-header';
const BONE_PARENT_NAME_ID = 'bone-parent-bone-name';
const BONE_POSITION_KEY_BUTTON_ID = 'bone-pos-key';
const BONE_ROTATION_KEY_BUTTON_ID = 'bone-rot-key';
const CHILD_BONE_PICK_BUTTON_ID = 'bone-child-pick';
const IK_TARGET_BONE_SELECT_ID = 'bone-ik-target-bone-list';
const IK_ENABLED_CHECKBOX_ID = 'bone-ik-enable';
const IK_CHAIN_COUNT_RANGE_ID = 'bone-ik-chain-count-range';
const IK_CHAIN_COUNT_VALUE_ID = 'bone-ik-chain-count-value';
const IK_ITERATION_COUNT_RANGE_ID = 'bone-ik-iteration-count-range';
const IK_ITERATION_COUNT_VALUE_ID = 'bone-ik-iteration-count-value';
const IK_ROTATION_LOCK_BUTTON_IDS = ['bone-ik-rot-lock-x', 'bone-ik-rot-lock-y', 'bone-ik-rot-lock-z'];
const IK_CREATE_BUTTON_ID = 'bone-ik-create';
const IK_DELETE_BUTTON_ID = 'bone-ik-delete';

/**
 * Resolves DOM references used by the bone inspector.
 * @param {Document} documentRef - Target document.
 * @returns {object} Bone inspector UI state.
 */
export function bindBoneInspectorUiState(documentRef) {
  return {
    positionHeader: documentRef.getElementById(BONE_POSITION_HEADER_ID),
    rotationHeader: documentRef.getElementById(BONE_ROTATION_HEADER_ID),
    parentNameElement: documentRef.getElementById(BONE_PARENT_NAME_ID),
    saveVpdButton: documentRef.getElementById('save-vpd'),
    useWorldCoordinateElement: documentRef.getElementById('useWorldCoordinate'),
    positionInputs: BONE_POSITION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
    rotationInputs: BONE_ROTATION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
    rotationLockButtons: Array.from(documentRef.querySelectorAll('.bone-rotation-lock-button'))
      .filter((button) => !button.hasAttribute('data-bone-ik-rotation-axis')),
    rowKeyIcons: Array.from(documentRef.querySelectorAll('.bone-row-key-icon')),
    keyButtons: {
      all: Array.from(documentRef.querySelectorAll('.bone-row-key-icon')),
      position: documentRef.getElementById(BONE_POSITION_KEY_BUTTON_ID),
      rotation: documentRef.getElementById(BONE_ROTATION_KEY_BUTTON_ID),
    },
    resetButtons: {
      position: documentRef.getElementById('reset-bone-pos'),
      rotation: documentRef.getElementById('reset-bone-rot'),
      shortcutPosition: documentRef.getElementById('shortcut-reset-bone-pos'),
      shortcutRotation: documentRef.getElementById('shortcut-reset-bone-rot'),
    },
    clipboardButtons: {
      copyPosition: documentRef.getElementById('copy-bone-pos'),
      pastePosition: documentRef.getElementById('paste-bone-pos'),
      flipPastePosition: documentRef.getElementById('flip-paste-bone-pos'),
      copyRotation: documentRef.getElementById('copy-bone-rot'),
      pasteRotation: documentRef.getElementById('paste-bone-rot'),
      flipPasteRotation: documentRef.getElementById('flip-paste-bone-rot'),
    },
    child: {
      enabledCheckbox: documentRef.getElementById('bone-child-enable'),
      modelSelect: documentRef.getElementById('bone-child-model-list'),
      boneSelect: documentRef.getElementById('bone-child-bone-list'),
      pickButton: documentRef.getElementById(CHILD_BONE_PICK_BUTTON_ID),
      influenceRange: documentRef.getElementById('bone-child-influence-range'),
      influenceValue: null,
      setInverseButton: documentRef.getElementById('bone-child-set-inverse'),
      clearInverseButton: documentRef.getElementById('bone-child-clear-inverse'),
    },
    ik: {
      targetBoneSelect: documentRef.getElementById(IK_TARGET_BONE_SELECT_ID),
      enabledCheckbox: documentRef.getElementById(IK_ENABLED_CHECKBOX_ID),
      chainCountRange: documentRef.getElementById(IK_CHAIN_COUNT_RANGE_ID),
      chainCountValue: documentRef.getElementById(IK_CHAIN_COUNT_VALUE_ID),
      iterationCountRange: documentRef.getElementById(IK_ITERATION_COUNT_RANGE_ID),
      iterationCountValue: documentRef.getElementById(IK_ITERATION_COUNT_VALUE_ID),
      rotationLockButtons: IK_ROTATION_LOCK_BUTTON_IDS.map((id) => documentRef.getElementById(id)),
      createButton: documentRef.getElementById(IK_CREATE_BUTTON_ID),
      deleteButton: documentRef.getElementById(IK_DELETE_BUTTON_ID),
      chainCountBinding: null,
      iterationCountBinding: null,
    },
  };
}
