# Bone Info IK Axis Lock

  ## Summary

  - Add per-bone ikRotationLocks state and expose it in the Bone Info tab's IK section as X/Y/Z axis lock
    controls.

  - ikRotationLocks only affects rotations applied by ik.js; direct/manual bone rotation and existing gizmo
    behavior continue to use only rotationLocks.

  - Persist ikRotationLocks in model.json under a new bone array section. No PMD/PMX/VRM loader changes.

  ## Key Changes

  - UI

      - Keep existing IK setup controls (enabled, target bone, chain count, iteration, create/delete) tied to
        actual IK entries.

      - Make the new IK lock controls available for any selected bone; disable them only when no active bone
        exists.

      - Reuse the existing lock icon language/pattern so the new controls behave like the normal rotation lock UI.

  - Bone/model state
      - Add bone.ikRotationLocks = { x, y, z } as runtime model state, defaulting to all false.
      - Initialize it for loaded bones and runtime-generated IK bones in /D:/data/program/openmmd/source/model-
        scene.js.

      - Add small helper(s) parallel to the existing rotation-lock helpers in /D:/data/program/openmmd/source/
        renderer.js to read/write normalized IK lock state.

  - IK solver behavior
      - Update /D:/data/program/openmmd/source/ik.js so IK-applied rotation respects the effective lock set:
        effectiveIkLocks = rotationLocks OR ikRotationLocks

      - Apply that effective lock set anywhere the solver currently infers available axes from bone.rotationLocks,
        including the single-axis projection path.

      - Do not change non-IK rotation paths such as manual input, world/local setters, or gizmo ring visibility.

  - model.json persistence
      - Extend /D:/data/program/openmmd/source/model-json.js and /D:/data/program/openmmd/test-data/model.json
        with:

        "bone": [
          {
            "bone-index": 6,
            "bone-name": "右ひじ",
            "ik-rotation-lock-x": 1,
            "ik-rotation-lock-y": 0,
            "ik-rotation-lock-z": 1
          }
        ]

      - Export only bones whose ikRotationLocks contain at least one true.
      - Import matching rule:
          1. Use bone-index if valid and the referenced bone name matches bone-name when present.
          2. Otherwise fall back to the first same-name bone not already matched in this import pass.
          3. Skip unmatched entries silently.

      - Do not add normal rotationLocks to model.json in this task.

  ## Test Plan

  - Markup/UI tests
      - Bone Info IK section contains the three IK lock controls.
      - IK lock controls are present independently of the existing IK-entry-only controls.

  - Solver tests
      - IK-only lock on a bone blocks solver rotation on the locked axes while leaving manual rotation unaffected.
      - Effective lock composition works: normal lock or IK lock on an axis both prevent IK from using that axis.
      - Existing elbow/knee preferred-axis behavior still works when exactly one effective IK axis remains
        unlocked.

  - Model/scene tests
      - Bone initialization gives ikRotationLocks: { x: false, y: false, z: false }.
      - Runtime-generated IK bones also initialize that field.

  - model.json tests
      - buildModelSettingsJson() exports the new bone array shape.
      - Loading model.json restores ikRotationLocks.
      - Duplicate-name fallback behavior is covered with multiple bones sharing the same name.
      - Existing material-only model.json fixtures still load unchanged.

  ## Assumptions

  - ikRotationLocks is a per-bone state, not an IK-entry state.
  - IK lock UI lives inside the IK section but edits the currently selected bone, even when that bone has no IK
    entry.

  - This task does not add PMD/PMX/VRM file-format support and does not update API specification docs because no
    external API surface is added.