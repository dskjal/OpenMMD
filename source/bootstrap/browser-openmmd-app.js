import { createApiBridge } from '../application/integration/api-bridge.js';
import { createDroppedInputService } from '../application/assets/dropped-input-service.js';
import { bootstrapOpenMmdApp } from './openmmd-app.js';
import { collectDroppedFiles, isFileDrag, loadZipArchive } from '../infrastructure/io/file-loading.js';
import { setupAnimationMappingTab } from '../core/animation/animation-mapper.js';
import { syncViewportLayout } from '../ui/viewport-layout.js';
import { parseUiSettingsJsonText } from '../infrastructure/config/ui-settings-loader.js';

function installFullscreenControls(options) {
  const documentObject = options.documentObject ?? globalThis.document;
  const fullscreenButton = options.fullscreenButton ?? null;
  const getLangData = typeof options.getLangData === 'function' ? options.getLangData : () => ({});
  let fallbackFullscreen = false;
  let lastTouchTapTime = 0;
  let lastTouchTapX = 0;
  let lastTouchTapY = 0;

  /**
   * 指定キーのローカライズ文字列を返します。
   * @param {string} key - 翻訳キー。
   * @param {string} fallback - 既定値。
   * @returns {string} ローカライズ済み文字列。
   */
  function t(key, fallback) {
    const langData = getLangData();
    return langData?.[key] || fallback || key;
  }

  function isAppFullscreen() {
    return Boolean(documentObject?.fullscreenElement) || fallbackFullscreen;
  }

  function syncFullscreenButton() {
    if (!fullscreenButton) {
      return;
    }
    const isFullscreen = isAppFullscreen();
    fullscreenButton.textContent = isFullscreen
      ? t('Exit Fullscreen', 'Exit Fullscreen')
      : t('Fullscreen', 'Fullscreen');
    fullscreenButton.setAttribute('aria-pressed', String(isFullscreen));
  }

  function syncFullscreenLayout() {
    syncViewportLayout({ isFullscreen: isAppFullscreen() });
    syncFullscreenButton();
  }

  async function enterAppFullscreen() {
    if (isAppFullscreen()) {
      return;
    }
    if (documentObject?.documentElement?.requestFullscreen) {
      try {
        await documentObject.documentElement.requestFullscreen();
        return;
      } catch (error) {
        console.warn('Fullscreen request failed, falling back to layout-only fullscreen.', error);
      }
    }
    fallbackFullscreen = true;
    syncFullscreenLayout();
  }

  async function exitAppFullscreen() {
    if (documentObject?.fullscreenElement) {
      await documentObject.exitFullscreen();
      return;
    }
    if (!fallbackFullscreen) {
      return;
    }
    fallbackFullscreen = false;
    syncFullscreenLayout();
  }

  function handleFullscreenChange() {
    fallbackFullscreen = false;
    syncFullscreenLayout();
  }

  function handleLanguageChange() {
    syncFullscreenButton();
  }

  function handleDoubleClick(event) {
    if (!isAppFullscreen()) {
      return;
    }
    event.preventDefault();
    void exitAppFullscreen();
  }

  function handlePointerUp(event) {
    if (event.pointerType !== 'touch' || !event.isPrimary || !isAppFullscreen()) {
      return;
    }

    const now = performance.now();
    const elapsed = now - lastTouchTapTime;
    const dx = Math.abs(event.clientX - lastTouchTapX);
    const dy = Math.abs(event.clientY - lastTouchTapY);
    lastTouchTapTime = now;
    lastTouchTapX = event.clientX;
    lastTouchTapY = event.clientY;

    if (elapsed > 0 && elapsed <= 320 && dx <= 24 && dy <= 24) {
      event.preventDefault();
      void exitAppFullscreen();
    }
  }

  documentObject?.addEventListener('fullscreenchange', handleFullscreenChange);
  documentObject?.addEventListener('dblclick', handleDoubleClick);
  documentObject?.addEventListener('pointerup', handlePointerUp);
  documentObject?.addEventListener('openmmd-languagechange', handleLanguageChange);
  fullscreenButton?.addEventListener('click', enterAppFullscreen);
  syncFullscreenLayout();

  return {
    enterAppFullscreen,
    exitAppFullscreen,
    dispose() {
      documentObject?.removeEventListener('fullscreenchange', handleFullscreenChange);
      documentObject?.removeEventListener('dblclick', handleDoubleClick);
      documentObject?.removeEventListener('pointerup', handlePointerUp);
      documentObject?.removeEventListener('openmmd-languagechange', handleLanguageChange);
      fullscreenButton?.removeEventListener('click', enterAppFullscreen);
    },
  };
}

function installSidebarResizeControls(options) {
  const { resizer, sidebarResizer, leftSidebar, rightSidebar } = options;
  let isResizing = false;
  let activePointerId = null;
  let activeResizer = null;
  let activeTarget = null;
  let startX = 0;
  let startWidth = 0;
  let resizeDirection = 1;

  function resize(event) {
    if (!isResizing || !activeTarget) {
      return;
    }
    const newWidth = Math.min(1500, Math.max(10, startWidth + ((event.pageX - startX) * resizeDirection)));
    activeTarget.style.width = `${newWidth}px`;
  }

  function stopResize(event) {
    if (event && activePointerId !== null && event.pointerId !== activePointerId) {
      return;
    }
    isResizing = false;
    if (event && activeResizer && activeResizer.hasPointerCapture(event.pointerId)) {
      activeResizer.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    if (activeResizer) {
      activeResizer.removeEventListener('pointermove', resize);
      activeResizer.removeEventListener('pointerup', stopResize);
      activeResizer.removeEventListener('pointercancel', stopResize);
    }
    activeResizer = null;
    activeTarget = null;
  }

  function startResize(event, handle, target, direction) {
    if (event.button !== 0 && event.pointerType === 'mouse') {
      return;
    }
    event.preventDefault();
    isResizing = true;
    activePointerId = event.pointerId;
    activeResizer = handle;
    activeTarget = target;
    startX = event.pageX;
    startWidth = target.offsetWidth;
    resizeDirection = direction;
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', resize);
    handle.addEventListener('pointerup', stopResize);
    handle.addEventListener('pointercancel', stopResize);
  }

  function handleLeftPointerDown(event) {
    startResize(event, resizer, leftSidebar, 1);
  }

  function handleRightPointerDown(event) {
    startResize(event, sidebarResizer, rightSidebar, -1);
  }

  resizer?.addEventListener('pointerdown', handleLeftPointerDown);
  sidebarResizer?.addEventListener('pointerdown', handleRightPointerDown);

  return {
    dispose() {
      stopResize();
      resizer?.removeEventListener('pointerdown', handleLeftPointerDown);
      sidebarResizer?.removeEventListener('pointerdown', handleRightPointerDown);
    },
  };
}

function installTabSwitching(documentObject) {
  const buttons = Array.from(documentObject?.querySelectorAll?.('[data-tab-target]') || []);
  const handlers = new Map();

  function switchTab(event, tabName) {
    const tabcontent = documentObject.getElementsByClassName('tab-content');
    for (let index = 0; index < tabcontent.length; index += 1) {
      tabcontent[index].style.display = 'none';
    }
    const tablinks = documentObject.getElementsByClassName('tab-button');
    for (let index = 0; index < tablinks.length; index += 1) {
      tablinks[index].className = tablinks[index].className.replace(' active', '');
    }
    documentObject.getElementById(tabName).style.display = 'block';
    event.currentTarget.className += ' active';
  }

  for (const button of buttons) {
    const handler = (event) => {
      switchTab(event, button.dataset.tabTarget || '');
    };
    handlers.set(button, handler);
    button.addEventListener('click', handler);
  }

  return {
    dispose() {
      for (const [button, handler] of handlers.entries()) {
        button.removeEventListener('click', handler);
      }
    },
  };
}

/**
 * Resolves the browser API base URL.
 * @param {Document|null} documentObject - Document object.
 * @returns {string} Absolute URL for the local API health endpoint.
 */
function resolveBrowserApiHealthUrl(documentObject) {
  const baseUrl = documentObject?.baseURI
    ?? globalThis.window?.location?.href
    ?? (globalThis.location?.origin ? `${globalThis.location.origin}/` : '')
    ?? '';

  if (!baseUrl) {
    return './api/health';
  }

  return new URL('./api/health', baseUrl).href;
}

/**
 * Detects whether the local API server is available.
 * @param {Document|null} documentObject - Document object.
 * @returns {Promise<boolean>} True when the local API server responds.
 */
async function detectLocalApiServer(documentObject) {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return false;
  }

  try {
    const response = await fetchImpl(resolveBrowserApiHealthUrl(documentObject), {
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Bootstraps the browser-facing OpenMMD shell.
 * @param {object} [options={}] - Bootstrap options.
 * @returns {Promise<{app: object, dispose: function}>} Browser app controls.
 */
export async function bootstrapBrowserOpenMmdApp(options = {}) {
  const documentObject = options.documentObject ?? globalThis.document;
  let app = null;
  const transport = options.transport === 'server' || options.transport === 'none'
    ? options.transport
    : await detectLocalApiServer(documentObject)
      ? 'server'
      : 'none';
  const fullscreenControls = installFullscreenControls({
    documentObject,
    fullscreenButton: documentObject.getElementById('fullscreen-button'),
    getLangData: () => app?.appContext?.getLangData?.() ?? {},
  });
  const resizeControls = installSidebarResizeControls({
    resizer: documentObject.getElementById('resizer'),
    sidebarResizer: documentObject.getElementById('sidebar-resizer'),
    leftSidebar: documentObject.getElementById('left-sidebar'),
    rightSidebar: documentObject.getElementById('sidebar'),
  });
  app = await bootstrapOpenMmdApp({
    enterAppFullscreen: fullscreenControls.enterAppFullscreen,
    exitAppFullscreen: fullscreenControls.exitAppFullscreen,
  });
  const { appContext, appFacade, pendingImportService } = app;
  const ports = appContext?.ports ?? {};
  const viewerPort = ports.viewer ?? {};

  function isShaderNameUsedByAnyModel(shaderName) {
    const targetName = String(shaderName || '').trim();
    if (!targetName || !viewerPort.modelManager?.instances) {
      return false;
    }

    return viewerPort.modelManager.instances.some((instance) => Array.isArray(instance?.model?.materials)
      && instance.model.materials.some((material) => material?.shaderName === targetName));
  }

  let droppedInputService = null;
  droppedInputService = createDroppedInputService({
    loadModelFile: async (file) => {
      await appFacade.assets.loadModelFile?.(file);
    },
    loadZipModel: async (zipFiles) => {
      await appFacade.assets.loadZipModel?.(zipFiles);
    },
    loadVmd: async (file) => {
      await appFacade.assets.loadVmd?.(file);
    },
    loadVpd: async (file) => {
      await appFacade.assets.loadVpd?.(file);
    },
    loadEnvironmentHdrFile: async (file) => {
      await appFacade.assets.loadEnvironmentHdrFile?.(file);
    },
    setEnvironmentHdrCandidateFiles: async (files) => {
      await appFacade.assets.setEnvironmentHdrCandidateFiles?.(files);
    },
    setModelCandidateFiles: async (files) => {
      await appFacade.assets.setModelCandidateFiles?.(files);
    },
    setPendingSettingsFiles: pendingImportService.setPendingSettingsFiles,
    setPendingPoseFiles: pendingImportService.setPendingPoseFiles,
    applySettingsFiles: async (files, zipFiles = null) => {
      for (const file of Array.isArray(files) ? files : []) {
        try {
          await droppedInputService.processSettingsFile(file, zipFiles);
        } catch (error) {
          console.warn(`Failed to load settings JSON: ${file?.name || 'unknown'}`, error);
        }
      }
    },
    loadModelSettingsFile: async (file, innerOptions) => {
      await appFacade.assets.loadModelSettingsFile?.(file, innerOptions);
    },
    loadUiSettingsFile: async (file) => appFacade.assets.loadUiSettingsFile?.(file),
    parseUiSettingsJsonText,
    syncMaterialTabUi: () => {
      appFacade.system.syncMaterialTabUi?.();
    },
    refreshScene: () => {
      appFacade.system.refreshScene?.();
    },
    isShaderNameUsedByAnyModel,
  });

  pendingImportService.setApplySettingsHandler(async (files, zipFiles = null) => {
    for (const file of Array.isArray(files) ? files : []) {
      try {
        await droppedInputService.processSettingsFile(file, zipFiles);
      } catch (error) {
        console.warn(`Failed to load settings JSON: ${file?.name || 'unknown'}`, error);
      }
    }
  });
  pendingImportService.setApplyPoseHandler(async (files, zipFiles = null) => {
    for (const file of Array.isArray(files) ? files : []) {
      await droppedInputService.handleFile(file, zipFiles);
    }
  });

  const fileInput = documentObject.getElementById('file-input');
  const dropZone = documentObject.getElementById('drop-zone');
  const globalDropZone = documentObject.getElementById('global-drop-zone');
  let dragCounter = 0;

  function handleDropZoneClick() {
    fileInput.value = '';
    fileInput.click();
  }

  async function handleFileInputChange(event) {
    try {
      await droppedInputService.processFileBatch(Array.from(event.target.files || []));
    } finally {
      event.target.value = '';
    }
  }

  function handleDragEnter(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragCounter += 1;
    if (globalDropZone) {
      globalDropZone.style.display = 'flex';
    }
    if (dropZone) {
      dropZone.style.visibility = 'hidden';
    }
  }

  function handleDragOver(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    if (globalDropZone) {
      globalDropZone.style.display = 'flex';
    }
  }

  function handleDragLeave(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragCounter -= 1;
    if (dragCounter === 0) {
      if (globalDropZone) {
        globalDropZone.style.display = 'none';
      }
      if (dropZone) {
        dropZone.style.visibility = 'visible';
      }
    }
  }

  async function handleDrop(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragCounter = 0;
    if (globalDropZone) {
      globalDropZone.style.display = 'none';
    }
    if (dropZone) {
      dropZone.style.visibility = 'visible';
    }
    const dropped = await collectDroppedFiles(event.dataTransfer);
    await droppedInputService.processDroppedData(dropped);
  }

  function rebuildPhysics() {
    appFacade.system.resetPhysics?.();
  }

  dropZone?.addEventListener('click', handleDropZoneClick);
  fileInput?.addEventListener('change', handleFileInputChange);
  documentObject.addEventListener('dragenter', handleDragEnter);
  documentObject.addEventListener('dragover', handleDragOver);
  documentObject.addEventListener('dragleave', handleDragLeave);
  documentObject.addEventListener('drop', handleDrop);
  documentObject.getElementById('reset-rigidbody')?.addEventListener('click', rebuildPhysics);

  const apiBridge = transport === 'server'
    ? createApiBridge({
      appContext: () => appContext,
      appFacade: () => appFacade,
      ports: () => ports,
      loadZipArchive,
      transport: 'server',
    }).install()
    : null;
  const tabControls = installTabSwitching(documentObject);

  const animationMappingController = setupAnimationMappingTab({
    getModelManager: () => viewerPort.modelManager || null,
    getSelection: () => viewerPort.selection || null,
    refreshScene: () => appFacade.system.refreshScene?.(),
    getLangData: () => app?.appContext?.getLangData?.() ?? {},
  });
  app.registerAnimationMappingController(animationMappingController);

  return {
    app,
    dispose() {
      apiBridge.dispose?.();
      tabControls.dispose();
      resizeControls.dispose();
      fullscreenControls.dispose();
      dropZone?.removeEventListener('click', handleDropZoneClick);
      fileInput?.removeEventListener('change', handleFileInputChange);
      documentObject.removeEventListener('dragenter', handleDragEnter);
      documentObject.removeEventListener('dragover', handleDragOver);
      documentObject.removeEventListener('dragleave', handleDragLeave);
      documentObject.removeEventListener('drop', handleDrop);
      documentObject.getElementById('reset-rigidbody')?.removeEventListener('click', rebuildPhysics);
    },
  };
}
