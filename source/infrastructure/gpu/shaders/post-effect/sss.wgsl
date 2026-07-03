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

@group(0) @binding(0) var<uniform> sssUniforms: SssUniforms;
@group(0) @binding(1) var t_scene: texture_2d<f32>;
@group(0) @binding(2) var t_depth: texture_depth_2d;
@group(0) @binding(3) var t_normal: texture_2d<f32>;
@group(0) @binding(4) var t_mask: texture_2d<f32>;

@group(1) @binding(0) var<uniform> sssCompositeUniforms: SssUniforms;
@group(1) @binding(1) var t_composite_scene: texture_2d<f32>;
@group(1) @binding(2) var t_blur: texture_2d<f32>;
@group(1) @binding(3) var t_composite_mask: texture_2d<f32>;

@group(2) @binding(0) var<uniform> sssMsaaUniforms: SssUniforms;
@group(2) @binding(1) var t_scene_msaa: texture_2d<f32>;
@group(2) @binding(2) var t_depth_msaa: texture_depth_multisampled_2d;
@group(2) @binding(3) var t_normal_msaa: texture_2d<f32>;
@group(2) @binding(4) var t_mask_msaa: texture_2d<f32>;

const KERNEL_RADIUS: i32 = 4;
const KERNEL_WEIGHTS: array<f32, 9> = array<f32, 9>(
    0.05, 0.09, 0.12, 0.15, 0.18, 0.15, 0.12, 0.09, 0.05,
);

fn clamp_coord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(size.x) - 1),
        clamp(coord.y, 0, i32(size.y) - 1),
    );
}

fn load_normal(encoded: vec4<f32>) -> vec3<f32> {
    return normalize(encoded.xyz * 2.0 - vec3<f32>(1.0, 1.0, 1.0));
}

fn depth_weight(centerDepth: f32, sampleDepth: f32, threshold: f32) -> f32 {
    let safeThreshold = max(0.0001, threshold);
    return 1.0 - smoothstep(0.0, safeThreshold, abs(sampleDepth - centerDepth));
}

fn decode_view_depth(encodedDepth: f32, nearPlane: f32, farPlane: f32) -> f32 {
    let safeNear = max(0.0001, nearPlane);
    let safeFar = max(safeNear + 0.0001, farPlane);
    let clampedDepth = clamp(encodedDepth, 0.0, 1.0);
    return (safeNear * safeFar) / max(0.0001, safeFar - clampedDepth * (safeFar - safeNear));
}

fn normal_weight(centerNormal: vec3<f32>, sampleNormal: vec3<f32>, threshold: f32) -> f32 {
    let safeThreshold = clamp(threshold, 0.0, 1.0);
    let similarity = clamp(dot(centerNormal, sampleNormal), 0.0, 1.0);
    return smoothstep(1.0 - safeThreshold, 1.0, similarity);
}

fn direction_vector(direction: f32) -> vec2<i32> {
    let isHorizontal = direction < 0.5;
    return select(vec2<i32>(0, 1), vec2<i32>(1, 0), isHorizontal);
}

fn blur_pixel(
    coord: vec2<i32>,
    size: vec2<u32>,
    direction: f32,
    radiusPixels: f32,
    centerDepth: f32,
    centerNormal: vec3<f32>,
) -> vec4<f32> {
    let mask = textureLoad(t_mask, coord, 0).r;
    let centerColor = textureLoad(t_scene, coord, 0).rgb;
    if (mask <= 0.0) {
        return vec4<f32>(centerColor, 0.0);
    }

    let axis = direction_vector(direction);
    let radius = max(0.0, radiusPixels);
    var accumulatedColor = vec3<f32>(0.0);
    var accumulatedWeight = 0.0;

    for (var index: i32 = -KERNEL_RADIUS; index <= KERNEL_RADIUS; index = index + 1) {
        let kernelIndex = u32(index + KERNEL_RADIUS);
        let offset = vec2<i32>(
            axis.x * i32(round(f32(index) * radius)),
            axis.y * i32(round(f32(index) * radius)),
        );
        let sampleCoord = clamp_coord(coord + offset, size);
        let sampleMask = textureLoad(t_mask, sampleCoord, 0).r;
        if (sampleMask <= 0.0) {
            continue;
        }

        let sampleColor = textureLoad(t_scene, sampleCoord, 0).rgb;
        let sampleDepth = decode_view_depth(textureLoad(t_depth, sampleCoord, 0), sssUniforms.nearPlane, sssUniforms.farPlane);
        let sampleNormal = load_normal(textureLoad(t_normal, sampleCoord, 0));
        let weight = KERNEL_WEIGHTS[kernelIndex]
            * depth_weight(centerDepth, sampleDepth, sssUniforms.depthThreshold)
            * normal_weight(centerNormal, sampleNormal, sssUniforms.normalThreshold)
            * sampleMask;
        accumulatedColor += sampleColor * weight;
        accumulatedWeight += weight;
    }

    let fallback = vec4<f32>(centerColor, mask);
    return select(
        fallback,
        vec4<f32>(accumulatedColor / accumulatedWeight, mask),
        accumulatedWeight > 0.0001,
    );
}

fn blur_pixel_msaa(
    coord: vec2<i32>,
    size: vec2<u32>,
    direction: f32,
    radiusPixels: f32,
    centerDepth: f32,
    centerNormal: vec3<f32>,
) -> vec4<f32> {
    let mask = textureLoad(t_mask_msaa, coord, 0).r;
    let centerColor = textureLoad(t_scene_msaa, coord, 0).rgb;
    if (mask <= 0.0) {
        return vec4<f32>(centerColor, 0.0);
    }

    let axis = direction_vector(direction);
    let radius = max(0.0, radiusPixels);
    var accumulatedColor = vec3<f32>(0.0);
    var accumulatedWeight = 0.0;
    let sampleCount = textureNumSamples(t_depth_msaa);

    for (var index: i32 = -KERNEL_RADIUS; index <= KERNEL_RADIUS; index = index + 1) {
        let kernelIndex = u32(index + KERNEL_RADIUS);
        let offset = vec2<i32>(
            axis.x * i32(round(f32(index) * radius)),
            axis.y * i32(round(f32(index) * radius)),
        );
        let sampleCoord = clamp_coord(coord + offset, size);
        let sampleMask = textureLoad(t_mask_msaa, sampleCoord, 0).r;
        if (sampleMask <= 0.0) {
            continue;
        }

        var sampleDepth = 0.0;
        for (var sampleIndex: u32 = 0u; sampleIndex < sampleCount; sampleIndex = sampleIndex + 1u) {
            sampleDepth += decode_view_depth(
                textureLoad(t_depth_msaa, sampleCoord, sampleIndex),
                sssMsaaUniforms.nearPlane,
                sssMsaaUniforms.farPlane,
            );
        }
        sampleDepth = sampleDepth / max(1.0, f32(sampleCount));

        let sampleColor = textureLoad(t_scene_msaa, sampleCoord, 0).rgb;
        let sampleNormal = load_normal(textureLoad(t_normal_msaa, sampleCoord, 0));
        let weight = KERNEL_WEIGHTS[kernelIndex]
            * depth_weight(centerDepth, sampleDepth, sssMsaaUniforms.depthThreshold)
            * normal_weight(centerNormal, sampleNormal, sssMsaaUniforms.normalThreshold)
            * sampleMask;
        accumulatedColor += sampleColor * weight;
        accumulatedWeight += weight;
    }

    let fallback = vec4<f32>(centerColor, mask);
    return select(
        fallback,
        vec4<f32>(accumulatedColor / accumulatedWeight, mask),
        accumulatedWeight > 0.0001,
    );
}

@fragment
fn fs_sss_blur(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_scene));
    let coord = vec2<i32>(clamp(vec2<i32>(i32(pos.x), i32(pos.y)), vec2<i32>(0, 0), vec2<i32>(i32(size.x) - 1, i32(size.y) - 1)));
    let centerDepth = decode_view_depth(textureLoad(t_depth, coord, 0), sssUniforms.nearPlane, sssUniforms.farPlane);
    let centerNormal = load_normal(textureLoad(t_normal, coord, 0));
    return blur_pixel(coord, size, sssUniforms.direction, sssUniforms.radius, centerDepth, centerNormal);
}

@fragment
fn fs_sss_blur_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_scene_msaa));
    let coord = vec2<i32>(clamp(vec2<i32>(i32(pos.x), i32(pos.y)), vec2<i32>(0, 0), vec2<i32>(i32(size.x) - 1, i32(size.y) - 1)));
    var centerDepth = 0.0;
    let sampleCount = textureNumSamples(t_depth_msaa);
    for (var sampleIndex: u32 = 0u; sampleIndex < sampleCount; sampleIndex = sampleIndex + 1u) {
        centerDepth += decode_view_depth(textureLoad(t_depth_msaa, coord, sampleIndex), sssMsaaUniforms.nearPlane, sssMsaaUniforms.farPlane);
    }
    centerDepth = centerDepth / max(1.0, f32(sampleCount));
    let centerNormal = load_normal(textureLoad(t_normal_msaa, coord, 0));
    return blur_pixel_msaa(coord, size, sssMsaaUniforms.direction, sssMsaaUniforms.radius, centerDepth, centerNormal);
}

@fragment
fn fs_sss_composite(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_composite_scene));
    let coord = vec2<i32>(clamp(vec2<i32>(i32(pos.x), i32(pos.y)), vec2<i32>(0, 0), vec2<i32>(i32(size.x) - 1, i32(size.y) - 1)));
    let sceneColor = textureLoad(t_composite_scene, coord, 0);
    let blurred = textureLoad(t_blur, coord, 0);
    let mask = textureLoad(t_composite_mask, coord, 0).r;
    let strength = clamp(sssCompositeUniforms.strength * mask, 0.0, 1.0);
    return vec4<f32>(mix(sceneColor.rgb, blurred.rgb, strength), sceneColor.a);
}
