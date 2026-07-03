# タイムライン実装計画

添付画像は `docs/plans/timeline.jpg` 。

## 目的

`index.html` の `div id="left-sidebar"` に、添付画像のような MMD 系タイムラインを表示する。

初期段階では以下を満たす。

- 現在選択中モデルの VMD 内容を可視化できる
- ボーン、表情、カメラ、照明、セルフ影のトラックを縦方向に並べられる
- フレーム目盛りとキーフレームを横方向に表示できる
- 再生状態と現在フレームをタイムラインに反映できる
- 将来の編集機能追加に耐える構造にする

## 前提

- タイムラインは `left-sidebar` の既存アニメーション UI の下に配置する
- UI 技術は既存方針に合わせて `html` `css` `javascript` の素朴な構成で実装する
- グリッド本体は DOM ではなく `canvas` で描画する
- 左のトラック名列と上部の時間ヘッダは別レイヤに分離する
- 最初の実装では「表示」と「再生追従」を優先し、編集操作は段階的に追加する

## 採用方針

添付画像のようなタイムラインは、全セルを DOM で並べるとフレーム数とトラック数の増加で破綻しやすい。したがって以下の 3 分割構成を採用する。

- ヘッダ: フレーム番号と縦グリッド基準線を管理
- トラック名列: トラック名を固定表示
- グリッド本体: キーフレーム、現在フレーム線、選択状態を `canvas` 描画

この構成であれば、スクロール同期、ズーム、ヒットテスト、将来のドラッグ編集を追加しやすい。

## 既存実装との接続点

### 既存 UI

- `index.html`
  - `left-sidebar` に VMD 保存、VMD 選択、再生ボタンがある
  - 左ペインは横幅リサイズ対応済み
- `source/renderer-ui.js`
  - VMD 選択、再生、停止、巻き戻しの UI ハンドラがある
- `source/renderer.js`
  - `modelManager` `vmdManager` `selection` を UI 層へ渡している

### 既存データ

- `source/animation.js`
  - `AnimationController` が `currentFrame` と `maxFrame` を持つ
  - `setVmd()` 時にボーンと表情のキーフレームを整理している
- `source/loader/vmd-loader.js`
  - `boneKeyframes`
  - `faceKeyframes`
  - `cameraKeyframes`
  - `lightKeyframes`
  - `selfShadowKeyframes`
  を読み込む
- `source/loader/vmd-writer.js`
  - 上記カテゴリを保存できる

したがって、タイムライン表示に必要な元データはすでに存在する。

## 実装対象ファイル

### 新規追加候補

- `source/timeline.js`
  - タイムライン状態管理、描画、スクロール同期、ヒットテスト
- `source/timeline-data.js`
  - VMD とモデルから表示用トラック配列を生成

### 変更対象候補

- `index.html`
  - `left-sidebar` 内にタイムライン用コンテナを追加
  - タイムライン用 CSS を追加
- `source/renderer-ui.js`
  - タイムライン初期化
  - アクティブモデル切り替え時のタイムライン更新
  - 再生、停止、巻き戻し後のタイムライン更新
- `source/renderer.js`
  - タイムラインインスタンス生成
  - 描画ループまたは UI 更新ループとの接続
- 必要なら `source/render-loop.js`
  - 再生中の `currentFrame` 変化に追従してタイムラインを再描画

## UI 構成案

`left-sidebar` 内の構造を以下のようにする。

```html
<div id="left-sidebar">
  <section id="animation-panel">...</section>
  <section id="timeline-panel">
    <div id="timeline-toolbar"></div>
    <div id="timeline-root">
      <div id="timeline-corner"></div>
      <div id="timeline-header"></div>
      <div id="timeline-track-list"></div>
      <div id="timeline-scroll">
        <canvas id="timeline-canvas"></canvas>
      </div>
    </div>
  </section>
</div>
```

### レイアウト要点

- `left-sidebar` を縦 flex にし、上部のアニメーション操作と下部のタイムラインを分離
- `timeline-panel` は `flex: 1` で残り高さいっぱいに広げる
- `timeline-header` と `timeline-track-list` は固定表示
- `timeline-scroll` だけをスクロールコンテナにする

## データモデル案

タイムライン描画専用の軽量データへ変換する。

```js
/**
 * @typedef {object} TimelineKeyframe
 * @property {number} frame
 * @property {string} kind
 * @property {number} sourceIndex
 */

/**
 * @typedef {object} TimelineTrack
 * @property {string} id
 * @property {string} label
 * @property {string} category
 * @property {TimelineKeyframe[]} keyframes
 * @property {boolean} expanded
 */
```

### トラック構成

- ルート集約トラック
  - `表示・IK・外親`
  - `表情`
  - `IK`
  - `体`
  - `腕`
  - `指`
  - `髪`
- 実トラック
  - ボーンごと
  - 表情モーフごと
  - カメラ
  - 照明
  - セルフ影

初期表示は、添付画像の印象に合わせてカテゴリ行を上に置き、その下に個別トラックを並べる。

## 描画仕様

### 1. 時間ヘッダ

- 5 フレームごとにラベル表示
- 1 フレームごとに細線
- 5 フレームごとに強調線
- 50 フレームごとにさらに強い区切り線を入れてもよい

### 2. トラック一覧

- 1 行の高さは固定値
- カテゴリ行は背景色を変える
- 選択中トラックはハイライトする

### 3. グリッド本体

- 背景格子
- キーフレーム記号
  - ボーン: ひし形
  - 表情: バツまたは四角
  - その他: 色分け
- 現在フレーム位置の縦線
- 選択範囲は半透明オーバーレイ

### 4. 仮想化

描画は可視範囲だけに限定する。

- 横方向: `scrollLeft` と `pixelsPerFrame` から可視フレーム範囲を計算
- 縦方向: `scrollTop` と `rowHeight` から可視トラック範囲を計算

これにより、長尺 VMD やボーン数の多いモデルでも負荷を抑えられる。

## 状態管理案

`TimelineView` 相当のクラスで以下を保持する。

- `tracks`
- `currentFrame`
- `maxFrame`
- `pixelsPerFrame`
- `rowHeight`
- `scrollLeft`
- `scrollTop`
- `selectedTrackId`
- `selectedKeyframe`

更新 API の例。

- `setSource(modelInstance, vmdData)`
- `setCurrentFrame(frame)`
- `setPlaybackState(isPlaying)`
- `resize()`
- `render()`

## イベント設計

### 初期段階で必要

- `vmd-list` 変更時
  - アクティブモデルの VMD に合わせてトラック再構築
- モデル切り替え時
  - トラック再構築
- 再生中
  - `currentFrame` に追従して現在フレーム線を更新
- 巻き戻し時
  - フレーム 0 に同期
- `left-sidebar` リサイズ時
  - `canvas` 再サイズ

### 次段階で追加

- ホイールで横スクロールまたはズーム
- クリックでキーフレーム選択
- ドラッグでフレーム移動
- ダブルクリックまたは右クリックでキー追加、削除

## 実装ステップ

### フェーズ 1: 土台

- `index.html` にタイムラインコンテナを追加
- `left-sidebar` 内のレイアウトを調整
- タイムライン専用 CSS を定義
- `source/timeline.js` に最小 `TimelineView` を追加

完了条件:

- 空状態でもレイアウトが崩れない
- `left-sidebar` のリサイズに追従する

### フェーズ 2: 読み取り専用タイムライン

- `source/timeline-data.js` で VMD からトラック配列を作る
- `boneKeyframes` `faceKeyframes` `cameraKeyframes` `lightKeyframes` `selfShadowKeyframes` を可視化
- ヘッダ、トラック名、グリッド本体を描画する

完了条件:

- VMD を選ぶとタイムラインにキーが出る
- カテゴリごとに視認しやすく整理される

### フェーズ 3: 再生同期

- `AnimationController.currentFrame` をタイムラインへ反映する
- 再生中は現在フレーム線のみを軽量更新する
- `rewind` 時に表示が即座に戻る

完了条件:

- 再生ボタン操作とタイムライン表示が一致する
- 無駄な全再描画を避けられる

### フェーズ 4: スクロールとズーム

- 横スクロール
- 縦スクロール
- 5 フレーム刻みを保ったズーム
- ヘッダとトラック名の同期

完了条件:

- 長い VMD でも目的フレームへ移動できる
- 添付画像に近い操作感になる

### フェーズ 5: 選択操作

- キーフレームのヒットテスト
- トラック選択
- キー選択状態の描画
- 選択されたキーがボーンの場合は、対象のボーンを選択状態にする

完了条件:

- マウスでキーを識別できる
- 将来の編集機能追加に必要な選択状態が確立される

### フェーズ 6: 編集機能

- キー追加
- キー削除
- キードラッグ移動
- VMD データへの反映
  - VMD がロードされていない場合、内部データを適切に初期化する
    - signatuer: "Vocaloid Motion Data 0002"
    - model name: 現在選択されているモデル名
- 保存時に `VMDWriter` へ渡る構造を更新

この段階は別タスクとして切り出してよい。まずは読み取り専用と再生同期までを優先する。

## 既存コードへの組み込み方針

### `source/renderer.js`

- 起動時に `TimelineView` を生成する
- アクティブインスタンス変更時に `TimelineView.setSource()` を呼ぶ
- VMD ロード後にタイムライン再構築を呼ぶ

### `source/renderer-ui.js`

- `play` `stop` `rewind` ハンドラ内でタイムライン同期を呼ぶ
- `updateVmdListUI()` と同じ責務分離で、`updateTimelineUI()` を追加してよい

### `source/render-loop.js`

- 毎フレームのレンダーループ中で `currentFrame` の変化だけ監視し、差分更新する
- 再生停止中は不要な再描画を避ける

## テスト計画

`./tests/` に以下の観点を追加する。

### 単体テスト

- VMD からタイムライントラックへ変換する関数
- フレーム範囲計算
- 可視トラック範囲計算
- キーフレームのヒットテスト

### 結合確認

- VMD ロード後にタイムラインへ反映される
- モデル切り替えでトラック内容が切り替わる
- 再生、停止、巻き戻しでフレーム線が一致する
- VMD が未選択でもクラッシュしない

### 目視確認

- 添付画像に近い密度で表示できる
- `left-sidebar` 幅を変更しても破綻しない
- トラック数が多くてもスクロールが滑らか

## リスクと対策

### リスク 1: DOM 過多で重くなる

対策:

- グリッド本体とキーフレームは `canvas` 描画に限定する

### リスク 2: フレーム更新で毎回全体再描画して重くなる

対策:

- 再生中は現在フレーム線だけを別レイヤで描くか、差分更新する

### リスク 3: トラック分類がモデルごとに不安定

対策:

- まずはカテゴリ分けルールを単純化し、既知の日本語ボーン名に対して段階的に改善する

### リスク 4: タイムライン編集とアニメーション再生が競合する

対策:

- 読み取り専用フェーズと編集フェーズを分離する

## 実装優先順位

1. レイアウト追加
2. 読み取り専用タイムライン表示
3. 再生フレーム同期
4. スクロールとズーム
5. 選択
6. 編集

## 最初の実装スコープ

最初のマージ対象は以下に限定するのが安全。

- `left-sidebar` へのタイムライン表示
- VMD データの読み取り専用表示
- 現在フレーム線の同期
- スクロール対応

キー編集、補間編集、複数選択、範囲選択は後続に回す。

## 補足

添付画像ではカテゴリ行と個別ボーントラックが混在している。これを完全再現しようとすると編集仕様まで引っ張られるため、初期実装では「見た目を寄せつつ内部構造は将来の編集に耐える」方針を取るのが妥当。

### パフォーマンス

Virtual scrolling を実装しないとカンバスをズームしたときに、実用不可能なパフォーマンスの低下が発生する。