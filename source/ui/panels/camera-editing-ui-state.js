const CAMERA_FOV_INPUT_IDS = ['camera-fov-range', 'camera-fov-value'];
const CAMERA_POSITION_INPUT_IDS = ['camera-pos-x', 'camera-pos-y', 'camera-pos-z'];
const CAMERA_ROTATION_INPUT_IDS = ['camera-rot-x', 'camera-rot-y', 'camera-rot-z'];
const CAMERA_TARGET_INPUT_IDS = ['camera-target-x', 'camera-target-y', 'camera-target-z'];
const DEPTH_FOCUS_INPUT_IDS = ['depth-focus-x', 'depth-focus-y', 'depth-focus-z'];
const CAMERA_VIEW_SHORTCUT_IDS = {
  front: 'camera-view-front',
  back: 'camera-view-back',
  left: 'camera-view-left',
  right: 'camera-view-right',
  top: 'camera-view-top',
  reset: 'camera-view-reset',
};

/**
 * Resolves DOM references used by the camera editing panel.
 * @param {Document} documentRef - Target document.
 * @returns {{cameraUiState: object, depthFocusUiState: object}} Camera UI state bundle.
 */
export function bindCameraEditingUiState(documentRef) {
  return {
    cameraUiState: {
      selectedModelIndex: -1,
      selectedBoneName: '',
      modelSelect: documentRef.getElementById('camera-model-list'),
      boneSelect: documentRef.getElementById('camera-bone-list'),
      boneFollowLabel: documentRef.getElementById('bone-follow'),
      fovRange: documentRef.getElementById(CAMERA_FOV_INPUT_IDS[0]),
      fovValue: documentRef.getElementById(CAMERA_FOV_INPUT_IDS[1]),
      fovKeyIcon: documentRef.getElementById('camera-fov-key'),
      boneKeyIcon: documentRef.getElementById('camera-bone-key'),
      positionInputs: CAMERA_POSITION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
      rotationInputs: CAMERA_ROTATION_INPUT_IDS.map((id) => documentRef.getElementById(id)),
      targetInputs: CAMERA_TARGET_INPUT_IDS.map((id) => documentRef.getElementById(id)),
      positionKeyIcon: documentRef.getElementById('camera-position-key'),
      rotationKeyIcon: documentRef.getElementById('camera-rotation-key'),
      targetKeyIcon: documentRef.getElementById('camera-target-key'),
      viewShortcutButtons: {
        front: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.front),
        back: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.back),
        left: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.left),
        right: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.right),
        top: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.top),
        reset: documentRef.getElementById(CAMERA_VIEW_SHORTCUT_IDS.reset),
      },
      lastModelSignature: '',
      lastBoneSignature: '',
    },
    depthFocusUiState: {
      inputElements: DEPTH_FOCUS_INPUT_IDS.map((id) => documentRef.getElementById(id)),
      pickIcon: documentRef.getElementById('depth-focus-pick'),
    },
  };
}
