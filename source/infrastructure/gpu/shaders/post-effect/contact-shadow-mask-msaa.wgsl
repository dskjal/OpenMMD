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

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@group(0) @binding(0) var<uniform> contactShadowUniforms: ContactShadowUniforms;
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_normal: texture_2d<f32>;

fn clamp_coord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(size.x) - 1),
        clamp(coord.y, 0, i32(size.y) - 1),
    );
}

fn decode_contact_shadow_depth(encodedDepth: f32) -> f32 {
    let nearPlane = max(0.0001, contactShadowUniforms.nearPlane);
    let farPlane = max(nearPlane + 0.0001, contactShadowUniforms.farPlane);
    return mix(nearPlane, farPlane, clamp(encodedDepth, 0.0, 1.0));
}

fn load_view_normal(coord: vec2<i32>, size: vec2<u32>) -> vec3<f32> {
    let encoded = textureLoad(t_normal, clamp_coord(coord, size), 0).xyz;
    return normalize(encoded * 2.0 - vec3<f32>(1.0, 1.0, 1.0));
}

fn blur_contact_shadow(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    let clamped = clamp_coord(coord, size);
    let blurAmount = max(0.0, contactShadowUniforms.blurAmount);
    if (blurAmount <= 0.0001) {
        return calculate_contact_shadow(clamped, size);
    }

    let centerDepth = decode_contact_shadow_depth(textureLoad(t_depth, clamped, 0).r);
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
        let sampleShadow = calculate_contact_shadow(sampleCoord, size);
        let sampleDepth = decode_contact_shadow_depth(textureLoad(t_depth, sampleCoord, 0).r);
        let sampleNormal = load_view_normal(sampleCoord, size);
        let depthWeight = exp(-abs(sampleDepth - centerDepth) * (8.0 / max(blurAmount, 0.25)));
        let normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 4.0);
        let weight = weights[index] * depthWeight * normalWeight;
        sum += sampleShadow * weight;
        weightSum += weight;
    }

    return select(sum / max(weightSum, 0.0001), calculate_contact_shadow(clamped, size), weightSum <= 0.0001);
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

fn project_view_position(uniforms: ContactShadowUniforms, viewPosition: vec3<f32>) -> vec2<f32> {
    let depth = max(0.0001, -viewPosition.z);
    let tanHalfFovY = max(0.0001, uniforms.tanHalfFovY);
    let aspect = max(0.0001, uniforms.aspect);
    let ndc = vec2<f32>(
        viewPosition.x / (depth * tanHalfFovY * aspect),
        viewPosition.y / (depth * tanHalfFovY),
    );
    return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn calculate_contact_shadow(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    let clamped = clamp_coord(coord, size);
    let uv = (vec2<f32>(clamped) + vec2<f32>(0.5, 0.5)) / vec2<f32>(size);
    let depth = decode_contact_shadow_depth(textureLoad(t_depth, clamped, 0).r);
    let viewPosition = reconstruct_view_position(contactShadowUniforms, uv, depth);
    let lightDirection = -normalize(vec3<f32>(
        contactShadowUniforms.lightDirectionX,
        contactShadowUniforms.lightDirectionY,
        contactShadowUniforms.lightDirectionZ,
    ));
    let stepCount = max(1u, u32(round(contactShadowUniforms.stepCount)));
    let stepLength = max(0.0001, contactShadowUniforms.length) / f32(stepCount);
    let maxIntensity = clamp(contactShadowUniforms.intensity, 0.0, 2.0);
    let normal = load_view_normal(clamped, size);
    let facing = clamp(dot(normal, -lightDirection), 0.0, 1.0);
    let normalWeight = smoothstep(0.05, 0.45, facing);

    var shadow = 1.0;
    for (var index: u32 = 1u; index <= stepCount; index = index + 1u) {
        let samplePosition = viewPosition + lightDirection * (f32(index) * stepLength);
        if (samplePosition.z >= -0.0001) {
            break;
        }

        let sampleUv = project_view_position(contactShadowUniforms, samplePosition);
        if (any(sampleUv < vec2<f32>(0.0)) || any(sampleUv > vec2<f32>(1.0))) {
            break;
        }

        let sampleCoord = clamp_coord(vec2<i32>(i32(sampleUv.x * f32(size.x)), i32(sampleUv.y * f32(size.y))), size);
        let sampleDepth = decode_contact_shadow_depth(textureLoad(t_depth, sampleCoord, 0).r);
        let rayDepth = max(0.0001, -samplePosition.z);
        if (sampleDepth + max(0.0, contactShadowUniforms.thickness) < rayDepth) {
            let fade = 1.0 - (f32(index) / f32(stepCount));
            shadow = max(0.0, 1.0 - maxIntensity * fade);
            break;
        }
    }

    return mix(1.0, shadow, normalWeight);
}

@fragment
fn fs_contact_shadow_mask_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_depth));
    let coord = vec2<i32>(i32(pos.x), i32(pos.y));
    let shadow = blur_contact_shadow(coord, size);
    return vec4<f32>(shadow, shadow, shadow, 1.0);
}
