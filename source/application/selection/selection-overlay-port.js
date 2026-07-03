import { resolveSelectedBoneIndex } from '../../core/selection/renderer-selection.js';
import { getBone } from '../../core/model/model-scene.js';

/**
 * Creates a selection overlay port that owns overlay DOM state separately from
 * the core selection model.
 * @param {object} options - Port options.
 * @returns {object} Selection overlay port.
 */
export function createSelectionOverlayPort(options = {}) {
  const selection = options.selection ?? {};
  const uiState = options.uiState ?? {};
  const rendererState = options.rendererState ?? {};
  const physicsEngine = options.physicsEngine ?? null;
  const globalResources = options.globalResources ?? null;
  const globalUniformOffsets = options.globalUniformOffsets ?? null;
  const device = options.device ?? null;
  const onRefreshRequested = options.onRefreshRequested ?? (() => {});
  const onVisibilityChanged = options.onVisibilityChanged ?? (() => {});

  /**
   * Copies checkbox state from the DOM into the selection model.
   */
  function syncFlagsFromUi() {
    selection.showBones = uiState.showBonesElement?.checked !== false;
    selection.showBoneAxes = Boolean(uiState.showBoneAxesElement?.checked);
    selection.showPhysics = Boolean(uiState.showPhysicsElement?.checked);
    selection.disablePhysics = Boolean(uiState.disablePhysicsElement?.checked);
    selection.hideIkBones = Boolean(uiState.hideIkBonesElement?.checked);
    selection.hideSpringBones = Boolean(uiState.hideSpringBonesElement?.checked);
    selection.showGridXZ = uiState.showGridXZElement?.checked !== false;
    selection.showGridXY = Boolean(uiState.showGridXYElement?.checked);
    selection.showGridYZ = Boolean(uiState.showGridYZElement?.checked);
  }

  /**
   * Writes the current selection flags back to the DOM.
   */
  function syncUiFromFlags() {
    if (uiState.showBonesElement) {
      uiState.showBonesElement.checked = selection.showBones !== false;
    }
    if (uiState.showBoneAxesElement) {
      uiState.showBoneAxesElement.checked = Boolean(selection.showBoneAxes);
    }
    if (uiState.showPhysicsElement) {
      uiState.showPhysicsElement.checked = Boolean(selection.showPhysics);
    }
    if (uiState.disablePhysicsElement) {
      uiState.disablePhysicsElement.checked = Boolean(selection.disablePhysics);
    }
    if (uiState.hideIkBonesElement) {
      uiState.hideIkBonesElement.checked = Boolean(selection.hideIkBones);
    }
    if (uiState.hideSpringBonesElement) {
      uiState.hideSpringBonesElement.checked = Boolean(selection.hideSpringBones);
    }
    if (uiState.showGridXZElement) {
      uiState.showGridXZElement.checked = selection.showGridXZ !== false;
    }
    if (uiState.showGridXYElement) {
      uiState.showGridXYElement.checked = Boolean(selection.showGridXY);
    }
    if (uiState.showGridYZElement) {
      uiState.showGridYZElement.checked = Boolean(selection.showGridYZ);
    }
  }

  /**
   * Applies overlay flags and synchronizes UI and physics state.
   * @param {object} nextState - Partial overlay state.
   */
  function applyState(nextState = {}) {
    if (nextState.showBones !== undefined) {
      selection.showBones = Boolean(nextState.showBones);
    }
    if (nextState.showBoneAxes !== undefined) {
      selection.showBoneAxes = Boolean(nextState.showBoneAxes);
    }
    if (nextState.showPhysics !== undefined) {
      selection.showPhysics = Boolean(nextState.showPhysics);
    }
    if (nextState.disablePhysics !== undefined) {
      selection.disablePhysics = Boolean(nextState.disablePhysics);
    }
    if (nextState.hideIkBones !== undefined) {
      selection.hideIkBones = Boolean(nextState.hideIkBones);
    }
    if (nextState.hideSpringBones !== undefined) {
      selection.hideSpringBones = Boolean(nextState.hideSpringBones);
    }
    if (nextState.showGridXZ !== undefined) {
      selection.showGridXZ = Boolean(nextState.showGridXZ);
    }
    if (nextState.showGridXY !== undefined) {
      selection.showGridXY = Boolean(nextState.showGridXY);
    }
    if (nextState.showGridYZ !== undefined) {
      selection.showGridYZ = Boolean(nextState.showGridYZ);
    }
    syncUiFromFlags();
    physicsEngine?.setEnabled?.(!selection.disablePhysics);
    onVisibilityChanged();
  }

  /**
   * Returns a plain snapshot of the overlay state.
   * @returns {object} Overlay state.
   */
  function getState() {
    return {
      showBones: selection.showBones !== false,
      showBoneAxes: Boolean(selection.showBoneAxes),
      showPhysics: Boolean(selection.showPhysics),
      disablePhysics: Boolean(selection.disablePhysics),
      hideIkBones: Boolean(selection.hideIkBones),
      hideSpringBones: Boolean(selection.hideSpringBones),
      showGridXZ: selection.showGridXZ !== false,
      showGridXY: Boolean(selection.showGridXY),
      showGridYZ: Boolean(selection.showGridYZ),
    };
  }

  /**
   * Synchronizes the selected bone label.
   * @param {object} model - Model data.
   * @param {object} scene - Scene state.
   * @param {object} targetSelection - Current selection state.
   * @param {object} langData - Localization dictionary.
   */
  function syncSelectedBoneLabel(model, scene, targetSelection, langData) {
    if (!uiState.selectedBoneNameElement) {
      return;
    }

    let label = langData.None || 'None';
    if (targetSelection.selectedLight) {
      label = langData.Light || 'Light';
    }
    const selectedBoneIndex = resolveSelectedBoneIndex({ scene }, targetSelection);
    if (selectedBoneIndex !== -1) {
      label = getBone(model, selectedBoneIndex)?.name || 'Unknown';
    }
    uiState.selectedBoneNameElement.textContent = label;
  }

  /**
   * Synchronizes the selected rigid body label.
   * @param {object} model - Model data.
   * @param {object} targetSelection - Current selection state.
   * @param {object} langData - Localization dictionary.
   */
  function syncSelectedRigidbodyLabel(model, targetSelection, langData) {
    if (!uiState.selectedRigidbodyElement) {
      return;
    }

    let label = langData.None || 'None';
    if (targetSelection.selectedRigidbodyIndex !== -1) {
      label = model.rigidBodies[targetSelection.selectedRigidbodyIndex]?.name || 'Unknown';
    }
    uiState.selectedRigidbodyElement.textContent = label;
  }

  /**
   * Initializes overlay bindings owned by this port.
   */
  function bind() {
    syncFlagsFromUi();
    syncUiFromFlags();
    if (uiState.boneThicknessInput) {
      rendererState.boneThickness = parseFloat(uiState.boneThicknessInput.value);
      uiState.boneThicknessInput.addEventListener('input', () => {
        rendererState.boneThickness = parseFloat(uiState.boneThicknessInput.value);
        if (globalResources && device) {
          const offset = Number.isFinite(globalUniformOffsets?.shadowInfo)
            ? globalUniformOffsets.shadowInfo + 2
            : 2;
          globalResources.uniformData[offset] = rendererState.boneThickness;
          globalResources.edgeUniformData[offset] = rendererState.boneThickness;
          device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);
          device.queue.writeBuffer(globalResources.edgeUniformBuffer, 0, globalResources.edgeUniformData);
        }
        onRefreshRequested();
      });
    }

    [
      uiState.showBoneAxesElement,
      uiState.showBonesElement,
      uiState.showPhysicsElement,
      uiState.hideIkBonesElement,
      uiState.hideSpringBonesElement,
      uiState.showGridXZElement,
      uiState.showGridXYElement,
      uiState.showGridYZElement,
    ].forEach((input) => {
      input?.addEventListener('change', () => {
        syncFlagsFromUi();
        onVisibilityChanged();
        onRefreshRequested();
      });
    });

    if (uiState.disablePhysicsElement) {
      uiState.disablePhysicsElement.checked = Boolean(selection.disablePhysics);
      uiState.disablePhysicsElement.addEventListener('change', () => {
        syncFlagsFromUi();
        physicsEngine?.setEnabled?.(!selection.disablePhysics);
      });
      physicsEngine?.setEnabled?.(!selection.disablePhysics);
    }
  }

  return {
    uiState,
    bind,
    getState,
    applyState,
    syncFlagsFromUi,
    syncUiFromFlags,
    syncSelectedBoneLabel,
    syncSelectedRigidbodyLabel,
  };
}
