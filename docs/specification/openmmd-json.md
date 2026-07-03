# OpenMMD JSON 仕様

この文書は OpenMMD で扱う JSON をまとめる。

- UI 設定 JSON
- Model JSON

両者は用途も `type` も異なる。混用しないこと。

## 共通方針

- JSON のトップレベルは object であること
- `type` は大文字小文字を区別せず判定するが、正規形は小文字を使う
- 未知のキーは基本的に無視する
- 文字列は前後空白を除去して扱う
- BOM 付き UTF-8 を許容する

## UI 設定 JSON

UI 設定 JSON は画面上の表示設定を読み込み・適用するための JSON である。
読み込み処理は `source/infrastructure/config/ui-settings-loader.js` が担当し、サンプルは `test-data/ui.json` にある。

### トップレベル

```json
{
  "type": "ui"
}
```

`type` が `ui` 以外の JSON は UI 設定として扱わない。

### セクション構成

UI 設定 JSON は panel 単位の object を持つ。

|キー|意味|
|---|---|
|`animation`|アニメーションパネルの状態|
|`shortcuts`|ショートカットパネルの状態|
|`videoExport`|動画設定タブの状態|
|`render`|描画設定タブの状態|
|`postEffect`|ポストエフェクトタブの状態|
|`camera`|カメラタブの状態|
|`light`|ライトタブの状態|

未知の section は無視する。各 section 内でも未知のキーは無視する。

### `animation`

```json
{
  "playbackRange": {
    "start": 0,
    "end": 240
  }
}
```

- `playbackRange.start` は開始フレーム
- `playbackRange.end` は終了フレーム
- `end` は `null` を許容する

### `shortcuts`

- 表示系 checkbox:
  `showBones` `showBoneAxes` `showPhysics` `disablePhysics` `hideIkBones` `hideSpringBones`
- 床グリッド checkbox:
  `showGridXZ` `showGridXY` `showGridYZ`
- 数値:
  `boneThickness` `gridSize` `gridCount` `gridThickness`

### `videoExport`

- 文字列:
  `format` `codec` `quality`
- 数値:
  `width` `height`
- boolean:
  `includeAudio` `transparentBackground`

### `render`

- 表示設定:
  `displayPreset` `renderingFps` `viewTransform` `displayColorSpace` `aspectRatio` `internalResolution` `aaMethod`
- Environment:
  `environmentHdrIntensity`
- Shadow:
  `shadowBias` `shadowPower` `shadowStrength` `shadowEdgeOpacity`
  `showCascadeShadowMaps` `showBloomShadowDebug` `bloomShadowDebugMode`
  `shadowMapSize` `shadowFarAuto` `shadowFar`
- Ambient Occlusion:
  `ambientOcclusionEnabled` `ambientOcclusionRadius` `ambientOcclusionBias`
  `ambientOcclusionIntensity` `ambientOcclusionBlurAmount` `ambientOcclusionSampleCount`
- Contact Shadow:
  `contactShadowEnabled` `contactShadowLength` `contactShadowThickness`
  `contactShadowIntensity` `contactShadowBlurAmount` `contactShadowStepCount`

`displayPreset` は先に適用され、その後に個別値で上書きされる。

### `postEffect`

- boolean:
  `bloomEnabled` `dofEnabled` `sssEnabled`
- enum/string:
  `filmGrainAnimationMode` `dofAlgorithm`
- 数値:
  `colorTemperature` `bloomThreshold` `gamma` `chromaticAberration`
  `filmGrainAmount` `bloomBlurAmount` `bloomAlpha` `bloomShadowMultiplier`
  `dofFStop` `sssRadius` `sssDepthThreshold` `sssNormalThreshold` `sssStrength`

### `camera`

```json
{
  "modelName": "Alicia",
  "boneName": "Head",
  "fov": 45,
  "position": [0, 10, 35],
  "rotation": [0, 0, 0],
  "target": [0, 10, 0]
}
```

- `modelName` と `boneName` はカメラ追従先の listbox 状態
- `position` `rotation` `target` は UI 数値入力そのものを保存する

### `light`

- 数値配列:
  `position` `rotation`
- 数値:
  `gltfLightStrength`

### 挙動

- 読み込み側は DOM 直操作ではなく、viewer 内部 API を通して section ごとに適用する
- `source/bootstrap/openmmd-app.js` が各 panel の read/apply 実装を束ねる
- `source/application/commands/application-commands.js` と `source/application/app-facade.js` から内部 API として利用できる

## Model JSON

Model JSON は、アクティブモデルの model/material/bone の一部設定を保存・復元するための JSON である。
実装は `source/infrastructure/serialization/model-json.js` が担当し、サンプルは `test-data/model.json` にある。

### トップレベル

```json
{
  "type": "model",
  "targetModel": {
    "name": "初音ミク"
  },
  "bones": [],
  "materials": []
}
```

### トップレベルキー

|キー|意味|備考|
|---|---|---|
|`type`|設定種別|`model` 固定|
|`targetModel.name`|対象モデル名|`model.name` と完全一致で照合する|
|`bones`|bone 設定配列|省略可|
|`materials`|material 設定配列|省略可|

未知のトップレベルキーは許容しない。旧 schema は後方互換なしで reject する。

### モデル名の扱い

- 読み込み時は `targetModel.name` と一致するモデルを探す
- 一致しない場合は `model-not-found` で失敗する
- active model fallback や confirm は行わない

### `bones`

`bones` は配列で、各要素は次の形を使う。

```json
{
  "name": "右ひじ",
  "ikRotationLocks": {
    "x": true,
    "y": false,
    "z": true
  }
}
```

#### フィールド

|キー|意味|型|
|---|---|---|
|`name`|bone 名|string|
|`ikRotationLocks.x`|IK rotation lock X|boolean|
|`ikRotationLocks.y`|IK rotation lock Y|boolean|
|`ikRotationLocks.z`|IK rotation lock Z|boolean|

#### マッチ規則

- `name` の完全一致で探す
- 同名 bone が複数ある場合、未使用のものから順に適用する
- `bone-index` は持たない

#### 挙動

- `ikRotationLocks` に含まれる軸だけを上書きする
- 未指定の軸は既存値を維持する

### `materials`

`materials` は material entry の配列である。

```json
[
  {
    "name": "cloth",
    "shader": "mmd-shader.wgsl",
    "visibility": {
      "visible": true
    }
  }
]
```

#### マッチ規則

- `name` は `material.name` と完全一致で照合する
- 読み込み側は最初に見つかった一致対象へ適用する
- 一致しない名前の entry は `skippedMaterials` に記録される

#### 保存時のキー

|キー|意味|型|
|---|---|---|
|`name`|material 名|string|
|`shader`|内部 shader 名|string|
|`visibility.visible`|表示/非表示|boolean|
|`visibility.ssss`|SSSSS 表示|boolean|
|`visibility.castShadow`|影を落とすか|boolean|
|`visibility.receiveShadow`|影を受けるか|boolean|
|`raster.noCull`|両面描画|boolean|
|`raster.hasEdge`|エッジ有無|boolean|
|`toonTexture`|toon texture 参照|object|
|`diffuse`|base color RGBA|number[]|
|`metallic`|metallic|number|
|`roughness`|roughness|number|
|`emissive.source`|emissive の入力源|`color` / `texture`|
|`emissive.texture`|emissive texture 参照|object|
|`emissive.color`|emissive 色 RGB|number[]|
|`emissive.strength`|emissive 強度|number|

#### 色の扱い

- `diffuse` は 0-1 系 RGBA 配列で保存する
- `emissive.color` は 0-1 系 RGB 配列で保存する
- 0-255 系配列や legacy alias は許容しない

#### texture reference

`toonTexture` と `emissive.texture` は同じ正規化済み texture reference 形を使う。

```json
{ "kind": "none" }
```

```json
{ "kind": "internal", "toonIndex": 0 }
```

```json
{ "kind": "path", "path": "toon-textures/toon04.bmp", "colorSpace": "gamma-2.2" }
```

`colorSpace` は path 参照で保持する。現行実装の正規値は `gamma-2.2` と `none` である。

#### 挙動

- 省略された material フィールドは `source/infrastructure/config/defaults/defaults.json` の material 既定値で補完される
- `visibility.visible`、`visibility.ssss`、`visibility.castShadow` は instance 側の可視状態配列も更新する
- `visibility.receiveShadow`、`raster.noCull`、`raster.hasEdge` は model material に反映する
- `raster.noCull` と `raster.hasEdge` は pipeline 側の material 設定も更新する
- `emissive` は model material と `morphController.materialStates` の両方へ反映する
- shader / texture / raster の一部変更は pipeline rebuild を起こし、uniform 系変更は material buffer update を起こす

### 保存時の補足

- `material.name` が空のときは `Material N` 形式の代替名を使う
- `toonTexture` と `emissive.texture` は解決できない場合でも `{ "kind": "none" }` を使う
- `bones` エントリが 1 件もない場合、`bones` キー自体は省略される

## 参照データ

- `test-data/ui.json`
- `test-data/model.json`
