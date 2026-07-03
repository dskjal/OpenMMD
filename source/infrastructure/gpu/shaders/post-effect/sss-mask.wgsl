struct SssUniforms {
    radius: f32,
    depthThreshold: f32,
    normalThreshold: f32,
    strength: f32,
    direction: f32,
    nearPlane: f32,
    farPlane: f32,
    padding2: f32,
};

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> sssMaskUniforms: SssUniforms;
@group(0) @binding(1) var t_mask_single: texture_2d<f32>;
@group(0) @binding(2) var t_depth_single: texture_depth_2d;

@group(1) @binding(0) var<uniform> sssMaskResolveUniforms: SssUniforms;
@group(1) @binding(1) var t_mask_msaa: texture_multisampled_2d<f32>;
@group(1) @binding(2) var t_depth_msaa: texture_depth_multisampled_2d;

fn depth_epsilon(threshold: f32) -> f32 {
    return max(0.00002, threshold * 0.5);
}

fn decode_device_depth(encodedDepth: f32, nearPlane: f32, farPlane: f32) -> f32 {
    let safeNear = max(0.0001, nearPlane);
    let safeFar = max(safeNear + 0.0001, farPlane);
    let clampedDepth = clamp(encodedDepth, 0.0, 1.0);
    return (safeNear * safeFar) / max(0.0001, safeFar - clampedDepth * (safeFar - safeNear));
}

fn encode_mask_view_depth(viewDepth: f32, nearPlane: f32, farPlane: f32) -> f32 {
    let safeNear = max(0.0001, nearPlane);
    let safeFar = max(safeNear + 0.0001, farPlane);
    return clamp((max(0.0001, viewDepth) - safeNear) / (safeFar - safeNear), 0.0, 1.0);
}

fn keep_single_sample(maskSample: vec4<f32>, encodedSceneDepth: f32, threshold: f32) -> vec4<f32> {
    if (maskSample.a < 0.5) {
        return vec4<f32>(0.0);
    }
    let matchesDepth = abs(maskSample.g - encodedSceneDepth) <= depth_epsilon(threshold);
    return select(vec4<f32>(0.0), maskSample, matchesDepth);
}

fn resolve_visible_mask_msaa(coord: vec2<i32>) -> vec4<f32> {
    let sampleCount = textureNumSamples(t_depth_msaa);
    let nearPlane = sssMaskResolveUniforms.nearPlane;
    let farPlane = sssMaskResolveUniforms.farPlane;
    var minDepth = max(nearPlane, farPlane);
    for (var sampleIndex: u32 = 0u; sampleIndex < sampleCount; sampleIndex = sampleIndex + 1u) {
        let sceneDepth = decode_device_depth(textureLoad(t_depth_msaa, coord, sampleIndex), nearPlane, farPlane);
        minDepth = min(minDepth, sceneDepth);
    }

    let epsilon = depth_epsilon(sssMaskResolveUniforms.depthThreshold);
    let encodedMinDepth = encode_mask_view_depth(minDepth, nearPlane, farPlane);
    for (var sampleIndex: u32 = 0u; sampleIndex < sampleCount; sampleIndex = sampleIndex + 1u) {
        let maskSample = textureLoad(t_mask_msaa, coord, sampleIndex);
        if (maskSample.a < 0.5) {
            continue;
        }
        let sceneDepth = decode_device_depth(textureLoad(t_depth_msaa, coord, sampleIndex), nearPlane, farPlane);
        let encodedSceneDepth = encode_mask_view_depth(sceneDepth, nearPlane, farPlane);
        let matchesSampleDepth = abs(maskSample.g - encodedSceneDepth) <= epsilon;
        let isFrontmost = maskSample.g <= encodedMinDepth + epsilon;
        if (!matchesSampleDepth || !isFrontmost) {
            continue;
        }
        return maskSample;
    }

    return vec4<f32>(0.0);
}

@fragment
fn fs_sss_mask_filter(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_mask_single));
    let coord = vec2<i32>(clamp(vec2<i32>(i32(pos.x), i32(pos.y)), vec2<i32>(0, 0), vec2<i32>(i32(size.x) - 1, i32(size.y) - 1)));
    let maskSample = textureLoad(t_mask_single, coord, 0);
    let sceneDepth = decode_device_depth(textureLoad(t_depth_single, coord, 0), sssMaskUniforms.nearPlane, sssMaskUniforms.farPlane);
    let encodedSceneDepth = encode_mask_view_depth(sceneDepth, sssMaskUniforms.nearPlane, sssMaskUniforms.farPlane);
    let filteredMask = keep_single_sample(maskSample, encodedSceneDepth, sssMaskUniforms.depthThreshold);
    return filteredMask;
}

@fragment
fn fs_sss_mask_resolve(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_mask_msaa));
    let coord = vec2<i32>(clamp(vec2<i32>(i32(pos.x), i32(pos.y)), vec2<i32>(0, 0), vec2<i32>(i32(size.x) - 1, i32(size.y) - 1)));
    let resolvedMask = resolve_visible_mask_msaa(coord);
    return resolvedMask;
}
