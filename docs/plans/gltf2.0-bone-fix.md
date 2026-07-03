# glTF Bone001 Collapse Fix

## Summary

- Fix armature-animation-test.glb so Bone001 keeps its correct position and is no longer collapsed by the
trailing _leaf helper bone.
- The loader should preserve the bone chain in model space: Bone at [0,0,0], Bone001 at [0,1,0], and _leaf at
[0,2,0].

## Key Changes

- source/loader/gltf-loader.js
    - Restore bone position extraction to world-space bone coordinates for glTF bones, not the current local-
    only value.
    - Keep the extra _leaf bone in the hierarchy, but let it act only as the terminal helper needed by external
    tools.
    - Leave tailIndex / tailOffset generation intact so Bone001 points to _leaf and the chain stays visible.
- tests/gltf-loader.test.mjs
    - Update the regression to assert the real hierarchy and positions:
        - Bone001 is [0,1,0]
        - Bone001_leaf is [0,2,0]
        - Bone001 uses _leaf as its tail target
    - Keep the existing skinning and animation-source assertions.

## Test Plan

- Run tests/gltf-loader.test.mjs and confirm:
    - Bone001 no longer collapses.
    - _leaf remains as the terminal helper bone.
    - Skinning and animation-source loading still work.
- Re-run the broader animation/timeline tests if the loader change touches shared model state.

## Assumptions

- The _leaf bone is intentionally kept for tool compatibility and should not be stripped.
- The correct fix is to preserve the bone hierarchy, not to special-case _leaf out of the model.
- Only the glTF loader path is affected; PMX / PMD behavior remains unchanged.