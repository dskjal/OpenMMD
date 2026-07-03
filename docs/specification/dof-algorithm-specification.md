# DoF Algorithm Specification

Circle of confusion (CoC) は錯乱円。

## 概要

Depth of Field に 3 つのアルゴリズムを追加する。

- `fast`
  - 既存の高速方式
  - デフォルト
  - 事前にぼかしたシーンと原画像を CoC で補間する
- `depth-aware-gather`
  - CoC ベースの depth-aware gather DOF
  - 深度差と sample 側 CoC を見ながら周辺画素を gather する
- `thin-lens-multisample`
  - 薄レンズモデルの多サンプルレンダリングを screen-space で近似した高品質方式
  - aperture 形状を意識した多サンプル gather を行う

## UI

`index.html` の被写界深度パネルに `Algorithm` の `select` を追加する。

- `Fast`
- `Depth-Aware Gather`
- `Thin Lens Multisample`

初期値は `Fast` とする。

## 状態管理

`postEffects` に `dofAlgorithm` を追加する。

- 型は `string`
- 取りうる値は `fast` / `depth-aware-gather` / `thin-lens-multisample`
- 不正値は `fast` に正規化する

## GPU Uniform

`source/dof-physics.js` の DoF uniform に以下を追加する。

- `algorithm`
  - shader 側の分岐用 ID
- `sampleCount`
  - アルゴリズムごとの固定サンプル数
- `maxBlurRadius`
  - 最大ボケ半径
- `cocBlendScale`
  - CoC から blend を作る係数

品質プリセットは UI には露出せず、アルゴリズム選択時に固定値として使う。

- `fast`
  - `sampleCount = 16`
  - `maxBlurRadius = 48`
- `depth-aware-gather`
  - `sampleCount = 24`
  - `maxBlurRadius = 56`
- `thin-lens-multisample`
  - `sampleCount = 32`
  - `maxBlurRadius = 64`

## 描画仕様

既存の `DOF_BLUR` と `DOF_COMPOSITE` の 2 パス構成は維持する。

### fast

- `DOF_BLUR`
  - 既存どおり blur したシーンを生成する
- `DOF_COMPOSITE`
  - 深度から CoC を求める
  - 原画像と blur 画像を CoC ベースで補間する

### depth-aware-gather

- `DOF_BLUR`
  - 実質的に source copy として使う
- `DOF_COMPOSITE`
  - 中心画素の CoC を求める
  - Vogel disk 配置で周辺を gather する
  - sample ごとに深度を参照し、前景のにじみを抑える
  - sample 側 CoC と中心 CoC の整合性を重みに使う

### thin-lens-multisample

- `DOF_BLUR`
  - 実質的に source copy として使う
- `DOF_COMPOSITE`
  - 中心画素の CoC を求める
  - aperture を意識した disk sample を多めに打つ
  - 画素ごとに回転 jitter を変えてサンプル配置を固定ノイズ化する
  - 輝度の高い sample をやや強く残して bokeh 感を出す
  - 深度差で foreground bleed を抑える

## 互換性

- 既存のポストエフェクト有効化仕様は維持する
- デフォルトは `fast` なので、既存ユーザーの見た目と負荷は原則据え置き
- planner の pass 構成は変えない

## テスト

- `tests/dof-physics.test.mjs`
  - `dofAlgorithm` の正規化
  - uniform への algorithm quality preset の反映

## 補足

`thin-lens-multisample` は現行の post-process パイプライン上では厳密な幾何ベース再レンダリングではなく、screen-space 近似として実装する。動画書き出し向けに品質優先とし、リアルタイム負荷は高い前提とする。
