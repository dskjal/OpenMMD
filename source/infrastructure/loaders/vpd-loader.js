import {
  convertLeftHandedPositionToRightHanded,
  convertLeftHandedQuaternionToRightHanded,
} from './handedness-utils.js';

const VPD_SIGNATURE = 'Vocaloid Pose Data file';

/**
 * VPD (Vocaloid Pose Data) loader.
 */
export class VPDLoader {
  constructor() {
    this.offset = 0;
    this._lines = [];
  }

  /**
   * Loads a VPD file from URL.
   * @param {string} url - VPD file URL.
   * @returns {Promise<object>} Parsed pose data.
   */
  async load(url) {
    const encodedUrl = encodeURI(url);
    const response = await fetch(encodedUrl);
    if (!response.ok) {
      throw new Error(`Failed to load VPD: ${response.status} ${response.statusText} (${url})`);
    }

    const buffer = await response.arrayBuffer();
    return this.parse(buffer);
  }

  /**
   * Parses a VPD ArrayBuffer.
   * @param {ArrayBuffer} buffer - VPD binary data.
   * @returns {object} Parsed pose data.
   */
  parse(buffer) {
    const decoder = new TextDecoder('shift-jis');
    const text = decoder.decode(buffer);
    this._lines = this._collectMeaningfulLines(text);
    this.offset = 0;

    if (this._lines.length === 0) {
      throw new Error('Empty VPD file');
    }

    const signature = this._readLine('header.signature');
    if (signature !== VPD_SIGNATURE) {
      throw new Error('Invalid VPD signature');
    }

    let modelName = '';
    let boneCountLine = this._readLine('header.modelNameOrBoneCount');
    if (!this._isCountLine(boneCountLine)) {
      modelName = boneCountLine;
      boneCountLine = this._readLine('header.boneCount');
    }

    if (!this._isCountLine(boneCountLine)) {
      throw new Error('Invalid VPD bone count');
    }

    const boneCount = Number.parseInt(boneCountLine, 10);
    if (!Number.isInteger(boneCount) || boneCount < 0) {
      throw new Error(`Invalid VPD bone count: ${boneCountLine}`);
    }

    const bones = [];
    for (let i = 0; i < boneCount; i++) {
      if (this.offset >= this._lines.length) {
        break;
      }

      const headerLine = this._readLine(`bone[${i}].header`);
      if (headerLine === '}') {
        i -= 1;
        continue;
      }

      const braceIndex = headerLine.indexOf('{');
      if (braceIndex < 0) {
        throw new Error(`Invalid VPD bone header: ${headerLine}`);
      }

      const boneName = headerLine.slice(braceIndex + 1).trim();
      if (!boneName) {
        throw new Error(`Invalid VPD bone name: ${headerLine}`);
      }

      const position = this._readVector3(`bone[${i}].position`);
      const rotation = this._readQuaternion(`bone[${i}].rotation`);
      bones.push({
        name: boneName,
        position: convertLeftHandedPositionToRightHanded(position),
        rotation: convertLeftHandedQuaternionToRightHanded(rotation),
      });

      if (this._lines[this.offset] === '}') {
        this.offset += 1;
      }
    }

    return {
      signature,
      modelName,
      boneCount,
      bones,
      readBytes: buffer.byteLength,
    };
  }

  /**
   * Collects meaningful VPD lines by removing comments and empty lines.
   * @param {string} text - VPD text.
   * @returns {string[]} Meaningful lines.
   */
  _collectMeaningfulLines(text) {
    return String(text || '')
      .split(/\r\n|\n|\r/u)
      .map((line, index) => this._normalizeLine(line, index === 0))
      .filter((line) => line.length > 0);
  }

  /**
   * Normalizes a VPD text line.
   * @param {string} line - Raw line text.
   * @param {boolean} isFirstLine - Whether the line is the first line in the file.
   * @returns {string} Normalized line.
   */
  _normalizeLine(line, isFirstLine = false) {
    let normalized = String(line || '');
    if (isFirstLine) {
      normalized = normalized.replace(/^\uFEFF/u, '');
    }

    const commentIndex = normalized.indexOf('//');
    if (commentIndex >= 0) {
      normalized = normalized.slice(0, commentIndex);
    }

    const semicolonIndex = normalized.indexOf(';');
    if (semicolonIndex >= 0) {
      normalized = normalized.slice(0, semicolonIndex);
    }

    return normalized.trim();
  }

  /**
   * Reads the next meaningful line.
   * @param {string} context - Error context.
   * @returns {string} Line text.
   */
  _readLine(context) {
    if (this.offset >= this._lines.length) {
      throw new Error(`Unexpected end of VPD while reading ${context}`);
    }

    const line = this._lines[this.offset];
    this.offset += 1;
    return line;
  }

  /**
   * Reads a 3-element vector.
   * @param {string} context - Error context.
   * @returns {number[]} 3-element vector.
   */
  _readVector3(context) {
    const line = this._readLine(context);
    const values = line.split(',').map((token) => Number.parseFloat(token.trim()));
    if (values.length < 3 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid VPD vector: ${line}`);
    }

    return [values[0], values[1], values[2]];
  }

  /**
   * Reads a 4-element quaternion.
   * @param {string} context - Error context.
   * @returns {number[]} 4-element quaternion.
   */
  _readQuaternion(context) {
    const line = this._readLine(context);
    const values = line.split(',').map((token) => Number.parseFloat(token.trim()));
    if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid VPD quaternion: ${line}`);
    }

    return [values[0], values[1], values[2], values[3]];
  }

  /**
   * Returns true when a line is a bone count line.
   * @param {string} line - Line text.
   * @returns {boolean} Bone count line or not.
   */
  _isCountLine(line) {
    return /^-?\d+$/u.test(String(line || '').trim());
  }

}
