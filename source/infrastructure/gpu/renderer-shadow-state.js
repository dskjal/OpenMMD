import { GLOBAL_UNIFORM_OFFSETS } from './renderer-gpu.js';
import { getDefaultsSnapshot } from '../config/defaults/defaults-manager.js';

const SHADOW_STATE_DEFAULTS_SECTION = 'rendererShadowState';

/**
 * 影関連 UI の state を作成します。
 * @param {{edgeOpacity?: number, shadowPower?: number, shadowBias?: number, shadowStrength?: number}} [initialValues={}] - UI 初期値。
 * @returns {{shadowEdgeSize: number, edgeShadowEdgeSize: number, shadowEdgeOpacity: number, shadowPower: number, shadowBias: number, shadowStrength: number}} 影 state。
 */
export function createShadowState(initialValues = {}) {
  const defaults = getDefaultsSnapshot(SHADOW_STATE_DEFAULTS_SECTION);
  return {
    shadowEdgeSize: Number.isFinite(defaults.shadowEdgeSize) ? defaults.shadowEdgeSize : 0.08,
    edgeShadowEdgeSize: Number.isFinite(defaults.edgeShadowEdgeSize) ? defaults.edgeShadowEdgeSize : 0.002,
    shadowEdgeOpacity: Number.isFinite(initialValues.edgeOpacity)
      ? initialValues.edgeOpacity
      : (Number.isFinite(defaults.shadowEdgeOpacity) ? defaults.shadowEdgeOpacity : 0.5),
    shadowPower: Number.isFinite(initialValues.shadowPower)
      ? initialValues.shadowPower
      : (Number.isFinite(defaults.shadowPower) ? defaults.shadowPower : 1.0),
    shadowBias: Number.isFinite(initialValues.shadowBias)
      ? initialValues.shadowBias
      : (Number.isFinite(defaults.shadowBias) ? defaults.shadowBias : 0.008),
    shadowStrength: Number.isFinite(initialValues.shadowStrength)
      ? initialValues.shadowStrength
      : (Number.isFinite(defaults.shadowStrength) ? defaults.shadowStrength : 1.0),
  };
}

/**
 * 影関連 state を GPU uniform バッファに同期します。
 * @param {object} globalResources - 共通 GPU リソース。
 * @param {GPUDevice} device - WebGPU デバイス。
 * @param {{shadowEdgeSize: number, edgeShadowEdgeSize: number, shadowEdgeOpacity: number, shadowPower: number, shadowBias: number, shadowStrength: number}} shadowState - 影 state。
 */
export function syncShadowUniforms(globalResources, device, shadowState) {
  if (!globalResources || !device || !shadowState) {
    return;
  }

  const dynamicRange = Number.isFinite(globalResources.dynamicRange)
    ? globalResources.dynamicRange
    : 10.0;
  const gridThickness = Number.isFinite(globalResources.gridThickness)
    ? globalResources.gridThickness
    : 1.0;

  globalResources.uniformData.set([
    shadowState.shadowEdgeSize,
    shadowState.shadowEdgeOpacity,
    shadowState.shadowBias,
    shadowState.shadowStrength,
  ], GLOBAL_UNIFORM_OFFSETS.shadowParams);
  globalResources.uniformData.set([
    shadowState.shadowPower,
    dynamicRange,
    gridThickness,
    0.0,
  ], GLOBAL_UNIFORM_OFFSETS.shadowPowerParams);
  globalResources.edgeUniformData.set([
    shadowState.edgeShadowEdgeSize,
    shadowState.shadowEdgeOpacity,
    shadowState.shadowBias,
    shadowState.shadowStrength,
  ], GLOBAL_UNIFORM_OFFSETS.shadowParams);
  globalResources.edgeUniformData.set([
    shadowState.shadowPower,
    dynamicRange,
    gridThickness,
    0.0,
  ], GLOBAL_UNIFORM_OFFSETS.shadowPowerParams);
  device.queue.writeBuffer(globalResources.uniformBuffer, 0, globalResources.uniformData);
  device.queue.writeBuffer(globalResources.edgeUniformBuffer, 0, globalResources.edgeUniformData);
}
