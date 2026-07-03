/**
 * Resolves DOM references used by selection overlays and shared inspector labels.
 * @param {Document} documentRef - Target document.
 * @returns {{selectionUiState: object, boneThicknessInput: HTMLInputElement|null}} Selection UI state bundle.
 */
export function bindSelectionOverlayUiState(documentRef) {
  return {
    selectionUiState: {
      selectedBoneNameElement: documentRef.getElementById('selectedBoneName'),
      selectedRigidbodyElement: documentRef.getElementById('selected-rigidbody'),
      showBonesElement: documentRef.getElementById('showBones'),
      showBoneAxesElement: documentRef.getElementById('showBoneAxes'),
      showPhysicsElement: documentRef.getElementById('showPhysics'),
      disablePhysicsElement: documentRef.getElementById('disablePhysics'),
      hideIkBonesElement: documentRef.getElementById('hideIkBones'),
      hideSpringBonesElement: documentRef.getElementById('hideSpringBones'),
      showGridXZElement: documentRef.getElementById('showGridXZ'),
      showGridXYElement: documentRef.getElementById('showGridXY'),
      showGridYZElement: documentRef.getElementById('showGridYZ'),
      gridSizeRangeElement: documentRef.getElementById('gridSizeRange'),
      gridSizeValueElement: documentRef.getElementById('gridSizeValue'),
      gridCountRangeElement: documentRef.getElementById('gridCountRange'),
      gridCountValueElement: documentRef.getElementById('gridCountValue'),
      gridThicknessRangeElement: documentRef.getElementById('gridThicknessRange'),
      gridThicknessValueElement: documentRef.getElementById('gridThicknessValue'),
    },
    boneThicknessInput: documentRef.getElementById('boneThickness'),
  };
}
