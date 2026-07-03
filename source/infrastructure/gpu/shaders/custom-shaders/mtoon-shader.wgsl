var out: MainFragmentOutput;
let encodedNormal = encode_view_normal(normalize(in.viewNormal));
if (uniforms.lightingParams.w > 0.5) {
  out.color = vec4<f32>(uniforms.edgeColor.rgb, sample_outline_alpha(in.uv));
  out.normal = vec4<f32>(0.0);
  out.mask = vec4<f32>(0.0);
  return out;
}

// mtoon mtoonParams
let shadeShift = material.mtoonParams0.x;
let toony = clamp(material.mtoonParams0.y, 0.0, 1.0);
let feather = max(0.0001, 1.0 - toony);
let receiveShadowRate = material.mtoonParams0.z;
let giEqualization = clamp(material.mtoonParams1.y, 0.0, 1.0);
let rimLightingMix = material.mtoonParams1.z;
let outlineLightingMix = material.mtoonParams1.w;
let outlineColorMode = material.mtoonParams2.z;
let metallic = clamp(material_metalic(), 0.0, 1.0);
let roughness = clamp(material_roughness(), 0.0, 1.0);

// lighting
let normal = normalize(in.normal);
let viewNormal = normalize(in.viewNormal);
let lightDir = -normalize(uniforms.lightingParams.xyz);
let viewDir = normalize(uniforms.cameraWorldPosition.xyz - in.worldPos);
let halfDir = normalize(lightDir + viewDir);
let baseSample = textureSample(textureData, textureSampler, in.uv);
let alpha = baseSample.a * material.diffuse.a;
if (material_alpha_cutout() > 0.5 && alpha < ALPHA_CUTOUT_THRESHOLD) {
  discard;
}
let receiveShadow = material_receive_shadow() > 0.5;

let baseColor = baseSample.rgb * material.diffuse.rgb;
let nDotL = dot(normal, lightDir);
let nDotV = max(dot(normal, viewDir), 0.0);
let shadowFactor = select(1.0, calculate_shadow_csm(in.worldPos, in.viewPos, normal, lightDir), receiveShadow);
let contactShadowFactor = select(1.0, sample_contact_shadow_for_visible_fragment(in.position, in.viewPos), receiveShadow);
let ambientOcclusionFactor = sample_ambient_occlusion_for_visible_fragment(in.position, in.viewPos);
// 影を描画しないマテリアルはブルームをかけない。影を描画しないマテリアルは顔に設定されることが多く、顔にブルームがかかって不便なのでこの仕様になっている
var bloomShadowFactor = select(0.0, clamp(nDotL, 0.0, 1.0) * shadowFactor * contactShadowFactor, receiveShadow);
let shadingInput = clamp(
  (nDotL * shadowFactor * contactShadowFactor)
  + shadeShift
  + (1.0 - receiveShadowRate) * 0.5,
  0.0,
  1.0,
);
var shadeColorFactor = material.mtoonShadeColor.rgb;
var shadeMultiplier = baseColor;
if (material_has_toon_texture() > 0.5) {
  let toonCoord = vec2<f32>(0.5, 1.0 - shadingInput);
  shadeMultiplier *= textureSample(toonData, toonSampler, toonCoord).rgb;
}
else if (material_has_shade_multiply_texture() > 0.5) {
  shadeMultiplier *= textureSample(shadeData, textureSampler, in.uv).rgb;
}
var shadeColor = pow(shadeColorFactor * shadeMultiplier, vec3<f32>(uniforms.shadowPowerParams.x));

let shadeMix = smoothstep(0.5 - feather, 0.5 + feather, shadingInput);
let diffuseColor = mix(shadeColor, baseColor, shadeMix);
let directLight = uniforms.lightColor.rgb * uniforms.lightColor.a * clamp(uniforms.environmentParams.z, 0.0, dynamicRange);
var litColor = diffuseColor * ambientOcclusionFactor * directLight;
let rawGi = sample_environment(normal, 1.0);
let uniformedGi = 0.5 * (
  sample_environment(vec3<f32>(0.0, 1.0, 0.0), 1.0)
  + sample_environment(vec3<f32>(0.0, -1.0, 0.0), 1.0)
);
let gi = mix(rawGi, uniformedGi, giEqualization) * ambientOcclusionFactor;
litColor += gi * diffuseColor;
let baseSpecular = mix(material_specular(), baseColor, metallic);
let fresnel = baseSpecular + (vec3<f32>(1.0) - baseSpecular) * pow(1.0 - nDotV, 5.0);
let envDiffuse = sample_environment(normal, 1.0) * diffuseColor * (1.0 - metallic);
let envSpecular = sample_environment(reflect(-viewDir, normal), roughness * roughness) * fresnel * mix(1.0, 0.12, roughness);
let specularPower = max(mix(8.0, 128.0, 1.0 - roughness), 1.0);
let specularTerm = pow(max(dot(normal, halfDir), 0.0), specularPower) * mix(0.03, 0.35, metallic);
litColor += material_specular() * specularTerm;
litColor += envDiffuse * ambientOcclusionFactor + envSpecular;

var rimColor = material.mtoonRimColor.rgb;
let rimStrength = clamp(1.0 - max(dot(normal, viewDir), 0.0), 0.0, 1.0);
rimColor *= pow(rimStrength, 2.0) * (1.0 - clamp(rimLightingMix, 0.0, 1.0) * max(nDotL, 0.0));

var sphereTerm = vec3<f32>(0.0);
if (material_sphere_mode() > 0.5) {
  let sphereCoord = 0.5 * (1.0 + vec2<f32>(1.0, -1.0) * viewNormal.xy);
  sphereTerm = textureSample(sphereData, sphereSampler, sphereCoord).rgb;
}
if (material_sphere_mode() > 0.5 && material_sphere_mode() < 1.5) {
  litColor *= sphereTerm;
} else if (material_sphere_mode() >= 1.5) {
  litColor += sphereTerm;
}

var emissiveTerm = material_emissive() * material_emissive_strength();
if (material_emissive_source() > 0.5 && material_has_emissive_texture() > 0.5) {
  emissiveTerm = textureSample(emissiveData, textureSampler, in.uv).rgb * material_emissive_strength();
}
// emissive マテリアルは影の中でもブルームがかかる
bloomShadowFactor = clamp(bloomShadowFactor + material_emissive_strength(), 0.0, 1.0);

let outlineMix = clamp(outlineLightingMix, 0.0, 1.0);
let outlineTint = mix(material.mtoonOutlineColor.rgb, litColor, outlineMix * clamp(outlineColorMode, 0.0, 1.0));
let finalColor = litColor + rimColor + emissiveTerm + outlineTint * 0.02;

out.color = vec4<f32>(finalColor, alpha);
out.normal = encodedNormal;
out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), bloomShadowFactor, 1.0);
return out;
