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
let bloomViewNormal = normalize(in.viewNormal);
let bloomViewLightDir = -normalize((uniforms.view * vec4<f32>(normalize(uniforms.lightingParams.xyz), 0.0)).xyz);
let bloomNdotL = clamp(dot(bloomViewNormal, bloomViewLightDir), 0.0, 1.0);
let viewDir = normalize(uniforms.cameraWorldPosition.xyz - in.worldPos);
let texColor = textureSample(textureData, textureSampler, in.uv);
let baseColor = texColor.rgb * material.diffuse.rgb;
let alpha = texColor.a * material.diffuse.a;
let metallic = clamp(material_metalic(), 0.0, 1.0);
let roughness = clamp(material_roughness(), 0.0, 1.0);
var emissiveTerm = vec3<f32>(0.0);
if (material_emissive_source() <= 0.5) {
  emissiveTerm = material_emissive() * material_emissive_strength();
} else if (material_has_emissive_texture() > 0.5) {
  emissiveTerm = textureSample(emissiveData, textureSampler, in.uv).rgb * material_emissive_strength();
}

if (material_alpha_cutout() > 0.5 && alpha < ALPHA_CUTOUT_THRESHOLD) {
  discard;
}

let shadowFactor = select(1.0, calculate_shadow_csm(in.worldPos, in.viewPos, normal, lightDir), material_receive_shadow() > 0.5);
let contactShadowFactor = select(1.0, sample_contact_shadow_for_visible_fragment(in.position, in.viewPos), material_receive_shadow() > 0.5);
let bloomShadowFactor = select(1.0, bloomNdotL * shadowFactor * contactShadowFactor, material_receive_shadow() > 0.5);
let ambientOcclusionFactor = sample_ambient_occlusion_for_visible_fragment(in.position, in.viewPos);
let diffuseTerm = max(dot(normal, lightDir), 0.0) * shadowFactor * contactShadowFactor;
let halfDir = normalize(lightDir + viewDir);
let specularPower = max(mix(8.0, 128.0, 1.0 - roughness), 1.0);
let specularTerm = pow(max(dot(normal, halfDir), 0.0), specularPower) * mix(0.03, 0.35, metallic);
let nDotV = max(dot(normal, viewDir), 0.0);
let baseSpecular = mix(vec3<f32>(0.04), baseColor, metallic);
let fresnel = baseSpecular + (vec3<f32>(1.0) - baseSpecular) * pow(1.0 - nDotV, 5.0);
let envDiffuse = sample_environment(normal, 1.0) * baseColor * (1.0 - metallic);
let envSpecular = sample_environment(reflect(-viewDir, normal), roughness * roughness) * fresnel * mix(1.0, 0.12, roughness);

var finalColor = baseColor * ((0.12 * contactShadowFactor * ambientOcclusionFactor) + diffuseTerm);
finalColor += material_specular() * specularTerm;
finalColor *= uniforms.lightColor.rgb * uniforms.lightColor.a * clamp(uniforms.environmentParams.z, 0.0, dynamicRange);
finalColor += envDiffuse * ambientOcclusionFactor;
finalColor += envSpecular;
finalColor += emissiveTerm;

out.color = vec4<f32>(finalColor, alpha);
out.normal = encodedNormal;
out.mask = vec4<f32>(material_skin_mask(), encode_contact_shadow_depth(-in.viewPos.z), clamp(bloomShadowFactor, 0.0, 1.0), 1.0);
return out;
