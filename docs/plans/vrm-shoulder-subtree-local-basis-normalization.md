## VRM 0.x Shoulder-Subtree Local Basis Normalization

  ### Summary

  - Change VRM 0.x load-time bone basis normalization so the resolved leftShoulder subtree keeps +Y up and the
    resolved rightShoulder subtree uses -Y up by applying a 180 degree rotation around local X.

  - Keep VRM 1.0 behavior unchanged.
  - Keep VMD retarget basis correction aligned with the loaded runtime basis so right-arm VMD mapping does not
    drift after the loader change.

  - Update regression tests and the local spec text to match the new VRM 0.x rule.

  ### Implementation Changes

  - In the VRM load/normalization path (source/loader/gltf-loader.js or the VRM-specific postprocess reached from
    source/loader/vrm-loader.js), add a VRM 0.x-only pass that:
      - resolves the actual bone indices for leftShoulder and rightShoulder from model.vrm.humanoidBoneNameMap
      - walks each root’s actual model-hierarchy descendants, including the root itself
      - leaves the left subtree basis unchanged
      - rotates every bone basis in the right subtree by 180 degrees around local X by rewriting localY/localZ to
        their negated values while preserving localX

  - Scope that pass to the literal shoulder-rooted hierarchy, not just the canonical humanoid chain. This matches
    the request wording of “leftShoulder 以降の子 / rightShoulder 以降の子”.

  - In source/animation-mapper.js, make VMD-to-VRM arm target basis resolution version-aware:
      - for VRM 0.x shoulder/arm/hand descendants, derive the target basis from the loaded bone basis instead of
        the current hard-coded symmetric +Y assumption

      - for VRM 1.0, keep the current humanoid-name semantic handling

  - Do not change the VRMA semantic basis rules unless required by a concrete failing test; the loader/rest-
    rotation change should be the primary source of truth for runtime basis.

  ### Tests

  - Add/extend a loader regression in tests/gltf-loader.test.mjs that asserts for AliciaSolid.vrm:
      - leftShoulder, leftUpperArm, leftLowerArm, leftHand keep localY=[0,1,0]
      - rightShoulder, rightUpperArm, rightLowerArm, rightHand become localY=[0,-1,0]
      - at least one right-side finger descendant also reflects the same X-180 basis flip

  - Update VMD arm regression expectations in tests/alicia-vmd-arm-rotation-regression.test.mjs:
      - right-side arm-chain basisCorrectionQuaternion values should reflect the X-180 target basis
      - refresh resulting right-side local rotation quaternion snapshots after the runtime basis change

  - Update unit coverage in tests/animation-mapper.test.mjs so right-side VRM arm/hand mappings no longer assume
    identity correction under VRM 0.x.

  - Re-run and refresh tests/alicia-vrma-arm-rotation-regression.test.mjs expectations where target rest rotations
    or applied right-arm local rotations change because the runtime basis changed.

  ### Assumptions

  - “初期ローカル回転軸” means the loaded runtime bone basis (localX/localY/localZ), not only the VMD retarget
    helper.

  - “rightShoulder 以降の子” means all actual descendants in the model bone hierarchy rooted at the resolved
    rightShoulder, including fingers and any intermediate non-humanoid arm bones.

  - Existing user changes already present in source/animation-mapper.js and the arm-related test files must be
    preserved and merged with, not reverted.

  ### Docs

  - Update the VRM 0.x local-axis description in docs/openmmd-specification.md so it no longer states a fully
    uniform world-axis match for both shoulder subtrees.