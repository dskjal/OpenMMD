# Bloom Quality Upgrade Plan

## Summary

現行の bloom を「半解像度 1 段 + 2-pass separable blur」から、「multi-scale downsample / upsample pyramid」に置
き換える。目的は、bloomBlurAmount を大きくしたときに見える格子状の合成パターンと最近傍復元のブロック感を解消し、
大きい glow を自然に出せるようにする。

既存 UI の Bloom Enabled / Threshold / Blur Amount / Alpha は維持する。Blur Amount の内部意味だけを「単一半径」
から「pyramid の段数と拡散量を制御する連続パラメータ」に変更する。

## Key Changes

### Bloom algorithm

- source/shaders/post-effect/bloom.wgsl を multi-scale bloom 専用に再構成する。
- pass は以下に分割する。
    - bloomExtract: scene color から高輝度抽出。soft knee を導入して threshold 境界を滑らかにする。
    - bloomDownsample: 1/2, 1/4, 1/8, 1/16, 必要なら 1/32 へ順次縮小しながら小半径 blur を兼ねる。
    - bloomUpsample: 低解像度から順次上位レベルへ加算復元する。各段で線形サンプルを使う。
    - bloomComposite: 最終 bloom を scene color に加算する。
- 各段の blur は「大半径 1 本」ではなく「小半径の段積み」で表現する。これにより大きい Blur Amount でもサンプル間
引き由来のパターンを出さない。
す。

### GPU resources and pass execution

- source/renderer-resources.js の bloom 中間リソースを bloomTextureA/B 固定 2 枚から、mip ではなく「明示的な各解
像度テクスチャ配列」に変更する。
- pyramid 段数は固定上限 5 段にする。
    - Level 0: canvas / 2
    - Level 1: canvas / 4
    - Level 2: canvas / 8
    - Level 3: canvas / 16
    - Level 4: canvas / 32
    - 各サイズは max(1, floor(...))
- 各 level ごとに ping/pong を持たず、downsample 用 chain と upsample の加算先を明示する。最小構成は
bloomDownsampleViews[] と bloomUpsampleViews[] の 2 系列。
- source/renderer-gpu.js の bloom リソース生成を、単一 blur pipeline ではなく extract / downsample / upsample /
composite の 4 種へ置き換える。
- source/render-loop.js の bloom 実行は level ループで回す。
    - extract: currentColorView -> bloom level 0
    - downsample: level n -> level n+1
    - upsample: level n+1 + level n -> level n
    - composite: currentColorView + level 0 -> next post effect output
- planner の概念上の pass 数は増やしすぎない。source/post-effect-planner.js では既存の bloomExtract /
bloomComposite を維持しつつ、blur 部分は抽象 pass として bloomDownsample と bloomUpsample に整理する。
- render-loop 側で level 数に展開して実行する。planner に level 列挙までは持たせない。

### Parameters and mapping

- 公開パラメータは追加しない。既存 bloomThreshold / bloomBlurAmount / bloomAlpha を流用する。
- bloomBlurAmount は 0..8 を維持し、内部では以下にマップする。
    - 0..1.5: 2 levels
    - >1.5..3.0: 3 levels
    - >3.0..5.5: 4 levels
    - >5.5: 5 levels
- 各 level の upsample blend weight は bloomBlurAmount に応じて増加させる。blurAmount が大きいほど低解像度段の寄
与を強める。
- bloomAlpha は最終 composite のみで適用する。
- threshold は 0..10 を維持し、soft knee の knee 幅は固定で threshold * 0.25 相当、ただし最小 epsilon を設ける。
- 既定値は変更しない。source/defaults/defaults.json と source/defaults/defaults-manager.js はそのまま使う。

### Docs and API

- 外部 API のキー追加はしないので docs/specification/api-specification.md と docs/specification/api-
specification-ja.md は更新不要。
- docs/post-effect-specification.md を更新し、Bloom 節を multi-scale pyramid 仕様へ差し替える。
- 仕様には以下を明記する。
    - bloom は単一 half-res blur ではない
    - blurAmount は段数と低解像度寄与を制御する
    - 合成時は filtered sampling を使う
    - 大きい bloom でもパターンが出にくいことを目的とする

## Test Plan

- tests/post-effect-planner.test.mjs
    - bloom 有効時の pass 並びを bloomExtract -> bloomDownsample -> bloomUpsample -> bloomComposite に更新する。
    - DoF + Bloom 併用時の順序を同様に更新する。
- tests/renderer-resources.test.mjs
    - bloom pyramid 用に複数解像度テクスチャが作成されることを検証する。
    - canvas 128x72 のとき 64x36, 32x18, 16x9, 8x4, 4x2 の bloom resources が確保されることを確認する。
- tests/renderer-gpu.test.mjs
    - bloom 用 pipeline が extract / downsample / upsample / composite で作られることを確認する。
    - composite bind group が filtered sampler を使う前提を確認する。
- tests/post-effect-bloom.test.mjs
    - shader source が threshold soft knee を含むことを確認する。
    - composite が最近傍 textureLoad ではなく sampling 経路を使うことを確認する。
- 手動確認
    - bloomBlurAmount=2,4,8 で明るい輪郭の周囲に格子状パターンが出ないこと。
    - 細い髪や白い衣装の highlight 周辺でブロック感が出ないこと。
    - DoF + Bloom 併用時に DoF 後の scene から bloom が取られること。
    - MSAA on/off と FXAA on/off で破綻しないこと。

## Assumptions

- bloom の品質改善を最優先し、GPU メモリ増加は許容する。
- mipmap 自動生成は使わず、既存構成に合わせて明示的な fullscreen pass で pyramid を作る。
- UI は増やさず、既存スライダの意味変更だけで対応する。
- planner は抽象 pass を返し、level ごとの展開責務は render-loop に置く。
- bloom 用の公開 API 追加は行わない。




# Bloom 座標系修正プラン

## Summary

履歴上の根本原因は、bloom の座標系修正が段階的に積み重なり、extract / downsample / upsample と composite で別々
の UV 規約になったことです。特に bloomComposite だけで 1.0 - uv.y を入れた修正は、最終表示だけを部分的に補正し、
pyramid 内部画像の上下反転を残しました。

修正は bloom 全 pass を同じ座標規約に統一します。fullscreen triangle の補間 uv は使わず、各 render target の
@builtin(position) と出力サイズから 0..1 UV を作ります。composite 専用の Y 反転は削除します。

## Implementation Changes

- source/shaders/post-effect/bloom.wgsl
    - FullscreenVertexOutput から @location(0) uv を削除する。
    - fn bloom_uv(pos, outputSize) を追加し、pos / outputSize を clamp して UV を作る。
    - bloomExtract / bloomDownsample / bloomUpsample / bloomComposite の全 pass で
    bloom_uv(input.position.xy, ...) を使う。
    - bloomComposite の vec2<f32>(uv.x, 1.0 - uv.y) を削除し、scene と bloom を同じ UV で sampled する。
    - threshold / blurAmount / alpha / levelCount の BloomUniforms は仕様どおり維持する。
- source/renderer-gpu.js
    - bloomOutputSizeBuffer と bloomOutputSizeData を追加する。
    - extract / downsample / upsample / composite の bind group に output size uniform を追加する。
    - 既存の bloomSettingsBuffer を output size 用に流用しない。
- source/render-loop.js
    - 各 bloom pass の直前に出力ターゲットサイズを書き込む。
    - extract: bloom level 0 size
    - downsample: current output level size
    - upsample: current output level size
    - composite: canvas size
    - blurAmount -> levelCount と blend weight のマッピングは変更しない。
- source/renderer-resources.js
    - getBloomLevelSize(level) を追加し、pyramid level の { width, height } を返す。
    - bloom resource の段数、format、downsample / upsample texture 構成は仕様書どおり維持する。

## Test Plan

- tests/post-effect-bloom.test.mjs
    - shader が BloomOutputSize と bloom_uv(pos, outputSize) を使うことを検証する。
    - bloomComposite が 1.0 - uv.y を含まないことを検証する。
    - soft knee と filtered sampling の既存検証は維持する。
- tests/renderer-gpu.test.mjs
    - createBloomResources が bloomOutputSizeData を持つことを検証する。
    - extract / downsample / upsample / composite pipeline 構成は維持されることを確認する。
- tests/renderer-resources.test.mjs
    - getBloomLevelSize(0) と getBloomLevelSize(4) が 64x36, 4x2 を返すことを確認する。
- 実行確認:
    - node --test tests\post-effect-bloom.test.mjs tests\renderer-gpu.test.mjs tests\renderer-resources.test.mjs
    tests\post-effect-planner.test.mjs

## Assumptions

- 壊れているのは bloom 内部の座標系であり、DoF / SSS / Contact Shadow の修正はこの作業に含めない。
- docs\plans\bloom-improvement-by-chat-gpt.md の multi-scale pyramid 仕様は維持する。
- public API、UI、defaults は変更しない。