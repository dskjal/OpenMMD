import * as EncodingModule from '../../lib/encoding.min.js';
import { quat, vec3 } from '../../lib/esm/index.js';

const Encoding = EncodingModule.default || globalThis.Encoding || EncodingModule;

const VPD_SIGNATURE = 'Vocaloid Pose Data file';
const DEFAULT_MODEL_NAME = 'pose';

/**
 * VPD 書き出し用のボーン姿勢データを組み立てます。
 * @param {object|null} instance - モデルインスタンス。
 * @param {Array<number>} selectedBoneIndices - 書き出すボーン index 一覧。
 * @returns {{modelName: string, bones: Array<{name: string, position: number[], rotation: number[]}>, boneCount: number}} 書き出し用データ。
 */
export function buildVpdPoseData(instance, selectedBoneIndices) {
  const model = instance?.model ?? null;
  const scene = instance?.scene ?? null;
  const modelName = String(model?.name || '').trim();
  const bones = [];
  const seen = new Set();
  const candidateIndices = Array.isArray(selectedBoneIndices) ? selectedBoneIndices : [];

  for (const boneIndex of candidateIndices) {
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || seen.has(boneIndex)) {
      continue;
    }
    seen.add(boneIndex);

    const bone = model?.bones?.[boneIndex] ?? null;
    const local = scene?.boneLocalTransforms?.[boneIndex] ?? null;
    if (!bone?.name || !local) {
      continue;
    }

    const position = vec3.add(vec3.create(), local.translation, local.manualTranslation);
    const rotation = quat.multiply(quat.create(), local.manualRotation, local.rotation);
    bones.push({
      name: bone.name,
      position: [position[0], position[1], position[2]],
      rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
    });
  }

  return {
    modelName,
    bones,
    boneCount: bones.length,
  };
}

/**
 * VPD (Vocaloid Pose Data) writer.
 */
export class VPDWriter {
  /**
   * VPD データを Shift-JIS テキストへ書き出します。
   * @param {{modelName?: string, bones?: Array<{name: string, position: ArrayLike<number>, rotation: ArrayLike<number>}>}} data - 書き出し対象。
   * @returns {ArrayBuffer} VPD バイナリ。
   */
  write(data) {
    const text = this._buildText(data);
    const sjisBytes = Encoding.convert(Encoding.stringToCode(text), {
      to: 'SJIS',
      from: 'UNICODE',
    });
    const bytes = sjisBytes instanceof Uint8Array ? sjisBytes : Uint8Array.from(sjisBytes);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /**
   * VPD テキストを構築します。
   * @param {{modelName?: string, bones?: Array<{name: string, position: ArrayLike<number>, rotation: ArrayLike<number>}>}} data - 書き出し対象。
   * @returns {string} VPD テキスト。
   */
  _buildText(data) {
    const bones = Array.isArray(data?.bones) ? data.bones : [];
    const headerModelName = this._resolveHeaderModelName(data?.modelName);
    const lines = [
      VPD_SIGNATURE,
      '',
      `${headerModelName};\t\t// model name`,
      `${bones.length};\t\t\t// bone count`,
      '',
    ];

    bones.forEach((bone, index) => {
      lines.push(`Bone${index}{${String(bone?.name || '').trim()}`);
      lines.push(`  ${this._formatPositionLine(bone?.position)};\t\t\t\t// trans x,y,z`);
      lines.push(`  ${this._formatRotationLine(bone?.rotation)};\t\t// Quaternion x,y,z,w`);
      lines.push('}');
      lines.push('');
    });

    return `${lines.join('\r\n')}\r\n`;
  }

  /**
   * VPD の位置行を整形します。
   * @param {ArrayLike<number>} position - 位置。
   * @returns {string} 行テキスト。
   */
  _formatPositionLine(position) {
    const values = this._normalizeVector3(position);
    return `${this._formatFloat(values[0])},${this._formatFloat(values[1])},${this._formatFloat(-values[2])}`;
  }

  /**
   * VPD の回転行を整形します。
   * @param {ArrayLike<number>} rotation - クォータニオン。
   * @returns {string} 行テキスト。
   */
  _formatRotationLine(rotation) {
    const values = this._normalizeQuaternion(rotation);
    return `${this._formatFloat(-values[0])},${this._formatFloat(-values[1])},${this._formatFloat(values[2])},${this._formatFloat(values[3])}`;
  }

  /**
   * 3 要素ベクトルを正規化します。
   * @param {ArrayLike<number>} value - 入力値。
   * @returns {number[]} 3 要素配列。
   */
  _normalizeVector3(value) {
    const x = Number(value?.[0]);
    const y = Number(value?.[1]);
    const z = Number(value?.[2]);
    return [
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
    ];
  }

  /**
   * 4 要素クォータニオンを正規化します。
   * @param {ArrayLike<number>} value - 入力値。
   * @returns {number[]} 4 要素配列。
   */
  _normalizeQuaternion(value) {
    const x = Number(value?.[0]);
    const y = Number(value?.[1]);
    const z = Number(value?.[2]);
    const w = Number(value?.[3]);
    return [
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
      Number.isFinite(w) ? w : 1,
    ];
  }

  /**
   * 浮動小数を VPD 向けに整形します。
   * @param {number} value - 値。
   * @returns {string} 整形済み文字列。
   */
  _formatFloat(value) {
    const safeValue = Number.isFinite(value) ? value : 0;
    return safeValue.toFixed(6);
  }

  /**
   * ヘッダ用モデル名を解決します。
   * @param {string} modelName - 入力モデル名。
   * @returns {string} `.osm` 付きモデル名。
   */
  _resolveHeaderModelName(modelName) {
    const trimmed = String(modelName || '').trim();
    if (!trimmed) {
      return `${DEFAULT_MODEL_NAME}.osm`;
    }

    if (trimmed.toLowerCase().endsWith('.osm')) {
      return trimmed;
    }

    return `${trimmed}.osm`;
  }
}
