import { isShaderFileName } from '../io/file-loading.js';

const COMMON_SHADER_PATH = 'source/infrastructure/gpu/shaders/shaders.wgsl';
const SHADER_MANIFEST_PATH = 'source/infrastructure/gpu/shaders/custom-shaders/manifest.json';
const SHADER_DIRECTORY_PATH = 'source/infrastructure/gpu/shaders/custom-shaders/';
const DEFAULT_SHADER_NAME = 'mmd-shader.wgsl';

/**
 * カスタムシェーダの読み込み、キャッシュ、再読み込みを管理します。
 */
export class CustomShaderManager {
  /**
   * @param {GPUDevice} device - WebGPU デバイス。
   */
  constructor(device) {
    this.device = device;
    this.manifest = null;
    this.commonShaderSource = null;
    this.manifestPromise = null;
    this.commonSourcePromise = null;
    this.shaderCache = new Map();
    this.externalShaderDefinitions = new Map();
    this.externalShaderSources = new Map();
    this.externalShaderOrder = 0;
    this.defaultMmdShaderName = DEFAULT_SHADER_NAME;
  }

  /**
   * シェーダ定義の初期読み込みを行います。
   * @returns {Promise<void>}
   */
  async init() {
    await Promise.all([
      this.loadManifest(),
      this.loadCommonShaderSource(),
    ]);
  }

  /**
   * 利用可能なシェーダ定義を返します。
   * @returns {Array<object>} シェーダ定義。
   */
  getShaderDefinitions() {
    const definitions = [];
    const mergedByName = new Map();

    for (const definition of Array.isArray(this.manifest) ? this.manifest : []) {
      const normalized = cloneShaderDefinition(definition);
      if (!normalized?.name) {
        continue;
      }
      mergedByName.set(normalized.name, normalized);
    }

    for (const definition of this.externalShaderDefinitions.values()) {
      const normalized = cloneShaderDefinition(definition);
      if (!normalized?.name) {
        continue;
      }
      mergedByName.set(normalized.name, normalized);
    }

    for (const definition of mergedByName.values()) {
      definitions.push(definition);
    }

    definitions.sort(compareShaderDefinitions);
    return definitions;
  }

  /**
   * モデルに対する既定シェーダ名を返します。
   * @param {object|null} model - モデルデータ。
   * @returns {string} シェーダ名。
   */
  getDefaultShaderNameForModel(model) {
    const definitions = this.getShaderDefinitions();
    if (definitions.length === 0) {
      return this.defaultMmdShaderName;
    }

    const magic = typeof model?.magic === 'string' ? model.magic.toLowerCase() : '';
    if (magic === 'gltf') {
      const gltfDefinition = definitions.find((definition) => definition.name === 'gltf-shader.wgsl');
      if (gltfDefinition) {
        return gltfDefinition.name;
      }
    }
    if (magic === 'vrm') {
      const vrmDefinition = definitions.find((definition) => definition.name === 'mtoon-shader.wgsl');
      if (vrmDefinition) {
        return vrmDefinition.name;
      }
    }

    if (magic === 'pmd' || magic === 'pmx' || magic === 'mmd' || magic === '') {
      const mmdDefinition = definitions.find((definition) => definition.name === this.defaultMmdShaderName);
      return mmdDefinition?.name || this.defaultMmdShaderName;
    }

    const modelSpecific = definitions.find((definition) => Array.isArray(definition.defaultFor)
      && definition.defaultFor.includes(magic));
    if (modelSpecific) {
      return modelSpecific.name;
    }

    const defaultDefinition = definitions.find((definition) => Array.isArray(definition.defaultFor)
      && definition.defaultFor.includes('default'));
    if (defaultDefinition) {
      return defaultDefinition.name;
    }

    const mmdDefinition = definitions.find((definition) => definition.name === this.defaultMmdShaderName);
    return mmdDefinition?.name || definitions[0].name || this.defaultMmdShaderName;
  }

  /**
   * MMD 系モデルの既定シェーダ名を取得します。
   * @returns {string} シェーダ名。
   */
  getDefaultMmdShaderName() {
    return this.defaultMmdShaderName;
  }

  /**
   * MMD 系モデルの既定シェーダ名を設定します。
   * @param {string} shaderName - シェーダ名。
   * @returns {string} 設定後のシェーダ名。
   */
  setDefaultMmdShaderName(shaderName) {
    const nextName = typeof shaderName === 'string' && shaderName.trim()
      ? shaderName.trim()
      : DEFAULT_SHADER_NAME;
    this.defaultMmdShaderName = nextName;
    return this.defaultMmdShaderName;
  }

  /**
   * 指定シェーダの GPUShaderModule を返します。
   * @param {string} shaderName - シェーダ名。
   * @param {{forceReload?: boolean}} [options={}] - 読み込みオプション。
   * @returns {Promise<GPUShaderModule|null>} シェーダモジュール。
   */
  async getShaderModule(shaderName, options = {}) {
    const definition = await this.getShaderDefinition(shaderName);
    if (!definition) {
      return null;
    }

    const forceReload = Boolean(options.forceReload);
    if (!forceReload) {
      const cached = this.shaderCache.get(shaderName);
      if (cached) {
        return cached.module;
      }
    }

    const previous = this.shaderCache.get(shaderName) || null;
    try {
      const source = await this.buildShaderSource(definition, forceReload);
      const module = this.device.createShaderModule({ code: source });
      await this.assertShaderModuleValid(module, shaderName);
      this.shaderCache.set(shaderName, {
        module,
        source,
        updatedAt: Date.now(),
      });
      return module;
    } catch (error) {
      if (previous) {
        console.error(`Failed to load shader '${shaderName}', keeping previous version.`, error);
        return previous.module;
      }
      throw error;
    }
  }

  /**
   * 指定シェーダだけを再読み込みします。
   * @param {string} shaderName - シェーダ名。
   * @returns {Promise<GPUShaderModule|null>} 再読み込み結果。
   */
  async reloadShader(shaderName) {
    return await this.getShaderModule(shaderName, { forceReload: true });
  }

  /**
   * シェーダ定義を 1 件取得します。
   * @param {string} shaderName - シェーダ名。
   * @returns {Promise<object|null>} シェーダ定義。
   */
  async getShaderDefinition(shaderName) {
    const definitions = await this.loadManifest();
    const mergedDefinitions = this.getShaderDefinitionsFrom(definitions);
    const targetName = typeof shaderName === 'string' ? shaderName.trim() : '';
    if (!targetName) {
      return mergedDefinitions.find((definition) => definition.name === this.defaultMmdShaderName) || mergedDefinitions[0] || null;
    }
    return mergedDefinitions.find((definition) => definition.name === targetName) || null;
  }

  /**
   * マニフェストを読み込みます。
   * @param {boolean} [forceReload=false] - キャッシュを無視するかどうか。
   * @returns {Promise<Array<object>>} シェーダ定義一覧。
   */
  async loadManifest(forceReload = false) {
    if (!forceReload && this.manifestPromise) {
      return await this.manifestPromise;
    }

    const loader = async () => {
      try {
        const response = await fetch(addCacheBust(SHADER_MANIFEST_PATH, forceReload));
        if (!response.ok) {
          throw new Error(`Failed to load shader manifest: ${response.status} ${response.statusText}`);
        }

        const rawDefinitions = await response.json();
        const definitions = Array.isArray(rawDefinitions)
          ? rawDefinitions.map((definition, index) => normalizeShaderDefinition(definition, index))
            .filter((definition) => definition !== null)
          : [];
        this.manifest = definitions.length > 0 ? definitions : createFallbackShaderDefinitions();
      } catch (error) {
        console.warn('Falling back to built-in shader manifest.', error);
        this.manifest = createFallbackShaderDefinitions();
      }
      return this.manifest;
    };

    const promise = loader();
    if (!forceReload) {
      this.manifestPromise = promise;
    }
    return await promise;
  }

  /**
   * 共通 WGSL テンプレートを読み込みます。
   * @param {boolean} [forceReload=false] - キャッシュを無視するかどうか。
   * @returns {Promise<string>} WGSL テンプレート。
   */
  async loadCommonShaderSource(forceReload = false) {
    if (!forceReload && this.commonSourcePromise) {
      return await this.commonSourcePromise;
    }

    const loader = async () => {
      const response = await fetch(addCacheBust(COMMON_SHADER_PATH, forceReload));
      if (!response.ok) {
        throw new Error(`Failed to load common shader template: ${response.status} ${response.statusText}`);
      }
      this.commonShaderSource = await response.text();
      return this.commonShaderSource;
    };

    const promise = loader();
    if (!forceReload) {
      this.commonSourcePromise = promise;
    }
    return await promise;
  }

  /**
   * カスタムシェーダの WGSL 本文を読み込みます。
   * @param {object} definition - シェーダ定義。
   * @param {boolean} [forceReload=false] - キャッシュを無視するかどうか。
   * @returns {Promise<string>} シェーダ本文。
   */
  async loadShaderBody(definition, forceReload = false) {
    const externalSource = this.externalShaderSources.get(definition?.name || '');
    if (typeof externalSource === 'string') {
      return externalSource;
    }

    const response = await fetch(addCacheBust(definition.entryPath, forceReload));
    if (!response.ok) {
      throw new Error(`Failed to load shader '${definition.name}': ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  /**
   * 共通テンプレートとカスタム本文を結合します。
   * @param {object} definition - シェーダ定義。
   * @param {boolean} [forceReload=false] - キャッシュを無視するかどうか。
   * @returns {Promise<string>} 完成済み WGSL。
   */
  async buildShaderSource(definition, forceReload = false) {
    const [commonSource, shaderBody] = await Promise.all([
      this.loadCommonShaderSource(forceReload),
      this.loadShaderBody(definition, forceReload),
    ]);
    return injectShaderBody(commonSource, shaderBody);
  }

  /**
   * シェーダモジュールが壊れていないか確認します。
   * @param {GPUShaderModule} module - シェーダモジュール。
   * @param {string} shaderName - シェーダ名。
   * @returns {Promise<void>}
   */
  async assertShaderModuleValid(module, shaderName) {
    if (typeof module?.getCompilationInfo !== 'function') {
      return;
    }

    const info = await module.getCompilationInfo();
    const errors = Array.isArray(info?.messages)
      ? info.messages.filter((message) => message.type === 'error')
      : [];
    if (errors.length > 0) {
      const details = errors.map((message) => message.message || 'Unknown shader compilation error').join('\n');
      throw new Error(`Shader compilation failed for '${shaderName}':\n${details}`);
    }
  }

  /**
   * 外部シェーダ定義を 1 件登録します。
   * @param {object} definition - シェーダ定義。
   * @param {string} shaderSource - WGSL 本文。
   * @returns {object|null} 登録済み定義。
   */
  registerExternalShaderDefinition(definition, shaderSource) {
    const normalized = normalizeExternalShaderDefinition(definition, this.getShaderDefinitions());
    if (!normalized) {
      return null;
    }

    this.externalShaderDefinitions.set(normalized.name, normalized);
    this.externalShaderSources.set(normalized.name, String(shaderSource || ''));
    this.shaderCache.delete(normalized.name);
    return cloneShaderDefinition(normalized);
  }

  /**
   * 単体 WGSL ファイルを外部シェーダとして登録します。
   * @param {File|Blob|{name?: string, text?: function(): Promise<string>}} file - WGSL ファイル。
   * @param {object} [options={}] - 読み込みオプション。
   * @returns {Promise<Array<object>>} 登録済み定義一覧。
   */
  async loadDroppedShaderFile(file, options = {}) {
    if (!file) {
      return [];
    }

    const fileName = typeof file.name === 'string' && file.name.trim()
      ? file.name.trim()
      : '';
    if (!isShaderFileName(fileName)) {
      return [];
    }

    const shaderSource = await readShaderTextFromFile(file);
    const definition = normalizeSingleShaderDefinition(fileName, options);
    const registered = this.registerExternalShaderDefinition(definition, shaderSource);
    return registered ? [registered] : [];
  }

  /**
   * ZIP 相当のファイル群から外部シェーダを登録します。
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
   * @param {object} [options={}] - 読み込みオプション。
   * @returns {Promise<Array<object>>} 登録済み定義一覧。
   */
  async loadDroppedShaderBundle(zipFiles, options = {}) {
    if (!zipFiles || typeof zipFiles !== 'object') {
      return [];
    }

    const manifestPath = findShaderManifestPath(zipFiles);
    if (manifestPath) {
      return await this.loadShaderBundleFromManifest(zipFiles, manifestPath, options);
    }

    return await this.loadShaderBundleFromLooseFiles(zipFiles, options);
  }

  /**
   * manifest.json を含む外部シェーダ群を登録します。
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
   * @param {string} manifestPath - manifest のパス。
   * @param {object} [options={}] - 読み込みオプション。
   * @returns {Promise<Array<object>>} 登録済み定義一覧。
   */
  async loadShaderBundleFromManifest(zipFiles, manifestPath, options = {}) {
    const manifestText = await readZipText(zipFiles, manifestPath);
    if (!manifestText) {
      return [];
    }

    let parsed = null;
    try {
      parsed = JSON.parse(String(manifestText).replace(/^\uFEFF/, ''));
    } catch (error) {
      console.warn(`Failed to parse shader manifest '${manifestPath}', falling back to loose WGSL files.`, error);
      return await this.loadShaderBundleFromLooseFiles(zipFiles, options);
    }
    const rawDefinitions = Array.isArray(parsed) ? parsed : [];
    const manifestDirectory = getParentDirectoryPath(manifestPath);
    const registeredDefinitions = [];

    for (let index = 0; index < rawDefinitions.length; index++) {
      const rawDefinition = rawDefinitions[index];
      const normalized = normalizeExternalShaderManifestDefinition(rawDefinition, index, manifestDirectory, options);
      if (!normalized) {
        continue;
      }

      const sourcePath = resolveShaderArchivePath(normalized.entryPath, manifestDirectory);
      const shaderSource = await readZipText(zipFiles, sourcePath);
      if (shaderSource === null) {
        continue;
      }

      const registered = this.registerExternalShaderDefinition(normalized, shaderSource);
      if (registered) {
        registeredDefinitions.push(registered);
      }
    }

    return registeredDefinitions;
  }

  /**
   * manifest なしの外部シェーダ群を登録します。
   * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
   * @param {object} [options={}] - 読み込みオプション。
   * @returns {Promise<Array<object>>} 登録済み定義一覧。
   */
  async loadShaderBundleFromLooseFiles(zipFiles, options = {}) {
    const registeredDefinitions = [];
    const shaderPaths = Object.keys(zipFiles || {})
      .filter((path) => isShaderFileName(path) && !String(path || '').toLowerCase().includes('__macosx'))
      .sort((left, right) => left.localeCompare(right));

    for (let index = 0; index < shaderPaths.length; index++) {
      const path = shaderPaths[index];
      const shaderSource = await readZipText(zipFiles, path);
      if (shaderSource === null) {
        continue;
      }

      const normalized = normalizeLooseShaderDefinition(path, index, options);
      const registered = this.registerExternalShaderDefinition(normalized, shaderSource);
      if (registered) {
        registeredDefinitions.push(registered);
      }
    }

    return registeredDefinitions;
  }

  /**
   * 外部シェーダ定義の一覧を、既存 manifest と統合した結果から取得します。
   * @param {Array<object>} baseDefinitions - 基本定義一覧。
   * @returns {Array<object>} 統合済み定義一覧。
   */
  getShaderDefinitionsFrom(baseDefinitions) {
    const definitions = [];
    const mergedByName = new Map();

    for (const definition of Array.isArray(baseDefinitions) ? baseDefinitions : []) {
      const normalized = cloneShaderDefinition(definition);
      if (!normalized?.name) {
        continue;
      }
      mergedByName.set(normalized.name, normalized);
    }

    for (const definition of this.externalShaderDefinitions.values()) {
      const normalized = cloneShaderDefinition(definition);
      if (!normalized?.name) {
        continue;
      }
      mergedByName.set(normalized.name, normalized);
    }

    for (const definition of mergedByName.values()) {
      definitions.push(definition);
    }

    definitions.sort(compareShaderDefinitions);
    return definitions;
  }
}

/**
 * シェーダ定義を正規化します。
 * @param {object} definition - 生定義。
 * @param {number} index - 順序。
 * @returns {object|null} 正規化定義。
 */
function normalizeShaderDefinition(definition, index) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const name = typeof definition.name === 'string' ? definition.name.trim() : '';
  if (!name) {
    return null;
  }

  const label = typeof definition.label === 'string' && definition.label.trim()
    ? definition.label.trim()
    : name;
  const entryPath = typeof definition.entryPath === 'string' && definition.entryPath.trim()
    ? definition.entryPath.trim()
    : `${SHADER_DIRECTORY_PATH}${name}`;
  const defaultFor = Array.isArray(definition.defaultFor)
    ? definition.defaultFor.map((value) => String(value).toLowerCase())
    : [];

  return {
    name,
    label,
    entryPath,
    defaultFor,
    order: Number.isFinite(definition.order) ? definition.order : index,
  };
}

/**
 * 外部シェーダ定義を正規化します。
 * @param {object} definition - 生定義。
 * @param {Array<object>} existingDefinitions - 既存定義一覧。
 * @returns {object|null} 正規化定義。
 */
function normalizeExternalShaderDefinition(definition, existingDefinitions) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const name = typeof definition.name === 'string' ? definition.name.trim() : '';
  if (!name) {
    return null;
  }

  const label = typeof definition.label === 'string' && definition.label.trim()
    ? definition.label.trim()
    : name;
  const entryPath = typeof definition.entryPath === 'string' && definition.entryPath.trim()
    ? normalizeArchivePath(definition.entryPath)
    : name;
  const defaultFor = Array.isArray(definition.defaultFor)
    ? definition.defaultFor.map((value) => String(value).toLowerCase())
    : [];
  const existingOrder = Array.isArray(existingDefinitions)
    ? existingDefinitions.find((entry) => entry?.name === name)?.order
    : undefined;

  return {
    name,
    label,
    entryPath,
    defaultFor,
    order: Number.isFinite(existingOrder)
      ? existingOrder
      : Number.isFinite(definition.order)
        ? definition.order
        : 100000 + Math.max(0, existingDefinitions.length),
  };
}

/**
 * 単体 WGSL ファイルを登録用定義へ正規化します。
 * @param {string} fileName - ファイル名。
 * @param {object} [options={}] - 読み込みオプション。
 * @returns {object} 正規化定義。
 */
function normalizeSingleShaderDefinition(fileName, options = {}) {
  const normalizedName = normalizeArchivePath(fileName);
  const displayName = normalizedName || String(fileName || '').trim();
  return {
    name: displayName,
    label: displayName,
    entryPath: `shader-drop://${displayName}`,
    defaultFor: [],
    order: Number.isFinite(options.order) ? options.order : 100000,
  };
}

/**
 * manifest 付き外部シェーダを登録する定義へ正規化します。
 * @param {object} definition - 生定義。
 * @param {number} index - 順序。
 * @param {string} manifestDirectory - manifest の親ディレクトリ。
 * @param {object} [options={}] - 読み込みオプション。
 * @returns {object|null} 正規化定義。
 */
function normalizeExternalShaderManifestDefinition(definition, index, manifestDirectory, options = {}) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const name = typeof definition.name === 'string' ? definition.name.trim() : '';
  if (!name) {
    return null;
  }

  const label = typeof definition.label === 'string' && definition.label.trim()
    ? definition.label.trim()
    : name;
  const entryPath = typeof definition.entryPath === 'string' && definition.entryPath.trim()
    ? normalizeArchivePath(definition.entryPath)
    : normalizeArchivePath(`${manifestDirectory}${name}`);
  const defaultFor = Array.isArray(definition.defaultFor)
    ? definition.defaultFor.map((value) => String(value).toLowerCase())
    : [];

  return {
    name,
    label,
    entryPath,
    defaultFor,
    order: Number.isFinite(definition.order) ? definition.order : 100000 + index,
  };
}

/**
 * manifest なし外部シェーダを登録する定義へ正規化します。
 * @param {string} path - ファイルパス。
 * @param {object} [options={}] - 読み込みオプション。
 * @returns {object} 正規化定義。
 */
function normalizeLooseShaderDefinition(path, index = 0, options = {}) {
  const normalizedPath = normalizeArchivePath(path);
  return {
    name: normalizedPath,
    label: normalizedPath,
    entryPath: normalizedPath,
    defaultFor: [],
    order: Number.isFinite(options.order) ? options.order : 100000 + index,
  };
}

/**
 * フォールバックのシェーダ一覧を作成します。
 * @returns {Array<object>} シェーダ定義。
 */
function createFallbackShaderDefinitions() {
  return [
    {
      name: DEFAULT_SHADER_NAME,
      label: 'MMD Shader',
      entryPath: `${SHADER_DIRECTORY_PATH}${DEFAULT_SHADER_NAME}`,
      defaultFor: ['default', 'pmd', 'pmx', 'mmd'],
      order: 0,
    },
    {
      name: 'gltf-shader.wgsl',
      label: 'glTF Shader',
      entryPath: `${SHADER_DIRECTORY_PATH}gltf-shader.wgsl`,
      defaultFor: ['gltf'],
      order: 1,
    },
    {
      name: 'mtoon-shader.wgsl',
      label: 'MToon Shader',
      entryPath: `${SHADER_DIRECTORY_PATH}mtoon-shader.wgsl`,
      defaultFor: ['vrm'],
      order: 2,
    },
  ];
}

/**
 * シェーダ定義を複製します。
 * @param {object} definition - シェーダ定義。
 * @returns {object|null} 複製結果。
 */
function cloneShaderDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  return {
    ...definition,
    defaultFor: Array.isArray(definition.defaultFor) ? definition.defaultFor.slice() : [],
  };
}

/**
 * シェーダ定義を並び替えます。
 * @param {object} left - 左辺。
 * @param {object} right - 右辺。
 * @returns {number} 比較結果。
 */
function compareShaderDefinitions(left, right) {
  const leftOrder = Number.isFinite(left?.order) ? left.order : 0;
  const rightOrder = Number.isFinite(right?.order) ? right.order : 0;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftLabel = String(left?.label || left?.name || '');
  const rightLabel = String(right?.label || right?.name || '');
  return leftLabel.localeCompare(rightLabel);
}

/**
 * シェーダ本文を共通テンプレートへ差し込みます。
 * @param {string} commonSource - 共通テンプレート。
 * @param {string} shaderBody - 差し込み対象の本文。
 * @returns {string} 完成済み WGSL。
 */
function injectShaderBody(commonSource, shaderBody) {
  const marker = '/* CUSTOM_SHADER_BODY */';
  if (!commonSource.includes(marker)) {
    throw new Error('Custom shader injection marker was not found in source/shaders/shaders.wgsl.');
  }

  return commonSource.replace(marker, indentBlock(shaderBody.trim(), 2));
}

/**
 * テキストにインデントを追加します。
 * @param {string} text - 対象テキスト。
 * @param {number} indentSize - インデント幅。
 * @returns {string} インデント済みテキスト。
 */
function indentBlock(text, indentSize) {
  const indent = ' '.repeat(indentSize);
  return text.split(/\r?\n/).map((line) => (line.length > 0 ? `${indent}${line}` : line)).join('\n');
}

/**
 * ファイルからテキストを読み込みます。
 * @param {File|Blob|{text?: function(): Promise<string>}} file - 読み込み対象。
 * @returns {Promise<string>} 読み込み結果。
 */
async function readShaderTextFromFile(file) {
  if (typeof file?.text === 'function') {
    return await file.text();
  }

  if (typeof file?.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
  }

  return '';
}

/**
 * ZIP 相当のファイル群からテキストを読み込みます。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 対象パス。
 * @returns {Promise<string|null>} 読み込み結果。
 */
async function readZipText(zipFiles, path) {
  const entry = findZipEntry(zipFiles, path);
  if (!entry || typeof entry.async !== 'function') {
    return null;
  }

  const blob = await entry.async('blob');
  if (!blob) {
    return null;
  }

  if (typeof blob.text === 'function') {
    return await blob.text();
  }

  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
  }

  return null;
}

/**
 * ZIP 相当のファイル群から指定パスのエントリを探します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 探索対象パス。
 * @returns {{async: function(string): Promise<(ArrayBuffer|Blob|null)>}|null} エントリ。
 */
function findZipEntry(zipFiles, path) {
  const normalizedPath = normalizeArchivePath(path);
  for (const [entryPath, entry] of Object.entries(zipFiles || {})) {
    if (normalizeArchivePath(entryPath) === normalizedPath) {
      return entry;
    }
  }
  return null;
}

/**
 * manifest.json の場所を探します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {string|null} manifest パス。
 */
function findShaderManifestPath(zipFiles) {
  const manifestCandidates = Object.keys(zipFiles || {})
    .filter((path) => normalizeArchivePath(path).toLowerCase().endsWith('/manifest.json') || normalizeArchivePath(path).toLowerCase() === 'manifest.json');

  if (manifestCandidates.length === 0) {
    return null;
  }

  manifestCandidates.sort((left, right) => left.localeCompare(right));
  return manifestCandidates[0];
}

/**
 * パスの区切りを正規化します。
 * @param {string} path - 入力パス。
 * @returns {string} 正規化済みパス。
 */
function normalizeArchivePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

/**
 * パスの親ディレクトリを返します。
 * @param {string} path - 入力パス。
 * @returns {string} 親ディレクトリ。
 */
function getParentDirectoryPath(path) {
  const normalized = normalizeArchivePath(path);
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex < 0) {
    return '';
  }
  return normalized.slice(0, lastSlashIndex);
}

/**
 * manifest の entryPath を ZIP 内パスへ解決します。
 * @param {string} entryPath - entryPath。
 * @param {string} manifestDirectory - manifest の親ディレクトリ。
 * @returns {string} 解決済みパス。
 */
function resolveShaderArchivePath(entryPath, manifestDirectory) {
  const normalizedEntryPath = normalizeArchivePath(entryPath);
  const normalizedDirectory = normalizeArchivePath(manifestDirectory);
  if (!normalizedDirectory) {
    return normalizedEntryPath;
  }

  if (normalizedEntryPath.startsWith(`${normalizedDirectory}/`)) {
    return normalizedEntryPath;
  }

  return `${normalizedDirectory}/${normalizedEntryPath}`;
}

/**
 * キャッシュバスター付き URL を生成します。
 * @param {string} path - 読み込み先。
 * @param {boolean} forceReload - キャッシュを無視するかどうか。
 * @returns {string} 読み込み URL。
 */
function addCacheBust(path, forceReload) {
  if (!forceReload) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}t=${Date.now()}`;
}
