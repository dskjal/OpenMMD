import { createPipelineResources } from '../gpu/model-manager-pipelines.js';
import {
  applyModelSettingsData,
} from './model-settings-apply-service.js';
import {
  buildModelSettingsData,
  collectModelShaderSelectValues,
  isModelSettingsObject,
  parseModelSettingsJsonText,
  validateModelSettingsData,
} from './model-settings-codec.js';

/**
 * shader 名を export 用の canonical 値へ変換します。
 * @param {string} shaderName - Internal shader name.
 * @returns {string} Exported shader value.
 */
function resolveShaderLabelForExport(shaderName) {
  return String(shaderName || '').trim();
}

/**
 * Model settings data を export します。
 * @param {object|null} instance - Target instance.
 * @param {object} [options={}] - Build options.
 * @returns {object} Canonical model settings data.
 */
export function buildModelSettingsJson(instance, options = {}) {
  return buildModelSettingsData(instance, {
    ...options,
    resolveShaderLabelForExport,
  });
}

/**
 * model settings data を適用します。
 * @param {object} data - Parsed model settings data.
 * @param {object} [options={}] - Apply options.
 * @returns {Promise<object>} Apply result.
 */
export async function applyModelSettingsJsonData(data, options = {}) {
  const validated = validateModelSettingsData(data);
  const modelManager = options.modelManager ?? globalThis.window?.modelManager ?? null;
  const port = options.port ?? {
    resolveTargetInstanceByName(name) {
      return modelManager?.instances?.find((instance) => String(instance?.model?.name || '').trim() === name) ?? null;
    },
    async rebuildMaterialPipelines(targetInstance) {
      if (typeof options.rebuildMaterialPipelines === 'function') {
        await options.rebuildMaterialPipelines(targetInstance, modelManager);
        return;
      }
      if (!modelManager || !targetInstance?.scene || !targetInstance?.model) {
        return;
      }
      targetInstance.pipelineResources = await createPipelineResources(
        modelManager,
        targetInstance.scene,
        targetInstance.model,
        targetInstance.fileProvider,
        targetInstance.modelPath,
      );
    },
    updateMaterialStateBuffers(targetInstance, materialIndices) {
      if (typeof options.updateMaterialStateBuffers === 'function') {
        options.updateMaterialStateBuffers(targetInstance, materialIndices);
        return;
      }
      modelManager?.updateMaterialStateBuffers?.(targetInstance, materialIndices);
    },
    onApplied(targetInstance, summary) {
      options.onMaterialJsonApplied?.(targetInstance, summary);
    },
  };
  return applyModelSettingsData(validated, { port });
}

/**
 * Model settings file を読み込みます。
 * @param {Blob|File} file - Settings file.
 * @param {object} [options={}] - Apply options.
 * @returns {Promise<object>} Apply result.
 */
export async function loadModelSettingsFile(file, options = {}) {
  if (!file || typeof file.text !== 'function') {
    throw new Error('Model settings file is not readable.');
  }
  const parsed = parseModelSettingsJsonText(await file.text());
  return applyModelSettingsJsonData(parsed, options);
}

export {
  collectModelShaderSelectValues,
  isModelSettingsObject,
  parseModelSettingsJsonText,
  validateModelSettingsData,
};
