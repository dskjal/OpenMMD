# material.json から model.json への移行計画

  ## Summary

  - 既存の Material JSON 専用経路を type: "model" の model.json へ置き換える。
  - 今回対応するのは model.json 内の material セクションのみとし、他セクションの save/load は実装しない。
  - 後方互換は持たせず、旧 type: "material"、旧トップレベル material エントリ列挙、旧 .material.json 命名は削除す
  ## Implementation Changes

  - source/material-json.js を source/model-json.js へ改名し、公開関数名も buildModelSettingsJson /
    loadModelSettingsFile / applyModelSettingsJsonData / parseModelSettingsJsonText の系統へ統一する。

  - JSON 形式を次に固定する。

    {
      "type": "model",
      "model-name": "初音ミク",
      "material": {
        "cloth": {
          "...": "..."
        }
      }
    }

  - material セクションを必須の material 設定コンテナとして扱い、material 名の列挙・shader 収集・適用対象解決はす
    べて data.material 配下を見る実装に変更する。

  - save は現在のマテリアル状態だけを material セクションへ書き出す。material 以外のモデル情報は今回出力しない。
  - load は type !== "model" を即 reject し、type === "model" でも material が object でない場合は unsupported-
    type ではなく専用の skip reason を返すよう整理する。

  - モデル名不一致確認ダイアログ、ログ、JSDoc、内部コメントを Material JSON から Model JSON へ更新する。
  - source/file-loading.js の companion WGSL 解決は model.json 前提のコメント・引数名・テストパスに合わせる。
    shader 抽出元は引き続き material セクション内の material-shader-select を使う。

  - source/renderer.js と index.html の UI 配線を更新する。
      - save/load import を新モジュール名へ差し替える
      - ダウンロード名を ${safeName}.model.json に変更する
      - ボタン文言、drop-zone 文言、関数コメントを Model JSON 基準へ揃える

  - source/langs/en.json / source/langs/ja.json の文言を Model JSON ベースへ更新する。
  - tests と fixture を更新する。
      - test-data/material.json 参照を test-data/model.json へ置換
      - models/miku/material.json を models/miku/model.json へ改名し、drag-and-drop / companion WGSL 系テストとパ
        ス解決を更新

      - tests/material-json.test.mjs は必要なら tests/model-json.test.mjs へ改名し、type: "model" と material ネス
        ト前提の assertion に全面更新

      - tests/ui-settings-loader.test.mjs の「UI 設定は model JSON を無視する」ケースへ更新

  ## Docs

  - AGENTS.md の Material JSON 節を Model JSON 節へ改め、予約キーと保存形式を type: "model" + material セクション
    前提で書き換える。

  - readme.md の保存方法、drag-and-drop 説明、JSON 例、WGSL companion 説明を model.json / Model JSON に更新する。
  - index.html 内コメントもユーザー向け仕様として扱い、旧 material JSON 表現を残さない。
  - docs/specification/api-specification.md / api-specification-ja.md は今回の変更対象外とする。
      - 理由: 現状確認できる範囲で model/material JSON save/load はローカル API 仕様に載っていないため。

  ## Test Plan

  - tests/material-json.test.mjs 系:
      - exporter が test-data/model.json と完全一致する
      - loader が type: "model" + material を正しく適用する
      - basename shader 解決で models/miku/model.json 基準の sibling WGSL 解決が通る
      - omitted field の defaults 補完が従来どおり効く
      - toonTexture: { kind: "none" } を保存・再読込して保持できる
      - model-name 不一致確認フローが従来どおり動く

  - tests/file-loading-shader.test.mjs:
      - models/miku/model.json から companion WGSL を 1 件解決できる

  - tests/ui-settings-loader.test.mjs:
      - type: "model" payload を UI 設定 loader が無視する

  - 必要なら node --test で関連テスト全体を実行し、fixture rename に伴う参照切れを確認する。

  ## Assumptions

  - 今回の model.json 対応範囲は material セクションのみ。
  - material 以外の将来セクションは保存しないし、読込時も処理しない。
  - 後方互換は不要なので、旧 type: "material" と旧 *.material.json 命名の読み取り分岐は残さない。
  - UI 表示名も内部コメントも Model JSON へ統一する。

# Material JSON Save/Load (old plan)

## Summary

- Add material-parameter JSON export/import for the Material tab, with save/load UI placed at the bottom of the tab.
- Use the existing JSON drag-and-drop pipeline used for UI settings, extending it to recognize and apply type: "material" payloads.
- Save and load the full material set of the active model, keyed by material.name, with model-name used to resolve the target model.
- If no loaded model matches model-name, show a warning/confirmation dialog and let the user choose whether to apply to the active model instead.

## Implementation Changes

- Material JSON format
    - Treat test-data/material.json as the canonical sample shape.
    - Reserve top-level keys type and model-name; all other top-level keys are material entries.
    - Match each material entry name by exact material.name.
    - Export the current active model name into model-name.
    - Export all materials of the active model, not just the current selection.
    - Export the current editable material fields already exposed in the Material tab:
        - material-shader-select
        - material-visible
        - material-ssss
        - material-receive-shadow
        - material-cast-shadow
        - material-no-cull
        - diffuse
        - material-metallic-range
        - material-metallic-value
        - material-roughness-range
        - material-roughness-value
        - material-emissive-swatch
        - material-emissive-strength
    - Keep export/import logic centralized so future material parameters are added in one schema/mapping table.
- Loader and application flow
    - Extend the JSON loader module so it can parse and dispatch both ui and material payloads instead of treating material JSON as unsupported.
    - Add material-specific validation and normalization helpers:
        - object payload required
        - type === "material"
        - model-name optional for parse, but required for normal target resolution
        - ignore reserved keys when enumerating material entries
        - normalize color arrays and numeric/boolean-like values to existing renderer expectations
    - Resolve target instance by exact instance.model.name === model-name.
    - If no match is found:
        - show a warning dialog
        - message explains that the named model was not found
        - ask whether to apply to the active model
        - if user cancels, abort without partial apply
    - Apply matched material entries by exact material.name.
    - Reuse the existing material mutation rules already used by the Material tab:
        - update model.materials
        - update morphController.materialStates in lockstep for PBR/color values
        - set morphController.dirty = true
        - call updateMaterialStateBuffers() for affected indices
        - refresh Material tab UI and redraw
    - Keep unmatched material entry names non-fatal; skip them and surface a warning summary in console and/or result metadata.
- UI and drag-and-drop
    - Add Material tab controls at the bottom of the section in index.html:
        - save button
        - load button
        - hidden file input for manual JSON selection
    - Wire save/load in the renderer-side Material tab logic so the feature operates on the active model context.
    - Save behavior:
        - serialize the active model’s material state to JSON
        - download as a .json file
        - use a deterministic filename derived from the model name
    - Load behavior:
        - button opens the JSON file picker
        - selected file goes through the same material JSON loader used by drag-and-drop
    - Extend the main file batch/drop handling so JSON files are parsed once and dispatched by type, allowing both UI settings JSON and material JSON through the same entry path.
- Documentation and repo guidance
    - Update AGENTS.md with a dedicated note for material JSON maintenance:
        - canonical top-level format
        - reserved keys
        - exact model-name / material.name matching
        - required synchronized updates when adding new material parameters
        - requirement to keep sample/test data in test-data/material.json aligned with new fields

## Test Plan
    - parse and apply test-data/material.json to a fake model instance
    - exact model-name match applies to the intended instance
    - missing model-name match triggers confirmation path
    - cancel on mismatch leaves all models unchanged
    - confirm on mismatch applies to the active model
    - unknown material entry names are skipped without failing the whole load
    - type: "ui" behavior remains unchanged
- Material application tests
    - imported values update:
        - visibility arrays
        - shadow flags
        - no-cull
        - shader name
        - diffuse
        - metallic
        - roughness
        - emissive
        - emissive strength
    - morphController.materialStates stays synchronized with imported editable material values
    - morphController.dirty is raised
    - updateMaterialStateBuffers() is called with the affected indices
- Save/export tests
    - export emits type, model-name, and all materials of the active model
    - exported keys use exact material.name
    - exported numeric/color fields match current in-memory material state
    - exported JSON shape stays aligned with test-data/material.json
- Integration coverage
    - file-input load path and drag-and-drop path both route through the same material JSON loader
    - zipped/folder-style drops containing material JSON continue to work alongside existing UI settings JSON handling

## Assumptions

- Material entry keys in JSON map to model.materials[i].name by exact match.
- Export scope is the active model’s full material set.
- The mismatch prompt can use the project’s existing confirmation-dialog pattern, with fallback to window.confirm where needed.
- Unknown or future material fields should be ignored unless explicitly added to the shared material JSON field map.