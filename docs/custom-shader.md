# カスタムシェーダ

OpenMMD のカスタムシェーダは、`source/shaders/shaders.wgsl` の共通テンプレートに、`source/shaders/custom-shaders/*.wgsl` の本文を差し込む方式です。

現在の実装では、カスタムシェーダは `fs_main` の中身だけを差し替えます。`vs_main`、`vs_shadow`、`fs_shadow`、`fs_pick_world` などの共通処理はテンプレート側に残ります。

## 追加方法

1. `source/shaders/custom-shaders/` に WGSL ファイルを追加します。
2. `source/shaders/custom-shaders/manifest.json` にエントリを追加します。
3. マテリアルタブのシェーダ選択リストボックスから、そのシェーダを選びます。
4. 選択中のシェーダ右側の更新アイコンを押すと、その 1 つだけ再読み込みされます。

### 例

```json
{
  "name": "example-shader.wgsl",
  "label": "Example Shader",
  "entryPath": "source/shaders/custom-shaders/example-shader.wgsl",
  "defaultFor": ["default"]
}
```

- `name`: 内部で使うシェーダ名です。
- `label`: UI に表示する名前です。
- `entryPath`: 実体ファイルのパスです。
- `defaultFor`: どのモデル種別の既定にするかを表します。

## 既定シェーダ

- MMD 系の既定は `mmd-shader.wgsl`
- glTF の既定は `gltf-shader.wgsl`

glTF はロード時点で `shaderName = "gltf-shader.wgsl"` が設定されます。
MMD 系は `shaderName` を省略した場合に `mmd-shader.wgsl` が使われます。

## シェーダ本文で使える変数

カスタムシェーダ本文は `@fragment fn fs_main(in: VertexOutput) -> MainFragmentOutput` の中に挿入されます。
以下の変数と関数を利用できます。

### 入力

| 名前 | 型 | 内容 |
|---|---|---|
| `in` | `VertexOutput` | 頂点シェーダから渡される入力です。 |
| `in.uv` | `vec2<f32>` | テクスチャ UV です。 |
| `in.normal` | `vec3<f32>` | ワールド空間法線です。 |
| `in.viewNormal` | `vec3<f32>` | ビュー空間法線です。 |
| `in.worldPos` | `vec3<f32>` | ワールド空間座標です。 |
| `in.viewPos` | `vec3<f32>` | ビュー空間座標です。 |

### 出力

| 名前 | 型 | 内容 |
|---|---|---|
| `out` | `MainFragmentOutput` | 最終出力です。 |
| `out.color` | `vec4<f32>` | カラー出力です。 |
| `out.normal` | `vec4<f32>` | 法線エンコード出力です。 |
| `out.mask` | `vec4<f32>` | マスク出力です。 |

### 共通 uniform

| 名前 | 型 | 内容 |
|---|---|---|
| `uniforms.mvp` | `mat4x4<f32>` | モデル・ビュー・プロジェクション行列です。 |
| `uniforms.view` | `mat4x4<f32>` | ビュー行列です。 |
| `uniforms.lightingParams` | `vec4<f32>` | `xyz` が光の向き、`w` がエッジ描画フラグです。 |
| `uniforms.shadowParams` | `vec4<f32>` | 影の各種パラメータです。 |
| `uniforms.shadowInfo` | `vec4<f32>` | カスケード数やシャドウマップサイズです。 |
| `uniforms.shadowSplits` | `vec4<f32>` | カスケード境界です。 |
| `uniforms.shadowMatrices` | `array<mat4x4<f32>, 4>` | シャドウ用行列です。 |
| `uniforms.edgeColor` | `vec4<f32>` | エッジ色です。 |
| `uniforms.resolution` | `vec4<f32>` | 画面解像度です。 |
| `uniforms.environmentParams` | `vec4<f32>` | `x` が環境マップの最大 mip、`y` が強度、`z` が `gltfLightStrength`、`w` が読み込み済みフラグです。 |
| `uniforms.cameraWorldPosition` | `vec4<f32>` | カメラのワールド座標です。 |

### 共通シェーダ変数

| 名前 | 型 | 内容 |
|---|---|---|
| `dynamicRange` | `f32` | `appState.dynamicRange` から渡される明るさ上限です。`uniforms.shadowPowerParams.y` を `fs_main` 冒頭で読み出した値です。 |

### マテリアル uniform

| 名前 | 型 | 内容 |
|---|---|---|
| `material.diffuse` | `vec4<f32>` | 基本色です。 |
| `material.ambient` | `vec3<f32>` | 予備の環境色です。 |
| `material.sphereMode` | `f32` | sphere テクスチャの利用モードです。 |
| `material.specular` | `vec3<f32>` | スペキュラ色です。 |
| `material.shininess` | `f32` | MMD 用の光沢です。 |
| `material.receiveShadow` | `f32` | 影を受ける場合は `1.0` です。 |
| `material.hasEdge` | `f32` | エッジありなら `1.0` です。 |
| `material.alphaCutout` | `f32` | カットアウト判定を使う場合は `1.0` です。 |
| `material.hasToonTexture` | `f32` | toon テクスチャがある場合は `1.0` です。 |
| `material.skinMask` | `f32` | マスク値です。 |
| `material.metalic` | `f32` | glTF 向けの metallic 値です。範囲は `0.0` から `1.0` です。 |
| `material.roughness` | `f32` | glTF 向けの roughness 値です。範囲は `0.0` から `1.0` です。 |
| `material.emissiveSource` | `f32` | `0.0` なら色、`1.0` なら emissive テクスチャを使います。 |
| `material.emissive` | `vec3<f32>` | glTF 向けの発光色です。 |
| `material.emissiveStrength` | `f32` | glTF 向けの発光強度です。 |
| `material.hasEmissiveTexture` | `f32` | emissive テクスチャがある場合は `1.0` です。 |

### テクスチャとサンプラ

| 名前 | 型 | 内容 |
|---|---|---|
| `textureSampler` | `sampler` | 通常テクスチャ用サンプラです。 |
| `toonSampler` | `sampler` | toon テクスチャ用サンプラです。 |
| `sphereSampler` | `sampler` | sphere テクスチャ用サンプラです。 |
| `environmentSampler` | `sampler` | HDR 環境マップ用サンプラです。 |
| `textureData` | `texture_2d<f32>` | マテリアルの主テクスチャです。 |
| `toonData` | `texture_2d<f32>` | toon テクスチャです。 |
| `sphereData` | `texture_2d<f32>` | sphere テクスチャです。 |
| `emissiveData` | `texture_2d<f32>` | emissive テクスチャです。 |
| `environmentData` | `texture_2d<f32>` | HDR 環境マップです。 |

### 共通関数

| 名前 | 内容 |
|---|---|
| `sample_material_alpha(uv)` | `textureData` と `material.diffuse.a` から alpha を返します。 |
| `sample_outline_alpha(uv)` | 輪郭線の alpha を返します。`sample_material_alpha(uv)` にエッジ設定を掛けます。 |
| `select_shadow_cascade(viewDepth)` | 使用する shadow cascade を選びます。 |
| `sample_shadow_cascade(...)` | 指定 cascade の shadow をサンプルします。 |
| `calculate_shadow_csm(...)` | CSM の影係数を計算します。 |
| `encode_view_normal(normal)` | 法線を出力用にエンコードします。 |
| `sample_environment(direction, roughness)` | HDR 環境マップを roughness に応じてサンプルします。 |

## mtoon

### 1.  mtoonParams0  (float 32 - 35)

- x : shadeShift （陰のしきい値調整）
  - 意味: 影（陰）ができる境界線をずらします（しきい値のシフト）。値を大きくすると影の領域が狭くなり、小さくすると広くなります。
- y : shadeToony （トゥーン度）
  - 意味: 陰の境界のシャープさを決定します。 1.0  に近いほど境界がクッキリし（アニメ調）、 0.0 に近いほど滑らかにボケるようになります。
- z : receiveShadowRate （影の受信度）
  - 意味: 影（セルフシャドウや他オブジェクトが落とす影）の影響を受ける度合いを制御します。
- w : shadingGradeRate （陰影のグレード割合）
  - 意味: 影マップテクスチャや凹凸情報から受ける陰影の影響力を調整します。

──────
### 2.  mtoonParams1  (float 36 - 39)

- x  :  lightColorAttenuation （光源色減衰度）
  - 意味: 光源の色（ライトカラー）がモデルに与える影響の強さをどれだけ減衰させるかを制御します。
- y  :  indirectLightIntensity （間接光強度 / GIイコライゼーション）
  - 意味: グローバルイルミネーション（GI）などによる環境光がどれだけキャラクターを照らすかを調整します（シェーダー側では giEqualization  として均一化ブレンドに使用）。
- z  :  rimLightingMix （リムライトのライト影響度）
  - 意味: リムライト（輪郭付近のハイライト）がライトの方向から受ける影響度を調整します。 1.0 に近づけると、ライトが当たっている方向のリムライトが抑えられます。
- w  :  outlineLightingMix （アウトラインのライト影響度）
  - 意味: アウトライン（輪郭線）の色にライトの陰影を反映させる際のベースブレンド率です。

──────
### 3.  mtoonParams2  (float 48 - 51)

- x  :  outlineWidth （アウトライン幅）
  - 意味: アウトラインの基本の太さを表します。
- y  :  outlineScaledMaxDistance （アウトライン制限距離）
  - 意味: カメラから離れた際のアウトラインの最大太さやスケーリングの上限距離を調整します。
- z  :  outlineColorMode （アウトライン配色モード）
  - 意味: アウトラインの着色計算で、指定した固定色とモデルがライティングされた色（litColor）をどのようにミックスするかを決定します。
- w  :  renderQueueOffsetNumber （描画キューオフセット）
  - 意味: 半透明オブジェクトなどのレンダリング順序（描画優先順）を微調整するためのオフセット数値です。

## 実装上の注意

- `mmd-shader.wgsl` では `metalic`、`roughness`、`emissive` は使いません。
- `mtoon-shader.wgsl` は `metalic` と `roughness` を使って HDR 環境反射を調整します。`emissiveSource` が `1.0` のときは `emissiveData` を使います。
- `mtoon-shader.wgsl` は `shadeColorFactor` を `material.mtoonShadeColor.rgb` から受け取り、toon texture がある場合はその結果を、ない場合は `shadeColorFactor` をそのまま使って陰影色を作ります。
- `gltf-shader.wgsl` はこれらの値を使う前提です。
- `dynamicRange` は `fs_main` の先頭で定義される変数です。明るさ系のクランプ上限として使えます。
- 輪郭線の alpha は `sample_outline_alpha(uv)` を使って計算します。
- 輪郭線は surface の直後に描かれる前提です。alpha だけを変えても、描画順が崩れると背景色が見えます。
- 新しいシェーダを追加したら、manifest にも登録してください。
- 既存マテリアルに対して個別に切り替える場合は、マテリアルタブのシェーダ select を使います。
- 選択中のシェーダだけを再読み込みしたい場合は、select の右側の更新アイコンを押します。
