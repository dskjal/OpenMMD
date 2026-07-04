import {
  exportAnimationDataAsVmdBuffer,
  exportRuntimeAnimationAsVrma,
  formatAnimationExportWarnings,
  createVmdAnimationSource,
  loadAnimationSourceFromFile,
  loadAnimationSourcesFromZip,
  splitVmdDocumentIntoAnimationSources,
} from '../../application/animation/runtime-animation.js';
import * as JSZipModule from '../../lib/jszip.js';

/**
 * animation source を管理します。
 */
export class AnimationSourceManager {
  constructor() {
    this.sources = new Map();
    this.vmds = new Map();
    this.vrmas = new Map();
    this.sceneVmds = {
      camera: new Map(),
      light: new Map(),
      shadow: new Map(),
    };
    this.selectedListValue = '';
  }

  /**
   * source kind と name から一意キーを生成します。
   * @param {string} kind - source kind。
   * @param {string} name - source 名。
   * @returns {string} source key。
   */
  createSourceKey(kind, name, targetType = 'model') {
    return `${String(kind || '').trim()}:${String(targetType || 'model').trim()}:${String(name || '').trim()}`;
  }

  /**
   * animation source を登録します。
   * @param {object|null} source - animation source。
   * @returns {object|null} 登録済み source。
   */
  registerAnimationSource(source) {
    if (!source?.kind || !source?.name) {
      return null;
    }

    const kind = String(source.kind || '').trim();
    const name = String(source.name || '').trim();
    const targetType = String(source.targetType || 'model').trim() || 'model';
    const key = this.createSourceKey(kind, name, targetType);
    this.sources.set(key, source);
    if (kind === 'vmd') {
      if (targetType === 'camera' || targetType === 'light' || targetType === 'shadow') {
        this.sceneVmds[targetType].set(name, source);
      } else {
        this.vmds.set(name, source.data || null);
      }
    } else if (kind === 'vrma') {
      this.vrmas.set(name, source);
    }
    return source;
  }

  /**
   * 指定 kind/name の source を返します。
   * @param {string} kind - source kind。
   * @param {string} name - source 名。
   * @returns {object|null} animation source。
   */
  getAnimationSource(kind, name, targetType = 'model') {
    const normalizedKind = String(kind || '').trim();
    const normalizedName = String(name || '').trim();
    const normalizedTargetType = String(targetType || 'model').trim() || 'model';
    if (!normalizedKind || !normalizedName) {
      return null;
    }

    const registered = this.sources.get(this.createSourceKey(normalizedKind, normalizedName, normalizedTargetType)) || null;
    if (registered) {
      return registered;
    }
    if (normalizedKind === 'vmd') {
      if (normalizedTargetType === 'camera' || normalizedTargetType === 'light' || normalizedTargetType === 'shadow') {
        return this.sceneVmds[normalizedTargetType].get(normalizedName) || null;
      }
      const data = this.vmds.get(normalizedName) || null;
      return data ? createVmdAnimationSource(normalizedName, data, data.animationClip || null, {
        targetType: normalizedTargetType,
      }) : null;
    }
    if (normalizedKind === 'vrma') {
      return this.vrmas.get(normalizedName) || null;
    }
    return null;
  }

  /**
   * 指定 kind/name の source を削除します。
   * @param {string} kind - source kind。
   * @param {string} name - source 名。
   * @returns {boolean} 削除できた場合は true。
   */
  removeAnimationSource(kind, name, targetType = 'model') {
    const normalizedKind = String(kind || '').trim();
    const normalizedName = String(name || '').trim();
    const normalizedTargetType = String(targetType || 'model').trim() || 'model';
    if (!normalizedKind || !normalizedName) {
      return false;
    }

    this.sources.delete(this.createSourceKey(normalizedKind, normalizedName, normalizedTargetType));
    if (normalizedKind === 'vrma') {
      return this.vrmas.delete(normalizedName);
    }
    if (normalizedTargetType === 'camera' || normalizedTargetType === 'light' || normalizedTargetType === 'shadow') {
      return this.sceneVmds[normalizedTargetType].delete(normalizedName);
    }
    return this.vmds.delete(normalizedName);
  }

  /**
   * File から animation source を読み込みます。
   * @param {File} file - 入力ファイル。
   * @returns {Promise<object|object[]>} 読み込んだ source または source 群。
   */
  async loadAnimationSource(file) {
    const source = await loadAnimationSourceFromFile(file);
    if (source.kind === 'vmd') {
      const splitSources = splitVmdDocumentIntoAnimationSources(source.name, source.data || null);
      splitSources.forEach((entry) => this.registerAnimationSource(entry));
      return splitSources;
    }
    this.registerAnimationSource(source);
    return source;
  }

  /**
   * Loads a VMD file from a File object.
   * @param {File} file
   * @returns {Promise<object>} The parsed VMD data.
   */
  async loadVmd(file) {
    return this.loadAnimationSource(file);
  }

  /**
   * VRMA ファイルを読み込みます。
   * @param {File} file - 入力ファイル。
   * @returns {Promise<object>} 読み込んだ VRMA source。
   */
  async loadVrma(file) {
    const source = await loadAnimationSourceFromFile(file);
    this.registerAnimationSource(source);
    return source;
  }

  /**
   * ZIP から animation source 群を読み込みます。
   * @param {object} zipFiles - ZIP 内ファイル一覧。
   * @returns {Promise<Array<object>>} 読み込み結果。
   */
  async loadFromZip(zipFiles) {
    const loadedAnimations = [];
    const sources = await loadAnimationSourcesFromZip(zipFiles);
    for (const source of sources) {
      if (source.kind === 'vmd') {
        const splitSources = splitVmdDocumentIntoAnimationSources(source.name, source.data || null);
        splitSources.forEach((entry) => this.registerAnimationSource(entry));
        loadedAnimations.push(...splitSources);
        continue;
      }
      this.registerAnimationSource(source);
      loadedAnimations.push(source);
    }
    return loadedAnimations;
  }

  /**
   * 指定した VMD を削除します。
   * @param {string} name - VMD 名。
   * @returns {boolean} 削除できた場合は true。
   */
  removeVmd(name) {
    return this.removeAnimationSource('vmd', name);
  }

  /**
   * 指定した VRMA を削除します。
   * @param {string} name - VRMA 名。
   * @returns {boolean} 削除できた場合は true。
   */
  removeVrma(name) {
    return this.removeAnimationSource('vrma', name);
  }

  /**
   * 指定形式の animation source を削除します。
   * @param {string} kind - source kind。
   * @param {string} name - source 名。
   * @returns {boolean} 削除できた場合は true。
   */
  removeAnimation(kind, name, targetType = 'model') {
    return this.removeAnimationSource(kind, name, targetType);
  }

  /**
   * 指定形式の animation source を返します。
   * @param {string} kind - source kind。
   * @param {string} name - source 名。
   * @returns {object|null} animation source。
   */
  getAnimation(kind, name, targetType = 'model') {
    const source = this.getAnimationSource(kind, name, targetType);
    return kind === 'vmd' ? (source?.data || null) : source;
  }

  /**
   * scene VMD source を返します。
   * @param {'camera'|'light'|'shadow'} targetType - scene target type。
   * @param {string} name - source 名。
   * @returns {object|null}
   */
  getSceneVmdSource(targetType, name) {
    const normalizedTargetType = String(targetType || '').trim();
    if (normalizedTargetType !== 'camera' && normalizedTargetType !== 'light' && normalizedTargetType !== 'shadow') {
      return null;
    }
    return this.sceneVmds[normalizedTargetType].get(String(name || '').trim()) || null;
  }

  /**
   * 一覧表示用の animation entries を返します。
   * @param {object|null} activeInstance - アクティブモデルインスタンス。
   * @returns {Array<object>}
   */
  getAnimationListEntries(activeInstance = null) {
    const entries = [];
    for (const name of this.vmds.keys()) {
      entries.push({
        value: `vmd:model:${name}`,
        label: name,
        kind: 'vmd',
        targetType: 'model',
        name,
      });
    }
    for (const targetType of ['camera', 'light', 'shadow']) {
      for (const name of this.sceneVmds[targetType].keys()) {
        entries.push({
          value: `vmd:${targetType}:${name}`,
          label: `[${targetType[0].toUpperCase()}${targetType.slice(1)}] ${name}`,
          kind: 'vmd',
          targetType,
          name,
        });
      }
    }
    for (const name of this.vrmas.keys()) {
      entries.push({
        value: `vrma:model:${name}`,
        label: `[VRMA] ${name}`,
        kind: 'vrma',
        targetType: 'model',
        name,
      });
    }
    for (let index = 0; index < (activeInstance?.gltfAnimationSources || []).length; index++) {
      const source = activeInstance.gltfAnimationSources[index];
      entries.push({
        value: `gltf:model:${index}`,
        label: `[glTF] ${source.name}`,
        kind: 'gltf',
        targetType: 'model',
        index,
        name: source.name,
      });
    }
    return entries;
  }

  /**
   * Exports the loaded VMDs. If there's only one, returns it as a Blob.
   * If there are multiple, returns them in a ZIP Blob.
   * @returns {Promise<Blob|null>}
   */
  async exportVmds() {
    const exportEntries = [];
    for (const [name, data] of this.vmds.entries()) {
      exportEntries.push({ name, data });
    }
    for (const targetType of ['camera', 'light', 'shadow']) {
      for (const [name, source] of this.sceneVmds[targetType].entries()) {
        exportEntries.push({
          name,
          data: source?.data || null,
        });
      }
    }
    if (exportEntries.length === 0) return null;

    const warningResults = [];

    if (exportEntries.length === 1) {
      const { name, data } = exportEntries[0];
      const exportResult = exportAnimationDataAsVmdBuffer(data);
      const buffer = exportResult.buffer;
      warningResults.push({ name, warnings: exportResult.warnings || [] });
      return {
        blob: new Blob([buffer], { type: 'application/octet-stream' }),
        filename: name,
        warnings: warningResults,
      };
    }

    const JSZipClass = globalThis.JSZip || JSZipModule.default || JSZipModule;
    if (!JSZipClass) {
      throw new Error('JSZip is required for exporting multiple VMDs');
    }
    const zip = new JSZipClass();
    for (const { name, data } of exportEntries) {
      const exportResult = exportAnimationDataAsVmdBuffer(data);
      warningResults.push({ name, warnings: exportResult.warnings || [] });
      zip.file(name, exportResult.buffer);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    return { blob, filename: 'animations.zip', warnings: warningResults };
  }

  /**
   * Triggers a download for the exported VMD(s).
   */
  async download() {
    const exportData = await this.exportVmds();
    if (!exportData) return;
    this._reportExportWarnings(exportData.warnings || []);

    const url = URL.createObjectURL(exportData.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportData.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * VRMA をダウンロードします。
   * @param {object} options - 書き出しオプション。
   * @returns {Promise<void>}
   */
  async downloadVrma(options = {}) {
    const exportResult = await exportRuntimeAnimationAsVrma(options);
    this._reportVrmaExportWarnings(exportResult.warnings || []);
    const blob = new Blob([exportResult.buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportResult.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * VMD export warning を通知します。
   * @param {Array<{name: string, warnings: object[]}>} warningResults - warning 一覧。
   */
  _reportExportWarnings(warningResults) {
    const message = formatAnimationExportWarnings(warningResults);
    if (!message) {
      return;
    }

    console.warn(`[OpenMMD] VMD export warnings\n${message}`);
    if (typeof alert === 'function') {
      alert(`VMD export warnings\n\n${message}`);
    }
  }

  /**
   * VRMA export warning を通知します。
   * @param {object[]} warnings - warning 一覧。
   */
  _reportVrmaExportWarnings(warnings) {
    if (!Array.isArray(warnings) || warnings.length === 0) {
      return;
    }

    const message = warnings.map((warning) => `- ${warning.message}`).join('\n');
    console.warn(`[OpenMMD] VRMA export warnings\n${message}`);
    if (typeof alert === 'function') {
      alert(`VRMA export warnings\n\n${message}`);
    }
  }
}

/**
 * 後方互換のため旧クラス名を残します。
 */
export const VMDManager = AnimationSourceManager;
