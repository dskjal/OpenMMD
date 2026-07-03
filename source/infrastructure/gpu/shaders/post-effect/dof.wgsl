struct DofUniforms {
    focusDistance: f32,
    sceneScale: f32,
    focalLengthMm: f32,
    fStop: f32,
    blurAmount: f32,
    nearPlane: f32,
    farPlane: f32,
    sensorToPixelScale: f32,
    algorithm: f32,
    sampleCount: f32,
    maxBlurRadius: f32,
    cocBlendScale: f32,
    padding0: f32,
    padding1: f32,
    padding2: f32,
    padding3: f32,
};

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

const DOF_ALGORITHM_FAST = 0;
const DOF_ALGORITHM_DEPTH_AWARE_GATHER = 1;
const DOF_ALGORITHM_THIN_LENS_MULTISAMPLE = 2;
const PI = 3.141592653589793;
const GOLDEN_ANGLE = 2.399963229728653;
const MAX_DOF_SAMPLES = 32u;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

@group(0) @binding(0) var<uniform> dofUniforms: DofUniforms;
@group(0) @binding(1) var t_scene: texture_2d<f32>;
@group(0) @binding(2) var s_scene: sampler;
@group(0) @binding(3) var t_depth: texture_depth_2d;

fn get_algorithm(uniforms: DofUniforms) -> i32 {
    return i32(round(uniforms.algorithm));
}

fn linearize_depth(uniforms: DofUniforms, depth: f32) -> f32 {
    let nearPlane = max(0.0001, uniforms.nearPlane);
    let farPlane = max(nearPlane + 0.0001, uniforms.farPlane);
    return (nearPlane * farPlane) / max(farPlane - depth * (farPlane - nearPlane), 0.0001);
}

fn compute_coc(uniforms: DofUniforms, depth: f32) -> f32 {
    let sceneScale = max(0.0001, uniforms.sceneScale);
    let focusDistanceMeters = max(0.0001, uniforms.focusDistance / sceneScale);
    let subjectDistanceMeters = max(0.0001, depth / sceneScale);
    let focalLengthMeters = max(0.000001, uniforms.focalLengthMm / 1000.0);
    let fStop = max(0.1, uniforms.fStop);
    let denominator = max(
        0.000001,
        fStop * subjectDistanceMeters * max(focusDistanceMeters - focalLengthMeters, 0.000001),
    );
    let cocMeters = (focalLengthMeters * focalLengthMeters * abs(subjectDistanceMeters - focusDistanceMeters)) / denominator;
    return clamp(
        cocMeters * max(0.0, uniforms.sensorToPixelScale) * max(0.0, uniforms.blurAmount),
        0.0,
        max(0.0, uniforms.maxBlurRadius),
    );
}

fn compute_global_blur_radius(uniforms: DofUniforms) -> f32 {
    let fStop = max(0.1, uniforms.fStop);
    return clamp((uniforms.blurAmount * 16.0) / fStop, 0.0, uniforms.maxBlurRadius);
}

fn load_depth_texture(uniforms: DofUniforms, textureRef: texture_depth_2d, coord: vec2<i32>) -> f32 {
    return linearize_depth(uniforms, textureLoad(textureRef, coord, 0));
}

fn load_depth_msaa(uniforms: DofUniforms, textureRef: texture_depth_multisampled_2d, coord: vec2<i32>) -> f32 {
    let sampleCount = textureNumSamples(textureRef);
    var depth = 0.0;
    for (var index: u32 = 0u; index < sampleCount; index++) {
        depth += textureLoad(textureRef, coord, index);
    }
    return linearize_depth(uniforms, depth / max(1.0, f32(sampleCount)));
}

fn sample_scene_fast_blur(
    uv: vec2<f32>,
    size: vec2<f32>,
    radiusPixels: f32,
) -> vec4<f32> {
    let texel = vec2<f32>(1.0 / size.x, 1.0 / size.y);
    let radius = clamp(radiusPixels, 0.0, 64.0);
    if (radius <= 0.001) {
        return textureSampleLevel(t_scene, s_scene, uv, 0.0);
    }

    let offset = texel * radius;
    var color = vec3<f32>(0.0);
    var alpha = 0.0;
    var weight = 0.0;

    let centerSample = textureSampleLevel(t_scene, s_scene, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    color += centerSample.rgb * 4.0;
    alpha += centerSample.a * 4.0;
    weight += 4.0;

    let leftSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>(-1.0,  0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let rightSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 1.0,  0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let upSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.0, -1.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let downSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.0,  1.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    color += leftSample.rgb * 2.0;
    color += rightSample.rgb * 2.0;
    color += upSample.rgb * 2.0;
    color += downSample.rgb * 2.0;
    alpha += leftSample.a * 2.0;
    alpha += rightSample.a * 2.0;
    alpha += upSample.a * 2.0;
    alpha += downSample.a * 2.0;
    weight += 8.0;

    let upLeftSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>(-0.75, -0.75), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let upRightSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.75, -0.75), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let downLeftSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>(-0.75,  0.75), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let downRightSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.75,  0.75), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    color += upLeftSample.rgb;
    color += upRightSample.rgb;
    color += downLeftSample.rgb;
    color += downRightSample.rgb;
    alpha += upLeftSample.a;
    alpha += upRightSample.a;
    alpha += downLeftSample.a;
    alpha += downRightSample.a;
    weight += 4.0;

    let farLeftSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>(-2.0,  0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let farRightSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 2.0,  0.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let farUpSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.0, -2.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let farDownSample = textureSampleLevel(t_scene, s_scene, clamp(uv + offset * vec2<f32>( 0.0,  2.0), vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    color += farLeftSample.rgb;
    color += farRightSample.rgb;
    color += farUpSample.rgb;
    color += farDownSample.rgb;
    alpha += farLeftSample.a;
    alpha += farRightSample.a;
    alpha += farUpSample.a;
    alpha += farDownSample.a;
    weight += 4.0;

    return vec4<f32>(color / weight, alpha / weight);
}

fn hash12(seed: vec2<f32>) -> f32 {
    let h = dot(seed, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn vogel_disk_offset(index: u32, sampleCount: u32, rotation: f32) -> vec2<f32> {
    let i = f32(index) + 0.5;
    let count = max(1.0, f32(sampleCount));
    let radius = sqrt(i / count);
    let angle = GOLDEN_ANGLE * i + rotation;
    return vec2<f32>(cos(angle), sin(angle)) * radius;
}

fn aperture_hex_radius(direction: vec2<f32>) -> f32 {
    let angle = atan2(direction.y, direction.x);
    let sectorAngle = (fract(angle / (PI / 3.0)) * (PI / 3.0)) - (PI / 6.0);
    return clamp(cos(PI / 6.0) / max(0.2, cos(sectorAngle)), 0.6, 1.6);
}

fn compute_occlusion_weight(centerDepth: f32, sampleDepth: f32, centerCoc: f32, sampleCoc: f32) -> f32 {
    let depthDelta = sampleDepth - centerDepth;
    let foregroundPenalty = select(1.0, 0.15, sampleDepth + 0.0005 < centerDepth && sampleCoc + 0.5 < centerCoc);
    let cocSimilarity = 1.0 - clamp(abs(sampleCoc - centerCoc) / max(centerCoc, 1.0), 0.0, 1.0);
    let backgroundBoost = select(0.8, 1.0, depthDelta >= 0.0);
    return max(0.05, cocSimilarity) * foregroundPenalty * backgroundBoost;
}

fn gather_depth_aware_color(
    uniforms: DofUniforms,
    uv: vec2<f32>,
    size: vec2<f32>,
    centerDepth: f32,
) -> vec3<f32> {
    let texel = vec2<f32>(1.0 / size.x, 1.0 / size.y);
    let centerCoc = compute_coc(uniforms, centerDepth);
    let centerColor = textureSampleLevel(t_scene, s_scene, uv, 0.0).rgb;
    if (centerCoc <= 0.75) {
        return centerColor;
    }

    let centerCoord = vec2<i32>(clamp(uv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
    let sampleCount = u32(clamp(uniforms.sampleCount, 1.0, f32(MAX_DOF_SAMPLES)));
    let radius = max(1.0, centerCoc);
    var accumulatedColor = centerColor * 1.5;
    var accumulatedWeight = 1.5;

    for (var sampleIndex = 0u; sampleIndex < MAX_DOF_SAMPLES; sampleIndex++) {
        if (sampleIndex >= sampleCount) {
            break;
        }

        let diskOffset = vogel_disk_offset(sampleIndex, sampleCount, 0.0);
        let sampleUv = clamp(uv + diskOffset * texel * radius, vec2<f32>(0.0), vec2<f32>(1.0));
        let sampleCoord = vec2<i32>(clamp(sampleUv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
        let sampleDepth = load_depth_texture(uniforms, t_depth, sampleCoord);
        let sampleCoc = compute_coc(uniforms, sampleDepth);
        let sampleColor = textureSampleLevel(t_scene, s_scene, sampleUv, 0.0).rgb;
        let cocWeight = clamp(sampleCoc / max(1.0, centerCoc), 0.0, 1.0);
        let sampleWeight = cocWeight * cocWeight * compute_occlusion_weight(centerDepth, sampleDepth, centerCoc, sampleCoc);

        accumulatedColor += sampleColor * sampleWeight;
        accumulatedWeight += sampleWeight;
    }

    return accumulatedColor / max(accumulatedWeight, 0.0001);
}

fn gather_depth_aware_color_msaa(
    uniforms: DofUniforms,
    uv: vec2<f32>,
    size: vec2<f32>,
    centerDepth: f32,
) -> vec3<f32> {
    let texel = vec2<f32>(1.0 / size.x, 1.0 / size.y);
    let centerCoc = compute_coc(uniforms, centerDepth);
    let centerColor = textureSampleLevel(t_scene_composite_msaa, s_scene_composite_msaa, uv, 0.0).rgb;
    if (centerCoc <= 0.75) {
        return centerColor;
    }

    let sampleCount = u32(clamp(uniforms.sampleCount, 1.0, f32(MAX_DOF_SAMPLES)));
    let radius = max(1.0, centerCoc);
    var accumulatedColor = centerColor * 1.5;
    var accumulatedWeight = 1.5;

    for (var sampleIndex = 0u; sampleIndex < MAX_DOF_SAMPLES; sampleIndex++) {
        if (sampleIndex >= sampleCount) {
            break;
        }

        let diskOffset = vogel_disk_offset(sampleIndex, sampleCount, 0.0);
        let sampleUv = clamp(uv + diskOffset * texel * radius, vec2<f32>(0.0), vec2<f32>(1.0));
        let sampleCoord = vec2<i32>(clamp(sampleUv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
        let sampleDepth = load_depth_msaa(uniforms, t_depth_msaa, sampleCoord);
        let sampleCoc = compute_coc(uniforms, sampleDepth);
        let sampleColor = textureSampleLevel(t_scene_composite_msaa, s_scene_composite_msaa, sampleUv, 0.0).rgb;
        let cocWeight = clamp(sampleCoc / max(1.0, centerCoc), 0.0, 1.0);
        let sampleWeight = cocWeight * cocWeight * compute_occlusion_weight(centerDepth, sampleDepth, centerCoc, sampleCoc);

        accumulatedColor += sampleColor * sampleWeight;
        accumulatedWeight += sampleWeight;
    }

    return accumulatedColor / max(accumulatedWeight, 0.0001);
}

fn thin_lens_multisample_color(
    uniforms: DofUniforms,
    uv: vec2<f32>,
    size: vec2<f32>,
    centerDepth: f32,
    pixelPosition: vec2<f32>,
) -> vec3<f32> {
    let texel = vec2<f32>(1.0 / size.x, 1.0 / size.y);
    let centerCoc = compute_coc(uniforms, centerDepth);
    let centerColor = textureSampleLevel(t_scene, s_scene, uv, 0.0).rgb;
    if (centerCoc <= 0.5) {
        return centerColor;
    }

    let sampleCount = u32(clamp(uniforms.sampleCount, 1.0, f32(MAX_DOF_SAMPLES)));
    let rotation = hash12(floor(pixelPosition)) * PI * 2.0;
    let radius = max(1.0, centerCoc);
    var accumulatedColor = centerColor;
    var accumulatedWeight = 1.0;

    for (var sampleIndex = 0u; sampleIndex < MAX_DOF_SAMPLES; sampleIndex++) {
        if (sampleIndex >= sampleCount) {
            break;
        }

        let diskOffset = vogel_disk_offset(sampleIndex, sampleCount, rotation);
        let shapedOffset = diskOffset * aperture_hex_radius(diskOffset);
        let sampleUv = clamp(uv + shapedOffset * texel * radius, vec2<f32>(0.0), vec2<f32>(1.0));
        let sampleCoord = vec2<i32>(clamp(sampleUv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
        let sampleDepth = load_depth_texture(uniforms, t_depth, sampleCoord);
        let sampleCoc = compute_coc(uniforms, sampleDepth);
        let sampleColor = textureSampleLevel(t_scene, s_scene, sampleUv, 0.0).rgb;
        let highlightWeight = 0.5 + max(sampleColor.r, max(sampleColor.g, sampleColor.b));
        let cocWeight = clamp(sampleCoc / max(centerCoc, 1.0), 0.0, 1.0);
        let sampleWeight = cocWeight * compute_occlusion_weight(centerDepth, sampleDepth, centerCoc, sampleCoc) * highlightWeight;

        accumulatedColor += sampleColor * sampleWeight;
        accumulatedWeight += sampleWeight;
    }

    return accumulatedColor / max(accumulatedWeight, 0.0001);
}

fn thin_lens_multisample_color_msaa(
    uniforms: DofUniforms,
    uv: vec2<f32>,
    size: vec2<f32>,
    centerDepth: f32,
    pixelPosition: vec2<f32>,
) -> vec3<f32> {
    let texel = vec2<f32>(1.0 / size.x, 1.0 / size.y);
    let centerCoc = compute_coc(uniforms, centerDepth);
    let centerColor = textureSampleLevel(t_scene_composite_msaa, s_scene_composite_msaa, uv, 0.0).rgb;
    if (centerCoc <= 0.5) {
        return centerColor;
    }

    let sampleCount = u32(clamp(uniforms.sampleCount, 1.0, f32(MAX_DOF_SAMPLES)));
    let rotation = hash12(floor(pixelPosition)) * PI * 2.0;
    let radius = max(1.0, centerCoc);
    var accumulatedColor = centerColor;
    var accumulatedWeight = 1.0;

    for (var sampleIndex = 0u; sampleIndex < MAX_DOF_SAMPLES; sampleIndex++) {
        if (sampleIndex >= sampleCount) {
            break;
        }

        let diskOffset = vogel_disk_offset(sampleIndex, sampleCount, rotation);
        let shapedOffset = diskOffset * aperture_hex_radius(diskOffset);
        let sampleUv = clamp(uv + shapedOffset * texel * radius, vec2<f32>(0.0), vec2<f32>(1.0));
        let sampleCoord = vec2<i32>(clamp(sampleUv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
        let sampleDepth = load_depth_msaa(uniforms, t_depth_msaa, sampleCoord);
        let sampleCoc = compute_coc(uniforms, sampleDepth);
        let sampleColor = textureSampleLevel(t_scene_composite_msaa, s_scene_composite_msaa, sampleUv, 0.0).rgb;
        let highlightWeight = 0.5 + max(sampleColor.r, max(sampleColor.g, sampleColor.b));
        let cocWeight = clamp(sampleCoc / max(centerCoc, 1.0), 0.0, 1.0);
        let sampleWeight = cocWeight * compute_occlusion_weight(centerDepth, sampleDepth, centerCoc, sampleCoc) * highlightWeight;

        accumulatedColor += sampleColor * sampleWeight;
        accumulatedWeight += sampleWeight;
    }

    return accumulatedColor / max(accumulatedWeight, 0.0001);
}

@fragment
fn fs_dof_blur(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(t_scene));
    let outputScale = vec2<f32>(max(dofUniforms.padding0, 0.0001), max(dofUniforms.padding1, 0.0001));
    let uv = clamp(pos.xy * outputScale, vec2<f32>(0.0), vec2<f32>(1.0));
    if (get_algorithm(dofUniforms) != DOF_ALGORITHM_FAST) {
        return textureSampleLevel(t_scene, s_scene, uv, 0.0);
    }
    let coord = vec2<i32>(clamp(uv * size, vec2<f32>(0.0), size - vec2<f32>(1.0)));
    let radiusPixels = compute_coc(dofUniforms, load_depth_texture(dofUniforms, t_depth, coord));
    return sample_scene_fast_blur(uv, size, radiusPixels);
}

@fragment
fn fs_dof_blur_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(t_scene));
    let outputScale = vec2<f32>(max(dofUniforms.padding0, 0.0001), max(dofUniforms.padding1, 0.0001));
    let uv = clamp(pos.xy * outputScale, vec2<f32>(0.0), vec2<f32>(1.0));
    if (get_algorithm(dofUniforms) != DOF_ALGORITHM_FAST) {
        return textureSampleLevel(t_scene, s_scene, uv, 0.0);
    }
    let radiusPixels = compute_global_blur_radius(dofUniforms);
    return sample_scene_fast_blur(uv, size, radiusPixels);
}

fn sample_fast_dof_color(
    uniforms: DofUniforms,
    sceneColor: vec3<f32>,
    blurredColor: vec3<f32>,
    depth: f32,
) -> vec3<f32> {
    let cocPixels = compute_coc(uniforms, depth);
    let blend = clamp(cocPixels / max(1.0, uniforms.blurAmount * uniforms.cocBlendScale), 0.0, 1.0);
    return mix(sceneColor, blurredColor, blend);
}

@group(1) @binding(0) var<uniform> dofUniformsComposite: DofUniforms;
@group(1) @binding(1) var t_scene_composite: texture_2d<f32>;
@group(1) @binding(2) var s_scene_composite: sampler;
@group(1) @binding(3) var t_blurred: texture_2d<f32>;
@group(1) @binding(4) var t_depth_composite: texture_depth_2d;

@fragment
fn fs_dof_composite(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(t_scene_composite));
    let uv = clamp(pos.xy / size, vec2<f32>(0.0), vec2<f32>(1.0));
    let coord = vec2<i32>(clamp(pos.xy, vec2<f32>(0.0), size - vec2<f32>(1.0)));
    let sceneSample = textureSampleLevel(t_scene_composite, s_scene_composite, uv, 0.0);
    let sceneColor = sceneSample.rgb;
    let sceneAlpha = sceneSample.a;
    let algorithm = get_algorithm(dofUniformsComposite);
    let centerDepth = load_depth_texture(dofUniformsComposite, t_depth_composite, coord);

    if (algorithm == DOF_ALGORITHM_DEPTH_AWARE_GATHER) {
        return vec4<f32>(gather_depth_aware_color(dofUniformsComposite, uv, size, centerDepth), sceneAlpha);
    }
    if (algorithm == DOF_ALGORITHM_THIN_LENS_MULTISAMPLE) {
        return vec4<f32>(thin_lens_multisample_color(dofUniformsComposite, uv, size, centerDepth, pos.xy), sceneAlpha);
    }

    let blurredSize = vec2<f32>(textureDimensions(t_blurred));
    let blurredCoord = vec2<i32>(clamp(uv * blurredSize, vec2<f32>(0.0), blurredSize - vec2<f32>(1.0)));
    let blurredColor = textureLoad(t_blurred, blurredCoord, 0).rgb;
    return vec4<f32>(sample_fast_dof_color(dofUniformsComposite, sceneColor, blurredColor, centerDepth), sceneAlpha);
}

@group(2) @binding(0) var<uniform> dofUniformsCompositeMsaa: DofUniforms;
@group(2) @binding(1) var t_scene_composite_msaa: texture_2d<f32>;
@group(2) @binding(2) var s_scene_composite_msaa: sampler;
@group(2) @binding(3) var t_blurred_msaa: texture_2d<f32>;
@group(2) @binding(4) var t_depth_msaa: texture_depth_multisampled_2d;

@fragment
fn fs_dof_composite_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(t_scene_composite_msaa));
    let uv = clamp(pos.xy / size, vec2<f32>(0.0), vec2<f32>(1.0));
    let coord = vec2<i32>(clamp(pos.xy, vec2<f32>(0.0), size - vec2<f32>(1.0)));
    let sceneSample = textureSampleLevel(t_scene_composite_msaa, s_scene_composite_msaa, uv, 0.0);
    let sceneColor = sceneSample.rgb;
    let sceneAlpha = sceneSample.a;
    let algorithm = get_algorithm(dofUniformsCompositeMsaa);
    let centerDepth = load_depth_msaa(dofUniformsCompositeMsaa, t_depth_msaa, coord);

    if (algorithm == DOF_ALGORITHM_DEPTH_AWARE_GATHER) {
        return vec4<f32>(gather_depth_aware_color_msaa(dofUniformsCompositeMsaa, uv, size, centerDepth), sceneAlpha);
    }
    if (algorithm == DOF_ALGORITHM_THIN_LENS_MULTISAMPLE) {
        return vec4<f32>(thin_lens_multisample_color_msaa(dofUniformsCompositeMsaa, uv, size, centerDepth, pos.xy), sceneAlpha);
    }

    let blurredSize = vec2<f32>(textureDimensions(t_blurred_msaa));
    let blurredCoord = vec2<i32>(clamp(uv * blurredSize, vec2<f32>(0.0), blurredSize - vec2<f32>(1.0)));
    let blurredColor = textureLoad(t_blurred_msaa, blurredCoord, 0).rgb;
    return vec4<f32>(sample_fast_dof_color(dofUniformsCompositeMsaa, sceneColor, blurredColor, centerDepth), sceneAlpha);
}
