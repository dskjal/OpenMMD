struct BloomUniforms {
    threshold: f32,
    blurAmount: f32,
    alpha: f32,
    dynamicRange: f32,
    shadowMultiplier: f32,
    reserved0: f32,
    reserved1: f32,
    reserved2: f32,
};

struct BloomPassParams {
    radiusScale: f32,
    blendFactor: f32,
    knee: f32,
    reserved: f32,
};

struct BloomOutputSize {
    size: vec2<f32>,
};

struct FullscreenVertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    var output: FullscreenVertexOutput;
    output.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    output.uv = uv;
    return output;
}

fn sanitize_bloom_component(value: f32) -> f32 {
    let isFiniteValue = (value == value) && (abs(value) <= 3.402823466e38);
    return select(0.0, max(value, 0.0), isFiniteValue);
}

fn sanitize_bloom_color(color: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        sanitize_bloom_component(color.x),
        sanitize_bloom_component(color.y),
        sanitize_bloom_component(color.z),
    );
}

fn sample_bloom_color(textureValue: texture_2d<f32>, samplerValue: sampler, uv: vec2<f32>) -> vec3<f32> {
    return sanitize_bloom_color(textureSampleLevel(textureValue, samplerValue, uv, 0.0).rgb);
}

fn sample_bloom_alpha(textureValue: texture_2d<f32>, samplerValue: sampler, uv: vec2<f32>) -> f32 {
    return textureSampleLevel(textureValue, samplerValue, uv, 0.0).a;
}

fn sample_bloom_shadow_mask(textureValue: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(textureValue));
    let maxCoord = max(size - vec2<i32>(1, 1), vec2<i32>(0, 0));
    let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let coord = clamp(vec2<i32>(floor(clampedUv * vec2<f32>(size))), vec2<i32>(0, 0), maxCoord);
    return textureLoad(textureValue, coord, 0);
}

fn sample_bloom_shadow_mask_coord(textureValue: texture_2d<f32>, coord: vec2<i32>) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(textureValue));
    let maxCoord = max(size - vec2<i32>(1, 1), vec2<i32>(0, 0));
    return textureLoad(textureValue, clamp(coord, vec2<i32>(0, 0), maxCoord), 0);
}

fn sample_bloom_shadow_factor(textureValue: texture_2d<f32>, uv: vec2<f32>, strength: f32) -> f32 {
    let maskSample = sample_bloom_shadow_mask(textureValue, uv);
    if (maskSample.a < 0.5) {
        return 1.0;
    }
    let clampedStrength = clamp(strength, 0.0, 1.0);
    let maskFactor = clamp(maskSample.b, 0.0, 1.0);
    return clamp(mix(1.0, maskFactor, clampedStrength), 0.0, 1.0);
}

fn bloom_shadow_contribution(maskSample: vec4<f32>, weight: f32) -> vec2<f32> {
    let isValid = maskSample.a >= 0.5;
    return vec2<f32>(
        select(0.0, clamp(maskSample.b, 0.0, 1.0) * weight, isValid),
        select(0.0, weight, isValid),
    );
}

fn sample_bloom_shadow_factor_filtered(textureValue: texture_2d<f32>, uv: vec2<f32>, strength: f32) -> f32 {
    let size = vec2<i32>(textureDimensions(textureValue));
    let maxCoord = max(size - vec2<i32>(1, 1), vec2<i32>(0, 0));
    let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let coord = clamp(vec2<i32>(floor(clampedUv * vec2<f32>(size))), vec2<i32>(0, 0), maxCoord);
    let center = sample_bloom_shadow_mask_coord(textureValue, coord);
    let centerWeight = 4.0;
    let crossWeight = 2.0;
    let diagonalWeight = 1.0;
    let sampleLeft = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(-1, 0));
    let sampleRight = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(1, 0));
    let sampleUp = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(0, -1));
    let sampleDown = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(0, 1));
    let sampleUpLeft = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(-1, -1));
    let sampleUpRight = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(1, -1));
    let sampleDownLeft = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(-1, 1));
    let sampleDownRight = sample_bloom_shadow_mask_coord(textureValue, coord + vec2<i32>(1, 1));
    let centerContribution = bloom_shadow_contribution(center, centerWeight);
    let leftContribution = bloom_shadow_contribution(sampleLeft, crossWeight);
    let rightContribution = bloom_shadow_contribution(sampleRight, crossWeight);
    let upContribution = bloom_shadow_contribution(sampleUp, crossWeight);
    let downContribution = bloom_shadow_contribution(sampleDown, crossWeight);
    let upLeftContribution = bloom_shadow_contribution(sampleUpLeft, diagonalWeight);
    let upRightContribution = bloom_shadow_contribution(sampleUpRight, diagonalWeight);
    let downLeftContribution = bloom_shadow_contribution(sampleDownLeft, diagonalWeight);
    let downRightContribution = bloom_shadow_contribution(sampleDownRight, diagonalWeight);
    let accumulated = centerContribution
        + leftContribution
        + rightContribution
        + upContribution
        + downContribution
        + upLeftContribution
        + upRightContribution
        + downLeftContribution
        + downRightContribution;
    let filteredMaskFactor = select(
        1.0,
        accumulated.x / max(accumulated.y, 0.0001),
        accumulated.y > 0.0,
    );
    let clampedStrength = clamp(strength, 0.0, 1.0);
    return clamp(mix(1.0, filteredMaskFactor, clampedStrength), 0.0, 1.0);
}

fn sample_karis_average(textureValue: texture_2d<f32>, samplerValue: sampler, uv: vec2<f32>, texelSize: vec2<f32>, radiusScale: f32) -> vec3<f32> {
    let offsetA = texelSize * radiusScale;
    let offsetB = texelSize * radiusScale * 2.0;
    let center = sample_bloom_color(textureValue, samplerValue, uv) * 4.0;
    let cross = (
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>( offsetA.x, 0.0)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(-offsetA.x, 0.0)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(0.0,  offsetA.y)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(0.0, -offsetA.y))
    ) * 2.0;
    let diagonals = (
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>( offsetA.x,  offsetA.y)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(-offsetA.x,  offsetA.y)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>( offsetA.x, -offsetA.y)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(-offsetA.x, -offsetA.y))
    );
    let farCross = (
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>( offsetB.x, 0.0)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(-offsetB.x, 0.0)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(0.0,  offsetB.y)) +
        sample_bloom_color(textureValue, samplerValue, uv + vec2<f32>(0.0, -offsetB.y))
    );
    return sanitize_bloom_color((center + cross + diagonals + farCross) / 17.0);
}

fn bloom_uv(pos: vec2<f32>, outputSize: vec2<f32>) -> vec2<f32> {
    let safeSize = vec2<f32>(max(outputSize.x, 1.0), max(outputSize.y, 1.0));
    return clamp(pos / safeSize, vec2<f32>(0.0), vec2<f32>(1.0));
}

@group(0) @binding(0) var<uniform> bloomUniformsExtract: BloomUniforms;
@group(0) @binding(1) var<uniform> bloomPassExtract: BloomPassParams;
@group(0) @binding(2) var<uniform> bloomOutputSizeExtract: BloomOutputSize;
@group(0) @binding(3) var t_scene: texture_2d<f32>;
@group(0) @binding(4) var t_scene_mask_extract: texture_2d<f32>;
@group(0) @binding(5) var s_scene: sampler;

@fragment
fn fs_bloom_extract(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = bloom_uv(input.position.xy, bloomOutputSizeExtract.size);
    let texelSize = 1.0 / vec2<f32>(textureDimensions(t_scene));
    let shadowFactor = sample_bloom_shadow_factor_filtered(
        t_scene_mask_extract,
        uv,
        bloomUniformsExtract.shadowMultiplier,
    );
    let color = sample_karis_average(t_scene, s_scene, uv, texelSize, max(1.0, bloomPassExtract.radiusScale)) * shadowFactor;
    let brightness = max(color.r, max(color.g, color.b));
    let threshold = clamp(bloomUniformsExtract.threshold, 0.0, max(0.0, bloomUniformsExtract.dynamicRange));
    let knee = max(0.0001, bloomPassExtract.knee);
    let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
    let softKnee = (soft * soft) / max(4.0 * knee, 0.0001);
    let contribution = max(brightness - threshold, softKnee) / max(brightness, 0.0001);
    return vec4<f32>(color * contribution, 1.0);
}

@group(1) @binding(0) var<uniform> bloomUniformsComposite: BloomUniforms;
@group(1) @binding(1) var<uniform> bloomPassComposite: BloomPassParams;
@group(1) @binding(2) var<uniform> bloomOutputSizeComposite: BloomOutputSize;
@group(1) @binding(3) var t_scene_composite: texture_2d<f32>;
@group(1) @binding(4) var t_bloom_composite: texture_2d<f32>;
@group(1) @binding(5) var t_scene_mask_composite: texture_2d<f32>;
@group(1) @binding(6) var s_composite: sampler;

@fragment
fn fs_bloom_composite(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = bloom_uv(input.position.xy, bloomOutputSizeComposite.size);
    let sceneColor = sample_bloom_color(t_scene_composite, s_composite, uv);
    let bloomColor = sample_bloom_color(t_bloom_composite, s_composite, uv);
    let strength = max(0.0, bloomUniformsComposite.alpha);
    return vec4<f32>(
        sanitize_bloom_color(sceneColor + bloomColor * strength),
        sample_bloom_alpha(t_scene_composite, s_composite, uv),
    );
}

@vertex
fn vs_bloom_shadow_debug(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
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
    var output: FullscreenVertexOutput;
    output.position = vec4<f32>(clip * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    output.uv = uv;
    return output;
}

@fragment
fn fs_bloom_shadow_debug(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
    let maskSample = sample_bloom_shadow_mask(t_bloom_color_debug, uv);
    let value = clamp(maskSample.b, 0.0, 1.0);
    let shade = vec3<f32>(value);
    let border = select(0.0, 1.0, input.uv.x < 0.01 || input.uv.x > 0.99 || input.uv.y < 0.01 || input.uv.y > 0.99);
    let baseColor = select(vec3<f32>(0.0, 0.0, 0.0), shade, maskSample.a >= 0.5);
    let color = mix(baseColor, vec3<f32>(1.0, 0.2, 0.2), border);
    return vec4<f32>(color, 0.95);
}

fn normalize_bloom_debug_color(color: vec3<f32>) -> vec3<f32> {
    let peak = max(color.r, max(color.g, color.b));
    let scale = max(1.0, peak);
    return clamp(color / scale, vec3<f32>(0.0), vec3<f32>(1.0));
}

@group(0) @binding(0) var t_bloom_color_debug: texture_2d<f32>;
@group(0) @binding(1) var s_bloom_color_debug: sampler;

@fragment
fn fs_bloom_color_debug(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
    let sourceColor = sample_bloom_color(t_bloom_color_debug, s_bloom_color_debug, uv);
    let color = normalize_bloom_debug_color(sourceColor);
    let border = select(0.0, 1.0, input.uv.x < 0.01 || input.uv.x > 0.99 || input.uv.y < 0.01 || input.uv.y > 0.99);
    let mixedColor = mix(color, vec3<f32>(0.2, 0.8, 1.0), border);
    return vec4<f32>(mixedColor, 0.95);
}

@group(2) @binding(0) var<uniform> bloomUniformsPass: BloomUniforms;
@group(2) @binding(1) var<uniform> bloomPassParams: BloomPassParams;
@group(2) @binding(2) var<uniform> bloomOutputSizePass: BloomOutputSize;
@group(2) @binding(3) var t_bloom_primary: texture_2d<f32>;
@group(2) @binding(4) var t_bloom_secondary: texture_2d<f32>;
@group(2) @binding(5) var s_bloom_pass: sampler;

@fragment
fn fs_bloom_downsample(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = bloom_uv(input.position.xy, bloomOutputSizePass.size);
    let texelSize = 1.0 / vec2<f32>(textureDimensions(t_bloom_primary));
    let radiusScale = max(1.0, bloomPassParams.radiusScale);
    let color = sample_karis_average(t_bloom_primary, s_bloom_pass, uv, texelSize, radiusScale);
    return vec4<f32>(sanitize_bloom_color(color), 1.0);
}

@fragment
fn fs_bloom_upsample(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = bloom_uv(input.position.xy, bloomOutputSizePass.size);
    let highResColor = sample_bloom_color(t_bloom_primary, s_bloom_pass, uv);
    let lowTexelSize = 1.0 / vec2<f32>(textureDimensions(t_bloom_secondary));
    let blurredLowRes = sample_karis_average(t_bloom_secondary, s_bloom_pass, uv, lowTexelSize, max(1.0, bloomPassParams.radiusScale));
    let blendFactor = clamp(bloomPassParams.blendFactor, 0.0, 1.0);
    return vec4<f32>(sanitize_bloom_color(highResColor + blurredLowRes * blendFactor), 1.0);
}
