# ポストエフェクト仕様

シェーダの配置場所は `source/shaders/post-effect/` とする。

本書は、2026年5月6日時点の OpenMMD のポストエフェクト実装と、今後追加する `Screen Space SSS` の仕様をまとめる。古い構想段階の記述は破棄し、現行コード基準で整理する。

## 現在の実装範囲

現時点で実装済みのポストエフェクトは以下。

- `Gamma`
- `Color Temperature`
- `Bloom`
- `Depth of Field`
- `Chromatic Aberration`
- `Film Grain`
- `Contact Shadow`
- `FXAA`

未実装だが本書で仕様を定義する対象は以下。

- `Screen Space SSS`

内部の色処理は linear を基準にし、表示直前だけ `Gamma 2.2` を基準にした `finalComposite` でエンコードする。
`Gamma` スライダーは固定 2.2 に対する追加補正として扱う。

## 関連ファイル

- `source/post-effect-planner.js`
  - ポストエフェクト pass の計画を構築する。
- `source/render-loop.js`
  - planner の返した pass を実行する。
- `source/renderer-resources.js`
  - post effect 用中間テクスチャ、normal、depth を確保する。
- `source/renderer.js`
  - shader module 読み込み、GPU リソース初期化、uniform 更新を行う。
- `source/renderer-ui.js`
  - Post Effects タブと Contact Shadow UI の同期を行う。
- `source/shaders/post-effect/*.wgsl`
  - 各ポストエフェクトシェーダ。

## 現在の UI 配置

### `Post Effects` タブ

`index.html` の `tab-post-effect` に以下を配置する。

- `Gamma`
  - `Gamma`
  - `Color Temperature`
- `Bloom`
  - `Enabled`
  - `Threshold`
  - `Blur Amount`
  - `Alpha`
  - `Intensity`
  - `Chromatic Aberration`
- `Film Grain`
  - `Noise Amount`
  - `Animation Mode`
- `Depth of Field`
  - `Algorithm`
  - `Focus Point (x, y, z)`
  - `F-stop`

### `Rendering Settings > Shadow`

`Contact Shadow` は `Post Effects` タブではなく、`Rendering Settings` タブの `Shadow` セクションに配置する。

- `Enabled`
- `Length`
- `Thickness`
- `Intensity`
- `Blur Amount`
- `Step Count`

### UI ルール

- 数値入力は `range + number` の 2 要素で同期する。
- `Bloom Alpha` は `0..1` にクランプする。
- `Depth of Field` の `Focus Point` は `x / y / z` の number input を持つ。
- `Focus Point` はピッカーアイコンから画面上の点を拾って設定できる。
- `postEffects.enabled` は `Bloom` セクションの `Enabled` で切り替える。
- `Contact Shadow` は `postEffects.enabled` と独立に有効化できる。
- `Intensity` は `gltf-shader.wgsl` のみに適用する追加乗算係数で、`0..10` の範囲で編集する。

## 状態オブジェクト

`source/post-effect-planner.js` の既定値は以下。

```js
{
  enabled: false,
  gamma: 1.0,
  colorTemperature: 6500,
  chromaticAberration: 0.0,
  bloomThreshold: 0.98,
  bloomBlurAmount: 2.0,
  bloomAlpha: 1.0,
  gltfLightStrength: 1.0,
  filmGrainAmount: 0.0,
  filmGrainAnimationMode: 'timeline',
  contactShadowEnabled: false,
  contactShadowLength: 0.08,
  contactShadowThickness: 0.01,
  contactShadowIntensity: 0.55,
  contactShadowStepCount: 8,
  dofBlurAmount: 2.0,
  dofAlgorithm: 'fast',
  dofFStop: 2.8,
  dofFocusPoint: [0.0, 0.0, 0.0],
}
```

`source/renderer-ui.js` 側では UI 初期値として `contactShadowBlurAmount: 1.0` も保持する。Contact Shadow の blur 量は post effect master とは独立に制御する。

## planner 仕様

### 責務

`source/post-effect-planner.js` は「何をどの順に描くか」を決める層であり、各 pass の GPU 実装は持たない。

責務は以下。

- `state` から有効なエフェクトを判定する。
- pass の順序を固定する。
- 論理入力スロットと出力スロットを返す。
- `FXAA` の有無を考慮して最終入力ソースを返す。
- `depth` サンプリングが必要かどうかを返す。

### pass id

現行実装の pass id は以下。

- `bloomExtract`
- `bloomDownsample`
- `bloomUpsample`
- `bloomComposite`
- `contactShadowGenerate`
- `contactShadowComposite`
- `dofBlur`
- `dofComposite`
- `chromaticAberration`
- `gammaOnly`

### texture slot

現行実装の論理スロットは以下。

- `sceneColor`
- `postEffectOutput`
- `swapchain`
- `contactShadowMask`
- `bloomPing`
- `bloomPong`

### 有効化ルール

- `useFxaa`
  - `state.currentAaMode` に `fxaa` を含むとき有効。
- `useBloom`
  - `postEffects.enabled !== false` のとき有効。
- `useDof`
  - `postEffects.enabled !== false` のとき有効。
- `useContactShadow`
  - `postEffects.contactShadowEnabled === true` のとき有効。
- `useChromaticAberration`
  - `abs(postEffects.chromaticAberration) > EPSILON` かつ `FXAA` 無効時のみ有効。
- `useGammaOnly`
  - `postEffects.enabled === false`
  - `FXAA` 無効
  - `gamma`, `colorTemperature`, `chromaticAberration` のいずれかが中立値から外れる
  - 上記を満たすときに有効。
  - ただし独立 pass は持たず、`finalComposite` の追加調整として扱う。

### 現行の重要な設計制約

- `postEffects.enabled` を有効にすると、現状は `Bloom` と `DoF` が常時 pass 計画に入る。
- `Bloom` と `DoF` は UI 上で個別 enable を持たない。
- `Chromatic Aberration` は `FXAA` と同時には専用 pass を使わず、`finalComposite` に畳み込む。
- `Contact Shadow` は post effect master が無効でも単独で有効化できる。

### 返却値

`buildPostEffectPlan(state)` は概ね以下を返す。

- `enabled`
- `useFxaa`
- `useBloom`
- `useDof`
- `useContactShadow`
- `useChromaticAberration`
- `useGammaOnly`
- `needsSceneResolve`
- `needsDepthSampling`
- `finalColorSource`
- `passes`

### pass 順序

現行 planner の pass 順序は以下。

1. `contactShadowGenerate`
2. `contactShadowComposite`
3. `dofBlur`
4. `dofComposite`
5. `bloomExtract`
6. `bloomDownsample`
7. `bloomUpsample`
8. `bloomComposite`
9. `FXAA`
10. `finalComposite`

`gammaOnly` と `chromaticAberration` は planner の補助情報であり、独立 pass ではない。`FXAA` は `passes` 配列に含め、`finalComposite` は常設の終端 pass として render-loop で実行する。

### `finalColorSource` の意味

- `FXAA` 有効時は、`FXAA` 後の linear 出力が `finalComposite` の入力になる。
- `FXAA` 無効時は、`sceneColor` あるいは各 post effect の linear 出力がそのまま `finalComposite` の入力になる。
- `finalComposite` が `Gamma 2.2` を基準にした display encoding を行う。

## render-loop 実行仕様

### 実行順

`source/render-loop.js` では、メインシーン描画後に planner の pass を順に実行し、その後 `FXAA`、デバッグ表示、`finalComposite` を行う。

推奨理解順は以下。

1. メインシーン描画
2. `Contact Shadow mask`
3. `Contact Shadow composite`
4. `DoF blur`
5. `DoF composite`
6. `Bloom extract`
7. `Bloom downsample pyramid`
8. `Bloom upsample pyramid`
9. `Bloom composite`
10. `FXAA`
11. `Cascade Shadow Maps` デバッグ表示
12. `finalComposite`
13. submit

### 順序の理由

- `Contact Shadow` は depth / normal 依存の screen-space 補助影なので、scene color を暗化する最初の段に置く。
- `DoF` は scene color を先に被写界深度合成し、その結果を後段へ渡す。
- `Bloom` は DoF 合成後の scene color から高輝度抽出と blur を行い、その後 scene color に加算する。
- `Chromatic Aberration` は `FXAA` 無効時のみ `finalComposite` に畳み込む。
- `FXAA` は linear の状態で実行し、最後に `finalComposite` が display encoding を行う。

## 中間リソース仕様

`source/renderer-resources.js` の `createCanvasTargets` は以下を確保する。

- `renderTexture`
- `resolveTexture`
- `normalRenderTexture`
- `normalResolveTexture`
- `postEffectTextureA`
- `postEffectTextureB`
- `bloomDownsampleTextures[]`
- `bloomUpsampleTextures[]`
- `contactShadowMaskTexture`
- `depth24plus` texture

### フォーマット

- `scene normal`
  - `rgba16float`
- `bloom pyramid`
  - `rgba16float`
- `contact shadow mask`
  - `rgba32float`
- `depth`
  - `depth24plus`

### 解像度

- `Bloom` 用 pyramid は `canvas` の `1/2`, `1/4`, `1/8`, `1/16`, `1/32` 解像度を確保する。
- `Contact Shadow mask` はフル解像度。
- `postEffectTextureA/B` はフル解像度。

### usage

- `depth` は `GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING`。
- `scene normal` は描画後に sampled texture として参照できる。
- `Bloom` pyramid は render pass の sampled texture として使う。

## 各エフェクト仕様

### Gamma / Color Temperature

- `Gamma` と `Color Temperature` は常時 linear のまま保持し、`finalComposite` で display encoding する。
- `Gamma` スライダーは固定 2.2 に対する追加補正として扱う。
- `Bloom` 合成では gamma 補正をしない。
- `FXAA` 有効時は、`finalComposite` が `FXAA` 後の linear 画像へ display gamma を適用する。

### Bloom

- 高輝度抽出を `bloomExtract` で行う。
- 入力 color は DoF 合成後の scene color とする。
- blur は単一の大半径 blur ではなく、downsample / upsample の multi-scale pyramid で構成する。
- `bloomDownsample` は各レベルで小半径 blur を兼ねた縮小を行う。
- `bloomUpsample` は低解像度レベルを filtered sampling で順次加算し、広い glow を作る。
- 合成は `bloomComposite` で scene color に加算する。
- `bloomComposite` は最近傍復元ではなく filtered sampling を使う。
- `colorTemperature` と `gamma` は bloom composite 内では処理しない。

初期値は以下。

- `threshold: 0.98`  なお UI と shader の有効範囲は `0..appState.dynamicRange`
- `blurAmount: 2.0`  内部的には pyramid の有効レベル数と upsample 寄与に変換する
- `alpha: 1.0`

### Depth of Field

- `DoF` は depth を参照する screen-space エフェクト。
- `dofBlur` pass で blur 済み画像を作り、`dofComposite` で scene color と合成する。
- `DoF` 合成結果は後段の `Bloom` 入力になる。
- 入力深度は `canvasTargets.getDepthView(targetSampleCount)` から得る。
- `Focus Point` はワールド座標ベースで保持する。

#### アルゴリズム

- `fast`
- `depth-aware-gather`
- `thin-lens-multisample`

現行 UI で設定できるのは上記 3 種。

### Chromatic Aberration

- `chromaticAberration` が中立値でなく、かつ `FXAA` 無効時のみ `finalComposite` で適用する。
- `FXAA` 有効時は `chromaticAberration` を抑止する。
- `Bloom` / `DoF` の後段に置いた linear 結果へ `finalComposite` で適用する。

### Film Grain

- `filmGrainAmount` が 0 より大きいときに有効になる。
- `postEffects.enabled` とは独立に有効化できる。
- `FXAA` の有無に関わらず `finalComposite` で最終画にだけ乗る。
- `filmGrainAnimationMode` は以下。
  - `always`
  - `timeline`
- `timeline` はアニメーションの `currentFrame` に連動し、再生・スクラブ・書き出し時にだけ変化する。
- `always` は毎フレーム変化する。

### Contact Shadow

- `Contact Shadow` は `postEffects.enabled` と独立して有効化できる。
- 2 pass 構成を取る。
  - `contactShadowGenerate`
  - `contactShadowComposite`
- `depth` と `scene normal` を参照する screen-space shadow 補助である。

#### 入力

- `scene depth`
- `scene normal`
- `light direction`
- `length`
- `thickness`
- `intensity`
- `blurAmount`
- `stepCount`

#### 概要

- `contactShadowGenerate` でマスクを作る。
- `contactShadowComposite` で scene color に暗化として合成する。
- blur は composite shader 側で depth-aware に近い重み付けを行う。

#### 初期値

- `enabled: false`
- `length: 0.08`
- `thickness: 0.01`
- `intensity: 0.55`
- `blurAmount: 1.0`
- `stepCount: 8`

#### 制約

- 画面外遮蔽物は参照できない。
- 薄い髪や袖ではカメラ角度依存の抜けが起こりうる。
- `length` や `blurAmount` を大きくしすぎると、接触影ではなく広域な汚れに見えやすい。

## Screen Space SSS 仕様

### 位置づけ

`Screen Space SSS` は未実装であり、今後追加する仕様である。OpenMMD では人物肌、指、頬、鼻先などの硬い Lambert 陰影を和らげる目的で導入する。初期実装では耳の逆光透過や厚みベース backscatter は扱わない。

### 採用方式

初期実装では `Depth/Normal-aware separable blur` を採用する。

採用理由は以下。

- 現在の `scene color + depth + scene normal` 構成に自然に載せられる。
- `Bloom` や `DoF` と同様の fullscreen pass として実装できる。
- 追加リソースを最小限に抑えられる。
- MMD キャラクタ向けに「肌の硬さを少し和らげる」用途へ十分である。

### 実装方針

SSS は次の 3 段階で構成する。

1. `skin mask` を作る
2. `mask` 領域に対して depth / normal aware な横 blur を行う
3. 同じく縦 blur を行い、元画像へ低強度で合成する

### planner 追加案

将来的に planner へ以下を追加する。

- pass id
  - `sssBlurH`
  - `sssBlurV`
  - `sssComposite`
- texture slot
  - `sssPing`
  - `sssPong`

推奨順序は以下。

1. `contactShadowGenerate`
2. `contactShadowComposite`
3. `sssBlurH`
4. `sssBlurV`
5. `sssComposite`
6. `dofBlur`
7. `dofComposite`
8. `bloomExtract`
9. `bloomDownsample`
10. `bloomUpsample`
11. `bloomComposite`
12. `chromaticAberration`
13. `FXAA`

### 入力

- `scene color`
- `scene depth`
- `scene normal`
- `skin mask`
- `radius`
- `depthThreshold`
- `normalThreshold`
- `strength`

### `skin mask` の仕様

初期実装では新規 G-buffer は増やさず、以下のいずれかで skin 対象を判定する。

1. CPU 側で material に `isSkin` フラグを持たせ、別の低コスト mask 出力を追加する
2. 既存 material 情報から skin と判定できる条件を用意する

本命は `isSkin` フラグによる明示指定である。色推定だけで skin を自動判定すると、髪色や衣装色と誤判定しやすいため採用しない。

### アルゴリズム

- `scene color` を直接大きくぼかすのではなく、`skin mask` 内だけを拡散する。
- blur は separable 2 pass とする。
- サンプルごとに depth 差と normal 差を評価し、輪郭越えのにじみを抑える。
- 最終色は `mix(sceneColor, blurredSkinColor, strength * mask)` のように低強度で合成する。
- blur 半径はワールド距離固定ではなく、画面上ピクセル基準で始める。

### パラメータ初期値案

- `enabled: false`
- `radius: 1.5`
- `depthThreshold: 0.01`
- `normalThreshold: 0.2`
- `strength: 0.2`

### 制約

- screen-space なので、画面外からの拡散は扱えない。
- 耳の透過や逆光 backscatter は対象外。
- skin mask の品質が低いと顔の輪郭や口元が濁る。
- blur 半径を大きくしすぎると人形感が強くなる。

### UI 追加案

`Post Effects` タブに `Screen Space SSS` セクションを追加する。

- `Enabled`
- `Radius`
- `Depth Threshold`
- `Normal Threshold`
- `Strength`

数値 UI は既存ルールどおり `range + number` とする。

## 深度と法線の扱い

- `DoF` と `Contact Shadow`、将来の `SSS` は depth を sampled texture として使う。
- `Contact Shadow` と `SSS` は scene normal も参照する。
- このため post effect 系 screen-space 処理は、depth と normal を後段から参照できる前提で設計する。

### SSSS の mask resolve

- SSSS の raw mask は `skinMask` と `view-space depth` を保持する。
- SSSS の raw mask target には `max` blend を使わず、各 fragment の書き込みをそのまま保持する。
- SSSS の final mask は depth を参照して、前面に見えている fragment だけを残す。
- non-MSAA 時は raw mask と scene depth を照合する single-sample filter を通して final mask を作る。
- MSAA 時は main pass の multisampled raw mask をそのまま使わず、depth-aware resolve を通して single-sample の final mask texture に落とす。
- resolve は各 pixel の最前面 depth に一致する sample 群だけを採用する。

## テスト方針

### 現在の自動テスト

`tests/post-effect-planner.test.mjs` では少なくとも以下を検証している。

- `finalComposite` に集約された gamma / color temperature の振る舞い
- 中立値時に空プランになること
- `Bloom + DoF` の基本順序
- `Contact Shadow` 単独動作
- `Contact Shadow -> Bloom -> DoF` の順序
- `FXAA` 併用時の `finalColorSource`
- `Chromatic Aberration` の有効条件

### 追加すべきテスト

- `Screen Space SSS` 有効時の pass 順序
- `SSS` と `Contact Shadow` と `Bloom` の並び順
- `skin mask` 生成ロジック
- MSAA 時の SSSS mask resolve が前面 sample のみを残すこと
- depth / normal aware blur の重み関数

## 手動確認項目

- `Gamma` と `Color Temperature` が `Bloom` 有無で破綻なく `finalComposite` に集約されること。
- `FXAA` 有効時に `Chromatic Aberration` が過剰に二重適用されないこと。
- `Contact Shadow` が足裏、指、髪束の接近部でだけ効くこと。
- `DoF` の `Focus Point` ピックが狙った位置に合うこと。
- `Film Grain` が `always` と `timeline` で期待通りに変化すること。
- `Film Grain` が `FXAA` の有無に関わらず `finalComposite` にだけ乗ること。
- `Screen Space SSS` 追加後は、肌だけが軽く柔らかくなり、輪郭や髪へにじまないこと。

## 今後の整理候補

- `postEffects.enabled` が `Bloom` と `DoF` の共通マスターになっている設計は分かりにくい。将来的には各 effect の個別 enable を持たせる。
- `Gamma` と `Color Temperature` の適用経路は `finalComposite` に集約済み。将来的に tone mapping が必要になった場合のみ追加検討する。
- `Screen Space SSS` 導入時は `Contact Shadow` と同様に planner 主導で pass 追加できる形へ寄せる。
