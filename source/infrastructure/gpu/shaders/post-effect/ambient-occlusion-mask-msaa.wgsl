@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

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

struct EnvironmentUniforms {
    environmentParams: vec4<f32>,
};

@group(3) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@group(0) @binding(0) var<uniform> ambientOcclusionUniforms: AmbientOcclusionUniforms;
@group(0) @binding(1) var t_depth: texture_2d<f32>;
@group(0) @binding(2) var t_normal: texture_2d<f32>;

fn clamp_coord(coord: vec2<i32>, size: vec2<u32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(size.x) - 1),
        clamp(coord.y, 0, i32(size.y) - 1),
    );
}

fn decode_prepass_depth(encodedDepth: f32) -> f32 {
    let nearPlane = max(0.0001, ambientOcclusionUniforms.nearPlane);
    let farPlane = max(nearPlane + 0.0001, ambientOcclusionUniforms.farPlane);
    return mix(nearPlane, farPlane, clamp(encodedDepth, 0.0, 1.0));
}

fn reconstruct_view_position(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let viewDepth = max(0.0001, depth);
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let tanHalfFovY = max(0.0001, ambientOcclusionUniforms.tanHalfFovY);
    let aspect = max(0.0001, ambientOcclusionUniforms.aspect);
    return vec3<f32>(
        ndc.x * viewDepth * tanHalfFovY * aspect,
        ndc.y * viewDepth * tanHalfFovY,
        -viewDepth,
    );
}

fn project_view_position(viewPosition: vec3<f32>) -> vec2<f32> {
    let depth = max(0.0001, -viewPosition.z);
    let tanHalfFovY = max(0.0001, ambientOcclusionUniforms.tanHalfFovY);
    let aspect = max(0.0001, ambientOcclusionUniforms.aspect);
    let ndc = vec2<f32>(
        viewPosition.x / (depth * tanHalfFovY * aspect),
        viewPosition.y / (depth * tanHalfFovY),
    );
    return vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn get_screen_radius_uv(radius: f32) -> f32 {
    return max(0.000001, radius) * 0.02;
}

fn estimate_view_space_offset(uvOffset: vec2<f32>, depth: f32) -> vec2<f32> {
    let viewDepth = max(0.0001, depth);
    let tanHalfFovY = max(0.0001, ambientOcclusionUniforms.tanHalfFovY);
    let aspect = max(0.0001, ambientOcclusionUniforms.aspect);
    return vec2<f32>(
        uvOffset.x * 2.0 * viewDepth * tanHalfFovY * aspect,
        uvOffset.y * 2.0 * viewDepth * tanHalfFovY,
    );
}

fn load_view_normal(coord: vec2<i32>, size: vec2<u32>) -> vec3<f32> {
    let encoded = textureLoad(t_normal, clamp_coord(coord, size), 0).xyz;
    return normalize(encoded * 2.0 - vec3<f32>(1.0, 1.0, 1.0));
}

fn hash11(value: f32) -> f32 {
    return fract(sin(value * 127.1) * 43758.5453123);
}

fn hash21(coord: vec2<f32>) -> f32 {
    return fract(sin(dot(coord, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn make_tangent_basis(normal: vec3<f32>, seed: f32) -> mat3x3<f32> {
    let angle = seed * 6.283185307179586;
    let randomVector = normalize(vec3<f32>(cos(angle), sin(angle), hash11(seed + 1.0) * 2.0 - 1.0));
    let tangent = normalize(select(
        cross(normal, vec3<f32>(0.0, 1.0, 0.0)),
        cross(normal, randomVector),
        abs(dot(normal, randomVector)) < 0.999,
    ));
    let bitangent = normalize(cross(normal, tangent));
    return mat3x3<f32>(tangent, bitangent, normal);
}

fn generate_sample_direction(index: u32, sampleCount: u32, seed: f32) -> vec3<f32> {
    let fi = f32(index) + 1.0;
    let count = max(1.0, f32(sampleCount));
    let angle = (fi / count) * 9.42477796076938 + seed * 6.283185307179586;
    let radius = sqrt(fi / count);
    let z = sqrt(max(0.0, 1.0 - radius * radius));
    return normalize(vec3<f32>(cos(angle) * radius, sin(angle) * radius, z));
}

fn calculate_ambient_occlusion(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    let clamped = clamp_coord(coord, size);
    let uv = (vec2<f32>(clamped) + vec2<f32>(0.5, 0.5)) / vec2<f32>(size);
    let centerDepth = decode_prepass_depth(textureLoad(t_depth, clamped, 0).r);
    let centerPosition = reconstruct_view_position(uv, centerDepth);
    let centerNormal = load_view_normal(clamped, size);
    let radius = max(0.001, ambientOcclusionUniforms.radius);
    let bias = max(0.0001, ambientOcclusionUniforms.bias);
    let intensity = clamp(ambientOcclusionUniforms.intensity, 0.0, 10.0);
    let sampleCount = max(1u, u32(round(ambientOcclusionUniforms.sampleCount)));
    let screenRadiusUv = get_screen_radius_uv(radius);
    let seed = hash21(vec2<f32>(clamped));
    let basis = make_tangent_basis(centerNormal, seed);

    var occlusion = 0.0;
    var validSampleCount = 0.0;
    for (var index: u32 = 0u; index < sampleCount; index = index + 1u) {
        let localDirection = generate_sample_direction(index, sampleCount, seed);
        let sampleDirection = basis * localDirection;
        let sampleUv = uv + sampleDirection.xy * screenRadiusUv;
        if (any(sampleUv < vec2<f32>(0.0)) || any(sampleUv > vec2<f32>(1.0))) {
            continue;
        }

        let sampleCoord = clamp_coord(vec2<i32>(sampleUv * vec2<f32>(size)), size);
        let sampleDepth = decode_prepass_depth(textureLoad(t_depth, sampleCoord, 0).r);
        let scenePosition = reconstruct_view_position(
            (vec2<f32>(sampleCoord) + vec2<f32>(0.5, 0.5)) / vec2<f32>(size),
            sampleDepth,
        );
        let delta = scenePosition - centerPosition;
        let distanceToSample = length(delta);
        if (distanceToSample <= 0.0001) {
            continue;
        }

        let uvOffset = sampleUv - uv;
        let expectedSampleDistance = length(estimate_view_space_offset(uvOffset, centerDepth));
        let maxSampleDistance = max(0.0001, expectedSampleDistance * 3.0);
        if (distanceToSample > maxSampleDistance) {
            continue;
        }

        let projectedDistance = dot(centerNormal, delta);
        if (projectedDistance <= 0.0) {
            continue;
        }

        validSampleCount += 1.0;
        let distanceWeight = 1.0 - smoothstep(0.0, maxSampleDistance, distanceToSample);
        let horizon = max(dot(centerNormal, normalize(delta)), 0.0);
        let blocked = select(0.0, 1.0, projectedDistance > bias);
        occlusion += blocked * horizon * distanceWeight;
    }

    let normalizedOcclusion = occlusion / max(1.0, validSampleCount);
    return clamp(1.0 - normalizedOcclusion * intensity, 0.0, 1.0);
}

fn blur_ambient_occlusion(coord: vec2<i32>, size: vec2<u32>) -> f32 {
    let clamped = clamp_coord(coord, size);
    let blurAmount = max(0.0, ambientOcclusionUniforms.blurAmount);
    if (blurAmount <= 0.0001) {
        return calculate_ambient_occlusion(clamped, size);
    }

    let centerDepth = decode_prepass_depth(textureLoad(t_depth, clamped, 0).r);
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
        let sampleAo = calculate_ambient_occlusion(sampleCoord, size);
        let sampleDepth = decode_prepass_depth(textureLoad(t_depth, sampleCoord, 0).r);
        let sampleNormal = load_view_normal(sampleCoord, size);
        let depthWeight = exp(-abs(sampleDepth - centerDepth) * (8.0 / max(blurAmount, 0.25)));
        let normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 4.0);
        let weight = weights[index] * depthWeight * normalWeight;
        sum += sampleAo * weight;
        weightSum += weight;
    }

    return select(sum / max(weightSum, 0.0001), calculate_ambient_occlusion(clamped, size), weightSum <= 0.0001);
}

@fragment
fn fs_ambient_occlusion_mask_msaa(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<u32>(textureDimensions(t_depth));
    let coord = vec2<i32>(i32(pos.x), i32(pos.y));
    let ao = blur_ambient_occlusion(coord, size);
    return vec4<f32>(ao, ao, ao, 1.0);
}
