# Bone Info IK Create/Delete + Reusable IK Setup Helper

  ## Summary

  - Add 2 buttons to the Bone Info tab IK section: IK の設定 and IK を削除.
  - Extract IK creation/removal into code-facing helpers so the same logic can be called from UI now and from VRM
    load flow later.

  - Treat the selected bone as the IK chain effector/end bone. Creating IK will also create a new IK operation
    bone, attach it under a model-type-specific parent, add a matching IK entry, refresh scene state, and make the
    new IK operation bone active.

  - IK を削除 removes both the IK definition and the generated IK operation bone.

  ## Key Changes

  - index.html / source/renderer.js
      - Extend the IK UI block with:
          - IK の設定 button
          - IK を削除 button

      - Wire button enabled state from current active-bone context:
          - IK の設定: enabled only when a single active bone exists and no IK entry already targets that active
            bone as ik.boneIndex.

          - IK を削除: enabled only when the active bone is an IK operation bone with an existing IK entry.

      - On create:
          - Call the new helper.
          - Refresh selection so the newly created IK operation bone becomes the active bone.
          - Re-sync IK target select / chain count UI from the new active IK.

      - On delete:
          - Call the removal helper.
          - Move active selection back to the original effector bone that had been controlled by that IK.
          - Re-sync IK UI to the now non-IK effector state.

  - Shared IK editing helper module
      - Introduce a reusable helper in the model-side editing layer, not renderer-local, so UI and future loader
        code can call the same API.

      - Expose helpers along these lines:
          - createIkSetup(model, options):
              - input: effector/end bone index, parent policy or resolved parent, optional name override
              - output: created IK bone index, created IK entry index, effector bone index

          - removeIkSetup(model, options):
              - input: IK bone index or IK entry index
              - output: removed effector bone index and removed bone/index metadata
              - PMX/PMD: bone named 全ての親
              - VRM: actual bone mapped from humanoid hips
              - glTF: dummyBoneIndex
              - deterministic fallback if not found: first root bone (parentIndex === -1), else -1

      - Helper responsibilities:
          - Create the IK operation bone at the active effector child position:
              - use the first child bone position when a child exists
              - otherwise place it on the effector tail position / forward offset derived from the current bone
                basis

          - Default new bone orientation to local -Z
          - Name it 末端ボーン名 + IK; if duplicated, append an incrementing suffix
          - Set the new IK entry so:
              - ik.boneIndex = created operation bone
              - ik.targetBoneIndex = effector bone
              - IK Target is the operation bone itself through existing scene mapping

          - Rebuild ik.links, childBoneIndices, and chain length using the current ancestor-chain logic
          - Preserve knee limit defaults for knee links
          - Keep model.ik and model.iks aliases synchronized
          - Recompute model-side derived state that depends on bone count or order:
              - bindBones
              - custom-rig/debug bone classification caches that are regenerated from scene creation
              - any per-bone metadata required by scene creation

  - Runtime scene rebuild support
      - Because bone count changes, add an instance/scene rebuild path instead of only refreshSceneIkState().
      - Add a model-manager-level helper to recreate scene resources for an existing instance after structural
        bone edits:
          - rebuild scene via existing scene creation path
          - recreate bone matrices buffer and UI overlay buffers sized for the new bone count
          - preserve instance resources that do not depend on bone count: mesh buffers, materials, animation
            sources, visibility state

          - reset/rebind physics state for that instance as needed

      - Use full scene rebuild for create/delete; keep refreshSceneIkState() for non-structural IK edits like
        target/chain-count changes.

  ## Test Plan

  - UI structure test
      - Bone Info tab contains IK の設定 and IK を削除 in the IK section and they appear before Save VPD.

  - Helper unit tests
      - Creating IK from a PMX/PMD-like leg chain:
          - creates one new bone
          - parents it to 全ての親 when present
          - names it 対象名 + IK
          - places it at the effector child position
          - assigns local basis defaulting to -Z
          - creates an IK entry pointing at the effector
          - rebuilds links in expected order with knee constraints

      - Creating IK on a VRM model resolves parent from humanoid hips.
      - Creating IK on a glTF model resolves parent from dummyBoneIndex.
      - Duplicate names produce suffixed unique names.
      - Removing IK deletes both the IK entry and the generated operation bone and restores stable bone indices/
        parent references for the remaining model.

  - Runtime integration tests
      - After create, the active bone becomes the new IK operation bone and scene.ikChains / scene.ikTargets
        reflect the new setup.

      - After delete, the active bone returns to the original effector and IK UI disables appropriately.
      - Existing IK target-bone select and chain-count editing still work after creating a new IK.
      - Models without the preferred default parent fall back to the first root bone without crashing.

  ## Assumptions

  - New IK operation bone name uses 末端ボーン名 + IK; duplicates are resolved by suffixing.
  - IK を削除 removes both the IK definition and the operation bone created by this feature.
  - This task only extracts a reusable helper for future VRM-load use; it does not yet auto-apply IK during VRM
    import.

  - If the effector has no child, placement falls back to the effector tail / basis-derived forward offset so the
    new IK bone is still created deterministically.