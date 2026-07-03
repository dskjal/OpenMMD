# glTF 2.0 Animation-Ready Refactor Plan

## Summary

- Refactor the current VMD-centric animation runtime into a generic clip/channel/sampler system aligned to glTF
2.0 animation semantics: channel targets are translation, rotation, scale, and weights; sampler time is
seconds; interpolation kinds are LINEAR, STEP, and CUBICSPLINE.
- Keep public behavior VMD-first for now: no new loader, no public API rename, no file-format expansion. VMD
becomes one import/export adapter over the generic animation model.
- Add VMD export warnings for data that cannot be represented in VMD. Export continues, shows UI warning plus
console.warn, and resamples supported-but-non-VMD interpolation at 30 fps before writing.
- Include full edit support for scale in the internal/editor stack now, and make the runtime structure full
node-ready for future glTF loader work.

## Key Changes

- Introduce a generic animation data model, likely in a new module, with JSDoc typedefs for:
    - AnimationClip
    - AnimationChannel
    - AnimationSampler
    - AnimationTarget
    - AnimationKeyframeWarning
- Animation model rules:
    - clip-local time unit is seconds
    - targets support node TRS plus morph weights
    - target addressing is node-ready, not bone-name-only
    - one target/path per clip is enforced to match glTF 2.0 constraints
- Add a runtime target resolver layer:
    - resolve animation targets to current OpenMMD runtime objects
    - support bone translation/rotation/scale, morph weights, camera/light/shadow as non-glTF extension targets
    in the internal schema
    - allow node-ready target descriptors even if current application mostly resolves to bones/morphs
- Refactor source/animation.js:
    - rename internals from VMD-specific caches/maps to generic channel caches
    - replace setVmd with a generic clip setter internally, while keeping a compatibility adapter so existing
    callers continue to work
    - evaluate samplers by interpolation kind
    - preserve current manual-transform invalidation behavior
    - add scale application path to bone local transforms and dirty propagation
- Refactor timeline/editor plumbing:
    - separate “editable animation document” from raw VMD object
    - replace direct mutation of boneKeyframes / faceKeyframes / cameraKeyframes arrays in timeline code with
    generic channel upsert/delete helpers
    - extend timeline track generation to include scale tracks and generic animation track metadata
    - keep existing VMD-oriented UI labels for now
- Add format adapters:
    - VMD import adapter: normalize current VMD structure into generic clips
    - VMD export adapter: serialize generic clips back to VMD data
    - camera/light/shadow remain VMD-only internal channel kinds, outside glTF core target paths
- VMD export warning policy:
    - warn and skip channels VMD cannot encode, including at minimum:
        - scale
        - non-bone node translation / rotation
        - node weights that cannot be mapped to OpenMMD morphs
        - any future unsupported target kind
    - warn and resample supported channels when interpolation is VMD-incompatible:
        - STEP
        - CUBICSPLINE
        - any future non-VMD interpolation
    - warning result shape should include machine-readable entries and user-facing grouped text
    - VMDManager.download() / save UI should surface one summary message and mirror details to console.warn
- Keep VMD compatibility shims during the refactor:
    - existing call sites may still pass loaded VMD data
    - adapters should maintain support for aliases like motions / morphs / faces until the codebase is fully
    migrated
- Update docs that describe animation architecture and save behavior:
    - animation-related internal/spec docs
    - API spec docs only if any externally visible command payloads or behavior actually change
- Relevant glTF references used for the plan:
    - glTF 2.0 Specification (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
    - KhronosGroup/glTF specification/2.0 (https://github.com/KhronosGroup/glTF/tree/main/specification/2.0)

## Important Interface Changes

- Internal only, no public rename in this pass.
- Add generic internal methods/helpers such as:
    - setAnimationClip(...)
    - createEmptyAnimationClip(...)
    - generic upsert...ChannelKeyframe(...) helpers
    - generic delete/filter helpers for selected keyframes
- Keep compatibility entry points temporarily:
    - setVmd(...) becomes adapter-backed
    - createEmptyVmd(...) becomes VMD-export/import helper, not the canonical runtime shape
- Extend bone local transform state to carry scale if not already present end-to-end, and ensure recompute/dirty
logic respects it.

## Test Plan

- Runtime:
    - generic clip playback still preserves existing bone rotation/translation behavior
    - morph playback still works
    - manual overrides still reset on frame/key changes as before
    - scale keys affect pose correctly and dirty flags propagate
    - backward seek, loop, and playback-range behavior still work after refactor
- Timeline/editor:
    - keyframe insert/update/delete works through generic clip helpers
    - scale tracks appear, can be edited, and affect runtime
    - existing bone/morph/camera key editing remains functional
- VMD adapter/export:
    - VMD roundtrip still passes for supported data
    - export warns and skips unsupported keys
    - export warns and resamples non-VMD interpolation at 30 fps
    - warnings are surfaced in UI and console.warn
    - export output remains valid when warnings are present
- Compatibility:
    - existing tests using raw VMD-shaped fixtures continue to pass through the compatibility adapter
    - camera/light/shadow VMD features remain intact

## Assumptions And Defaults

- Public commands, file names, and UI wording stay VMD-oriented in this pass.
- glTF core animation support target is limited to translation, rotation, scale, and weights, with seconds-based
samplers and glTF interpolation semantics.
- Internal schema is node-ready now, even though no glTF animation loader is implemented yet.
- Unsupported VMD export data is non-fatal.
- Warning surface is UI plus console.warn.
- Non-VMD interpolation is exported by 30 fps resampling, not by silent coercion.