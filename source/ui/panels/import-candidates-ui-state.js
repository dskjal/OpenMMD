/**
 * Resolves DOM references used by import candidate panels.
 * @param {Document} documentRef - Target document.
 * @returns {{environmentHdrUiState: object, modelCandidateUiState: object}} UI state bundle.
 */
export function bindImportCandidatesUiState(documentRef) {
  return {
    environmentHdrUiState: {
      fileInput: documentRef.getElementById('environment-hdr-file'),
      nameLabel: documentRef.getElementById('environment-hdr-name'),
      candidateArea: documentRef.getElementById('environment-hdr-candidate-area'),
      candidateHeader: documentRef.getElementById('environment-hdr-candidate-header'),
      candidateCount: documentRef.getElementById('environment-hdr-candidate-count'),
      candidateList: documentRef.getElementById('environment-hdr-candidate-list'),
      intensityRange: documentRef.getElementById('environment-hdr-intensity'),
      intensityValue: null,
    },
    modelCandidateUiState: {
      area: documentRef.getElementById('model-candidate-area'),
      header: documentRef.getElementById('model-candidate-header'),
      count: documentRef.getElementById('model-candidate-count'),
      list: documentRef.getElementById('model-candidate-list'),
      loadButton: documentRef.getElementById('model-candidate-load'),
    },
  };
}
