
# material.json Companion WGSL 自動適用修正

## Summary

models/miku/material.json が参照している同階層の mmd-shader-hdr-ao.wgsl を、folder/zip で読み込んだときに先に自
動登録してから material.json を適用するようにします。これで material-shader-select が内部 shader 名へ正しく解決
されます。

## 変更内容

- source/file-loading.js
    - material.json の読み込み時に companion shader を探せるよう、ZIP/フォルダ内の WGSL を列挙・抽出する共通ヘル
    パーを追加します。
    - models/miku/material.json と同じ親ディレクトリの mmd-shader-hdr-ao.wgsl を見つけられるように、相対パス単位
    で lookup できる形にします。
- index.html
    - material.json を適用する前に、同じ zipFiles から companion WGSL を先に shaderManager へ登録します。
    - その後に loadMaterialSettingsFile() を呼び、shaderDefinitions に companion を含めた状態で material-shader-
    select を解決します。
    - folder/zip 以外の単体ファイルピッカーは現状維持にします。path 情報がないため自動解決対象外です。
- source/material-json.js
    - shader 名の解決は既存の名前/ラベル解決を維持しつつ、companion shader が事前登録されている前提で確実に内部
    名へ寄せます。
    - 必要なら companion 未発見時の挙動は従来通りのフォールバックに留めます。

## Test Plan

- models/miku/ を使って、material.json と mmd-shader-hdr-ao.wgsl を同一フォルダに含むケースを追加します。
- 以下を確認します。
    - folder/zip ドロップ時に companion WGSL が先に登録される
    - material.json の cloth.material-shader-select が mmd-shader-hdr-ao.wgsl を正しく内部 shader 名へ解決する
    - companion がない場合は既存のフォールバック挙動を壊さない
    - 既存の MMD Shader HDR 系マテリアルは従来通り維持される

## Assumptions

- 自動適用対象は folder/zip のみとし、単体の file picker は変更しません。
- material.json は companion WGSL を「自動登録済み shader 定義」として参照するだけで、material JSON 自体のフォー
マットは変えません。
- API 追加は行わないため、docs/specification/api-specification.md と docs/specification/api-specification-ja.md
は更新しません。

# WGSL Drag-and-Drop Support

## Summary

- Extend the global drag-and-drop flow so it accepts:
    - a single .wgsl file
    - a dropped folder containing shaders
    - a .zip containing shaders
- Treat loaded shaders as session-scoped additions to the shader list only. Do not auto-apply them to materials.
- Support two archive layouts:
    - manifest.json present: use it as the source of truth
    - no manifest: auto-register every .wgsl found in the dropped folder or ZIP
- Use models/miku/ as the folder-style test fixture for dropped-directory coverage.

## Key Changes

- In /D:/data/program/openmmd/source/custom-shader-manager.js:
    - Add an external shader registration API for session-only definitions and source text.
    - Keep built-in manifest/template loading intact, but merge built-in and externally registered definitions
    in getShaderDefinitions() / getShaderDefinition().
    - Resolve shader bodies from in-memory dropped content before falling back to fetch(entryPath).
    - Add a bulk loader for dropped inputs that accepts either:
        - File[] for single .wgsl
        - ZIP-like zipFiles maps from dropped folders / ZIP archives
    - For manifest-less bundles, synthesize definitions with:
        - name: dropped relative path basename unless duplicated, then use relative path
        - label: same as name
        - entryPath: synthetic session path only for identity/debugging
        - defaultFor: []
    - Reject non-WGSL entries and __MACOSX paths.
- In /D:/data/program/openmmd/source/file-loading.js:
    - Add shader-oriented helpers alongside the existing model/HDR/audio helpers:
        - .wgsl filename detection
        - dropped ZIP/folder shader discovery
        - manifest extraction from ZIP-like inputs
        - conversion of ZIP entries to File/text where needed
    - Keep helpers generic so index.html only coordinates routing.
- In /D:/data/program/openmmd/index.html:
    - Update the global drop-zone text and file input accept list to include .wgsl.
    - Extend processFileBatch() / handleFile() so shader inputs are routed before “other files” are ignored.
    - For a single .wgsl, call the new shader-manager loader directly.
    - For folder drops and .zip, inspect contents:
        - if they contain model content, preserve current model-loading behavior
        - if they contain shader content, load shaders into the session list
        - if they contain both, load both in one pass
    - After successful shader registration, refresh the Material tab shader select without mutating current
    material assignments.

## Test Plan

- Add CustomShaderManager tests for:
    - registering one external .wgsl
    - registering multiple shaders from a manifest-less bundle
    - manifest-driven external bundle registration
    - duplicate-name disambiguation
    - reloadShader() using updated in-memory source
- Add file-loading helper tests for:
    - .wgsl detection
    - shader discovery from ZIP-like folder maps
    - manifest extraction from ZIP-like folder maps
    - ignoring __MACOSX and non-WGSL files
- Add drag/drop flow tests around the batch-routing logic to verify:
    - single .wgsl is loaded as shader content
    - shader ZIP loads shader definitions without invoking model loading
    - mixed archive still preserves model flow
    - folder-style shader input works with models/miku/ as fixture shape

## Assumptions

- Loaded shaders are temporary for the current browser session; no repo files are written and no manifest is
persisted.
- Dropped WGSL continues to use the existing common template injection model; the dropped file is still the
fs_main body, not a full standalone pipeline shader.
- No API command changes are required, so docs/specification/api-specification*.md stay unchanged.