# Global Timeline Synchronization

  ## Summary

  - Add one shared timeline state for the whole viewer and use it to drive every model instance.
  - Keep model-specific animation sources, clips, and keyframes independent, but make currentFrame, play/pause,
    seek, step, rewind, go-to-end, and playback range global.

  - Preserve the existing active-model editing workflow for the timeline UI; only the time base becomes shared.

  ## Key Changes

  - Move timeline ownership into TimelineManager as the source of truth for currentFrame, isPlaying, and shared
    playback range.

  - Broadcast timeline actions to every loaded instance instead of only the active instance, so all
    animationControllers stay aligned to the same frame and range.

  - Keep AnimationController as the evaluator for per-model clips, but stop treating each instance as an
    independent timeline source of truth.

  - Update the frame update path so the shared frame is applied before animation sampling, preventing per-model
    drift while preserving each model’s own animation data.

  - Switch runtime consumers to the shared timeline state: timeline playhead UI, BGM sync, API get-state, render-
    loop frame-dependent effects, and video export snapshot/seeking.

  - Update docs/specification/api-specification.md and docs/specification/api-specification-ja.md, plus the
    OpenMMD animation/timeline spec notes, because the externally visible state now reports a global frame and
    global playback range.

  ## Test Plan

  - Add a timeline-manager test that loads multiple instances and verifies seek, step, rewind, go-to-end, and
    play/pause keep every controller on the same frame.

  - Add a regression test that switching the active model does not reset the shared frame or range.
  - Update API state/control-flow coverage so get-state.currentFrame and playbackRange come from the global
    timeline, not the active model only.

  - Add a regression around video export and BGM sync to confirm they use the shared playhead and shared range.
  - Keep existing per-model animation sampling tests passing to prove the synchronization layer did not change
    clip evaluation semantics.

  ## Assumptions

  - Playback range is shared globally and editable once for the whole viewer, not per model.
  - The default shared range is based on the longest loaded source, unless the user overrides it.
  - Per-model clips and keyframes remain independent; only time state is overridden globally.
  - No file format changes are required.