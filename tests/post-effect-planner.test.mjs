import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewerStateSnapshot } from '../source/infrastructure/api/api-state.js';
import {
  buildPostEffectPlan,
  POST_EFFECT_PASS_IDS,
  POST_EFFECT_TEXTURE_SLOTS,
} from '../source/infrastructure/gpu/post-effect-planner.js';

test('buildPostEffectPlan enables bloom without dof when requested', () => {
  const plan = buildPostEffectPlan({
    currentAaMode: 'none',
    postEffects: {
      bloomEnabled: true,
      dofEnabled: false,
      gamma: 1.0,
      colorTemperature: 6500,
      chromaticAberration: 0.0,
      filmGrainAmount: 0.0,
      sssEnabled: false,
      contactShadowEnabled: false,
    },
  });

  assert.equal(plan.useBloom, true);
  assert.equal(plan.useDof, false);
  assert.deepEqual(plan.passes.map((pass) => pass.id), [
    POST_EFFECT_PASS_IDS.BLOOM_EXTRACT,
    POST_EFFECT_PASS_IDS.BLOOM_DOWNSAMPLE,
    POST_EFFECT_PASS_IDS.BLOOM_UPSAMPLE,
    POST_EFFECT_PASS_IDS.BLOOM_COMPOSITE,
  ]);
  assert.equal(plan.passes.at(-1).output, POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT);
});

test('buildPostEffectPlan enables dof without bloom when requested', () => {
  const plan = buildPostEffectPlan({
    currentAaMode: 'none',
    postEffects: {
      bloomEnabled: false,
      dofEnabled: true,
      gamma: 1.0,
      colorTemperature: 6500,
      chromaticAberration: 0.0,
      filmGrainAmount: 0.0,
      sssEnabled: false,
      contactShadowEnabled: false,
    },
  });

  assert.equal(plan.useBloom, false);
  assert.equal(plan.useDof, true);
  assert.deepEqual(plan.passes.map((pass) => pass.id), [
    POST_EFFECT_PASS_IDS.DOF_BLUR,
    POST_EFFECT_PASS_IDS.DOF_COMPOSITE,
  ]);
  assert.equal(plan.passes[0].output, POST_EFFECT_TEXTURE_SLOTS.DOF_PING);
  assert.equal(plan.passes.at(-1).output, POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT);
});

test('buildPostEffectPlan applies bloom after dof when both are enabled', () => {
  const plan = buildPostEffectPlan({
    currentAaMode: 'none',
    postEffects: {
      bloomEnabled: true,
      dofEnabled: true,
      gamma: 1.0,
      colorTemperature: 6500,
      chromaticAberration: 0.0,
      filmGrainAmount: 0.0,
      sssEnabled: false,
      contactShadowEnabled: false,
    },
  });

  assert.equal(plan.useBloom, true);
  assert.equal(plan.useDof, true);
  assert.deepEqual(plan.passes.map((pass) => pass.id), [
    POST_EFFECT_PASS_IDS.DOF_BLUR,
    POST_EFFECT_PASS_IDS.DOF_COMPOSITE,
    POST_EFFECT_PASS_IDS.BLOOM_EXTRACT,
    POST_EFFECT_PASS_IDS.BLOOM_DOWNSAMPLE,
    POST_EFFECT_PASS_IDS.BLOOM_UPSAMPLE,
    POST_EFFECT_PASS_IDS.BLOOM_COMPOSITE,
  ]);
  assert.equal(plan.finalColorSource, POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT);
});

test('buildPostEffectPlan keeps both effects off when neither toggle is enabled', () => {
  const plan = buildPostEffectPlan({
    currentAaMode: 'none',
    postEffects: {
      bloomEnabled: false,
      dofEnabled: false,
      gamma: 1.0,
      colorTemperature: 6500,
      chromaticAberration: 0.0,
      filmGrainAmount: 0.0,
      sssEnabled: false,
      contactShadowEnabled: false,
    },
  });

  assert.equal(plan.useBloom, false);
  assert.equal(plan.useDof, false);
  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.passes, []);
});

test('buildViewerStateSnapshot publishes post effect flags', () => {
  const snapshot = buildViewerStateSnapshot({
    modelManager: { instances: [] },
    vmdManager: { vmds: new Map() },
    rendererState: {
      postEffects: {
        bloomEnabled: true,
        dofEnabled: false,
      },
    },
  });

  assert.deepEqual(snapshot.postEffects, {
    bloomEnabled: true,
    dofEnabled: false,
    ambientOcclusionEnabled: false,
    ambientOcclusionRadius: 0.4,
    ambientOcclusionBias: 0.02,
    ambientOcclusionIntensity: 1,
    ambientOcclusionBlurAmount: 1,
    ambientOcclusionSampleCount: 12,
    contactShadowEnabled: false,
    contactShadowLength: 0.08,
    contactShadowThickness: 0.01,
    contactShadowIntensity: 0.55,
    contactShadowBlurAmount: 1,
    contactShadowStepCount: 8,
    enabled: true,
  });
});
