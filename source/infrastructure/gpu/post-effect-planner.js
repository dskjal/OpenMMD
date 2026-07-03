/**
 * ポストエフェクトのパス識別子です。
 */
export const POST_EFFECT_PASS_IDS = Object.freeze({
  BLOOM_EXTRACT: 'bloomExtract',
  BLOOM_DOWNSAMPLE: 'bloomDownsample',
  BLOOM_UPSAMPLE: 'bloomUpsample',
  BLOOM_COMPOSITE: 'bloomComposite',
  SSS_BLUR_H: 'sssBlurH',
  SSS_BLUR_V: 'sssBlurV',
  SSS_COMPOSITE: 'sssComposite',
  DOF_BLUR: 'dofBlur',
  DOF_COMPOSITE: 'dofComposite',
  CHROMATIC_ABERRATION: 'chromaticAberration',
  GAMMA_ONLY: 'gammaOnly',
});

/**
 * ポストエフェクトで使う論理テクスチャ名です。
 */
export const POST_EFFECT_TEXTURE_SLOTS = Object.freeze({
  SCENE_COLOR: 'sceneColor',
  POST_EFFECT_OUTPUT: 'postEffectOutput',
  SWAPCHAIN: 'swapchain',
  BLOOM_PING: 'bloomPing',
  BLOOM_PONG: 'bloomPong',
  DOF_PING: 'dofPing',
  SSS_PING: 'sssPing',
  SSS_PONG: 'sssPong',
});

const DEFAULT_POST_EFFECTS = Object.freeze({
  bloomEnabled: false,
  dofEnabled: false,
  gamma: 1.0,
  colorTemperature: 6500,
  chromaticAberration: 0.0,
  filmGrainAmount: 0.0,
  filmGrainAnimationMode: 'timeline',
  bloomThreshold: 0.98,
  bloomBlurAmount: 2.0,
  bloomAlpha: 1.0,
  bloomShadowMultiplier: 0.0,
  gltfLightStrength: 1.0,
  sssEnabled: false,
  sssRadius: 1.5,
  sssDepthThreshold: 0.01,
  sssNormalThreshold: 0.2,
  sssStrength: 0.2,
  ambientOcclusionEnabled: false,
  ambientOcclusionRadius: 0.4,
  ambientOcclusionBias: 0.02,
  ambientOcclusionIntensity: 1.0,
  ambientOcclusionBlurAmount: 1.0,
  ambientOcclusionSampleCount: 12,
  contactShadowEnabled: false,
  contactShadowLength: 0.08,
  contactShadowThickness: 0.01,
  contactShadowIntensity: 0.55,
  contactShadowStepCount: 8,
  dofBlurAmount: 2.0,
  dofAlgorithm: 'fast',
  dofFStop: 2.8,
  dofFocusPoint: [0.0, 0.0, 0.0],
});

const EPSILON = 0.0001;

/**
 * 指定状態からポストエフェクトの実行計画を構築します。
 * @param {object} state - レンダラー状態。
 * @returns {object} ポストエフェクト実行計画。
 */
export function buildPostEffectPlan(state) {
  const postEffects = {
    ...DEFAULT_POST_EFFECTS,
    ...(state?.postEffects ?? {}),
  };
  const useFxaa = Boolean(state?.currentAaMode?.includes('fxaa'));
  const useSsss = Boolean(postEffects.sssEnabled);
  const legacyEnabled = postEffects.enabled;
  const useBloom = postEffects.bloomEnabled !== undefined
    ? Boolean(postEffects.bloomEnabled)
    : Boolean(legacyEnabled);
  const useDof = postEffects.dofEnabled !== undefined
    ? Boolean(postEffects.dofEnabled)
    : Boolean(legacyEnabled);
  const useAmbientOcclusion = Boolean(postEffects.ambientOcclusionEnabled);
  const useContactShadow = Boolean(postEffects.contactShadowEnabled);
  const chromaticAberration = Math.abs(postEffects.chromaticAberration ?? 0.0);
  const filmGrainAmount = Math.max(0.0, postEffects.filmGrainAmount ?? 0.0);
  const useFilmGrain = filmGrainAmount > EPSILON;
  const useChromaticAberration = chromaticAberration > EPSILON && !useFxaa;
  const useGammaOnly = !useFxaa && (
    Math.abs(postEffects.gamma - 1.0) > EPSILON ||
    Math.abs((postEffects.colorTemperature ?? 6500) - 6500) > EPSILON
    || useFilmGrain
    || (!useBloom && !useDof && chromaticAberration > EPSILON)
  );
  const needsSceneResolve = useBloom || useDof || useGammaOnly || useFxaa || useChromaticAberration || useSsss;
  const bloomOutput = POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT;
  const dofCompositeOutput = POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT;
  const sssOutput = POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT;
  const passes = [];

  if (useSsss) {
    passes.push(
      createPass(POST_EFFECT_PASS_IDS.SSS_BLUR_H, 'render', POST_EFFECT_TEXTURE_SLOTS.SCENE_COLOR, POST_EFFECT_TEXTURE_SLOTS.SSS_PING),
      createPass(POST_EFFECT_PASS_IDS.SSS_BLUR_V, 'render', POST_EFFECT_TEXTURE_SLOTS.SSS_PING, POST_EFFECT_TEXTURE_SLOTS.SSS_PONG),
      createPass(POST_EFFECT_PASS_IDS.SSS_COMPOSITE, 'render', POST_EFFECT_TEXTURE_SLOTS.SCENE_COLOR, sssOutput),
    );
  }

  if (useDof) {
    passes.push(
      createPass(POST_EFFECT_PASS_IDS.DOF_BLUR, 'render', POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT, POST_EFFECT_TEXTURE_SLOTS.DOF_PING),
      createPass(POST_EFFECT_PASS_IDS.DOF_COMPOSITE, 'render', POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT, dofCompositeOutput),
    );
  }

  if (useBloom) {
    passes.push(
      createPass(POST_EFFECT_PASS_IDS.BLOOM_EXTRACT, 'render', POST_EFFECT_TEXTURE_SLOTS.SCENE_COLOR, POST_EFFECT_TEXTURE_SLOTS.BLOOM_PING),
      createPass(POST_EFFECT_PASS_IDS.BLOOM_DOWNSAMPLE, 'render', POST_EFFECT_TEXTURE_SLOTS.BLOOM_PING, POST_EFFECT_TEXTURE_SLOTS.BLOOM_PONG),
      createPass(POST_EFFECT_PASS_IDS.BLOOM_UPSAMPLE, 'render', POST_EFFECT_TEXTURE_SLOTS.BLOOM_PONG, POST_EFFECT_TEXTURE_SLOTS.BLOOM_PING),
      createPass(POST_EFFECT_PASS_IDS.BLOOM_COMPOSITE, 'render', POST_EFFECT_TEXTURE_SLOTS.SCENE_COLOR, bloomOutput),
    );
  }

  let finalColorSource = POST_EFFECT_TEXTURE_SLOTS.SCENE_COLOR;
  if (useSsss) {
    finalColorSource = sssOutput;
  }
  if (useDof) {
    finalColorSource = dofCompositeOutput;
  }
  if (useBloom) {
    finalColorSource = bloomOutput;
  }
  if (useGammaOnly || useChromaticAberration || useFxaa) {
    finalColorSource = POST_EFFECT_TEXTURE_SLOTS.POST_EFFECT_OUTPUT;
  }

  return {
    enabled: useBloom || useDof || useSsss || useFxaa || useGammaOnly || useChromaticAberration,
    useFxaa,
    useSsss,
    useBloom,
    useDof,
    useAmbientOcclusion,
    useContactShadow,
    useChromaticAberration,
    useFilmGrain,
    useGammaOnly,
    needsSceneResolve,
    needsDepthSampling: useDof || useSsss,
    finalColorSource,
    passes,
  };
}

/**
 * ポストエフェクト pass を表す plain object を生成します。
 * @param {string} id - pass id。
 * @param {string} kind - pass 種別。
 * @param {string} input - 入力論理テクスチャ名。
 * @param {string} output - 出力論理テクスチャ名。
 * @returns {object} pass。
 */
function createPass(id, kind, input, output) {
  return {
    id,
    kind,
    input,
    output,
  };
}
