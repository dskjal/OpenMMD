# ギズモ実装計画

## 目的

選択中ボーンの位置にギズモを表示し、ドラッグ操作で `manualRotation` と `manualTranslation` をリアルタイム更新できるようにする。

対象は以下の 2 系統。

- 回転ギズモ
  - 選択ボーンのローカル XYZ 軸に対応する円を表示
  - 色は X: 赤, Y: 緑, Z: 青
  - 円は見た目は `model-debug-draw.js` のオーバーレイ描画に統合し、当たり判定は平面交点 + 半径帯チェックで扱う
- 移動ギズモ
  - 回転ギズモの外側にローカル XYZ 軸方向の矢印を表示
  - 色は X: 赤, Y: 緑, Z: 青
  - ドラッグで対応するローカル位置を更新する

## 前提

- MMD ローダーは左手系から右手系へ変換済みなので、ギズモ実装は既存の右手系前提でよい
- ボーンの手動補正は既に `manualTranslation` `manualRotation` に集約されている
- 描画ループは毎フレーム `refreshScene()` を呼んでいるため、ギズモ操作中は state 更新だけでリアルタイム反映できる

## 再利用方針

既存コードに再利用可能な部品が揃っている。新規実装はこれらの上に薄く積む。

### 1. 描画

- `source/model-debug-draw.js`
  - 選択ボーンのワールド位置と `worldRotation` を使った円表示の既存実装がある
  - `createBoneIndicatorVertices()` の発想を流用し、ギズモ専用の頂点生成関数を追加する
  - 既存の overlay pipeline にそのまま載せる

### 2. 選択位置と軸情報

- `source/model-scene.js`
  - `scene.boneWorldPositions[index]`
  - `scene.boneLocalTransforms[index].worldRotation`
  - `scene.boneLocalTransforms[index].localX/localY/localZ`
  - `scene.boneLocalTransforms[index].manualTranslation/manualRotation`

### 3. ポインター入力と投影

- `source/renderer-interaction.js`
  - `getRayFromMouse()`
  - `projectDistanceToPointer()`
  - 既存の `setupInputHandlers()` にギズモの pointerdown/move/up 処理を統合する

### 4. 座標変換

- `source/ik.js`
  - `worldDeltaToLocalDelta()` を移動ギズモのワールド移動量からローカル移動量への変換に再利用する
- `source/renderer.js`
  - ボーン UI 入力の `manualRotation` 算出ロジックを参照し、回転ギズモでも `manualRotation` 更新規約を揃える

### 5. 数学ユーティリティ

- `source/math-utils.js`
  - `mat4Invert()` `mat4Vec4Mul()` `cross()` `normalize()` `clamp()` は流用可能
- 不足分は `source/gizmo.js` 側に閉じた小さなヘルパーとして追加する
  - レイと平面の交点
  - レイと線分/軸の最短距離
  - 平面交点の半径帯チェック
  - 軸周り signed angle

## 追加する責務

新規 `source/gizmo.js` を追加し、ギズモの状態管理・ヒット判定・ドラッグ更新を集約する。

想定責務:

- 選択中ボーンに対するギズモ状態の算出
- 回転リングと移動矢印の頂点生成
- ポインターレイに対するヒット判定
- ドラッグ開始時の初期情報の保持
- ドラッグ中の `manualRotation` / `manualTranslation` 更新
- 描画用バッファ更新に必要なデータ供給

`renderer-interaction.js` にロジックを分散させすぎないため、入力イベント側は「ギズモに渡して結果を適用する」だけに寄せる。

## API 案

`source/gizmo.js` に以下のような API を持たせる。

```js
/**
 * ギズモ状態を生成します。
 */
export function createGizmoState() {}

/**
 * 選択ボーンに対応するギズモ記述を返します。
 */
export function getActiveGizmo(instance, selection) {}

/**
 * ギズモ描画用の頂点列を生成します。
 */
export function buildGizmoVertices(instance, selection, options = {}) {}

/**
 * ポインターレイでギズモをヒットテストします。
 */
export function pickGizmo(ray, instance, selection, options = {}) {}

/**
 * ドラッグを開始します。
 */
export function beginGizmoDrag(state, hit, instance, selection, ray) {}

/**
 * ドラッグ中の更新を行います。
 */
export function updateGizmoDrag(state, instance, selection, ray) {}

/**
 * ドラッグを終了します。
 */
export function endGizmoDrag(state) {}
```

状態は最小限でよい。

- `mode`: `rotate` or `translate`
- `axis`: `x` `y` `z`
- `boneIndex`
- `startWorldHit`
- `startManualRotation`
- `startManualTranslation`
- `dragPlaneNormal`
- `dragAxisWorld`
- `dragAxisLocal`

## 描画設計

### 1. 追加先

ギズモはボーン表示と同じ overlay pipeline を使う。

- 追加候補 1: `model-debug-draw.js` にギズモ頂点生成を追加
- 追加候補 2: `gizmo.js` で頂点生成し `model-debug-draw.js` は buffer update のみ担当

責務分離のため、頂点生成は `gizmo.js`、GPU buffer への書き込みは `model-debug-draw.js` か `ModelManager` 側に残す方がよい。

### 2. 回転ギズモ

- 中心は `scene.boneWorldPositions[selectedBoneIndex]`
- 各リングの向きは `scene.boneLocalTransforms[selectedBoneIndex].worldRotation`
- 半径は既存の選択リングより少し大きくする
- 見た目は線でもよいが、ヒット判定用には平面交点を使って半径 `r` の帯に入るかを判定する

各軸の平面:

- X リング: 法線 = ボーンのワールド X 軸
- Y リング: 法線 = ボーンのワールド Y 軸
- Z リング: 法線 = ボーンのワールド Z 軸

### 3. 移動ギズモ

- 回転リングの外側から開始する軸線を描く
- 先端に円錐ワイヤーを付ける
- 軸線と円錐もワールド回転はボーンの `worldRotation` に追従させる

## ヒット判定設計

## 1. pointerdown の優先順位

選択済みボーンにギズモが表示されている場合、通常のボーン選択より先にギズモヒット判定を行う。

順序:

1. ギズモ
2. 物理剛体
3. IK ターゲット
4. ボーン
5. モデル AABB

これで、選択ボーン上にギズモが出ていてもドラッグ開始が競合しにくい。

### 2. 回転リング判定

レイとリング平面の交点を求め、その点の半径がリング半径付近ならヒットとする方式を基本にする。

判定条件:

- レイと平面がほぼ平行でない
- 交点の中心からの距離が `radius ± thickness`
- 必要なら視点に近い軸を優先

ただし仕様上「厚みを持たせる」とあるため、実装時は以下のどちらかで統一する。

- 簡易版: 平面交点 + 半径帯チェック
- 本実装: 平面交点 + 半径帯チェックを基準にし、必要なら視点依存の判定幅を調整する

計画上は前者を採用する。理由は、実装が単純で見た目との対応が明確なため。

### 3. 移動矢印判定

移動軸は 2 パーツで判定する。

- 軸線: 平面交点を基準にした近接判定
- 矢印先端: 先端近傍の球/カプセル近似

初期実装は単純化してよい。

- 軸線は有限円柱
- 先端は球

見た目が円錐でも操作性は十分確保できる。

## ドラッグ更新設計

### 1. 回転ギズモ

ドラッグ開始時:

- ヒットした軸のワールド軸ベクトルを記録
- その軸に垂直な平面上で初期ヒット点を記録
- `startManualRotation` を保存

ドラッグ中:

1. 同じ平面へ現在レイを再投影
2. ボーン中心から初期ベクトルと現在ベクトルを作る
3. 軸周りの signed angle を求める
4. ローカル軸回転の差分クォータニオンを作る
5. `manualRotation` を更新する

更新規約は既存コードに合わせる。

- 差分クォータニオンの軸は `local.localX/localY/localZ`
- 合成は `startManualRotation` を基準に再計算する
- 毎 move で累積加算するより、drag 開始値から再計算する方がドリフトしにくい

注意点:

- `manualRotation` は `local.rotation` の前段で掛かるので、UI 入力と同じ意味になるように扱う
- `bindBone.rotation` を直接編集するのではなく、既存仕様どおり `manualRotation` のみ更新する

### 2. 移動ギズモ

ドラッグ開始時:

- 軸のワールド方向を記録
- その軸を含むドラッグ平面を決める
  - 推奨: 軸とカメラ forward の外積で補助法線を作り、軸に沿った 1 次元スライドを安定化する
- `startManualTranslation` を保存

ドラッグ中:

1. 現在レイをドラッグ平面へ投影
2. 初期ヒット点との差分を取る
3. その差分をワールド軸へ射影して 1 軸移動量を得る
4. `worldDeltaToLocalDelta()` でローカル移動量へ変換
5. `manualTranslation = startManualTranslation + localDelta`

これで `renderer-interaction.js` の既存 IK ターゲット移動と同じ座標変換規約を流用できる。

## モジュール統合方針

### `source/gizmo.js`

追加する主モジュール。JSDoc 付きで以下を実装する。

- 状態作成
- 幾何生成
- ヒット判定
- ドラッグ更新

### `source/model-scene.js`

必要なら scene に以下を追加する。

- `gizmoVertexBuffer`
- `gizmoVertexCount`

ただし既存 `indicatorVertexBuffer` に同居させる案もある。責務分離のため、専用 buffer を推奨する。

### `source/model-debug-draw.js`

以下のいずれかを追加する。

- `updateGizmoBuffer(device, instance, selection, gizmoState)`
- もしくは `updateIndicatorBuffer()` 内でギズモ描画を統合

可読性を優先して、専用 `updateGizmoBuffer()` を推奨する。

### `source/model-manager.js`

`update()` と `drawInstance()` にギズモ更新と描画を差し込む。

- `updateGizmoBuffer()` 呼び出し
- overlay pipeline で `gizmoVertexBuffer` を描画

### `source/renderer-interaction.js`

以下を追加する。

- pointerdown でギズモ優先ピック
- pointermove でギズモドラッグ更新
- pointerup/cancel でドラッグ終了
- ギズモ操作中はカメラドラッグを抑止

### `source/renderer.js`

初期化時に `gizmoState` を生成し、`setupInputHandlers()` へ注入する。

## 実装フェーズ

### フェーズ 1: 描画だけ入れる

- `source/gizmo.js` を追加
- 選択ボーンに 3 軸回転リングと 3 軸移動矢印を表示
- まだ操作は付けない

完了条件:

- 選択ボーン変更に追従してギズモ位置・向きが変わる
- 非選択時は描画されない

### フェーズ 2: 回転ギズモのピックとドラッグ

- 回転リングのヒット判定を追加
- ドラッグで `manualRotation` をリアルタイム更新
- 既存ボーン UI と値が一致することを確認

完了条件:

- X/Y/Z の各リングで対応軸の回転のみが変わる
- ドラッグ中に inspector の回転入力欄が追従する

### フェーズ 3: 移動ギズモのピックとドラッグ

- 軸線と矢印先端のヒット判定を追加
- ドラッグで `manualTranslation` をリアルタイム更新

完了条件:

- X/Y/Z の各矢印で対応軸の移動のみが変わる
- inspector の位置入力欄が追従する

### フェーズ 4: 操作性調整

- ヒット優先順位調整
- しきい値、半径、厚み、矢印長の調整
- カメラ正面に近い軸の選びやすさ改善

## テスト計画

### 追加候補

- `tests/gizmo.test.mjs`
  - 回転リングの平面交点から signed angle が正しく出る
  - 軸方向移動のワールド差分が正しくローカル差分へ変換される
  - 非選択時はギズモが生成されない
- `tests/renderer-helpers.test.mjs` 近傍への追加候補
  - レイ生成とヒット判定ヘルパーの純粋関数テスト

### 手動確認

- ボーン選択時だけギズモが出る
- ボーンのローカル軸が傾いている場合でも、リングと矢印が正しい向きになる
- 回転ギズモで各軸の回転が混線しない
- 移動ギズモで各軸の移動が混線しない
- ギズモ操作中にカメラ操作へ誤爆しない
- VMD 再生中でもドラッグ結果が毎フレーム反映される

## リスク

- ボーンのローカル軸が独自設定されているモデルでは、見た目の軸と `manualRotation` の適用軸がずれると操作感が破綻する
- 回転リングは視線方向に近い軸ほど平面交点が不安定になる
- 毎フレームの頂点再生成は軽量だが、ヒット判定の数式を複雑にしすぎると保守性が落ちる

## 推奨実装順

1. 専用 `source/gizmo.js` を追加して純粋関数ベースで幾何と判定を切り出す
2. `model-scene.js` と `model-manager.js` に描画バッファを追加する
3. `renderer-interaction.js` へギズモ優先の pointer 処理を入れる
4. 回転ギズモを先に完成させる
5. その後、移動ギズモへ `worldDeltaToLocalDelta()` を使って展開する

## 完了条件

以下を満たせば完了とする。

- 選択中ボーンにローカル XYZ 回転リングと移動矢印が表示される
- 回転リングのドラッグで対応ローカル軸の `manualRotation` がリアルタイム更新される
- 移動矢印のドラッグで対応ローカル軸の `manualTranslation` がリアルタイム更新される
- 描画と入力は既存の overlay/pointer 基盤を再利用している
- 実装は JSDoc スタイルで記述されている
