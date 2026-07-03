/**
 * Installs debug panel UI synchronization.
 * @param {object} options - Controller options.
 * @returns {{syncCameraDebugUi: function, syncBoneDebugUi: function, syncAnimationDebugUi: function, onClickPositionChanged: function}} Debug controller.
 */
export function installDebugPanelController(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const readModelService = options.readModelService;
  const clickedMousePositionUiState = options.clickedMousePositionUiState ?? {};
  const cameraDebugUiState = options.cameraDebugUiState ?? {};
  const boneDebugUiState = options.boneDebugUiState ?? {};
  const animationDebugUiState = options.animationDebugUiState ?? {};

  /**
   * Returns the camera debug output element.
   * @returns {HTMLElement|null} Output element.
   */
  function getCameraDebugOutput() {
    if (!cameraDebugUiState.output) {
      cameraDebugUiState.output = documentRef?.getElementById?.('camera-debug-output') ?? null;
    }
    return cameraDebugUiState.output;
  }

  /**
   * Returns the clicked mouse output element.
   * @returns {HTMLElement|null} Output element.
   */
  function getClickedMouseOutput() {
    if (!clickedMousePositionUiState.output) {
      clickedMousePositionUiState.output = documentRef?.getElementById?.('clicked-mouse-position-output') ?? null;
    }
    return clickedMousePositionUiState.output;
  }

  /**
   * Returns the bone debug output element.
   * @returns {HTMLElement|null} Output element.
   */
  function getBoneDebugOutput() {
    if (!boneDebugUiState.output) {
      boneDebugUiState.output = documentRef?.getElementById?.('bone-debug-output') ?? null;
    }
    return boneDebugUiState.output;
  }

  /**
   * Returns the animation debug output element.
   * @returns {HTMLElement|null} Output element.
   */
  function getAnimationDebugOutput() {
    if (!animationDebugUiState.output) {
      animationDebugUiState.output = documentRef?.getElementById?.('animation-debug-output') ?? null;
    }
    return animationDebugUiState.output;
  }

  /**
   * Returns the animation debug checkbox element.
   * @returns {HTMLInputElement|null} Checkbox element.
   */
  function getAnimationDebugCheckbox() {
    if (!animationDebugUiState.checkbox) {
      animationDebugUiState.checkbox = documentRef?.getElementById?.('show-animation-debug') ?? null;
    }
    return animationDebugUiState.checkbox;
  }

  /**
   * Returns whether animation debug data should be refreshed.
   * @returns {boolean} True when animation debug data should be updated.
   */
  function isAnimationDebugEnabled() {
    const checkbox = getAnimationDebugCheckbox();
    return checkbox ? Boolean(checkbox.checked) : true;
  }

  /**
   * Renders a single empty row.
   * @param {HTMLElement|null} output - Target output.
   * @param {number} columnCount - Number of columns.
   * @param {string} message - Empty message.
   */
  function renderEmptyTableRow(output, columnCount, message) {
    if (!output || !documentRef) {
      return;
    }
    output.innerHTML = '';
    const row = documentRef.createElement('tr');
    const cell = documentRef.createElement('td');
    cell.colSpan = columnCount;
    cell.style.padding = '8px';
    cell.textContent = message;
    row.appendChild(cell);
    output.appendChild(row);
  }

  /**
   * Syncs the camera debug output.
   */
  function syncCameraDebugUi() {
    const state = readModelService?.getCameraDebugState?.() ?? {
      clickedMouseText: 'No click recorded.',
      cameraText: 'Camera debug data is not available.',
    };
    const clickedMouseOutput = getClickedMouseOutput();
    if (clickedMouseOutput) {
      clickedMouseOutput.textContent = state.clickedMouseText;
    }
    const output = getCameraDebugOutput();
    if (output) {
      output.textContent = state.cameraText;
    }
  }

  /**
   * Syncs the bone debug output.
   */
  function syncBoneDebugUi() {
    const output = getBoneDebugOutput();
    if (!output || !documentRef) {
      return;
    }
    const state = readModelService?.getBoneDebugState?.() ?? { message: 'Bone debug data is not available.', rows: [] };
    if (state.message) {
      renderEmptyTableRow(output, 5, state.message);
      return;
    }

    output.innerHTML = '';
    for (const rowData of state.rows) {
      const row = documentRef.createElement('tr');
      const nameCell = documentRef.createElement('td');
      nameCell.style.padding = '8px';
      nameCell.style.borderBottom = '1px solid #ddd';
      nameCell.textContent = rowData.name;
      row.appendChild(nameCell);

      for (const value of rowData.components) {
        const cell = documentRef.createElement('td');
        cell.style.padding = '8px';
        cell.style.borderBottom = '1px solid #ddd';
        cell.style.textAlign = 'right';
        cell.textContent = value;
        row.appendChild(cell);
      }
      output.appendChild(row);
    }
  }

  /**
   * Syncs the animation debug output.
   */
  function syncAnimationDebugUi() {
    if (!isAnimationDebugEnabled()) {
      return;
    }
    const output = getAnimationDebugOutput();
    if (!output || !documentRef) {
      return;
    }
    const state = readModelService?.getAnimationDebugState?.() ?? { message: 'Animation debug data is not available.', rows: [] };
    if (state.message) {
      renderEmptyTableRow(output, 4, state.message);
      return;
    }

    output.innerHTML = '';
    for (const rowData of state.rows) {
      const row = documentRef.createElement('tr');
      const boneCell = documentRef.createElement('td');
      boneCell.style.padding = '8px';
      boneCell.style.borderBottom = '1px solid #ddd';
      boneCell.style.whiteSpace = 'pre-line';

      const sourceLine = documentRef.createElement('div');
      sourceLine.textContent = `${rowData.sourceName} ->`;
      boneCell.appendChild(sourceLine);

      const targetLine = documentRef.createElement('div');
      targetLine.textContent = rowData.targetName || rowData.sourceName;
      boneCell.appendChild(targetLine);
      row.appendChild(boneCell);

      for (const value of rowData.eulerDegrees) {
        const cell = documentRef.createElement('td');
        cell.style.padding = '8px';
        cell.style.borderBottom = '1px solid #ddd';
        cell.style.textAlign = 'right';
        cell.textContent = value;
        row.appendChild(cell);
      }
      output.appendChild(row);
    }
  }

  const animationDebugCheckbox = getAnimationDebugCheckbox();
  if (animationDebugCheckbox?.addEventListener) {
    animationDebugCheckbox.addEventListener('change', syncAnimationDebugUi);
  }

  return {
    syncCameraDebugUi,
    syncBoneDebugUi,
    syncAnimationDebugUi,
    onClickPositionChanged(clientX, clientY, canvasX, canvasY) {
      clickedMousePositionUiState.clientX = clientX;
      clickedMousePositionUiState.clientY = clientY;
      clickedMousePositionUiState.canvasX = canvasX;
      clickedMousePositionUiState.canvasY = canvasY;
      syncCameraDebugUi();
    },
  };
}
