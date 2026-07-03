/**
 * VMD Loader
 */
import { normalizeVmdLightKeyframe } from '../../core/scene/light-object.js';

export class VMDLoader {
  constructor() {
    this.offset = 0;
  }

  async load(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load VMD: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return this.parse(buffer);
  }

  parse(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;

    // Header
    const signature = this.readString(30, 'shift-jis');
    const modelName = this.readString(signature === 'Vocaloid Motion Data file' ? 10 : 20, 'shift-jis');

    // Bone keyframes
    const boneKeyframeCount = this.offset + 4 <= this.view.byteLength ? this._getUint32() : 0;
    const boneKeyframes = [];
    for (let i = 0; i < boneKeyframeCount; i++) {
        if (this.offset + 73 > this.view.byteLength) break;
        boneKeyframes.push({
            boneName: this.readString(15, 'shift-jis'),
            frameNum: this._getUint32(),
            position: [this._getFloat(), this._getFloat(), -this._getFloat()], // Z Flip
            rotation: [-this._getFloat(), -this._getFloat(), this._getFloat(), this._getFloat()], // LH to RH flip (negate X, Y)
            interpolation: new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, 64)
        });
        this.offset += 64;
    }

    // Face keyframes
    const faceKeyframeCount = this.offset + 4 <= this.view.byteLength ? this._getUint32() : 0;
    const faceKeyframes = [];
    for (let i = 0; i < faceKeyframeCount; i++) {
        if (this.offset + 23 > this.view.byteLength) break;
        faceKeyframes.push({
            name: this.readString(15, 'shift-jis'),
            frameNum: this._getUint32(),
            weight: this._getFloat()
        });
    }

    // Camera keyframes
    const cameraKeyframeCount = this.offset + 4 <= this.view.byteLength ? this._getUint32() : 0;
    const cameraKeyframes = [];
    for (let i = 0; i < cameraKeyframeCount; i++) {
        if (this.offset + 61 > this.view.byteLength) break;
        cameraKeyframes.push({
            frameNum: this._getUint32(),
            distance: this._getFloat(),
            target: [this._getFloat(), this._getFloat(), -this._getFloat()], // Z Flip
            rotation: [this._getFloat(), this._getFloat(), this._getFloat()],
            interpolation: new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, 24)
        });
        this.offset += 24;
        const cam = cameraKeyframes[cameraKeyframes.length - 1];
        cam.fov = this._getUint32();
        cam.perspective = this._getUint8();
    }

    // Light keyframes
    const lightKeyframeCount = this.offset + 4 <= this.view.byteLength ? this._getUint32() : 0;
    const lightKeyframes = [];
    for (let i = 0; i < lightKeyframeCount; i++) {
        if (this.offset + 28 > this.view.byteLength) break;
        const lightKeyframe = normalizeVmdLightKeyframe({
            frameNum: this._getUint32(),
            color: [this._getFloat(), this._getFloat(), this._getFloat()],
            position: [this._getFloat(), this._getFloat(), -this._getFloat()]
        });
        lightKeyframes.push(lightKeyframe);
    }

    // Self-shadow keyframes
    const selfShadowKeyframeCount = this.offset + 4 <= this.view.byteLength ? this._getUint32() : 0;
    const selfShadowKeyframes = [];
    for (let i = 0; i < selfShadowKeyframeCount; i++) {
        if (this.offset + 9 > this.view.byteLength) break;
        selfShadowKeyframes.push({
            frameNum: this._getUint32(),
            mode: this._getUint8(),
            distance: this._getFloat()
        });
    }

    return { signature, modelName, boneKeyframes, faceKeyframes, cameraKeyframes, lightKeyframes, selfShadowKeyframes, readBytes: this.offset };
  }

  _getUint8() { const val = this.view.getUint8(this.offset); this.offset += 1; return val; }
  _getUint32() { const val = this.view.getUint32(this.offset, true); this.offset += 4; return val; }
  _getFloat() { const val = this.view.getFloat32(this.offset, true); this.offset += 4; return val; }

  readString(len, encoding = 'utf-8') {
    const arr = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    const nullIndex = arr.indexOf(0);
    const subarr = nullIndex !== -1 ? arr.subarray(0, nullIndex) : arr;
    return new TextDecoder(encoding).decode(subarr);
  }
}
