 # ワールド座標ピッカーを透明描画用深度から分離する

## Summary

- フルフレームの Z prepass を「ピッカーのためだけ」に毎フレーム入れるのは過剰。現状の 1px scissor の専用ピックパ
スを維持し、その意味付けを明確化する方が良い。
- 半透明には「正しい単一深度」はない。ピッカーは描画結果の物理的真実ではなく、明示したヒットポリシーを返すものと
して設計する。
- 採用方針は Threshold Based。finalAlpha = textureAlpha * diffuseAlpha が閾値以上ならその面を拾い、未満なら背後
を拾う。
- メイン描画の深度と、ピッカー用深度は分離する。透明材質がメイン深度を壊しても、ピッカー結果には影響させない。

## Key Changes

- source/model-manager.js:388
drawDepthPickInstance の対象判定を「不透明のみ」から「不透明 + cutout + 閾値以上の transparent」に変える。
- source/shaders/shaders.wgsl:340
fs_pick_world をピッカー専用の可視判定にする。cutout の discard は維持し、transparent も finalAlpha >= 0.5 を
通す。通過した fragment は worldPos を書く。
- source/render-loop.js:95
既存の 1px pick pass をそのまま使う。全面 Z prepass にはしない。必要なのは click 時の 1px 可視面判定だけなの
で、全画面深度生成は不要。
- source/renderer-resources.js:189
pick 用 rgba32float と pick 用 depth を独立維持する。メインの depth24plus は DOF/post effect 用であり、ピッ
カーの真実源にしない。
- source/model-manager-pipelines.js:101
pick pipeline は別管理のままでよい。必要なら pick 専用の alpha threshold を uniform/定数で渡すが、初期値は固定
0.5 とする。

## Important Notes

- 現状のメイン透明描画は PMX 順 + depthWriteEnabled: true なので、source/model-manager.js:350 と source/model-
manager-pipelines.js:146 のままでは、メイン深度をピッカーに流用してはいけない。
- もし「見た目どおりの半透明合成結果に対して pick したい」なら、Z prepass では解決しない。OIT を入れても最終的な
pick はなお仕様決めが必要。
- pick pass の draw order は本質ではない。pick 用 depth が最近接を決めるので、透明描画の PMX 順ソートをそのまま
持ち込む必要はない。
- pick depth を DOF や他の post effect に共用しない。半透明を閾値で扱う深度は、見た目用深度としては副作用が大き
い。

## Test Plan

- 半透明面 alpha=0.3 の手前に不透明面がある場合、ピッカーは背後の不透明面を返す。
- 半透明面 alpha=0.8 の手前に不透明面がある場合、ピッカーは手前の半透明面を返す。
- cutout テクスチャの穴部分は背後を拾い、不透明 texel は前面を拾う。
- material morph で diffuse.a が閾値を跨ぐ場合、pick 結果も同じフレームで切り替わる。
- PMX の材質列挙順を変えても、pick 結果は最近接面基準で安定する。
- DOF 用 depth、物理 ray pick、ボーン pick に回帰がないことを確認する。

## Assumptions

- ピッカーの仕様は「ユーザーが見ている色合成結果」ではなく「ツール操作用の前面ヒット規則」。
- alpha 閾値は固定 0.5。今回は UI 追加なし。
- 透明描画そのものの品質改善は別課題とし、今回はワールド座標ピッカーの安定化に限定する。