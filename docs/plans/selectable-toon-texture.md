# Material Toon Texture Editing

## Summary

- Add toon texture editing to the Material tab with a clickable thumbnail beside the toon label.
- Clicking the thumbnail opens a toon texture picker dialog and applies the chosen toon texture to all currently
selected materials.
- Build the picker list in this exact order:
    1. toon textures from the active model
    2. toon textures from other loaded models
    3. default toon-textures/toon01.bmp to toon10.bmp
- When a material changes from “no toon texture” to a valid toon texture, update both the toon binding and
hasToonTexture.

## Implementation Changes

- UI
    - Extend index.html Material tab with a Toon Texture row, thumbnail button, and picker overlay/dialog.
    - Reuse the existing texture-card / texture-preview visual pattern so the picker uses the same thumbnail
    language as the Texture tab.
    - In mixed-selection state, show a mixed placeholder on the thumbnail; clicking still opens the picker and
- Toon candidate model
    - Add a toon candidate collector in source/material-resources.js that resolves previewable toon sources and
    returns stable descriptors.
    - Candidate groups:
        - Active model: dedupe by resolved toon source, including local model toon textures and current-model
        toon-resolvable assets.
        - Other models: same resolution, grouped after active model entries.
        - Internal defaults: fixed 10 shared toon textures.
    - Each candidate descriptor should include enough data to:
        - render a preview thumbnail
        - show a label
        - rebind the selected toon texture later
        - serialize into Material JSON
- Runtime material data / rebinding
    - Add a runtime toon override on each material, checked before legacy toonMode / toonIndex resolution.
    - Use a normalized descriptor shape for overrides:
        - kind: 'model-texture' | 'internal'
        - for model textures: sourceModelName, sourceModelPath, texturePath
        - for internal textures: toonIndex
    - Extend toon loading so override resolution supports:
        - active-model textures
        - textures originating from another loaded model
        - internal default toon textures
    - Add a ModelManager async method for toon reassignment that:
        - updates selected model.materials[index]
        - updates any runtime toon override metadata
        - recreates the affected material bind groups / toon bindings
        - updates pipelineResources.materials[index].hasToonTexture
        - rewrites the material uniform buffer
    - Keep existing legacy PMD/PMX toon semantics as fallback when no override exists.
- Material tab state sync
    - Extend source/renderer.js Material tab state collection and syncMaterialTabUi() to:
        - resolve the currently displayed toon thumbnail
        - show placeholder when none exists
        - show mixed state for differing selected materials
        - wire picker open/close and selection apply flow
    - Refresh the scene after successful toon reassignment.
- Material JSON and docs
    - Add toon texture persistence to source/material-json.js.
    - Export/import a new material field such as material-toon-texture using the normalized descriptor shape
    above.
    - Import behavior:
        - internal toon descriptors always resolve
        - model texture descriptors resolve by exact model-name / path match against currently loaded models
        - if an external model texture source cannot be resolved, skip that toon change for that material and
        leave the current toon unchanged
    - Update:
        - docs/specification/api-specification.md
        - docs/specification/api-specification-ja.md
        - test-data/material.json

## Test Plan

- Add unit coverage for toon candidate collection:
    - active model candidates appear before other-model candidates
    - default internal toon textures always appear last
    - duplicate resolved toon sources are collapsed
- Add Material tab / renderer logic tests for:
    - thumbnail state with one selected material
    - mixed thumbnail state with multiple selected materials
    - picker selection applying to all selected materials
- Add material resource / manager tests for:
    - switching from no toon texture to a valid toon texture sets hasToonTexture
    - bind group / toon resource is replaced for affected materials
    - internal toon and other-model toon both resolve correctly
- Extend Material JSON tests for:
    - export includes the toon descriptor field
    - import reapplies internal toon textures
    - unresolved external-model toon descriptors are skipped safely
    - test-data/material.json stays in sync with exporter output

## Assumptions

- Multi-selection behavior follows the existing Material tab pattern: one picked toon texture is applied to all
selected materials.
- This change does not add toon clearing/removal UI.
- Existing PMD/PMX loader behavior and saved model data remain unchanged; the new toon selection is an editor/
runtime override layered on top.