struct FullscreenVertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    var out: FullscreenVertexOutput;
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    return out;
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
};

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@group(0) @binding(0) var<uniform> gammaUniforms: GammaUniforms;
@group(0) @binding(1) var t_scene: texture_2d<f32>;
@group(0) @binding(2) var s_scene: sampler;

fn get_luma(rgb: vec3<f32>) -> f32 {
    return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

fn sample_scene(uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(t_scene, s_scene, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
}

fn sample_scene_alpha(uv: vec2<f32>) -> f32 {
    return textureSampleLevel(t_scene, s_scene, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).a;
}

@fragment
fn fs_fxaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let res = vec2<f32>(textureDimensions(t_scene));
    let uv = clamp(pos.xy / res, vec2<f32>(0.0), vec2<f32>(1.0));
    let texelSize = 1.0 / res;

    let rgbM = sample_scene(uv);
    let rgbNW = sample_scene(uv + vec2<f32>(-1.0, -1.0) * texelSize);
    let rgbNE = sample_scene(uv + vec2<f32>(1.0, -1.0) * texelSize);
    let rgbSW = sample_scene(uv + vec2<f32>(-1.0, 1.0) * texelSize);
    let rgbSE = sample_scene(uv + vec2<f32>(1.0, 1.0) * texelSize);

    let lumaM = get_luma(rgbM);
    let lumaNW = get_luma(rgbNW);
    let lumaNE = get_luma(rgbNE);
    let lumaSW = get_luma(rgbSW);
    let lumaSE = get_luma(rgbSE);

    let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    let dir = vec2<f32>(
        -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
        ((lumaNW + lumaSW) - (lumaNE + lumaSE))
    );

    let FXAA_REDUCE_MIN = 1.0 / 128.0;
    let FXAA_REDUCE_MUL = 1.0 / 8.0;
    let FXAA_SPAN_MAX = 8.0;

    let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
    let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);

    let dirFinal = min(vec2<f32>(FXAA_SPAN_MAX), max(vec2<f32>(-FXAA_SPAN_MAX), dir * rcpDirMin)) * texelSize;

    let rgbA = 0.5 * (
        sample_scene(uv + dirFinal * (1.0 / 3.0 - 0.5)) +
        sample_scene(uv + dirFinal * (2.0 / 3.0 - 0.5))
    );
    let rgbB = (rgbA * 0.5) + 0.25 * (
        sample_scene(uv + dirFinal * -0.5) +
        sample_scene(uv + dirFinal * 0.5)
    );
    let alpha = sample_scene_alpha(uv);

    let lumaB = get_luma(rgbB);
    if ((lumaB < lumaMin) || (lumaB > lumaMax)) {
        return vec4<f32>(rgbA, alpha);
    }
    return vec4<f32>(rgbB, alpha);
}
