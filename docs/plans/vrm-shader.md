# VRM Loader + MToon Auto-Apply

## Summary

- Add .vrm as a glTF-derived model format handled by a dedicated VRMModelLoader that reuses the current
GLTFModelLoader conversion path.
- First implementation supports the provided fixture test-data/AliciaSolid.vrm by parsing old VRM 0.x
extensions.VRM.materialProperties, while also recognizing VRM 1.0 entry extensions so the loader shape is
forward-compatible.
- Add a new mtoon-shader.wgsl and automatically assign it to VRM materials that declare MToon. Current scope is
mesh/material/texture loading plus automatic MToon assignment only.

## Key Changes

- Loader structure:
    - Add source/loader/vrm-loader.js.
    - Implement .vrm parsing as GLB/glTF 2.0 input, using GLTFLoader/Three.js parse the same way as
    GLTFModelLoader.
    - Refactor shared glTF-to-internal-model conversion helpers out of source/loader/gltf-loader.js or subclass
    it so VRM can reuse primitive, texture, bone, and animation conversion instead of duplicating logic.
    - Mark VRM models distinctly, e.g. model.magic = 'Vrm', while preserving gltfAnimationSources and
    gltfAssetContext.
    - Store VRM metadata on the model in a loader-only/runtime-safe shape, including:
        - detected VRM version family: vrm0 or vrm1
        - material extension source per material
    - Update .vrm acceptance in index.html, source/file-loading.js, and source/model-scene.js.
    - Route .vrm to VRMModelLoader for path, file, and ZIP loading flows.
- VRM material parsing:
    - For old VRM 0.x, parse json.extensions.VRM.materialProperties[*] and match entries to glTF materials by
    index first, then by exact material name as a defensive fallback.
    - Detect shader === "VRM/MToon" and map the first-pass MToon fields into internal material/runtime data:
        - base color / main texture
        - shade color / shade texture
        - normal texture scale if present
        - emissive color / emissive texture
        - rim color / rim texture / rim mix factors
        - outline width, color, width mode, lighting mix
        - shade shift / shade toony / receive shadow rate / indirect light intensity
        - alpha/cull/z-write related flags derived from VRM material properties, not only from Three.js material
        defaults
    - For VRM 1.0, recognize VRMC_materials_mtoon and reserve the same internal MToon data shape, but only wire
    the parser paths needed to avoid redesign later; no 1.0-specific behavior beyond parse/storage is required
    in this slice.
- Material/runtime interface changes:
    - Extend the shared shader material contract in source/shaders/shaders.wgsl and the matching JS-side
    material buffer writers so MToon-specific uniforms are explicit rather than inferred from glTF PBR fields.
    - Keep existing MMD/glTF shaders compiling by giving all new fields safe defaults in material creation and
    morph/material-state sync.
    - Extend runtime material state creation/copy paths so VRM MToon values survive:
        - model material creation
        - morph controller material state snapshots
        - material buffer upload/update
        - material cloning paths inside ModelManager
- Shader integration:
    - Add source/shaders/custom-shaders/mtoon-shader.wgsl.
    - Register it in source/shaders/custom-shaders/manifest.json.
    - Auto-assign shaderName = 'mtoon-shader.wgsl' for VRM materials that declare MToon; non-MToon VRM materials
    fall back to gltf-shader.wgsl.
    - Keep shader selection per material, so mixed VRM models still work.
    - Implement first-pass MToon shading with the new explicit uniforms and existing shared bindings:
        - lit/shade ramp using shade color + shift/toony controls
        - emissive contribution
        - rim contribution
        - outline color/width behavior through existing inverted-hull edge path plus new MToon controls
        - transparency/cutout handling aligned with current pipeline alpha grouping
    - Do not implement full VRM render queue ordering semantics, UV animation, spring bones, expressions,
    humanoid retargeting, or first-person behavior in this slice.
- Documentation:
    - Update docs/custom-shader.md to document mtoon-shader.wgsl and the new shared material uniforms available
    to custom shaders.
    - No API spec update is needed unless new public API surface is added during implementation.

## Test Plan

- Add focused loader tests next to existing glTF loader tests, using test-data/AliciaSolid.vrm:
    - .vrm file loads through loadModelData and loadModelDataFromFile
    - loaded model has magic === 'Vrm'
    - mesh, material, texture counts are non-zero and stable
    - VRM 0.x extension is detected and stored as vrm0
    - all VRM/MToon materials are auto-assigned mtoon-shader.wgsl
    - representative transparent materials keep expected alpha mode and cull/z-write derived flags
    - representative materials retain mapped shade/emissive/outline parameters
- Add shader/pipeline tests:
    - createPipelineResources builds pipelines for mtoon-shader.wgsl
    - mixed gltf-shader.wgsl + mtoon-shader.wgsl material sets remain renderable
    - default shader fallback for non-MToon materials is unchanged
- Add material buffer tests:
    - new MToon uniform fields are written with correct defaults for non-VRM materials
    - VRM material state survives MorphController initialization and updateMaterialStateBuffers()
- Add file detection tests:
    - isModelFileName('model.vrm') === true
    - .vrm is accepted in the drag-and-drop/input flow where extension checks are explicit

## Assumptions

- Old VRM 0.x support is the priority because the provided fixture is UniVRM-0.51.0 with extensions.VRM and
materialProperties, not VRM 1.0.
- “0.x + 1.0 parse” means 1.0 extension names and internal data shape are recognized now, but rendering/behavior
is only required to be correct for the 0.x fixture in this slice.
- MToon should use explicit new uniforms in the shared material contract, not overload existing glTF metallic/
roughness fields.
- Current scope intentionally excludes humanoid metadata use, expressions, first-person, constraints, spring
bone, animation retargeting, and VRM export.