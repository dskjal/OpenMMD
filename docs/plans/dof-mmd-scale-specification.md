# DOF の MMD スケール対応プラン

## 1. 物理寄り

### 目的

MMD のモデルは実寸より 10 倍程度のスケールで扱われることが多く、そのまま `F-stop` と `focusDistance` を結びつけると、実写の感覚と比べてボケ量が合いにくい。

この方式では、DOF を「見た目の blur 係数」ではなく、現実のレンズに近い `thin lens` 近似として扱う。
そのうえで、ワールド座標系の距離をメートル換算してから CoC を計算し、最後に画面上の blur 半径へ戻す。

### 前提

- `sceneScale = 1` を既定とする。
- `depth-focus-x/y/z` に入る座標は今までどおりワールド座標で扱う。
- `F-stop` は UI 上の値をそのまま使うが、物理式の `aperture` として解釈する。
- カメラの画角から焦点距離を推定するため、`sensorHeightMm` を持つ。
- 初期値は `sensorHeightMm = 24mm`、`sensorWidthMm = 36mm` 相当のフルフレームを仮定する。

### 実装プラン

1. DOF 用のスケール係数を追加する。
   - `worldUnitsPerMeter = 10`
   - `focusDistanceMeters = focusDistanceWorld / worldUnitsPerMeter`
   - `subjectDistanceMeters` も同じ換算で扱う

2. カメラの画角から焦点距離を求める。
   - `focalLengthMm = sensorHeightMm / (2 * tan(fovY / 2))`
   - いまの `camera.fovY` をそのまま利用し、DOF 側で `focalLengthMm` を導出する

3. thin lens 近似で CoC を求める。
   - `focusDistanceMeters` と `focalLengthMm` と `F-stop` から、レンズ式ベースの circle of confusion を算出する
   - 実装では「mm 単位で計算した CoC」を最後に画面ピクセルへ変換する
   - 近似式は CPU 側の補助関数に切り出し、shader には最終的な blur 半径だけ渡す

4. CoC を画面半径へ変換する。
   - `cocPixels = cocMm / sensorHeightMm * canvasHeight`
   - blur radius は `cocPixels` を基準にして、half-res blur のサンプル間隔へ反映する
   - 今の `dofBlurAmount` は「画面上の拡大倍率」ではなく、`CoC` の増幅係数として再定義する

5. 焦点距離のズレに対する振る舞いを固定する。
   - 前景・背景の両方がぼけるようにする
   - ただし MMD の細いパーツで破綻しやすいので、最大 blur 半径を設ける
   - `sceneScale` を変えても見た目が極端に変化しないよう、`focusDistanceMeters` を基準にする

6. UI との関係を整理する。
   - `depth-focus-x/y/z` は引き続きワールド座標のまま
   - `F-stop` は被写界深度の強さとして直接調整する
   - 既存の `dofBlurAmount` は「演出用の微調整」に残し、物理式の結果へ掛け算する

### 変更対象

- `source/render-loop.js`
  - `focusDistanceWorld` を `sceneScale` でメートル換算する
  - `fovY` から `focalLengthMm` を求める
  - `dofSettingsBuffer` に物理ベースの値を詰める

- `source/renderer-ui.js`
  - `F-stop` の入力はそのまま維持する
  - 将来 `sensorSize` を UI 化する場合の入口を残す

- `source/shaders/post-effect/dof.wgsl`
  - shader 側では物理計算を持たず、CPU 側で渡された CoC から blur を描画する
  - 画面半分解像度の blur テクスチャは、最終合成時に full-res へ正しく再サンプリングする

### テスト観点

- `sceneScale = 1` のとき、同じ見た目を旧来の 10 倍スケールと比較して再現できること
- `F-stop` を小さくするとボケが強くなること
- `F-stop` を大きくするとボケが弱くなること
- `focusDistance` を変えるとピント位置が移動し、前景・背景の両方で CoC が変化すること
- `camera.fovY` を変えても、物理式ベースのボケが極端に破綻しないこと

### 既定値

- `sceneScale = 1`
- `sensorWidthMm = 36`
- `sensorHeightMm = 24`
- `dofBlurAmount = 1.0` 付近を初期値にする
- `F-stop = 2.8` を初期値にする

### まとめ

この方式では、MMD のワールド座標をいったん現実のメートルへ戻してから DOF を計算する。
そのため、単純な「モデルが大きいからボケを強くする」ではなく、レンズの写真的な挙動に近い形で `F-stop` を扱える。
