import { AnimationController } from '../animation/animation.js';
import { cloneAnimationSource } from '../../infrastructure/animation/gltf-animation.js';
import { createSceneState } from './model-scene.js';
import { MorphController } from './morphing.js';
import { assignAnimationSourceToRuntimeInstance } from '../../application/animation/runtime-animation.js';

/**
 * 実行時用の簡易 MorphController を構築します。
 * @param {object} model - モデルデータ。
 * @returns {object} 最低限の MorphController 互換オブジェクト。
 */
function createFallbackMorphController(model) {
  return {
    model,
    dirty: true,
    materialStates: (model.materials || []).map(() => ({})),
    setWeight() {},
    setManualWeight() {},
    resetManualWeight() {},
    update() {},
    vmBuffer: {
      destroy() {},
    },
  };
}

/**
 * モデルと周辺 state から実行時 instance を構築します。
 * @param {object} options - 初期化オプション。
 * @param {object} options.model - モデルデータ。
 * @param {object} options.device - GPU デバイスまたは互換オブジェクト。
 * @param {object|null} [options.fileProvider=null] - ファイルプロバイダー。
 * @param {string} [options.modelPath=''] - モデルパス。
 * @param {object|null} [options.meshBuffers=null] - メッシュバッファ。
 * @param {object|null} [options.pipelineResources=null] - パイプラインリソース。
 * @param {object|null} [options.modelManager=null] - ModelManager 参照。
 * @param {object|null} [options.morphController=null] - 既存 MorphController。
 * @param {object|null} [options.animationController=null] - 既存 AnimationController。
 * @param {object|null} [options.scene=null] - 既存 scene state。
 * @returns {object} モデルインスタンス。
 */
export function createRuntimeModelInstance(options) {
  const model = options?.model;
  const device = options?.device;
  const morphController = options?.morphController
    || (device?.createBuffer ? new MorphController(device, model) : createFallbackMorphController(model));
  const animationController = options?.animationController || new AnimationController(model, morphController);
  const scene = options?.scene || createSceneState(device, model);
  scene.modelManager = options?.modelManager || scene.modelManager || null;

  const instance = {
    model,
    meshBuffers: options?.meshBuffers || null,
    morphController,
    animationController,
    scene,
    pipelineResources: options?.pipelineResources || null,
    modelPath: String(options?.modelPath || ''),
    fileProvider: options?.fileProvider || null,
    materialVisibility: model.materials.map(() => true),
    ssssMaterialVisibility: model.materials.map(() => true),
    materialCastShadow: model.materials.map((material) => material.drawShadow !== false),
    selectedTextureIndices: [],
    visible: true,
    aabb: null,
    vmd: null,
    vmdName: null,
    animationSource: null,
    animationSourceName: null,
    animationSourceKind: null,
    animationSourceType: null,
    _vrmaStoredIkEnabledStates: null,
    animationMappingBySourceKey: new Map(),
    gltfAnimationSources: Array.isArray(model.gltfAnimationSources)
      ? model.gltfAnimationSources.map((source) => cloneAnimationSource(source)).filter(Boolean)
      : [],
    gltfAssetContext: model.gltfAssetContext || null,
  };

  if (instance.gltfAnimationSources.length > 0) {
    assignAnimationSourceToRuntimeInstance(instance, instance.gltfAnimationSources[0], {
      syncVrmaIkState: false,
    });
  }

  return instance;
}
