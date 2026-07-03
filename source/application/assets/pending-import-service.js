/**
 * Creates the pending import service used to stage settings and pose files
 * until a model selection is resolved.
 * @returns {object} Pending import service.
 */
export function createPendingImportService() {
  /** @type {File[]} */
  let pendingSettingsFiles = [];
  /** @type {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} */
  let pendingSettingsZipFiles = null;
  /** @type {File[]} */
  let pendingPoseFiles = [];
  /** @type {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} */
  let pendingPoseZipFiles = null;
  /** @type {function(File[], Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null): Promise<void>} */
  let applySettingsHandler = async () => {};
  /** @type {function(File[], Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null): Promise<void>} */
  let applyPoseHandler = async () => {};

  /**
   * Stores pending settings files.
   * @param {File[]} files - Pending files.
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} [zipFiles=null] - Optional ZIP entries.
   */
  function setPendingSettingsFiles(files, zipFiles = null) {
    pendingSettingsFiles = Array.isArray(files) ? files.slice() : [];
    pendingSettingsZipFiles = zipFiles;
  }

  /**
   * Stores pending pose files.
   * @param {File[]} files - Pending files.
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} [zipFiles=null] - Optional ZIP entries.
   */
  function setPendingPoseFiles(files, zipFiles = null) {
    pendingPoseFiles = Array.isArray(files) ? files.slice() : [];
    pendingPoseZipFiles = zipFiles;
  }

  /**
   * Clears pending settings state.
   */
  function clearPendingSettingsFiles() {
    pendingSettingsFiles = [];
    pendingSettingsZipFiles = null;
  }

  /**
   * Clears pending pose state.
   */
  function clearPendingPoseFiles() {
    pendingPoseFiles = [];
    pendingPoseZipFiles = null;
  }

  /**
   * Clears every pending import.
   */
  function clearAllPendingImports() {
    clearPendingSettingsFiles();
    clearPendingPoseFiles();
  }

  /**
   * Sets the settings apply handler.
   * @param {function(File[], Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null): Promise<void>} handler - Apply handler.
   */
  function setApplySettingsHandler(handler) {
    applySettingsHandler = typeof handler === 'function' ? handler : async () => {};
  }

  /**
   * Sets the pose apply handler.
   * @param {function(File[], Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null): Promise<void>} handler - Apply handler.
   */
  function setApplyPoseHandler(handler) {
    applyPoseHandler = typeof handler === 'function' ? handler : async () => {};
  }

  /**
   * Applies and clears pending settings files.
   * @param {File[]|null} [files=null] - Explicit files override.
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} [zipFiles=null] - Explicit ZIP override.
   * @returns {Promise<void>} Completion promise.
   */
  async function consumePendingSettingsFiles(files = null, zipFiles = null) {
    const nextFiles = Array.isArray(files) ? files : pendingSettingsFiles;
    const nextZipFiles = zipFiles ?? pendingSettingsZipFiles;
    clearPendingSettingsFiles();
    await applySettingsHandler(nextFiles, nextZipFiles);
  }

  /**
   * Applies and clears pending pose files.
   * @param {File[]|null} [files=null] - Explicit files override.
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>|null} [zipFiles=null] - Explicit ZIP override.
   * @returns {Promise<void>} Completion promise.
   */
  async function consumePendingPoseFiles(files = null, zipFiles = null) {
    const nextFiles = Array.isArray(files) ? files : pendingPoseFiles;
    const nextZipFiles = zipFiles ?? pendingPoseZipFiles;
    clearPendingPoseFiles();
    await applyPoseHandler(nextFiles, nextZipFiles);
  }

  return {
    setPendingSettingsFiles,
    setPendingPoseFiles,
    clearPendingSettingsFiles,
    clearPendingPoseFiles,
    clearAllPendingImports,
    setApplySettingsHandler,
    setApplyPoseHandler,
    consumePendingSettingsFiles,
    consumePendingPoseFiles,
  };
}
