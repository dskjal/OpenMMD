import { MorphController } from './morphing.js';
import { AnimationController } from '../animation/animation.js';
import { mat4, quat, vec3 } from '../../lib/esm/index.js';
import { solveIk } from '../physics/ik.js';
import {
  quaternionFromEulerForBone,
  quaternionFromEulerXYZ,
  quaternionToEulerForBone,
} from '../../shared/math/math-utils.js';
import { quatSlerp, unionAabb } from '../../shared/math/math-utils.js';
import { createMeshBuffers } from '../../infrastructure/gpu/renderer-resources.js';
import { createSceneState, getBone, loadModelData, loadModelDataFromFile } from './model-scene.js';
import { createPipelineResources } from '../../infrastructure/gpu/model-manager-pipelines.js';
import { createMaterialBindGroup, loadTextureResourceFromReference } from '../../infrastructure/gpu/material-resources.js';
import { createCameraEye } from '../scene/camera.js';
import {
  applyChildWorldOffsetToMatrix,
  getManualRotationFromWorldRotation,
  getManualRotationFromChildWorldRotation,
  getManualTranslationFromWorldPosition,
  getChildWorldOffset,
  getManualTranslationFromChildWorldPosition,
} from '../../shared/bones/bone-transform-utils.js';
import { getDefaultsSnapshot } from '../../infrastructure/config/defaults/defaults-manager.js';
import {
  createUiOverlayPipeline,
  createGridOverlayPipeline,
  createGridOverlayPostPipeline,
  createGridOverlayState,
  drawUiOverlay as drawUiOverlayInstance,
  drawGridOverlay,
  updateGridBuffer,
  updateBoneLineBuffer,
  updateBoneAxisBuffer,
  updateIndicatorBuffer,
  updatePhysicsWireframe,
  updateGizmoBuffer,
} from '../../ui/ui-overlay.js';
import { cloneAnimationSource } from '../../infrastructure/animation/gltf-animation.js';
import { createRuntimeModelInstance } from './runtime-model.js';
import { resetVrmSpringBoneState, updateVrmSpringBone } from '../physics/vrm-springbone.js';

/**
 * モーフ後のマテリアル alpha を返します。
 * @param {object} morphController - モーフコントローラー。
 * @param {object} material - GPU マテリアル。
 * @param {number} materialIndex - マテリアルインデックス。
 * @returns {number} alpha 値。
 */
function getMaterialAlpha(morphController, material, materialIndex) {
  const state = morphController.materialStates[materialIndex];
  return state ? state.diffuse[3] : material.alpha;
}

/**
 * depth prepass に参加するかどうかを判定します。
 * @param {object} material - GPU マテリアル。
 * @param {number} alpha - モーフ後 alpha。
 * @returns {boolean} 参加するなら true。
 */
function shouldDrawDepthPrepassMaterial(material, alpha) {
  if (alpha <= 0.0) {
    return false;
  }
  if (material.alphaCutout > 0.5) {
    return alpha >= DEPTH_PREPASS_CUTOUT_THRESHOLD;
  }
  return alpha >= 0.5;
}

const DEPTH_PREPASS_CUTOUT_THRESHOLD = 0.05;
const MATERIAL_UNIFORM_FLOAT_COUNT = 56;

/**
 * 材質 roughness の既定値を返します。
 * @returns {number} roughness 既定値。
 */
function getDefaultMaterialRoughness() {
  const defaults = getDefaultsSnapshot('material');
  return Number.isFinite(defaults.roughness) ? defaults.roughness : 1;
}

/**
 * emissive source を正規化します。
 * @param {object|null} state - Morph state。
 * @param {object|null} modelMaterial - モデル材質。
 * @param {object|null} pipelineMaterial - pipeline 材質。
 * @returns {number} 0 なら color、1 なら texture。
 */
function resolveEmissiveSource(state, modelMaterial, pipelineMaterial) {
  const source = String(
    state?.emissiveSource
    ?? modelMaterial?.emissiveSource
    ?? pipelineMaterial?.emissiveSource
    ?? 'color',
  ).trim().toLowerCase();
  return source === 'texture' ? 1.0 : 0.0;
}

/**
 * MToon 設定を正規化します。
 * @param {object|null|undefined} mtoon - MToon 設定。
 * @returns {object} 正規化済み設定。
 */
function normalizeMtoonSettings(mtoon) {
  return {
    enabled: Boolean(mtoon?.enabled),
    transparentWithZWrite: Boolean(mtoon?.transparentWithZWrite),
    hasShadeMultiplyTexture: Boolean(mtoon?.hasShadeMultiplyTexture),
    shadeColor: cloneColor3(mtoon?.shadeColor, [1, 1, 1]),
    shadeShift: Number.isFinite(Number(mtoon?.shadeShift)) ? Number(mtoon.shadeShift) : 0,
    shadeToony: Number.isFinite(Number(mtoon?.shadeToony)) ? Number(mtoon.shadeToony) : 0.9,
    receiveShadowRate: Number.isFinite(Number(mtoon?.receiveShadowRate)) ? Number(mtoon.receiveShadowRate) : 1,
    shadingGradeRate: Number.isFinite(Number(mtoon?.shadingGradeRate)) ? Number(mtoon.shadingGradeRate) : 1,
    lightColorAttenuation: Number.isFinite(Number(mtoon?.lightColorAttenuation)) ? Number(mtoon.lightColorAttenuation) : 0,
    indirectLightIntensity: Number.isFinite(Number(mtoon?.indirectLightIntensity)) ? Number(mtoon.indirectLightIntensity) : 0.9,
    rimLightingMix: Number.isFinite(Number(mtoon?.rimLightingMix)) ? Number(mtoon.rimLightingMix) : 1,
    outlineLightingMix: Number.isFinite(Number(mtoon?.outlineLightingMix)) ? Number(mtoon.outlineLightingMix) : 1,
    outlineWidthMode: Number.isFinite(Number(mtoon?.outlineWidthMode)) ? Number(mtoon.outlineWidthMode) : 0,
    outlineColorMode: Number.isFinite(Number(mtoon?.outlineColorMode)) ? Number(mtoon.outlineColorMode) : 0,
    outlineWidth: Number.isFinite(Number(mtoon?.outlineWidth)) ? Number(mtoon.outlineWidth) : 0,
    outlineScaledMaxDistance: Number.isFinite(Number(mtoon?.outlineScaledMaxDistance)) ? Number(mtoon.outlineScaledMaxDistance) : 1,
    outlineColor: cloneColor3(mtoon?.outlineColor, [0, 0, 0]),
    rimColor: cloneColor3(mtoon?.rimColor, [0, 0, 0]),
    renderQueueOffsetNumber: Number.isFinite(Number(mtoon?.renderQueueOffsetNumber)) ? Number(mtoon.renderQueueOffsetNumber) : 0,
  };
}

/**
 * RGB を安全に複製します。
 * @param {Array<number>|undefined|null} value - 元配列。
 * @param {Array<number>} fallback - 既定値。
 * @returns {Array<number>} 複製結果。
 */
function cloneColor3(value, fallback) {
  return Array.isArray(value) ? [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2]] : [...fallback];
}

/**
 * MMD モデルの管理クラスです。
 */
export class ModelManager {
  /**
   * @param {GPUDevice} device - WebGPU デバイス。
   * @param {GPUShaderModule} shaderModule - 描画シェーダーモジュール。
   * @param {GPUTextureFormat} presentationFormat - キャンバスフォーマット。
   * @param {number} msaaSampleCount - MSAA サンプル数。
   * @param {object} globalResources - 共有 GPU リソース。
   */
  constructor(device, shaderModule, presentationFormat, msaaSampleCount, globalResources) {
    this.device = device;
    this.shaderModule = shaderModule;
    this.shaderManager = null;
    this.presentationFormat = presentationFormat;
    this.msaaSampleCount = msaaSampleCount;
    this.globalResources = globalResources;
    this.instances = [];
    this.gridOverlay = createGridOverlayState(device);
    this.gridOverlayPipeline = createGridOverlayPipeline(this);
    this.gridOverlayPostPipeline = createGridOverlayPostPipeline(this);
    this.gridOverlayPostSinglePipeline = createGridOverlayPostPipeline(this, false);
    this.uiOverlayPipeline = createUiOverlayPipeline(this);

    this.boneBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    });
  }

  /**
   * カスタムシェーダマネージャを登録します。
   * @param {object|null} shaderManager - シェーダマネージャ。
   */
  setShaderManager(shaderManager) {
    this.shaderManager = shaderManager || null;
  }

  /**
   * モデルインスタンスの可視状態を返します。
   * @param {object|null} instance - モデルインスタンス。
   * @returns {boolean} 可視なら true。
   */
  isInstanceVisible(instance) {
    return instance?.visible !== false;
  }

  /**
   * モデルインスタンスの可視状態を更新します。
   * @param {object|null} instance - モデルインスタンス。
   * @param {boolean} visible - 可視なら true。
   * @returns {boolean} 更新後の可視状態。
   */
  setInstanceVisible(instance, visible) {
    if (!instance) {
      return false;
    }

    instance.visible = Boolean(visible);
    return instance.visible;
  }

  /**
   * モデルインスタンスの可視状態を反転します。
   * @param {object|null} instance - モデルインスタンス。
   * @returns {boolean} 更新後の可視状態。
   */
  toggleInstanceVisible(instance) {
    if (!instance) {
      return false;
    }

    return this.setInstanceVisible(instance, !this.isInstanceVisible(instance));
  }

  /**
   * 指定ボーンのローカル変換状態を解決します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @returns {{model: object, scene: object, bone: object, local: object}} 解決結果。
   */
  _resolveBoneTransform(instance, boneIndex) {
    const model = instance?.model ?? null;
    const scene = instance?.scene ?? null;
    const bone = getBone(model, boneIndex);
    const local = scene?.boneLocalTransforms?.[boneIndex] ?? null;
    if (!model || !scene || !bone || !local) {
      throw new Error(`Bone transform not found: ${boneIndex}`);
    }

    return { model, scene, bone, local };
  }

  /**
   * scene が保持する GPU バッファを破棄します。
   * @param {object|null} scene - シーン状態。
   */
  _destroySceneBuffers(scene) {
    if (!scene) {
      return;
    }

    scene.boneMatricesBuffer?.destroy?.();
    scene.uiOverlay?.boneLineVertexBuffer?.destroy?.();
    scene.uiOverlay?.boneAxisVertexBuffer?.destroy?.();
    scene.uiOverlay?.physicsWireframeVertexBuffer?.destroy?.();
    scene.uiOverlay?.indicatorVertexBuffer?.destroy?.();
    scene.uiOverlay?.gizmoVertexBuffer?.destroy?.();
  }

  /**
   * ボーン local state の実行時値を複製します。
   * @param {object|null} targetLocal - 新しい local state。
   * @param {object|null} sourceLocal - 旧 local state。
   */
  _copyBoneLocalRuntimeState(targetLocal, sourceLocal) {
    if (!targetLocal || !sourceLocal) {
      return;
    }

    vec3.copy(targetLocal.translation, sourceLocal.translation);
    quat.copy(targetLocal.rotation, sourceLocal.rotation);
    vec3.copy(targetLocal.manualTranslation, sourceLocal.manualTranslation);
    quat.copy(targetLocal.manualRotation, sourceLocal.manualRotation);
    targetLocal.childEnabled = Boolean(sourceLocal.childEnabled);
    targetLocal.childSourceInstanceIndex = Number.isInteger(sourceLocal.childSourceInstanceIndex) ? sourceLocal.childSourceInstanceIndex : -1;
    targetLocal.childSourceBoneIndex = Number.isInteger(sourceLocal.childSourceBoneIndex) ? sourceLocal.childSourceBoneIndex : -1;
    targetLocal.childInfluence = Number.isFinite(sourceLocal.childInfluence) ? sourceLocal.childInfluence : 1;
    targetLocal.childInverseEnabled = Boolean(sourceLocal.childInverseEnabled);
    vec3.copy(targetLocal.childInversePosition, sourceLocal.childInversePosition);
    quat.copy(targetLocal.childInverseRotation, sourceLocal.childInverseRotation);
    vec3.copy(targetLocal.childStoredTranslation, sourceLocal.childStoredTranslation);
    quat.copy(targetLocal.childStoredRotation, sourceLocal.childStoredRotation);
    vec3.copy(targetLocal.scale, sourceLocal.scale);
    targetLocal.localDirty = true;
    targetLocal.worldDirty = true;
  }

  /**
   * ボーン構造変更後に scene / bone bind group / physics 参照を再構築します。
   * @param {object|null} instance - モデルインスタンス。
   * @param {object|null} [physicsEngine=null] - 物理演算エンジン。
   * @param {Array<object>|null} [previousBones=null] - 変更前のボーン参照一覧。
   * @returns {object|null} 再構築後 scene。
   */
  rebuildInstanceScene(instance, physicsEngine = null, previousBones = null) {
    if (!instance?.model) {
      return null;
    }

    const previousScene = instance.scene || null;
    const previousBoneRefs = Array.isArray(previousBones) ? previousBones : [];
    const previousLocals = previousScene?.boneLocalTransforms || [];
    const previousLocalByBone = new Map();
    for (let index = 0; index < previousBoneRefs.length; index += 1) {
      const bone = previousBoneRefs[index];
      const local = previousLocals[index] || null;
      if (bone && local) {
        previousLocalByBone.set(bone, local);
      }
    }

    if (physicsEngine?.world && physicsEngine?.Ammo && previousScene) {
      physicsEngine.removeModel(instance.model, previousScene);
    }

    this._destroySceneBuffers(previousScene);

    const nextScene = createSceneState(this.device, instance.model);
    nextScene.modelManager = this;
    for (let index = 0; index < instance.model.bones.length; index += 1) {
      this._copyBoneLocalRuntimeState(
        nextScene.boneLocalTransforms[index],
        previousLocalByBone.get(instance.model.bones[index]) || null,
      );
    }

    instance.scene = nextScene;
    instance.pipelineResources.boneBindGroup = this.device.createBindGroup({
      layout: this.boneBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: nextScene.boneMatricesBuffer } }],
    });

    this.recomputeBoneMatrices(instance.model, nextScene);
    if (nextScene.vrmSpringBoneState) {
      resetVrmSpringBoneState(instance.model, nextScene, nextScene.vrmSpringBoneState);
    }

    if (
      physicsEngine?.world
      && physicsEngine?.Ammo
      && Array.isArray(instance.model.rigidBodies)
      && instance.model.rigidBodies.length > 0
    ) {
      physicsEngine.addModel(instance.model, nextScene);
    }

    return nextScene;
  }

  /**
   * 指定ボーンが Child の循環参照になるかを判定します。
   * @param {object} model - モデルデータ。
   * @param {number} boneIndex - 元ボーン index。
   * @param {number} candidateIndex - 候補親ボーン index。
   * @returns {boolean} 循環するなら true。
   */
  _isChildTargetCycle(model, boneIndex, candidateIndex) {
    if (!Number.isInteger(boneIndex) || !Number.isInteger(candidateIndex) || boneIndex < 0 || candidateIndex < 0) {
      return false;
    }

    if (boneIndex === candidateIndex) {
      return true;
    }

    let currentIndex = candidateIndex;
    while (currentIndex !== -1) {
      if (currentIndex === boneIndex) {
        return true;
      }
      const currentBone = model?.bones?.[currentIndex] ?? null;
      currentIndex = currentBone?.parentIndex ?? -1;
    }

    return false;
  }

  /**
   * Child 逆補正を現在の参照先で更新します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @returns {object|null} 対象ローカル変換。
   */
  setChildInverse(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    local.childInverseEnabled = true;
    const targetInstance = this.instances?.[local.childSourceInstanceIndex] ?? null;
    const targetLocal = targetInstance?.scene?.boneLocalTransforms?.[local.childSourceBoneIndex] ?? null;
    const targetWorldPosition = targetInstance?.scene?.boneWorldPositions?.[local.childSourceBoneIndex] ?? null;
    if (targetLocal && targetWorldPosition) {
      vec3.copy(local.childInversePosition, targetWorldPosition);
      quat.copy(local.childInverseRotation, targetLocal.worldRotation);
    } else {
      vec3.set(local.childInversePosition, 0, 0, 0);
      quat.identity(local.childInverseRotation);
    }
    this._markBoneTransformDirty(local);
    return local;
  }

  /**
   * Child 逆補正を無効化します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @returns {object|null} 対象ローカル変換。
   */
  clearChildInverse(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    local.childInverseEnabled = false;
    this._markBoneTransformDirty(local);
    return local;
  }

  /**
   * Child を設定します。
   * @param {object} instance - 元モデルインスタンス。
   * @param {number} boneIndex - 元ボーン index。
   * @param {number} targetInstanceIndex - 親モデル index。
   * @param {number} targetBoneIndex - 親ボーン index。
   * @param {number} [influence=1] - 影響力。
   * @returns {object|null} 対象ローカル変換。
   */
  setChild(instance, boneIndex, targetInstanceIndex, targetBoneIndex, influence = 1) {
    const target = this.setChildTarget(instance, boneIndex, targetInstanceIndex, targetBoneIndex);
    if (!target) {
      return null;
    }
    return this.setChildEnabled(instance, boneIndex, true, influence);
  }

  /**
   * Child の参照先を設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @param {number} targetInstanceIndex - 親モデル index。
   * @param {number} targetBoneIndex - 親ボーン index。
   * @returns {object|null} 対象ローカル変換。
   */
  setChildTarget(instance, boneIndex, targetInstanceIndex, targetBoneIndex) {
    const { model, local } = this._resolveBoneTransform(instance, boneIndex);
    local.childSourceInstanceIndex = Number.isInteger(targetInstanceIndex) ? targetInstanceIndex : -1;
    local.childSourceBoneIndex = Number.isInteger(targetBoneIndex) ? targetBoneIndex : -1;
    if (local.childEnabled && local.childSourceInstanceIndex !== -1 && local.childSourceBoneIndex !== -1) {
      const targetInstance = this.instances?.[local.childSourceInstanceIndex] ?? null;
      if (targetInstance === instance && this._isChildTargetCycle(model, boneIndex, local.childSourceBoneIndex)) {
        this.clearChild(instance, boneIndex);
        return null;
      }
      this.setChildInverse(instance, boneIndex);
    } else {
      this._markBoneTransformDirty(local);
    }
    return local;
  }

  /**
   * Child の有効/無効を設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @param {boolean} enabled - 有効にするなら true。
   * @param {number} [influence=1] - 影響力。
   * @returns {object|null} 対象ローカル変換。
   */
  setChildEnabled(instance, boneIndex, enabled, influence = 1) {
    const { model, local } = this._resolveBoneTransform(instance, boneIndex);
    if (!enabled) {
      local.childEnabled = false;
      vec3.copy(local.translation, local.childStoredTranslation);
      quat.copy(local.rotation, local.childStoredRotation);
      this._markBoneTransformDirty(local);
      return local;
    }

    const targetInstance = this.instances?.[local.childSourceInstanceIndex] ?? null;
    const hasValidTarget = Boolean(targetInstance?.scene?.boneLocalTransforms?.[local.childSourceBoneIndex]);
    const isCycle = targetInstance === instance && this._isChildTargetCycle(model, boneIndex, local.childSourceBoneIndex);
    local.childEnabled = true;
    local.childInfluence = Number.isFinite(influence) ? Math.min(1, Math.max(0, influence)) : 1;
    vec3.copy(local.childStoredTranslation, local.translation);
    quat.copy(local.childStoredRotation, local.rotation);
    if (hasValidTarget && !isCycle) {
      this.setChildInverse(instance, boneIndex);
    } else {
      this._markBoneTransformDirty(local);
    }
    return local;
  }

  /**
   * Child を解除します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @returns {object|null} 対象ローカル変換。
   */
  clearChild(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    local.childEnabled = false;
    local.childSourceInstanceIndex = -1;
    local.childSourceBoneIndex = -1;
    local.childInfluence = 1;
    local.childInverseEnabled = true;
    vec3.set(local.childInversePosition, 0, 0, 0);
    quat.identity(local.childInverseRotation);
    vec3.copy(local.translation, local.childStoredTranslation);
    quat.copy(local.rotation, local.childStoredRotation);
    this._markBoneTransformDirty(local);
    return local;
  }

  /**
   * Child の影響力を設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーン index。
   * @param {number} influence - 影響力。
   * @returns {object|null} 対象ローカル変換。
   */
  setChildInfluence(instance, boneIndex, influence) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    local.childInfluence = Number.isFinite(influence) ? Math.min(1, Math.max(0, influence)) : 1;
    this._markBoneTransformDirty(local);
    return local;
  }

  /**
   * ローカル変換を dirty にします。
   * @param {object} local - ローカル変換状態。
   */
  _markBoneTransformDirty(local) {
    local.localDirty = true;
    local.worldDirty = true;
  }

  /**
   * ワールド変換結果を Child 影響込みで確定します。
   * @param {object} scene - シーン状態。
   * @param {number} boneIndex - ボーン index。
   * @param {object} local - ローカル変換状態。
   */
  _finalizeBoneWorldTransform(scene, boneIndex, local) {
    const { _tempMat, _tempVec3, _tempQuat2 } = scene;
    mat4.getTranslation(_tempVec3, local.worldMatrix);
    mat4.getRotation(local.worldRotation, local.worldMatrix);
    if (local.childEnabled) {
      const childPosition = vec3.clone(_tempVec3);
      const childRotation = quat.clone(local.worldRotation);
      if (getChildWorldOffset(scene, local, childPosition, childRotation)) {
        applyChildWorldOffsetToMatrix(local.worldMatrix, childPosition, childRotation, local.worldMatrix);
        mat4.getTranslation(_tempVec3, local.worldMatrix);
        mat4.getRotation(local.worldRotation, local.worldMatrix);
      }
    }

    mat4.fromRotationTranslationScale(local.worldMatrix, local.worldRotation, _tempVec3, local.scale);
    mat4.multiply(local.skinMatrix, local.worldMatrix, scene.inverseBindMatrices[boneIndex]);
    scene.boneWorldPositions[boneIndex][0] = local.worldMatrix[12];
    scene.boneWorldPositions[boneIndex][1] = local.worldMatrix[13];
    scene.boneWorldPositions[boneIndex][2] = local.worldMatrix[14];
    local.localDirty = false;
    local.worldDirty = true;
  }

  /**
   * ローカル変換状態を dirty にします。
   * @param {object} local - ローカル変換状態。
   */
  markBoneLocalTransformDirty(local) {
    this._markBoneTransformDirty(local);
  }

  /**
   * 指定ボーンのローカル変換状態を dirty にします。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @returns {object} dirty 化したローカル変換状態。
   */
  markBoneTransformDirty(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    this._markBoneTransformDirty(local);
    return local;
  }

  /**
   * 手動ローカル位置を設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {ArrayLike<number>} position - ローカル位置。
   * @returns {vec3} 設定後の manualTranslation。
   */
  setManualLocalPosition(instance, boneIndex, position) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    vec3.subtract(local.manualTranslation, position, local.translation);
    this._markBoneTransformDirty(local);
    return local.manualTranslation;
  }

  /**
   * 手動ワールド位置を設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {ArrayLike<number>} position - ワールド位置。
   * @returns {vec3} 設定後の manualTranslation。
   */
  setManualWorldPosition(instance, boneIndex, position) {
    const { scene, bone, local } = this._resolveBoneTransform(instance, boneIndex);
    getManualTranslationFromChildWorldPosition(scene, bone, local, position, local.manualTranslation);
    this._markBoneTransformDirty(local);
    return local.manualTranslation;
  }

  /**
   * @deprecated Use setManualWorldPosition().
   */
  setManualGlobalPosition(instance, boneIndex, position) {
    return this.setManualWorldPosition(instance, boneIndex, position);
  }

  /**
   * 手動ローカル回転を Euler 角から設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {ArrayLike<number>} eulerRadians - XYZ 順の Euler 角（ラジアン）。
   * @returns {quat} 設定後の manualRotation。
   */
  setManualLocalRotationEuler(instance, boneIndex, eulerRadians) {
    const targetRotation = quaternionFromEulerXYZ(eulerRadians, quat.create());
    return this.setManualLocalRotationQuaternion(instance, boneIndex, targetRotation);
  }

  /**
   * 手動ローカル回転をクォータニオンから設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {quat|ArrayLike<number>} targetRotation - baseRotation を含む目標ローカル回転。
   * @returns {quat} 設定後の manualRotation。
   */
  setManualLocalRotationQuaternion(instance, boneIndex, targetRotation) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    // 実適用順は baseRotation -> manualRotation -> animationRotation なので、逆順で解く。
    const invBaseRotation = quat.invert(quat.create(), local.baseRotation || quat.create());
    const invAnimRot = quat.invert(quat.create(), local.rotation);
    quat.multiply(local.manualRotation, targetRotation, invAnimRot);
    quat.multiply(local.manualRotation, invBaseRotation, local.manualRotation);
    quat.normalize(local.manualRotation, local.manualRotation);
    this._markBoneTransformDirty(local);
    return local.manualRotation;
  }

  /**
   * 手動ワールド回転を Euler 角から設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {ArrayLike<number>} eulerRadians - ボーンに応じた Euler 角（ラジアン）。
   * @returns {quat} 設定後の manualRotation。
   */
  setManualWorldRotationEuler(instance, boneIndex, eulerRadians) {
    const { bone } = this._resolveBoneTransform(instance, boneIndex);
    const targetRotation = quaternionFromEulerForBone(eulerRadians, bone.name, quat.create());
    return this.setManualWorldRotationQuaternion(instance, boneIndex, targetRotation);
  }

  /**
   * @deprecated Use setManualWorldRotationEuler().
   */
  setManualGlobalRotationEuler(instance, boneIndex, eulerRadians) {
    return this.setManualWorldRotationEuler(instance, boneIndex, eulerRadians);
  }

  /**
   * 手動ワールド回転をクォータニオンから設定します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @param {quat|ArrayLike<number>} targetRotation - 目標ワールド回転。
   * @returns {quat} 設定後の manualRotation。
   */
  setManualWorldRotationQuaternion(instance, boneIndex, targetRotation) {
    const { scene, bone, local } = this._resolveBoneTransform(instance, boneIndex);
    getManualRotationFromChildWorldRotation(scene, bone, local, targetRotation, local.manualRotation);
    this._markBoneTransformDirty(local);
    return local.manualRotation;
  }

  /**
   * @deprecated Use setManualWorldRotationQuaternion().
   */
  setManualGlobalRotationQuaternion(instance, boneIndex, targetRotation) {
    return this.setManualWorldRotationQuaternion(instance, boneIndex, targetRotation);
  }

  /**
   * ワールド回転をクォータニオンで取得します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @returns {quat} 現在のワールド回転。
   */
  getWorldRotationQuaternion(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    return quat.clone(local.worldRotation);
  }

  /**
   * @deprecated Use getWorldRotationQuaternion().
   */
  getGlobalRotationQuaternion(instance, boneIndex) {
    return this.getWorldRotationQuaternion(instance, boneIndex);
  }

  /**
   * ワールド回転を Euler 角で取得します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   * @returns {number[]} ボーンに応じた Euler 角（ラジアン）。
   */
  getWorldRotationEuler(instance, boneIndex) {
    const { bone, local } = this._resolveBoneTransform(instance, boneIndex);
    return quaternionToEulerForBone(local.worldRotation, bone.name);
  }

  /**
   * @deprecated Use getWorldRotationEuler().
   */
  getGlobalRotationEuler(instance, boneIndex) {
    return this.getWorldRotationEuler(instance, boneIndex);
  }

  /**
   * 手動補正値を初期化します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   */
  resetManualTransform(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    vec3.set(local.manualTranslation, 0, 0, 0);
    quat.identity(local.manualRotation);
    this._markBoneTransformDirty(local);
  }

  /**
   * 手動ローカル位置の補正値を初期化します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   */
  resetManualTranslation(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    vec3.set(local.manualTranslation, 0, 0, 0);
    this._markBoneTransformDirty(local);
  }

  /**
   * 手動ローカル回転の補正値を初期化します。
   * @param {object} instance - モデルインスタンス。
   * @param {number} boneIndex - ボーンインデックス。
   */
  resetManualRotation(instance, boneIndex) {
    const { local } = this._resolveBoneTransform(instance, boneIndex);
    quat.identity(local.manualRotation);
    this._markBoneTransformDirty(local);
  }

  /**
   * 全ボーンの手動補正値を初期化します。
   * @param {object} instance - モデルインスタンス。
   */
  resetAllManualTransforms(instance) {
    const scene = instance?.scene ?? null;
    if (!scene?.boneLocalTransforms) {
      return;
    }

    for (let i = 0; i < scene.boneLocalTransforms.length; i++) {
      this.resetManualTransform(instance, i);
    }
  }

  /**
   * モデルインスタンスを追加します。
   * @param {object|null} zipFiles - ZIP 内ファイル一覧。
   * @param {number} unitScale - 単位スケール。
   * @param {string} modelPath - モデルパス。
   * @param {string} modelFile - モデルファイル名。
   * @returns {Promise<object>} モデルインスタンス。
   */
  async addModel(zipFiles, unitScale, modelPath, modelFile) {
    const { model, fileProvider } = await loadModelData(zipFiles, unitScale, modelFile);
    return await this._addLoadedModel(model, fileProvider, modelPath);
  }

  /**
   * 単一ファイルからモデルインスタンスを追加します。
   * @param {{name: string, arrayBuffer?: function(): Promise<ArrayBuffer>, text?: function(): Promise<string>}} file - 読み込み対象。
   * @param {number} unitScale - 単位スケール。
   * @returns {Promise<object>} モデルインスタンス。
   */
  async addModelFile(file, unitScale) {
    const { model, fileProvider } = await loadModelDataFromFile(file, unitScale);
    return await this._addLoadedModel(model, fileProvider, '');
  }

  /**
   * 読み込んだモデルからインスタンスを作成します。
   * @param {object} model - モデルデータ。
   * @param {object|null} fileProvider - ファイルプロバイダー。
   * @param {string} modelPath - モデルパス。
   * @returns {Promise<object>} モデルインスタンス。
   */
  async _addLoadedModel(model, fileProvider, modelPath) {
    const meshBuffers = createMeshBuffers(this.device, model);
    const morphController = new MorphController(this.device, model);
    const animationController = new AnimationController(model, morphController);
    const scene = createSceneState(this.device, model);
    scene.modelManager = this;
    const pipelineResources = await createPipelineResources(this, scene, model, fileProvider, modelPath);
    const instance = createRuntimeModelInstance({
      model,
      device: this.device,
      fileProvider,
      modelPath,
      meshBuffers,
      pipelineResources,
      modelManager: this,
      morphController,
      animationController,
      scene,
    });
    this.recomputeBoneMatrices(model, scene);
    if (scene.vrmSpringBoneState) {
      resetVrmSpringBoneState(model, scene, scene.vrmSpringBoneState);
    }
    this.instances.push(instance);
    this.updateSsssMaterialBuffers(instance);
    return instance;
  }

  /**
   * モデルインスタンスを削除します。
   * @param {number} index - 削除対象インデックス。
   * @param {object} physicsEngine - 物理演算エンジン。
   */
  removeModel(index, physicsEngine) {
    if (index < 0 || index >= this.instances.length) {
      return;
    }

    const instance = this.instances[index];
    if (physicsEngine) {
      physicsEngine.removeModel(instance.model, instance.scene);
    }

    instance.meshBuffers.vertexBuffer.destroy();
    instance.meshBuffers.indexBuffer.destroy();
    instance.morphController.vmBuffer.destroy();
    instance.scene.boneMatricesBuffer.destroy();
    instance.scene.uiOverlay.boneLineVertexBuffer.destroy();
    instance.scene.uiOverlay.boneAxisVertexBuffer?.destroy?.();
    instance.scene.uiOverlay.physicsWireframeVertexBuffer.destroy();
    instance.scene.uiOverlay.indicatorVertexBuffer.destroy();
    instance.scene.uiOverlay.gizmoVertexBuffer.destroy();
    for (const material of instance.pipelineResources.materials) {
      material.buffer.destroy();
    }

    this.instances.splice(index, 1);
  }

  /**
   * アニメーションと描画補助バッファを更新します。
   * @param {object} physicsEngine - 物理演算エンジン。
   * @param {object} selection - 現在の選択状態。
   * @param {number} step - 更新ステップ。
   * @param {object} camera - カメラ状態。
   * @param {object|null} [playbackState=null] - 再生状態スナップショット。
   * @param {object|null} [inspectorState=null] - ボーンインスペクター状態。
   */
  update(physicsEngine, selection, step = 1, camera = null, playbackState = null, inspectorState = null) {
    updateGridBuffer(this.device, this.gridOverlay, selection);

    if (!this.instances.length) {
      return;
    }

    const cameraEye = camera ? createCameraEye(camera) : null;
    const physicsPaused = Boolean(physicsEngine && typeof physicsEngine.isEnabled === 'function' && !physicsEngine.isEnabled());

    for (const instance of this.instances) {
      const jumpedBeforeUpdate = instance.animationController.jumped;
      instance.animationController.update(
        step,
        instance.scene.boneLocalTransforms,
        this.markBoneLocalTransformDirty.bind(this),
        playbackState || {},
      );
      const jumpedAfterUpdate = instance.animationController.jumped;
      const jumped = jumpedBeforeUpdate || jumpedAfterUpdate;

      this.recomputeBoneMatrices(instance.model, instance.scene, physicsPaused);
      solveIk(
        instance.model,
        instance.scene,
        () => this.recomputeBoneMatrices(instance.model, instance.scene, physicsPaused),
        this.markBoneLocalTransformDirty.bind(this),
      );

      if (instance.scene.vrmSpringBoneState) {
        if (jumped) {
          resetVrmSpringBoneState(instance.model, instance.scene, instance.scene.vrmSpringBoneState);
        } else {
          updateVrmSpringBone(
            instance.model,
            instance.scene,
            this,
            step,
            instance.animationController.timelineFps,
          );
        }
      }

      if (jumped && physicsEngine && !physicsPaused) {
        const entry = physicsEngine.models.find((item) => item.model === instance.model);
        if (entry) {
          physicsEngine.resetModel(entry);
        }
      }

      instance.animationController.jumped = false;
    }

    if (physicsEngine && !physicsPaused) {
      physicsEngine.update(step);
    }

    for (let i = 0; i < this.instances.length; i++) {
      const instance = this.instances[i];
      const isActive = i === selection.activeInstanceIndex;

      this.recomputeBoneMatrices(instance.model, instance.scene, physicsPaused);
      this.writeBoneMatrices(instance.scene);
      updateBoneLineBuffer(this.device, instance.model, instance.scene, selection, isActive);
      updateBoneAxisBuffer(this.device, instance.model, instance.scene, selection, isActive);
      updateIndicatorBuffer(this.device, instance, selection, isActive);
      updateGizmoBuffer(this.device, instance, selection, isActive, cameraEye, inspectorState);

      if (physicsEngine) {
        updatePhysicsWireframe(this.device, instance, physicsEngine, selection);
      } else {
        instance.scene.uiOverlay.physicsWireframeVertexCount = 0;
      }
      instance.morphController.update();
      updateInstanceAabb(instance);
      this.updateMaterialBuffers(instance);
    }
  }

  /**
   * UI overlay を描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {object} selection - 現在の選択状態。
   */
  drawUiOverlay(pass, selection) {
    if (!this.uiOverlayPipeline) {
      return;
    }
    pass.setPipeline(this.uiOverlayPipeline);
    pass.setBindGroup(0, this.globalResources.globalBindGroup);
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance)) {
        continue;
      }
      drawUiOverlayInstance(pass, instance, selection);
    }
  }

  /**
   * 床グリッドを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {GPUTextureView|null} [depthView=null] - 深度テクスチャビュー。
   * @param {boolean} [depthIsMultisampled=false] - 深度ビューが MSAA かどうか。
   */
  drawGridOverlay(pass, depthView = null, depthIsMultisampled = false) {
    if (!this.gridOverlayPipeline && !this.gridOverlayPostPipeline && !this.gridOverlayPostSinglePipeline) {
      return;
    }
    drawGridOverlay(pass, this, this.gridOverlay, depthView, depthIsMultisampled);
  }

  /**
   * 物理演算を再構築します。
   * @param {object} physicsEngine - 物理演算エンジン。
   */
  resetPhysics(physicsEngine) {
    this.rebuildPhysics(physicsEngine);
  }

  /**
   * 物理演算を再構築します。
   * @param {object} physicsEngine - 物理演算エンジン。
   */
  rebuildPhysics(physicsEngine) {
    physicsEngine?.rebuild?.();
  }

  /**
   * ボーン行列を再計算します。
   * @param {object} model - モデルデータ。
   * @param {object} scene - シーン状態。
   * @param {boolean} [physicsPaused=false] - 物理が停止中なら true。
   */
  recomputeBoneMatrices(model, scene, physicsPaused = false) {
    const { _tempMat, _tempQuat, _tempQuat2, _tempVec3, _identityQuat } = scene;
    const _tempQuat3 = scene._tempQuat3 || quat.create();

    for (const i of scene.sortedBoneIndices) {
      const bone = getBone(model, i);
      const local = scene.boneLocalTransforms[i];
      if (!bone || !local) {
        continue;
      }
      const parentDirty = bone.parentIndex !== -1 && scene.boneLocalTransforms[bone.parentIndex]
        ? scene.boneLocalTransforms[bone.parentIndex].worldDirty
        : false;
      const inheritDirty = bone.inheritParentIndex !== -1 && scene.boneLocalTransforms[bone.inheritParentIndex]
        ? scene.boneLocalTransforms[bone.inheritParentIndex].worldDirty
        : false;
      const childDirty = local.childEnabled && scene.modelManager?.instances?.[local.childSourceInstanceIndex]?.scene?.boneLocalTransforms?.[local.childSourceBoneIndex]
        ? scene.modelManager.instances[local.childSourceInstanceIndex].scene.boneLocalTransforms[local.childSourceBoneIndex].worldDirty
        : false;
      if (!local.localDirty && !parentDirty && !inheritDirty && !childDirty) {
        local.worldDirty = false;
        continue;
      }

      let currentRotation = local.rotation;
      let currentTranslationX = local.translation[0];
      let currentTranslationY = local.translation[1];
      let currentTranslationZ = local.translation[2];

      _tempQuat[0] = local.manualRotation[0];
      _tempQuat[1] = local.manualRotation[1];
      _tempQuat[2] = local.manualRotation[2];
      _tempQuat[3] = local.manualRotation[3];
      quat.multiply(_tempQuat, _tempQuat, currentRotation);
      currentRotation = _tempQuat;
      quat.multiply(_tempQuat3, local.baseRotation || _identityQuat, currentRotation);
      quat.normalize(_tempQuat3, _tempQuat3);
      currentRotation = _tempQuat3;

      currentTranslationX += local.manualTranslation[0];
      currentTranslationY += local.manualTranslation[1];
      currentTranslationZ += local.manualTranslation[2];

      if (physicsPaused && local.physicsDriven) {
        this._finalizeBoneWorldTransform(scene, i, local);
        continue;
      }

      if (!local.physicsDriven) {
        if ((bone.flags & 0x0100) && bone.inheritParentIndex !== -1) {
          const inheritBone = scene.boneLocalTransforms[bone.inheritParentIndex];
          if (bone.parentIndex !== bone.inheritParentIndex && inheritBone) {
            quatSlerp(_identityQuat, inheritBone.rotation, bone.inheritInfluence, _tempQuat2);
            quat.multiply(_tempQuat2, _tempQuat2, currentRotation);
            currentRotation = _tempQuat2;
          }
        }

        if ((bone.flags & 0x0200) && bone.inheritParentIndex !== -1) {
          const inheritBone = scene.boneLocalTransforms[bone.inheritParentIndex];
          if (bone.parentIndex !== bone.inheritParentIndex && inheritBone) {
            currentTranslationX += inheritBone.translation[0] * bone.inheritInfluence;
            currentTranslationY += inheritBone.translation[1] * bone.inheritInfluence;
            currentTranslationZ += inheritBone.translation[2] * bone.inheritInfluence;
          }
        }

        mat4.fromTranslation(local.worldMatrix, local.baseTranslation);
        _tempVec3[0] = currentTranslationX;
        _tempVec3[1] = currentTranslationY;
        _tempVec3[2] = currentTranslationZ;
        mat4.fromTranslation(_tempMat, _tempVec3);
        mat4.multiply(local.worldMatrix, local.worldMatrix, _tempMat);
        mat4.fromQuat(_tempMat, currentRotation);
        mat4.multiply(local.worldMatrix, local.worldMatrix, _tempMat);
        mat4.fromScaling(_tempMat, local.scale);
        mat4.multiply(local.worldMatrix, local.worldMatrix, _tempMat);

        if (bone.parentIndex !== -1 && bone.parentIndex < scene.boneCount) {
          const parentTransform = scene.boneLocalTransforms[bone.parentIndex];
          mat4.multiply(local.worldMatrix, parentTransform.worldMatrix, local.worldMatrix);
          quat.multiply(local.worldRotation, parentTransform.worldRotation, currentRotation);
        } else {
          quat.copy(local.worldRotation, currentRotation);
        }
      } else {
        if (bone.parentIndex !== -1 && bone.parentIndex < scene.boneCount) {
          const parentTransform = scene.boneLocalTransforms[bone.parentIndex];
          quat.multiply(local.worldRotation, parentTransform.worldRotation, currentRotation);
        } else {
          quat.copy(local.worldRotation, currentRotation);
        }
        local.physicsDriven = false;
      }

      this._finalizeBoneWorldTransform(scene, i, local);
    }
  }

  /**
   * ボーン行列を GPU に書き込みます。
   * @param {object} scene - シーン状態。
   */
  writeBoneMatrices(scene) {
    const matrices = new Float32Array(scene.boneCount * 16);
    for (let i = 0; i < scene.boneCount; i++) {
      matrices.set(scene.boneLocalTransforms[i].skinMatrix, i * 16);
    }
    this.device.queue.writeBuffer(scene.boneMatricesBuffer, 0, matrices);
  }

  /**
   * 全モデルを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {object} selection - 現在の選択状態。
   * @param {boolean} useMsaa - MSAA 利用有無。
   */
  draw(pass, selection, useMsaa) {
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance)) {
        continue;
      }
      this.drawInstance(pass, instance, selection, useMsaa);
    }
  }

  /**
   * 深度プリパスを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {boolean} useMsaa - MSAA 利用有無。
   */
  drawDepthPrepass(pass, useMsaa) {
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance)) {
        continue;
      }
      this.drawDepthPrepassInstance(pass, instance, useMsaa);
    }
  }

  /**
   * 深度ピック用のパスを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   */
  drawDepthPick(pass) {
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance)) {
        continue;
      }
      this.drawDepthPickInstance(pass, instance);
    }
  }

  /**
   * 単一モデルの深度プリパスを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {object} instance - モデルインスタンス。
   * @param {boolean} useMsaa - MSAA 利用有無。
   */
  drawDepthPrepassInstance(pass, instance, useMsaa) {
    if (!this.isInstanceVisible(instance)) {
      return;
    }
    const { meshBuffers, morphController, pipelineResources } = instance;
    const defaultShaderName = pipelineResources.defaultShaderName || 'mmd-shader.wgsl';
    const getShaderPipelines = (shaderName) => {
      if (shaderName && pipelineResources.shaderPipelines?.[shaderName]) {
        return useMsaa ? pipelineResources.shaderPipelines[shaderName].depthPrepassMsaa : pipelineResources.shaderPipelines[shaderName].depthPrepassNonMsaa;
      }
      const fallbackPipelines = pipelineResources.shaderPipelines?.[defaultShaderName];
      if (fallbackPipelines) {
        return useMsaa ? fallbackPipelines.depthPrepassMsaa : fallbackPipelines.depthPrepassNonMsaa;
      }
      return null;
    };
    const groupMaterialsByShader = (materials) => {
      const grouped = new Map();
      for (const material of materials) {
        const shaderName = typeof material.shaderName === 'string' && material.shaderName
          ? material.shaderName
          : (pipelineResources.defaultShaderName || 'mmd-shader.wgsl');
        const group = grouped.get(shaderName) || [];
        group.push(material);
        grouped.set(shaderName, group);
      }
      return grouped;
    };

    pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
    pass.setVertexBuffer(1, morphController.vmBuffer);
    pass.setIndexBuffer(meshBuffers.indexBuffer, meshBuffers.indexFormat);

    const opaqueMaterials = [];
    const transparentMaterials = [];
    for (let i = 0; i < pipelineResources.materials.length; i++) {
      const material = pipelineResources.materials[i];
      const alpha = getMaterialAlpha(morphController, material, i);
      if (!shouldDrawDepthPrepassMaterial(material, alpha) || instance.materialVisibility[i] === false) {
        continue;
      }
      if (material.alphaMode === 'transparent' || alpha < 0.99) {
        transparentMaterials.push(material);
      } else {
        opaqueMaterials.push(material);
      }
    }

    const opaqueRegularGroups = groupMaterialsByShader(opaqueMaterials.filter((material) => !material.noCull));
    for (const [shaderName, materials] of opaqueRegularGroups) {
      const shaderPipelines = getShaderPipelines(shaderName);
      if (!shaderPipelines) {
        continue;
      }
      this.drawMeshList(
        pass,
        shaderPipelines.depthPrepassPipeline,
        materials,
        pipelineResources.boneBindGroup,
        this.globalResources.prepassGlobalBindGroup,
      );
    }

    const opaqueNoCullGroups = groupMaterialsByShader(opaqueMaterials.filter((material) => material.noCull));
    for (const [shaderName, materials] of opaqueNoCullGroups) {
      const shaderPipelines = getShaderPipelines(shaderName);
      if (!shaderPipelines) {
        continue;
      }
      this.drawMeshList(
        pass,
        shaderPipelines.depthPrepassNoCullPipeline,
        materials,
        pipelineResources.boneBindGroup,
        this.globalResources.prepassGlobalBindGroup,
      );
    }

    const sortedTransparentMaterials = sortTransparentMaterialsByRenderOrder(transparentMaterials);
    for (const material of sortedTransparentMaterials) {
      const shaderPipelines = getShaderPipelines(material.shaderName);
      if (!shaderPipelines) {
        continue;
      }
      const pipeline = material.noCull ? shaderPipelines.depthPrepassNoCullPipeline : shaderPipelines.depthPrepassPipeline;
      this.drawMaterial(pass, pipeline, material, pipelineResources.boneBindGroup, this.globalResources.prepassGlobalBindGroup);
    }
  }

  /**
   * 単一モデルを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {object} instance - モデルインスタンス。
   * @param {object} selection - 現在の選択状態。
   * @param {boolean} useMsaa - MSAA 利用有無。
   */
  drawInstance(pass, instance, selection, useMsaa) {
    if (!this.isInstanceVisible(instance)) {
      return;
    }
    const { meshBuffers, morphController, pipelineResources } = instance;
    const defaultPipelines = useMsaa ? pipelineResources.msaa : pipelineResources.nonMsaa;
    const getShaderPipelines = (shaderName) => {
      if (shaderName && pipelineResources.shaderPipelines?.[shaderName]) {
        return useMsaa ? pipelineResources.shaderPipelines[shaderName].msaa : pipelineResources.shaderPipelines[shaderName].nonMsaa;
      }
      return defaultPipelines;
    };
    const groupMaterialsByShader = (materials) => {
      const grouped = new Map();
      for (const material of materials) {
        const shaderName = typeof material.shaderName === 'string' && material.shaderName
          ? material.shaderName
          : (pipelineResources.defaultShaderName || 'mmd-shader.wgsl');
        const group = grouped.get(shaderName) || [];
        group.push(material);
        grouped.set(shaderName, group);
      }
      return grouped;
    };

    pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
    pass.setVertexBuffer(1, morphController.vmBuffer);
    pass.setIndexBuffer(meshBuffers.indexBuffer, meshBuffers.indexFormat);

    const opaqueMaterials = [];
    const transparentMaterials = [];
    for (let i = 0; i < pipelineResources.materials.length; i++) {
      const material = pipelineResources.materials[i];
      const state = morphController.materialStates[i];
      const alpha = state ? state.diffuse[3] : material.alpha;
      if (alpha <= 0.0 || instance.materialVisibility[i] === false) {
        continue;
      }
      if (material.alphaMode === 'transparent' || alpha < 0.99) {
        transparentMaterials.push(material);
      }
      else {
        opaqueMaterials.push(material);
      }
    }

    const opaqueEdgeGroups = groupMaterialsByShader(opaqueMaterials.filter((material) => material.hasEdge));
    const opaqueRegularGroups = groupMaterialsByShader(opaqueMaterials.filter((material) => !material.noCull));
    for (const [shaderName, materials] of opaqueRegularGroups) {
      const shaderPipelines = getShaderPipelines(shaderName);
      this.drawMeshList(pass, shaderPipelines.pipeline, materials, pipelineResources.boneBindGroup);
    }

    const opaqueNoCullGroups = groupMaterialsByShader(opaqueMaterials.filter((material) => material.noCull));
    for (const [shaderName, materials] of opaqueNoCullGroups) {
      const shaderPipelines = getShaderPipelines(shaderName);
      this.drawMeshList(pass, shaderPipelines.opaqueNoCullPipeline, materials, pipelineResources.boneBindGroup);
    }

    for (const [shaderName, materials] of opaqueEdgeGroups) {
      const shaderPipelines = getShaderPipelines(shaderName);
      this.drawEdgeMeshList(pass, shaderPipelines.edgePipeline, materials, pipelineResources.boneBindGroup);
    }

    const sortedTransparentMaterials = sortTransparentMaterialsByRenderOrder(transparentMaterials);
    for (const material of sortedTransparentMaterials) {
      const shaderPipelines = getShaderPipelines(material.shaderName);
      const pipeline = material.noCull ? shaderPipelines.transparentNoCullPipeline : shaderPipelines.transparentPipeline;
      this.drawMaterial(pass, pipeline, material, pipelineResources.boneBindGroup);
      if (material.hasEdge) {
        this.drawMaterial(pass, shaderPipelines.edgePipeline, material, pipelineResources.boneBindGroup, this.globalResources.edgeBindGroup);
      }
    }

  }

  /**
   * 深度ピック用に可視面を描画します。
   * 透明材質もシェーダー側の alpha 閾値判定で拾います。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {object} instance - モデルインスタンス。
   */
  drawDepthPickInstance(pass, instance) {
    if (!this.isInstanceVisible(instance)) {
      return;
    }
    const { meshBuffers, morphController, pipelineResources } = instance;

    pass.setPipeline(pipelineResources.depthPickPipeline);
    pass.setBindGroup(0, this.globalResources.globalBindGroup);
    pass.setBindGroup(2, pipelineResources.boneBindGroup);
    pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
    pass.setVertexBuffer(1, morphController.vmBuffer);
    pass.setIndexBuffer(meshBuffers.indexBuffer, meshBuffers.indexFormat);

    for (let i = 0; i < pipelineResources.materials.length; i++) {
      const material = pipelineResources.materials[i];
      const state = morphController.materialStates[i];
      const alpha = state ? state.diffuse[3] : material.alpha;
      if (alpha <= 0.0 || material.indexCount <= 0 || instance.materialVisibility[i] === false) {
        continue;
      }
      pass.setBindGroup(1, material.bindGroup);
      pass.drawIndexed(Number(material.indexCount), 1, Number(material.indexOffset), 0, 0);
    }
  }

  /**
   * マテリアル配列を描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {GPURenderPipeline} pipeline - パイプライン。
   * @param {Array<object>} materials - マテリアル群。
   * @param {GPUBindGroup} boneBindGroup - ボーン bind group。
   */
  drawMeshList(pass, pipeline, materials, boneBindGroup, globalBindGroup = this.globalResources.globalBindGroup) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, globalBindGroup);
    pass.setBindGroup(2, boneBindGroup);

    for (const material of materials) {
      pass.setBindGroup(1, material.bindGroup);
      if (material.indexCount > 0) {
        pass.drawIndexed(Number(material.indexCount), 1, Number(material.indexOffset), 0, 0);
      }
    }
  }

  /**
   * 輪郭線用にマテリアル配列を描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {GPURenderPipeline} pipeline - パイプライン。
   * @param {Array<object>} materials - マテリアル群。
   * @param {GPUBindGroup} boneBindGroup - ボーン bind group。
   */
  drawEdgeMeshList(pass, pipeline, materials, boneBindGroup) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.globalResources.edgeBindGroup);
    pass.setBindGroup(2, boneBindGroup);

    for (const material of materials) {
      pass.setBindGroup(1, material.bindGroup);
      if (material.indexCount > 0) {
        pass.drawIndexed(Number(material.indexCount), 1, Number(material.indexOffset), 0, 0);
      }
    }
  }

  /**
   * 単一マテリアルを描画します。
   * @param {GPURenderPassEncoder} pass - レンダーパス。
   * @param {GPURenderPipeline} pipeline - パイプライン。
   * @param {object} material - マテリアル。
   * @param {GPUBindGroup} boneBindGroup - ボーン bind group。
   * @param {GPUBindGroup} [globalBindGroup] - グローバル bind group。
   */
  drawMaterial(pass, pipeline, material, boneBindGroup, globalBindGroup = this.globalResources.globalBindGroup) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, globalBindGroup);
    pass.setBindGroup(2, boneBindGroup);
    pass.setBindGroup(1, material.bindGroup);
    if (material.indexCount > 0) {
      pass.drawIndexed(Number(material.indexCount), 1, Number(material.indexOffset), 0, 0);
    }
  }

  /**
   * シャドウパス描画を行います。
   * @param {GPURenderPassEncoder} pass - シャドウパス。
   */
  drawShadow(pass) {
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance)) {
        continue;
      }
      this.drawShadowInstance(pass, instance);
    }
  }

  /**
   * 全モデルの境界ボックスを返します。
   * @returns {{min: number[], max: number[]} | null} モデル境界ボックス。
   */
  getCombinedAabb() {
    let bounds = null;
    for (const instance of this.instances) {
      if (!this.isInstanceVisible(instance) || !instance.aabb) {
        continue;
      }
      bounds = unionAabb(bounds, instance.aabb);
    }
    return bounds;
  }

  /**
   * 単一モデルのシャドウパス描画を行います。
   * @param {GPURenderPassEncoder} pass - シャドウパス。
   * @param {object} instance - モデルインスタンス。
   */
  drawShadowInstance(pass, instance) {
    if (!this.isInstanceVisible(instance)) {
      return;
    }
    const { meshBuffers, morphController, pipelineResources } = instance;
    pass.setPipeline(pipelineResources.shadowPipeline);
    pass.setBindGroup(0, this.globalResources.shadowGlobalBindGroup);
    pass.setBindGroup(2, pipelineResources.boneBindGroup);
    pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
    pass.setVertexBuffer(1, morphController.vmBuffer);
    pass.setIndexBuffer(meshBuffers.indexBuffer, meshBuffers.indexFormat);

    for (let i = 0; i < pipelineResources.materials.length; i++) {
      const material = pipelineResources.materials[i];
      const state = morphController.materialStates[i];
      const alpha = state ? state.diffuse[3] : material.alpha;
      const castShadow = instance.materialCastShadow?.[i];
      const drawShadow = castShadow === undefined
        ? instance.model.materials[i]?.drawShadow !== false
        : castShadow;
      if (
        alpha <= 0.0
        || instance.materialVisibility[i] === false
        || drawShadow === false
      ) {
        continue;
      }
      pass.setBindGroup(1, material.bindGroup);
      if (material.indexCount > 0) {
        pass.drawIndexed(Number(material.indexCount), 1, Number(material.indexOffset), 0, 0);
      }
    }
  }

  /**
   * MSAA サンプル数に合わせてパイプラインを再作成します。
   * @param {number} newCount - 新しいサンプル数。
   */
  async updateMsaaSampleCount(newCount) {
    console.log('Updating MSAA sample count to:', newCount);
    this.msaaSampleCount = newCount;
    for (const instance of this.instances) {
      instance.pipelineResources = await createPipelineResources(
        this,
        instance.scene,
        instance.model,
        instance.fileProvider,
        instance.modelPath,
        instance.pipelineResources?.textureCache ?? null,
      );
    }
    console.log('MSAA sample count update finished.');
  }

  /**
   * 指定マテリアルへシェーダを割り当て直します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} selectedIndices - 対象マテリアル番号。
   * @param {string} shaderName - シェーダ名。
   */
  async updateMaterialShader(instance, selectedIndices, shaderName) {
    if (!instance || !Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return;
    }

    for (const index of selectedIndices) {
      const material = instance.model?.materials?.[index];
      if (material) {
        material.shaderName = shaderName;
      }
    }

    instance.pipelineResources = await createPipelineResources(
      this,
      instance.scene,
      instance.model,
      instance.fileProvider,
      instance.modelPath,
      instance.pipelineResources?.textureCache ?? null,
    );
    this.updateSsssMaterialBuffers(instance);
  }

  /**
   * 指定 texture index 群へ色空間設定を割り当て直します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} selectedIndices - 対象 texture 番号。
   * @param {'gamma-2.2'|'none'} textureColorSpace - 変換モード。
   */
  async updateTextureColorSpaces(instance, selectedIndices, textureColorSpace) {
    if (!instance || !Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return;
    }

    if (!Array.isArray(instance.model.textureColorSpaces)) {
      instance.model.textureColorSpaces = Array.isArray(instance.model.textures)
        ? instance.model.textures.map(() => 'gamma-2.2')
        : [];
    }

    for (const index of selectedIndices) {
      if (index < 0 || index >= instance.model.textureColorSpaces.length) {
        continue;
      }
      instance.model.textureColorSpaces[index] = textureColorSpace;
    }

    instance.pipelineResources = await createPipelineResources(
      this,
      instance.scene,
      instance.model,
      instance.fileProvider,
      instance.modelPath,
      instance.pipelineResources?.textureCache ?? null,
    );
    this.updateSsssMaterialBuffers(instance);
  }

  /**
   * 指定マテリアルへ toon テクスチャ参照を割り当て直します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} selectedIndices - 対象マテリアル番号。
   * @param {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace?: 'gamma-2.2'|'none'}|{kind: 'none'}|null} toonTexture - toon 参照。
   */
  async updateMaterialToonTexture(instance, selectedIndices, toonTexture) {
    if (!instance || !Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return;
    }

    for (const index of selectedIndices) {
      const material = instance.model?.materials?.[index];
      if (!material) {
        continue;
      }
      if (!toonTexture || toonTexture.kind === 'none') {
        material.toonTexture = { kind: 'none' };
        continue;
      }

      material.toonTexture = {
        kind: toonTexture.kind,
        ...(toonTexture.kind === 'internal'
          ? { toonIndex: toonTexture.toonIndex }
          : {
              path: toonTexture.path,
              colorSpace: toonTexture.colorSpace || 'gamma-2.2',
            }),
      };
    }

    instance.pipelineResources = await createPipelineResources(
      this,
      instance.scene,
      instance.model,
      instance.fileProvider,
      instance.modelPath,
      instance.pipelineResources?.textureCache ?? null,
    );
    this.updateSsssMaterialBuffers(instance);
  }

  /**
   * 指定マテリアルへ VRM shadeMultiply テクスチャ参照を割り当て直します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} selectedIndices - 対象マテリアル番号。
   * @param {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace?: 'gamma-2.2'|'none'}|{kind: 'none'}|null} shadeMultiplyTexture - shade 参照。
   */
  async updateMaterialShadeMultiplyTexture(instance, selectedIndices, shadeMultiplyTexture) {
    if (!instance || !Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return;
    }

    for (const index of selectedIndices) {
      const material = instance.model?.materials?.[index];
      if (!material) {
        continue;
      }
      if (!shadeMultiplyTexture || shadeMultiplyTexture.kind === 'none') {
        material.shadeMultiplyTexture = { kind: 'none' };
        continue;
      }

      material.shadeMultiplyTexture = {
        kind: shadeMultiplyTexture.kind,
        ...(shadeMultiplyTexture.kind === 'internal'
          ? { toonIndex: shadeMultiplyTexture.toonIndex }
          : {
              path: shadeMultiplyTexture.path,
              colorSpace: shadeMultiplyTexture.colorSpace || 'gamma-2.2',
            }),
      };
    }

    instance.pipelineResources = await createPipelineResources(
      this,
      instance.scene,
      instance.model,
      instance.fileProvider,
      instance.modelPath,
      instance.pipelineResources?.textureCache ?? null,
    );
    this.updateSsssMaterialBuffers(instance);
  }

  /**
   * 指定マテリアルへ emissive テクスチャ参照を割り当て直します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} selectedIndices - 対象マテリアル番号。
   * @param {{kind: 'internal', toonIndex: number}|{kind: 'path', path: string, colorSpace?: 'gamma-2.2'|'none'}|{kind: 'none'}|null} emissiveTexture - emissive 参照。
   */
  async updateMaterialEmissiveTexture(instance, selectedIndices, emissiveTexture) {
    if (!instance || !Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      return;
    }

    if (!instance.pipelineResources?.materials?.length) {
      instance.pipelineResources = await createPipelineResources(
        this,
        instance.scene,
        instance.model,
        instance.fileProvider,
        instance.modelPath,
        instance.pipelineResources?.textureCache ?? null,
      );
    }

    const textureCache = instance.pipelineResources?.textureCache instanceof Map
      ? instance.pipelineResources.textureCache
      : new Map();
    if (instance.pipelineResources) {
      instance.pipelineResources.textureCache = textureCache;
    }
    const emptyTexture = instance.pipelineResources?.emptyTexture ?? null;
    const emissiveResource = !emissiveTexture || emissiveTexture.kind === 'none'
      ? null
      : await loadTextureResourceFromReference(
          this.device,
          instance.modelPath,
          emissiveTexture,
          textureCache,
          instance.fileProvider,
          this.globalResources.internalToonTextureCache,
        );
    const resolvedEmissiveTexture = emissiveResource?.texture ?? emptyTexture;

    for (const index of selectedIndices) {
      const material = instance.model?.materials?.[index];
      const materialState = instance.morphController?.materialStates?.[index];
      const pipelineMaterial = instance.pipelineResources?.materials?.[index];
      if (!material) {
        continue;
      }
      if (!emissiveTexture || emissiveTexture.kind === 'none') {
        material.emissiveTexture = { kind: 'none' };
      } else {
        material.emissiveTexture = {
          kind: emissiveTexture.kind,
          ...(emissiveTexture.kind === 'internal'
            ? { toonIndex: emissiveTexture.toonIndex }
            : {
                path: emissiveTexture.path,
                colorSpace: emissiveTexture.colorSpace || 'gamma-2.2',
              }),
        };
      }
      material.emissiveSource = 'texture';
      if (materialState) {
        materialState.emissiveSource = 'texture';
        materialState.emissiveTexture = material.emissiveTexture.kind === 'none'
          ? { kind: 'none' }
          : {
              kind: material.emissiveTexture.kind,
              ...(material.emissiveTexture.kind === 'internal'
                ? { toonIndex: material.emissiveTexture.toonIndex }
                : {
                    path: material.emissiveTexture.path,
                    colorSpace: material.emissiveTexture.colorSpace || 'gamma-2.2',
                  }),
            };
      }

      if (pipelineMaterial && resolvedEmissiveTexture) {
        pipelineMaterial.emissiveTexture = resolvedEmissiveTexture;
        pipelineMaterial.hasEmissiveTexture = Boolean(emissiveResource?.texture);
        pipelineMaterial.emissiveSource = 'texture';
        pipelineMaterial.bindGroup = createMaterialBindGroup(
          this.device,
          this.globalResources.matBindGroupLayout,
          pipelineMaterial.buffer,
          pipelineMaterial.baseTexture || emptyTexture,
          pipelineMaterial.toonTexture || emptyTexture,
          pipelineMaterial.sphereTexture || emptyTexture,
          pipelineMaterial.emissiveTexture,
          pipelineMaterial.shadeMultiplyTexture || emptyTexture,
        );
      }
    }

    this.updateMaterialStateBuffers(instance, selectedIndices);
  }

  /**
   * 指定シェーダを使う全インスタンスの pipeline を再構築します。
   * @param {string} shaderName - シェーダ名。
   */
  async reloadShader(shaderName) {
    if (!this.shaderManager || typeof this.shaderManager.reloadShader !== 'function') {
      return;
    }

    await this.shaderManager.reloadShader(shaderName);
    for (const instance of this.instances) {
      if (!instance?.model?.materials?.some((material) => material.shaderName === shaderName)) {
        continue;
      }
      instance.pipelineResources = await createPipelineResources(
        this,
        instance.scene,
        instance.model,
        instance.fileProvider,
        instance.modelPath,
        instance.pipelineResources?.textureCache ?? null,
      );
    }
  }

  /**
   * マテリアルバッファを更新します。
   * @param {object} instance - モデルインスタンス。
   */
  updateMaterialBuffers(instance) {
    const morphController = instance.morphController;
    const modifiedMaterials = morphController.modifiedMaterials;
    const previousModifiedMaterials = morphController.previousModifiedMaterials || new Set();

    if (modifiedMaterials.size === 0 && previousModifiedMaterials.size === 0) {
      return;
    }

    const materialsToUpdate = new Set(previousModifiedMaterials);
    for (const matIdx of modifiedMaterials) {
      materialsToUpdate.add(matIdx);
    }

    for (const matIdx of materialsToUpdate) {
      this.writeMaterialBuffer(instance, matIdx);
    }

    morphController.previousModifiedMaterials = new Set(modifiedMaterials);
  }

  /**
   * 指定マテリアルの GPU バッファを再書き込みします。
   * @param {object} instance - モデルインスタンス。
   * @param {number} matIdx - マテリアルインデックス。
   */
  writeMaterialBuffer(instance, matIdx) {
    const material = instance?.pipelineResources?.materials?.[matIdx];
    const state = instance?.morphController?.materialStates?.[matIdx];
    const modelMaterial = instance?.model?.materials?.[matIdx];
    if (!material || !state || !modelMaterial) {
      return;
    }

    const materialData = new Float32Array(MATERIAL_UNIFORM_FLOAT_COUNT);
    const mtoon = normalizeMtoonSettings(state.mtoon || modelMaterial.mtoon);
    materialData.set(state.diffuse, 0);
    materialData.set(state.ambient, 4);
    materialData[7] = material.sphereMode || 0;
    materialData.set(state.specular, 8);
    materialData[11] = state.specularity;
    materialData[12] = modelMaterial.receiveShadow ? 1.0 : 0.0;
    materialData[13] = modelMaterial.hasEdge ? 1.0 : 0.0;
    materialData[14] = modelMaterial.alphaMode === 'cutout' ? 1.0 : 0.0;
    materialData[15] = material.hasToonTexture === true ? 1.0 : 0.0;
    materialData[16] = instance.ssssMaterialVisibility?.[matIdx] === false ? 0.0 : 1.0;
    materialData[17] = Number.isFinite(state.metalic) ? state.metalic : (Number.isFinite(modelMaterial.metalic) ? modelMaterial.metalic : 0.0);
    materialData[18] = Number.isFinite(state.roughness)
      ? state.roughness
      : (Number.isFinite(modelMaterial.roughness) ? modelMaterial.roughness : getDefaultMaterialRoughness());
    materialData[19] = resolveEmissiveSource(state, modelMaterial, material);
    materialData.set(Array.isArray(state.emissive) ? state.emissive : (Array.isArray(modelMaterial.emissive) ? modelMaterial.emissive : [0.0, 0.0, 0.0]), 20);
    materialData[23] = Number.isFinite(state.emissiveStrength)
      ? state.emissiveStrength
      : (Number.isFinite(modelMaterial.emissiveStrength) ? modelMaterial.emissiveStrength : 0.0);
    materialData[24] = material.hasEmissiveTexture === true ? 1.0 : 0.0;
    materialData[25] = mtoon.enabled ? 1.0 : 0.0;
    materialData[26] = mtoon.transparentWithZWrite ? 1.0 : 0.0;
    materialData[27] = mtoon.outlineWidthMode;
    materialData.set(mtoon.shadeColor, 28);
    materialData[31] = 1.0;
    materialData[32] = mtoon.shadeShift;
    materialData[33] = mtoon.shadeToony;
    materialData[34] = mtoon.receiveShadowRate;
    materialData[35] = mtoon.shadingGradeRate;
    materialData[36] = mtoon.lightColorAttenuation;
    materialData[37] = mtoon.indirectLightIntensity;
    materialData[38] = mtoon.rimLightingMix;
    materialData[39] = mtoon.outlineLightingMix;
    materialData.set(mtoon.rimColor, 40);
    materialData[43] = 1.0;
    materialData.set(mtoon.outlineColor, 44);
    materialData[47] = 1.0;
    materialData[48] = mtoon.outlineWidth;
    materialData[49] = mtoon.outlineScaledMaxDistance;
    materialData[50] = mtoon.outlineColorMode;
    materialData[51] = mtoon.renderQueueOffsetNumber;
    materialData[52] = mtoon.hasShadeMultiplyTexture ? 1.0 : 0.0;
    this.device.queue.writeBuffer(material.buffer, 0, materialData);
  }

  /**
   * SSSS のマテリアル選択状態を GPU バッファへ反映します。
   * @param {object} instance - モデルインスタンス。
   */
  updateSsssMaterialBuffers(instance) {
    if (!instance?.pipelineResources?.materials?.length) {
      return;
    }

    for (let i = 0; i < instance.pipelineResources.materials.length; i++) {
      this.writeMaterialBuffer(instance, i);
    }
  }

  /**
   * 指定したマテリアル群の状態反映用 GPU バッファを更新します。
   * @param {object} instance - モデルインスタンス。
   * @param {Array<number>} materialIndices - 更新対象インデックス。
   */
  updateMaterialStateBuffers(instance, materialIndices) {
    if (!Array.isArray(materialIndices) || materialIndices.length === 0) {
      return;
    }

    for (const matIdx of materialIndices) {
      this.writeMaterialBuffer(instance, matIdx);
    }
  }
}

/**
 * 指定シェーダを使う全インスタンスのマテリアルを別シェーダへ置き換えます。
 * @param {object} modelManager - ModelManager 互換オブジェクト。
 * @param {string} fromShaderName - 置換元シェーダ名。
 * @param {string} toShaderName - 置換先シェーダ名。
 * @returns {Promise<number>} 更新したインスタンス数。
 */
export async function replaceShaderAcrossInstances(modelManager, fromShaderName, toShaderName) {
  if (!modelManager || typeof modelManager.updateMaterialShader !== 'function') {
    return 0;
  }

  const sourceShaderName = typeof fromShaderName === 'string' ? fromShaderName.trim() : '';
  const targetShaderName = typeof toShaderName === 'string' ? toShaderName.trim() : '';
  if (!sourceShaderName || !targetShaderName || sourceShaderName === targetShaderName) {
    return 0;
  }

  const updateTasks = [];
  let updatedInstanceCount = 0;
  for (const instance of modelManager.instances || []) {
    const selectedIndices = [];
    const materials = instance?.model?.materials || [];
    for (let index = 0; index < materials.length; index++) {
      if (materials[index]?.shaderName === sourceShaderName) {
        selectedIndices.push(index);
      }
    }

    if (selectedIndices.length === 0) {
      continue;
    }

    updatedInstanceCount++;
    updateTasks.push(modelManager.updateMaterialShader(instance, selectedIndices, targetShaderName));
  }

  await Promise.all(updateTasks);
  return updatedInstanceCount;
}

/**
 * モデルインスタンスの AABB を更新します。
 * @param {object} instance - モデルインスタンス。
 */
function updateInstanceAabb(instance) {
  const positions = instance.scene.boneWorldPositions;
  if (!positions.length) {
    instance.aabb = null;
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const position of positions) {
    if (position[0] < minX) minX = position[0];
    if (position[0] > maxX) maxX = position[0];
    if (position[1] < minY) minY = position[1];
    if (position[1] > maxY) maxY = position[1];
    if (position[2] < minZ) minZ = position[2];
    if (position[2] > maxZ) maxZ = position[2];
  }
  const margin = instance.model.shadowBoundsMargin || 0;
  instance.aabb = {
    min: [minX - margin, minY - margin, minZ - margin],
    max: [maxX + margin, maxY + margin, maxZ + margin],
  };
}

/**
 * 透明マテリアルをモデルの列挙順に並べ替えます。
 * @param {Array<object>} materials - 透明マテリアル群。
 * @returns {Array<object>} 並べ替え済みマテリアル群。
 */
export function sortTransparentMaterialsByRenderOrder(materials) {
  if (materials.length <= 1) {
    return materials;
  }

  return [...materials].sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
}
