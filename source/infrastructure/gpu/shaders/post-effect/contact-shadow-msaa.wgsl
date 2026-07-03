@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

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

@group(0) @binding(0) var<uniform> contactShadowUniforms: ContactShadowUniforms;
@group(0) @binding(1) var t_scene: texture_2d<f32>;
@group(0) @binding(2) var s_scene: sampler;
@group(0) @binding(3) var t_mask: texture_2d<f32>;
@group(0) @binding(4) var t_depth: texture_depth_multisampled_2d;
@group(0) @binding(5) var t_normal: texture_2d<f32>;

fn clamp_coord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(size.x) - 1),
        clamp(coord.y, 0, i32(size.y) - 1),
    );
}

fn linearize_depth(uniforms: ContactShadowUniforms, depth: f32) -> f32 {
    let nearPlane = max(0.0001, uniforms.nearPlane);
    let farPlane = max(nearPlane + 0.0001, uniforms.farPlane);
    return (nearPlane * farPlane) / max(farPlane - depth * (farPlane - nearPlane), 0.0001);
}

fn load_depth(coord: vec2<i32>) -> f32 {
    let size = vec2<u32>(textureDimensions(t_depth));
    let clamped = clamp_coord(coord, size);
    let sampleCount = textureNumSamples(t_depth);
    var depth = 0.0;
    for (var index: u32 = 0u; index < sampleCount; index = index + 1u) {
        depth += textureLoad(t_depth, clamped, index);
    }
    return linearize_depth(contactShadowUniforms, depth / max(1.0, f32(sampleCount)));
}

fn load_mask(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    return textureLoad(t_mask, clamp_coord(coord, size), 0).r;
}

fn reconstruct_view_position(uniforms: ContactShadowUniforms, uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let viewDepth = max(0.0001, depth);
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let tanHalfFovY = max(0.0001, uniforms.tanHalfFovY);
    let aspect = max(0.0001, uniforms.aspect);
    return vec3<f32>(
        ndc.x * viewDepth * tanHalfFovY * aspect,
        ndc.y * viewDepth * tanHalfFovY,
        -viewDepth,
    );
}

fn load_view_normal(coord: vec2<i32>, size: vec2<u32>) -> vec3<f32> {
    let encoded = textureLoad(t_normal, clamp_coord(coord, size), 0).xyz;
    return normalize(encoded * 2.0 - vec3<f32>(1.0, 1.0, 1.0));
}

fn blur_contact_shadow(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    let clamped = clamp_coord(coord, size);
    let blurAmount = max(0.0, contactShadowUniforms.blurAmount);
    if (blurAmount <= 0.0001) {
        return load_mask(clamped, size);
    }
    let centerDepth = load_depth(clamped);
    let centerNormal = load_view_normal(clamped, size);
    let offsets = array<vec2<i32>, 5>(
        vec2<i32>(0, 0),
        vec2<i32>(1, 0),
        vec2<i32>(-1, 0),
        vec2<i32>(0, 1),
        vec2<i32>(0, -1),
    );
    let weights = array<f32, 5>(4.0, 2.0, 2.0, 2.0, 2.0);

    var sum = 0.0;
    var weightSum = 0.0;
    for (var index: u32 = 0u; index < 5u; index = index + 1u) {
        let scaledOffset = vec2<i32>(
            i32(round(f32(offsets[index].x) * blurAmount)),
            i32(round(f32(offsets[index].y) * blurAmount)),
        );
        let sampleCoord = clamp_coord(clamped + scaledOffset, size);
        let sampleMask = load_mask(sampleCoord, size);
        let sampleDepth = load_depth(sampleCoord);
        let sampleNormal = load_view_normal(sampleCoord, size);
        let depthWeight = exp(-abs(sampleDepth - centerDepth) * (8.0 / max(blurAmount, 0.25)));
        let normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 4.0);
        let weight = weights[index] * depthWeight * normalWeight;
        sum += sampleMask * weight;
        weightSum += weight;
    }

    return select(sum / max(weightSum, 0.0001), load_mask(clamped, size), weightSum <= 0.0001);
}

@fragment
fn fs_contact_shadow_composite_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_scene));
    let uv = pos.xy / vec2<f32>(size);
    let coord = vec2<i32>(i32(pos.x), i32(pos.y));
    let sceneSample = textureSampleLevel(t_scene, s_scene, uv, 0.0);
    let shadow = blur_contact_shadow(coord, size);
    return vec4<f32>(sceneSample.rgb * shadow, sceneSample.a);
}
