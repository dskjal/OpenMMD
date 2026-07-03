/**
 * Creates UI read-model builders for application-facing panels.
 * @param {object} deps - Service dependencies.
 * @param {object} [deps.modelManager] - Model manager.
 * @param {object} [deps.selection] - Selection state.
 * @param {object} [deps.vmdManager] - Animation source manager.
 * @param {function(): object|null} [deps.getActiveInstance] - Active instance resolver.
 * @returns {object} UI read-model service.
 */
export function createUiReadModelService(deps) {
  const {
    modelManager,
    selection,
    vmdManager,
    getActiveInstance,
  } = deps || {};

  /**
   * Resolves names of models referencing the specified animation source.
   * @param {string} sourceKind - Animation source kind.
   * @param {string} sourceName - Animation source name.
   * @returns {string[]} Referencing model names.
   */
  function getAnimationReferenceModelNames(sourceKind, sourceName) {
    if (!sourceName || !Array.isArray(modelManager?.instances)) {
      return [];
    }

    return modelManager.instances.flatMap((instance, index) => {
      const instanceSourceKind = String(instance?.animationSourceKind || instance?.animationSourceType || (instance?.vmdName ? 'vmd' : '')).trim();
      const instanceSourceName = String(instance?.animationSourceName || instance?.vmdName || '').trim();
      if (
        instanceSourceKind === String(sourceKind || '').trim()
        && instanceSourceName === String(sourceName || '').trim()
      ) {
        return [instance?.model?.name || `Model ${index}`];
      }
      return [];
    });
  }

  /**
   * Builds model list UI state.
   * @returns {{activeIndex: number, items: Array<object>}} Model list state.
   */
  function getModelListState() {
    return {
      activeIndex: Number.isInteger(selection?.activeInstanceIndex) ? selection.activeInstanceIndex : -1,
      items: Array.isArray(modelManager?.instances)
        ? modelManager.instances.map((instance, index) => ({
          index,
          name: instance?.model?.name || `Model ${index}`,
          visible: instance?.visible !== false,
        }))
        : [],
    };
  }

  /**
   * Builds animation list entries for the active instance.
   * @param {object|null} activeInstance - Active model instance.
   * @returns {Array<object>} Animation list entries.
   */
  function buildAnimationListEntries(activeInstance) {
    if (typeof vmdManager?.getAnimationListEntries === 'function') {
      return vmdManager.getAnimationListEntries(activeInstance);
    }

    const entries = [];
    for (const name of vmdManager?.vmds?.keys?.() || []) {
      entries.push({
        value: `vmd:model:${name}`,
        label: name,
      });
    }
    for (const name of vmdManager?.vrmas?.keys?.() || []) {
      entries.push({
        value: `vrma:model:${name}`,
        label: `[VRMA] ${name}`,
      });
    }
    for (let index = 0; index < (activeInstance?.gltfAnimationSources || []).length; index += 1) {
      const source = activeInstance.gltfAnimationSources[index];
      entries.push({
        value: `gltf:model:${index}`,
        label: `[glTF] ${source.name}`,
      });
    }
    return entries;
  }

  /**
   * Resolves the currently selected animation list value.
   * @param {object|null} activeInstance - Active model instance.
   * @returns {string} Selected list value.
   */
  function getSelectedAnimationListValue(activeInstance) {
    const activeListValue = String(vmdManager?.selectedListValue || '').trim();
    const activeSourceKind = String(activeInstance?.animationSourceKind || activeInstance?.animationSourceType || '').trim();
    if (!activeInstance) {
      return activeListValue;
    }
    if (activeListValue) {
      return activeListValue;
    }
    if (activeSourceKind === 'vmd' && activeInstance.vmdName) {
      return `vmd:model:${activeInstance.vmdName}`;
    }
    if (activeSourceKind === 'vrma' && activeInstance.animationSourceName) {
      return `vrma:model:${activeInstance.animationSourceName}`;
    }
    if (activeSourceKind === 'gltf') {
      const sourceIndex = (activeInstance.gltfAnimationSources || []).findIndex((source) => source === activeInstance.animationSource);
      return sourceIndex >= 0 ? `gltf:model:${sourceIndex}` : '';
    }
    return activeInstance.vmdName ? `vmd:model:${activeInstance.vmdName}` : activeListValue;
  }

  /**
   * Parses an animation selection value.
   * @param {string} value - Encoded selection value.
   * @returns {{kind: string, targetType: string, name: string, index: number|null}} Parsed selection info.
   */
  function parseAnimationSelectionValue(value) {
    const text = String(value || '').trim();
    if (!text) {
      return { kind: '', targetType: 'model', name: '', index: null };
    }

    const [kind = '', targetType = 'model', ...rest] = text.split(':');
    const name = rest.join(':');
    const index = kind === 'gltf' ? Number.parseInt(name, 10) : null;
    return {
      kind,
      targetType: targetType || 'model',
      name,
      index: Number.isInteger(index) ? index : null,
    };
  }

  /**
   * Builds animation source list UI state.
   * @returns {{entries: Array<object>, selectedValue: string, canDeleteSelected: boolean}} Animation source state.
   */
  function getAnimationSourceListState() {
    const activeInstance = getActiveInstance?.() ?? null;
    const selectedValue = getSelectedAnimationListValue(activeInstance);
    const selectedInfo = parseAnimationSelectionValue(selectedValue);
    const hasAnimation = selectedInfo.kind === 'vmd'
      ? (
        selectedInfo.targetType === 'model'
          ? vmdManager?.vmds?.has?.(selectedInfo.name)
          : Boolean(vmdManager?.getSceneVmdSource?.(selectedInfo.targetType, selectedInfo.name))
      )
      : selectedInfo.kind === 'vrma'
        ? Boolean(vmdManager?.vrmas?.has?.(selectedInfo.name))
        : false;
    return {
      entries: buildAnimationListEntries(activeInstance),
      selectedValue,
      canDeleteSelected: hasAnimation,
    };
  }

  /**
   * Builds model deletion dialog state.
   * @param {number} index - Target model index.
   * @returns {{index: number, details: string[]}} Deletion dialog state.
   */
  function getModelDeletionState(index) {
    const instance = Number.isInteger(index) ? modelManager?.instances?.[index] ?? null : null;
    return {
      index,
      details: [instance?.model?.name || `Model ${index}`],
    };
  }

  /**
   * Builds animation deletion dialog state.
   * @param {object} selectionInfo - Animation selection info.
   * @returns {{selectionInfo: object, references: string[], canDelete: boolean}} Deletion dialog state.
   */
  function getAnimationDeletionState(selectionInfo) {
    const normalizedSelectionInfo = {
      kind: String(selectionInfo?.kind || '').trim(),
      targetType: String(selectionInfo?.targetType || 'model').trim() || 'model',
      name: String(selectionInfo?.name || '').trim(),
      index: Number.isInteger(selectionInfo?.index) ? selectionInfo.index : null,
    };
    const references = normalizedSelectionInfo.targetType === 'model'
      ? getAnimationReferenceModelNames(normalizedSelectionInfo.kind, normalizedSelectionInfo.name)
      : [];
    return {
      selectionInfo: normalizedSelectionInfo,
      references,
      canDelete: references.length <= 1,
    };
  }

  /**
   * Builds the active animation export state.
   * @returns {object|null} Export state.
   */
  function getActiveAnimationExportState() {
    const activeInstance = getActiveInstance?.() ?? null;
    if (!activeInstance) {
      return null;
    }

    return {
      activeInstance,
      exportMode: activeInstance.animationSourceType === 'gltf' && activeInstance.model?.magic !== 'Vrm'
        ? 'direct'
        : 'dialog',
      defaultFormat: activeInstance.model?.magic === 'Vrm' ? 'vrma' : 'vmd',
      defaultBakeIkToRotation: true,
      defaultBakeLowerBodyToHumanoid: true,
    };
  }

  return {
    getModelListState,
    getAnimationSourceListState,
    getModelDeletionState,
    getAnimationDeletionState,
    getActiveAnimationExportState,
    parseAnimationSelectionValue,
  };
}
