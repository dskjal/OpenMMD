struct Uniforms {
  mvp: mat4x4<f32>,            // offset 0
  view: mat4x4<f32>,           // offset 64
  lightingParams: vec4<f32>,   // offset 128 (xyz: lightDirection, w: isEdge)
  lightColor: vec4<f32>,       // offset 144 (rgba: light color / strength)
  shadowParams: vec4<f32>,     // offset 160 (x: edgeSize, y: edgeOpacity, z: shadowBias, w: shadowStrength)
  shadowInfo: vec4<f32>,       // offset 176 (x: cascadeCount, y: shadowMapSize, z: boneThickness, w: shadowCascadeIndex)
  shadowSplits: vec4<f32>,     // offset 192
  shadowMatrices: array<mat4x4<f32>, 4>, // offset 208
  edgeColor: vec4<f32>,        // offset 464
  resolution: vec4<f32>,       // offset 480
  environmentParams: vec4<f32>, // offset 496 (x: maxMipLevel, y: intensity, z: gltfLightStrength, w: loadedFlag)
  cameraWorldPosition: vec4<f32>, // offset 512
  shadowPowerParams: vec4<f32>, // offset 528 (x: shadowPower, y: dynamicRange, z: gridThickness, w: reserved)
};

struct SdefResult {
  pos: vec3<f32>,
  normal: vec3<f32>,
};

struct ContactShadowUniforms {
  length: f32,
  thickness: f32,
  intensity: f32,
  stepCount: f32,
  nearPlane: f32,
  farPlane: f32,
  tanHalfFovY: f32,
  aspect: f32,
  lightDirectionX: f32,
  lightDirectionY: f32,
  lightDirectionZ: f32,
  blurAmount: f32,
  padding1: f32,
  padding2: f32,
  padding3: f32,
  padding4: f32,
};

struct AmbientOcclusionUniforms {
  radius: f32,
  bias: f32,
  intensity: f32,
  sampleCount: f32,
  blurAmount: f32,
  nearPlane: f32,
  farPlane: f32,
  tanHalfFovY: f32,
  aspect: f32,
  padding0: f32,
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var toonSampler: sampler;
@group(0) @binding(3) var sphereSampler: sampler;
@group(0) @binding(4) var shadowData: texture_depth_2d_array;
@group(0) @binding(5) var shadowSampler: sampler_comparison;
@group(0) @binding(6) var environmentData: texture_2d<f32>;
@group(0) @binding(7) var environmentSampler: sampler;
@group(0) @binding(8) var prepassDepthData: texture_2d<f32>;
@group(0) @binding(9) var prepassNormalData: texture_2d<f32>;
@group(0) @binding(10) var contactShadowMaskData: texture_2d<f32>;
@group(0) @binding(11) var<uniform> contactShadowUniforms: ContactShadowUniforms;
@group(0) @binding(12) var ambientOcclusionMaskData: texture_2d<f32>;
@group(0) @binding(13) var<uniform> ambientOcclusionUniforms: AmbientOcclusionUniforms;

@group(2) @binding(0) var<storage, read> boneMatrices: array<mat4x4<f32>>;

struct Material {
  diffuse: vec4<f32>,
  ambientSphereMode: vec4<f32>,
  specularShininess: vec4<f32>,
  flags0: vec4<f32>,
  flags1: vec4<f32>,
  emissiveStrengthData: vec4<f32>,
  flags2: vec4<f32>,
  mtoonShadeColor: vec4<f32>,
  mtoonParams0: vec4<f32>,
  mtoonParams1: vec4<f32>,
  mtoonRimColor: vec4<f32>,
  mtoonOutlineColor: vec4<f32>,
  mtoonParams2: vec4<f32>,
  mtoonTextureFlags: vec4<f32>,
};

@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var textureData: texture_2d<f32>;
@group(1) @binding(2) var toonData: texture_2d<f32>;
@group(1) @binding(3) var sphereData: texture_2d<f32>;
@group(1) @binding(4) var emissiveData: texture_2d<f32>;
@group(1) @binding(5) var shadeData: texture_2d<f32>;

const ALPHA_CUTOUT_THRESHOLD: f32 = 0.05; // このしきい値以下のアルファの画素は捨てられる

fn material_ambient() -> vec3<f32> {
  return material.ambientSphereMode.xyz;
}

fn material_sphere_mode() -> f32 {
  return material.ambientSphereMode.w;
}

fn material_specular() -> vec3<f32> {
  return material.specularShininess.xyz;
}

fn material_shininess() -> f32 {
  return material.specularShininess.w;
}

fn material_receive_shadow() -> f32 {
  return material.flags0.x;
}

fn material_has_edge() -> f32 {
  return material.flags0.y;
}

fn material_alpha_cutout() -> f32 {
  return material.flags0.z;
}

fn material_has_toon_texture() -> f32 {
  return material.flags0.w;
}

fn material_has_shade_multiply_texture() -> f32 {
  return material.mtoonTextureFlags.x;
}

fn material_skin_mask() -> f32 {
  return material.flags1.x;
}

fn material_metalic() -> f32 {
  return material.flags1.y;
}

fn material_roughness() -> f32 {
  return material.flags1.z;
}

fn material_emissive_source() -> f32 {
  return material.flags1.w;
}

fn material_emissive() -> vec3<f32> {
  return material.emissiveStrengthData.xyz;
}

fn material_emissive_strength() -> f32 {
  return material.emissiveStrengthData.w;
}

fn material_has_emissive_texture() -> f32 {
  return material.flags2.x;
}

fn material_mtoon_enabled() -> f32 {
  return material.flags2.y;
}

fn material_mtoon_transparent_zwrite() -> f32 {
  return material.flags2.z;
}

fn material_mtoon_outline_width_mode() -> f32 {
  return material.flags2.w;
}

fn sample_material_alpha(uv: vec2<f32>) -> f32 {
  let texColor = textureSample(textureData, textureSampler, uv);
  return texColor.a * material.diffuse.a;
}

fn sample_outline_alpha(uv: vec2<f32>) -> f32 {
  return clamp(sample_material_alpha(uv) * uniforms.edgeColor.a * uniforms.shadowParams.y, 0.0, 1.0);
}

fn environment_direction_to_uv(direction: vec3<f32>) -> vec2<f32> {
  let normalizedDirection = normalize(direction);
  let u = atan2(normalizedDirection.x, normalizedDirection.z) * (0.15915494309189535) + 0.5;
  let v = acos(clamp(normalizedDirection.y, -1.0, 1.0)) * 0.3183098861837907;
  return vec2<f32>(u, v);
}

fn sample_environment(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
  let mipLevel = max(0.0, uniforms.environmentParams.x);
  let lod = clamp(roughness, 0.0, 1.0) * mipLevel;
  let uv = environment_direction_to_uv(direction);
  return textureSampleLevel(environmentData, environmentSampler, uv, lod).rgb * uniforms.environmentParams.y;
}

struct ShadowVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) viewNormal: vec3<f32>,
  @location(3) worldPos: vec3<f32>,
  @location(4) viewPos: vec3<f32>,
};

struct MainFragmentOutput {
  @location(0) color: vec4<f32>,
  @location(1) normal: vec4<f32>,
  // mask = (skinMask, encodedViewDepthForSss, bloomShadowFactor, validPixelFlag)
  @location(2) mask: vec4<f32>,
};

struct DepthPrepassOutput {
  @location(0) normal: vec4<f32>,
  @location(1) depth: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) boneIndices: vec4<f32>,
  @location(4) boneWeights: vec4<f32>,
  @location(5) morphPosition: vec3<f32>,
  @location(6) weightType: f32,
  @location(7) sdefC: vec3<f32>,
  @location(8) sdefR0: vec3<f32>,
  @location(9) sdefR1: vec3<f32>,
  @location(10) edgeScale: f32,
) -> VertexOutput {
  var out: VertexOutput;

  // Morphing (added before skinning)
  let basePos = position + morphPosition;

  // Skinning
  var skinnedPos = vec3<f32>(0.0);
  var skinnedNormal = vec3<f32>(0.0);

  if (weightType < 0.5) { // BDEF1
    let m = boneMatrices[u32(boneIndices.x + 0.5)];
    skinnedPos = (m * vec4<f32>(basePos, 1.0)).xyz;
    skinnedNormal = (m * vec4<f32>(normal, 0.0)).xyz;
  } else if (weightType < 1.5) { // BDEF2
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x + 
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y;
    skinnedNormal = (m1 * vec4<f32>(normal, 0.0)).xyz * boneWeights.x + 
                    (m2 * vec4<f32>(normal, 0.0)).xyz * boneWeights.y;
  } else if (weightType < 2.5) { // BDEF4
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    let m3 = boneMatrices[u32(boneIndices.z + 0.5)];
    let m4 = boneMatrices[u32(boneIndices.w + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x +
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y +
                 (m3 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.z +
                 (m4 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.w;
    skinnedNormal = (m1 * vec4<f32>(normal, 0.0)).xyz * boneWeights.x +
                    (m2 * vec4<f32>(normal, 0.0)).xyz * boneWeights.y +
                    (m3 * vec4<f32>(normal, 0.0)).xyz * boneWeights.z +
                    (m4 * vec4<f32>(normal, 0.0)).xyz * boneWeights.w;
  } else if (weightType < 3.5) {
    // SDEF (Spherical Deformation)
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];

    let res = sdef_skinning(
      basePos,
      normal,
      m1,
      m2,
      boneWeights.x,
      sdefC,
      sdefR0,
      sdefR1
    );

    skinnedPos = res.pos;
    skinnedNormal = res.normal;

  } else { // QDEF (PMX 2.1, handle as BDEF4 for now)
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    let m3 = boneMatrices[u32(boneIndices.z + 0.5)];
    let m4 = boneMatrices[u32(boneIndices.w + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x +
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y +
                 (m3 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.z +
                 (m4 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.w;
    skinnedNormal = (m1 * vec4<f32>(normal, 0.0)).xyz * boneWeights.x +
                    (m2 * vec4<f32>(normal, 0.0)).xyz * boneWeights.y +
                    (m3 * vec4<f32>(normal, 0.0)).xyz * boneWeights.z +
                    (m4 * vec4<f32>(normal, 0.0)).xyz * boneWeights.w;
  }

  skinnedNormal = normalize(skinnedNormal);
  let pos = uniforms.mvp * vec4<f32>(skinnedPos, 1.0);

  // 線の描画・背面法（Inverted hull）の処理
  // 透明度は各 custom shader の sample_outline_alpha で設定する
  if (uniforms.lightingParams.w > 0.5 && material_has_edge() > 0.5) {
      let edgeOffset = uniforms.shadowParams.x * pos.w;
      let pos2 = uniforms.mvp * vec4<f32>(skinnedPos + skinnedNormal, 1.0);
      let edgeNormal = normalize((pos2.xy / pos2.w) - (pos.xy / pos.w));
      out.position = pos;
      out.position.x += edgeNormal.x * edgeScale * edgeOffset;
      out.position.y += edgeNormal.y * edgeScale * edgeOffset;
      out.position.z += edgeScale * edgeOffset * 0.01;
  } else {
      out.position = pos;
  }

  out.uv = uv;
  out.normal = skinnedNormal;
  out.viewNormal = (uniforms.view * vec4<f32>(skinnedNormal, 0.0)).xyz;
  out.worldPos = skinnedPos;
  out.viewPos = (uniforms.view * vec4<f32>(skinnedPos, 1.0)).xyz;
  return out;
}

fn select_shadow_cascade(viewDepth: f32) -> u32 {
    let cascadeCount = u32(uniforms.shadowInfo.x + 0.5);
    if (cascadeCount <= 1u || viewDepth <= uniforms.shadowSplits.x) {
        return 0u;
    }
    if (cascadeCount <= 2u || viewDepth <= uniforms.shadowSplits.y) {
        return 1u;
    }
    if (cascadeCount <= 3u || viewDepth <= uniforms.shadowSplits.z) {
        return 2u;
    }
    return 3u;
}

fn shadow_cascade_transition_width(splitDistance: f32) -> f32 {
    return max(splitDistance * 0.08, 0.15);
}

fn sample_shadow_cascade(cascadeIndex: u32, worldPos: vec3<f32>, compareDepth: f32) -> f32 {
    let shadowClip = uniforms.shadowMatrices[cascadeIndex] * vec4<f32>(worldPos, 1.0);
    let projPos = shadowClip.xyz / shadowClip.w;
    let shadowCoord = projPos.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);

    if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0) {
        return 1.0;
    }
    if (compareDepth < 0.0 || compareDepth > 1.0) {
        return 1.0;
    }

    let shadowSize = i32(uniforms.shadowInfo.y + 0.5);
    let texelPos = shadowCoord * vec2<f32>(f32(shadowSize - 1), f32(shadowSize - 1));
    let baseCoord = vec2<i32>(floor(texelPos));
    var litCount = 0.0;

    for (var oy: i32 = 0; oy < 2; oy = oy + 1) {
      for (var ox: i32 = 0; ox < 2; ox = ox + 1) {
        let sampleCoord = vec2<i32>(
          clamp(baseCoord.x + ox, 0, shadowSize - 1),
          clamp(baseCoord.y + oy, 0, shadowSize - 1),
        );
        let shadowDepth = textureLoad(shadowData, sampleCoord, i32(cascadeIndex), 0);
        if (compareDepth <= shadowDepth) {
          litCount = litCount + 1.0;
        }
      }
    }

    return litCount * 0.25;
}

fn sample_shadow_cascade_with_bias(cascadeIndex: u32, worldPos: vec3<f32>, normal: vec3<f32>, lightDir: vec3<f32>) -> f32 {
    let bias = uniforms.shadowParams.z * max(1.0 - dot(normal, lightDir), 0.25);
    let shadowClip = uniforms.shadowMatrices[cascadeIndex] * vec4<f32>(worldPos, 1.0);
    let compareDepth = shadowClip.z / shadowClip.w - bias;
    return sample_shadow_cascade(cascadeIndex, worldPos, compareDepth);
}

fn calculate_shadow_csm(worldPos: vec3<f32>, viewPos: vec3<f32>, normal: vec3<f32>, lightDir: vec3<f32>) -> f32 {
    let viewDepth = max(-viewPos.z, 0.0);
    let cascadeCount = u32(uniforms.shadowInfo.x + 0.5);
    let cascadeIndex = select_shadow_cascade(viewDepth);
    let shadow = sample_shadow_cascade_with_bias(cascadeIndex, worldPos, normal, lightDir);
    var blendedShadow = shadow;
    if (cascadeIndex + 1u < cascadeCount) {
        let splitDistance = uniforms.shadowSplits[cascadeIndex];
        let transitionWidth = shadow_cascade_transition_width(splitDistance);
        let transitionStart = max(0.0, splitDistance - transitionWidth);
        let blendWeight = smoothstep(transitionStart, splitDistance, viewDepth);
        if (blendWeight > 0.0) {
            let nextShadow = sample_shadow_cascade_with_bias(cascadeIndex + 1u, worldPos, normal, lightDir);
            blendedShadow = mix(shadow, nextShadow, blendWeight);
        }
    }
    let shadowStrength = uniforms.shadowParams.w;
    return mix(1.0, blendedShadow, shadowStrength);
}

fn encode_view_normal(normal: vec3<f32>) -> vec4<f32> {
  return vec4<f32>(normal * 0.5 + vec3<f32>(0.5), 1.0);
}

fn clamp_texture_coord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
  return vec2<i32>(
    clamp(coord.x, 0, i32(size.x) - 1),
    clamp(coord.y, 0, i32(size.y) - 1),
  );
}

fn encode_contact_shadow_depth(viewDepth: f32) -> f32 {
  let nearPlane = max(0.0001, contactShadowUniforms.nearPlane);
  let farPlane = max(nearPlane + 0.0001, contactShadowUniforms.farPlane);
  return clamp((max(0.0001, viewDepth) - nearPlane) / (farPlane - nearPlane), 0.0, 1.0);
}

fn decode_contact_shadow_depth(encodedDepth: f32) -> f32 {
  let nearPlane = max(0.0001, contactShadowUniforms.nearPlane);
  let farPlane = max(nearPlane + 0.0001, contactShadowUniforms.farPlane);
  return mix(nearPlane, farPlane, clamp(encodedDepth, 0.0, 1.0));
}

fn sample_prepass_depth(coord: vec2<i32>, size: vec2<u32>) -> f32 {
  let encodedDepth = textureLoad(prepassDepthData, clamp_texture_coord(coord, size), 0).r;
  return decode_contact_shadow_depth(encodedDepth);
}

fn sample_prepass_normal(coord: vec2<i32>, size: vec2<u32>) -> vec3<f32> {
  let encoded = textureLoad(prepassNormalData, clamp_texture_coord(coord, size), 0).xyz;
  return normalize(encoded * 2.0 - vec3<f32>(1.0, 1.0, 1.0));
}

fn reconstruct_contact_shadow_view_position(uv: vec2<f32>, depth: f32) -> vec3<f32> {
  let viewDepth = max(0.0001, depth);
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let tanHalfFovY = max(0.0001, contactShadowUniforms.tanHalfFovY);
  let aspect = max(0.0001, contactShadowUniforms.aspect);
  return vec3<f32>(
    ndc.x * viewDepth * tanHalfFovY * aspect,
    ndc.y * viewDepth * tanHalfFovY,
    -viewDepth,
  );
}

fn project_contact_shadow_view_position(viewPosition: vec3<f32>) -> vec2<f32> {
  let depth = max(0.0001, -viewPosition.z);
  let tanHalfFovY = max(0.0001, contactShadowUniforms.tanHalfFovY);
  let aspect = max(0.0001, contactShadowUniforms.aspect);
  let ndc = vec2<f32>(
    viewPosition.x / (depth * tanHalfFovY * aspect),
    viewPosition.y / (depth * tanHalfFovY),
  );
  return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn calculate_contact_shadow(coord: vec2<i32>, size: vec2<u32>) -> f32 {
  let clamped = clamp_texture_coord(coord, size);
  let uv = (vec2<f32>(clamped) + vec2<f32>(0.5, 0.5)) / vec2<f32>(size);
  let depth = sample_prepass_depth(clamped, size);
  let viewPosition = reconstruct_contact_shadow_view_position(uv, depth);
  let lightDirection = -normalize(vec3<f32>(
    contactShadowUniforms.lightDirectionX,
    contactShadowUniforms.lightDirectionY,
    contactShadowUniforms.lightDirectionZ,
  ));
  let stepCount = max(1u, u32(round(contactShadowUniforms.stepCount)));
  let stepLength = max(0.0001, contactShadowUniforms.length) / f32(stepCount);
  let maxIntensity = clamp(contactShadowUniforms.intensity, 0.0, 2.0);
  let thickness = max(0.0, contactShadowUniforms.thickness);
  let normal = sample_prepass_normal(clamped, size);
  let facing = clamp(dot(normal, -lightDirection), 0.0, 1.0);
  let normalWeight = smoothstep(0.05, 0.45, facing);

  var shadow = 1.0;
  for (var index: u32 = 1u; index <= stepCount; index = index + 1u) {
    let samplePosition = viewPosition + lightDirection * (f32(index) * stepLength);
    if (samplePosition.z >= -0.0001) {
      break;
    }

    let sampleUv = project_contact_shadow_view_position(samplePosition);
    if (any(sampleUv < vec2<f32>(0.0)) || any(sampleUv > vec2<f32>(1.0))) {
      break;
    }

    let sampleCoord = clamp_texture_coord(vec2<i32>(i32(sampleUv.x * f32(size.x)), i32(sampleUv.y * f32(size.y))), size);
    let sampleDepth = sample_prepass_depth(sampleCoord, size);
    let rayDepth = max(0.0001, -samplePosition.z);
    if (sampleDepth + thickness < rayDepth) {
      let fade = 1.0 - (f32(index) / f32(stepCount));
      shadow = max(0.0, 1.0 - maxIntensity * fade);
      break;
    }
  }

  return mix(1.0, shadow, normalWeight);
}

fn sample_contact_shadow_for_visible_fragment(position: vec4<f32>, viewPos: vec3<f32>) -> f32 {
  let size = textureDimensions(contactShadowMaskData);
  let coord = clamp_texture_coord(vec2<i32>(i32(position.x), i32(position.y)), size);
  let shadowMask = textureLoad(contactShadowMaskData, coord, 0);
  if (shadowMask.a < 0.5) {
    return 1.0;
  }
  let frontDepth = sample_prepass_depth(coord, size);
  let currentDepth = max(0.0001, -viewPos.z);
  let depthEpsilon = max(
    max(0.01, max(0.0, contactShadowUniforms.thickness) * 2.0),
    currentDepth * 0.002,
  );
  if (abs(frontDepth - currentDepth) > depthEpsilon) {
    return 1.0;
  }
  return shadowMask.r;
}

fn sample_ambient_occlusion_for_visible_fragment(position: vec4<f32>, viewPos: vec3<f32>) -> f32 {
  let size = textureDimensions(ambientOcclusionMaskData);
  let coord = clamp_texture_coord(vec2<i32>(i32(position.x), i32(position.y)), size);
  let ambientOcclusionMask = textureLoad(ambientOcclusionMaskData, coord, 0);
  if (ambientOcclusionMask.a < 0.5) {
    return 1.0;
  }
  let frontDepth = sample_prepass_depth(coord, size);
  let currentDepth = max(0.0001, -viewPos.z);
  let depthEpsilon = max(
    max(0.01, max(0.0001, ambientOcclusionUniforms.bias) * 8.0),
    currentDepth * 0.002,
  );
  if (abs(frontDepth - currentDepth) > depthEpsilon) {
    return 1.0;
  }
  return ambientOcclusionMask.r;
}

fn should_discard_depth_prepass(alpha: f32) -> bool {
  if (material_alpha_cutout() > 0.5) {
    return alpha < ALPHA_CUTOUT_THRESHOLD;
  }
  return alpha < 0.5;
}

@fragment
fn fs_depth_prepass(in: VertexOutput) -> DepthPrepassOutput {
  let alpha = sample_material_alpha(in.uv);
  if (should_discard_depth_prepass(alpha)) {
    discard;
  }
  var out: DepthPrepassOutput;
  out.normal = encode_view_normal(normalize(in.viewNormal));
  out.depth = vec4<f32>(encode_contact_shadow_depth(-in.viewPos.z), 0.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> MainFragmentOutput {
  let dynamicRange = uniforms.shadowPowerParams.y;
  /* CUSTOM_SHADER_BODY */
}

@vertex
fn vs_shadow(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) boneIndices: vec4<f32>,
  @location(4) boneWeights: vec4<f32>,
  @location(5) morphPosition: vec3<f32>,
  @location(6) weightType: f32,
  @location(7) sdefC: vec3<f32>,
  @location(8) sdefR0: vec3<f32>,
  @location(9) sdefR1: vec3<f32>,
) -> ShadowVertexOutput {
  var out: ShadowVertexOutput;
  let basePos = position + morphPosition;
  var skinnedPos = vec3<f32>(0.0);

  if (weightType < 0.5) { // BDEF1
    let m = boneMatrices[u32(boneIndices.x + 0.5)];
    skinnedPos = (m * vec4<f32>(basePos, 1.0)).xyz;
  } else if (weightType < 1.5) { // BDEF2
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x + 
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y;
  } else if (weightType < 2.5) { // BDEF4
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    let m3 = boneMatrices[u32(boneIndices.z + 0.5)];
    let m4 = boneMatrices[u32(boneIndices.w + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x +
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y +
                 (m3 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.z +
                 (m4 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.w;
  } else if (weightType < 3.5) {
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    let res = sdef_skinning(basePos, normal, m1, m2, boneWeights.x, sdefC, sdefR0, sdefR1);
    skinnedPos = res.pos;
  } else {
    let m1 = boneMatrices[u32(boneIndices.x + 0.5)];
    let m2 = boneMatrices[u32(boneIndices.y + 0.5)];
    let m3 = boneMatrices[u32(boneIndices.z + 0.5)];
    let m4 = boneMatrices[u32(boneIndices.w + 0.5)];
    skinnedPos = (m1 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.x +
                 (m2 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.y +
                 (m3 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.z +
                 (m4 * vec4<f32>(basePos, 1.0)).xyz * boneWeights.w;
  }

  let cascadeIndex = u32(uniforms.shadowInfo.w + 0.5);
  out.position = uniforms.shadowMatrices[cascadeIndex] * vec4<f32>(skinnedPos, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fs_shadow(in: ShadowVertexOutput) -> @location(0) vec4<f32> {
    if (material_alpha_cutout() > 0.5) {
        let alpha = sample_material_alpha(in.uv);
        if (alpha < ALPHA_CUTOUT_THRESHOLD) {
            discard;
        }
    }
    let d = in.position.z;
    return vec4<f32>(d, d * d, d * d * d, d * d * d * d);
}

@fragment
fn fs_pick_world(in: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = sample_material_alpha(in.uv);
  // ピッカーは半透明を完全除外せず、alpha 閾値で前面ヒットを選びます。
  if (alpha < ALPHA_CUTOUT_THRESHOLD) {
    discard;
  }
  return vec4<f32>(in.worldPos, 1.0);
}

struct ShadowDebugVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) layer: u32,
};

struct BloomDebugVertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_shadow_debug(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> ShadowDebugVertexOutput {
  var out: ShadowDebugVertexOutput;
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
  );
  let tileSize = vec2<f32>(0.2, 0.2);
  let margin = vec2<f32>(0.02, 0.02);
  let grid = vec2<f32>(f32(instanceIndex % 2u), f32(instanceIndex / 2u));
  let topLeft = vec2<f32>(
    1.0 - margin.x - tileSize.x * (2.0 - grid.x),
    1.0 - margin.y - tileSize.y * (grid.y + 1.0),
  );
  let uv = quad[vertexIndex];
  let clip = vec2<f32>(
    topLeft.x + uv.x * tileSize.x,
    topLeft.y + uv.y * tileSize.y,
  );
  out.position = vec4<f32>(clip * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
  out.uv = uv;
  out.layer = instanceIndex;
  return out;
}

@fragment
fn fs_shadow_debug(in: ShadowDebugVertexOutput) -> @location(0) vec4<f32> {
  let shadowSize = i32(uniforms.shadowInfo.y + 0.5);
  let texel = vec2<i32>(
    clamp(i32(in.uv.x * f32(shadowSize - 1)), 0, shadowSize - 1),
    clamp(i32((1.0 - in.uv.y) * f32(shadowSize - 1)), 0, shadowSize - 1),
  );
  let depth = textureLoad(shadowData, texel, i32(in.layer), 0);
  let shade = vec3<f32>(depth);
  let border = select(0.0, 1.0, in.uv.x < 0.01 || in.uv.x > 0.99 || in.uv.y < 0.01 || in.uv.y > 0.99);
  let color = mix(shade, vec3<f32>(1.0, 0.2, 0.2), border);
  return vec4<f32>(color, 0.95);
}

@vertex
fn vs_bloom_shadow_debug(
  @builtin(vertex_index) vertexIndex: u32,
) -> BloomDebugVertexOutput {
  var out: BloomDebugVertexOutput;
  let quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
  );
  let tileSize = vec2<f32>(0.96, 0.96);
  let margin = vec2<f32>(0.02, 0.02);
  let uv = quad[vertexIndex];
  let topLeft = vec2<f32>(
    1.0 - margin.x - tileSize.x,
    margin.y,
  );
  let clip = vec2<f32>(
    topLeft.x + uv.x * tileSize.x,
    topLeft.y + uv.y * tileSize.y,
  );
  out.position = vec4<f32>(clip * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
  return out;
}

@fragment
fn fs_bloom_shadow_debug() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 0.95);
}

struct BoneVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

struct GridVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@group(1) @binding(0) var t_grid_depth_msaa: texture_depth_multisampled_2d;
@group(3) @binding(0) var t_grid_depth_single: texture_depth_2d;

@vertex
fn vs_bone(
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) other: vec3<f32>,
  @location(3) side: f32,
) -> BoneVertexOutput {
  var out: BoneVertexOutput;
  let p1 = uniforms.mvp * vec4<f32>(position, 1.0);
  let p2 = uniforms.mvp * vec4<f32>(other, 1.0);

  let p1_ndc = p1.xy / p1.w;
  let p2_ndc = p2.xy / p2.w;

  let res = uniforms.resolution.xy;
  let aspect = res.x / res.y;
  let dir = normalize((p2_ndc - p1_ndc) * vec2<f32>(aspect, 1.0));
  let normal = vec2<f32>(-dir.y / aspect, dir.x);

  let thickness = uniforms.shadowInfo.z;
  let offset = normal * (thickness / res.y);

  out.position = vec4<f32>(p1.xy + offset * side * p1.w, p1.zw);
  out.color = color;
  return out;
}

@vertex
fn vs_grid(
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) other: vec3<f32>,
  @location(3) side: f32,
) -> GridVertexOutput {
  var out: GridVertexOutput;
  let p1Clip = uniforms.mvp * vec4<f32>(position, 1.0);
  let p2Clip = uniforms.mvp * vec4<f32>(other, 1.0);

  let p1Ndc = p1Clip.xy / p1Clip.w;
  let p2Ndc = p2Clip.xy / p2Clip.w;

  let res = uniforms.resolution.xy;
  let aspect = res.x / res.y;
  let dir = normalize((p2Ndc - p1Ndc) * vec2<f32>(aspect, 1.0));
  let normal = vec2<f32>(-dir.y / aspect, dir.x);
  let thickness = max(0.0, uniforms.shadowPowerParams.z);
  let offset = normal * (thickness / res.y);

  out.position = vec4<f32>(p1Clip.xy + offset * side * p1Clip.w, p1Clip.zw);
  out.color = color;
  return out;
}

@fragment
fn fs_bone(in: BoneVertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}

@fragment
fn fs_bone_mrt(in: BoneVertexOutput) -> MainFragmentOutput {
  var out: MainFragmentOutput;
  out.color = vec4<f32>(in.color, 1.0);
  out.normal = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  out.mask = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  return out;
}

fn load_grid_depth_msaa(coord: vec2<i32>) -> f32 {
  let size = vec2<i32>(textureDimensions(t_grid_depth_msaa));
  let clamped = vec2<i32>(
    clamp(coord.x, 0, size.x - 1),
    clamp(coord.y, 0, size.y - 1),
  );
  let sampleCount = textureNumSamples(t_grid_depth_msaa);
  var depth = 1.0;
  for (var index: u32 = 0u; index < sampleCount; index = index + 1u) {
    depth = min(depth, textureLoad(t_grid_depth_msaa, clamped, index));
  }
  return depth;
}

@fragment
fn fs_grid_post(in: GridVertexOutput) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let gridDepth = in.position.z;
  let sceneDepth = load_grid_depth_msaa(coord);
  if (gridDepth > sceneDepth + 0.00001) {
    discard;
  }
  return vec4<f32>(in.color, 1.0);
}

fn load_grid_depth_single(coord: vec2<i32>) -> f32 {
  let size = vec2<i32>(textureDimensions(t_grid_depth_single));
  let clamped = vec2<i32>(
    clamp(coord.x, 0, size.x - 1),
    clamp(coord.y, 0, size.y - 1),
  );
  return textureLoad(t_grid_depth_single, clamped, 0);
}

@fragment
fn fs_grid_post_single(in: GridVertexOutput) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let gridDepth = in.position.z;
  let sceneDepth = load_grid_depth_single(coord);
  if (gridDepth > sceneDepth + 0.00001) {
    discard;
  }
  return vec4<f32>(in.color, 1.0);
}





/*
 * SDEF 用ヘルパー関数
 */
fn mat3_from_mat4(m: mat4x4<f32>) -> mat3x3<f32> {
  return mat3x3<f32>(
    m[0].xyz,
    m[1].xyz,
    m[2].xyz
  );
}

// 回転行列 → クォータニオン (列優先行列に対応)
fn quat_from_mat3(m: mat3x3<f32>) -> vec4<f32> {
  let m00 = m[0][0]; let m11 = m[1][1]; let m22 = m[2][2];
  let m01 = m[0][1]; let m10 = m[1][0];
  let m02 = m[0][2]; let m20 = m[2][0];
  let m12 = m[1][2]; let m21 = m[2][1];

  let trace = m00 + m11 + m22;
  var q: vec4<f32>;

  if (trace > 0.0) {
    let s = sqrt(trace + 1.0) * 2.0;
    q.w = 0.25 * s;
    q.x = (m12 - m21) / s;
    q.y = (m20 - m02) / s;
    q.z = (m01 - m10) / s;
  } else if (m00 > m11 && m00 > m22) {
    let s = sqrt(1.0 + m00 - m11 - m22) * 2.0;
    q.w = (m12 - m21) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    let s = sqrt(1.0 + m11 - m00 - m22) * 2.0;
    q.w = (m20 - m02) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    let s = sqrt(1.0 + m22 - m00 - m11) * 2.0;
    q.w = (m01 - m10) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }

  return normalize(q);
}

// クォータニオン回転
fn quat_rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn sdef_skinning(
  basePos: vec3<f32>,
  normal: vec3<f32>,
  m0: mat4x4<f32>,
  m1: mat4x4<f32>,
  w0: f32,
  C: vec3<f32>,
  R0: vec3<f32>,
  R1: vec3<f32>
) -> SdefResult {
  let w1 = 1.0 - w0;

  // 回転のブレンド（クォータニオン）
  let q0 = quat_from_mat3(mat3_from_mat4(m0));
  let q1 = quat_from_mat3(mat3_from_mat4(m1));
  let q1_fixed = select(q1, -q1, dot(q0, q1) < 0.0);
  let q = normalize(q0 * w0 + q1_fixed * w1);

  // SDEF 補正項の計算
  // p' = w0 * M0 * C0 + w1 * M1 * C1 + Rot(p - C)
  // C0 = C + 0.5 * w1 * (R0 - R1)
  // C1 = C - 0.5 * w0 * (R0 - R1)
  let r_diff = R0 - R1;
  let c0 = C + 0.5 * w1 * r_diff;
  let c1 = C - 0.5 * w0 * r_diff;

  let pos0 = (m0 * vec4<f32>(c0, 1.0)).xyz;
  let pos1 = (m1 * vec4<f32>(c1, 1.0)).xyz;
  
  let finalPos = w0 * pos0 + w1 * pos1 + quat_rotate(q, basePos - C);
  let finalNormal = normalize(quat_rotate(q, normal));

  return SdefResult(finalPos, finalNormal);
}
