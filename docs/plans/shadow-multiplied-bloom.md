# Bloom 内 Shadow Factor 適用プラン

## Summary

今回の前提は次の 2 点で固定する。

- 適用点: Extract + Composite
- factor 定義: 直影 + nDotL

公開 API や UI 項目は増やさない。既存 bloom 設定をそのまま使う。

## Implementation Changes

- source/shaders/shaders.wgsl
    - MainFragmentOutput.mask の未使用チャンネルを bloom 用 shadow factor に割り当てる。
    - 既存の r=skin mask, g=view depth は維持する。
    - bloom 用値の格納位置をコメントで明示する。

- source/shaders/custom-shaders/mmd-shader-hdr.wgsl
    - bloom 用の係数を clamp(dotNL, 0.0, 1.0) * shadowMapFactor * contactShadowFactor として算出する。
    - 可視色の計算には使わず、out.mask の bloom 用チャンネルへだけ書く。
    - receive_shadow が無効な材質は 1.0 を書く。

- source/shaders/custom-shaders/mtoon-shader.wgsl
    - bloom 用の係数を HDR 側と同じ定義で算出する。
    - shadeShift や receiveShadowRate など MToon の見た目演出値は bloom factor に含めない。
    - out.mask の bloom 用チャンネルへ書く。

- 他のカスタムシェーダ
    - mmd-shader.wgsl, gltf-shader.wgsl, cell-shader.wgsl は bloom 互換のため既定値 1.0 を bloom 用チャンネルへ
    書く。

    - edge パスや bone MRT など bloom 無関係の経路は既存挙動を壊さない値で埋める。

- source/renderer-gpu.js
    - bloom extract / composite bind group に scene mask texture を追加する。
    - bloom 用パイプラインの bind group layout を更新する。
    - 新規 uniform は増やさず、既存 post-effect 入力の 1 つとして scene mask view を渡す。

- source/shaders/post-effect/bloom.wgsl
    - scene mask から bloom 用 shadow factor を読む helper を追加する。
    - fs_bloom_extract で、threshold 判定前の抽出元 color に shadow factor を乗算する。
    - fs_bloom_composite で、加算する bloomColor に再度同じ factor を乗算する。
    - downsample / upsample は変更しない。shadow の伝播は extract 済み bloom をそのまま使う。
    - shadow factor は 0..1 に clamp し、無効値は 1.0 扱いにする。

- source/render-loop.js
    - bloom extract / composite bind group 作成時に scene mask view を渡す。
    - 入力 color view と mask view の組が常に同じフレームの scene を指すように揃える。
    - SSS / DOF 後の currentColorView を bloom 入力に使っても、shadow factor は元の scene mask を参照する前提を
    固定する。

- UI
    - ポストエフェクトタブのブルームラベルの一番下にシャドウ乗算スライダーを追加
    - 範囲は [0.0, 1.0]
    - シャドウ乗算スライダーが 0 の時はシャドウ乗算の効果は0（通常のbloom）になる

## Test Plan

- tests/post-effect-bloom.test.mjs
    - bloom shader が scene mask texture を受け取ること。
    - fs_bloom_extract が抽出前 color に shadow factor を掛けること。
    - fs_bloom_composite が bloomColor に shadow factor を掛けること。
    - factor 読み出しが clamp / fallback を持つこと。

- tests/custom-shader-manager.test.mjs または既存 shader 文字列テスト
    - mmd-shader-hdr.wgsl と mtoon-shader.wgsl が bloom 用 mask 出力を持つこと。
    - 非対象シェーダが bloom 用チャンネルに 1.0 を書くこと。

- tests/renderer-gpu.test.mjs
    - bloom extract / composite の bind group layout に mask texture binding が追加されること。
    - bloom pipeline 作成が既存の group index 前提を壊していないこと。

- 手動確認
    - mmd-shader-hdr と mtoon-shader で、影側の bloom が明部より抑えられること。
    - bloom 無効時に見た目が変わらないこと。
    - SSS / DOF / FXAA 併用時に bloom が壊れないこと。
    - receive shadow 無効材質や outline で bloom が不自然に欠けないこと。

## Assumptions

- bloom 用 shadow factor は AO を含めない。目的は接地陰影ではなく、直射由来の明暗差を bloom 内だけに戻すこと。
- factor の定義は shader ごとに完全一致させず、「nDotL * shadowMap * contactShadow を共通基準にする」方針で統一
する。

- 初期実装では強度調整用の新規 UI / default 値は追加しない。効きが強すぎる場合は次段で bloomShadowStrength の導
入を検討する。