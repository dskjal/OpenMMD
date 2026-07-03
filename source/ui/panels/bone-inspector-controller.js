import { replaceSelectOptions } from './inspector-select-ui.js';
import { isNumericInputFocused, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';

const BONE_ROTATION_LOCK_ICON_PATH = 'fonts/lock_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg';
const BONE_ROTATION_UNLOCK_ICON_PATH = 'fonts/lock_open_right_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg';

/**
 * Returns whether any numeric input is focused.
 * @param {Array<HTMLInputElement|null>} inputs - Candidate inputs.
 * @returns {boolean} True when any input is focused.
 */
function isAnyNumericInputFocused(inputs) {
  return inputs.some((input) => isNumericInputFocused(input));
}

/**
 * Sets input background colors and disabled state.
 * @param {Array<HTMLInputElement|null>} inputs - Target inputs.
 * @param {Array<object>} states - Per-input state.
 * @param {number} fractionDigits - Display precision.
 */
function syncInputStates(inputs, states, fractionDigits) {
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const state = states[index] || {};
    if (!input) {
      continue;
    }
    input.disabled = Boolean(state.disabled);
    input.style.backgroundColor = state.backgroundColor || '';
    if (state.value === null || state.value === undefined) {
      if (!isNumericInputFocused(input)) {
        input.value = '';
      }
      continue;
    }
    syncNumericInputValue(input, state.value, {
      force: false,
      format: (value) => Number(value).toFixed(fractionDigits),
    });
  }
}

/**
 * Installs the bone inspector controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function}} Bone inspector controller.
 */
export function installBoneInspectorController(options = {}) {
  const uiState = options.uiState;
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  if (!uiState || !documentRef) {
    return {
      sync() {},
    };
  }

  const bindLinkedNumericInputs = options.bindLinkedNumericInputs;

  /**
   * Syncs select options.
   * @param {HTMLSelectElement|null} select - Target select.
   * @param {Array<object>} items - Option items.
   * @param {string} value - Selected value.
   * @param {boolean} disabled - Disabled state.
   * @param {boolean} [includeEmptyOption=true] - Whether to prepend an empty option.
   */
  function syncSelect(select, items, value, disabled, includeEmptyOption = true) {
    if (!select) {
      return;
    }
    replaceSelectOptions({
      select,
      documentRef,
      items: includeEmptyOption ? [{ value: '', label: options.getLangData?.().None || 'None' }, ...items] : items,
      value,
      disabled,
    });
  }

  /**
   * Returns interaction state used by the read-model service.
   * @returns {object} Interaction state.
   */
  function getInteractionState() {
    const inspectorState = options.inspectorState ?? options.selection ?? {};
    return {
      isBoneInfoEditing: isAnyNumericInputFocused(uiState.positionInputs) || isAnyNumericInputFocused(uiState.rotationInputs),
      isWorldRotationEditing: inspectorState.useWorldCoordinate === true && isAnyNumericInputFocused(uiState.rotationInputs),
    };
  }

  /**
   * Syncs rotation lock button UI.
   * @param {Array<HTMLButtonElement|null>} buttons - Lock buttons.
   * @param {object} state - Lock state.
   * @param {string} lockLabel - Lock label.
   * @param {string} unlockLabel - Unlock label.
   */
  function syncRotationLockButtons(buttons, state, lockLabel, unlockLabel) {
    const axes = ['x', 'y', 'z'];
    const resolvedLockLabel = typeof lockLabel === 'string' && lockLabel.length > 0 ? lockLabel : 'Lock';
    const resolvedUnlockLabel = typeof unlockLabel === 'string' && unlockLabel.length > 0 ? unlockLabel : 'Unlock';
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      if (!button) {
        continue;
      }
      const axis = axes[index];
      if (!axis) {
        continue;
      }
      const locked = Boolean(state.values?.[axis]);
      button.disabled = !state.enabled;
      button.setAttribute('aria-pressed', String(locked));
      const label = `${axis.toUpperCase()} ${locked ? resolvedUnlockLabel : resolvedLockLabel}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      const icon = button.querySelector('.bone-rotation-lock-icon');
      if (icon) {
        icon.src = locked ? BONE_ROTATION_LOCK_ICON_PATH : BONE_ROTATION_UNLOCK_ICON_PATH;
        icon.classList.toggle('is-disabled', !state.enabled);
      }
    }
  }

  /**
   * Syncs key buttons.
   * @param {object} state - Key button state.
   */
  function syncKeyButtons(state) {
    const apply = (button, enabled) => {
      if (!button) {
        return;
      }
      button.disabled = !enabled;
      button.title = state.label;
      button.setAttribute('aria-label', state.label);
      const icon = button.querySelector('.bone-key-icon');
      if (icon) {
        icon.classList.toggle('is-disabled', !enabled);
      }
    };

    apply(uiState.keyButtons.position, state.positionEnabled);
    apply(uiState.keyButtons.rotation, state.rotationEnabled);
    for (const icon of uiState.keyButtons.all) {
      icon.hidden = false;
      icon.classList.toggle('is-disabled', !(state.positionEnabled || state.rotationEnabled));
    }
  }

  uiState.child.pickButton?.addEventListener('click', () => {
    options.setChildBonePickMode?.(!options.isChildBonePickModeEnabled?.());
    options.refreshScene?.();
  });

  uiState.useWorldCoordinateElement?.addEventListener('change', (event) => {
    const inspectorState = options.inspectorState ?? options.selection ?? {};
    inspectorState.useWorldCoordinate = event.target.checked;
    inspectorState.lastSelectedBoneIndex = -1;
    options.clearWorldRotationDisplay?.(inspectorState.worldRotationUiState);
    options.refreshScene?.();
  });

  uiState.saveVpdButton?.addEventListener('click', () => {
    const exportData = options.boneService?.buildSelectedBoneVpdExport?.();
    if (!exportData) {
      return;
    }
    options.downloadBinary?.(exportData);
  });

  for (const input of [...uiState.positionInputs, ...uiState.rotationInputs]) {
    input?.addEventListener('input', () => {
      const posX = Number.parseFloat(uiState.positionInputs[0]?.value ?? '');
      const posY = Number.parseFloat(uiState.positionInputs[1]?.value ?? '');
      const posZ = Number.parseFloat(uiState.positionInputs[2]?.value ?? '');
      const rotXDeg = Number.parseFloat(uiState.rotationInputs[0]?.value ?? '');
      const rotYDeg = Number.parseFloat(uiState.rotationInputs[1]?.value ?? '');
      const rotZDeg = Number.parseFloat(uiState.rotationInputs[2]?.value ?? '');
      const applied = options.boneService?.applyBoneInputChange?.({
        posX,
        posY,
        posZ,
        rotXDeg,
        rotYDeg,
        rotZDeg,
      });
      if (applied) {
        options.refreshScene?.();
      }
    });
  }

  uiState.rotationLockButtons.forEach((button) => {
    button?.addEventListener('click', () => {
      const axis = button.getAttribute('data-bone-rotation-axis');
      if (options.boneService?.applyRotationLock?.(axis)) {
        options.refreshScene?.();
      }
    });
  });

  uiState.child.enabledCheckbox?.addEventListener('change', () => {
    options.boneService?.updateChildEnabled?.(
      Boolean(uiState.child.enabledCheckbox?.checked),
      Number.parseFloat(uiState.child.influenceRange?.value ?? '1'),
    );
    options.refreshScene?.();
  });
  uiState.child.modelSelect?.addEventListener('change', () => {
    options.boneService?.updateChildTargets?.(
      Number.parseInt(uiState.child.modelSelect?.value ?? '', 10),
      Number.parseInt(uiState.child.boneSelect?.value ?? '', 10),
      Boolean(uiState.child.enabledCheckbox?.checked),
      Number.parseFloat(uiState.child.influenceRange?.value ?? '1'),
    );
    options.refreshScene?.();
  });
  uiState.child.boneSelect?.addEventListener('change', () => {
    options.boneService?.updateChildTargets?.(
      Number.parseInt(uiState.child.modelSelect?.value ?? '', 10),
      Number.parseInt(uiState.child.boneSelect?.value ?? '', 10),
      Boolean(uiState.child.enabledCheckbox?.checked),
      Number.parseFloat(uiState.child.influenceRange?.value ?? '1'),
    );
    options.refreshScene?.();
  });
  uiState.child.setInverseButton?.addEventListener('click', () => {
    if (options.boneService?.setChildInverse?.()) {
      options.refreshScene?.();
    }
  });
  uiState.child.clearInverseButton?.addEventListener('click', () => {
    if (options.boneService?.clearChildInverse?.()) {
      options.refreshScene?.();
    }
  });

  uiState.ik.enabledCheckbox?.addEventListener('change', () => {
    if (options.boneService?.applyIkEnabled?.(Boolean(uiState.ik.enabledCheckbox?.checked))) {
      options.refreshScene?.();
    }
  });
  uiState.ik.targetBoneSelect?.addEventListener('change', () => {
    if (options.boneService?.applyIkTarget?.(Number.parseInt(uiState.ik.targetBoneSelect?.value ?? '', 10))) {
      options.refreshScene?.();
    }
  });
  uiState.ik.createButton?.addEventListener('click', () => {
    if (options.boneService?.applyCreateIk?.()) {
      options.refreshScene?.();
    }
  });
  uiState.ik.deleteButton?.addEventListener('click', () => {
    if (options.boneService?.applyDeleteIk?.()) {
      options.refreshScene?.();
    }
  });
  uiState.ik.rotationLockButtons.forEach((button) => {
    button?.addEventListener('click', () => {
      const axis = button.getAttribute('data-bone-ik-rotation-axis');
      if (options.boneService?.applyIkRotationLock?.(axis)) {
        options.refreshScene?.();
      }
    });
  });

  uiState.keyButtons.position?.addEventListener('click', () => {
    options.boneService?.registerBoneKeyframe?.('translation');
  });
  uiState.keyButtons.rotation?.addEventListener('click', () => {
    options.boneService?.registerBoneKeyframe?.('rotation');
  });
  uiState.keyButtons.all.forEach((icon) => {
    icon.addEventListener('click', () => {
      options.boneService?.registerBoneKeyframe?.('all');
    });
  });

  const resetBoneTranslation = () => {
    if (options.boneService?.resetBoneTranslation?.()) {
      options.refreshScene?.();
    }
  };
  const resetBoneRotation = () => {
    if (options.boneService?.resetBoneRotation?.()) {
      options.refreshScene?.();
    }
  };
  uiState.resetButtons.position?.addEventListener('click', resetBoneTranslation);
  uiState.resetButtons.shortcutPosition?.addEventListener('click', resetBoneTranslation);
  uiState.resetButtons.rotation?.addEventListener('click', resetBoneRotation);
  uiState.resetButtons.shortcutRotation?.addEventListener('click', resetBoneRotation);

  uiState.clipboardButtons.copyPosition?.addEventListener('click', () => {
    options.boneService?.copyBonePos?.();
  });
  uiState.clipboardButtons.pastePosition?.addEventListener('click', () => {
    if (options.boneService?.pasteBonePos?.(false)) {
      options.refreshScene?.();
    }
  });
  uiState.clipboardButtons.flipPastePosition?.addEventListener('click', () => {
    if (options.boneService?.pasteBonePos?.(true)) {
      options.refreshScene?.();
    }
  });
  uiState.clipboardButtons.copyRotation?.addEventListener('click', () => {
    options.boneService?.copyBoneRot?.();
  });
  uiState.clipboardButtons.pasteRotation?.addEventListener('click', () => {
    if (options.boneService?.pasteBoneRot?.(false)) {
      options.refreshScene?.();
    }
  });
  uiState.clipboardButtons.flipPasteRotation?.addEventListener('click', () => {
    if (options.boneService?.pasteBoneRot?.(true)) {
      options.refreshScene?.();
    }
  });

  if (typeof bindLinkedNumericInputs === 'function') {
    bindLinkedNumericInputs({
      rangeInput: uiState.child.influenceRange,
      valueInput: uiState.child.influenceValue,
      fallbackValue: 1,
      getValue: () => Number.parseFloat(uiState.child.influenceRange?.value ?? uiState.child.influenceValue?.value ?? '1'),
      setValue: (nextValue) => {
        if (uiState.child.influenceRange) {
          uiState.child.influenceRange.value = String(nextValue);
        }
        if (uiState.child.influenceValue) {
          uiState.child.influenceValue.value = String(nextValue);
        }
        options.boneService?.updateChildInfluence?.(nextValue);
        options.refreshScene?.();
      },
      sanitize: (value) => Number.isFinite(value) ? value : 1,
    });
    uiState.ik.chainCountBinding = bindLinkedNumericInputs({
      rangeInput: uiState.ik.chainCountRange,
      valueInput: uiState.ik.chainCountValue,
      fallbackValue: 1,
      getValue: () => 1,
      setValue: (nextValue) => {
        options.boneService?.applyIkChainCount?.(nextValue);
        options.refreshScene?.();
      },
      sanitize: (value) => Math.max(1, Math.min(10, Math.round(Number(value) || 1))),
    });
    uiState.ik.iterationCountBinding = bindLinkedNumericInputs({
      rangeInput: uiState.ik.iterationCountRange,
      valueInput: uiState.ik.iterationCountValue,
      fallbackValue: 1,
      getValue: () => 1,
      setValue: (nextValue) => {
        options.boneService?.applyIkIterationCount?.(nextValue);
        options.refreshScene?.();
      },
      sanitize: (value) => Math.max(1, Math.round(Number(value) || 1)),
    });
  }

  if (options.timelineView) {
    options.timelineView.onKeyframeSelected = (track, keyframeEntry) => {
      const result = options.boneService?.handleTimelineBoneSelection?.(track, keyframeEntry);
      if (!result) {
        return;
      }
      if (result.shouldRefresh) {
        options.refreshScene?.();
      }
      if (result.interpolation && options.interpolationPanel?.setFromInterpolationArray) {
        options.interpolationPanel.setFromInterpolationArray(result.interpolation);
      }
    };
  }

  /**
   * Syncs the rendered bone inspector UI.
   * @param {object|null} activeInstance - Active instance.
   * @param {object} [langData={}] - Localization map.
   */
  function sync(activeInstance, langData = {}) {
    const state = options.inspectorService?.getPanelState?.(activeInstance, langData, getInteractionState()) ?? null;
    if (!state) {
      return;
    }

    if (uiState.positionHeader) {
      uiState.positionHeader.setAttribute('data-i18n', state.headers.positionKey);
      uiState.positionHeader.textContent = state.headers.positionLabel;
    }
    if (uiState.rotationHeader) {
      uiState.rotationHeader.setAttribute('data-i18n', state.headers.rotationKey);
      uiState.rotationHeader.textContent = state.headers.rotationLabel;
    }
    if (uiState.parentNameElement) {
      uiState.parentNameElement.textContent = state.parentBoneName;
    }
    if (uiState.saveVpdButton) {
      uiState.saveVpdButton.disabled = Boolean(state.saveVpdDisabled);
    }

    syncInputStates(uiState.positionInputs, state.positionInputs, 3);
    syncInputStates(uiState.rotationInputs, state.rotationInputs, 1);
    syncKeyButtons(state.keyButtons);
    syncRotationLockButtons(uiState.rotationLockButtons, state.rotationLocks, state.rotationLocks.labels?.lock, state.rotationLocks.labels?.unlock);

    if (uiState.child.enabledCheckbox) {
      uiState.child.enabledCheckbox.disabled = !state.child.controlsEnabled;
      uiState.child.enabledCheckbox.checked = Boolean(state.child.enabled);
    }
    syncSelect(uiState.child.modelSelect, state.child.modelOptions, state.child.modelValue, !state.child.controlsEnabled, true);
    syncSelect(uiState.child.boneSelect, state.child.boneOptions, state.child.boneValue, !state.child.controlsEnabled || state.child.modelOptions.length === 0, true);
    if (uiState.child.pickButton) {
      uiState.child.pickButton.disabled = Boolean(state.child.pickButtonDisabled);
      uiState.child.pickButton.classList.toggle('is-active', Boolean(state.child.pickButtonPressed));
      uiState.child.pickButton.setAttribute('aria-pressed', String(Boolean(state.child.pickButtonPressed)));
      uiState.child.pickButton.title = state.child.pickButtonLabel;
      uiState.child.pickButton.setAttribute('aria-label', state.child.pickButtonLabel);
    }
    if (uiState.child.setInverseButton) {
      uiState.child.setInverseButton.disabled = Boolean(state.child.setInverseDisabled);
    }
    if (uiState.child.clearInverseButton) {
      uiState.child.clearInverseButton.disabled = Boolean(state.child.clearInverseDisabled);
    }
    if (uiState.child.influenceRange) {
      uiState.child.influenceRange.disabled = !state.child.controlsEnabled;
    }
    if (uiState.child.influenceValue) {
      uiState.child.influenceValue.disabled = !state.child.controlsEnabled;
    }
    if (uiState.child.influenceRange) {
      syncNumericInputValue(uiState.child.influenceRange, state.child.influence, {
        force: false,
        format: (value) => Number(value).toFixed(2),
      });
    }
    if (uiState.child.influenceValue) {
      syncNumericInputValue(uiState.child.influenceValue, state.child.influence, {
        force: false,
        format: (value) => Number(value).toFixed(2),
      });
    }

    if (uiState.ik.enabledCheckbox) {
      uiState.ik.enabledCheckbox.disabled = !state.ik.controlsEnabled;
      uiState.ik.enabledCheckbox.checked = Boolean(state.ik.enabled);
    }
    syncSelect(uiState.ik.targetBoneSelect, state.ik.targetOptions, state.ik.targetValue, !state.ik.controlsEnabled, false);
    if (uiState.ik.createButton) {
      uiState.ik.createButton.disabled = Boolean(state.ik.createDisabled);
    }
    if (uiState.ik.deleteButton) {
      uiState.ik.deleteButton.disabled = Boolean(state.ik.deleteDisabled);
    }
    syncRotationLockButtons(uiState.ik.rotationLockButtons, {
      enabled: state.ik.rotationLocksEnabled,
      values: state.ik.rotationLocks,
    }, state.ik.labels?.lock, state.ik.labels?.unlock);
    uiState.ik.chainCountRange && uiState.ik.chainCountBinding?.syncFromValue?.(state.ik.chainCount, { forceValue: false, forceRange: false });
    uiState.ik.iterationCountRange && uiState.ik.iterationCountBinding?.syncFromValue?.(state.ik.iterationCount, { forceValue: false, forceRange: false });
  }

  return {
    sync,
  };
}
