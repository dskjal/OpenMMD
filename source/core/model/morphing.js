import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';

/**
 * 材質 roughness の既定値を返します。
 * @returns {number} roughness 既定値。
 */
function getDefaultMaterialRoughness() {
  const defaults = getDefaultsSnapshot('material');
  return Number.isFinite(defaults.roughness) ? defaults.roughness : 1;
}

/**
 * Morphing Controller
 */
export class MorphController {
  constructor(device, model) {
    this.device = device;
    this.model = model;
    this.morphs = model.morphs || [];
    this.weights = new Float32Array(this.morphs.length);  // 主に VMD によって設定されるウェイト
    this.manualWeights = new Float32Array(this.morphs.length);  // UI から設定されるウェイト。VMD のウェイトを上書きできる
    this.manualWeights.fill(-1);
    this.effectiveWeights = new Float32Array(this.morphs.length); // 最終的な演算結果
    this.isManualWeightResetted = true;
    
    const vertexCount = model.vertexCount || (model.vertices.length / 27);
    this.vmArray = new Float32Array(vertexCount * 3);
    this.vmBuffer = device.createBuffer({
      size: this.vmArray.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.dirty = true;
    this.materialStates = (model.materials || []).map((m) => ({
      diffuse: cloneColor(m.diffuse, [1, 1, 1, 1]),
      ambient: cloneColor(m.ambient, [0, 0, 0, 1]),
      specular: cloneColor(m.specular, [0, 0, 0]),
      specularity: m.shininess ?? 0,
      metalic: m.metalic ?? 0,
      roughness: m.roughness ?? getDefaultMaterialRoughness(),
      emissiveSource: normalizeEmissiveSource(m.emissiveSource),
      emissive: cloneColor(m.emissive, [0, 0, 0]),
      emissiveStrength: m.emissiveStrength ?? 0,
      emissiveTexture: cloneTextureReference(m.emissiveTexture),
      edgeColor: cloneColor(m.edgeColor, [0, 0, 0, 1]),
      edgeSize: m.edgeSize ?? 1,
      mtoon: cloneMtoonSettings(m.mtoon),
      textureTint: [1, 1, 1, 1],
      environmentTint: [1, 1, 1, 1],
      toonTint: [1, 1, 1, 1],
      textureTransform: {
        offset: [0, 0],
        scale: [1, 1],
      },
    }));
    this.modifiedMaterials = new Set();
    this.previousModifiedMaterials = new Set();
  }

  setWeight(morphIndex, weight) {
    if (this.weights[morphIndex] !== weight) {
      this.weights[morphIndex] = weight;
      this.dirty = true;
    }
  }
  setManualWeight(morphIndex, weight) {
    if (this.manualWeights[morphIndex] !== weight){
      this.manualWeights[morphIndex] = weight;
      this.isManualWeightResetted = false;
      this.dirty = true;
    }
  }
  /**
   * タイムラインが変更されたときなどに呼ばれる
   */
  resetManualWeight(){
    if (this.isManualWeightResetted) return;

    for (let i=0; i < this.manualWeights.length; ++i){
      this.manualWeights[i] = -1;
    }
    this.isManualWeightResetted = true;
    this.dirty = true;
  }

  getWeight(morphIndex) {
    return this.weights[morphIndex];
  }
  getManualWeight(morphIndex) {
    return this.manualWeights[morphIndex];
  }

  resolveWeights() {
    this.effectiveWeights.fill(0);
    const stack = [];
    for (let i = 0; i < this.weights.length; i++) {
      if (this.manualWeights[i] >= 0){
        stack.push({ index: i, weight: this.manualWeights[i] });
      }
      else if (this.weights[i] !== 0) {
        stack.push({ index: i, weight: this.weights[i] });
      }
    }

    let iterations = 0;
    const MAX_ITERATIONS = 1000; 

    while (stack.length > 0 && iterations < MAX_ITERATIONS) {
      const { index, weight } = stack.pop();
      iterations++;

      if (index < 0 || index >= this.morphs.length) continue;
      
      const morph = this.morphs[index];
      this.effectiveWeights[index] += weight;

      if (morph.type === 0) {
        for (const offset of morph.offsets) {
          stack.push({ index: offset.index, weight: offset.influence * weight });
        }
      }
    }
  }

  update() {
    if (!this.dirty) return;

    this.resolveWeights();
    const vrmExpressionWeights = resolveVrmExpressionWeights(this.morphs, this.effectiveWeights);
    this.vmArray.fill(0);
    this.modifiedMaterials.clear();

    // Reset material states to base
    for (let i = 0; i < this.model.materials.length; i++) {
      const m = this.model.materials[i];
      const s = this.materialStates[i];
      s.diffuse = cloneColor(m.diffuse, [1, 1, 1, 1]);
      s.ambient = cloneColor(m.ambient, [0, 0, 0, 1]);
      s.specular = cloneColor(m.specular, [0, 0, 0]);
      s.specularity = m.shininess ?? 0;
      s.metalic = m.metalic ?? 0;
      s.roughness = m.roughness ?? getDefaultMaterialRoughness();
      s.emissiveSource = normalizeEmissiveSource(m.emissiveSource);
      s.emissive = cloneColor(m.emissive, [0, 0, 0]);
      s.emissiveStrength = m.emissiveStrength ?? 0;
      s.emissiveTexture = cloneTextureReference(m.emissiveTexture);
      s.edgeColor = cloneColor(m.edgeColor, [0, 0, 0, 1]);
      s.edgeSize = m.edgeSize ?? 1;
      s.mtoon = cloneMtoonSettings(m.mtoon);
      s.textureTint = [1, 1, 1, 1];
      s.environmentTint = [1, 1, 1, 1];
      s.toonTint = [1, 1, 1, 1];
      s.textureTransform = {
        offset: [0, 0],
        scale: [1, 1],
      };
    }

    for (let i = 0; i < this.morphs.length; i++) {
      const morph = this.morphs[i];
      const weight = morph?.type === 100 ? vrmExpressionWeights[i] : this.effectiveWeights[i];
      if (weight === 0) continue;

      if (morph.type === 1) {
        for (const offset of morph.offsets) {
          const vIdx = offset.index * 3;
          this.vmArray[vIdx + 0] += offset.position[0] * weight;
          this.vmArray[vIdx + 1] += offset.position[1] * weight;
          this.vmArray[vIdx + 2] += offset.position[2] * weight;
        }
      } else if (morph.type === 8) {
        for (const offset of morph.offsets) {
          const s = this.materialStates[offset.index];
          this.modifiedMaterials.add(offset.index);
          if (offset.operationType === 0) { // Multiply
            for(let j=0; j<4; j++) s.diffuse[j] *= (1 + (offset.diffuse[j]-1) * weight);
            for(let j=0; j<3; j++) s.specular[j] *= (1 + (offset.specular[j]-1) * weight);
            s.specularity *= (1 + (offset.specularity-1) * weight);
            for(let j=0; j<3; j++) s.ambient[j] *= (1 + (offset.ambient[j]-1) * weight);
            for(let j=0; j<4; j++) s.edgeColor[j] *= (1 + (offset.edgeColor[j]-1) * weight);
            s.edgeSize *= (1 + (offset.edgeSize-1) * weight);
            for(let j=0; j<4; j++) s.textureTint[j] *= (1 + (offset.textureTint[j]-1) * weight);
            for(let j=0; j<4; j++) s.environmentTint[j] *= (1 + (offset.environmentTint[j]-1) * weight);
            for(let j=0; j<4; j++) s.toonTint[j] *= (1 + (offset.toonTint[j]-1) * weight);
          } else { // Add
            for(let j=0; j<4; j++) s.diffuse[j] += offset.diffuse[j] * weight;
            for(let j=0; j<3; j++) s.specular[j] += offset.specular[j] * weight;
            s.specularity += offset.specularity * weight;
            for(let j=0; j<3; j++) s.ambient[j] += offset.ambient[j] * weight;
            for(let j=0; j<4; j++) s.edgeColor[j] += offset.edgeColor[j] * weight;
            s.edgeSize += offset.edgeSize * weight;
            for(let j=0; j<4; j++) s.textureTint[j] += offset.textureTint[j] * weight;
            for(let j=0; j<4; j++) s.environmentTint[j] += offset.environmentTint[j] * weight;
            for(let j=0; j<4; j++) s.toonTint[j] += offset.toonTint[j] * weight;
          }
        }
      } else if (morph.type === 100) {
        applyVrmExpressionMorph(this, morph, weight);
      }
    }

    this.device.queue.writeBuffer(this.vmBuffer, 0, this.vmArray);
    this.dirty = false;
  }
}

/**
 * VRM expression morph を適用します。
 * @param {MorphController} controller - morph controller。
 * @param {object} morph - expression morph。
 * @param {number} weight - 適用 weight。
 */
function applyVrmExpressionMorph(controller, morph, weight) {
  const definition = morph?.vrmExpressionDefinition || null;
  if (!definition) {
    return;
  }

  for (const offset of definition.vertexOffsets || []) {
    const vertexIndex = (Number(offset?.index) || 0) * 3;
    controller.vmArray[vertexIndex + 0] += (Number(offset?.position?.[0]) || 0) * weight;
    controller.vmArray[vertexIndex + 1] += (Number(offset?.position?.[1]) || 0) * weight;
    controller.vmArray[vertexIndex + 2] += (Number(offset?.position?.[2]) || 0) * weight;
  }

  for (const bind of definition.materialColorBinds || []) {
    const materialState = controller.materialStates[bind.materialIndex];
    if (!materialState) {
      continue;
    }
    controller.modifiedMaterials.add(bind.materialIndex);
    applyVrmMaterialColorBind(materialState, bind, weight);
  }

  for (const bind of definition.textureTransformBinds || []) {
    const materialState = controller.materialStates[bind.materialIndex];
    if (!materialState) {
      continue;
    }
    controller.modifiedMaterials.add(bind.materialIndex);
    materialState.textureTransform.offset[0] += ((Number(bind?.offset?.[0]) || 0) * weight);
    materialState.textureTransform.offset[1] += ((Number(bind?.offset?.[1]) || 0) * weight);
    materialState.textureTransform.scale[0] += (((Number(bind?.scale?.[0]) || 1) - 1) * weight);
    materialState.textureTransform.scale[1] += (((Number(bind?.scale?.[1]) || 1) - 1) * weight);
  }
}

/**
 * VRM material color bind を適用します。
 * @param {object} materialState - マテリアル状態。
 * @param {object} bind - color bind。
 * @param {number} weight - expression weight。
 */
function applyVrmMaterialColorBind(materialState, bind, weight) {
  const targetValue = Array.isArray(bind?.targetValue) ? bind.targetValue : [];
  switch (String(bind?.type || '').trim()) {
    case 'color':
      applyBlendToArray(materialState.diffuse, targetValue, weight);
      break;
    case 'emissionColor':
      applyBlendToArray(materialState.emissive, targetValue, weight);
      break;
    case 'shadeColor':
      materialState.mtoon = materialState.mtoon || {};
      materialState.mtoon.shadeColor = blendArray(materialState.mtoon.shadeColor || [1, 1, 1], targetValue, weight, 3);
      break;
    case 'rimColor':
      materialState.mtoon = materialState.mtoon || {};
      materialState.mtoon.rimColor = blendArray(materialState.mtoon.rimColor || [0, 0, 0], targetValue, weight, 3);
      break;
    case 'outlineColor':
      materialState.mtoon = materialState.mtoon || {};
      materialState.mtoon.outlineColor = blendArray(materialState.mtoon.outlineColor || [0, 0, 0], targetValue, weight, 3);
      break;
    default:
      break;
  }
}

/**
 * VRM expression の最終 weight を解決します。
 * @param {Array<object>} morphs - morph 一覧。
 * @param {Float32Array} effectiveWeights - 素の weight。
 * @returns {Float32Array} 解決済み weight。
 */
function resolveVrmExpressionWeights(morphs, effectiveWeights) {
  const result = new Float32Array(effectiveWeights);
  const metadata = morphs.map((morph, index) => {
    const definition = morph?.vrmExpressionDefinition || null;
    const baseWeight = clamp01(effectiveWeights[index]);
    const sourceWeight = definition?.isBinary ? (baseWeight > 0.5 ? 1 : 0) : baseWeight;
    return {
      definition,
      baseWeight,
      sourceWeight,
    };
  });

  for (let index = 0; index < morphs.length; index++) {
    const definition = metadata[index].definition;
    if (!definition) {
      continue;
    }

    let weight = metadata[index].baseWeight;
    const category = resolveVrmOverrideCategory(definition.expressionName);
    let suppressionWeight = 0;
    let blocked = false;

    if (category !== 'none') {
      for (let sourceIndex = 0; sourceIndex < metadata.length; sourceIndex++) {
        if (sourceIndex === index) {
          continue;
        }
        const sourceDefinition = metadata[sourceIndex].definition;
        if (!sourceDefinition) {
          continue;
        }
        const mode = resolveVrmOverrideModeForCategory(sourceDefinition, category);
        if (mode === 'none') {
          continue;
        }
        const sourceCategory = resolveVrmOverrideCategory(sourceDefinition.expressionName);
        if (sourceCategory === category) {
          continue;
        }
        const sourceWeight = metadata[sourceIndex].sourceWeight;
        if (sourceWeight <= 0) {
          continue;
        }
        if (mode === 'block') {
          blocked = true;
          break;
        }
        suppressionWeight += sourceWeight;
      }
    }

    if (blocked) {
      weight = 0;
    } else if (suppressionWeight > 0) {
      if (definition.isBinary) {
        weight = 0;
      } else {
        weight *= Math.max(0, 1 - suppressionWeight);
      }
    }

    if (definition.isBinary) {
      weight = weight > 0.5 ? 1 : 0;
    }
    result[index] = clamp01(weight);
  }

  return result;
}

/**
 * expression 名から override カテゴリを返します。
 * @param {string} expressionName - expression 名。
 * @returns {'blink'|'look-at'|'mouth'|'none'} カテゴリ。
 */
function resolveVrmOverrideCategory(expressionName) {
  if (['blink', 'blinkLeft', 'blinkRight'].includes(String(expressionName || '').trim())) {
    return 'blink';
  }
  if (['lookUp', 'lookDown', 'lookLeft', 'lookRight'].includes(String(expressionName || '').trim())) {
    return 'look-at';
  }
  if (['aa', 'ih', 'ou', 'ee', 'oh'].includes(String(expressionName || '').trim())) {
    return 'mouth';
  }
  return 'none';
}

/**
 * definition から指定カテゴリへの override モードを返します。
 * @param {object} definition - expression 定義。
 * @param {'blink'|'look-at'|'mouth'|'none'} category - 対象カテゴリ。
 * @returns {'none'|'block'|'blend'} override モード。
 */
function resolveVrmOverrideModeForCategory(definition, category) {
  switch (category) {
    case 'blink':
      return normalizeOverrideValue(definition?.overrideBlink);
    case 'look-at':
      return normalizeOverrideValue(definition?.overrideLookAt);
    case 'mouth':
      return normalizeOverrideValue(definition?.overrideMouth);
    default:
      return 'none';
  }
}

/**
 * override 値を正規化します。
 * @param {unknown} value - 元値。
 * @returns {'none'|'block'|'blend'} 正規化済みモード。
 */
function normalizeOverrideValue(value) {
  const normalizedValue = String(value || 'none').trim().toLowerCase();
  if (normalizedValue === 'block' || normalizedValue === 'blend') {
    return normalizedValue;
  }
  return 'none';
}

/**
 * 配列へ補間適用します。
 * @param {Array<number>} destination - 適用先。
 * @param {Array<number>} target - 目標値。
 * @param {number} weight - 補間率。
 */
function applyBlendToArray(destination, target, weight) {
  if (!Array.isArray(destination)) {
    return;
  }
  for (let index = 0; index < destination.length; index++) {
    const targetValue = Number(target?.[index]) || 0;
    destination[index] += (targetValue - destination[index]) * weight;
  }
}

/**
 * 既存配列と目標値を補間した新配列を返します。
 * @param {Array<number>} source - 元配列。
 * @param {Array<number>} target - 目標値。
 * @param {number} weight - 補間率。
 * @param {number} length - 要素数。
 * @returns {Array<number>} 補間後配列。
 */
function blendArray(source, target, weight, length) {
  const result = [];
  for (let index = 0; index < length; index++) {
    const sourceValue = Number(source?.[index]) || 0;
    const targetValue = Number(target?.[index]) || 0;
    result.push(sourceValue + ((targetValue - sourceValue) * weight));
  }
  return result;
}

/**
 * 値を [0, 1] に clamp します。
 * @param {number} value - 入力値。
 * @returns {number} clamp 済み値。
 */
function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/**
 * 色配列を安全に複製します。
 * @param {Array<number>|undefined|null} value - 元の配列。
 * @param {Array<number>} fallback - 値がない場合の既定値。
 * @returns {Array<number>} 複製した配列。
 */
function cloneColor(value, fallback) {
  return Array.isArray(value) ? [...value] : [...fallback];
}

/**
 * emissive source を正規化します。
 * @param {unknown} value - source 値。
 * @returns {'color'|'texture'} 正規化済み source。
 */
function normalizeEmissiveSource(value) {
  return String(value || 'color').trim().toLowerCase() === 'texture' ? 'texture' : 'color';
}

/**
 * テクスチャ参照を複製します。
 * @param {object|null|undefined} value - 参照。
 * @returns {{kind:'internal', toonIndex:number}|{kind:'path', path:string, colorSpace?:'gamma-2.2'|'none'}|{kind:'none'}} 複製結果。
 */
function cloneTextureReference(value) {
  if (!value || typeof value !== 'object') {
    return { kind: 'none' };
  }
  if (value.kind === 'internal' && Number.isInteger(value.toonIndex)) {
    return { kind: 'internal', toonIndex: value.toonIndex };
  }
  if (value.kind === 'path' && typeof value.path === 'string' && value.path.trim()) {
    return {
      kind: 'path',
      path: value.path,
      colorSpace: value.colorSpace || 'gamma-2.2',
    };
  }
  return { kind: 'none' };
}

/**
 * MToon 設定を複製します。
 * @param {object|null|undefined} value - MToon 設定。
 * @returns {object} 複製結果。
 */
function cloneMtoonSettings(value) {
  return {
    enabled: Boolean(value?.enabled),
    transparentWithZWrite: Boolean(value?.transparentWithZWrite),
    hasShadeMultiplyTexture: Boolean(value?.hasShadeMultiplyTexture),
    shadeColor: cloneColor(value?.shadeColor, [1, 1, 1]),
    shadeShift: Number.isFinite(Number(value?.shadeShift)) ? Number(value.shadeShift) : 0,
    shadeToony: Number.isFinite(Number(value?.shadeToony)) ? Number(value.shadeToony) : 0.9,
    receiveShadowRate: Number.isFinite(Number(value?.receiveShadowRate)) ? Number(value.receiveShadowRate) : 1,
    shadingGradeRate: Number.isFinite(Number(value?.shadingGradeRate)) ? Number(value.shadingGradeRate) : 1,
    lightColorAttenuation: Number.isFinite(Number(value?.lightColorAttenuation)) ? Number(value.lightColorAttenuation) : 0,
    indirectLightIntensity: Number.isFinite(Number(value?.indirectLightIntensity)) ? Number(value.indirectLightIntensity) : 0.9,
    rimLightingMix: Number.isFinite(Number(value?.rimLightingMix)) ? Number(value.rimLightingMix) : 1,
    outlineWidth: Number.isFinite(Number(value?.outlineWidth)) ? Number(value.outlineWidth) : 0,
    outlineScaledMaxDistance: Number.isFinite(Number(value?.outlineScaledMaxDistance)) ? Number(value.outlineScaledMaxDistance) : 1,
    outlineLightingMix: Number.isFinite(Number(value?.outlineLightingMix)) ? Number(value.outlineLightingMix) : 1,
    outlineWidthMode: Number.isFinite(Number(value?.outlineWidthMode)) ? Number(value.outlineWidthMode) : 0,
    outlineColorMode: Number.isFinite(Number(value?.outlineColorMode)) ? Number(value.outlineColorMode) : 0,
    outlineColor: cloneColor(value?.outlineColor, [0, 0, 0]),
    rimColor: cloneColor(value?.rimColor, [0, 0, 0]),
    renderQueueOffsetNumber: Number.isFinite(Number(value?.renderQueueOffsetNumber)) ? Number(value.renderQueueOffsetNumber) : 0,
  };
}
