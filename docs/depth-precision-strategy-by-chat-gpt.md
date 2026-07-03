## Depth Precision Strategy for Hidden-Diff Meshes

MMD で、目の差分などの「すぐ後ろに隠す前提のメッシュ」が深度バッファ精度不足で一部見えてしまう問題への対策メモ。

### Summary

- Reverse Z はまだ導入しない。
- まず `scene AABB` を使って camera の `near/far` を自動計算し、現行の forward-Z のまま深度精度を改善する。
- `scene AABB` はモデル姿勢の更新に追従する保守的な境界として扱う。

### Current State

- 現在の main view は `source/camera.js` の固定 `near=0.1 / far=1000` に依存している。
- `ModelManager.update()` は毎フレーム骨行列を更新し、その末尾で `instance.aabb` を更新している。
- `getCombinedAabb()` は各 instance の AABB を union するだけで、追加の頂点再走査はしない。
- shadow は別系統の depth range を持つため、今回の変更対象は main view と DOF を中心にする。

### Implementation Details

- `scene AABB` の再計算タイミング
  - 毎フレームの `refreshScene()` から到達する `modelManager.update()` の中で再計算する。
  - 再計算が走る契機は、アニメーション再生、タイムライン seek / step / rewind、IK、物理演算、ギズモ操作、`manualTranslation/manualRotation` の編集、キーフレーム登録後の再評価、モデル追加直後。
  - カメラ操作、選択変更、DOF 設定変更だけでは `scene AABB` は変えない。
  - まずは毎フレーム更新で正しさを優先し、必要になったら instance 単位の dirty 最適化を入れる。

- 自動 clip plane 計算
  - `scene AABB` の 8 頂点を view space に変換し、前方にある深度範囲を拾う。
  - `near = clamp(minPositiveDepth * 0.1, 0.05, 0.5)` を採用する。
  - `far = max(near + 10.0, maxPositiveDepth * 1.1)` を採用する。
  - `scene AABB` が無い、または有効な前方深度が取れない場合は `0.1 / 1000` にフォールバックする。
  - 計算結果は `camera.clipPlanes` に保持し、main view と DOF が同じ値を使う。
  - MMD のワールド単位が大きいこと自体が問題ではなく、`near` の上限を 5.0 にしていたのが近接ショットで不利だった。

- 実装の接続点
  - `source/camera.js` に自動 clip plane 計算ヘルパーを追加する。
  - `source/render-loop.js` で `scene AABB` を取得し、毎フレーム `camera.clipPlanes` を更新してから `createViewProjection()` と DOF uniform へ渡す。
  - `source/renderer-interaction.js` の picking は `camera.clipPlanes` を使う前提にする。
  - Reverse Z、深度比較反転、深度 clear 値の変更、主 depth フォーマット変更は今回行わない。

### Test Plan

- ほぼ同一面の hidden-diff メッシュを持つモデルで、通常距離と近接視点の両方で差分漏れが減ること。
- アニメーション再生、タイムライン操作、IK、物理、manual 補正で `scene AABB` が追従し、clip plane が破綻しないこと。
- モデル未ロードや `scene AABB` 不在時でも、固定値フォールバックで描画が継続すること。
- DOF の深度線形化が `camera.clipPlanes` に追従し、ボケ計算が破綻しないこと。

### Assumptions

- 今回の問題は transparent sorting ではなく、opaque / cutout 系の深度精度不足が主因。
- `scene AABB` は厳密なメッシュ境界ではなく、clip plane 決定用の保守的境界として扱う。
- Reverse Z は次段階で入れる候補に留め、今回は forward-Z のまま安定化を優先する。




## 古いバージョンの Depth Precision Strategy for Hidden-Diff Meshes

目の差分をすぐ後ろに隠すモデルが深度バッファの精度不足で一部表示される問題の対処方法。

### Summary

- 推奨順は 自動 clip plane 最適化 → Reverse Z + depth32float です。
- 現状は source/camera.js:32 で near=0.1 / far=1000 固定、主描画深度は source/renderer-resources.js:184 の
depth24plus、パイプライン比較は source/model-manager-pipelines.js:76 の less-equal です。MMD スケールではこの
組み合わせが差分メッシュ漏れの主因になりやすいです。
- depth pre-pass は精度自体を増やさないので第一候補にしません。Reverse Z をやるなら depth32float とセットで入れ
る前提にします。

### Key Changes

- clip plane を固定値から自動計算へ変更する。
    - source/camera.js:32 の固定 0.1/1000 を廃止し、カメラ eye と scene AABB の view-space 深度から毎フレーム計
    算する。
    - 方式は near = clamp(minPositiveDepth * 0.1, 0.05, 0.5)、far = max(near + 10.0, maxPositiveDepth * 1.1) を
    採用する。
    - scene AABB が無い場合だけ near=0.1 / far=1000 にフォールバックする。
    - 同じ near/far を DOF にも渡し、source/render-loop.js:275 の固定 DOF_DEFAULT_* 依存をやめる。
- 主描画系を Reverse Z に切り替える。
    - 射影行列ヘルパーを reverse-Z 用に追加し、主カメラ VP と depth-pick に使う。shadow 用射影は現状維持にする。
    - 深度比較を source/model-manager-pipelines.js:76 などの less-equal から greater-equal に変更する。
    - 深度 clear を source/render-loop.js:116 などの 1.0 から 0.0 に変更する。
    - 主描画深度テクスチャを source/renderer-resources.js:184 の depth24plus から depth32float に変更する。depth
    pick はすでに source/renderer-resources.js:177 で depth32float なので合わせる。
    - Reverse Z は depth24plus では改善量が backend 依存なので、主深度を depth32float に寄せて効果を固定化する。
- DOF と周辺機能を reverse-Z 対応する。
    - source/shaders/post-effect/dof.wgsl:42 の深度線形化を forward-Z 式から reverse-Z 式へ変更する。
    - 使う式は linearDepth = (near * far) / max(near + depth * (far - near), 0.0001)。
    - DOF uniform の near/far は固定値ではなく実際のカメラ clip plane をそのまま使う。
    - depth pick は主カメラと同じ reverse-Z 設定へ合わせる。shadow compare は別系統なので変更しない。
- 局所対策は後段に回す。
    - それでも一部モデルだけ漏れる場合のみ、特定マテリアル向け depth bias を追加する。
    - これは global fix ではなく model-specific fallback とする。最初からこれを主解にしない。

### scene AABB 仕様

  - Scene AABB Update Timing か同等の小節を追加し、現状の更新経路を明記する。
      - refreshScene() は renderer.js で updateSceneState() を呼ぶ。
      - updateSceneState() は modelManager.update(physicsEngine, selection, 1, camera) を呼ぶ。
      - ModelManager.update() の末尾で updateInstanceAabb(instance) が毎回実行され、instance.aabb が更新される。
      - getCombinedAabb() は各 instance.aabb を union するだけで、追加の頂点走査はしない。
  - 「現状では AABB は毎回再計算される」ことを具体例つきで書く。
      - アニメーション再生中の毎フレーム更新
      - タイムライン seek / step / rewind / end
      - VMD 適用直後の姿勢再評価
      - IK 解決後
      - 物理演算更新後
      - ギズモ操作中
      - ボーン UI から manualTranslation / manualRotation を編集したとき
      - ボーン位置・回転の reset / copy-paste / mirrored paste
      - モデル追加直後
  - 推奨実装として instance.aabbDirty を導入する方針を追記する。
      - addModel() 完了時は true
      - animationController.update() で姿勢が進んだフレームは true
      - animationController.jumped が立ったフレームは必ず true
      - solveIk() を実行したフレームは true
      - physicsEngine.update() 後に物理がボーンへ書き戻すモデルは true
      - manualTranslation / manualRotation を変更した操作は true
      - TimelineManager.invalidateManualValues() による manual 値クリアも true
      - registerBoneKeyframe() 後の manual 値リセットと seek(currentFrame) でも true
  - dirty を立てないケースも明記する。
      - カメラ移動、ズーム、FOV 変更
      - DOF focus point 変更
      - UI の選択状態変更のみ
      - タイムラインの見た目更新のみ
      - ポストエフェクト設定変更のみ
      - これらは clip plane 再計算の入力には使うが、scene AABB 自体は不変
  - updateInstanceAabb() のデータ源も説明する。
      - 頂点全走査ではなく scene.boneWorldPositions を走査して AABB を作る
      - shadowBoundsMargin があれば min/max に加算する
      - したがって AABB は「変形後メッシュ厳密境界」ではなく「ボーン姿勢ベースの保守的境界」
  - 実装順序を決め打ちで追記する。
      - 第1段階: Reverse Z 検証を優先し、既存どおり毎回 updateInstanceAabb() でもよい
      - 第2段階: 問題なければ instance.aabbDirty を入れて再計算をスキップする

### Test Plan

- ほぼ同一面に近い hidden-diff メッシュを持つモデルで、通常距離と寄りの両方で背面差分が漏れないこと。
- カメラを顔や指の近くまで寄せても、auto near による過剰 clipping が起きないこと。
- DOF の focus point と blur が depth 反転後も破綻しないこと。
- depth pick が最前面を返し続けること。
- shadow の見た目が変わらないこと。

### Assumptions

- 問題は透明ソートではなく、opaque / cutout 系の深度精度不足です。
- Reverse Z の適用対象は主カメラ描画と depth pick のみです。shadow pass は forward Z のまま維持します。
- 実装優先度は auto clip plane が先、根本対策は auto clip plane + Reverse Z + depth32float の組み合わせです。
