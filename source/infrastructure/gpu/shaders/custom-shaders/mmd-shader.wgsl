var out: MainFragmentOutput;
let encodedNormal = encode_view_normal(normalize(in.viewNormal));
if (uniforms.lightingParams.w > 0.5) {
  out.color = vec4<f32>(uniforms.edgeColor.rgb, sample_outline_alpha(in.uv));
  out.normal = vec4<f32>(0.0);
  out.mask = vec4<f32>(0.0);
  return out;
}

let normal = normalize(in.normal);
let lightDir = -normalize(uniforms.lightingParams.xyz);
let dotNL = dot(normal, lightDir);

// Shadow
let shadowMapFactor = select(0.0, calculate_shadow_csm(in.worldPos, in.viewPos, normal, lightDir), material_receive_shadow() > 0.5); // 影の部分は 0
let contactShadowFactor = select(1.0, sample_contact_shadow_for_visible_fragment(in.position, in.viewPos), material_receive_shadow() > 0.5);
let bloomShadowFactor = select(1.0, clamp(dotNL, 0.0, 1.0) * shadowMapFactor * contactShadowFactor, material_receive_shadow() > 0.5);
let ambientOcclusionFactor = sample_ambient_occlusion_for_visible_fragment(in.position, in.viewPos);
let shadowFactor = clamp(dotNL, 0.0, 1.0) * (shadowMapFactor * contactShadowFactor);
let lightIntensity = 1.0 - shadowFactor;

// 影色の計算
var shadowColor = vec3<f32>(1.0);
if (material_receive_shadow() < 0.5) {
  // 影の影響を受けない
  // pass through
}
else if (material_has_toon_texture() > 0.5){
  // 影色に toon テクスチャを使う。toon テクスチャを拾えているか検証する場合は vec3(0.0); を入れて、黒くなるか確かめる。
  let toonCoord = vec2<f32>(0.5, lightIntensity);
  shadowColor = pow(textureSample(toonData, toonSampler, toonCoord).rgb, vec3<f32>(uniforms.shadowPowerParams.x));
}
else {
  // MMD 実装では toon なしマテリアルは陰・影をつけない
  // pass through
}

// ベースの diffuse。MMD では shadowFactor は toon の計算にのみ使う
var finalColor = material_ambient() * ambientOcclusionFactor + uniforms.lightColor.rgb * material.diffuse.rgb;

// sphere の計算
var sphereColor = vec3<f32>(1.0);
if (material_sphere_mode() > 0.5) {
  let viewNormal = normalize(in.viewNormal);
  let sphereCoord = 0.5 * (1.0 + vec2<f32>(1.0, -1.0) * viewNormal.xy);
  sphereColor = textureSample(sphereData, sphereSampler, sphereCoord).rgb;
}
if (material_sphere_mode() > 0.5 && material_sphere_mode() < 1.5) {
  finalColor *= sphereColor;
} else if (material_sphere_mode() >= 1.5) {
  finalColor += sphereColor;
}

finalColor = clamp(finalColor, vec3<f32>(0.0), vec3<f32>(1.0));
let texColor = textureSample(textureData, textureSampler, in.uv);
let lightStrength = clamp(uniforms.environmentParams.z, 0.0, dynamicRange);
finalColor *= texColor.rgb * shadowColor * lightStrength;
finalColor = clamp(finalColor, vec3<f32>(0.0), vec3<f32>(1.0));

let alpha = texColor.a * material.diffuse.a;

// ここから先は普通は編集する必要はない
if (material_alpha_cutout() > 0.5) {
  if (alpha < ALPHA_CUTOUT_THRESHOLD) {
    discard;
  }
  out.color = vec4<f32>(finalColor, 1.0);
  out.normal = encodedNormal;
  out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), bloomShadowFactor, 1.0);
  return out;
}
out.color = vec4<f32>(finalColor, alpha);
out.normal = encodedNormal;
out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), bloomShadowFactor, 1.0);
return out;
