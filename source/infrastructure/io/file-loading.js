import * as JSZipModule from '../../lib/jszip.min.js';
import { collectModelShaderSelectValues } from '../serialization/model-json.js';

const AUDIO_MIME_TYPE_BY_EXTENSION = new Map([
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm'],
]);

const MODEL_FILE_EXTENSIONS = new Set(['.pmx', '.pmd', '.glb', '.gltf', '.vrm']);
const POSE_FILE_EXTENSIONS = new Set(['.vpd']);
const ANIMATION_FILE_EXTENSIONS = new Set(['.vmd', '.vrma']);
const SHADER_FILE_EXTENSIONS = new Set(['.wgsl']);

/**
 * ZIP 内のファイル名を UTF-8 優先で復号します。
 * UTF-8 で破綻した場合のみ Shift-JIS を試します。
 * @param {Uint8Array} bytes - ZIP エントリ名の生バイト列。
 * @returns {string} 復号後のファイル名。
 */
export function decodeZipFileName(bytes) {
  const utf8Name = new TextDecoder('utf-8').decode(bytes);
  if (!utf8Name.includes('\uFFFD')) {
    return utf8Name;
  }

  try {
    return new TextDecoder('shift-jis').decode(bytes);
  } catch (error) {
    return utf8Name;
  }
}

/**
 * ファイル名の拡張子を小文字で返します。
 * @param {string} fileName - ファイル名。
 * @returns {string} 先頭のドットを含む拡張子。
 */
export function getLowerCaseFileExtension(fileName) {
  const normalizedName = String(fileName || '').trim().toLowerCase();
  const lastDotIndex = normalizedName.lastIndexOf('.');
  if (lastDotIndex < 0) {
    return '';
  }
  return normalizedName.slice(lastDotIndex);
}

/**
 * ファイル名が HDR 画像かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} HDR 画像なら true。
 */
export function isHdrFileName(fileName) {
  return getLowerCaseFileExtension(fileName) === '.hdr';
}

/**
 * ファイル名が UI 設定 JSON かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} JSON 設定ファイルなら true。
 */
export function isJsonFileName(fileName) {
  return getLowerCaseFileExtension(fileName) === '.json';
}

/**
 * ファイル名がモデル候補かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} モデル候補なら true。
 */
export function isModelFileName(fileName) {
  return MODEL_FILE_EXTENSIONS.has(getLowerCaseFileExtension(fileName));
}

/**
 * ファイル名が VRM かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} VRM なら true。
 */
export function isVrmFileName(fileName) {
  return getLowerCaseFileExtension(fileName) === '.vrm';
}

/**
 * ファイル名が VPD かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} VPD なら true。
 */
export function isVpdFileName(fileName) {
  return POSE_FILE_EXTENSIONS.has(getLowerCaseFileExtension(fileName));
}

/**
 * ファイル名が VMD または VRMA かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} animation ファイルなら true。
 */
export function isAnimationFileName(fileName) {
  return ANIMATION_FILE_EXTENSIONS.has(getLowerCaseFileExtension(fileName));
}

/**
 * ファイル名が WGSL シェーダかどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @returns {boolean} WGSL シェーダなら true。
 */
export function isShaderFileName(fileName) {
  return SHADER_FILE_EXTENSIONS.has(getLowerCaseFileExtension(fileName));
}

/**
 * ZIP ファイルを読み込みます。
 * @param {Blob|File|ArrayBuffer|Uint8Array|string} input - 読み込み対象。
 * @returns {Promise<import('./lib/jszip.min.js').default>} ZIP オブジェクト。
 */
export async function loadZipArchive(input) {
  const JSZip = globalThis.JSZip || JSZipModule.default || JSZipModule;
  if (!JSZip) {
    throw new Error('JSZip is not available.');
  }

  const normalizedInput = input && typeof input.arrayBuffer === 'function'
    ? await input.arrayBuffer()
    : input;

  return await JSZip.loadAsync(normalizedInput, {
    decodeFileName: decodeZipFileName,
  });
}

/**
 * JSZip のファイル一覧を画面側で扱いやすい形に変換します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {{name: string, async: function(string): Promise<(ArrayBuffer|Blob|null)>}[]} ファイル配列。
 */
export function createZipFileViews(zipFiles) {
  return Object.entries(zipFiles).map(([path, entry]) => ({
    name: path,
    async: (type) => entry.async(type),
  }));
}

/**
 * ドラッグイベントがファイルドラッグかどうかを判定します。
 * @param {DragEvent|Event} event - 判定対象のイベント。
 * @returns {boolean} ファイルドラッグなら true。
 */
export function isFileDrag(event) {
  return Boolean(event?.dataTransfer?.types) && Array.from(event.dataTransfer.types).includes('Files');
}

/**
 * DataTransfer からドロップされたファイルを収集します。
 * @param {DataTransfer} dataTransfer - ドラッグ＆ドロップの転送データ。
 * @returns {Promise<{files: File[], zipFiles: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>, hasDirectory: boolean}>}
 */
export async function collectDroppedFiles(dataTransfer) {
  const zipFiles = {};
  const files = [];
  let hasDirectory = false;
  const items = dataTransfer.items;

  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) {
        if (entry.isDirectory) hasDirectory = true;
        await traverseEntry(entry, '', zipFiles, files, 0);
        continue;
      }

      const file = item.getAsFile ? item.getAsFile() : null;
      if (file) {
        files.push(file);
      }
    }
  }

  if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    files.push(...Array.from(dataTransfer.files));
  }

  return { files, zipFiles, hasDirectory };
}

/**
 * ドロップ結果から、単一ファイルとして開くか ZIP として開くかを判定します。
 * @param {{files: File[], zipFiles: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>, hasDirectory: boolean}} dropped - collectDroppedFiles の戻り値。
 * @returns {{kind: 'file', file: File} | {kind: 'zip', zipFiles: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} | null} 開く対象。
 */
export function resolveDroppedInput(dropped) {
  if (!dropped) {
    return null;
  }

  const fileKeys = Object.keys(dropped.zipFiles || {});
  if (dropped.hasDirectory || fileKeys.length > 1) {
    return { kind: 'zip', zipFiles: dropped.zipFiles };
  }

  if (Array.isArray(dropped.files) && dropped.files.length > 0) {
    return { kind: 'file', file: dropped.files[0] };
  }

  return null;
}

/**
 * ファイル名の拡張子から音声 MIME type を推定します。
 * @param {string} fileName - ファイル名。
 * @param {string} [mimeType=''] - 既知の MIME type。
 * @returns {string} 推定 MIME type。
 */
export function guessAudioMimeType(fileName, mimeType = '') {
  const normalizedMimeType = String(mimeType || '').trim();
  if (normalizedMimeType.startsWith('audio/')) {
    return normalizedMimeType;
  }

  const extension = getLowerCaseFileExtension(fileName);
  return AUDIO_MIME_TYPE_BY_EXTENSION.get(extension) || normalizedMimeType;
}

/**
 * ファイル名または MIME type が音声候補かどうかを判定します。
 * @param {string} fileName - ファイル名。
 * @param {string} [mimeType=''] - MIME type。
 * @returns {boolean} 音声候補なら true。
 */
export function isPlayableAudioFileName(fileName, mimeType = '') {
  const normalizedMimeType = String(mimeType || '').trim();
  if (normalizedMimeType.startsWith('audio/')) {
    return true;
  }

  return AUDIO_MIME_TYPE_BY_EXTENSION.has(getLowerCaseFileExtension(fileName));
}

/**
 * ドロップされた ZIP 相当のファイル群から、音声候補を File として収集します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} 音声候補一覧。
 */
export async function collectPlayableAudioFilesFromZipFiles(zipFiles) {
  const audioFiles = [];
  if (!zipFiles || typeof zipFiles !== 'object') {
    return audioFiles;
  }

  for (const [path, entry] of Object.entries(zipFiles)) {
    if (String(path || '').toLowerCase().includes('__macosx')) {
      continue;
    }
    if (!isPlayableAudioFileName(path)) {
      continue;
    }

    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    const mimeType = guessAudioMimeType(path, blob.type || '');
    audioFiles.push(new File([blob], path, {
      type: mimeType || blob.type || '',
    }));
  }

  return audioFiles;
}

/**
 * ドロップされた ZIP 相当のファイル群から、HDR 候補を File として収集します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} HDR 候補一覧。
 */
export async function collectHdrFilesFromZipFiles(zipFiles) {
  const hdrFiles = [];
  if (!zipFiles || typeof zipFiles !== 'object') {
    return hdrFiles;
  }

  for (const [path, entry] of Object.entries(zipFiles)) {
    if (String(path || '').toLowerCase().includes('__macosx')) {
      continue;
    }
    if (!isHdrFileName(path)) {
      continue;
    }

    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    hdrFiles.push(new File([blob], path, {
      type: blob.type || 'application/octet-stream',
    }));
  }

  return hdrFiles;
}

/**
 * ドロップされた ZIP 相当のファイル群から、WGSL 候補を File として収集します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} WGSL 候補一覧。
 */
export async function collectShaderFilesFromZipFiles(zipFiles) {
  const shaderFiles = [];
  if (!zipFiles || typeof zipFiles !== 'object') {
    return shaderFiles;
  }

  for (const [path, entry] of Object.entries(zipFiles)) {
    if (String(path || '').toLowerCase().includes('__macosx')) {
      continue;
    }
    if (!isShaderFileName(path)) {
      continue;
    }
    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    shaderFiles.push(new File([blob], path, {
      type: blob.type || 'text/plain',
    }));
  }

  return shaderFiles;
}

/**
 * Model JSON で参照される companion WGSL を ZIP 相当のファイル群から収集します。
 * @param {object} data - Model JSON の解析結果。
 * @param {string} settingsPath - Model JSON のパス。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} companion WGSL ファイル一覧。
 */
export async function collectModelCompanionShaderFilesFromZipFiles(data, settingsPath, zipFiles) {
  const shaderNames = collectModelShaderSelectValues(data).filter((shaderName) => isShaderFileName(shaderName));
  if (shaderNames.length === 0 || !zipFiles || typeof zipFiles !== 'object') {
    return [];
  }

  const settingsDirectory = getParentDirectoryPath(settingsPath);
  const selectedPaths = new Set();

  for (const shaderName of shaderNames) {
    const normalizedShaderName = normalizeArchivePath(shaderName);
    const directMatchPath = findZipEntryPath(zipFiles, normalizedShaderName);
    if (directMatchPath) {
      selectedPaths.add(directMatchPath);
      continue;
    }

    if (settingsDirectory) {
      const siblingPath = `${settingsDirectory}/${normalizedShaderName}`;
      const resolvedPath = findZipEntryPath(zipFiles, siblingPath);
      if (resolvedPath) {
        selectedPaths.add(resolvedPath);
      }
    }
  }

  const shaderFiles = [];
  for (const path of Array.from(selectedPaths).sort((left, right) => left.localeCompare(right))) {
    const entry = zipFiles[path];
    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    shaderFiles.push(new File([blob], path, {
      type: blob.type || 'text/plain',
    }));
  }

  return shaderFiles;
}

/**
 * ドロップされた ZIP 相当のファイル群から、UI 設定 JSON を File として収集します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} UI 設定候補一覧。
 */
export async function collectUiSettingsFilesFromZipFiles(zipFiles) {
  const settingsFiles = [];
  if (!zipFiles || typeof zipFiles !== 'object') {
    return settingsFiles;
  }

  for (const [path, entry] of Object.entries(zipFiles)) {
    if (String(path || '').toLowerCase().includes('__macosx')) {
      continue;
    }
    if (!isJsonFileName(path)) {
      continue;
    }
    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    settingsFiles.push(new File([blob], path, {
      type: blob.type || 'application/json',
    }));
  }

  return settingsFiles;
}

/**
 * ZIP 相当のファイル群から VPD を File として収集します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @returns {Promise<File[]>} VPD 一覧。
 */
export async function collectVpdFilesFromZipFiles(zipFiles) {
  const poseFiles = [];
  if (!zipFiles || typeof zipFiles !== 'object') {
    return poseFiles;
  }

  for (const [path, entry] of Object.entries(zipFiles)) {
    if (String(path || '').toLowerCase().includes('__macosx')) {
      continue;
    }
    if (!isVpdFileName(path)) {
      continue;
    }
    if (!entry || typeof entry.async !== 'function') {
      continue;
    }

    const blob = await entry.async('blob');
    if (!blob) {
      continue;
    }

    poseFiles.push(new File([blob], path, {
      type: blob.type || 'application/octet-stream',
    }));
  }

  return poseFiles;
}

/**
 * ZIP 相当のファイル群からモデル候補を作成します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @param {string} [sourceLabel='ZIP'] - 候補一覧の表示ラベル。
 * @returns {Array<{kind:'zip', zipFiles: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>, modelPath: string, archiveName: string, sourceLabel: string, label: string, checked: boolean}>} モデル候補一覧。
 */
export function collectModelCandidatesFromZipFiles(zipFiles, sourceLabel = 'ZIP') {
  const labelPrefix = String(sourceLabel || 'ZIP').trim() || 'ZIP';
  return Object.keys(zipFiles || {})
    .filter((path) => isModelFileName(path) && !String(path || '').toLowerCase().includes('__macosx'))
    .map((modelPath) => ({
      kind: 'zip',
      zipFiles,
      modelPath,
      archiveName: labelPrefix,
      sourceLabel: labelPrefix,
      label: `${labelPrefix}/${modelPath}`,
      checked: true,
    }));
}

/**
 * ZIP 由来のモデル候補を単体ファイルとして開くべきかを判定します。
 * VRM は自己完結しやすく、単一候補の folder D&D を file D&D と同じ経路へ寄せられます。
 * @param {{kind?: string, modelPath?: string}} candidate - モデル候補。
 * @returns {boolean} file 経由で開くなら true。
 */
export function shouldLoadZipModelCandidateAsFile(candidate) {
  return String(candidate?.kind || '').trim() === 'zip' && isVrmFileName(candidate?.modelPath || '');
}

/**
 * ZIP 由来のモデル候補を File として再構築します。
 * @param {{kind?: string, zipFiles?: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>, modelPath?: string}} candidate - モデル候補。
 * @returns {Promise<File|null>} 再構築した File。
 */
export async function createFileFromZipModelCandidate(candidate) {
  if (!shouldLoadZipModelCandidateAsFile(candidate)) {
    return null;
  }

  const zipFiles = candidate?.zipFiles || null;
  const modelPath = String(candidate?.modelPath || '').trim();
  if (!zipFiles || !modelPath) {
    return null;
  }

  const entry = zipFiles[modelPath];
  if (!entry || typeof entry.async !== 'function') {
    return null;
  }

  const blob = await entry.async('blob');
  if (!blob) {
    return null;
  }

  const fileName = modelPath.split(/[\\/]/).pop() || modelPath;
  return new File([blob], fileName, {
    type: blob.type || 'application/octet-stream',
  });
}

/**
 * ドロップされた入力から、音声候補を収集します。
 * @param {{files: File[], zipFiles: Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>, hasDirectory: boolean}} dropped - collectDroppedFiles の戻り値。
 * @returns {Promise<File[]>} 音声候補一覧。
 */
export async function collectPlayableAudioFilesFromDroppedData(dropped) {
  if (!dropped) {
    return [];
  }

  const audioFiles = [];
  if (Array.isArray(dropped.files)) {
    for (const file of dropped.files) {
      if (file && isPlayableAudioFileName(file.name || '', file.type || '')) {
        audioFiles.push(file);
      }
    }
  }

  const zipAudioFiles = await collectPlayableAudioFilesFromZipFiles(dropped.zipFiles);
  return audioFiles.concat(zipAudioFiles);
}

/**
 * FileSystemEntry を再帰的に展開して ZIP 相当のファイル集合を作成します。
 * @param {FileSystemEntry} entry - 展開対象のエントリ。
 * @param {string} path - 現在の相対パス。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} files - 収集先。
 * @param {File[]} flatFiles - 単体ファイルの収集先。
 * @param {number} depth - 再帰深度。
 */
async function traverseEntry(entry, path, files, flatFiles, depth) {
  if (depth >= 4) return;

  if (entry.isFile) {
    const file = await new Promise((resolve) => entry.file(resolve));
    files[path + entry.name] = {
      async: async (type) => {
        if (type === 'arraybuffer') return await file.arrayBuffer();
        if (type === 'blob') return file;
        return null;
      },
    };
    flatFiles.push(file);
    return;
  }

  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const entries = await new Promise((resolve) => {
      const result = [];
      const read = () => {
        dirReader.readEntries((batch) => {
          if (batch.length > 0) {
            result.push(...batch);
            read();
          } else {
            resolve(result);
          }
        }, () => resolve(result));
      };
      read();
    });

    for (const child of entries) {
      await traverseEntry(child, path + entry.name + '/', files, flatFiles, depth + 1);
    }
  }
}

/**
 * パスを ZIP 内探索向けに正規化します。
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
 * ZIP 相当のファイル群から指定パスの実体を探します。
 * @param {Object<string, {async: function(string): Promise<(ArrayBuffer|Blob|null)>}>} zipFiles - ZIP 内ファイル一覧。
 * @param {string} path - 探索対象パス。
 * @returns {string|null} 実際の ZIP パス。
 */
function findZipEntryPath(zipFiles, path) {
  const normalizedPath = normalizeArchivePath(path);
  for (const entryPath of Object.keys(zipFiles || {})) {
    if (normalizeArchivePath(entryPath) === normalizedPath) {
      return entryPath;
    }
  }
  return null;
}
