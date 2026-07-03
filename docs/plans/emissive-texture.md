# Emission Texture/Color Exclusive Selection

## Summary

- emissive を「色」または「テクスチャ」の排他選択に拡張する。
- Material タブでは Emissive 行を横並びにし、既存の色スウォッチの横へ toon 用 UI を流用した texture 選択ボタンを
置く。
- toon 専用実装をそのまま複製せず、既存の picker/swatch 制御を「material texture reference picker」として共通化
し、toon と emissive の両方で使う。
- 変更対象は UI、材質内部表現、GPU bind group / shader、Material JSON、関連テスト。

## Key Changes

- 材質データに以下を追加する。
    - emissiveTexture: null | { kind: 'internal', toonIndex: number } | { kind: 'path', path: string,
    colorSpace: 'gamma-2.2'|'none' } | { kind: 'none' }
    - emissiveSource: 'color' | 'texture'
- emissiveSource の意味を固定する。
    - 'color': 既存 emissive RGB と emissiveStrength を使う。emissiveTexture は保持していても描画には使わない。
    - 'texture': emissiveTexture と emissiveStrength を使う。emissive 色は UI 状態や JSON では保持してよいが描画
    には使わない。
    - emissiveTexture: { kind: 'none' } か無効参照のときは発光なしとして扱う。
- source/material-resources.js
    - toon 参照正規化ロジックを汎用化し、emissive 用にも再利用可能にする。
    - toon picker 候補収集をベースに、emissive picker でも同じ候補群を使えるよう関数名と戻り値を中立化する。
    - createMaterialResources() で emissive texture をロードし、material bind group に emissive 用 binding を追
    加する。
    - GPU material メタに hasEmissiveTexture と emissiveSource を保持する。
- source/model-manager-pipelines.js / bind group layout 定義元
    - material bind group を 1 本増やし、binding 4 を emissive texture に割り当てる。
    - toon の sampler をそのまま共有し、emissive texture も同じ sampler 条件で読む。
- source/model-manager.js
    - updateMaterialToonTexture() と同等の updateMaterialEmissiveTexture() を追加する。
    - emissive texture / source の変更時は pipelineResources を再構築する。
    - writeMaterialBuffer() / updateMaterialStateBuffers() に emissiveSource / hasEmissiveTexture を書き込む領域
    を追加する。現行 24 float の uniform は増量前提でレイアウトを更新する。
- shader
    - gltf-shader.wgsl と mmd-shader-hdr.wgsl で emissive 項を source 切替式に変更する。
    - 色 source: material.emissive * material.emissiveStrength
    - texture source: textureSample(emissiveData, toonSampler, uv).rgb * material.emissiveStrength
    - mmd-shader.wgsl は現状 emissive を使っていないため、HDR と glTF に合わせるかは実装時に揃える。デフォルトは
    「HDR/glTF で有効、非HDR MMD でも同じ挙動に揃える」を採用する。
- source/renderer.js / index.html
    - Emissive 行を色スウォッチ + texture スウォッチ + source 切替 UI の 1 行にまとめる。
    - source 切替 UI は Color / Texture の 2 択ボタンまたは select にする。既定値は Color。
    - texture スウォッチは toon の見た目・混在表示・ダイアログ選択を流用する。
    - picker overlay は toon 専用文言を汎用化し、タイトルだけ Toon Texture / Emissive Texture で差し替える。
    - emission texture 適用時は model.materials と morphController.materialStates の同期ルールを崩さず、
    morphController.dirty = true を立てる。
- source/material-json.js
    - export/import に以下を追加する。
        - material-emissive-source: 'color' | 'texture'
        - material-emissive-texture: texture reference object
    - 既存 material-emissive-swatch と material-emissive-strength は維持する。
    - source が texture でも色値は保存してよいが、描画には使わない。
- test-data/material.json
    - emissive source / texture の代表例を追加してサンプルを更新する。
- docs
    - Material JSON の仕様説明に material-emissive-source と material-emissive-texture を追加する。
    - API 追加が外部 API 露出を伴わないなら docs/specification/api-specification*.md は更新しない。もし API
    bridge/state に emissive texture/source が露出していれば同時更新する。

## Test Plan

- tests/material-resources.test.mjs
    - emissive texture reference があると bind group の emissive binding が空でないこと。
    - emissiveSource='texture' かつ emissiveTexture={kind:'none'} で fallback が空テクスチャになり、
    hasEmissiveTexture が false になること。
    - toon 候補収集の共通化後も既存 toon 候補順が壊れないこと。
- tests/animation-loop-physics.test.mjs
    - updateMaterialStateBuffers() が emissive source / texture presence を uniform に正しく書くこと。
    - MorphController dirty 再同期後も emissive, emissiveStrength, emissiveSource, emissiveTexture が保持される
    こと。
- tests/material-json.test.mjs
    - emissive color source の import/export が既存互換で動くこと。
    - emissive texture source の import/export が object 参照を保持すること。
    - material-emissive-source 省略時は既定値 color になること。
- UI 回帰
    - mixed selection で emissive color/source/texture が混在表示になること。
    - emissive texture picker を開いて適用後、scene refresh と UI 再同期が行われること。
    - toon picker 既存動作が壊れていないこと。

## Assumptions

- emission texture の候補集合は toon と同じプールを使う。別の専用ファイル一覧は追加しない。
- internal toon texture も emissive texture として選択可能にする。ユーザー要件が「toon のものを変更して利用し
て」であり、候補 UI の再利用だけでなく参照形式も共有する前提で進める。
- glTF ローダーの既存 emissiveTexture 自動取込は未実装前提で、今回の必須対象は Material タブ編集と JSON 保存読
込。ローダー連携は同時に追加できるなら追加するが、最低ラインでは外さないために明示的に実装対象へ含める。
- JSDoc スタイルを維持し、新規関数・新規プロパティの説明も既存粒度に合わせる。