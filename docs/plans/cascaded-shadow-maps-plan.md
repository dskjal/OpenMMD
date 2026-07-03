# カスケードシャドウマップ + light frustum 最小化 実装計画

## レビュー結果

元のプランには実装の方向性として妥当な点が多いが、このリポジトリにそのまま適用するには次の問題があった。

1. `texture array` と `atlas` のどちらを採るか未決定で、`source/renderer-resources.js` と shader I/O 設計が確定しない。
2. `light frustum をカメラ可視範囲だけに限定する` としつつ、実際には `受影面` と `影を落とす物体` のどちらで Z 範囲を詰めるかが曖昧だった。
3. `scene 全体の AABB` と `カスケード内のカメラ frustum corner` のどちらを基準に使うかが曖昧で、結果として実装者ごとに挙動が変わる。
4. OpenMMD の既存構成では `camera.js`, `renderer.js`, `renderer-gpu.js`, `model-manager-pipelines.js`, `source/shaders/` にまたがって変更が発生するが、責務分担が不足していた。
5. `毎フレーム再計算` と `安定化` の両立条件が弱く、ちらつき対策の具体性が不足していた。

この修正版では、実装方式を次のように固定する。

- 対象ライトは `方向光` に限定する。
- shadow resource は `2D texture array` を採用する。
- cascade ごとに `lightViewProjectionMatrix` を持つ。
- 各 cascade の XY 範囲は `カメラ frustum corner` から決める。
- 各 cascade の Z 範囲は `shadow caster / receiver のワールド境界` を使って詰める。
- 影選択は `view space depth` で cascade index を求める。
- cascade 境界は最初はブレンドなしで実装し、必要なら後段でフェードを追加する。

## 目的

現在の影描画を、次の 2 点で改善する。

1. カメラから見える広い範囲に対して、影の解像度を近距離優先で安定化するために Cascaded Shadow Maps (CSM) を導入する。
2. 各フレームで light frustum を「カメラに見えている範囲だけ」に限定し、無駄な影マップ生成範囲を削減する。

この 2 つを組み合わせて、影の品質と描画コストの両方を改善する。

## 前提

- OpenMMD は右手系で扱う。
- カメラとモデルの通常描画は既存の WebGPU パイプラインを維持する。
- 影描画は light 側の view/projection を別途生成している前提で拡張する。
- 既存の座標系変換ルールを崩さず、`source/physics.js` や `source/model-manager.js` のワールド変換と整合させる。

## 実装方針

### 1. CSM の導入

カメラの view frustum を複数の深度区間に分割し、各区間ごとに別の shadow map を作成する。

- 近距離カスケードは高解像度で高精細な影を描く。
- 遠距離カスケードはより広い範囲を低コストでカバーする。
- カスケード分割は固定値埋め込みではなく、実際のカメラ `near/far` と `fovY` に依存して計算する。
- split 方式は `practical split scheme` を採用し、linear と logarithmic の補間係数 `lambda` を使う。

### 2. light frustum の最小化

各カスケードの shadow frustum は、単純な camera frustum の AABB ではなく、実際にカメラで見えている範囲に合わせて絞る。

- カメラ frustum の各カスケード区間に対して、8 つの corner を light space に変換する。
- その点群から light space の XY 範囲を求める。
- Z 範囲は frustum corner だけではなく、`その cascade に寄与する shadow caster / receiver のワールド境界` を light space に変換して求める。
- これにより、shadow map 上の無駄な空白を減らし、解像度を実質的に引き上げる。
- 実装初期は `モデル全体 + 地面` を caster/receiver 境界として使い、その後に可視モデル単位へ細分化する。

### 3. 安定化

CSM はカメラ移動時に shadow の揺れが出やすいため、次を入れる。

- texel snapping を導入し、light space の投影中心を shadow map の texel 単位に丸める。
- カスケードごとに固定解像度を使い、投影サイズの過剰な伸縮を避ける。
- `light direction` が変わらない限り投影回転は固定にし、平行移動だけを更新する。
- 必要なら cascade ごとの split 段差を滑らかにするブレンド領域を設ける。

## 対象ファイル候補

実装では以下を中心に変更する。

- `source/renderer.js`
- `source/renderer-gpu.js`
- `source/renderer-resources.js`
- `source/model-manager-pipelines.js`
- `source/model-manager.js`
- `source/render-loop.js`
- `source/camera.js`
- `source/math-utils.js`
- `source/shaders/`

必要なら影専用の補助モジュールとして `source/shadow-manager.js` を新設する。

## 設計詳細

### カスケード分割

`camera.near` から `camera.far` までを N 分割する。

- N はまず `4` を初期値とする。
- 分割比は `lambda` で linear と logarithmic を補間する。
- `lambda = 0` なら linear 寄り、`lambda = 1` なら logarithmic 寄りにする。

分割点は毎フレーム再計算してよいが、入力値は `camera near/far/fov/aspect` が変わらない限り同一になるようにする。

### light frustum 計算

各 cascade について次を行う。

1. カメラの該当深度区間の frustum corner を求める。
2. light の view 行列で各 corner を変換する。
3. light space の XY を min/max で包む。
4. cascade に影響する caster/receiver 境界を light space に変換して Z min/max を求める。
5. XY/Z の両方に安全 margin を付ける。
6. shadow map の texel size に合わせて XY 中心を丸める。

この処理は「カメラに見えている範囲だけに light frustum を最小化する」本体になる。

`Z 範囲を frustum corner のみで決めない` ことが重要である。これをしないと、カメラに見えている受影面に対して、画面外から差し込む caster が切れる。

### シャドウマップ生成

各 cascade ごとに shadow map を持つ。

- 実装は `1 枚の 2D texture array` に各 cascade を layer として格納する。
- 初期実装では全 cascade 同一解像度にする。
- 影の参照時は、受光点の camera view space depth から対応 cascade を選択する。
- cascade 境界では最初はブレンドなしにし、破綻確認後に必要ならブレンドする。

### シェーダ側

既存の shadow compare 処理を拡張し、cascade index と light space 座標を使う。

- shader では camera depth から cascade を選択する。
- 参照時は該当 cascade の `lightViewProjectionMatrix` を用いて shadow UV を作る。
- uniform には cascade split 深度、cascade 数、light matrix 配列を持たせる。
- `texture_depth_2d_array` が既存パイプライン都合で使いにくい場合だけ atlas に戻す。

## 実装ステップ

### Phase 1: 現状把握と基盤整理

- 現在の shadow mapping 実装箇所を洗い出す。
- shadow 用の depth texture 管理方法を確認する。
- カメラの near/far, FOV, view/projection 生成経路を確認する。
- light の向きや位置の決め方が固定か動的かを整理する。
- モデルごとの world AABB を既存コードから取得できるか確認する。

成果物:

- 現行 shadow path の依存関係メモ
- CSM を差し込むレイヤの確定

### Phase 2: カスケード分割の実装

- カメラ frustum を分割する関数を追加する。
- cascade ごとの split 深度を計算する。
- 既存の shadow pass に cascade index を渡せるようにする。
- `camera.js` から world space frustum corner を取得できるようにする。

成果物:

- cascade split の計算
- cascade ごとの frustum corner 生成

### Phase 3: light frustum 最小化

- 各 cascade の corner を light space に変換する。
- XY の min/max を計算する。
- caster/receiver 境界から Z の min/max を計算する。
- texel snapping を入れる。
- 影の切り詰めが起きないように margin を設定する。

成果物:

- cascade ごとの light orthographic projection
- カメラ可視範囲に追従する shadow frustum

### Phase 4: shadow map リソース拡張

- cascade 数分の depth texture を確保する。
- render pass / bind group / pipeline の更新を行う。
- `2D texture array` ベースで render pass を組む。

成果物:

- multi-cascade shadow map resource
- cascade ごとの render path

### Phase 5: シェーダとサンプリング

- shadow compare に cascade 選択を追加する。
- cascade 境界のアーティファクトを確認し、必要ならブレンドを追加する。
- PCF の半径が cascade ごとに適切か調整する。

成果物:

- cascade 対応 shadow sampling
- 境界破綻の緩和

### Phase 6: 安定化と最適化

- light frustum のスナップを調整する。
- カメラ移動時のちらつきを確認する。
- split 比率、cascade 数、解像度を設定可能にする。
- 変更コストを下げるため、毎フレーム完全再計算しない余地を検討する。

成果物:

- チューニング可能な設定値
- 安定化済みの shadow update path

## source/ 側の具体的な変更案

### `source/camera.js`

- `getFrustumCornersWorld(nearDepth, farDepth)` を追加する。
- 指定深度区間の 8 corner を world space で返す。
- 既存の view/projection 更新処理と同じパラメータ系を使い、別計算を増やさない。

### `source/math-utils.js`

- `transformPointMat4(out, point, matrix)` のような点変換補助を追加する。
- `computeAabbFromPoints(points)` を追加する。
- `snapOrthographicBoundsToTexel(bounds, mapResolution)` を追加する。
- CSM 固有ロジックを `camera.js` や `renderer.js` に散らさず、純粋関数として置く。

### `source/shadow-manager.js` を新設

責務をここに集約する。

- cascade split 計算
- frustum corner 生成依頼
- light view / projection 計算
- texel snapping
- cascade uniform データ生成

想定 API:

- `update(camera, lightDirection, sceneBounds)`
- `getCascadeCount()`
- `getCascadeMatrices()`
- `getCascadeSplits()`
- `getShadowPassData()`

### `source/renderer-resources.js`

- `shadow texture` を単一の depth texture から `depth 2D texture array` に変更する。
- cascade 数に応じた layer 数で GPUTexture を作成する。
- cascade ごとの view を作れるようにする。
- shadow 用 uniform buffer のサイズを拡張する。

追加データ例:

- `cascadeCount`
- `cascadeSplits[4]`
- `lightViewProjMatrices[4]`
- `shadowMapResolution`

### `source/renderer-gpu.js`

- shadow texture array と sampler の bind group layout を定義する。
- main render pass 側で cascade uniform を参照できるようにする。
- shadow pass を cascade 数分ループして発行できるようにする。

### `source/model-manager-pipelines.js`

- shadow pass 用 pipeline が texture array 前提の resource layout と両立するように見直す。
- main shading pipeline に cascade uniform を追加する。
- shader entry point 変更がある場合はここで pipeline 再生成条件を整理する。

### `source/model-manager.js`

- 影描画対象メッシュの draw path に `cascade layer` を渡せるようにする。
- モデル全体の world AABB を取得する関数を追加する。
- 将来的な light frustum Z 最適化に使えるよう、shadow caster / receiver の境界取得口を作る。

候補 API:

- `getWorldBounds()`
- `getShadowCasterBounds()`
- `renderShadowMap(passEncoder, cascadeIndex)`

### `source/renderer.js`

- shadow manager の生成とライフサイクル管理を追加する。
- camera, light, model scene から毎フレーム shadow update 用入力を集約する。
- debug 用に cascade split や各 matrix を参照できるようにする。

### `source/render-loop.js`

- 各フレームで `shadowManager.update(...)` を先に呼ぶ。
- その結果を使って cascade ごとの shadow pass を回す。
- main scene render 前に shadow uniform の GPU 反映を行う。

### `source/shaders/`

少なくとも以下の変更が必要になる。

- shadow pass 用 WGSL:
  - 既存の 1 light matrix 前提をやめ、pass ごとに cascade index で matrix を選ぶ。
- main shading 用 WGSL:
  - fragment または vertex から world position / view depth を取得する。
  - cascade split から index を選ぶ。
  - `texture_depth_2d_array` を使って該当 layer を sample する。
  - shadow compare と bias を cascade 対応にする。

### `source/model-debug-draw.js`

- 任意で cascade の light frustum をワイヤー表示できるようにする。
- 可視化があると、XY/Z の切り過ぎやスナップの不具合を詰めやすい。

### `source/renderer-ui.js`

- デバッグ設定として次の項目を追加する余地がある。
- `cascade count`
- `cascade lambda`
- `shadow resolution`
- `show cascade debug`

初期実装では UI なしでもよいが、少なくとも定数を `renderer.js` に散在させない。

## 実装時の判断基準

- 初期版は `4 cascade`, `same resolution`, `directional light only`, `no blend` で固定し、まず描画を安定させる。
- `atlas` は shader と UV 境界処理が複雑になるため採らない。
- `light frustum の最小化` は XY を frustum corner、Z を caster/receiver bounds で決める。
- カメラ外 caster を切らないことを、shadow 画質より優先する。

## 検証項目

- カメラ接近時に近距離影の解像度が改善されること。
- 遠景でも影が破綻しないこと。
- カメラ移動時に shadow が大きく揺れないこと。
- cascade 境界に不自然な段差やチラつきがないこと。
- light frustum 最小化により、shadow map の空き領域が減っていること。
- カメラ画面外の caster が画面内 receiver に落とす影が切れないこと。
- 既存のモデル表示、IK、物理演算、モーフ処理に副作用がないこと。

## リスク

- cascade 境界での見た目の不連続。
- texel snapping の入れ方次第で逆にカクつく可能性。
- light frustum を詰めすぎると、モデルや床が shadow map から切れる可能性。
- shadow map の枚数増加で GPU メモリ使用量が増える。
- depth texture array のサポート前提により、既存 shader/bind group と整合しない可能性。

## 非対象

- 影以外のライティングモデルの変更。
- PBR 化やマテリアル表現の全面刷新。
- 物理ベースの soft shadow の導入。

## 完了条件

- カスケード数を設定できる。
- カメラに見えている範囲だけを使って cascade ごとの light frustum を作れる。
- ただし Z 範囲は caster/receiver bounds を含めて安全側に確保できる。
- 影の品質が近距離優先で改善される。
- カメラ移動時の影のちらつきが許容範囲に収まる。
- 既存シーンで破綻なく動作する。
