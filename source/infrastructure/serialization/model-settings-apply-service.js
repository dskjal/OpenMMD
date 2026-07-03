import { loadDefaults } from '../config/defaults/defaults-manager.js';
import { applyTypedSettingsAdapters } from '../config/json-apply-runner.js';
import {
  cloneTextureReference,
  getCanonicalMaterialDefaults,
  MODEL_SETTINGS_TYPE,
  normalizeString,
} from './model-settings-schema.js';

/**
 * instance の bone 名 lookup を構築します。
 * @param {object|null} instance - Target instance.
 * @returns {Map<string, number[]>} Bone lookup.
 */
function createBoneIndexLookup(instance) {
  const lookup = new Map();
  const bones = Array.isArray(instance?.model?.bones) ? instance.model.bones : [];
  for (let index = 0; index < bones.length; index += 1) {
    const name = normalizeString(bones[index]?.name);
    if (!name) {
      continue;
    }
    const entries = lookup.get(name) || [];
    entries.push(index);
    lookup.set(name, entries);
  }
  return lookup;
}

/**
 * material entry defaults を補完します。
 * @param {object} entry - Canonical material entry.
 * @returns {object} Merged entry.
 */
function mergeMaterialDefaults(entry) {
  const defaults = getCanonicalMaterialDefaults();
  return {
    ...entry,
    toonTexture: cloneTextureReference(entry.toonTexture ?? { kind: 'none' }),
    diffuse: entry.diffuse ?? [1, 1, 1, 1],
    visibility: {
      ...defaults.visibility,
      ...(entry.visibility || {}),
    },
    raster: {
      ...defaults.raster,
      ...(entry.raster || {}),
    },
    metallic: entry.metallic ?? defaults.metallic,
    roughness: entry.roughness ?? defaults.roughness,
    emissive: {
      ...defaults.emissive,
      ...(entry.emissive || {}),
      color: entry.emissive?.color ?? defaults.emissive.color,
      texture: cloneTextureReference(entry.emissive?.texture ?? defaults.emissive.texture),
    },
  };
}

/**
 * bone entries を適用します。
 * @param {object} instance - Target instance.
 * @param {Array<object>} entries - Bone entries.
 * @returns {{changed: boolean, appliedBones: string[], skippedBones: string[]}} Apply summary.
 */
function applyBoneEntries(instance, entries) {
  const lookup = createBoneIndexLookup(instance);
  const usedBoneIndices = new Set();
  const appliedBones = [];
  const skippedBones = [];
  let changed = false;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const indices = lookup.get(entry.name) || [];
    const boneIndex = indices.find((candidateIndex) => !usedBoneIndices.has(candidateIndex)) ?? -1;
    if (boneIndex < 0) {
      skippedBones.push(entry.name);
      continue;
    }
    usedBoneIndices.add(boneIndex);
    const bone = instance?.model?.bones?.[boneIndex] ?? null;
    if (!bone) {
      skippedBones.push(entry.name);
      continue;
    }
    const currentLocks = bone.ikRotationLocks || { x: false, y: false, z: false };
    const nextLocks = {
      x: entry.ikRotationLocks?.x ?? Boolean(currentLocks.x),
      y: entry.ikRotationLocks?.y ?? Boolean(currentLocks.y),
      z: entry.ikRotationLocks?.z ?? Boolean(currentLocks.z),
    };
    const entryChanged = nextLocks.x !== Boolean(currentLocks.x)
      || nextLocks.y !== Boolean(currentLocks.y)
      || nextLocks.z !== Boolean(currentLocks.z);
    bone.ikRotationLocks = nextLocks;
    changed ||= entryChanged;
    appliedBones.push(entry.name);
  }

  return {
    changed,
    appliedBones,
    skippedBones,
  };
}

/**
 * material entry を runtime state へ反映します。
 * @param {object} instance - Target instance.
 * @param {number} materialIndex - Material index.
 * @param {object} entry - Canonical material entry.
 * @returns {{changed: boolean, requiresPipelineRebuild: boolean, requiresBufferUpdate: boolean}} Apply summary.
 */
function applyMaterialEntry(instance, materialIndex, entry) {
  const modelMaterial = instance?.model?.materials?.[materialIndex] ?? null;
  const morphMaterial = instance?.morphController?.materialStates?.[materialIndex] ?? null;
  const pipelineMaterial = instance?.pipelineResources?.materials?.[materialIndex] ?? null;
  if (!modelMaterial) {
    return {
      changed: false,
      requiresPipelineRebuild: false,
      requiresBufferUpdate: false,
    };
  }

  const merged = mergeMaterialDefaults(entry);
  let changed = false;
  let requiresPipelineRebuild = false;
  let requiresBufferUpdate = false;

  if (merged.shader && modelMaterial.shaderName !== merged.shader) {
    modelMaterial.shaderName = merged.shader;
    changed = true;
    requiresPipelineRebuild = true;
  }

  if (!Array.isArray(instance.materialVisibility)) {
    instance.materialVisibility = [];
  }
  if (instance.materialVisibility[materialIndex] !== merged.visibility.visible) {
    instance.materialVisibility[materialIndex] = merged.visibility.visible;
    changed = true;
    requiresBufferUpdate = true;
  }

  if (!Array.isArray(instance.ssssMaterialVisibility)) {
    instance.ssssMaterialVisibility = [];
  }
  if (instance.ssssMaterialVisibility[materialIndex] !== merged.visibility.ssss) {
    instance.ssssMaterialVisibility[materialIndex] = merged.visibility.ssss;
    changed = true;
    requiresBufferUpdate = true;
  }

  if (!Array.isArray(instance.materialCastShadow)) {
    instance.materialCastShadow = [];
  }
  if (instance.materialCastShadow[materialIndex] !== merged.visibility.castShadow) {
    instance.materialCastShadow[materialIndex] = merged.visibility.castShadow;
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.receiveShadow !== merged.visibility.receiveShadow) {
    modelMaterial.receiveShadow = merged.visibility.receiveShadow;
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.noCull !== merged.raster.noCull) {
    modelMaterial.noCull = merged.raster.noCull;
    if (pipelineMaterial) {
      pipelineMaterial.noCull = merged.raster.noCull;
    }
    changed = true;
    requiresPipelineRebuild = true;
  }

  if (modelMaterial.hasEdge !== merged.raster.hasEdge) {
    modelMaterial.hasEdge = merged.raster.hasEdge;
    if (pipelineMaterial) {
      pipelineMaterial.hasEdge = merged.raster.hasEdge;
    }
    changed = true;
    requiresPipelineRebuild = true;
  }

  const nextToonTexture = cloneTextureReference(merged.toonTexture);
  if (JSON.stringify(modelMaterial.toonTexture || null) !== JSON.stringify(nextToonTexture || null)) {
    modelMaterial.toonTexture = nextToonTexture;
    changed = true;
    requiresPipelineRebuild = true;
  }

  if (JSON.stringify(modelMaterial.diffuse || null) !== JSON.stringify(merged.diffuse || null)) {
    modelMaterial.diffuse = merged.diffuse.slice();
    if (morphMaterial) {
      morphMaterial.diffuse = merged.diffuse.slice();
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.metalic !== merged.metallic) {
    modelMaterial.metalic = merged.metallic;
    if (morphMaterial) {
      morphMaterial.metalic = merged.metallic;
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.roughness !== merged.roughness) {
    modelMaterial.roughness = merged.roughness;
    if (morphMaterial) {
      morphMaterial.roughness = merged.roughness;
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.emissiveSource !== merged.emissive.source) {
    modelMaterial.emissiveSource = merged.emissive.source;
    if (morphMaterial) {
      morphMaterial.emissiveSource = merged.emissive.source;
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  if (JSON.stringify(modelMaterial.emissive || null) !== JSON.stringify(merged.emissive.color || null)) {
    modelMaterial.emissive = merged.emissive.color.slice();
    if (morphMaterial) {
      morphMaterial.emissive = merged.emissive.color.slice();
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  if (modelMaterial.emissiveStrength !== merged.emissive.strength) {
    modelMaterial.emissiveStrength = merged.emissive.strength;
    if (morphMaterial) {
      morphMaterial.emissiveStrength = merged.emissive.strength;
    }
    changed = true;
    requiresBufferUpdate = true;
  }

  const nextEmissiveTexture = cloneTextureReference(merged.emissive.texture);
  if (JSON.stringify(modelMaterial.emissiveTexture || null) !== JSON.stringify(nextEmissiveTexture || null)) {
    modelMaterial.emissiveTexture = nextEmissiveTexture;
    if (morphMaterial) {
      morphMaterial.emissiveTexture = cloneTextureReference(nextEmissiveTexture);
    }
    changed = true;
    requiresPipelineRebuild = true;
  }

  return {
    changed,
    requiresPipelineRebuild,
    requiresBufferUpdate,
  };
}

/**
 * material entries を適用します。
 * @param {object} instance - Target instance.
 * @param {Array<object>} entries - Material entries.
 * @returns {{changed: boolean, appliedMaterials: string[], skippedMaterials: string[], changedMaterialIndices: number[], requiresPipelineRebuild: boolean, requiresBufferUpdate: boolean}} Apply summary.
 */
function applyMaterialEntries(instance, entries) {
  const appliedMaterials = [];
  const skippedMaterials = [];
  const changedMaterialIndices = [];
  let changed = false;
  let requiresPipelineRebuild = false;
  let requiresBufferUpdate = false;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const materialIndex = instance?.model?.materials?.findIndex((material) => normalizeString(material?.name) === entry.name) ?? -1;
    if (materialIndex < 0) {
      skippedMaterials.push(entry.name);
      continue;
    }
    const entryResult = applyMaterialEntry(instance, materialIndex, entry);
    if (entryResult.changed) {
      changedMaterialIndices.push(materialIndex);
      changed = true;
    }
    requiresPipelineRebuild ||= entryResult.requiresPipelineRebuild;
    requiresBufferUpdate ||= entryResult.requiresBufferUpdate;
    appliedMaterials.push(entry.name);
  }

  return {
    changed,
    appliedMaterials,
    skippedMaterials,
    changedMaterialIndices,
    requiresPipelineRebuild,
    requiresBufferUpdate,
  };
}

/**
 * model settings data を適用します。
 * @param {object} data - Validated model settings data.
 * @param {object} options - Apply options.
 * @param {object} options.port - Runtime port.
 * @returns {Promise<object>} Apply result.
 */
export async function applyModelSettingsData(data, options = {}) {
  await loadDefaults();
  const port = options.port ?? {};
  const targetModelName = normalizeString(data?.targetModel?.name);
  const targetInstance = await port.resolveTargetInstanceByName?.(targetModelName);
  if (!targetInstance) {
    return {
      applied: false,
      type: MODEL_SETTINGS_TYPE,
      targetModelName,
      appliedKeys: [],
      appliedMaterials: [],
      skippedMaterials: [],
      appliedBones: [],
      skippedBones: [],
      changedMaterialIndices: [],
      skippedReason: 'model-not-found',
    };
  }

  const materialSummary = {
    changed: false,
    appliedMaterials: [],
    skippedMaterials: [],
    changedMaterialIndices: [],
    requiresPipelineRebuild: false,
    requiresBufferUpdate: false,
  };
  const boneSummary = {
    changed: false,
    appliedBones: [],
    skippedBones: [],
  };

  const adapterResult = await applyTypedSettingsAdapters(data, {
    expectedType: MODEL_SETTINGS_TYPE,
    adapters: [
      {
        key: 'materials',
        shouldApply: (sectionData) => Array.isArray(sectionData),
        apply: async (sectionData) => {
          Object.assign(materialSummary, applyMaterialEntries(targetInstance, sectionData));
        },
      },
      {
        key: 'bones',
        shouldApply: (sectionData) => Array.isArray(sectionData),
        apply: async (sectionData) => {
          Object.assign(boneSummary, applyBoneEntries(targetInstance, sectionData));
        },
      },
    ],
  });
  if (adapterResult.skippedReason) {
    return {
      ...adapterResult,
      targetModelName,
      appliedMaterials: [],
      skippedMaterials: [],
      appliedBones: [],
      skippedBones: [],
      changedMaterialIndices: [],
    };
  }

  const changed = Boolean(materialSummary.changed || boneSummary.changed);
  if (!changed) {
    return {
      applied: false,
      type: MODEL_SETTINGS_TYPE,
      targetModelName,
      appliedKeys: adapterResult.appliedKeys,
      appliedMaterials: materialSummary.appliedMaterials,
      skippedMaterials: materialSummary.skippedMaterials,
      appliedBones: boneSummary.appliedBones,
      skippedBones: boneSummary.skippedBones,
      changedMaterialIndices: materialSummary.changedMaterialIndices,
      skippedReason: 'no-applicable-entries',
    };
  }

  if (materialSummary.changedMaterialIndices.length > 0 && targetInstance?.morphController) {
    targetInstance.morphController.dirty = true;
  }
  if (materialSummary.requiresPipelineRebuild && materialSummary.changedMaterialIndices.length > 0) {
    await port.rebuildMaterialPipelines?.(targetInstance, materialSummary.changedMaterialIndices);
  }
  if (materialSummary.requiresBufferUpdate && materialSummary.changedMaterialIndices.length > 0) {
    port.updateMaterialStateBuffers?.(targetInstance, materialSummary.changedMaterialIndices);
  }

  const summary = {
    targetModelName,
    appliedKeys: adapterResult.appliedKeys,
    appliedMaterials: materialSummary.appliedMaterials,
    skippedMaterials: materialSummary.skippedMaterials,
    appliedBones: boneSummary.appliedBones,
    skippedBones: boneSummary.skippedBones,
    changedMaterialIndices: materialSummary.changedMaterialIndices,
  };
  port.onApplied?.(targetInstance, summary);

  return {
    applied: true,
    type: MODEL_SETTINGS_TYPE,
    ...summary,
  };
}
