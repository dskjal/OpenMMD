# Gamma 2.2 Linear Workflow

## Summary

- 目的は「シーン内部は linear で処理し、表示直前に gamma 2.2 を基準にエンコードする」流れへ統一すること。
- 既存の postEffects.gamma は残すが、意味を「固定 2.2 の上に乗る追加の表示補正」に変更する。
- 主要な不整合は 2 点です。
    - モデル用カラー texture が rgba8unorm / bc*-unorm で読み込まれており、shader 側で linear 化されていない。
    - bloom / gammaOnly / FXAA がそれぞれ個別に gamma 補正しており、最終出力責務が分散している。

## Key Changes

- Texture 入力を linear 化する。
    - source/material-resources.js で base / toon / sphere のカラー texture を sRGB 扱いで作成する。
    - 非圧縮画像は rgba8unorm-srgb、DDS は対応する *-srgb 変種へマップする。alpha 判定は今のまま維持する。
    - 1x1 fallback texture も sRGB 側へ合わせる。
    - データ texture（depth, normal, HDR, post effect 用 float texture）は現状の linear / float format を維持する。
- 中間レンダーターゲットを linear 用に分離する。
    - source/renderer-resources.js の scene color / post effect ping-pong / capture / overlay resolve を presentation format 直結ではなく linear format へ寄せる。
    - 推奨は scene/post effect/capture を rgba16float に統一し、swapchain だけ presentationFormat を使う。
    - grid / UI overlay も最終的に linear ターゲットへ合成し、display 変換後に swapchain へ出す。
- 最終表示変換を 1 箇所に集約する。
    - source/shaders/post-effect/gamma.wgsl を「final composite」責務に拡張する。
    - 表示変換は displayGamma = 2.2 * postEffects.gamma とし、pow(color, 1.0 / displayGamma) を最終段だけで適用する。
- Planner / render loop を「linear chain + final encode」前提に整理する。
    - source/post-effect-planner.js の gammaOnly は実質 finalComposite 相当の最終 pass として扱う。
    - source/render-loop.js では bloom / dof / sss / chromatic aberration / fxaa の結果をすべて linear のまま保持し、最後に 1 回だけ swapchain へ出力する。
    - FXAA 使用時も FXAA 後に final composite を通す。FXAA shader 自体では gamma 変換しない。
- UI / API / docs の意味を更新する。
    - postEffects.gamma は「追加 display gamma 補正」で、1.0 が標準 linear workflow を意味する、と明記する。
    - docs/specification/api-specification.md と docs/specification/api-specification-ja.md を更新する。
    - Post effect 仕様書にも「内部 linear、最終表示で gamma 2.2」を反映する。必要なら docs/post-effect-specification.md も更新する。
    - UI ラベル Gamma は残してよいが、説明文は「additional display gamma」寄りに補う。

## Test Plan

- Texture / color-space 単体確認
    - sRGB texture を読んだとき、shader 入力が linear 前提になること。
    - fallback texture と通常 texture で見え方がずれないこと。
    - DDS の sRGB 変換対象と非対象が意図どおり分かれること。
- Rendering path 確認
    - post effect 無効時でも最終出力だけで 2.2 エンコードされること。
    - bloom / dof / sss / chromatic aberration / FXAA の各有効時に二重 gamma が発生しないこと。
    - grid / UI overlay が scene と同じ表示ガンマで見えること。
    - capture / video export が canvas 表示と一致すること。
- Regression 確認
    - マテリアル色編集、toon、sphere、emissive、environment HDR の見え方が極端に破綻しないこと。
    - 既存 postEffects.gamma = 1.0 が新標準の基準表示になること。
    - postEffects.gamma を変更すると固定 2.2 の上に追加補正としてだけ効くこと。
- 実装テスト追加候補
    - tests/ に post-effect planner の新条件を追加する。
    - texture format 選択ロジックの unit test を追加する。
    - 可能なら final composite の uniform 計算を pure function 化して unit test する。

## Assumptions

- カラー texture は MMD の diffuse / toon / sphere をすべて sRGB 入力として扱う。
- HDR environment、normal/depth/prepass、SSS mask、contact shadow mask は今の linear / data texture 扱いを維持する。
- postEffects.gamma は削除しない。既定値 1.0 のまま残し、基準 2.2 に対する追加補正とする。
- 実装時は JSDoc スタイルを維持し、public な意味変更が入るため API / post effect docs を更新対象に含める。