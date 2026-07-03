@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

struct GammaUniforms {
    gamma: f32,
    chromaticAberration: f32,
    colorTemperatureR: f32,
    colorTemperatureG: f32,
    colorTemperatureB: f32,
    filmGrainAmount: f32,
    filmGrainSeed: f32,
    filmGrainMode: f32,
    viewTransformMode: f32,
    displayColorSpaceMode: f32,
    reserved0: f32,
    reserved1: f32,
};

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@group(0) @binding(0) var<uniform> gammaUniforms: GammaUniforms;
@group(0) @binding(1) var t_scene: texture_2d<f32>;
@group(0) @binding(2) var s_scene: sampler;
@group(0) @binding(3) var t_aces_lut: texture_3d<f32>;
@group(0) @binding(4) var s_aces_lut: sampler;

fn film_grain_hash(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2<f32>(123.34, 456.21));
    q = q + dot(q, q + vec2<f32>(45.32));
    return fract(q.x * q.y);
}

fn blend_overlay(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
    let dark = 2.0 * base * blend;
    let light = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - base) * (vec3<f32>(1.0) - blend);
    return select(dark, light, base >= vec3<f32>(0.5));
}

fn apply_film_grain(color: vec3<f32>, uv: vec2<f32>, amount: f32, seed: f32) -> vec3<f32> {
    if (amount <= 0.0) {
        return color;
    }

    let noise = film_grain_hash(uv + vec2<f32>(seed, seed));
    let luminance = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    let midtoneWeight = 4.0 * luminance * (1.0 - luminance);
    let grainAmount = amount * midtoneWeight;
    let grain = vec3<f32>(noise) * grainAmount;
    let grainColor = vec3<f32>(0.5) + (grain - (0.5 * grainAmount));
    return clamp(blend_overlay(color, grainColor), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sample_chromatic_aberration(uv: vec2<f32>, amount: f32) -> vec3<f32> {
    if (amount <= 0.0) {
        return textureSampleLevel(t_scene, s_scene, uv, 0.0).rgb;
    }

    let centered = uv - vec2<f32>(0.5);
    let radius = length(centered);
    let direction = centered / max(radius, 0.0001);
    let offset = direction * amount * radius * 0.008;
    let red = textureSampleLevel(t_scene, s_scene, clamp(uv + offset, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).r;
    let green = textureSampleLevel(t_scene, s_scene, uv, 0.0).g;
    let blue = textureSampleLevel(t_scene, s_scene, clamp(uv - offset, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).b;
    return vec3<f32>(red, green, blue);
}

fn sample_scene_alpha(uv: vec2<f32>) -> f32 {
    return textureSampleLevel(t_scene, s_scene, uv, 0.0).a;
}

fn encode_srgb_like(color: vec3<f32>) -> vec3<f32> {
    let cut = vec3<f32>(0.0031308);
    let lower = color * 12.92;
    let upper = 1.055 * pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(lower, upper, color > cut);
}

fn linear_srgb_to_display_p3(color: vec3<f32>) -> vec3<f32> {
    let xyz = mat3x3<f32>(
        vec3<f32>(0.4123908, 0.2126390, 0.0193308),
        vec3<f32>(0.3575843, 0.7151687, 0.1191948),
        vec3<f32>(0.1804808, 0.0721923, 0.9505322)
    ) * color;
    return mat3x3<f32>(
        vec3<f32>(2.4934969, -0.8294890, 0.0358458),
        vec3<f32>(-0.9313836, 1.7626641, -0.0761724),
        vec3<f32>(-0.4027108, 0.0236247, 0.9568845)
    ) * xyz;
}

fn linear_to_lut_coord(color: vec3<f32>) -> vec3<f32> {
    return color / (vec3<f32>(1.0) + max(color, vec3<f32>(0.0)));
}

fn apply_standard_display_transform(color: vec3<f32>, displayColorSpaceMode: f32) -> vec3<f32> {
    let gamutConverted = select(color, linear_srgb_to_display_p3(color), displayColorSpaceMode >= 0.5);
    return encode_srgb_like(clamp(gamutConverted, vec3<f32>(0.0), vec3<f32>(1.0)));
}

fn apply_aces_display_transform(color: vec3<f32>) -> vec3<f32> {
    let coord = clamp(linear_to_lut_coord(max(color, vec3<f32>(0.0))), vec3<f32>(0.0), vec3<f32>(1.0));
    return textureSampleLevel(t_aces_lut, s_aces_lut, coord, 0.0).rgb;
}

@fragment
fn fs_gamma(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let res = vec2<f32>(textureDimensions(t_scene));
    let uv = pos.xy / res;
    let chromaticAberration = clamp(gammaUniforms.chromaticAberration, 0.0, 1.0);
    let color = sample_chromatic_aberration(uv, chromaticAberration) * vec3<f32>(
        gammaUniforms.colorTemperatureR,
        gammaUniforms.colorTemperatureG,
        gammaUniforms.colorTemperatureB,
    );
    let gamma = max(0.1, gammaUniforms.gamma);
    let displayColor = select(
        apply_standard_display_transform(color, gammaUniforms.displayColorSpaceMode),
        apply_aces_display_transform(color),
        gammaUniforms.viewTransformMode >= 0.5
    );
    let corrected = pow(clamp(displayColor, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / gamma));
    let grained = apply_film_grain(corrected, uv, gammaUniforms.filmGrainAmount, gammaUniforms.filmGrainSeed);
    return vec4<f32>(grained, sample_scene_alpha(uv));
}
