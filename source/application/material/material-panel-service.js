import {
  collectTextureCandidates,
  collectToonTextureCandidates,
  resolveMaterialEmissiveTextureReference,
  resolveMaterialShadeMultiplyTextureReference,
  resolveMaterialToonTextureReference,
} from '../../infrastructure/gpu/material-resources.js';
import { buildModelSettingsJson } from '../../infrastructure/serialization/model-json.js';

/**
 * Creates the material panel service.
 * @param {object} options - Service options.
 * @returns {object} Material panel service.
 */
export function createMaterialPanelService(options = {}) {
  let pickerState = {
    open: false,
    target: 'toon',
    selectedReference: null,
    candidates: [],
    activeModelCandidates: [],
    otherModelCandidates: [],
    defaultCandidates: [],
  };

  /**
   * Emits a state change event.
   */
  function emitStateChanged() {
    options.onStateChanged?.();
  }

  /**
   * Returns the active instance.
   * @returns {object|null} Active instance.
   */
  function getActiveInstance() {
    return options.getActiveInstance?.() ?? null;
  }

  /**
   * Returns current language data.
   * @returns {object} Language data.
   */
  function getLangData() {
    return options.getLangData?.() ?? {};
  }

  /**
   * Returns localized text.
   * @param {string} key - Translation key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(key, fallback) {
    const langData = getLangData();
    return langData?.[key] || fallback || key;
  }

  /**
   * Normalizes selected material indices.
   * @param {object|null} activeInstance - Active instance.
   * @returns {number[]} Selected indices.
   */
  function normalizeMaterialSelection(activeInstance) {
    if (!activeInstance?.model?.materials?.length) {
      if (activeInstance) {
        activeInstance.selectedMaterialIndices = [];
      }
      return [];
    }
    if (!Array.isArray(activeInstance.selectedMaterialIndices)) {
      activeInstance.selectedMaterialIndices = [0];
    }

    const normalized = [];
    const seen = new Set();
    for (const value of activeInstance.selectedMaterialIndices) {
      const index = Number.parseInt(String(value), 10);
      if (!Number.isInteger(index) || index < 0 || index >= activeInstance.model.materials.length || seen.has(index)) {
        continue;
      }
      seen.add(index);
      normalized.push(index);
    }

    if (normalized.length !== activeInstance.selectedMaterialIndices.length) {
      activeInstance.selectedMaterialIndices = normalized;
    }
    return activeInstance.selectedMaterialIndices;
  }

  /**
   * Applies one callback to all selected materials.
   * @param {object|null} activeInstance - Active instance.
   * @param {(index: number) => void} apply - Apply callback.
   * @returns {number[]} Applied indices.
   */
  function applyToSelectedMaterials(activeInstance, apply) {
    const selectedIndices = normalizeMaterialSelection(activeInstance);
    if (selectedIndices.length === 0) {
      return [];
    }
    for (const index of selectedIndices) {
      apply(index);
    }
    return selectedIndices;
  }

  /**
   * Marks material base state dirty.
   * @param {object|null} activeInstance - Active instance.
   */
  function markMaterialBaseStateDirty(activeInstance) {
    if (activeInstance?.morphController) {
      activeInstance.morphController.dirty = true;
    }
  }

  /**
   * Clamps a material numeric value.
   * @param {number} value - Value.
   * @param {number} min - Minimum.
   * @param {number} max - Maximum.
   * @param {number} fallback - Fallback.
   * @returns {number} Clamped value.
   */
  function clampMaterialNumericValue(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
  }

  /**
   * Normalizes a material color.
   * @param {number[]|null|undefined} value - Input value.
   * @param {number[]} fallback - Fallback color.
   * @returns {number[]} Normalized color.
   */
  function normalizeMaterialColor(value, fallback) {
    const color = Array.isArray(value) ? value : fallback;
    return [
      Number.isFinite(Number(color[0])) ? Number(color[0]) : fallback[0],
      Number.isFinite(Number(color[1])) ? Number(color[1]) : fallback[1],
      Number.isFinite(Number(color[2])) ? Number(color[2]) : fallback[2],
      Number.isFinite(Number(color[3])) ? Number(color[3]) : fallback[3],
    ];
  }

  /**
   * Compares number arrays.
   * @param {number[]} left - Left array.
   * @param {number[]} right - Right array.
   * @param {number} [epsilon=1e-5] - Epsilon.
   * @returns {boolean} Comparison result.
   */
  function areNumberArraysClose(left, right, epsilon = 1e-5) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > epsilon) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns a material numeric value.
   * @param {object|null} material - Material.
   * @param {string} propertyName - Property name.
   * @param {number} fallback - Fallback value.
   * @returns {number} Numeric value.
   */
  function getMaterialNumericValue(material, propertyName, fallback) {
    const value = Number(material?.[propertyName]);
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * Returns a material color value.
   * @param {object|null} material - Material.
   * @param {string} propertyName - Property name.
   * @param {number[]} fallback - Fallback value.
   * @returns {number[]} Color value.
   */
  function getMaterialColorValue(material, propertyName, fallback) {
    return normalizeMaterialColor(material?.[propertyName], fallback);
  }

  /**
   * Returns an MToon color value.
   * @param {object|null} material - Material.
   * @param {string} propertyName - MToon property name.
   * @param {number[]} fallback - Fallback value.
   * @returns {number[]} Color value.
   */
  function getMaterialMtoonColorValue(material, propertyName, fallback) {
    const color = Array.isArray(material?.mtoon?.[propertyName]) ? material.mtoon[propertyName] : fallback;
    return [
      Number.isFinite(Number(color[0])) ? Number(color[0]) : fallback[0],
      Number.isFinite(Number(color[1])) ? Number(color[1]) : fallback[1],
      Number.isFinite(Number(color[2])) ? Number(color[2]) : fallback[2],
      Number.isFinite(Number(color[3])) ? Number(color[3]) : fallback[3],
    ];
  }

  /**
   * Returns one material shader name.
   * @param {object|null} activeInstance - Active instance.
   * @param {number} index - Material index.
   * @returns {string} Shader name.
   */
  function getMaterialShaderName(activeInstance, index) {
    const material = activeInstance?.model?.materials?.[index];
    if (typeof material?.shaderName === 'string' && material.shaderName) {
      return material.shaderName;
    }
    if (typeof options.shaderManager?.getDefaultShaderNameForModel === 'function') {
      return options.shaderManager.getDefaultShaderNameForModel(activeInstance?.model ?? null);
    }
    return 'mmd-shader.wgsl';
  }

  /**
   * Aggregates a shader state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @returns {{shaderName: string, mixed: boolean, disabled: boolean}} Shader state.
   */
  function getAggregatedMaterialShaderState(activeInstance, selectedIndices) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { shaderName: '', mixed: false, disabled: true };
    }
    const firstShaderName = getMaterialShaderName(activeInstance, selectedIndices[0]);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      if (getMaterialShaderName(activeInstance, selectedIndices[index]) !== firstShaderName) {
        return { shaderName: '', mixed: true, disabled: false };
      }
    }
    return { shaderName: firstShaderName, mixed: false, disabled: false };
  }

  /**
   * Aggregates a toggle state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @param {(index: number) => boolean} getter - Getter.
   * @returns {{checked: boolean, indeterminate: boolean, disabled: boolean}} Toggle state.
   */
  function getAggregatedMaterialToggleState(activeInstance, selectedIndices, getter) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { checked: false, indeterminate: false, disabled: true };
    }
    const firstValue = Boolean(getter(selectedIndices[0]));
    for (let index = 1; index < selectedIndices.length; index += 1) {
      if (Boolean(getter(selectedIndices[index])) !== firstValue) {
        return { checked: false, indeterminate: true, disabled: false };
      }
    }
    return { checked: firstValue, indeterminate: false, disabled: false };
  }

  /**
   * Aggregates a numeric state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @param {(index: number) => number} getter - Getter.
   * @param {number} fallback - Fallback value.
   * @param {number} [min=0] - Minimum value.
   * @param {number} [max=1] - Maximum value.
   * @returns {{value: number, mixed: boolean, disabled: boolean}} Numeric state.
   */
  function getAggregatedMaterialNumericState(activeInstance, selectedIndices, getter, fallback, min = 0, max = 1) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { value: fallback, mixed: false, disabled: true };
    }
    const firstValue = clampMaterialNumericValue(getter(selectedIndices[0]), min, max, fallback);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      const nextValue = clampMaterialNumericValue(getter(selectedIndices[index]), min, max, fallback);
      if (Math.abs(nextValue - firstValue) > 1e-5) {
        return { value: firstValue, mixed: true, disabled: false };
      }
    }
    return { value: firstValue, mixed: false, disabled: false };
  }

  /**
   * Aggregates a color state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @param {(index: number) => number[]} getter - Getter.
   * @param {number[]} fallback - Fallback.
   * @returns {{value: number[], mixed: boolean, disabled: boolean}} Color state.
   */
  function getAggregatedMaterialColorState(activeInstance, selectedIndices, getter, fallback) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { value: fallback.slice(), mixed: false, disabled: true };
    }
    const firstValue = normalizeMaterialColor(getter(selectedIndices[0]), fallback);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      const nextValue = normalizeMaterialColor(getter(selectedIndices[index]), fallback);
      if (!areNumberArraysClose(nextValue, firstValue)) {
        return { value: firstValue.slice(), mixed: true, disabled: false };
      }
    }
    return { value: firstValue.slice(), mixed: false, disabled: false };
  }

  /**
   * Aggregates a source state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @param {(index: number) => 'color'|'texture'} getter - Getter.
   * @returns {{value: 'color'|'texture', mixed: boolean, disabled: boolean}} Source state.
   */
  function getAggregatedMaterialSourceState(activeInstance, selectedIndices, getter) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { value: 'color', mixed: false, disabled: true };
    }
    const firstValue = getter(selectedIndices[0]) === 'texture' ? 'texture' : 'color';
    for (let index = 1; index < selectedIndices.length; index += 1) {
      if ((getter(selectedIndices[index]) === 'texture' ? 'texture' : 'color') !== firstValue) {
        return { value: firstValue, mixed: true, disabled: false };
      }
    }
    return { value: firstValue, mixed: false, disabled: false };
  }

  /**
   * Converts a texture reference to a key.
   * @param {object|null} reference - Texture reference.
   * @returns {string} Reference key.
   */
  function getTextureReferenceKey(reference) {
    if (!reference) {
      return '';
    }
    if (reference.kind === 'internal') {
      return `internal:${reference.toonIndex}`;
    }
    if (reference.kind === 'path') {
      return `path:${String(reference.path || '')}:${String(reference.colorSpace || '')}`;
    }
    if (reference.kind === 'none') {
      return 'none';
    }
    return '';
  }

  /**
   * Returns a texture reference label.
   * @param {object|null} reference - Texture reference.
   * @returns {string} Texture label.
   */
  function getTextureDescription(reference) {
    if (!reference || reference.kind === 'none') {
      return 'None';
    }
    if (reference.kind === 'internal') {
      return `toon${String(reference.toonIndex + 1).padStart(2, '0')}.bmp`;
    }
    if (reference.kind === 'path') {
      const path = String(reference.path || '').trim();
      const lastSlashIndex = path.lastIndexOf('/');
      return lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
    }
    return 'None';
  }

  /**
   * Returns a texture reference preview source.
   * @param {object|null} reference - Texture reference.
   * @param {Array<object>} candidates - Candidate list.
   * @returns {string} Preview source.
   */
  function getTexturePreviewSource(reference, candidates) {
    if (!reference) {
      return '';
    }
    const referenceKey = getTextureReferenceKey(reference);
    const matchedCandidate = (candidates || []).find((candidate) => (
      getTextureReferenceKey(candidate.textureReference || candidate.toonTexture || null) === referenceKey
    )) || null;
    if (matchedCandidate?.previewUrl) {
      return matchedCandidate.previewUrl;
    }
    if (reference.kind === 'internal') {
      const toonNumber = Number(reference.toonIndex) + 1;
      if (!Number.isInteger(toonNumber) || toonNumber <= 0) {
        return '';
      }
      return `toon-textures/toon${String(toonNumber).padStart(2, '0')}.bmp`;
    }
    return '';
  }

  /**
   * Aggregates one texture reference state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @param {(index: number) => object|null} getter - Getter.
   * @returns {{reference: object|null, mixed: boolean, disabled: boolean}} Aggregated state.
   */
  function aggregateTextureReferenceState(activeInstance, selectedIndices, getter) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { reference: null, mixed: false, disabled: true };
    }
    const firstReference = getter(selectedIndices[0]);
    const firstKey = getTextureReferenceKey(firstReference);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      const nextReference = getter(selectedIndices[index]);
      if (getTextureReferenceKey(nextReference) !== firstKey) {
        return { reference: firstReference, mixed: true, disabled: false };
      }
    }
    return { reference: firstReference, mixed: false, disabled: false };
  }

  /**
   * Collects picker candidates for one target.
   * @param {'toon'|'shade'|'emissive'} target - Picker target.
   * @returns {object} Picker candidate groups.
   */
  function collectPickerCandidates(target) {
    const instances = options.getInstances?.() ?? [];
    const activeInstanceIndex = options.getActiveInstanceIndex?.() ?? -1;
    return target === 'toon'
      ? collectToonTextureCandidates(instances, activeInstanceIndex)
      : collectTextureCandidates(instances, activeInstanceIndex);
  }

  /**
   * Resolves a current picker selection reference.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected material indices.
   * @param {'toon'|'shade'|'emissive'} target - Target.
   * @returns {object|null} Selected reference.
   */
  function resolvePickerSelectedReference(activeInstance, selectedIndices, target) {
    if (target === 'emissive') {
      return aggregateTextureReferenceState(
        activeInstance,
        selectedIndices,
        (index) => resolveMaterialEmissiveTextureReference(
          activeInstance?.modelPath ?? '',
          activeInstance?.model,
          activeInstance?.model?.materials?.[index] ?? null,
        ),
      ).reference;
    }
    if (target === 'shade') {
      return aggregateTextureReferenceState(
        activeInstance,
        selectedIndices,
        (index) => resolveMaterialShadeMultiplyTextureReference(
          activeInstance?.modelPath ?? '',
          activeInstance?.model,
          activeInstance?.model?.materials?.[index] ?? null,
        ),
      ).reference;
    }
    return aggregateTextureReferenceState(
      activeInstance,
      selectedIndices,
      (index) => resolveMaterialToonTextureReference(
        activeInstance?.modelPath ?? '',
        activeInstance?.model,
        activeInstance?.model?.materials?.[index] ?? null,
      ),
    ).reference;
  }

  /**
   * Ensures per-instance material arrays are initialized.
   * @param {object} activeInstance - Active instance.
   */
  function ensureMaterialArrays(activeInstance) {
    const materials = activeInstance.model?.materials || [];
    if (!Array.isArray(activeInstance.materialVisibility)) {
      activeInstance.materialVisibility = materials.map(() => true);
    }
    if (!Array.isArray(activeInstance.ssssMaterialVisibility)) {
      activeInstance.ssssMaterialVisibility = materials.map(() => true);
    }
    if (!Array.isArray(activeInstance.materialCastShadow)) {
      activeInstance.materialCastShadow = materials.map(() => true);
    }
    while (activeInstance.materialVisibility.length < materials.length) {
      activeInstance.materialVisibility.push(true);
    }
    while (activeInstance.ssssMaterialVisibility.length < materials.length) {
      activeInstance.ssssMaterialVisibility.push(true);
    }
    while (activeInstance.materialCastShadow.length < materials.length) {
      activeInstance.materialCastShadow.push(true);
    }
  }

  return {
    normalizeMaterialSelection,
    clampMaterialNumericValue,

    /**
     * Returns the current panel state.
     * @returns {object} Panel state.
     */
    getPanelState() {
      const activeInstance = getActiveInstance();
      const defaults = options.getDefaultsSnapshot?.('material') ?? {};
      const defaultMaterialVisible = defaults.visible !== false;
      const defaultMaterialSsss = Boolean(defaults.ssss);
      const defaultMaterialReceiveShadow = defaults.receiveShadow !== false;
      const defaultMaterialCastShadow = defaults.castShadow !== false;
      const defaultMaterialNoCull = Boolean(defaults.noCull);
      const defaultMaterialHasEdge = Boolean(defaults.hasEdge);
      const defaultMaterialMetallic = Number.isFinite(defaults.metalic) ? defaults.metalic : 0;
      const defaultMaterialRoughness = Number.isFinite(defaults.roughness) ? defaults.roughness : 1;
      const defaultMaterialEmissiveSource = String(defaults.emissiveSource || 'color').trim().toLowerCase() === 'texture'
        ? 'texture'
        : 'color';
      const defaultMaterialEmissive = Array.isArray(defaults.emissive) ? defaults.emissive : [0, 0, 0, 1];
      const defaultMaterialEmissiveStrength = Number.isFinite(defaults.emissiveStrength) ? defaults.emissiveStrength : 0;
      const shaderDefinitions = options.shaderManager?.getShaderDefinitions?.() || [];

      if (!activeInstance) {
        const pickerCandidates = pickerState.candidates || [];
        return {
          hasActiveInstance: false,
          emptyMessage: t('No model loaded.', 'No model loaded.'),
          listItems: [],
          selectedIndices: [],
          shaderOptions: shaderDefinitions.map((definition) => ({
            value: definition.name,
            label: definition.label || definition.name,
          })),
          shaderState: { shaderName: '', mixed: false, disabled: true },
          shaderReloadDisabled: true,
          toggles: {
            visible: { checked: defaultMaterialVisible, indeterminate: false, disabled: true },
            ssss: { checked: defaultMaterialSsss, indeterminate: false, disabled: true },
            receiveShadow: { checked: defaultMaterialReceiveShadow, indeterminate: false, disabled: true },
            castShadow: { checked: defaultMaterialCastShadow, indeterminate: false, disabled: true },
            noCull: { checked: defaultMaterialNoCull, indeterminate: false, disabled: true },
            hasEdge: { checked: defaultMaterialHasEdge, indeterminate: false, disabled: true },
          },
          numericStates: {
            metallic: { value: defaultMaterialMetallic, mixed: false, disabled: true },
            roughness: { value: defaultMaterialRoughness, mixed: false, disabled: true },
            emissiveStrength: { value: defaultMaterialEmissiveStrength, mixed: false, disabled: true },
          },
          colorStates: {
            diffuse: { value: [1, 1, 1, 1], mixed: false, disabled: true },
            shade: { value: [1, 1, 1, 1], mixed: false, disabled: true },
            emissive: { value: defaultMaterialEmissive.slice(), mixed: false, disabled: true },
          },
          emissiveSourceState: { value: defaultMaterialEmissiveSource, mixed: false, disabled: true },
          emissiveTextureState: {
            reference: null,
            mixed: false,
            disabled: true,
            previewSource: '',
            description: 'None',
          },
          toonTextureState: {
            reference: null,
            mixed: false,
            disabled: true,
            previewSource: '',
            description: 'None',
          },
          textureRowLabel: t('Toon Texture', 'Toon Texture'),
          jsonEnabled: false,
          pickerState: {
            open: pickerState.open,
            target: pickerState.target,
            title: pickerState.target === 'emissive'
              ? t('Emissive Texture', 'Emissive Texture')
              : pickerState.target === 'shade'
                ? t('Shade Multiply Texture', 'Shade Multiply Texture')
                : t('Toon Texture', 'Toon Texture'),
            selectedKey: getTextureReferenceKey(pickerState.selectedReference),
            groups: [
              { label: t('Active Model', 'Active Model'), items: [] },
              { label: t('Other Models', 'Other Models'), items: [] },
              ...(pickerState.target === 'toon' ? [{ label: t('Default Toon Textures', 'Default Toon Textures'), items: [] }] : []),
            ],
            emptyMessage: pickerState.target === 'emissive'
              ? t('No emissive textures loaded.', 'No emissive textures loaded.')
              : pickerState.target === 'shade'
                ? t('No textures loaded.', 'No textures loaded.')
                : t('No toon textures loaded.', 'No toon textures loaded.'),
            allCandidates: pickerCandidates,
          },
        };
      }

      ensureMaterialArrays(activeInstance);
      const selectedIndices = normalizeMaterialSelection(activeInstance);
      const materials = activeInstance.model?.materials || [];
      const visibleState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.materialVisibility?.[index] !== false);
      const ssssState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.ssssMaterialVisibility?.[index] !== false);
      const receiveShadowState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.model.materials[index]?.receiveShadow !== false);
      const castShadowState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.materialCastShadow?.[index] !== false);
      const noCullState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.model.materials[index]?.noCull === true);
      const hasEdgeState = getAggregatedMaterialToggleState(activeInstance, selectedIndices, (index) => activeInstance.model.materials[index]?.hasEdge === true);
      const metallicState = getAggregatedMaterialNumericState(activeInstance, selectedIndices, (index) => getMaterialNumericValue(activeInstance.model.materials[index], 'metalic', defaultMaterialMetallic), defaultMaterialMetallic, 0, 1);
      const roughnessState = getAggregatedMaterialNumericState(activeInstance, selectedIndices, (index) => getMaterialNumericValue(activeInstance.model.materials[index], 'roughness', defaultMaterialRoughness), defaultMaterialRoughness, 0, 1);
      const emissiveStrengthState = getAggregatedMaterialNumericState(activeInstance, selectedIndices, (index) => getMaterialNumericValue(activeInstance.model.materials[index], 'emissiveStrength', defaultMaterialEmissiveStrength), defaultMaterialEmissiveStrength, 0, Number.POSITIVE_INFINITY);
      const diffuseColorState = getAggregatedMaterialColorState(activeInstance, selectedIndices, (index) => getMaterialColorValue(activeInstance.model.materials[index], 'diffuse', [1, 1, 1, 1]), [1, 1, 1, 1]);
      const shadeColorState = getAggregatedMaterialColorState(activeInstance, selectedIndices, (index) => getMaterialMtoonColorValue(activeInstance.model.materials[index], 'shadeColor', [1, 1, 1, 1]), [1, 1, 1, 1]);
      const emissiveColorState = getAggregatedMaterialColorState(activeInstance, selectedIndices, (index) => getMaterialColorValue(activeInstance.model.materials[index], 'emissive', defaultMaterialEmissive), defaultMaterialEmissive);
      const emissiveSourceState = getAggregatedMaterialSourceState(activeInstance, selectedIndices, (index) => (
        String(activeInstance.model.materials[index]?.emissiveSource || 'color').trim().toLowerCase() === 'texture'
          ? 'texture'
          : 'color'
      ));
      const toonTextureStateRaw = aggregateTextureReferenceState(
        activeInstance,
        selectedIndices,
        (index) => resolveMaterialToonTextureReference(activeInstance.modelPath ?? '', activeInstance.model, activeInstance.model?.materials?.[index] ?? null),
      );
      const emissiveTextureStateRaw = aggregateTextureReferenceState(
        activeInstance,
        selectedIndices,
        (index) => resolveMaterialEmissiveTextureReference(activeInstance.modelPath ?? '', activeInstance.model, activeInstance.model?.materials?.[index] ?? null),
      );
      const shadeTextureStateRaw = aggregateTextureReferenceState(
        activeInstance,
        selectedIndices,
        (index) => resolveMaterialShadeMultiplyTextureReference(activeInstance.modelPath ?? '', activeInstance.model, activeInstance.model?.materials?.[index] ?? null),
      );
      const usesShadeMultiplyTexture = activeInstance.model?.magic === 'Vrm';
      const currentPickerCandidates = pickerState.candidates.length > 0 ? pickerState.candidates : (usesShadeMultiplyTexture || pickerState.target === 'emissive'
        ? collectTextureCandidates(options.getInstances?.() ?? [], options.getActiveInstanceIndex?.() ?? -1).candidates
        : collectToonTextureCandidates(options.getInstances?.() ?? [], options.getActiveInstanceIndex?.() ?? -1).candidates);

      return {
        hasActiveInstance: true,
        emptyMessage: selectedIndices.length === 0 ? t('No materials selected.', 'No materials selected.') : '',
        listItems: materials.map((material, index) => ({
          value: String(index),
          label: material.name || `Material ${index}`,
        })),
        selectedIndices: selectedIndices.slice(),
        shaderOptions: shaderDefinitions.map((definition) => ({
          value: definition.name,
          label: definition.label || definition.name,
        })),
        shaderState: getAggregatedMaterialShaderState(activeInstance, selectedIndices),
        shaderReloadDisabled: getAggregatedMaterialShaderState(activeInstance, selectedIndices).disabled
          || getAggregatedMaterialShaderState(activeInstance, selectedIndices).mixed,
        toggles: {
          visible: visibleState,
          ssss: ssssState,
          receiveShadow: receiveShadowState,
          castShadow: castShadowState,
          noCull: noCullState,
          hasEdge: hasEdgeState,
        },
        numericStates: {
          metallic: metallicState,
          roughness: roughnessState,
          emissiveStrength: emissiveStrengthState,
        },
        colorStates: {
          diffuse: diffuseColorState,
          shade: shadeColorState,
          emissive: emissiveColorState,
        },
        emissiveSourceState,
        emissiveTextureState: {
          ...emissiveTextureStateRaw,
          previewSource: getTexturePreviewSource(emissiveTextureStateRaw.reference, currentPickerCandidates),
          description: getTextureDescription(emissiveTextureStateRaw.reference),
        },
        toonTextureState: {
          ...(usesShadeMultiplyTexture ? shadeTextureStateRaw : toonTextureStateRaw),
          previewSource: getTexturePreviewSource(
            (usesShadeMultiplyTexture ? shadeTextureStateRaw : toonTextureStateRaw).reference,
            currentPickerCandidates,
          ),
          description: getTextureDescription((usesShadeMultiplyTexture ? shadeTextureStateRaw : toonTextureStateRaw).reference),
        },
        textureRowLabel: usesShadeMultiplyTexture
          ? t('Shade Multiply Texture', 'Shade Multiply Texture')
          : t('Toon Texture', 'Toon Texture'),
        jsonEnabled: true,
        pickerState: {
          open: pickerState.open,
          target: pickerState.target,
          title: pickerState.target === 'emissive'
            ? t('Emissive Texture', 'Emissive Texture')
            : pickerState.target === 'shade'
              ? t('Shade Multiply Texture', 'Shade Multiply Texture')
              : t('Toon Texture', 'Toon Texture'),
          selectedKey: getTextureReferenceKey(pickerState.selectedReference),
          groups: [
            {
              label: t('Active Model', 'Active Model'),
              items: (pickerState.activeModelCandidates || []).map((candidate) => ({
                key: getTextureReferenceKey(candidate.textureReference || candidate.toonTexture || null),
                label: candidate.label,
                previewSource: String(candidate.previewUrl || '').trim(),
                candidateIndex: pickerState.candidates.indexOf(candidate),
              })).filter((item) => item.candidateIndex >= 0),
            },
            {
              label: t('Other Models', 'Other Models'),
              items: (pickerState.otherModelCandidates || []).map((candidate) => ({
                key: getTextureReferenceKey(candidate.textureReference || candidate.toonTexture || null),
                label: candidate.label,
                previewSource: String(candidate.previewUrl || '').trim(),
                candidateIndex: pickerState.candidates.indexOf(candidate),
              })).filter((item) => item.candidateIndex >= 0),
            },
            ...(pickerState.target === 'toon'
              ? [{
                label: t('Default Toon Textures', 'Default Toon Textures'),
                items: (pickerState.defaultCandidates || []).map((candidate) => ({
                  key: getTextureReferenceKey(candidate.textureReference || candidate.toonTexture || null),
                  label: candidate.label,
                  previewSource: String(candidate.previewUrl || '').trim(),
                  candidateIndex: pickerState.candidates.indexOf(candidate),
                })).filter((item) => item.candidateIndex >= 0),
              }]
              : []),
          ],
          emptyMessage: pickerState.target === 'emissive'
            ? t('No emissive textures loaded.', 'No emissive textures loaded.')
            : pickerState.target === 'shade'
              ? t('No textures loaded.', 'No textures loaded.')
              : t('No toon textures loaded.', 'No toon textures loaded.'),
        },
      };
    },

    /**
     * Sets the selected material indices.
     * @param {number[]} indices - Selected indices.
     */
    setSelectedMaterialIndices(indices) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return;
      }
      activeInstance.selectedMaterialIndices = Array.isArray(indices) ? indices.slice() : [];
      normalizeMaterialSelection(activeInstance);
      emitStateChanged();
    },

    /**
     * Selects all materials.
     */
    selectAllMaterials() {
      const activeInstance = getActiveInstance();
      if (!activeInstance?.model?.materials?.length) {
        return;
      }
      activeInstance.selectedMaterialIndices = activeInstance.model.materials.map((_, index) => index);
      emitStateChanged();
    },

    /**
     * Clears the current material selection.
     */
    clearMaterialSelection() {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return;
      }
      activeInstance.selectedMaterialIndices = [];
      emitStateChanged();
    },

    /**
     * Applies one shader to the selected materials.
     * @param {string} shaderName - Shader name.
     * @returns {Promise<boolean>} Completion flag.
     */
    async applyShader(shaderName) {
      const activeInstance = getActiveInstance();
      if (!activeInstance || !shaderName || shaderName === '__mixed__') {
        return false;
      }
      const selected = normalizeMaterialSelection(activeInstance);
      if (selected.length === 0) {
        return false;
      }
      await options.modelManager?.updateMaterialShader?.(activeInstance, selected, shaderName);
      emitStateChanged();
      return true;
    },

    /**
     * Reloads one shader.
     * @param {string} shaderName - Shader name.
     * @returns {Promise<boolean>} Completion flag.
     */
    async reloadShader(shaderName) {
      if (!shaderName || shaderName === '__mixed__') {
        return false;
      }
      await options.modelManager?.reloadShader?.(shaderName);
      emitStateChanged();
      return true;
    },

    /**
     * Applies one toggle field.
     * @param {string} field - Toggle field.
     * @param {boolean} value - Toggle value.
     * @returns {number[]} Updated indices.
     */
    applyToggle(field, value) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return [];
      }
      const nextValue = value === true;
      let selected = [];
      if (field === 'visible') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.materialVisibility[index] = nextValue;
        });
      } else if (field === 'ssss') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.ssssMaterialVisibility[index] = nextValue;
        });
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      } else if (field === 'receiveShadow') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].receiveShadow = nextValue;
        });
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      } else if (field === 'castShadow') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.materialCastShadow[index] = nextValue;
        });
      } else if (field === 'noCull') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].noCull = nextValue;
          if (activeInstance.pipelineResources?.materials?.[index]) {
            activeInstance.pipelineResources.materials[index].noCull = nextValue;
          }
        });
      } else if (field === 'hasEdge') {
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].hasEdge = nextValue;
          if (activeInstance.pipelineResources?.materials?.[index]) {
            activeInstance.pipelineResources.materials[index].hasEdge = nextValue;
          }
        });
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      }
      emitStateChanged();
      return selected;
    },

    /**
     * Applies one numeric field.
     * @param {'metallic'|'roughness'|'emissiveStrength'} field - Numeric field.
     * @param {number} value - Numeric value.
     * @returns {number[]} Updated indices.
     */
    applyNumeric(field, value) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return [];
      }
      let selected = [];
      if (field === 'metallic') {
        const nextValue = clampMaterialNumericValue(value, 0, 1, 0);
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].metalic = nextValue;
          const materialState = activeInstance.morphController?.materialStates?.[index];
          if (materialState) {
            materialState.metalic = nextValue;
          }
        });
      } else if (field === 'roughness') {
        const nextValue = clampMaterialNumericValue(value, 0, 1, 1);
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].roughness = nextValue;
          const materialState = activeInstance.morphController?.materialStates?.[index];
          if (materialState) {
            materialState.roughness = nextValue;
          }
        });
      } else if (field === 'emissiveStrength') {
        const nextValue = clampMaterialNumericValue(value, 0, Number.POSITIVE_INFINITY, 0);
        selected = applyToSelectedMaterials(activeInstance, (index) => {
          activeInstance.model.materials[index].emissiveStrength = nextValue;
          const materialState = activeInstance.morphController?.materialStates?.[index];
          if (materialState) {
            materialState.emissiveStrength = nextValue;
          }
        });
      }
      if (selected.length > 0) {
        markMaterialBaseStateDirty(activeInstance);
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      }
      emitStateChanged();
      return selected;
    },

    /**
     * Applies one color field.
     * @param {'diffuse'|'shade'|'emissive'} field - Color field.
     * @param {number[]} value - Color value.
     * @returns {number[]} Updated indices.
     */
    applyColor(field, value) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return [];
      }
      const nextValue = Array.isArray(value) ? value.slice(0, 4) : [0, 0, 0, 1];
      const selected = applyToSelectedMaterials(activeInstance, (index) => {
        const material = activeInstance.model.materials[index];
        const materialState = activeInstance.morphController?.materialStates?.[index];
        if (field === 'diffuse') {
          const diffuse = Array.isArray(material.diffuse) ? material.diffuse : [1, 1, 1, 1];
          diffuse[0] = nextValue[0];
          diffuse[1] = nextValue[1];
          diffuse[2] = nextValue[2];
          diffuse[3] = Number.isFinite(diffuse[3]) ? diffuse[3] : 1.0;
          material.diffuse = diffuse;
          if (materialState) {
            materialState.diffuse = diffuse.slice();
          }
        } else if (field === 'shade') {
          const mtoon = material.mtoon || {};
          material.mtoon = mtoon;
          mtoon.shadeColor = nextValue.slice(0, 3);
          if (materialState) {
            materialState.mtoon = materialState.mtoon || {};
            materialState.mtoon.shadeColor = nextValue.slice(0, 3);
          }
        } else if (field === 'emissive') {
          material.emissive = nextValue.slice(0, 3);
          if (materialState) {
            materialState.emissive = nextValue.slice(0, 3);
          }
        }
      });
      if (selected.length > 0) {
        markMaterialBaseStateDirty(activeInstance);
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      }
      emitStateChanged();
      return selected;
    },

    /**
     * Applies the emissive source.
     * @param {'color'|'texture'} value - Emissive source.
     * @returns {number[]} Updated indices.
     */
    applyEmissiveSource(value) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return [];
      }
      const nextValue = value === 'texture' ? 'texture' : 'color';
      const selected = applyToSelectedMaterials(activeInstance, (index) => {
        activeInstance.model.materials[index].emissiveSource = nextValue;
        const materialState = activeInstance.morphController?.materialStates?.[index];
        if (materialState) {
          materialState.emissiveSource = nextValue;
        }
      });
      if (selected.length > 0) {
        markMaterialBaseStateDirty(activeInstance);
        options.modelManager?.updateMaterialStateBuffers?.(activeInstance, selected);
      }
      emitStateChanged();
      return selected;
    },

    /**
     * Opens the picker for one target.
     * @param {'toon'|'shade'|'emissive'} target - Target.
     * @returns {boolean} Open result.
     */
    openTexturePicker(target = 'toon') {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return false;
      }
      const selectedIndices = normalizeMaterialSelection(activeInstance);
      if (selectedIndices.length === 0) {
        return false;
      }
      const normalizedTarget = target === 'emissive' ? 'emissive' : target === 'shade' ? 'shade' : 'toon';
      const candidates = collectPickerCandidates(normalizedTarget);
      pickerState = {
        open: true,
        target: normalizedTarget,
        selectedReference: resolvePickerSelectedReference(activeInstance, selectedIndices, normalizedTarget),
        candidates: candidates.candidates || [],
        activeModelCandidates: candidates.activeModelCandidates || [],
        otherModelCandidates: candidates.otherModelCandidates || [],
        defaultCandidates: candidates.defaultCandidates || [],
      };
      emitStateChanged();
      return true;
    },

    /**
     * Closes the picker.
     */
    closeTexturePicker() {
      pickerState = {
        open: false,
        target: 'toon',
        selectedReference: null,
        candidates: [],
        activeModelCandidates: [],
        otherModelCandidates: [],
        defaultCandidates: [],
      };
      emitStateChanged();
    },

    /**
     * Applies the current picker selection.
     * @param {{action?: string, candidateIndex?: number}} selection - Selection payload.
     * @returns {Promise<boolean>} Completion flag.
     */
    async applyTexturePickerSelection(selection = {}) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return false;
      }
      const selected = normalizeMaterialSelection(activeInstance);
      if (selected.length === 0) {
        this.closeTexturePicker();
        return false;
      }
      const target = pickerState.target === 'emissive'
        ? 'emissive'
        : pickerState.target === 'shade'
          ? 'shade'
          : 'toon';
      if (selection.action === 'none') {
        if (target === 'emissive') {
          await options.modelManager?.updateMaterialEmissiveTexture?.(activeInstance, selected, { kind: 'none' });
        } else if (target === 'shade') {
          await options.modelManager?.updateMaterialShadeMultiplyTexture?.(activeInstance, selected, { kind: 'none' });
        } else {
          await options.modelManager?.updateMaterialToonTexture?.(activeInstance, selected, { kind: 'none' });
        }
      } else {
        const candidateIndex = Number.parseInt(String(selection.candidateIndex ?? ''), 10);
        const candidate = Number.isInteger(candidateIndex) ? pickerState.candidates[candidateIndex] ?? null : null;
        if (!candidate) {
          return false;
        }
        const reference = candidate.textureReference || candidate.toonTexture;
        if (target === 'emissive') {
          await options.modelManager?.updateMaterialEmissiveTexture?.(activeInstance, selected, reference);
        } else if (target === 'shade') {
          await options.modelManager?.updateMaterialShadeMultiplyTexture?.(activeInstance, selected, reference);
        } else {
          await options.modelManager?.updateMaterialToonTexture?.(activeInstance, selected, candidate.toonTexture);
        }
      }
      this.closeTexturePicker();
      emitStateChanged();
      return true;
    },

    /**
     * Builds the model settings download payload.
     * @returns {{downloadName: string, text: string}|null} Download payload.
     */
    buildModelSettingsDownload() {
      const activeInstance = getActiveInstance();
      if (!activeInstance?.model?.materials?.length) {
        return null;
      }
      const payload = buildModelSettingsJson(activeInstance, {
        shaderDefinitions: options.shaderManager?.getShaderDefinitions?.() || [],
      });
      const modelName = String(payload['model-name'] || 'model').trim() || 'model';
      const safeName = modelName.replace(/[\\/:*?"<>|]+/g, '_');
      return {
        downloadName: `${safeName}.model.json`,
        text: `${JSON.stringify(payload, null, 2)}\n`,
      };
    },
  };
}
