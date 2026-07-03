import * as EncodingModule from '../../lib/encoding.min.js';
import { serializeAnimationSourceToVmd } from '../../core/animation/animation-clip.js';
import {
  createVmdLightPositionFromDirectionalLight,
  createVmdLightPositionFromRotation,
} from '../../core/scene/light-object.js';
const Encoding = EncodingModule.default || globalThis.Encoding || EncodingModule;

/**
 * VMD Writer
 */
export class VMDWriter {
  constructor() {
    this.buffer = new ArrayBuffer(1024 * 1024 * 10); // Initial 10MB
    this.view = new DataView(this.buffer);
    this.offset = 0;
    this.lastWarnings = [];
  }

  write(data) {
    const exportResult = serializeAnimationSourceToVmd(data);
    const normalizedData = exportResult.vmd;
    this.lastWarnings = exportResult.warnings;
    this.offset = 0;

    // Header
    const isOldFormat = normalizedData.signature === 'Vocaloid Motion Data file';
    this.writeString(normalizedData.signature, 30);
    this.writeString(normalizedData.modelName, isOldFormat ? 10 : 20);

    // Bone keyframes
    this._setUint32(normalizedData.boneKeyframes.length);
    for (const keyframe of normalizedData.boneKeyframes) {
      this.writeString(keyframe.boneName, 15);
      this._setUint32(keyframe.frameNum);
      this._setFloat(keyframe.position[0]);
      this._setFloat(keyframe.position[1]);
      this._setFloat(-keyframe.position[2]);  // Z-Flip
      this._setFloat(-keyframe.rotation[0]);  // Z-Flip
      this._setFloat(-keyframe.rotation[1]);  // Z-Flip
      this._setFloat(keyframe.rotation[2]);
      this._setFloat(keyframe.rotation[3]);
      const bytes = new Uint8Array(this.buffer, this.offset, 64);
      bytes.set(keyframe.interpolation);
      this.offset += 64;
    }

    // Face keyframes
    this._setUint32(normalizedData.faceKeyframes.length);
    for (const keyframe of normalizedData.faceKeyframes) {
      this.writeString(keyframe.name, 15);
      this._setUint32(keyframe.frameNum);
      this._setFloat(keyframe.weight);
    }

    // Camera keyframes
    this._setUint32(normalizedData.cameraKeyframes ? normalizedData.cameraKeyframes.length : 0);
    if (normalizedData.cameraKeyframes) {
      for (const keyframe of normalizedData.cameraKeyframes) {
        this._setUint32(keyframe.frameNum);
        this._setFloat(keyframe.distance);
        this._setFloat(keyframe.target[0]);
        this._setFloat(keyframe.target[1]);
        this._setFloat(-keyframe.target[2]);  // Z-Flip
        this._setFloat(keyframe.rotation[0]);
        this._setFloat(keyframe.rotation[1]);
        this._setFloat(keyframe.rotation[2]);
        const bytes = new Uint8Array(this.buffer, this.offset, 24);
        bytes.set(keyframe.interpolation);
        this.offset += 24;
        this._setUint32(Math.round(keyframe.fov ?? 0));
        this._setUint8(keyframe.perspective);
      }
    }

    // Light keyframes
    this._setUint32(normalizedData.lightKeyframes ? normalizedData.lightKeyframes.length : 0);
    if (normalizedData.lightKeyframes) {
      for (const keyframe of normalizedData.lightKeyframes) {
        const position = resolveVmdLightExportPosition(keyframe);
        this._setUint32(keyframe.frameNum);
        this._setFloat(keyframe.color[0]);
        this._setFloat(keyframe.color[1]);
        this._setFloat(keyframe.color[2]);
        this._setFloat(position[0]);
        this._setFloat(position[1]);
        this._setFloat(-position[2]);  // Z-Flip
      }
    }

    // Self-shadow keyframes
    this._setUint32(normalizedData.selfShadowKeyframes ? normalizedData.selfShadowKeyframes.length : 0);
    if (normalizedData.selfShadowKeyframes) {
      for (const keyframe of normalizedData.selfShadowKeyframes) {
        this._setUint32(keyframe.frameNum);
        this._setUint8(keyframe.mode);
        this._setFloat(keyframe.distance);
      }
    }

    return this.buffer.slice(0, this.offset);
  }

  _setUint8(val) { this.view.setUint8(this.offset, val); this.offset += 1; }
  _setUint32(val) { this.view.setUint32(this.offset, val, true); this.offset += 4; }
  _setFloat(val) { this.view.setFloat32(this.offset, val, true); this.offset += 4; }

  writeString(str, len) {
    const sjisBytes = Encoding.convert(Encoding.stringToCode(str), {
      to: 'SJIS',
      from: 'UNICODE'
    });
    const buf = new Uint8Array(len);
    buf.set(sjisBytes.slice(0, Math.min(sjisBytes.length, len)));
    new Uint8Array(this.buffer, this.offset, len).set(buf);
    this.offset += len;
  }
}

/**
 * VMD 書き出し用の light position を解決します。
 * UI/runtime が保持している position を優先し、足りない場合のみ補助情報から補完します。
 * @param {object|null|undefined} keyframe - VMD light keyframe。
 * @returns {number[]} 書き出し用 position。
 */
function resolveVmdLightExportPosition(keyframe) {
  if (keyframe?.position && typeof keyframe.position.length === 'number' && keyframe.position.length >= 3) {
    return [
      Number(keyframe.position[0]) || 0,
      Number(keyframe.position[1]) || 0,
      Number(keyframe.position[2]) || 0,
    ];
  }
  if (keyframe?.direction && typeof keyframe.direction.length === 'number' && keyframe.direction.length >= 3) {
    return createVmdLightPositionFromDirectionalLight(keyframe.direction);
  }
  if (keyframe?.rotation && typeof keyframe.rotation.length === 'number' && keyframe.rotation.length >= 4) {
    return createVmdLightPositionFromRotation(keyframe.rotation);
  }
  return createVmdLightPositionFromDirectionalLight(null);
}
