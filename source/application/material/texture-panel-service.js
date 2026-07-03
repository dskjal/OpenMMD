const TEXTURE_COLOR_SPACE_GAMMA_22 = 'gamma-2.2';
const TEXTURE_COLOR_SPACE_NONE = 'none';

/**
 * Creates the texture panel service.
 * @param {object} options - Service options.
 * @returns {object} Texture panel service.
 */
export function createTexturePanelService(options = {}) {
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
   * Returns localized text.
   * @param {string} key - Translation key.
   * @param {string} fallback - Fallback text.
   * @returns {string} Localized text.
   */
  function t(key, fallback) {
    return options.getLangData?.()?.[key] || fallback || key;
  }

  /**
   * Normalizes selected texture indices.
   * @param {object|null} activeInstance - Active instance.
   * @returns {number[]} Selected indices.
   */
  function normalizeTextureSelection(activeInstance) {
    if (!activeInstance?.model?.textures?.length) {
      if (activeInstance) {
        activeInstance.selectedTextureIndices = [];
      }
      return [];
    }
    if (!Array.isArray(activeInstance.selectedTextureIndices)) {
      activeInstance.selectedTextureIndices = [0];
    }

    const normalized = [];
    const seen = new Set();
    for (const value of activeInstance.selectedTextureIndices) {
      const index = Number.parseInt(String(value), 10);
      if (!Number.isInteger(index) || index < 0 || index >= activeInstance.model.textures.length || seen.has(index)) {
        continue;
      }
      seen.add(index);
      normalized.push(index);
    }

    if (normalized.length !== activeInstance.selectedTextureIndices.length) {
      activeInstance.selectedTextureIndices = normalized;
    }
    return activeInstance.selectedTextureIndices;
  }

  /**
   * Normalizes one texture color space.
   * @param {string|undefined|null} value - Input value.
   * @returns {'gamma-2.2'|'none'} Normalized value.
   */
  function normalizeTextureColorSpace(value) {
    return String(value || TEXTURE_COLOR_SPACE_GAMMA_22).toLowerCase() === TEXTURE_COLOR_SPACE_NONE
      ? TEXTURE_COLOR_SPACE_NONE
      : TEXTURE_COLOR_SPACE_GAMMA_22;
  }

  /**
   * Returns one texture display name.
   * @param {string|undefined|null} texturePath - Texture path.
   * @param {number} index - Texture index.
   * @returns {string} Texture label.
   */
  function getTextureDisplayName(texturePath, index) {
    const normalized = String(texturePath || '').replace(/\\/g, '/').trim();
    if (!normalized) {
      return `Texture ${index}`;
    }
    const name = normalized.split('/').pop() || normalized;
    return name || `Texture ${index}`;
  }

  /**
   * Ensures texture color spaces exist for one instance.
   * @param {object} activeInstance - Active instance.
   */
  function ensureTextureColorSpaces(activeInstance) {
    const textureCount = activeInstance.model?.textures?.length || 0;
    if (!Array.isArray(activeInstance.model.textureColorSpaces)) {
      activeInstance.model.textureColorSpaces = Array.from({ length: textureCount }, () => TEXTURE_COLOR_SPACE_GAMMA_22);
    } else {
      while (activeInstance.model.textureColorSpaces.length < textureCount) {
        activeInstance.model.textureColorSpaces.push(TEXTURE_COLOR_SPACE_GAMMA_22);
      }
    }
  }

  /**
   * Aggregates color space state.
   * @param {object|null} activeInstance - Active instance.
   * @param {number[]} selectedIndices - Selected indices.
   * @returns {{value: 'gamma-2.2'|'none', mixed: boolean, disabled: boolean}} Aggregated state.
   */
  function getAggregatedTextureColorSpaceState(activeInstance, selectedIndices) {
    if (!activeInstance || selectedIndices.length === 0) {
      return { value: TEXTURE_COLOR_SPACE_GAMMA_22, mixed: false, disabled: true };
    }
    const textureColorSpaces = activeInstance.model?.textureColorSpaces || [];
    const firstValue = normalizeTextureColorSpace(textureColorSpaces[selectedIndices[0]]);
    for (let index = 1; index < selectedIndices.length; index += 1) {
      if (normalizeTextureColorSpace(textureColorSpaces[selectedIndices[index]]) !== firstValue) {
        return { value: firstValue, mixed: true, disabled: false };
      }
    }
    return { value: firstValue, mixed: false, disabled: false };
  }

  return {
    normalizeTextureSelection,
    normalizeTextureColorSpace,

    /**
     * Returns the current panel state.
     * @returns {object} Panel state.
     */
    getPanelState() {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return {
          hasActiveInstance: false,
          emptyMessage: t('No model loaded.', 'No model loaded.'),
          gridItems: [],
          colorSpaceState: { value: TEXTURE_COLOR_SPACE_GAMMA_22, mixed: false, disabled: true },
        };
      }

      ensureTextureColorSpaces(activeInstance);
      const selectedIndices = normalizeTextureSelection(activeInstance);
      const selectedSet = new Set(selectedIndices);
      const textureResources = activeInstance.pipelineResources?.textureResources || [];
      const texturePaths = activeInstance.model?.textures || [];
      const hasTextures = texturePaths.length > 0;

      return {
        hasActiveInstance: true,
        emptyMessage: hasTextures ? '' : t('No textures loaded.', 'No textures loaded.'),
        gridItems: texturePaths.map((texturePath, index) => {
          const textureResource = textureResources[index] || null;
          return {
            index,
            title: texturePath || `Texture ${index}`,
            name: getTextureDisplayName(texturePath, index),
            previewUrl: textureResource?.previewUrl || '',
            selected: selectedSet.has(index),
          };
        }),
        colorSpaceState: getAggregatedTextureColorSpaceState(activeInstance, selectedIndices),
      };
    },

    /**
     * Toggles one texture selection.
     * @param {number} index - Texture index.
     */
    toggleTextureSelection(index) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return;
      }
      const selected = Array.isArray(activeInstance.selectedTextureIndices)
        ? activeInstance.selectedTextureIndices.slice()
        : [];
      const existingIndex = selected.indexOf(index);
      if (existingIndex >= 0) {
        selected.splice(existingIndex, 1);
      } else {
        selected.push(index);
      }
      activeInstance.selectedTextureIndices = selected;
      normalizeTextureSelection(activeInstance);
      emitStateChanged();
    },

    /**
     * Sets selected texture indices.
     * @param {number[]} indices - Selected indices.
     */
    setSelectedTextureIndices(indices) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return;
      }
      activeInstance.selectedTextureIndices = Array.isArray(indices) ? indices.slice() : [];
      normalizeTextureSelection(activeInstance);
      emitStateChanged();
    },

    /**
     * Applies one texture color space.
     * @param {'gamma-2.2'|'none'} value - Color space.
     * @returns {Promise<boolean>} Completion flag.
     */
    async applyColorSpace(value) {
      const activeInstance = getActiveInstance();
      if (!activeInstance) {
        return false;
      }
      ensureTextureColorSpaces(activeInstance);
      const selected = normalizeTextureSelection(activeInstance);
      if (selected.length === 0) {
        return false;
      }
      const nextValue = normalizeTextureColorSpace(value);
      await options.modelManager?.updateTextureColorSpaces?.(activeInstance, selected, nextValue);
      emitStateChanged();
      return true;
    },
  };
}
