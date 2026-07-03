# ポストエフェクトプランナー実装計画

## 目的

`source/render-loop.js` のポストエフェクト分岐を、設定に応じた実行計画へ置き換える。

目的は以下。

1. `render-loop` の if 分岐増加を抑える
2. エフェクト追加時の変更箇所を局所化する
3. on/off 切り替えのために動的シェーダ生成を導入せず、固定 pipeline のまま拡張可能にする
4. 将来 `DOF`、`色収差`、`グレイン`、`周辺減光`、`光芒` を追加しても描画経路を追いやすくする

## 結論

実装すべきなのは「シェーダビルダー」ではなく「ポストエフェクトプランナー」である。

- シェーダは原則として固定の WGSL と固定 pipeline を使う
- on/off は「そのパスを plan に含めるか」で制御する
- 最終合成系の軽量エフェクトは、可能な範囲で 1 本の composite pass に集約する
- 将来バリアントが必要になった場合も、まずは shader variant cache で対応する

## 現状の課題

`source/render-loop.js` はすでに以下の条件で描画経路を分岐している。

- `useFxaa`
- `useBloom`
- `useGammaOnly`
- `useMsaa`

この構造は `Bloom + FXAA + Gamma` までなら追えるが、今後 `DOF`、`色収差`、`グレイン`、`周辺減光`、`光芒` が入ると以下の問題が出る。

1. パス順序の判断が `render-loop` に直書きされる
2. 中間テクスチャの入出力関係が分かりにくくなる
3. 新規エフェクト追加のたびに複数条件を組み直す必要がある
4. `FXAA` やデバッグ描画との前後関係が壊れやすい

## 採用する設計

### 方針

描画処理を次の 3 層に分ける。

1. `render-loop`
   - フレーム単位の進行管理
   - メインシーン描画
   - planner の呼び出し
   - planner が返した pass 群の実行
2. `post effect planner`
   - 現在の state から必要な pass の配列を構築する
   - パス順序と入出力ターゲットを決める
3. `post effect executor / resources`
   - 各 pass に対応する pipeline と bind group を用意し、実際に encoder へ積む

### planner の責務

planner は以下だけを担当する。

1. どの pass を実行するか決める
2. どの順序で実行するか決める
3. 各 pass がどの texture view を入力に取り、どこへ出力するか決める
4. 最終出力が `FXAA` に入るのか、swapchain に直接出るのかを決める

planner は以下を担当しない。

- WGSL の生成
- pipeline の生成
- bind group の実作成
- GPU コマンドの直接記録

### pass の基本モデル

pass は少なくとも以下の情報を持つ plain object とする。

```js
{
  id: 'composite',
  kind: 'render',
  input: 'sceneColor',
  output: 'postEffectPing',
  enabled: true,
  paramsKey: 'composite',
}
```

初期実装では識別子を文字列で十分とし、複雑な class は導入しない。

### planner の返り値

`buildPostEffectPlan(state, options)` は以下のような構造を返す。

```js
{
  passes: [
    { id: 'bloomExtract', kind: 'render', input: 'sceneColor', output: 'bloomPing' },
    { id: 'bloomBlurH', kind: 'compute', input: 'bloomPing', output: 'bloomPong' },
    { id: 'bloomBlurV', kind: 'compute', input: 'bloomPong', output: 'bloomPing' },
    { id: 'composite', kind: 'render', input: 'sceneColor', output: 'postEffectOutput' },
  ],
  finalColorSource: 'postEffectOutput',
  needsFxaa: true,
}
```

ここで重要なのは、`render-loop` が `passes` を順に実行するだけでよくなること。

## 初期 pass 構成

初期導入では以下の pass を前提にする。

1. `bloomExtract`
2. `bloomBlurH`
3. `bloomBlurV`
4. `dofBlur` または `dofComposite`
5. `composite`
6. `fxaa`

ただし最初の段階では、すべてを一気に載せない。

### 第1段階で planner 化する対象

まずは既存機能だけを planner に載せる。

1. `gammaOnly`
2. `bloomExtract`
3. `bloomBlurH`
4. `bloomBlurV`
5. `bloomComposite`
6. `fxaa`

この段階で `render-loop` から `useBloom`、`useGammaOnly`、`useFxaa` の条件分岐を追い出す。

### 第2段階で composite へ統合する対象

以下は最終合成 pass にまとめる。

- 色温度
- ガンマ
- グレイン
- 周辺減光
- 色収差

理由は以下。

1. いずれも fullscreen の 1 パス処理で成立しやすい
2. 直列に別 pass へ分けるより、最終合成 1 回で済ませた方がコストと構造の両面で有利
3. bloom や DOF のような中間バッファ依存が強くない

### 第3段階で独立 pass を維持する対象

以下は独立 pass のまま扱う。

- bloom
- DOF
- 光芒

理由は、ぼかしや閾値抽出など中間テクスチャを明確に使い分ける必要があるため。

## ファイル構成案

### 新規追加

- `source/post-effect-planner.js`
  - state から pass plan を構築する
- `source/post-effect-constants.js`
  - pass id、texture slot 名、順序規則などを定義する
- `source/post-effect-executor.js`
  - plan を受け取り、各 pass を encoder に積む

### 既存更新

- `source/render-loop.js`
  - planner 呼び出しと executor 呼び出しに置き換える
- `source/renderer-gpu.js`
  - 各 pass 用 pipeline と bind group layout を生成する
- `source/renderer-resources.js`
  - planner が使う中間 texture slot を管理する
- `source/renderer.js`
  - `rendererState.postEffects` の既定値と更新処理を持つ

## 実装詳細

### 1. planner の入力

planner の入力は最小限でよい。

```js
{
  aaMode,
  msaaSampleCount,
  postEffects,
}
```

必要なら以下も追加する。

- `showCascadeShadowMaps`
- `internalResolution`
- `canvasWidth`
- `canvasHeight`

ただし planner は GPU リソース本体を触らない。入出力の論理名だけを扱う。

### 2. planner の出力ターゲット名

texture の論理名を固定する。

- `sceneColor`
- `postEffectPing`
- `postEffectPong`
- `postEffectOutput`
- `bloomPing`
- `bloomPong`
- `swapchain`

この命名を planner と executor で共有する。

### 3. planner の判断規則

初期の判断規則は単純でよい。

1. bloom が有効なら `bloomExtract -> bloomBlurH -> bloomBlurV` を入れる
2. bloom または色調整系が有効なら `composite` を入れる
3. `FXAA` が有効なら最後に `fxaa` を入れる
4. `FXAA` 無効時は最後の出力先を `swapchain` にする
5. 有効なポストエフェクトが何もない場合は、従来経路へフォールバックする

### 4. render-loop 側の変更方針

`source/render-loop.js` では以下の流れにする。

1. メインシーンを `sceneColor` へ描画する
2. planner を呼ぶ
3. `passes` を順に executor で処理する
4. `finalColorSource` が `swapchain` でなければ最後に必要な出力 pass を流す
5. debug overlay を最終出力へ重ねる

この形にすると `render-loop` は「何を描くか」ではなく「いつ planner を呼ぶか」に集中できる。

### 5. executor の責務

executor は以下を担当する。

1. pass id から pipeline を選ぶ
2. 論理 input/output 名から実 texture view を引く
3. 必要な bind group を作る
4. render pass または compute pass を encoder に積む

executor は planner の順序決定を上書きしない。

### 6. bind group 作成の扱い

現在の bloom 実装では frame ごとに bind group を生成している。これは初期段階では維持してよい。

ただし将来的には以下を整理候補とする。

1. サイズ変更時だけ再生成する bind group
2. 毎フレーム更新する uniform buffer
3. planner 非依存の pass resources

## 段階導入計画

### Phase 1: planner の土台導入

対象:

- `gammaOnly`
- `bloom`
- `fxaa`

作業:

1. `source/post-effect-planner.js` を追加する
2. `buildPostEffectPlan` のユニットテストを追加する
3. `render-loop` の既存分岐を planner 呼び出しへ置き換える
4. 見た目を変えずに既存機能を通す

完了条件:

- 現状と同じ条件で同じ pass 順になる
- `Bloom only`
- `FXAA only`
- `Bloom + FXAA`
- `Gamma only`
- `No post effect`
  の各経路が崩れない

### Phase 2: composite pass の導入

対象:

- 色温度
- ガンマ
- グレイン
- 周辺減光
- 色収差

作業:

1. `composite` 用 shader と pipeline を追加する
2. planner が `composite` pass を返せるようにする
3. 個別 on/off は uniform と `select` ベースの分岐で処理する
4. gamma 専用 pass は縮退または composite に統合する

完了条件:

- これらの軽量エフェクトが 1 本の最終合成 pass で切り替え可能
- `render-loop` に個別 if を増やさない

### Phase 3: DOF と光芒の追加

対象:

- `DOF`
- `光芒`

作業:

1. planner に依存関係付き pass を追加する
2. `bloom` ソースや depth ソースとの接続を planner で管理する
3. `renderer-resources` に必要な中間 texture を追加する

完了条件:

- pass の追加が `planner + executor + shader` の局所変更で済む
- `render-loop` に新しいエフェクト固有分岐を持ち込まない

## テスト計画

自動テストは planner のロジックへ寄せる。

### ユニットテスト対象

1. 何も有効でないとき、空 plan または従来経路扱いになる
2. `FXAA only` のとき `fxaa` のみが入る
3. `Bloom only` のとき `bloomExtract -> bloomBlurH -> bloomBlurV -> composite` になる
4. `Gamma only` のとき `composite` または `gammaOnly` のみが入る
5. `Bloom + FXAA` のとき `fxaa` が末尾に来る
6. `DOF + Bloom` のとき順序が仕様どおりになる

### 手動確認項目

1. `FXAA` の on/off で最終出力が崩れない
2. `Bloom` の on/off で入力テクスチャの取り違えがない
3. resize 後に中間バッファが正しく再生成される
4. `showCascadeShadowMaps` が最終表示へ正しく重なる

## リスクと対策

### リスク 1: planner と executor の責務が混ざる

対策:

- planner は論理名だけを返す
- GPUTextureView を planner に渡さない

### リスク 2: pass ごとの input/output 命名がぶれる

対策:

- texture slot 名を定数化する
- 文字列リテラルを `render-loop` へ散らさない

### リスク 3: composite pass に機能を詰め込みすぎる

対策:

- 1 パスへ寄せるのは軽量な最終色調整系だけに限定する
- `DOF` と `光芒` は独立 pass を維持する

### リスク 4: 将来 variant が必要になる

対策:

- まずは単一 composite で開始する
- 実測で問題が出たら `feature flags -> cache key` 方式の variant cache を導入する
- 最初から自由な shader builder は作らない

## 実装順の推奨

1. `post-effect-planner.js` の追加
2. planner のユニットテスト追加
3. `render-loop.js` の分岐を planner + executor へ移動
4. 既存 `Bloom` / `Gamma` / `FXAA` を planner 管理へ移行
5. `composite` pass を追加
6. 色温度、グレイン、周辺減光、色収差を `composite` へ統合
7. `DOF` と `光芒` を追加

## この計画で避けるもの

今回の計画では以下をやらない。

- on/off のたびの WGSL 文字列生成
- エフェクト組み合わせごとの pipeline 全列挙
- planner に GPU リソース生成責務を持たせること
- `render-loop` に新しいエフェクト固有 if を増やし続けること

## 期待される最終形

最終的には以下の構造を目指す。

1. `render-loop` はメイン描画と全体進行だけを見る
2. `planner` は描画順序の決定だけを見る
3. `executor` は pass 実行だけを見る
4. 新規エフェクト追加時は、基本的に `planner`、対応 shader、対応 resources の追加で完結する

この構造であれば、ポストエフェクトの拡張性を確保しつつ、シェーダビルダー導入を急ぐ必要はない。
