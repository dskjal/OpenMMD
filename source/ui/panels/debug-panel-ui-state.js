/**
 * Resolves DOM references used by the debug panel.
 * @param {Document} documentRef - Target document.
 * @returns {{cameraDebugUiState: object, boneDebugUiState: object, animationDebugUiState: object, clickedMousePositionUiState: object}} Debug UI state bundle.
 */
export function bindDebugPanelUiState(documentRef) {
  return {
    cameraDebugUiState: {
      output: documentRef.getElementById('camera-debug-output'),
    },
    boneDebugUiState: {
      output: documentRef.getElementById('bone-debug-output'),
    },
    animationDebugUiState: {
      checkbox: documentRef.getElementById('show-animation-debug'),
      output: documentRef.getElementById('animation-debug-output'),
    },
    clickedMousePositionUiState: {
      output: documentRef.getElementById('clicked-mouse-position-output'),
      clientX: null,
      clientY: null,
      canvasX: null,
      canvasY: null,
    },
  };
}
