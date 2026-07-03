# glTF 2.0 Animation Load / Playback / Edit / GLB Save

## Summary

- Extend glTF loading so GLTFModelLoader returns both the converted model and embedded animation clip metadata,
then auto-register each glTF clip into the same animation source flow currently used by VMD.
- Treat glTF animations as first-class editable timeline sources: selectable from the existing Loaded Animations
UI, playable through AnimationController.setAnimationClip(), visible in the timeline, editable for bone
translation / rotation / scale and morph weights, and savable back to .glb.
- Limit glTF save scope to .glb only, preserving the original asset and replacing only the animation payload
plus any edited animation-related metadata needed to rebuild it.

## Implementation Changes

- source/loader/gltf-loader.js
    - Preserve enough original GLB parse context to support later animation-only rewrite: original JSON, BIN
    chunk, animation/node mapping, clip names, interpolation, and morph target layout.
    - Return loader output as { model, animationSources, gltfAssetContext } instead of model-only for glTF
    inputs; non-glTF loaders stay as-is.
- source/model-scene.js
    - Thread glTF animation source metadata through loadModelData*() finalization without scaling or mutating
    clip timing.
    - Attach normalized runtime fields on the model or returned payload so instance creation can register
    embedded clips immediately.
- source/timeline-data.js and timeline plumbing
    - Generalize createTracksFromVmd() into clip-aware track generation from generic animation clips.
    - Emit timeline tracks for bone TRS and morph weights; non-bone node channels remain loaded and preserved
    for save, but are hidden from edit UI.
    - Keep display-frame grouping when the target maps to model bones/morphs; unmatched animated names fall into
    Other.
- source/timeline-manager.js
    - Introduce source-type aware assignment, e.g. VMD source vs glTF clip source, instead of only
    assignVmdToActiveInstance().
    - Store active animation source metadata on the instance: source kind, source name, clip id, editable
    document, and original glTF context if applicable.
    - Route playback through setVmd() for VMD sources and setAnimationClip() for glTF sources.
    - On key insert/delete/edit, mutate the active generic clip directly for glTF sources while preserving VMD
    behavior unchanged.
    - Extend registration paths so bone key insertion updates TRS channels, including scale if a scale track
    already exists or if a scale key is explicitly created by the glTF path.
- source/renderer-ui.js and index.html
    - Replace the VMD-only loaded animation list with a unified animation-source list containing both VMDs and
    glTF clips, with clear type labeling.
    - Keep clip selection in the existing animation panel; selecting a glTF clip assigns it to the active model
    exactly like VMD assignment today.
    - Make the save control context-sensitive:
        - VMD source: current VMD save behavior.
        - glTF source: export .glb with only animations replaced.
    - Update labels from VMD-specific wording where necessary so the UI still reads correctly in ja/en.
- GLB export path
    - Add a glTF animation writer module that rebuilds the GLB JSON/BIN using the preserved original asset
    context.
    - Rewrite only animations, related bufferViews/accessors, and any clip-name references needed by the edited
    animation set.
    - Keep scene/mesh/material/skin/node structure intact; do not attempt full semantic re-export.
    - Preserve original interpolations where possible; write edited bone/morph channels back as glTF LINEAR /
    STEP / CUBICSPLINE according to internal sampler data.
- Docs
    - Update docs/openmmd-specification.md to document glTF animation loading, unified animation sources,
    editable scope, and GLB-only save behavior.
    - If any external API surface is added for clip assignment or save, also update docs/specification/api-
    specification.md and docs/specification/api-specification-ja.md; otherwise leave API docs unchanged.

## Test Plan

- Extend tests/gltf-loader.test.mjs
    - armature-animation-test.glb loads at least one animation clip.
    - Clip channels map to expected bone names and keyframe counts.
    - Interpolation and duration are preserved from the source asset.
- Add timeline/source integration tests
    - A loaded glTF clip can be assigned to an instance and plays through AnimationController.
    - Timeline source rebuild shows bone/morph tracks for a glTF clip.
    - Selecting between VMD and glTF sources on the same model switches playback correctly.
- Add editing tests
    - Bone translation/rotation/scale key insert updates the active glTF clip.
    - Morph key insert updates the active glTF clip.
    - Key deletion updates the active glTF clip without breaking playback range/max frame.
- Add GLB save tests
    - Saving an unmodified loaded glTF clip produces a valid .glb with the same non-animation scene structure.
    - Saving an edited clip rewrites only animation-related sections and reloading the exported .glb reproduces
    the edited motion.
    - Non-editable non-bone node channels survive a load-edit-save roundtrip unchanged.
- Regression tests
    - Existing VMD loading, assignment, timeline editing, and save tests remain green.
    - Generic scale-channel playback tests continue to pass.

## Assumptions

- Output support is .glb only for this feature.
- Multiple embedded glTF clips are supported and shown in the unified Loaded Animations UI by name.
- Active glTF clips are editable in-memory and saved back into a GLB; they are not converted to VMD by default.
- Editable glTF timeline scope is limited to model-mapped bone TRS and morph weights.
- Non-bone node animations are preserved on save but not exposed in the editing UI for this iteration.