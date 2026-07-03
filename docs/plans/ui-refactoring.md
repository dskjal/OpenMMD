# UI Component Refactor With Web Components

  ## Summary

  - index.html の手書き UI を Web Components ベースへ置き換え、ボタン、range + number、単独 number 入力を共通化す
    る。

  - 方針は Shadow DOM 採用、id は input 単位ではなくコンポーネント単位へ再設計、利用側は
    document.getElementById(controlId).value を直接使う。

  - 既存の document.getElementById('...-range') / ('...-value') 依存は廃止し、renderer.js / renderer-ui.js を中心
    に UI アクセス層を全面更新する。

  - スタイルは外部 CSS へ分離し、index.html の inline style と重複 class を整理する。

  ## Key Changes

  - 新規 source/ui-components.js を作成する。
      - openmmd-button
      - openmmd-icon-button
      - openmmd-number-control
      - openmmd-range-control
      - openmmd-range-number-control

  - 各コンポーネントは共通で以下を持つ。
      - value, disabled, min, max, step, label のプロパティ/属性
      - 必要な場合の checked, pressed, variant, icon

  - openmmd-range-number-control は内部で slider と number を同期し、利用側には単一の .value を公開する。
  - 数値系の共通ロジックは source/numeric-input-utils.js を拡張し、HTMLElement ベースで扱えるようにする。
      - bindLinkedNumericInputs を custom element 対応にするか、コンポーネント専用 binder を追加する。
      - フォーカス判定、parse/sanitize/format、commit 処理は既存仕様を維持する。

  - index.html は以下へ再構成する。
      - UI 共通 CSS を source/styles/ui-components.css に分離
      - 汎用レイアウト CSS を source/styles/layout.css などへ分離
      - 重複している slider/number/button の HTML を新コンポーネントタグへ置換
      - 既存の直接 style= 指定は variant/class へ吸収

  - renderer.js / renderer-ui.js / 必要な UI モジュールの DOM 参照を更新する。
      - *-range と *-value の 2 要素参照をやめ、単一 control id へ統一
      - .value, .disabled, addEventListener('input'|'change') ベースへ置換
      - 内部 input の個別同期関数は削除またはコンポーネント API に集約
      - syncShadowValuePair など局所 helper は整理して共通 binder に寄せる

  - ボタン共通化は見た目と属性までを対象にし、クリック動作は既存 JS 側に残す。
      - 通常ボタン、アイコンボタン、ツールバーボタン、保存/削除系 button の variant を定義する

  - API 仕様書更新は今回不要。
      - 外部公開 API の追加ではなく内部 UI リファクタリングのため
      - ただし、もし window.* 経由の UI アクセス API を追加した場合のみ docs/specification/api-specification.md と
        docs/specification/api-specification-ja.md を更新する

  ## Public Interfaces

  - 新しい内部 UI インターフェース
      - document.getElementById(controlId).value
      - document.getElementById(controlId).disabled
      - document.getElementById(controlId).addEventListener('input'|'change', ...)

  - 旧インターフェース
      - ...-range
      - ...-value
      - 個別 input 直参照前提

  - 移行ルール
      - range/number ペアは必ず単一 control id に統合する
      - 単独 number も openmmd-number-control に寄せる
      - ボタン id は原則維持し、要素型だけ共通コンポーネントへ置換する

  ## Test Plan

  - tests/ に UI コンポーネント単体テストを追加する。
      - .value の getter/setter
      - min/max/step 反映
      - slider と number の双方向同期
      - input / change の再送出
      - disabled 状態反映
      - フォーカス中の同期抑制と commit 時の正規化

  - 既存の数値入力ヘルパー関連テストを更新する。
      - custom element を渡した場合の parse/sanitize/format

  - UI 結合確認
      - Grid overlay
      - Camera FOV
      - Light intensity
      - Bone child influence
      - IK chain/iteration
      - Shadow / AO / Contact shadow / Bloom / DOF / SSS / HDR intensity
      - Material metallic / roughness / emissive strength
      - Playback range

  - 回帰確認
      - 既存の window 公開関数や renderer state 同期が壊れていないこと
      - i18n 文言、disabled 切替、フォーカス保持、数値丸めの挙動が従来どおりであること

  ## Assumptions

  - Shadow DOM を使うが、利用側は内部要素へ直接触れず、custom element 自身の公開 API のみを使う。
  - 単一 id で値取得できることを最優先し、range/number 個別 id の後方互換は維持しない。
  - ボタンは動作を内包せず、見た目と基本属性だけ共通化する。
  - まず index.html と UI 参照の強い renderer.js / renderer-ui.js を中心に移行し、他モジュールで同様の重複があれば
    同じ基準で追従させる。

# Update Tests to Current UI IDs

  ## Summary

  - Replace test fixtures and assertions that still assume removed UI IDs such as gamma-value, light-color-
    strength, and shadow-power-value.

  - Keep JSON read compatibility in runtime code unchanged for now; this pass is test-only and aligns tests with
    the current DOM structure.

  - Treat current single-control IDs as the source of truth:
    gamma, light-color-strength-range, shadow-power, and existing material/model JSON keys that still match
    current UI IDs.

  ## Key Changes

  - Update /D:/data/program/openmmd/tests/ui-settings-loader.test.mjs
      - Remove fake elements for deleted companion IDs.
      - Remove linked-input synchronization that assumes separate range/value controls.
      - Update assertions so applied values are checked only on current controls.
      - Keep coverage for legacy JSON input keys only if the loader still supports them, but do not model missing
        DOM nodes as current UI.

  - Update /D:/data/program/openmmd/tests/display-preset.test.mjs
      - Change expected exported UI settings to current IDs only.
      - Drop expectations for light-color-strength and shadow-power-value if createDisplayPresetUiSettings() now
        writes only current IDs.

  - Update other tests that still encode old DOM structure, especially:
      - /D:/data/program/openmmd/tests/post-effect-ui.test.mjs
      - Any markup/assertion tests found by search that still require deleted ...-value IDs

  - Leave model-json tests unchanged unless a test is incorrectly treating JSON keys as DOM IDs. Current
    material-* / ik-rotation-lock-* JSON keys appear intentional and not broken by the UI refactor.

  ## Test Plan

  - Run targeted tests for:
      - tests/ui-settings-loader.test.mjs
      - tests/display-preset.test.mjs
      - tests/post-effect-ui.test.mjs

  - Then run a broader related pass for JSON/UI coverage if needed:
      - tests/model-json.test.mjs
      - post-effect / renderer UI tests that reference these controls

  - Acceptance criteria:
      - No test expects removed DOM IDs.
      - Exported UI-settings fixtures/assertions match current IDs.
      - Loader tests still verify current DOM updates correctly.

  ## Assumptions

  - Scope is limited to tests; runtime code changes are out of scope for this pass.
  - “New ID” means the IDs currently present in /D:/data/program/openmmd/index.html, not legacy compatibility keys
    accepted by loaders.

  - Legacy JSON read support may remain in production code even if tests stop modeling legacy DOM IDs.