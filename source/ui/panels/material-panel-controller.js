import { bindLinkedNumericInputs, syncNumericInputValue } from '../../shared/ui/numeric-input-utils.js';
import { setupColorPickerUI } from './color-picker-ui.js';

/**
 * Installs the material panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function, dispose: function}} Material panel controller.
 */
export function installMaterialPanelController(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const windowRef = options.windowRef ?? globalThis.window ?? null;
  const service = options.service;
  const getLangData = options.getLangData ?? (() => ({}));
  const triggerSceneRefresh = options.triggerSceneRefresh ?? (() => {});
  const loadModelSettingsFile = options.loadModelSettingsFile ?? (async () => {});

  const uiState = {
    list: null,
    emptyState: null,
    shaderSelect: null,
    shaderReloadButton: null,
    selectAllButton: null,
    clearAllButton: null,
    visibleCheckbox: null,
    ssssCheckbox: null,
    receiveShadowCheckbox: null,
    castShadowCheckbox: null,
    noCullCheckbox: null,
    hasEdgeCheckbox: null,
    metallicRange: null,
    metallicValue: null,
    diffuseSwatch: null,
    shadeSwatch: null,
    roughnessRange: null,
    roughnessValue: null,
    emissiveSwatch: null,
    emissiveTextureSwatch: null,
    emissiveSourceSelect: null,
    emissiveStrength: null,
    toonThumbnailButton: null,
    jsonSaveButton: null,
    jsonLoadButton: null,
    jsonFileInput: null,
    toonPickerOverlay: null,
    toonPickerDialog: null,
    toonPickerTitle: null,
    toonPickerCloseButton: null,
    toonPickerGrid: null,
    toonPickerEmptyState: null,
  };
  const pickerState = {
    diffuseColor: [1, 1, 1, 1],
    shadeColor: [1, 1, 1, 1],
    emissiveColor: [0, 0, 0, 1],
  };
  const disposers = [];
  let diffuseColorPicker = null;
  let shadeColorPicker = null;
  let emissiveColorPicker = null;
  let bound = false;

  /**
   * Returns localized text.
   * @param {string} key - Translation key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(key, fallback) {
    return getLangData()?.[key] || fallback || key;
  }

  /**
   * Returns DOM elements.
   * @returns {object|null} DOM elements.
   */
  function getElements() {
    if (!documentRef) {
      return null;
    }
    if (!uiState.list) {
      uiState.list = documentRef.getElementById('material-list');
      uiState.emptyState = documentRef.getElementById('material-empty-state');
      uiState.shaderSelect = documentRef.getElementById('material-shader-select');
      uiState.shaderReloadButton = documentRef.getElementById('material-shader-reload');
      uiState.selectAllButton = documentRef.getElementById('material-select-all');
      uiState.clearAllButton = documentRef.getElementById('material-clear-all');
      uiState.visibleCheckbox = documentRef.getElementById('material-visible');
      uiState.ssssCheckbox = documentRef.getElementById('material-ssss');
      uiState.receiveShadowCheckbox = documentRef.getElementById('material-receive-shadow');
      uiState.castShadowCheckbox = documentRef.getElementById('material-cast-shadow');
      uiState.noCullCheckbox = documentRef.getElementById('material-no-cull');
      uiState.hasEdgeCheckbox = documentRef.getElementById('material-has-edge');
      uiState.metallicRange = documentRef.getElementById('material-metallic-range');
      uiState.metallicValue = null;
      uiState.diffuseSwatch = documentRef.getElementById('material-diffuse-swatch');
      uiState.shadeSwatch = documentRef.getElementById('material-shade-swatch');
      uiState.roughnessRange = documentRef.getElementById('material-roughness-range');
      uiState.roughnessValue = null;
      uiState.emissiveSwatch = documentRef.getElementById('material-emissive-swatch');
      uiState.emissiveTextureSwatch = documentRef.getElementById('material-emissive-texture-swatch');
      uiState.emissiveSourceSelect = documentRef.getElementById('material-emissive-source');
      uiState.emissiveStrength = documentRef.getElementById('material-emissive-strength');
      uiState.toonThumbnailButton = documentRef.getElementById('material-toon-swatch');
      uiState.jsonSaveButton = documentRef.getElementById('model-json-save');
      uiState.jsonLoadButton = documentRef.getElementById('model-json-load');
      uiState.jsonFileInput = documentRef.getElementById('model-json-file-input');
      uiState.toonPickerOverlay = documentRef.getElementById('toon-texture-picker-overlay');
      uiState.toonPickerDialog = documentRef.getElementById('toon-texture-picker-dialog');
      uiState.toonPickerTitle = documentRef.getElementById('toon-texture-picker-title');
      uiState.toonPickerCloseButton = documentRef.getElementById('toon-texture-picker-close');
      uiState.toonPickerGrid = documentRef.getElementById('toon-texture-picker-grid');
      uiState.toonPickerEmptyState = documentRef.getElementById('toon-texture-picker-empty-state');
    }
    return uiState.list ? uiState : null;
  }

  /**
   * Syncs checkbox state.
   * @param {HTMLInputElement|null} checkbox - Checkbox element.
   * @param {{checked: boolean, indeterminate: boolean, disabled: boolean}} state - Checkbox state.
   */
  function syncCheckboxState(checkbox, state) {
    if (!checkbox) {
      return;
    }
    checkbox.disabled = state.disabled;
    checkbox.indeterminate = state.indeterminate;
    checkbox.checked = state.checked;
  }

  /**
   * Syncs one numeric control pair.
   * @param {HTMLInputElement|null} rangeInput - Range input.
   * @param {HTMLInputElement|null} valueInput - Value input.
   * @param {{value: number, mixed: boolean, disabled: boolean}} state - Numeric state.
   * @param {string} mixedPlaceholder - Mixed placeholder.
   */
  function syncNumericControl(rangeInput, valueInput, state, mixedPlaceholder) {
    if (rangeInput) {
      rangeInput.disabled = state.disabled;
      syncNumericInputValue(rangeInput, state.value, { force: false });
      if (!valueInput && 'placeholder' in rangeInput) {
        rangeInput.placeholder = state.mixed ? mixedPlaceholder : '';
      }
    }
    if (valueInput) {
      valueInput.disabled = state.disabled;
      if (!state.mixed) {
        syncNumericInputValue(valueInput, state.value, { force: false });
      }
      valueInput.placeholder = state.mixed ? mixedPlaceholder : '';
    }
  }

  /**
   * Syncs one color control.
   * @param {HTMLButtonElement|null} button - Trigger button.
   * @param {HTMLElement|null} row - Row element.
   * @param {{value: number[], mixed: boolean, disabled: boolean}} state - Color state.
   * @param {string} mixedPlaceholder - Mixed placeholder.
   * @param {object|null} controller - Color picker controller.
   * @param {string} title - Button title.
   */
  function syncColorControl(button, row, state, mixedPlaceholder, controller, title) {
    if (!button) {
      return;
    }
    button.disabled = state.disabled;
    row?.classList.toggle('is-mixed', state.mixed);
    controller?.setMixed?.(state.mixed);
    controller?.refresh?.();
    if (state.mixed) {
      button.title = `${title}: ${mixedPlaceholder}`;
      return;
    }
    const [red, green, blue] = state.value;
    const color = `rgb(${Math.round(service.clampMaterialNumericValue(red, 0, 1, 0) * 255)} ${Math.round(service.clampMaterialNumericValue(green, 0, 1, 0) * 255)} ${Math.round(service.clampMaterialNumericValue(blue, 0, 1, 0) * 255)})`;
    button.title = `${title}: ${color}`;
  }

  /**
   * Syncs one source select.
   * @param {HTMLSelectElement|null} select - Source select.
   * @param {{value: 'color'|'texture', mixed: boolean, disabled: boolean}} state - Source state.
   * @param {string} mixedPlaceholder - Mixed placeholder.
   * @param {string} title - Title.
   */
  function syncSourceSelect(select, state, mixedPlaceholder, title) {
    if (!select || !documentRef) {
      return;
    }
    select.disabled = state.disabled;
    select.innerHTML = '';
    const colorOption = documentRef.createElement('option');
    colorOption.value = 'color';
    colorOption.textContent = t('Color', 'Color');
    const textureOption = documentRef.createElement('option');
    textureOption.value = 'texture';
    textureOption.textContent = t('Texture', 'Texture');
    select.append(colorOption, textureOption);
    select.value = state.value === 'texture' ? 'texture' : 'color';
    select.title = state.mixed
      ? `${title}: ${mixedPlaceholder}`
      : `${title}: ${state.value === 'texture' ? t('Texture', 'Texture') : t('Color', 'Color')}`;
  }

  /**
   * Syncs one texture button.
   * @param {HTMLButtonElement|null} button - Texture button.
   * @param {HTMLElement|null} row - Row element.
   * @param {{reference: object|null, mixed: boolean, disabled: boolean, previewSource: string, description: string}} state - Texture state.
   * @param {string} mixedPlaceholder - Mixed placeholder.
   * @param {string} title - Title.
   * @param {object} [optionsBag={}] - Options bag.
   */
  function syncTextureControl(button, row, state, mixedPlaceholder, title, optionsBag = {}) {
    if (!button || !documentRef) {
      return;
    }
    const mixedClassName = String(optionsBag.mixedClassName || 'material-toon-swatch--mixed');
    button.disabled = state.disabled;
    button.innerHTML = '';
    row?.classList.toggle('is-mixed', state.mixed);
    button.classList.remove(mixedClassName);

    if (state.mixed) {
      button.title = `${title}: ${mixedPlaceholder}`;
      button.textContent = mixedPlaceholder;
      button.classList.add(mixedClassName);
      return;
    }
    if (state.previewSource) {
      const img = documentRef.createElement('img');
      img.alt = title;
      img.src = state.previewSource;
      img.loading = 'lazy';
      button.appendChild(img);
    } else {
      const shortLabel = String(state.description || 'None').slice(0, 2).toUpperCase() || 'NO';
      button.textContent = shortLabel;
      button.classList.add(mixedClassName);
    }
    button.title = `${title}: ${state.description}`;
  }

  /**
   * Syncs the material list selection.
   * @param {HTMLSelectElement} listElement - List element.
   * @param {number[]} selectedIndices - Selected indices.
   */
  function syncMaterialSelectionList(listElement, selectedIndices) {
    const selectedSet = new Set(selectedIndices);
    for (const option of listElement.options) {
      option.selected = selectedSet.has(Number.parseInt(option.value, 10));
    }
  }

  /**
   * Syncs the shader select.
   * @param {HTMLSelectElement|null} select - Shader select.
   * @param {{shaderName: string, mixed: boolean, disabled: boolean}} shaderState - Shader state.
   * @param {Array<{value: string, label: string}>} shaderOptions - Shader options.
   */
  function syncShaderSelect(select, shaderState, shaderOptions) {
    if (!select || !documentRef) {
      return;
    }
    const mixedOptionValue = '__mixed__';
    select.innerHTML = '';
    if (shaderState.mixed) {
      const mixedOption = documentRef.createElement('option');
      mixedOption.value = mixedOptionValue;
      mixedOption.textContent = t('Mixed', 'Mixed');
      mixedOption.disabled = true;
      mixedOption.selected = true;
      select.appendChild(mixedOption);
    }
    for (const optionState of shaderOptions) {
      const option = documentRef.createElement('option');
      option.value = optionState.value;
      option.textContent = optionState.label;
      select.appendChild(option);
    }
    select.disabled = shaderState.disabled || shaderOptions.length === 0;
    select.value = shaderState.disabled || shaderOptions.length === 0
      ? ''
      : shaderState.mixed
        ? mixedOptionValue
        : shaderState.shaderName;
  }

  /**
   * Syncs picker UI.
   * @param {object} state - Panel state.
   */
  function syncPicker(state) {
    const elements = getElements();
    if (!elements?.toonPickerOverlay || !elements.toonPickerDialog || !elements.toonPickerGrid || !documentRef) {
      return;
    }
    const picker = state.pickerState;
    elements.toonPickerOverlay.hidden = !picker.open;
    elements.toonPickerDialog.setAttribute('aria-hidden', picker.open ? 'false' : 'true');
    if (elements.toonPickerTitle) {
      elements.toonPickerTitle.textContent = picker.title;
    }
    elements.toonPickerGrid.innerHTML = '';
    let hasCandidates = false;
    for (const group of picker.groups) {
      if (!Array.isArray(group.items) || group.items.length === 0) {
        continue;
      }
      hasCandidates = true;
      const heading = documentRef.createElement('div');
      heading.className = 'toon-picker-group-label';
      heading.textContent = group.label;
      elements.toonPickerGrid.appendChild(heading);

      for (const item of group.items) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'texture-card toon-picker-card';
        button.dataset.toonCandidateIndex = String(item.candidateIndex);
        button.title = item.label;
        if (item.key === picker.selectedKey) {
          button.classList.add('is-selected');
        }

        const preview = documentRef.createElement('div');
        preview.className = 'texture-preview';
        if (item.previewSource) {
          const img = documentRef.createElement('img');
          img.alt = item.label;
          img.src = item.previewSource;
          img.loading = 'lazy';
          preview.appendChild(img);
        } else {
          preview.classList.add('texture-preview--placeholder');
          preview.textContent = item.label.slice(0, 2).toUpperCase();
        }

        const name = documentRef.createElement('div');
        name.className = 'texture-name';
        name.textContent = item.label;
        button.append(preview, name);
        elements.toonPickerGrid.appendChild(button);
      }
    }

    const noneButton = documentRef.createElement('button');
    noneButton.type = 'button';
    noneButton.className = 'texture-card toon-picker-card toon-picker-card--none';
    noneButton.dataset.toonAction = 'none';
    noneButton.title = t('None', 'None');
    if (!picker.selectedKey || picker.selectedKey === 'none') {
      noneButton.classList.add('is-selected');
    }
    const nonePreview = documentRef.createElement('div');
    nonePreview.className = 'texture-preview texture-preview--placeholder';
    nonePreview.textContent = t('None', 'None').slice(0, 2).toUpperCase();
    const noneName = documentRef.createElement('div');
    noneName.className = 'texture-name';
    noneName.textContent = t('None', 'None');
    noneButton.append(nonePreview, noneName);
    elements.toonPickerGrid.appendChild(noneButton);

    if (elements.toonPickerEmptyState) {
      elements.toonPickerEmptyState.hidden = hasCandidates;
      elements.toonPickerEmptyState.textContent = hasCandidates ? '' : picker.emptyMessage;
    }
  }

  /**
   * Binds one DOM event and tracks disposal.
   * @param {EventTarget|null|undefined} target - Event target.
   * @param {string} name - Event name.
   * @param {EventListener} listener - Listener.
   */
  function bind(target, name, listener) {
    target?.addEventListener?.(name, listener);
    if (target?.removeEventListener) {
      disposers.push(() => target.removeEventListener(name, listener));
    }
  }

  /**
   * Triggers a scene refresh after a successful mutation.
   */
  function refreshAfterMutation() {
    sync();
    triggerSceneRefresh();
  }

  /**
   * Installs event bindings once.
   */
  function ensureBound() {
    if (bound) {
      return;
    }
    const elements = getElements();
    if (!elements) {
      return;
    }
    bound = true;

    bind(elements.list, 'change', () => {
      const nextSelection = Array.from(elements.list.selectedOptions, (option) => Number.parseInt(option.value, 10))
        .filter((index) => Number.isInteger(index));
      service.setSelectedMaterialIndices(nextSelection);
    });
    bind(elements.selectAllButton, 'click', () => {
      service.selectAllMaterials();
    });
    bind(elements.clearAllButton, 'click', () => {
      service.clearMaterialSelection();
    });
    bind(elements.shaderSelect, 'change', async () => {
      try {
        const applied = await service.applyShader(elements.shaderSelect.value);
        if (applied) {
          refreshAfterMutation();
          return;
        }
      } catch (error) {
        console.error(`Failed to apply shader '${elements.shaderSelect.value}'.`, error);
      }
      sync();
    });
    bind(elements.shaderReloadButton, 'click', async () => {
      const shaderName = elements.shaderSelect?.value || '';
      try {
        const reloaded = await service.reloadShader(shaderName);
        if (reloaded) {
          refreshAfterMutation();
        }
      } catch (error) {
        console.error(`Failed to reload shader '${shaderName}'.`, error);
        sync();
      }
    });
    bind(elements.jsonSaveButton, 'click', () => {
      const payload = service.buildModelSettingsDownload();
      if (!payload || !windowRef || !documentRef) {
        return;
      }
      const blob = new Blob([payload.text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = payload.downloadName;
      documentRef.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
    bind(elements.jsonLoadButton, 'click', () => {
      elements.jsonFileInput?.click();
    });
    bind(elements.jsonFileInput, 'change', async (event) => {
      const files = Array.from(event.target.files || []).filter(Boolean);
      try {
        for (const file of files) {
          await loadModelSettingsFile(file);
        }
      } finally {
        event.target.value = '';
      }
    });

    for (const [field, element] of [
      ['visible', elements.visibleCheckbox],
      ['ssss', elements.ssssCheckbox],
      ['receiveShadow', elements.receiveShadowCheckbox],
      ['castShadow', elements.castShadowCheckbox],
      ['noCull', elements.noCullCheckbox],
      ['hasEdge', elements.hasEdgeCheckbox],
    ]) {
      bind(element, 'change', () => {
        service.applyToggle(field, element.checked);
        refreshAfterMutation();
      });
    }

    bindLinkedNumericInputs({
      rangeInput: elements.metallicRange,
      valueInput: elements.metallicValue,
      fallbackValue: 0,
      setValue: (nextValue) => {
        service.applyNumeric('metallic', nextValue);
        refreshAfterMutation();
      },
      sanitize: (value) => service.clampMaterialNumericValue(value, 0, 1, 0),
    });
    bindLinkedNumericInputs({
      rangeInput: elements.roughnessRange,
      valueInput: elements.roughnessValue,
      fallbackValue: 1,
      setValue: (nextValue) => {
        service.applyNumeric('roughness', nextValue);
        refreshAfterMutation();
      },
      sanitize: (value) => service.clampMaterialNumericValue(value, 0, 1, 1),
    });
    bindLinkedNumericInputs({
      valueInput: elements.emissiveStrength,
      fallbackValue: 0,
      setValue: (nextValue) => {
        service.applyNumeric('emissiveStrength', nextValue);
        refreshAfterMutation();
      },
      sanitize: (value) => service.clampMaterialNumericValue(value, 0, Number.POSITIVE_INFINITY, 0),
    });

    diffuseColorPicker = setupColorPickerUI({
      state: pickerState,
      propertyName: 'diffuseColor',
      applyValue: (nextValue) => {
        service.applyColor('diffuse', nextValue);
      },
      onChanged: refreshAfterMutation,
      title: t('Diffuse', 'Diffuse'),
      allowAlpha: false,
      triggerButtonId: 'material-diffuse-swatch',
    });
    shadeColorPicker = setupColorPickerUI({
      state: pickerState,
      propertyName: 'shadeColor',
      applyValue: (nextValue) => {
        service.applyColor('shade', nextValue);
      },
      onChanged: refreshAfterMutation,
      title: t('Shade Color', 'Shade Color'),
      allowAlpha: false,
      triggerButtonId: 'material-shade-swatch',
    });
    emissiveColorPicker = setupColorPickerUI({
      state: pickerState,
      propertyName: 'emissiveColor',
      applyValue: (nextValue) => {
        service.applyColor('emissive', nextValue);
      },
      onChanged: refreshAfterMutation,
      title: t('Emissive', 'Emissive'),
      allowAlpha: false,
      triggerButtonId: 'material-emissive-swatch',
    });

    bind(elements.toonThumbnailButton, 'click', () => {
      const currentState = service.getPanelState();
      const target = currentState.textureRowLabel === t('Shade Multiply Texture', 'Shade Multiply Texture') ? 'shade' : 'toon';
      if (service.openTexturePicker(target)) {
        sync();
        elements.toonPickerDialog?.focus?.();
      }
    });
    bind(elements.emissiveTextureSwatch, 'click', () => {
      if (service.openTexturePicker('emissive')) {
        sync();
        elements.toonPickerDialog?.focus?.();
      }
    });
    bind(elements.emissiveSourceSelect, 'change', () => {
      service.applyEmissiveSource(elements.emissiveSourceSelect.value === 'texture' ? 'texture' : 'color');
      refreshAfterMutation();
    });
    bind(elements.toonPickerCloseButton, 'click', () => {
      service.closeTexturePicker();
      sync();
    });
    bind(elements.toonPickerOverlay, 'click', (event) => {
      if (event.target === elements.toonPickerOverlay) {
        service.closeTexturePicker();
        sync();
      }
    });
    bind(elements.toonPickerGrid, 'click', async (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest?.('[data-toon-candidate-index],[data-toon-action]') : null;
      if (!button) {
        return;
      }
      try {
        const applied = await service.applyTexturePickerSelection({
          action: button.dataset.toonAction,
          candidateIndex: button.dataset.toonCandidateIndex,
        });
        if (applied) {
          refreshAfterMutation();
          return;
        }
      } catch (error) {
        console.error('Failed to apply texture reference.', error);
      }
      sync();
    });
    bind(windowRef, 'keydown', (event) => {
      if (event.key === 'Escape' && !elements.toonPickerOverlay?.hidden) {
        service.closeTexturePicker();
        sync();
      }
    });
  }

  /**
   * Syncs the panel.
   */
  function sync() {
    const elements = getElements();
    if (!elements || !documentRef) {
      return;
    }
    ensureBound();
    const state = service.getPanelState();
    const mixedPlaceholder = t('Mixed', 'Mixed');

    elements.list.innerHTML = '';
    for (const item of state.listItems) {
      const option = documentRef.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      elements.list.appendChild(option);
    }
    syncMaterialSelectionList(elements.list, state.selectedIndices);
    if (elements.emptyState) {
      elements.emptyState.hidden = state.hasActiveInstance && state.selectedIndices.length !== 0;
      elements.emptyState.textContent = state.emptyMessage;
    }
    if (elements.selectAllButton) {
      elements.selectAllButton.disabled = !state.hasActiveInstance || state.listItems.length === 0;
    }
    if (elements.clearAllButton) {
      elements.clearAllButton.disabled = !state.hasActiveInstance || state.listItems.length === 0;
    }

    syncShaderSelect(elements.shaderSelect, state.shaderState, state.shaderOptions);
    if (elements.shaderReloadButton) {
      elements.shaderReloadButton.title = t('Reload Shader', 'Reload Shader');
      elements.shaderReloadButton.disabled = state.shaderReloadDisabled || elements.shaderSelect?.disabled;
    }
    if (elements.shaderSelect) {
      elements.shaderSelect.title = t('Shader', 'Shader');
    }

    syncCheckboxState(elements.visibleCheckbox, state.toggles.visible);
    syncCheckboxState(elements.ssssCheckbox, state.toggles.ssss);
    syncCheckboxState(elements.receiveShadowCheckbox, state.toggles.receiveShadow);
    syncCheckboxState(elements.castShadowCheckbox, state.toggles.castShadow);
    syncCheckboxState(elements.noCullCheckbox, state.toggles.noCull);
    syncCheckboxState(elements.hasEdgeCheckbox, state.toggles.hasEdge);

    syncNumericControl(elements.metallicRange, elements.metallicValue, state.numericStates.metallic, mixedPlaceholder);
    syncNumericControl(elements.roughnessRange, elements.roughnessValue, state.numericStates.roughness, mixedPlaceholder);
    syncNumericControl(null, elements.emissiveStrength, state.numericStates.emissiveStrength, mixedPlaceholder);

    pickerState.diffuseColor = state.colorStates.diffuse.value.slice();
    pickerState.shadeColor = state.colorStates.shade.value.slice();
    pickerState.emissiveColor = state.colorStates.emissive.value.slice();

    syncColorControl(
      elements.diffuseSwatch,
      elements.diffuseSwatch?.closest('.material-pbr-row') || null,
      state.colorStates.diffuse,
      mixedPlaceholder,
      diffuseColorPicker,
      t('Diffuse', 'Diffuse'),
    );
    syncColorControl(
      elements.shadeSwatch,
      elements.shadeSwatch?.closest('.material-pbr-row') || null,
      state.colorStates.shade,
      mixedPlaceholder,
      shadeColorPicker,
      t('Shade Color', 'Shade Color'),
    );
    syncColorControl(
      elements.emissiveSwatch,
      elements.emissiveSwatch?.closest('.material-pbr-row') || null,
      state.colorStates.emissive,
      mixedPlaceholder,
      emissiveColorPicker,
      t('Emissive', 'Emissive'),
    );
    syncSourceSelect(elements.emissiveSourceSelect, state.emissiveSourceState, mixedPlaceholder, t('Emissive Source', 'Emissive Source'));
    syncTextureControl(
      elements.emissiveTextureSwatch,
      elements.emissiveTextureSwatch?.closest('.material-pbr-row') || null,
      state.emissiveTextureState,
      mixedPlaceholder,
      t('Emissive Texture', 'Emissive Texture'),
      { mixedClassName: 'material-emissive-swatch--mixed' },
    );
    syncTextureControl(
      elements.toonThumbnailButton,
      elements.toonThumbnailButton?.closest('.material-pbr-row') || null,
      state.toonTextureState,
      mixedPlaceholder,
      state.textureRowLabel,
      { mixedClassName: 'material-toon-swatch--mixed' },
    );
    const toonLabel = elements.toonThumbnailButton?.closest('.material-pbr-row')?.querySelector('label') || null;
    if (toonLabel) {
      toonLabel.textContent = state.textureRowLabel;
    }
    if (elements.jsonSaveButton) {
      elements.jsonSaveButton.disabled = !state.jsonEnabled;
    }
    if (elements.jsonLoadButton) {
      elements.jsonLoadButton.disabled = !state.jsonEnabled;
    }
    if (elements.jsonFileInput) {
      elements.jsonFileInput.disabled = !state.jsonEnabled;
    }

    syncPicker(state);
  }

  return {
    sync,
    dispose() {
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        dispose?.();
      }
    },
  };
}
