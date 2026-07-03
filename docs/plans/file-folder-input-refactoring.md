# Folder/ZIP/Direct File Drop Load Path Refactor

  ## Summary

  - Consolidate the duplicated load-path logic now split across index.html inline code for folder drop, ZIP
    archive load, and direct file load.

  - Extract the orchestration into a new source/ module so the classification and dispatch rules live in one place
    and index.html becomes a thin event/UI shell.

  - Preserve current behavior for model candidates, pending JSON/VPD application, HDR candidates, shader bundle
    loading, and BGM candidate registration.

  ## Key Changes

  - Add a new module under source/ for drop/load orchestration.
      - Recommended name: source/drop-file-loader.js
      - Responsibility: normalize a batch of incoming files plus optional directory-backed zipFiles, classify
        them, and execute the shared load flow.

  - Move these duplicated behaviors out of index.html into the new module:
      - File classification for audio/HDR/JSON/WGSL/model/VPD/ZIP/other
      - ZIP inspection and candidate extraction
      - Model-candidate construction for ZIP archives
      - “single model loads immediately / multiple models go to candidate UI” branching
      - pending settings / pending pose staging and later consumption
  - Keep source/file-loading.js focused on low-level helpers, but extend it where needed for reusable data
    extraction helpers instead of repeating archive scanning in index.html.
      - Reuse collectModelCandidatesFromZipFiles
      - Reuse collectHdrFilesFromZipFiles
      - Reuse collectUiSettingsFilesFromZipFiles
      - Add small helpers only if they remove repeated archive-to-candidate conversion cleanly

  - Simplify index.html to:
      - call collectDroppedFiles on drop
      - hand the result to the new shared loader module
      - keep only UI-specific glue such as drag overlay visibility and global pending-file setters if those are
        still window-facing

  - Unify direct ZIP-file handling with folder-style drop handling.
      - ZIP file input should go through the same batch planner/executor as folder drop
      - single-file direct drops should go through the same per-file dispatcher as non-drop file input

  - Keep the existing VRM special case intact.
      - If a ZIP/folder candidate is a single VRM and shouldLoadZipModelCandidateAsFile() is true, continue
        loading it through the file path via createFileFromZipModelCandidate()

  ## Public Interfaces

  - Add one internal orchestration API exported from the new module, decision-complete shape:
      - createDroppedFileLoader(deps) returns an object with:
          - processDroppedData(dropped)
          - processFileBatch(files, zipFiles = null)
          - handleFile(file, zipFiles = null)

  - deps should explicitly inject current window-coupled actions instead of hard-coding globals:
      - loadModelFile
      - loadZipModel
      - loadVmd
      - loadVpd
      - loadEnvironmentHdrFile
      - setEnvironmentHdrCandidateFiles
      - setModelCandidateFiles
      - setPendingSettingsFiles
      - setPendingPoseFiles
      - consumePendingSettingsFiles
      - bgmManager
      - shaderManager
      - modelManager
      - syncMaterialTabUi
      - refreshScene
      - loadUiSettingsFile
      - parseUiSettingsJsonText
      - loadModelSettingsFile

  - Do not change the existing window API names consumed elsewhere; wrap them through the new module so
    compatibility stays unchanged.

  ## Test Plan

  - Update or add tests for the shared orchestration module covering:
      - folder drop with one model, one JSON, one VPD
      - folder drop with multiple models and staged JSON/VPD
      - direct ZIP file with one model
      - direct ZIP file with multiple models
      - single VRM inside folder/ZIP uses file-based model load path
      - audio-only drop chooses loadFile vs setCandidateFiles
      - HDR-only batch chooses immediate load vs candidate list
      - shader files and ZIP shader bundles both route through the same shader loader path
      - unsupported files still fall through to JSON parse attempt / ignore behavior

  - Keep existing tests in tests/file-loading-*.test.mjs and extend them only where low-level helpers change.
  - Add focused regression tests for the new module rather than pushing more orchestration assertions into
    index.html-coupled tests.

  ## Assumptions

  - No user-visible behavior change is intended; this is a structural refactor with compatibility preservation.
  - index.html may keep minimal state ownership for drag overlay and global pending arrays if moving those would
    widen scope unnecessarily.

  - JSDoc style will be kept for all added or moved functions.
  - No API documentation update is needed unless a true external API surface changes; this refactor should remain
    internal.