/**
 * Installs the texture panel controller.
 * @param {object} options - Controller options.
 * @returns {{sync: function, dispose: function}} Texture panel controller.
 */
export function installTexturePanelController(options = {}) {
  const documentRef = options.documentRef ?? globalThis.document ?? null;
  const service = options.service;
  const getLangData = options.getLangData ?? (() => ({}));
  const triggerSceneRefresh = options.triggerSceneRefresh ?? (() => {});
  const uiState = {
    grid: null,
    emptyState: null,
    conversionSelect: null,
  };
  const disposers = [];
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
    if (!uiState.grid) {
      uiState.grid = documentRef.getElementById('texture-grid');
      uiState.emptyState = documentRef.getElementById('texture-empty-state');
      uiState.conversionSelect = documentRef.getElementById('texture-conversion-select');
    }
    return uiState.grid ? uiState : null;
  }

  /**
   * Binds one event listener.
   * @param {EventTarget|null|undefined} target - Event target.
   * @param {string} name - Event name.
   * @param {EventListener} listener - Event listener.
   */
  function bind(target, name, listener) {
    target?.addEventListener?.(name, listener);
    if (target?.removeEventListener) {
      disposers.push(() => target.removeEventListener(name, listener));
    }
  }

  /**
   * Syncs the color space select.
   * @param {HTMLSelectElement|null} select - Select element.
   * @param {{value: 'gamma-2.2'|'none', mixed: boolean, disabled: boolean}} state - Color space state.
   */
  function syncColorSpaceSelect(select, state) {
    if (!select || !documentRef) {
      return;
    }
    select.innerHTML = '';
    if (state.mixed) {
      const mixedOption = documentRef.createElement('option');
      mixedOption.value = '__mixed__';
      mixedOption.textContent = t('Mixed', 'Mixed');
      mixedOption.disabled = true;
      mixedOption.selected = true;
      select.appendChild(mixedOption);
    }
    for (const [value, labelKey, fallback] of [
      ['gamma-2.2', 'Gamma 2.2', 'Gamma 2.2'],
      ['none', 'Do Not Convert', 'Do Not Convert'],
    ]) {
      const option = documentRef.createElement('option');
      option.value = value;
      option.textContent = t(labelKey, fallback);
      select.appendChild(option);
    }
    select.disabled = state.disabled;
    select.value = state.disabled
      ? 'gamma-2.2'
      : state.mixed
        ? '__mixed__'
        : state.value;
  }

  /**
   * Ensures event bindings are installed once.
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
    bind(elements.grid, 'click', (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest?.('[data-texture-index]') : null;
      if (!button) {
        return;
      }
      const index = Number.parseInt(button.dataset.textureIndex || '', 10);
      if (!Number.isInteger(index)) {
        return;
      }
      service.toggleTextureSelection(index);
    });
    bind(elements.conversionSelect, 'change', async () => {
      try {
        const applied = await service.applyColorSpace(elements.conversionSelect.value);
        if (applied) {
          sync();
          triggerSceneRefresh();
          return;
        }
      } catch (error) {
        console.error(`Failed to update texture conversion '${elements.conversionSelect.value}'.`, error);
      }
      sync();
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
    elements.grid.innerHTML = '';
    if (elements.emptyState) {
      elements.emptyState.hidden = state.gridItems.length > 0;
      elements.emptyState.textContent = state.emptyMessage;
    }
    for (const item of state.gridItems) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'texture-card';
      button.dataset.textureIndex = String(item.index);
      button.setAttribute('aria-pressed', item.selected ? 'true' : 'false');
      button.title = item.title;
      button.classList.toggle('is-selected', item.selected);

      const preview = documentRef.createElement('div');
      preview.className = 'texture-preview';
      if (item.previewUrl) {
        const img = documentRef.createElement('img');
        img.alt = item.name;
        img.src = item.previewUrl;
        img.loading = 'lazy';
        preview.appendChild(img);
      } else {
        preview.classList.add('texture-preview--placeholder');
        preview.textContent = item.name.slice(0, 2).toUpperCase();
      }

      const name = documentRef.createElement('div');
      name.className = 'texture-name';
      name.textContent = item.name;
      button.append(preview, name);
      elements.grid.appendChild(button);
    }
    syncColorSpaceSelect(elements.conversionSelect, state.colorSpaceState);
  }

  return {
    sync,
    dispose() {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
  };
}
