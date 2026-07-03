# デフォルト値集約リファクタリング計画

## Summary

- 対象は「state 全般」に限定する。create*State() の初期値、UI 初期値、レンダラー初期 state、ライト/カメラ/影/グ
リッドなどの実行時デフォルトを json + js に集約する。
- 読み込み方式は source/defaults/defaults.json を起動時 fetch で取得し、source/defaults/defaults-manager.js が正
規化・検証・clone・互換 fallback を担当する。
- 幾何定数、GPU バッファサイズ、アルゴリズム閾値、WGSL 用内部定数のような「設定ではない定数」は対象外にする。
- AGENTS.md には「新しいデフォルト値追加時は defaults JSON/manager/テストを同時更新する」運用ルールを追記する。

- 新規追加: source/defaults/defaults.json
    - ルートは用途別に分割する。
    - 例: camera, shadowUi, shadowManager, postEffects, renderUi, gridOverlay, lightObject, worldRotationUi,
    gizmoState
    - 値は JSON で表現可能なプリミティブ/配列/プレーンオブジェクトのみを置く。
    - Float32Array、quat.create()、vec3.create() のような実体は置かず、JS 側で復元する。
- 新規追加: source/defaults/defaults-manager.js
    - loadDefaults() を追加し、起動時に一度だけ JSON を fetch してキャッシュする。
    - getDefaultsSnapshot(section) を追加し、各セクションの deep clone を返す。
    - resolveDefaults() を追加し、fetch 失敗時は JS 内 fallback を返す。
    - JSON shape 検証、数値の Number.isFinite 補正、配列長検証、必須キー補完を担当する。
    - JSDoc で各 section の返却 shape を明示する。
- source/renderer.js
    - 初期化の最上流で await loadDefaults() を実行する。
    - renderer state 構築時は直書きや分散定数ではなく defaults manager 経由に統一する。
    - 既存の display preset 適用は維持し、defaults は「preset 適用前の基底値」とする。
- source/renderer-ui.js
    - DEFAULT_POST_EFFECT_UI_VALUES と DEFAULT_RENDER_UI_VALUES を削除し、defaults manager 経由に置換する。
    - readPostEffectUIInitialValues() と render UI 初期値読取は manager から snapshot を取得して使う。
- source/camera.js
    - createCameraState(unitScale) は camera defaults section を基底にして組み立てる。
    - near/far/fovY/center/distance/theta/phi/roll の基底値を JSON 管理へ移す。
    - AUTO_CLIP_* や CAMERA_FIT_PADDING のような内部計算定数は残す。
- source/renderer-shadow-state.js, source/shadow-manager.js
    - UI 既定値と manager 内部初期値を分離して JSON section を分ける。
    - shadowEdgeSize など renderer shadow state の初期値は shadowUi から取得する。
    - CSM の cameraNear/cameraFar/lambda/padding/shadowMapSize は shadowManager section から取得する。
- source/ui-overlay.js
    - GRID_DEFAULT_SIZE と GRID_DEFAULT_COUNT は gridOverlay section に移す。
    - GRID_MAX_* のような制約値は残す。
- source/light-object.js, source/world-rotation-ui.js, source/gizmo.js
    - state 生成の基底値だけ JSON 管理へ移す。
    - ベクトル/クォータニオン実体は manager の plain data をもとに既存 factory 内で復元する。
- テスト更新
    - 既存の default 値前提テストは manager 経由の値を期待するよう更新する。
    - defaults manager の単体テストを追加し、fetch 成功/失敗/fallback/clone/shape 補完を検証する。
- AGENTS.md
    - 「デフォルト値を追加・変更する場合は source/defaults/defaults.json、source/defaults/defaults-manager.js、
    関連テストを同時更新する」
    - 「実行時 default は直書きせず defaults manager 経由を優先する」
    - 「JSON に置くのはシリアライズ可能な state 基底値のみ。内部計算定数は別扱い」と明記する。

## Public Interfaces / Types

- 新規 API: loadDefaults(): Promise<void>
- 新規 API: getDefaultsSnapshot(sectionName): object
- 新規 API: resolveDefaults(): object
- 既存 create*State() の外部シグネチャは原則維持する。
- 起動順の新要件として、renderer.js から各 state factory を使う前に loadDefaults() を完了させる。

## Test Plan

- defaults manager
    - JSON 正常読込で全 section が取得できる。
    - fetch 失敗時に JS fallback へ切り替わる。
    - getDefaultsSnapshot() が参照共有せず clone を返す。
    - 不正 shape の補完と既定値復旧が動く。
- state factory
    - createCameraState() が defaults JSON の値を反映する。
    - createShadowState() と shadow manager の初期値が分離されている。
    - createLightObjectState() が plain array から direction/rotation を正しく復元する。
    - createGridOverlayState() が grid defaults を使う。
- renderer/UI
    - readPostEffectUIInitialValues() と render UI 初期化が manager 由来の値を使う。
    - 起動時に defaults 読込後、既存の display preset 上書きが壊れない。
    - DOM 非存在環境のテストで fallback snapshot を返せる。
- 回帰確認
    - 既存の camera / renderer helper / shadow state / world rotation / custom shader 周辺テストを再実行し、
    default 前提の退行がないことを確認する。

## Assumptions

- 今回の対象外は、GPU バッファサイズ、描画補助色、ピッキング許容値、物理/IK/補間の内部閾値など「設定値ではない定
数」。
- JSON は source/defaults/defaults.json の 1 ファイルで開始し、将来必要なら分割する。
- fetch 起動失敗時でも viewer を落とさないため、defaults-manager.js に完全な JS fallback を持たせる。
- API 仕様書更新は不要とする。新規の外部公開 API ではなく、内部実装整理として扱う。