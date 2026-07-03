# タイムライン/アニメーション管理リファクタリング計画

## 目的

タイムライン操作、再生制御、フレーム移動、VMD 差し替え、キーフレーム登録の責務を整理し、状態変更の入口を一本化する。

特に以下を解消する。

- UI ボタン経由とキーボードショートカット経由で別のコードパスからフレーム移動している
- タイムライン操作が `AnimationController` の内部状態を直接書き換えている
- タイムライン再構築と UI 同期が `renderer.js` `renderer-ui.js` に散在している
- フレーム移動時に無効化すべき手動補正値の扱いが一元管理されていない

## 対象範囲

変更対象の主候補は以下。

- `source/animation.js`
- `source/timeline.js`
- `source/timeline-data.js`
- `source/renderer.js`
- `source/renderer-ui.js`
- `source/renderer-interaction.js`
- `source/render-loop.js`
- `source/vmd-manager.js`
- 必要なら新規 `source/timeline-manager.js`

今回のリファクタリング対象外:

- `source/langs`
- `source/lib`
- `source/licenses`
- `source/loader`
- `source/shaders`
- `source/camera.js`
- `source/ik.js`
- `source/material-resources.js`
- `source/math-utils.js`
- `source/model-debug-draw.js`

## 現状の問題点

### 1. フレーム移動の入口が分散している

- UI ボタンは `source/renderer-ui.js:215-259` で `animationController.rewind()` `stepFrame()` `stepNextKeyframe()` などを直接呼んでいる
- キーボード操作は `source/renderer-interaction.js:41-52` で `animationController.stepFrame()` を直接呼んでいる
- タイムラインドラッグは `source/renderer.js:512-516` で `animationController.currentFrame` を直接代入している

同じ「1 フレーム進める」「特定フレームへ移動する」操作でも、経路ごとに副作用の扱いが揃っていない。

### 2. 状態変更と UI 同期が混在している

- `source/renderer.js:373-384` で `refreshScene()` がタイムライン表示更新まで担っている
- `timelineView.setSource()` は `loadZipModel()` `loadVmd()` `activateInstance()` `addNewModel()` `registerBoneKeyframe()` `renderer-ui.js` の複数箇所から呼ばれている

結果として、「状態を変える処理」と「表示に反映する処理」の境界が曖昧になっている。

### 3. `AnimationController` の公開 API が不揃い

`source/animation.js:99-179` には `rewind()` `goToEnd()` `stepFrame()` `stepNextKeyframe()` `stepPreviousKeyframe()` がある一方で、タイムラインからのシークは setter ではなく `currentFrame` 直接代入になっている。

このため、フレーム移動時に必須の処理:

- キャッシュインデックスのリセット
- 再生状態との整合
- 手動補正値の無効化

が呼び出し側依存になっている。

### 4. 手動補正値の扱いが未統合

- `source/renderer.js` 末尾に `invalidateManualValues()` があるが、実運用経路に組み込まれていない
- 仕様上、タイムライン移動後は `manualTranslation` `manualRotation` `manualWeight` の扱いを統一したい

フレーム移動と手動編集が競合したときの期待挙動がコード上に固定化されていない。

### 5. `refreshScene()` の責務が大きい

`refreshScene()` は以下をまとめて行っている。

- `modelManager.update()` 呼び出し
- 選択中ボーン UI 更新
- ボーン入力欄更新
- タイムラインの現在フレーム同期
- タイムラインの選択トラック同期

このため、単なる「フレームを 1 進める」操作でも UI 更新規約まで暗黙依存になる。

## リファクタリング方針

### 1. 状態変更の入口を `TimelineManager` に集約する

新規に `source/timeline-manager.js` を追加し、タイムラインとアニメーションに関するユーザー操作をここへ集約する。

`TimelineManager` の責務:

- アクティブインスタンスの取得
- フレーム移動 API の一本化
- 再生開始/停止の一本化
- VMD 差し替え後の再同期
- タイムライン表示データの再構築契機の管理
- 必要時の手動補正値無効化
- 画面更新要求の発火

### 2. `AnimationController` は「モデル単位の再生エンジン」に限定する

`AnimationController` には以下だけを持たせる。

- VMD の保持
- キーフレーム探索キャッシュ
- 現在フレーム
- 再生中更新
- ボーン/モーフ補間

UI やタイムライン都合の分岐は持ち込まない。

### 3. `TimelineView` は表示コンポーネント化する

`TimelineView` は以下に限定する。

- トラック描画
- 現在フレーム線描画
- キーフレーム選択イベント通知
- フレームドラッグイベント通知

`AnimationController` や `modelManager` に直接触れない。

### 4. `renderer.js` は配線に寄せる

`renderer.js` では以下を直接やらない方針にする。

- UI 操作ごとのフレーム移動ロジック
- VMD 差し替え後の個別タイムライン更新
- タイムラインからのフレーム代入

代わりに `TimelineManager` の生成、依存注入、描画ループ接続に寄せる。

## 目標構成

### 新規モジュール案

`source/timeline-manager.js`

```js
/**
 * タイムラインとアニメーション再生を仲介する管理クラス。
 */
export class TimelineManager {
  constructor(options) {}
  togglePlayback() {}
  seek(frame, options = {}) {}
  stepFrame(delta, options = {}) {}
  stepKeyframe(direction, options = {}) {}
  rewind() {}
  goToEnd() {}
  setActiveInstance(index) {}
  assignVmdToActiveInstance(vmd, vmdName) {}
  rebuildTimelineSource() {}
  registerBoneKeyframe() {}
  registerMorphKeyframe(name, weight) {}
  syncViewState() {}
}
```

### 依存関係の整理

- `renderer-ui.js`
  - DOM イベントを `TimelineManager` へ委譲
- `renderer-interaction.js`
  - キーボードの矢印操作を `TimelineManager.stepFrame()` へ委譲
- `timeline.js`
  - `onFrameChanged` `onKeyframeSelected` で `TimelineManager` を呼ぶ
- `renderer.js`
  - `TimelineManager` を生成し、`refreshScene` と UI 更新コールバックを注入

## API 設計案

### `AnimationController` に追加/統一する API

`currentFrame` 直接代入をやめ、以下へ寄せる。

- `seek(frame)`
- `stepFrame(delta)`
- `stepNextKeyframe()`
- `stepPreviousKeyframe()`
- `rewind()`
- `goToEnd()`
- `play()`
- `stop()`
- `togglePlayback()`

`seek(frame)` は最低限以下を保証する。

- フレームの clamp
- キャッシュリセット
- `lastFrameTime` の整合

### `TimelineManager` の副作用ポリシー

フレーム移動系 API は共通で以下を通す。

1. アクティブインスタンスを取得
2. `AnimationController` の公開 API を呼ぶ
3. 必要なら手動補正値を無効化する
4. タイムライン表示状態を同期する
5. シーン更新を要求する

これで UI ボタン、キーボード、タイムラインドラッグの副作用を揃える。

## 実施ステップ

### フェーズ 0: ベースライン固定

- 現状挙動を確認するメモを残す
- 以下の操作の期待結果を決める
  - UI ボタンで 1 フレーム進む
  - キーボード左右で 1/10 フレーム進む
  - タイムラインドラッグで任意フレームへ移動する
  - 再生中にモデル切り替えする
  - 手動ボーン補正後にフレーム移動する

### フェーズ 1: `AnimationController` の移動 API 整備

- `seek(frame)` を追加する
- `rewind()` `goToEnd()` `stepFrame()` `stepNextKeyframe()` `stepPreviousKeyframe()` を `seek()` ベースに整理する
- `currentFrame` 直接代入箇所を段階的に禁止する

完了条件:

- `source/renderer.js:512-516` の直接代入を除去できる

### フェーズ 2: `TimelineManager` 新設

- `source/timeline-manager.js` を追加する
- フレーム移動、再生切り替え、VMD 差し替え、タイムライン再構築を集約する
- `refreshScene()` を直接呼ぶ場所を減らし、`TimelineManager` 経由に寄せる

完了条件:

- UI ボタンとキーボードが同じ API を通る
- タイムラインドラッグも同じ API を通る

### フェーズ 3: `TimelineView` と UI 層の責務削減

- `renderer-ui.js` から `animationController` 直接操作を取り除く
- `renderer-interaction.js` から `animationController` 直接操作を取り除く
- `timelineView.setSource()` の呼び出し箇所を `TimelineManager.rebuildTimelineSource()` に集約する

完了条件:

- タイムライン再構築の呼び出し元が限定される
- `renderer.js` のイベントハンドラが薄くなる

### フェーズ 4: 手動補正値の規約化

- `invalidateManualValues()` を `TimelineManager` 管理下へ移す
- どの操作で補正を消すかを明文化する

推奨規約:

- フレーム移動時は `manualTranslation` `manualRotation` `manualWeight` を無効化する
- 同一フレーム内の選択変更では無効化しない
- キーフレーム登録時は無効化しない

完了条件:

- 手動編集とタイムライン移動の競合規約がコードに固定される

### フェーズ 5: `refreshScene()` の分割

`refreshScene()` を少なくとも以下へ分割する。

- `updateSceneState()`
- `syncInspectorUi()`
- `syncTimelineUi()`

`render-loop.js` は毎フレーム `updateSceneState()` を呼び、ユーザー操作起点では必要な同期だけを呼べる構成に寄せる。

完了条件:

- 状態更新と UI 同期の責務が分かれる
- 不要な再同期を減らせる

## 変更ファイルごとの方針

### `source/animation.js`

- 公開 API の整理
- `seek()` 追加
- `currentFrame` を外部から直接触らせない前提へ寄せる

### `source/timeline.js`

- View 専用に寄せる
- 外部状態の保持を最小化する
- イベント通知名を意味ベースに整理する

### `source/renderer-ui.js`

- ボタンイベントからビジネスロジックを除去する
- `TimelineManager` 呼び出しだけにする

### `source/renderer-interaction.js`

- 矢印キーによるフレーム移動を `TimelineManager` 呼び出しへ統一する

### `source/renderer.js`

- 初期化配線のみに寄せる
- `timelineView` と `TimelineManager` の橋渡しを行う
- キーフレーム登録処理も可能なら `TimelineManager` に移す

### `source/render-loop.js`

- 毎フレーム実行すべき更新だけを残す
- タイムライン同期の責務を必要最小限にする

## テスト計画

追加候補:

- `tests/animation-controller.test.mjs`
  - `seek()` の clamp
  - `seek()` 後のキャッシュリセット
  - `stepFrame()` と `seek()` の整合
- `tests/timeline-manager.test.mjs`
  - UI ボタン相当操作とキーボード相当操作が同じ副作用になる
  - タイムラインドラッグが `seek()` 経由になる
  - VMD 差し替え時にタイムライン再構築が一度だけ走る
  - フレーム移動時に手動補正値が無効化される

手動確認項目:

- UI ボタンとキーボードで同じフレーム位置になる
- タイムラインの赤線とインスペクタ表示が一致する
- キーフレーム登録後に現在フレームが保持される
- 再生ループ中にタイムライン表示が追従する

## リスクと注意点

- `AnimationController.update()` と物理演算リセット条件の関係は壊しやすいので、`jumped` の意味を維持する
- モデルごとに `AnimationController` を持っているため、`TimelineManager` は「全体管理」ではなく「アクティブインスタンス操作の窓口」として設計する
- 将来カメラ/照明/セルフ影の編集を入れるなら、最初から API 名をボーン専用にしすぎない
- 新規コードは既存方針どおり JSDoc スタイルで記述する

## この計画の完了条件

以下を満たせば、このリファクタリングは完了とする。

- フレーム移動 API の入口が `TimelineManager` に集約されている
- `currentFrame` の直接代入がなくなっている
- `timelineView.setSource()` の呼び出し箇所が限定されている
- UI ボタン、キーボード、タイムライン操作で副作用が一致している
- 手動補正値の無効化規約がコードとテストに反映されている
