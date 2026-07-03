# Bloom の黒いひし形アーティファクト修正

## Summary

外部の前例はかなり一致しており、bloom が NaN/Inf や不正な色値を拡散して黒い四角・ひし形状の破綻を出す パターンが
典型でした。Unity HDRP は「bloom は原因ではなく、別箇所で生じた NaN/Inf を広げる」と明記しており、Khronos /
StackExchange / Unreal の事例でも、clamp / saturate / 0 埋めで改善した報告があります。
参照:

- Unity HDRP: Propagating NaNs/Infs
(https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition%407.5/manual/Post-Processing-Propagating-NaNs.html)
- Khronos Forum: Problem with HDR + bloom (https://community.khronos.org/t/problem-with-hdr-bloom/58991)
- Computer Graphics SE: Black squares in bloom effect
(https://computergraphics.stackexchange.com/questions/12381/black-squares-in-bloom-effect)
- Unreal Forum: Black/Transparent squares when using bloom
(https://forums.unrealengine.com/t/black-transparent-squares-when-using-bloom/1207510)

ローカル実装では、source/shaders/post-effect/bloom.wgsl が bloom の抽出・downsample・upsample・合成を担ってい
て、ここに 入力サニタイズがありません。まずは bloom 側で不正値の拡散を止めるのが最小で確実です。

## Key Changes

- source/shaders/post-effect/bloom.wgsl に、RGB の finite / non-negative サニタイズ を入れる。
- extract と downsample の入力、必要なら upsample / composite 直前にも同じガードを適用し、1 ピクセルの異常値が
pyramid 全体に広がらない ようにする。
- 可能なら bloom 専用の helper を切って、sample_karis_average の戻り値を一箇所で正規化する。
- tests/post-effect-bloom.test.mjs に回帰テストを追加し、bloom shader にサニタイズが残ることを固定する。
- 必要なら tests/renderer-gpu.test.mjs で bloom リソースの前提は維持したまま、追加された helper や uniform レイ
アウトの破壊がないことを確認する。

## Test Plan

- tests/post-effect-bloom.test.mjs:
    - bloom shader に不正値ガードが存在することを確認する。
    - saturate 相当のクランプが bloom の入力経路に残っていることを確認する。
- 既存の renderer-gpu / renderer-resources テスト:
    - bloom の multi-scale リソース生成や bind group レイアウトが壊れていないことを確認する。
- 手動確認:
    - bloom を有効化し、問題モデル・問題カメラ操作で黒いひし形が再現しないことを確認する。
    - bloom 無効時に見えない微小な破綻が、bloom 有効時にだけ拡散していないことを確認する。

## Assumptions

- まずは bloom 側の防御 で修正する。上流シェーダの個別修正は、再現が残る場合の次段階に回す。
- 既存の UI や post-effect の見た目パラメータは変えない。
- JSDoc スタイルは維持する。
- 追加で API 仕様変更はしないため、docs/specification/api-specification.md と docs/specification/api-
specification-ja.md の更新は不要。