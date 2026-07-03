# SDR/HDR Display Preset for Shortcut Panel

## Summary

Add a new preset selector under the shortcut panel’s existing Display section. The selector will switch between
SDR and HDR, persist the choice in a cookie, apply the preset through the existing UI-settings JSON path, and
update both the renderer state and all loaded MMD models.

## Key Changes

- Add a display-preset-selector select box in index.html under the shortcut panel Display group.
- Extend source/ui-settings-loader.js so UI JSON can set the new preset selector alongside the existing view-
transform-selector and numeric controls.
- Introduce a small preset utility layer in source/renderer.js or a dedicated helper module that:
    - normalizes sdr / hdr
    - reads and writes the preset cookie
    - maps the preset to the required UI settings
    - applies the UI settings by calling the existing JSON-driven UI settings flow
- Wire preset application to renderer startup before the shader manager default is queried and before gamma/
post-effect resources are built, so the first loaded model uses the correct preset.
- Add a configurable default MMD shader in CustomShaderManager so newly loaded MMD models default to:
    - mmd-shader.wgsl for SDR
    - mmd-shader-hdr.wgsl for HDR
- When the preset changes, update already-loaded instances by rewriting MMD-default materials to the target
shader and rebuilding the affected pipelines. Do not touch custom non-MMD shader assignments.
- Keep the UI state consistent after preset changes by refreshing the render/post-effect UI and the material
tab.

## Preset Rules

- SDR:
    - view transform: standard
    - default MMD shader: MMD Shader
    - gamma: 1.0
    - gltf light strength: 1.0
    - shadow power: 1.0
- HDR:
    - view transform: ACES 2.0
    - default MMD shader: MMD Shader HDR
    - gamma: 0.3
    - gltf light strength: 2.0 when current value is 1.0 or below
    - shadow power: 2.5 when current value is 1.0

## Test Plan

- Extend tests/ui-settings-loader.test.mjs to cover the new display-preset-selector field in JSON-driven UI
application.
- Extend tests/custom-shader-manager.test.mjs to verify the default MMD shader can be switched from SDR to HDR
without affecting glTF defaults.
- Add a focused preset/cookie test for:
    - defaulting to SDR when no cookie exists
    - restoring the saved preset from cookie
    - serializing the preset back to cookie on change
- Add a preset application test for loaded-model shader reassignment, using a fake model manager to verify only
MMD-default materials are rewritten.

## Assumptions

- The cookie stores only the preset choice, not per-control custom tuning.
- Display in the shortcut panel is the intended insertion point; no separate render-tab control is added.
- displayColorSpace is unchanged by the preset because it is not part of the requested SDR/HDR mapping.
- The current loadUiSettingsFile flow is the right mechanism for applying the preset’s UI values, so the new
preset should reuse that path instead of manually setting each control.