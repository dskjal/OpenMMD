import { GLTFModelLoader } from './gltf-loader.js';
import { parseVrmSpringBone } from '../../core/physics/vrm-springbone.js';
import { resolveExpectedVrmHumanoidChildBoneIndex } from '../../shared/bones/vrm-child-bone-utils.js';

const MTOON_SHADER_NAME = 'mtoon-shader.wgsl';
const BONE_FLAG_TRANSLATABLE = 0x0004;
const GLTF_VERTEX_STRIDE = 27;
const VRM_DISPLAY_FRAME_GROUPS = Object.freeze([
  {
    name: '胴',
    nameEn: 'Torso',
    boneNames: Object.freeze(['hips', 'spine', 'chest', 'upperChest', 'neck']),
  },
  {
    name: '頭',
    nameEn: 'Head',
    boneNames: Object.freeze(['head', 'leftEye', 'rightEye', 'jaw']),
  },
  {
    name: '脚',
    nameEn: 'Legs',
    boneNames: Object.freeze([
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot',
      'leftToes',
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot',
      'rightToes',
    ]),
  },
  {
    name: '腕',
    nameEn: 'Arms',
    boneNames: Object.freeze([
      'leftShoulder',
      'leftUpperArm',
      'leftLowerArm',
      'leftHand',
      'rightShoulder',
      'rightUpperArm',
      'rightLowerArm',
      'rightHand',
    ]),
  },
  {
    name: '指',
    nameEn: 'Fingers',
    boneNames: Object.freeze([
      'leftThumbMetacarpal',
      'leftThumbProximal',
      'leftThumbDistal',
      'leftIndexProximal',
      'leftIndexIntermediate',
      'leftIndexDistal',
      'leftMiddleProximal',
      'leftMiddleIntermediate',
      'leftMiddleDistal',
      'leftRingProximal',
      'leftRingIntermediate',
      'leftRingDistal',
      'leftLittleProximal',
      'leftLittleIntermediate',
      'leftLittleDistal',
      'rightThumbMetacarpal',
      'rightThumbProximal',
      'rightThumbDistal',
      'rightIndexProximal',
      'rightIndexIntermediate',
      'rightIndexDistal',
      'rightMiddleProximal',
      'rightMiddleIntermediate',
      'rightMiddleDistal',
      'rightRingProximal',
      'rightRingIntermediate',
      'rightRingDistal',
      'rightLittleProximal',
      'rightLittleIntermediate',
      'rightLittleDistal',
    ]),
  },
]);
const VRM_EXPRESSION_DISPLAY_FRAME_NAME = 'Expressions';

/**
 * VRM ファイルを OpenMMD の内部モデルへ変換します。
 */
export class VRMModelLoader {
  /**
   * @param {object|null} [options={}] - ローダー設定。
   */
  constructor(options = {}) {
    this.options = { ...options };
    this.options.addVrmHelperBones = true;
    this.gltfLoader = new GLTFModelLoader(this.options);
  }

  /**
   * VRM ファイルを URL から読み込みます。
   * @param {string} url - 読み込み先。
   * @param {object|null} [fileProvider=null] - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<object>} 変換済みモデル。
   */
  async load(url, fileProvider = null) {
    const response = await fetch(encodeURI(url));
    if (!response.ok) {
      throw new Error(`Failed to load VRM: ${response.status} ${response.statusText} (${url})`);
    }

    return await this.parse(await response.arrayBuffer(), url, fileProvider);
  }

  /**
   * VRM バイナリを変換します。
   * @param {ArrayBuffer} input - VRM バイナリ。
   * @param {string} [sourcePath=''] - 元ファイル名または URL。
   * @param {object|null} [fileProvider=null] - ZIP 内ファイル解決ヘルパー。
   * @returns {Promise<object>} 変換済みモデル。
   */
  async parse(input, sourcePath = '', fileProvider = null) {
    if (!(input instanceof ArrayBuffer)) {
      throw new Error('VRM loader expects a GLB/VRM ArrayBuffer.');
    }

    const gltfJson = parseGlbJson(input);
    const model = await this.gltfLoader.parse(input, sourcePath, fileProvider);
    applyVrmMetadata(model, gltfJson);
    applyVrmExpressions(model, gltfJson);
    applyVrm0ShoulderSubtreeLocalBasisNormalization(model);
    applyVrmPreferredTailIndices(model);
    applyVrmMaterials(model, gltfJson);
    applyVrmBoneTranslatability(model);
    applyVrmDisplayFrames(model);
    applyVrmXZFlipNormalization(model);
    return model;
  }
}

/**
 * VRM を将来の内部向きへ寄せるため XZ Flip を適用します。
 * @param {object} model - 変換済みモデル。
 */
function applyVrmXZFlipNormalization(model) {
  if (model?.magic !== 'Vrm') {
    return;
  }

  flipVrmVertexBufferXZ(model?.vertices);
  flipVrmBonesXZ(model?.bones);
  flipVrmMorphsXZ(model?.morphs);
  flipVrmExpressionDefinitionsXZ(model?.vrm?.expressions);
  flipVrmSpringBoneXZ(model?.vrm?.springBone);
  flipVrmMorphTargetOffsetsXZ(model?.gltfAssetContext?.morphTargetOffsets);
}

/**
 * GLB/VRM の JSON チャンクを取り出します。
 * @param {ArrayBuffer} input - VRM バイナリ。
 * @returns {object} glTF JSON。
 */
function parseGlbJson(input) {
  const view = new DataView(input);
  const magic = readAscii(input, 0, 4);
  if (magic !== 'glTF') {
    throw new Error('VRM file is not a valid GLB container.');
  }

  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version for VRM: ${version}`);
  }

  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = readAscii(input, 16, 4);
  if (jsonChunkType !== 'JSON') {
    throw new Error('VRM GLB JSON chunk is missing.');
  }

  const jsonText = new TextDecoder('utf-8').decode(new Uint8Array(input, 20, jsonChunkLength));
  return JSON.parse(jsonText);
}

/**
 * ArrayBuffer から ASCII 文字列を読み込みます。
 * @param {ArrayBuffer} input - バイナリ。
 * @param {number} offset - 開始位置。
 * @param {number} length - 長さ。
 * @returns {string} ASCII 文字列。
 */
function readAscii(input, offset, length) {
  return new TextDecoder('ascii').decode(new Uint8Array(input, offset, length));
}

/**
 * モデルへ VRM メタデータを設定します。
 * @param {object} model - 変換済みモデル。
 * @param {object} gltfJson - glTF JSON。
 */
function applyVrmMetadata(model, gltfJson) {
  const rootExtensions = gltfJson?.extensions || {};
  const vrm0 = rootExtensions.VRM || null;
  const vrm1 = rootExtensions.VRMC_vrm || null;
  const version = vrm1 ? 'vrm1' : vrm0 ? 'vrm0' : 'none';

  model.magic = 'Vrm';
  model.vrm = {
    version,
    meta: vrm1?.meta || vrm0?.meta || null,
    specVersion: vrm1?.specVersion || vrm0?.specVersion || '',
    materialProperties: Array.isArray(vrm0?.materialProperties) ? vrm0.materialProperties : [],
    humanoidBoneNameMap: buildVrmHumanoidBoneNameMap(model, vrm1?.humanoid || vrm0?.humanoid || null),
    expressions: {
      preset: Object.create(null),
      custom: Object.create(null),
    },
    springBone: parseVrmSpringBone(model, gltfJson),
    humanoidBoneMapMissing: false,
    humanoidBoneMapMissingNotified: false,
  };
  model.vrm.humanoidBoneMapMissing = (
    (vrm1?.humanoid || vrm0?.humanoid) && Object.keys(model.vrm.humanoidBoneNameMap).length === 0
  );
  model.gltfAssetContext = {
    ...(model.gltfAssetContext || {}),
    vrmVersion: version,
    sourceHandedness: 'right',
  };
}

/**
 * VRM expression 定義を内部 morph へ展開します。
 * @param {object} model - 変換済みモデル。
 * @param {object} gltfJson - glTF JSON。
 */
function applyVrmExpressions(model, gltfJson) {
  if (model?.magic !== 'Vrm') {
    return;
  }

  const expressionSource = resolveVrmExpressionSource(gltfJson);
  const presetEntries = Object.entries(expressionSource?.preset || {});
  const customEntries = Object.entries(expressionSource?.custom || {});
  const morphTargetOffsets = model?.gltfAssetContext?.morphTargetOffsets || {};
  const gltfMaterialIndexToModelIndex = buildGltfMaterialIndexToModelIndexMap(model);
  const morphs = [];
  const presetExpressions = Object.create(null);
  const customExpressions = Object.create(null);

  for (const [expressionName, rawDefinition] of presetEntries) {
    const normalized = normalizeVrmExpressionDefinition(
      expressionName,
      'preset',
      rawDefinition,
      morphTargetOffsets,
      gltfMaterialIndexToModelIndex,
    );
    if (!normalized) {
      continue;
    }
    presetExpressions[expressionName] = normalized.definition;
    morphs.push(createVrmExpressionMorph(normalized.definition));
  }

  for (const [expressionName, rawDefinition] of customEntries) {
    const normalized = normalizeVrmExpressionDefinition(
      expressionName,
      'custom',
      rawDefinition,
      morphTargetOffsets,
      gltfMaterialIndexToModelIndex,
    );
    if (!normalized) {
      continue;
    }
    customExpressions[expressionName] = normalized.definition;
    morphs.push(createVrmExpressionMorph(normalized.definition));
  }

  model.vrm.expressions = {
    preset: presetExpressions,
    custom: customExpressions,
  };
  model.morphs = morphs;
}

/**
 * VRM 1.0 / 0.x の expression 定義ソースを返します。
 * @param {object} gltfJson - glTF JSON。
 * @returns {object} expression source。
 */
function resolveVrmExpressionSource(gltfJson) {
  const rootExtensions = gltfJson?.extensions || {};
  if (rootExtensions?.VRMC_vrm?.expressions) {
    return rootExtensions.VRMC_vrm.expressions;
  }

  const blendShapeGroups = Array.isArray(rootExtensions?.VRM?.blendShapeMaster?.blendShapeGroups)
    ? rootExtensions.VRM.blendShapeMaster.blendShapeGroups
    : [];
  if (blendShapeGroups.length === 0) {
    return {
      preset: {},
      custom: {},
    };
  }

  const preset = {};
  const custom = {};
  for (const group of blendShapeGroups) {
    const expressionName = normalizeVrm0ExpressionName(group?.presetName || group?.name || '');
    if (!expressionName) {
      continue;
    }
    const target = isVrmPresetExpressionName(expressionName) ? preset : custom;
    target[expressionName] = {
      isBinary: Boolean(group?.isBinary),
      binds: Array.isArray(group?.binds) ? group.binds.map((bind) => ({
        mesh: Number(bind?.mesh),
        index: Number(bind?.index),
        weight: Number(bind?.weight) / 100,
      })) : [],
      materialValues: [],
    };
  }

  return {
    preset,
    custom,
  };
}

/**
 * expression 定義を内部表現へ正規化します。
 * @param {string} expressionName - expression 名。
 * @param {'preset'|'custom'} expressionType - expression 種別。
 * @param {object} rawDefinition - 元定義。
 * @param {object} morphTargetOffsets - morph target offset 対応表。
 * @param {Map<number, number>} gltfMaterialIndexToModelIndex - glTF material -> model material 対応。
 * @returns {{definition: object}|null} 正規化結果。
 */
function normalizeVrmExpressionDefinition(
  expressionName,
  expressionType,
  rawDefinition,
  morphTargetOffsets,
  gltfMaterialIndexToModelIndex,
) {
  const normalizedExpressionName = String(expressionName || '').trim();
  if (!normalizedExpressionName) {
    return null;
  }

  const vertexOffsets = [];
  const morphTargetBinds = Array.isArray(rawDefinition?.morphTargetBinds)
    ? rawDefinition.morphTargetBinds
    : Array.isArray(rawDefinition?.binds)
      ? rawDefinition.binds
      : [];
  for (const bind of morphTargetBinds) {
    const nodeIndex = Number.isInteger(bind?.node) ? bind.node : -1;
    const meshIndex = Number.isInteger(bind?.mesh) ? bind.mesh : -1;
    const targetIndex = Number(bind?.index);
    const bindWeight = Number.isFinite(Number(bind?.weight)) ? Number(bind.weight) : 0;
    const key = nodeIndex >= 0
      ? `${nodeIndex}:${targetIndex}`
      : meshIndex >= 0
        ? `mesh:${meshIndex}:${targetIndex}`
        : '';
    if (!key) {
      continue;
    }
    const offsets = Array.isArray(morphTargetOffsets[key]) ? morphTargetOffsets[key] : [];
    for (const offset of offsets) {
      vertexOffsets.push({
        index: Number(offset?.index) || 0,
        position: scaleVector3(offset?.position, bindWeight),
      });
    }
  }

  const materialColorBinds = normalizeVrmMaterialColorBinds(rawDefinition?.materialColorBinds, gltfMaterialIndexToModelIndex);
  const textureTransformBinds = normalizeVrmTextureTransformBinds(rawDefinition?.textureTransformBinds, gltfMaterialIndexToModelIndex);
  const definition = {
    expressionName: normalizedExpressionName,
    expressionType,
    isBinary: Boolean(rawDefinition?.isBinary),
    overrideBlink: normalizeVrmOverrideMode(rawDefinition?.overrideBlink),
    overrideLookAt: normalizeVrmOverrideMode(rawDefinition?.overrideLookAt),
    overrideMouth: normalizeVrmOverrideMode(rawDefinition?.overrideMouth),
    vertexOffsets,
    materialColorBinds,
    textureTransformBinds,
    uiGroup: resolveVrmExpressionUiGroup(normalizedExpressionName, expressionType),
  };
  return { definition };
}

/**
 * VRM expression 用 morph を作成します。
 * @param {object} definition - 正規化済み定義。
 * @returns {object} 内部 morph。
 */
function createVrmExpressionMorph(definition) {
  return {
    name: definition.expressionName,
    panelType: 4,
    type: 100,
    vrmExpressionName: definition.expressionName,
    vrmExpressionType: definition.expressionType,
    vrmUiGroup: definition.uiGroup,
    vrmExpressionDefinition: definition,
    offsets: [],
  };
}

/**
 * glTF material index から model material index への対応表を作ります。
 * @param {object} model - モデル。
 * @returns {Map<number, number>} 対応表。
 */
function buildGltfMaterialIndexToModelIndexMap(model) {
  const result = new Map();
  for (let index = 0; index < (Array.isArray(model?.materials) ? model.materials.length : 0); index++) {
    const gltfMaterialIndex = Number(model.materials[index]?.gltfMaterialIndex);
    if (Number.isInteger(gltfMaterialIndex) && gltfMaterialIndex >= 0) {
      result.set(gltfMaterialIndex, index);
    }
  }
  return result;
}

/**
 * VRM material color bind を正規化します。
 * @param {Array<object>|null|undefined} binds - bind 一覧。
 * @param {Map<number, number>} gltfMaterialIndexToModelIndex - glTF material -> model material 対応。
 * @returns {Array<object>} 正規化済み bind。
 */
function normalizeVrmMaterialColorBinds(binds, gltfMaterialIndexToModelIndex) {
  if (!Array.isArray(binds)) {
    return [];
  }
  const result = [];
  for (const bind of binds) {
    const gltfMaterialIndex = Number(bind?.material);
    const modelMaterialIndex = gltfMaterialIndexToModelIndex.get(gltfMaterialIndex);
    if (!Number.isInteger(modelMaterialIndex)) {
      continue;
    }
    result.push({
      materialIndex: modelMaterialIndex,
      type: String(bind?.type || '').trim(),
      targetValue: Array.isArray(bind?.targetValue) ? bind.targetValue.map((value) => Number(value) || 0) : [],
    });
  }
  return result;
}

/**
 * VRM texture transform bind を正規化します。
 * @param {Array<object>|null|undefined} binds - bind 一覧。
 * @param {Map<number, number>} gltfMaterialIndexToModelIndex - glTF material -> model material 対応。
 * @returns {Array<object>} 正規化済み bind。
 */
function normalizeVrmTextureTransformBinds(binds, gltfMaterialIndexToModelIndex) {
  if (!Array.isArray(binds)) {
    return [];
  }
  const result = [];
  for (const bind of binds) {
    const gltfMaterialIndex = Number(bind?.material);
    const modelMaterialIndex = gltfMaterialIndexToModelIndex.get(gltfMaterialIndex);
    if (!Number.isInteger(modelMaterialIndex)) {
      continue;
    }
    result.push({
      materialIndex: modelMaterialIndex,
      scale: normalizeVector2(bind?.scale, [1, 1]),
      offset: normalizeVector2(bind?.offset, [0, 0]),
    });
  }
  return result;
}

/**
 * オーバーライドモードを正規化します。
 * @param {unknown} value - 元値。
 * @returns {'none'|'block'|'blend'} 正規化済みモード。
 */
function normalizeVrmOverrideMode(value) {
  const normalizedValue = String(value || 'none').trim().toLowerCase();
  if (normalizedValue === 'block' || normalizedValue === 'blend') {
    return normalizedValue;
  }
  return 'none';
}

/**
 * expression の UI グループ名を返します。
 * @param {string} expressionName - expression 名。
 * @param {'preset'|'custom'} expressionType - expression 種別。
 * @returns {string} UI グループ名。
 */
function resolveVrmExpressionUiGroup(expressionName, expressionType) {
  if (expressionType === 'custom') {
    return 'custom';
  }
  if (['happy', 'angry', 'sad', 'relaxed', 'surprised'].includes(expressionName)) {
    return 'emotion';
  }
  if (['aa', 'ih', 'ou', 'ee', 'oh'].includes(expressionName)) {
    return 'lip-sync';
  }
  if (['blink', 'blinkLeft', 'blinkRight'].includes(expressionName)) {
    return 'blink';
  }
  if (['lookUp', 'lookDown', 'lookLeft', 'lookRight'].includes(expressionName)) {
    return 'look-at';
  }
  return 'other';
}

/**
 * expression 名が preset かどうかを返します。
 * @param {string} expressionName - expression 名。
 * @returns {boolean} preset なら true。
 */
function isVrmPresetExpressionName(expressionName) {
  return [
    'happy',
    'angry',
    'sad',
    'relaxed',
    'surprised',
    'aa',
    'ih',
    'ou',
    'ee',
    'oh',
    'blink',
    'blinkLeft',
    'blinkRight',
    'lookUp',
    'lookDown',
    'lookLeft',
    'lookRight',
    'neutral',
  ].includes(String(expressionName || '').trim());
}

/**
 * VRM 0.x expression 名を VRM 1.0 相当へ正規化します。
 * @param {string} expressionName - 元 expression 名。
 * @returns {string} 正規化済み expression 名。
 */
function normalizeVrm0ExpressionName(expressionName) {
  const normalizedName = String(expressionName || '').trim().toLowerCase();
  const aliasMap = {
    a: 'aa',
    i: 'ih',
    u: 'ou',
    e: 'ee',
    o: 'oh',
    joy: 'happy',
    sorrow: 'sad',
    fun: 'relaxed',
    lookup: 'lookUp',
    lookdown: 'lookDown',
    lookleft: 'lookLeft',
    lookright: 'lookRight',
    blink_l: 'blinkLeft',
    blink_r: 'blinkRight',
  };
  return aliasMap[normalizedName] || normalizedName;
}

/**
 * ベクトル3を重み付きでスケーリングします。
 * @param {ArrayLike<number>|null|undefined} value - 元ベクトル。
 * @param {number} scale - スケール値。
 * @returns {number[]} スケール済みベクトル。
 */
function scaleVector3(value, scale) {
  return [
    (Number(value?.[0]) || 0) * scale,
    (Number(value?.[1]) || 0) * scale,
    (Number(value?.[2]) || 0) * scale,
  ];
}

/**
 * ベクトル2を正規化します。
 * @param {ArrayLike<number>|null|undefined} value - 元ベクトル。
 * @param {number[]} fallback - 既定値。
 * @returns {number[]} 正規化済みベクトル。
 */
function normalizeVector2(value, fallback) {
  return [
    Number(value?.[0]) || fallback[0],
    Number(value?.[1]) || fallback[1],
  ];
}

/**
 * VRM 頂点バッファへ XZ Flip を適用します。
 * @param {Float32Array|null|undefined} vertices - 頂点バッファ。
 */
function flipVrmVertexBufferXZ(vertices) {
  if (!vertices || typeof vertices.length !== 'number') {
    return;
  }

  for (let offset = 0; offset + GLTF_VERTEX_STRIDE <= vertices.length; offset += GLTF_VERTEX_STRIDE) {
    flipNumberInPlace(vertices, offset);
    flipNumberInPlace(vertices, offset + 2);
    flipNumberInPlace(vertices, offset + 3);
    flipNumberInPlace(vertices, offset + 5);
    flipNumberInPlace(vertices, offset + 17);
    flipNumberInPlace(vertices, offset + 19);
    flipNumberInPlace(vertices, offset + 20);
    flipNumberInPlace(vertices, offset + 22);
    flipNumberInPlace(vertices, offset + 23);
    flipNumberInPlace(vertices, offset + 25);
  }
}

/**
 * VRM ボーンへ XZ Flip を適用します。
 * @param {Array<object>|null|undefined} bones - ボーン配列。
 */
function flipVrmBonesXZ(bones) {
  if (!Array.isArray(bones)) {
    return;
  }

  for (const bone of bones) {
    if (!bone || typeof bone !== 'object') {
      continue;
    }
    flipVector3XZInPlace(bone.position);
    flipVector3XZInPlace(bone.tailOffset);
  }
}

/**
 * VRM morph へ XZ Flip を適用します。
 * @param {Array<object>|null|undefined} morphs - morph 配列。
 */
function flipVrmMorphsXZ(morphs) {
  if (!Array.isArray(morphs)) {
    return;
  }

  for (const morph of morphs) {
    if (!morph || typeof morph !== 'object') {
      continue;
    }
    for (const offset of Array.isArray(morph.offsets) ? morph.offsets : []) {
      if (!offset || typeof offset !== 'object') {
        continue;
      }
      flipVector3XZInPlace(offset.position);
      flipVector3XZInPlace(offset.translation);
    }
  }
}

/**
 * VRM expression 定義へ XZ Flip を適用します。
 * @param {object|null|undefined} expressions - VRM expression 定義。
 */
function flipVrmExpressionDefinitionsXZ(expressions) {
  if (!expressions || typeof expressions !== 'object') {
    return;
  }

  for (const groupName of ['preset', 'custom']) {
    const group = expressions[groupName];
    if (!group || typeof group !== 'object') {
      continue;
    }
    for (const definition of Object.values(group)) {
      if (!definition || typeof definition !== 'object') {
        continue;
      }
      for (const offset of Array.isArray(definition.vertexOffsets) ? definition.vertexOffsets : []) {
        if (!offset || typeof offset !== 'object') {
          continue;
        }
        flipVector3XZInPlace(offset.position);
      }
    }
  }
}

/**
 * VRM springBone 定義へ XZ Flip を適用します。
 * @param {object|null|undefined} springBone - springBone 定義。
 */
function flipVrmSpringBoneXZ(springBone) {
  if (!springBone || typeof springBone !== 'object') {
    return;
  }

  for (const collider of Array.isArray(springBone.colliders) ? springBone.colliders : []) {
    if (!collider || typeof collider !== 'object' || !collider.shape || typeof collider.shape !== 'object') {
      continue;
    }
    flipVector3XZInPlace(collider.shape.offset);
    flipVector3XZInPlace(collider.shape.tail);
  }

  for (const spring of Array.isArray(springBone.springs) ? springBone.springs : []) {
    if (!spring || typeof spring !== 'object') {
      continue;
    }
    for (const joint of Array.isArray(spring.joints) ? spring.joints : []) {
      if (!joint || typeof joint !== 'object') {
        continue;
      }
      flipVector3XZInPlace(joint.gravityDir);
    }
  }
}

/**
 * glTF morph target offset 定義へ XZ Flip を適用します。
 * @param {object|null|undefined} morphTargetOffsets - morph target offset map。
 */
function flipVrmMorphTargetOffsetsXZ(morphTargetOffsets) {
  if (!morphTargetOffsets || typeof morphTargetOffsets !== 'object') {
    return;
  }

  for (const offsets of Object.values(morphTargetOffsets)) {
    if (!Array.isArray(offsets)) {
      continue;
    }
    for (const offset of offsets) {
      if (!offset || typeof offset !== 'object') {
        continue;
      }
      flipVector3XZInPlace(offset.position);
    }
  }
}

/**
 * 数値配列の X, Z を反転します。
 * @param {ArrayLike<number>|null|undefined} value - 変換対象。
 */
function flipVector3XZInPlace(value) {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return;
  }

  value[0] = -(Number(value[0]) || 0);
  value[1] = Number(value[1]) || 0;
  value[2] = -(Number(value[2]) || 0);
}

/**
 * 配列中の数値を反転します。
 * @param {ArrayLike<number>} values - 対象配列。
 * @param {number} index - 対象 index。
 */
function flipNumberInPlace(values, index) {
  values[index] = -(Number(values[index]) || 0);
}

/**
 * VRM 0.x の肩サブツリー基底を OpenMMD 用に正規化します。
 * 左肩系は Y 軸 180 度回転相当の +Y up、右肩系は X 軸 180 度回転相当の -Y up へそろえます。
 * @param {object} model - 変換済みモデル。
 * @param {boolean} useRightFlipNormalize - 左右 X 軸反転基底を使うかどうか
 */
function applyVrm0ShoulderSubtreeLocalBasisNormalization(model, useRightFlipNormalize=false) {
  if (model?.magic !== 'Vrm' || model?.vrm?.version !== 'vrm0' || !Array.isArray(model?.bones)) {
    return;
  }

  if (useRightFlipNormalize){
    const leftShoulderIndex = findBoneIndexByName(model, model?.vrm?.humanoidBoneNameMap?.leftShoulder);
    if (leftShoulderIndex >= 0) {
      normalizeShoulderSubtreeLocalBasis(model.bones, leftShoulderIndex, [-1, 0, 0], [0, 1, 0], [0, 0, -1]);
    }
  
    const rightShoulderIndex = findBoneIndexByName(model, model?.vrm?.humanoidBoneNameMap?.rightShoulder);
    if (rightShoulderIndex >= 0) {
      normalizeShoulderSubtreeLocalBasis(model.bones, rightShoulderIndex, [1, 0, 0], [0, -1, 0], [0, 0, -1]);
    }
  }
  else{
    const leftShoulderIndex = findBoneIndexByName(model, model?.vrm?.humanoidBoneNameMap?.leftShoulder);
    if (leftShoulderIndex >= 0) {
      normalizeShoulderSubtreeLocalBasis(model.bones, leftShoulderIndex, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    }
  
    const rightShoulderIndex = findBoneIndexByName(model, model?.vrm?.humanoidBoneNameMap?.rightShoulder);
    if (rightShoulderIndex >= 0) {
      normalizeShoulderSubtreeLocalBasis(model.bones, rightShoulderIndex, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    }
  }
}

/**
 * VRM humanoid の bone 名対応表を構築します。
 * @param {object} model - 変換済みモデル。
 * @param {object|Array<object>|null} humanoid - VRM humanoid 情報。
 * @returns {Object<string, string>} humanoid bone 名から実 bone 名への対応表。
 */
function buildVrmHumanoidBoneNameMap(model, humanoid) {
  const result = Object.create(null);
  const humanBones = getVrmHumanBones(humanoid);
  if (humanBones.length === 0) {
    return result;
  }

  for (const humanBone of humanBones) {
    const humanBoneName = String(humanBone?.boneName || humanBone?.bone || '').trim();
    const nodeIndex = Number.isInteger(humanBone?.node) ? humanBone.node : -1;
    if (!humanBoneName || nodeIndex < 0) {
      continue;
    }

    const boneName = findBoneNameByGltfNodeIndex(model, nodeIndex);
    if (boneName) {
      result[humanBoneName] = boneName;
    }
  }

  return result;
}

/**
 * VRM humanoid の humanBones 一覧を標準化します。
 * @param {object|Array<object>|null} humanoid - VRM humanoid 情報。
 * @returns {Array<object>} humanBones 一覧。
 */
function getVrmHumanBones(humanoid) {
  if (!humanoid || typeof humanoid !== 'object') {
    return [];
  }

  if (Array.isArray(humanoid.humanBones)) {
    return humanoid.humanBones;
  }

  if (humanoid.humanBones && typeof humanoid.humanBones === 'object') {
    return Object.entries(humanoid.humanBones).map(([boneName, value]) => ({
      boneName,
      ...value,
    }));
  }

  return [];
}

/**
 * glTF node index から実際の bone 名を返します。
 * @param {object} model - 変換済みモデル。
 * @param {number} nodeIndex - glTF node index。
 * @returns {string} bone 名。見つからない場合は空文字。
 */
function findBoneNameByGltfNodeIndex(model, nodeIndex) {
  if (!Array.isArray(model?.bones) || !Number.isInteger(nodeIndex) || nodeIndex < 0) {
    return '';
  }

  const bone = model.bones.find((entry) => Number.isInteger(entry?.gltfNodeIndex) && entry.gltfNodeIndex === nodeIndex);
  return String(bone?.name || '').trim();
}

/**
 * モデル内の bone 名から index を返します。
 * @param {object} model - 変換済みモデル。
 * @param {string} boneName - bone 名。
 * @returns {number} bone index。見つからない場合は -1。
 */
function findBoneIndexByName(model, boneName) {
  const normalizedName = String(boneName || '').trim();
  if (!normalizedName || !Array.isArray(model?.bones)) {
    return -1;
  }

  return model.bones.findIndex((bone) => String(bone?.name || '').trim() === normalizedName);
}

/**
 * 肩サブツリー配下のローカル基底を正規化します。
 * @param {Array<object>} bones - ボーン一覧。
 * @param {number} rootIndex - サブツリー root。
 * @param {[number, number, number]} normalizedLocalX - 正規化後 localX。
 * @param {[number, number, number]} normalizedLocalY - 正規化後 localY。
 * @param {[number, number, number]} normalizedLocalZ - 正規化後 localZ。
 */
function normalizeShoulderSubtreeLocalBasis(bones, rootIndex, normalizedLocalX, normalizedLocalY, normalizedLocalZ) {
  if (!Array.isArray(bones) || !Number.isInteger(rootIndex) || rootIndex < 0 || rootIndex >= bones.length) {
    return;
  }

  const stack = [rootIndex];
  const visited = new Set();
  while (stack.length > 0) {
    const boneIndex = stack.pop();
    if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= bones.length || visited.has(boneIndex)) {
      continue;
    }
    visited.add(boneIndex);

    const bone = bones[boneIndex];
    if (bone && typeof bone === 'object') {
      bone.localX = [...normalizedLocalX];
      bone.localY = [...normalizedLocalY];
      bone.localZ = [...normalizedLocalZ];
    }

    for (let childIndex = 0; childIndex < bones.length; childIndex++) {
      if (bones[childIndex]?.parentIndex === boneIndex) {
        stack.push(childIndex);
      }
    }
  }
}


/**
 * VRM 材質情報を内部マテリアルへ反映します。
 * @param {object} model - 変換済みモデル。
 * @param {object} gltfJson - glTF JSON。
 */
function applyVrmMaterials(model, gltfJson) {
  const vrm0MaterialProperties = Array.isArray(gltfJson?.extensions?.VRM?.materialProperties)
    ? gltfJson.extensions.VRM.materialProperties
    : [];
  const gltfMaterials = Array.isArray(gltfJson?.materials) ? gltfJson.materials : [];
  const gltfTextureMap = normalizeGltfTextureIndexMap(model?.gltfAssetContext?.modelTextureIndexByGltfTextureIndex);
  const textureSourcePaths = Array.isArray(model?.textureSources) && model.textureSources.length > 0
    ? model.textureSources
    : (model?.textures || []);
  const vrm0ByName = new Map(vrm0MaterialProperties.map((entry) => [String(entry?.name || ''), entry]));

  for (let index = 0; index < (Array.isArray(model?.materials) ? model.materials.length : 0); index++) {
    const material = model.materials[index];
    const gltfMaterialIndex = Number.isInteger(material?.gltfMaterialIndex) ? material.gltfMaterialIndex : -1;
    const matchedVrm0 = gltfMaterialIndex >= 0
      ? vrm0MaterialProperties[gltfMaterialIndex] || vrm0ByName.get(String(material?.name || '')) || null
      : vrm0ByName.get(String(material?.name || '')) || null;
    const matchedVrm1 = gltfMaterialIndex >= 0
      ? gltfMaterials[gltfMaterialIndex]?.extensions?.VRMC_materials_mtoon || null
      : null;
    const isUnlit = gltfMaterialIndex >= 0
      && Boolean(gltfMaterials[gltfMaterialIndex]?.extensions?.KHR_materials_unlit);

    if (matchedVrm0 && matchedVrm0.shader === 'VRM/MToon') {
      applyVrm0MtoonMaterial(material, matchedVrm0, gltfTextureMap, textureSourcePaths);
    } else if (matchedVrm1) {
      applyVrm1MtoonMaterial(material, matchedVrm1, gltfTextureMap, textureSourcePaths);
    }

    applyVrmUnlitTextureEmissiveFallback(material, textureSourcePaths, isUnlit);
  }
}

/**
 * VRM ボーンの translatable 既定値を hips のみに制限します。
 * @param {object} model - 変換済みモデル。
 */
function applyVrmBoneTranslatability(model) {
  if (model?.magic !== 'Vrm' || !Array.isArray(model?.bones)) {
    return;
  }

  for (const bone of model.bones) {
    if (!bone || typeof bone !== 'object') {
      continue;
    }
    bone.flags = Number.isInteger(bone.flags) ? (bone.flags & ~BONE_FLAG_TRANSLATABLE) : 0;
  }

  const translatableBoneNames = new Set([
    '全ての親',
    String(model?.vrm?.humanoidBoneNameMap?.hips || '').trim(),
  ]);
  for (const boneName of translatableBoneNames) {
    if (!boneName) {
      continue;
    }
    const bone = model.bones.find((entry) => String(entry?.name || '').trim() === boneName);
    if (bone) {
      bone.flags |= BONE_FLAG_TRANSLATABLE;
    }
  }
}

/**
 * VRM humanoid に基づく displayFrame を生成します。
 * @param {object} model - 変換済みモデル。
 */
function applyVrmDisplayFrames(model) {
  if (model?.magic !== 'Vrm' || !Array.isArray(model?.bones)) {
    return;
  }

  const displayFrames = buildVrmDisplayFrames(model);
  if (displayFrames.length > 0) {
    model.displayFrames = displayFrames;
  }
}

/**
 * VRM humanoid の displayFrame 一覧を構築します。
 * @param {object} model - 変換済みモデル。
 * @returns {Array<object>} displayFrame 一覧。
 */
function buildVrmDisplayFrames(model) {
  const humanoidBoneNameMap = model?.vrm?.humanoidBoneNameMap || {};
  const bones = Array.isArray(model?.bones) ? model.bones : [];
  const morphs = Array.isArray(model?.morphs) ? model.morphs : [];
  const boneIndexByName = new Map();
  const morphIndexByName = new Map();
  const usedBoneNames = new Set();
  const usedMorphNames = new Set();
  const displayFrames = [];

  bones.forEach((bone, boneIndex) => {
    const boneName = String(bone?.name || '').trim();
    if (!boneName || boneIndexByName.has(boneName)) {
      return;
    }
    boneIndexByName.set(boneName, boneIndex);
  });

  morphs.forEach((morph, morphIndex) => {
    const morphName = String(morph?.name || '').trim();
    if (!morphName || morphIndexByName.has(morphName)) {
      return;
    }
    morphIndexByName.set(morphName, morphIndex);
  });

  for (const group of VRM_DISPLAY_FRAME_GROUPS) {
    const frames = [];

    for (const humanBoneName of group.boneNames) {
      const boneName = String(humanoidBoneNameMap[humanBoneName] || '').trim();
      if (!boneName || usedBoneNames.has(boneName)) {
        continue;
      }

      const boneIndex = boneIndexByName.get(boneName);
      if (!Number.isInteger(boneIndex) || boneIndex < 0) {
        continue;
      }

      frames.push({ type: 0, index: boneIndex });
      usedBoneNames.add(boneName);
    }

    if (frames.length > 0) {
      displayFrames.push({
        name: group.name,
        nameEn: group.nameEn,
        specialFlag: 0,
        frames,
      });
    }
  }

  const expressionFrames = [];
  morphs.forEach((morph, morphIndex) => {
    const morphName = String(morph?.name || '').trim();
    const isExpressionMorph = Boolean(morph?.vrmExpressionName) || morph?.type === 100;
    if (!morphName || !isExpressionMorph || usedMorphNames.has(morphName)) {
      return;
    }

    const morphIndexResolved = morphIndexByName.get(morphName);
    if (!Number.isInteger(morphIndexResolved) || morphIndexResolved < 0) {
      return;
    }

    expressionFrames.push({ type: 1, index: morphIndexResolved });
    usedMorphNames.add(morphName);
  });

  if (expressionFrames.length > 0) {
    displayFrames.push({
      name: VRM_EXPRESSION_DISPLAY_FRAME_NAME,
      nameEn: VRM_EXPRESSION_DISPLAY_FRAME_NAME,
      specialFlag: 0,
      frames: expressionFrames,
    });
  }

  const restFrames = [];
  bones.forEach((bone, boneIndex) => {
    const boneName = String(bone?.name || '').trim();
    if (!boneName || usedBoneNames.has(boneName)) {
      return;
    }
    restFrames.push({ type: 0, index: boneIndex });
    usedBoneNames.add(boneName);
  });

  if (restFrames.length > 0) {
    displayFrames.push({
      name: 'その他',
      nameEn: 'rest',
      specialFlag: 0,
      frames: restFrames,
    });
  }

  return displayFrames;
}

/**
 * glTF texture index マップを正規化します。
 * @param {object|null|undefined} source - 元マップ。
 * @returns {Map<number, number>} 正規化済みマップ。
 */
function normalizeGltfTextureIndexMap(source) {
  const result = new Map();
  if (!source || typeof source !== 'object') {
    return result;
  }

  for (const [key, value] of Object.entries(source)) {
    const gltfTextureIndex = Number(key);
    const modelTextureIndex = Number(value);
    if (Number.isInteger(gltfTextureIndex) && Number.isInteger(modelTextureIndex)) {
      result.set(gltfTextureIndex, modelTextureIndex);
    }
  }
  return result;
}

/**
 * 旧 VRM 0.x の MToon 設定を反映します。
 * @param {object} material - 内部マテリアル。
 * @param {object} vrmMaterial - VRM materialProperties。
 * @param {Map<number, number>} gltfTextureMap - glTF texture index から内部 texture index への変換表。
 */
function applyVrm0MtoonMaterial(material, vrmMaterial, gltfTextureMap, texturePaths) {
  const floats = vrmMaterial?.floatProperties || {};
  const vectors = vrmMaterial?.vectorProperties || {};
  const textures = vrmMaterial?.textureProperties || {};
  const keywords = vrmMaterial?.keywordMap || {};
  const blendMode = toFiniteNumber(floats._BlendMode, 0);
  const zWrite = toFiniteNumber(floats._ZWrite, 1) > 0.5;
  const alphaMode = resolveVrm0AlphaMode(blendMode);
  const outlineWidth = Math.max(0, toFiniteNumber(floats._OutlineWidth, 0));
  const outlineWidthMode = toFiniteNumber(floats._OutlineWidthMode, 0);
  const outlineColorMode = toFiniteNumber(floats._OutlineColorMode, 0);
  const shadeTextureIndex = resolveModelTextureIndex(textures._ShadeTexture, gltfTextureMap, -1);
  const sphereTextureIndex = resolveModelTextureIndex(textures._SphereAdd, gltfTextureMap, material.sphereIndex);
  const emissiveTextureIndex = resolveModelTextureIndex(textures._EmissionMap, gltfTextureMap, -1);

  material.shaderName = MTOON_SHADER_NAME;
  material.diffuse = clampColor4(vectors._Color, material.diffuse || [1, 1, 1, 1]);
  material.emissive = clampColor3(vectors._EmissionColor, material.emissive || [0, 0, 0]);
  material.emissiveStrength = hasVisibleEmissive(material.emissive) ? 1.0 : (material.emissiveStrength ?? 0.0);
  material.alphaMode = alphaMode;
  material.noCull = toFiniteNumber(floats._CullMode, 2) === 0;
  material.receiveShadow = toFiniteNumber(floats._ReceiveShadowRate, 1) > 0.001;
  material.hasEdge = outlineWidth > 0 && outlineWidthMode > 0;
  material.edgeColor = clampColor4(vectors._OutlineColor, material.edgeColor || [0, 0, 0, 1]);
  material.edgeSize = outlineWidth;
  material.sphereMode = sphereTextureIndex >= 0 ? 2 : (material.sphereMode || 0);
  material.sphereIndex = sphereTextureIndex;
  material.sortIndex = Number.isFinite(vrmMaterial?.renderQueue)
    ? vrmMaterial.renderQueue * 1000 + (Number.isFinite(material.sortIndex) ? material.sortIndex : 0)
    : (Number.isFinite(material.sortIndex) ? material.sortIndex : 0);
  material.mtoon = {
    enabled: true,
    version: 'vrm0',
    transparentWithZWrite: blendMode === 3 || (alphaMode === 'transparent' && zWrite),
    hasShadeMultiplyTexture: shadeTextureIndex >= 0 && Boolean(texturePaths[shadeTextureIndex]),
    shadeColor: clampColor3(vectors._ShadeColor, [1, 1, 1]),
    shadeShift: toFiniteNumber(floats._ShadeShift, 0),
    shadeToony: clamp01(toFiniteNumber(floats._ShadeToony, 0.9)),
    receiveShadowRate: clamp01(toFiniteNumber(floats._ReceiveShadowRate, 1)),
    shadingGradeRate: clamp01(toFiniteNumber(floats._ShadingGradeRate, 1)),
    lightColorAttenuation: clamp01(toFiniteNumber(floats._LightColorAttenuation, 0)),
    indirectLightIntensity: Math.max(0, toFiniteNumber(floats._IndirectLightIntensity, 0.9)),
    rimLightingMix: 1.0,
    outlineWidth,
    outlineScaledMaxDistance: Math.max(0.0001, toFiniteNumber(floats._OutlineScaledMaxDistance, 1)),
    outlineLightingMix: clamp01(toFiniteNumber(floats._OutlineLightingMix, 1)),
    outlineWidthMode,
    outlineColorMode,
    outlineColor: clampColor3(vectors._OutlineColor, [0, 0, 0]),
    rimColor: [0, 0, 0],
    renderQueueOffsetNumber: Number.isFinite(vrmMaterial?.renderQueue) ? vrmMaterial.renderQueue - 2000 : 0,
  };

  if (shadeTextureIndex >= 0 && texturePaths[shadeTextureIndex]) {
    material.shadeMultiplyTexture = {
      kind: 'path',
      path: texturePaths[shadeTextureIndex],
      colorSpace: 'gamma-2.2',
    };
  }
  if (emissiveTextureIndex >= 0 && texturePaths[emissiveTextureIndex]) {
    material.emissiveSource = 'texture';
    material.emissiveTexture = {
      kind: 'path',
      path: texturePaths[emissiveTextureIndex],
      colorSpace: 'gamma-2.2',
    };
  }
  if (keywords._ALPHABLEND_ON) {
    material.alphaMode = 'transparent';
  }
}

/**
 * VRM humanoid の脚・足チェーンが優先 child を tail として使うよう補正します。
 * @param {object} model - 変換済みモデル。
 */
function applyVrmPreferredTailIndices(model) {
  if (model?.magic !== 'Vrm' || !Array.isArray(model?.bones)) {
    return;
  }

  for (let boneIndex = 0; boneIndex < model.bones.length; boneIndex += 1) {
    const preferredChildBoneIndex = resolveExpectedVrmHumanoidChildBoneIndex(model, boneIndex, model.bones.length);
    if (preferredChildBoneIndex < 0) {
      continue;
    }

    const bone = model.bones[boneIndex];
    bone.tailIndex = preferredChildBoneIndex;
    bone.flags = Number.isInteger(bone.flags) ? (bone.flags | 0x0001) : 0x0001;
    delete bone.tailOffset;
  }
}

/**
 * VRM 1.0 の MToon 設定を反映します。
 * @param {object} material - 内部マテリアル。
 * @param {object} mtoon - VRMC_materials_mtoon。
 * @param {Map<number, number>} gltfTextureMap - glTF texture index から内部 texture index への変換表。
 */
function applyVrm1MtoonMaterial(material, mtoon, gltfTextureMap, texturePaths) {
  const shadeTextureIndex = resolveModelTextureIndex(mtoon?.shadeMultiplyTexture?.index, gltfTextureMap, -1);

  material.shaderName = MTOON_SHADER_NAME;
  material.mtoon = {
    enabled: true,
    version: 'vrm1',
    transparentWithZWrite: Boolean(mtoon?.transparentWithZWrite),
    hasShadeMultiplyTexture: shadeTextureIndex >= 0 && Boolean(texturePaths[shadeTextureIndex]),
    shadeColor: clampColor3(mtoon?.shadeColorFactor, [1, 1, 1]),
    shadeShift: toFiniteNumber(mtoon?.shadingShiftFactor, 0),
    shadeToony: clamp01(toFiniteNumber(mtoon?.shadingToonyFactor, 0.9)),
    receiveShadowRate: 1.0,
    shadingGradeRate: 1.0,
    lightColorAttenuation: 0.0,
    indirectLightIntensity: Math.max(0, toFiniteNumber(mtoon?.giEqualizationFactor, 0.9)),
    rimLightingMix: clamp01(toFiniteNumber(mtoon?.rimLightingMixFactor, 1)),
    outlineWidth: Math.max(0, toFiniteNumber(mtoon?.outlineWidthFactor, 0)),
    outlineScaledMaxDistance: 1.0,
    outlineLightingMix: clamp01(toFiniteNumber(mtoon?.outlineLightingMixFactor, 1)),
    outlineWidthMode: resolveVrm1OutlineWidthMode(mtoon?.outlineWidthMode),
    outlineColorMode: 0,
    outlineColor: clampColor3(mtoon?.outlineColorFactor, [0, 0, 0]),
    rimColor: clampColor3(mtoon?.parametricRimColorFactor, [0, 0, 0]),
    renderQueueOffsetNumber: toFiniteNumber(mtoon?.renderQueueOffsetNumber, 0),
  };

  material.hasEdge = material.mtoon.outlineWidth > 0 && material.mtoon.outlineWidthMode > 0;
  material.edgeColor = [...material.mtoon.outlineColor, 1];
  material.edgeSize = material.mtoon.outlineWidth;
  if (shadeTextureIndex >= 0 && texturePaths[shadeTextureIndex]) {
    material.shadeMultiplyTexture = {
      kind: 'path',
      path: texturePaths[shadeTextureIndex],
      colorSpace: 'gamma-2.2',
    };
  }
}

/**
 * unlit 指定の VRM マテリアルに対して主テクスチャを emissive として流用します。
 * @param {object} material - 内部マテリアル。
 * @param {Array<string>} texturePaths - texture 参照一覧。
 * @param {boolean} isUnlit - glTF material が unlit 指定かどうか。
 */
function applyVrmUnlitTextureEmissiveFallback(material, texturePaths, isUnlit) {
  if (
    !material
    || !isUnlit
    || material.emissiveSource === 'texture'
    || material.textureIndex < 0
    || !texturePaths?.[material.textureIndex]
  ) {
    return;
  }

  material.emissiveSource = 'texture';
  material.emissiveTexture = {
    kind: 'path',
    path: texturePaths[material.textureIndex],
    colorSpace: 'gamma-2.2',
  };
}

/**
 * 内部テクスチャ index を解決します。
 * @param {unknown} gltfTextureIndexValue - glTF texture index。
 * @param {Map<number, number>} gltfTextureMap - 変換表。
 * @param {number} fallback - 既定値。
 * @returns {number} 内部テクスチャ index。
 */
function resolveModelTextureIndex(gltfTextureIndexValue, gltfTextureMap, fallback) {
  const gltfTextureIndex = Number(gltfTextureIndexValue);
  if (Number.isInteger(gltfTextureIndex) && gltfTextureMap.has(gltfTextureIndex)) {
    return gltfTextureMap.get(gltfTextureIndex) ?? fallback;
  }
  return fallback;
}

/**
 * 数値を 0..1 に丸めます。
 * @param {number} value - 入力値。
 * @returns {number} 丸めた値。
 */
function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 色配列を RGB へ丸めます。
 * @param {Array<number>|undefined|null} value - 入力値。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} RGB。
 */
function clampColor3(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [
    clamp01(toFiniteNumber(source[0], fallback[0])),
    clamp01(toFiniteNumber(source[1], fallback[1])),
    clamp01(toFiniteNumber(source[2], fallback[2])),
  ];
}

/**
 * 色配列を RGBA へ丸めます。
 * @param {Array<number>|undefined|null} value - 入力値。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} RGBA。
 */
function clampColor4(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [
    clamp01(toFiniteNumber(source[0], fallback[0])),
    clamp01(toFiniteNumber(source[1], fallback[1])),
    clamp01(toFiniteNumber(source[2], fallback[2])),
    clamp01(toFiniteNumber(source[3], fallback[3])),
  ];
}

/**
 * 数値を有限値へ正規化します。
 * @param {unknown} value - 入力値。
 * @param {number} fallback - 既定値。
 * @returns {number} 正規化結果。
 */
function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * 旧 VRM 0.x の alpha モードを返します。
 * @param {number} blendMode - 旧 VRM blend mode。
 * @returns {'opaque'|'cutout'|'transparent'} alpha モード。
 */
function resolveVrm0AlphaMode(blendMode) {
  if (blendMode === 1) {
    return 'cutout';
  }
  if (blendMode >= 2) {
    return 'transparent';
  }
  return 'opaque';
}

/**
 * emissive が有効かどうかを返します。
 * @param {Array<number>|undefined|null} value - emissive RGB。
 * @returns {boolean} 有効なら true。
 */
function hasVisibleEmissive(value) {
  return Array.isArray(value) && value.some((component) => Math.abs(Number(component) || 0) > 1e-6);
}

/**
 * VRM 1.0 の outline mode を数値へ変換します。
 * @param {unknown} value - 文字列モード。
 * @returns {number} 数値モード。
 */
function resolveVrm1OutlineWidthMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'worldcoordinates') {
    return 1;
  }
  if (mode === 'screencoordinates') {
    return 2;
  }
  return 0;
}
