# OpenMMD Internal Model / Animation Format Specification

## 目的

この文書は、OpenMMD の内部でのみ使う JavaScript の in-memory runtime object 仕様を定義する。

- 対象はモデル内部表現とアニメーション内部表現
- 対象読込元は `pmd`, `pmx`, `vrm`, `gltf`, `glb`
- 対象書出先は `vmd`, `vrma`
- 外部フォーマット互換よりも OpenMMD 内部での表現力を優先する
- `vmd`, `vrma` 保存時に表現できない情報は warning を出して欠落を許容する

この仕様は file format ではない。永続化互換、後方互換、ネットワーク転送互換は保証しない。

## スコープ

この仕様が定義するのは以下である。

- ローダーが生成する内部モデル object の最小要件
- タイムライン、再生、保存、UI が扱う内部アニメーション object の最小要件
- 座標系、回転順、helper bone、補助 metadata の共通前提
- `vmd` / `vrma` 保存時にどこで情報を落としてよいか

この仕様が定義しないのは以下である。

- 外部公開 API の payload 形式
- 永続化用 JSON 形式
- GPU buffer layout
- Three.js / glTF JSON の完全な mirror
- VRM の内部前方合わせ方式の詳細な移行手順

## 共通前提

### 座標系

- OpenMMD の内部座標系は右手系
- 一般 Euler 回転の適用順は `XYZ`
- Physics の剛体・ジョイントの Euler 回転のみ `YXZ`
- モデル内部表現とアニメーション内部表現は、再生時に追加の handedness 変換なしで評価できる状態で保持する

### 単位

- 座標・長さは OpenMMD runtime の内部単位を使う
- `pmd` / `pmx` の約 10 倍の MMD スケール差はローダーで吸収済みであること
- アニメーションの `time` は秒、`frameNum` はタイムラインフレーム番号とする

### helper bone

- `全ての親` helper bone は内部表現に残してよい
- `下半身` helper bone は内部表現に残してよい
- helper bone は外部ソースに存在しない synthetic bone でもよい
- helper bone の存在は内部表現として正当であり、読み込み元フォーマット非依存とみなす

### VRM 正規化方針

VRM は loader 段階で `XZ Flip` を適用して内部前方をそろえる。

- VRM も内部表現では他フォーマットと同じく OpenMMD 前方基準へ正規化する
- 正規化本体は loader 段階の `XZ Flip` とする
- `全ての親` helper bone 自体は残してよい

### handedness 変換と前方向正規化の違い

- handedness 変換と前方向正規化は別目的の処理として扱う
- handedness 変換は左手系入力を右手系内部表現へ移すための座標系変換である
- 前方向正規化は右手系のままモデルの前方だけを OpenMMD の内部前方基準へそろえる処理である
- `pmd`, `pmx`, `vmd` の loader で行う `Z-Flip` は handedness 変換であり、奇数軸反転の鏡映なので winding 補正が必要である
- `pmd`, `pmx`, `vmd` の quaternion / Euler 回転で `X`, `Y` を flip する規則は、position に対する `Z-Flip` と同じ鏡映変換を回転表現へ写した結果である
- VRM の `XZ Flip` は handedness 変換ではない。`X`, `Z` の同時反転は右手系を保ったままの 180 度 `Y` 回転として扱う
- VRM の `XZ Flip` は偶数軸反転なので winding 補正を目的に追加しない
- VRM で `XZ Flip` を使う理由は、glTF / VRM の右手系を壊さずに内部前方基準だけを MMD 系入力とそろえるためである
- 左右非対称モデルでは鏡映変換を使うと見た目の左右意味と humanoid 名の左右意味がずれるため、VRM は mirrored handedness 変換ではなく前方向正規化として `XZ Flip` を使う

### ロード・保存境界での handedness 変換

- `pmd`, `pmx`, `vmd` は左手系入力として扱う
- これらの position は `Z-Flip` で右手系へ変換する
- これらの quaternion / Euler 回転は `X`, `Y` を flip して右手系へ変換する
- `pmd`, `pmx` の index は 3 頂点単位で winding を補正する
- `vrma` は glTF core animation と同じ右手系入力として扱う
- `vrma` の position / quaternion / Euler 回転は追加の handedness 変換を行わない
- `vmd` 保存時は内部右手系から外部左手系へ逆変換する
- `vrma` 保存時は内部右手系をそのまま出力する

### VRMA の internal semantic

- `hips.translation` は raw local translation として扱う
- `target.bindTranslation` を持つ bone translation channel の `sampler.keyframes[].value` は bind pose からの delta として保持してよい
- 再生時は `bindTranslation + keyframe.value` により raw local translation を復元してから runtime 側の base translation 差分へ変換する
- helper bone を fold しない VRM/内部モデルから VRMA を書き出す場合は、必要なら `全ての親` channel を保持してよい
- VRMA のチャンネル名は humanoid 名と実ボーン名の両方を受け入れ、同一内部ボーンへ解決できなければならない

## 内部モデルフォーマット

## モデル object の位置づけ

モデル object は「読み込み済み静的資産」と「runtime で評価に必要な補助情報」をまとめた 1 つの object である。scene ごとの pose 状態や再生ヘッド位置は model 本体ではなく instance / scene 側に属する。

## モデル object の最小形

```js
{
  name: 'Model Name',
  magic: 'Pmx' | 'Pmd' | 'Vrm' | 'GLTF' | 'Unknown',
  vertices: Float32Array,
  indices: Uint16Array | Uint32Array,
  vertexCount: 0,
  materials: [],
  textures: [],
  textureSources: [],
  bones: [],
  morphs: [],
  displayFrames: [],
  rigidBodies: [],
  joints: [],
  ik: [],
  iks: [],
  faces: [],
  toonTextures: [],
  hasDummyBone: false,
  dummyBoneIndex: -1,
  gltfAnimationSources: [],
  gltfAssetContext: {},
  vrm: null
}
```

未使用フィールドや旧互換フィールドが追加で存在してもよい。内部コードは unknown field を無視できなければならない。

## 必須トップレベルフィールド

### `name`

- `string`
- UI 表示名
- 外部ファイル名と一致する必要はない

### `magic`

- `string`
- 読み込み元系列を表す runtime 分類
- 推奨値は `Pmx`, `Pmd`, `Vrm`, `GLTF`
- 保存先形式の決定には直接使わず、warning や import 由来分岐の補助に使う
- 原則的に magic に依存したコードは書いてはならない。例外は `GLTF` のチェックのみ

### `vertices`

- `Float32Array`
- OpenMMD 既存 runtime 頂点 stride を使う
- 頂点値は右手系・内部単位へ変換済みであること
- GPU upload 用再パック前の canonical source とみなす

### `indices`

- `Uint16Array` または `Uint32Array`
- winding は内部右手系に整合した順序であること

### `vertexCount`

- `number`
- `vertices` に含まれる論理頂点数

### `materials`

- `Array<object>`
- renderer, morph, UI, JSON export が参照するマテリアル runtime state
- 要素順は描画順・材質順の canonical order とする

### `bones`

- `Array<object>`
- ボーン index はモデル内部で stable であること
- 親子、IK、物理、モーフ、UI は bone index を共有する

### `morphs`

- `Array<object>`
- bone morph, vertex morph, material morph, VRM expression 展開 morph を含んでよい

### `displayFrames`

- `Array<object>`
- ボーン・モーフ UI 表示グループ
- 元フォーマット由来でも OpenMMD 合成結果でもよい

## 推奨トップレベルフィールド

### `textures`, `textureSources`, `toonTextures`

- UI 表示と再読込補助のため保持する
- canonical texture identity は配列 index とする

### `rigidBodies`, `joints`

- PMX 系物理または将来互換用の runtime physics description
- 回転値は `YXZ` 解釈前提の Euler とする

### `gltfAnimationSources`

- glTF / VRM / VRMA 由来の animation source 群
- model に同梱された animation を保持してよい

### `gltfAssetContext`

- glTF / VRM / VRMA 由来の補助情報を保持する runtime context
- Three.js scene, parser JSON, morph offset map などを含んでよい
- 永続化互換の対象ではない

### `vrm`

- `magic === 'Vrm'` のときだけ持てばよい
- VRM humanoid, expressions, springBone, metadata などの補助情報を持つ
- VRM ロード時に `全ての親` と `下半身` の helper bone を挿入してよい
- `下半身` helper bone は `hips` 配下の内部補助ボーンとして扱ってよい

## bone object

### 最小形

```js
{
  name: 'センター',
  nameEn: '',
  parentIndex: -1,
  tailIndex: -1,
  tailOffset: [0, 0, 0],
  position: [0, 0, 0],
  localX: [1, 0, 0],
  localY: [0, 1, 0],
  localZ: [0, 0, 1],
  transformLevel: 0,
  flags: 0,
  baseRotationQuaternion: [0, 0, 0, 1]
}
```

### 必須意味論

- `name` は内部ボーン識別子
- `parentIndex` は `-1` または同一 `bones` 配列内 index
- `position` は bind/rest local translation
- `localX`, `localY`, `localZ` は OpenMMD が解釈するローカル基底
- `baseRotationQuaternion` は bind pose のローカル回転そのものではなく、内部正規化や helper bone 補正を持ち込むための追加基底回転として使ってよい

### 正規化要件

- `localX`, `localY`, `localZ` は直交正規基底であることが望ましい
- 読み込み時に軸不足がある場合は `inferMissingBoneLocalAxes` 相当で補完してよい
- helper bone は `gltfNodeIndex === -1` のような synthetic marker を持ってよい

### VRM と bone

- VRM humanoid 名と実 bone 名の両解決情報を持ってよい
- `XZ Flip` 適用後も、VRM ボーンは他形式と同じ内部向きで評価できる状態にする
- `全ての親` は保持してよいが、前方合わせ専用の追加回転基底には依存しない

## material object

material object は renderer が直接使う runtime state であり、最低限以下を満たす。

- stable な配列 index を持つ
- name を持つ
- base color / alpha / texture index / shading mode / shadow flags / culling flags を持てる
- morph 適用後の結果と base state を区別できる

内部仕様として特定の全フィールドを固定しない。理由は renderer 側変更頻度が高く、`morphController.materialStates` と組で扱う必要があるためである。

ただし以下は invariant とする。

- `model.materials[i]` は UI 編集対象の canonical base state
- morph 反映中でも material index は不変
- material morph / expression が書き換える値は OpenMMD 内部値で保持する

## morph object

morph object は複数種別を許容する。

- vertex morph
- bone morph
- material morph
- UV morph
- VRM expression 由来 morph

最小限必要なのは以下である。

```js
{
  name: 'smile',
  type: 'vertex' | 'bone' | 'material' | 'group' | 'uv' | 'unknown',
  offsets: []
}
```

VRM expression 由来 morph は追加 metadata を持ってよい。

- `vrmExpressionName`
- `vrmExpressionType`
- `category`

内部アニメーションから expression を駆動するときは、最終的に morph weight へ解決できることを優先する。

## displayFrame object

```js
{
  name: '表情',
  nameEn: 'Expressions',
  isSpecial: false,
  elements: [
    { type: 'bone', index: 0 },
    { type: 'morph', index: 1 }
  ]
}
```

- UI 表示順の canonical source とする
- 読み込み元依存でも合成でもよい

## vrm object

`model.vrm` は VRM 固有 runtime 補助情報であり、最低限以下を含んでよい。

```js
{
  version: 'vrm0' | 'vrm1' | 'none',
  specVersion: '',
  meta: {},
  humanoidBoneNameMap: {},
  expressions: {
    preset: {},
    custom: {}
  },
  springBone: {}
}
```

## 内部アニメーションフォーマット

## animation source object

OpenMMD が UI や再生で扱う最上位のアニメーション object は source wrapper とする。

```js
{
  kind: 'vmd' | 'vrma' | 'gltf' | 'internal',
  name: 'walk',
  clip: { ... }
}
```

- `kind` は入出力互換の補助であり、再生ロジックの本質ではない
- 入出力以外で `kind` に依存するコードを書いてはならない
- canonical な内容は `clip` にある

## animation clip object

### 最小形

```js
{
  name: 'walk',
  timelineFps: 30,
  duration: 2.0,
  channels: [],
  metadata: {}
}
```

### 意味論

- `timelineFps` は UI の frame number と time 変換基準
- `duration` は秒
- `channels` が canonical animation payload
- `metadata` は互換保存・import provenance・未正規化補助情報を持てる
- 再生時刻は viewer 全体で共有するグローバルタイムラインを基準に評価してよい
- 各モデル instance は独立した animation source を維持しつつ、共有 frame/time に対してサンプリングされる

### 正規形

内部アニメーションの正規形は「可能な限り `channels` に寄せる」ことである。

- bone は channel 化する
- morph は channel 化する
- camera は channel 化する
- light は channel 化する
- self-shadow は channel 化する
- lookAt は channel 化する
- expression は channel 化する

現行実装では `cameraKeyframes`, `lightKeyframes`, `selfShadowKeyframes` が `metadata` に残る経路がある。これは互換形として許容するが、将来的な canonical storage ではない。

## animation channel object

### 共通形

```js
{
  target: {
    kind: 'bone' | 'morph' | 'node' | 'pointer' | 'camera' | 'light' | 'shadow' | 'lookAt',
    name: '...',
    path: '...'
  },
  sampler: {
    interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | 'VMD_BEZIER',
    keyframes: []
  }
}
```

### target 共通ルール

- `kind` は対象種別
- `name` は UI / warning / mapping 用の人可読識別子
- `path` は対象種別ごとのプロパティ名
- target には補助 metadata を追加してよい

追加 metadata の例:

- `nodeName`
- `pointer`
- `role`
- `valueType`
- `vrmaExpressionName`
- `vrmaExpressionType`
- `originalTrackName`
- `bindTranslation`

## channel 種別

### `kind: 'bone'`

用途:

- ボーンの local TRS

許可 path:

- `translation`
- `rotation`
- `scale`

規則:

- 値は local 空間
- `translation` は `vec3`
- `rotation` は quaternion `[x, y, z, w]`
- `scale` は `vec3`
- bind pose と差分を保持しても raw local 値を保持してもよいが、target metadata で意味を区別できなければならない

### `kind: 'morph'`

用途:

- morph weight
- VRM expression を morph に畳み込んだ値

許可 path:

- `weights`

規則:

- 値は `number`
- 通常は `[0, 1]` またはモーフ仕様上の許容範囲
- VRM expression 由来では `vrmaExpressionName` と `vrmaExpressionType` を持ってよい

### `kind: 'node'`

用途:

- helper node
- camera rig node
- light node
- VRMA の補助 scene node

許可 path:

- `translation`
- `rotation`
- `scale`

規則:

- bone ではない runtime node の local TRS
- `role` により用途を明示してよい

推奨 role:

- `camera-target`
- `camera-orbit`
- `camera`
- `light`
- `look-at-target`

### `kind: 'pointer'`

用途:

- node TRS では表現しにくい scalar / vector parameter

許可 path:

- `value`

必須 metadata:

- `pointer`
- `valueType`

推奨用途:

- camera FOV
- light color
- 将来の post effect parameter

### `kind: 'camera'`

これは正規仕様上の論理 target 種別である。実装は `node` + `pointer` に分解して保持してもよい。

許可 path:

- `target`
- `rotation`
- `distance`
- `fov`
- `perspective`

推奨値型:

- `target`: `vec3`
- `rotation`: quaternion または internal canonical Euler のどちらか一方に統一すること
- `distance`: `number`
- `fov`: `number`
- `perspective`: `number` または `boolean`

現行実装互換:

- `camera-target` node translation
- `camera-orbit` node rotation
- `camera` node translation
- camera FOV pointer

### `kind: 'light'`

これは正規仕様上の論理 target 種別である。実装は `node` + `pointer` に分解して保持してもよい。

許可 path:

- `rotation`
- `direction`
- `color`

規則:

- `rotation` を canonical source とする
- `direction` は `rotation` から派生再構成してよい
- `position` は VMD 互換の一時値としてのみ扱い、VMD load 後の canonical storage には残さない

現行実装互換:

- light node translation
- light node rotation
- light color pointer

### `kind: 'shadow'`

用途:

- self-shadow / shadow mode

許可 path:

- `mode`
- `distance`

規則:

- VMD 互換保存ではこの種別だけを `selfShadowKeyframes` へ戻してよい
- 現行実装に channel 化が未完了でも、内部仕様としては animation 可能対象とする

### `kind: 'lookAt'`

用途:

- VRM LookAt の runtime 制御

許可 path:

- `yaw`
- `pitch`
- `weight`
- `target`

規則:

- 内部 canonical 値は yaw/pitch を優先する
- `target` は look-at target position を直接持ちたい場合のみ使う
- bone / expression どちらへ最終適用されるかは `model.vrm` の LookAt 設定で決まる

未決定:

- quaternion ベースの保持を許容するか
- rangeMap 後の値を持つか、rangeMap 前の論理 yaw/pitch を持つか

現時点では「UI から設定できる LookAt 関連値は animation 可能対象である」ことだけを固定する。

## sampler object

```js
{
  interpolation: 'LINEAR',
  keyframes: [
    {
      time: 0,
      frameNum: 0,
      value: [0, 0, 0]
    }
  ]
}
```

### interpolation

許可値:

- `LINEAR`
- `STEP`
- `CUBICSPLINE`
- `VMD_BEZIER`

補間非互換な保存時の扱い:

- `vmd` 保存では `VMD_BEZIER` 以外の bone 補間は warning を出した上で resample 可
- `vmd` 保存では morph の非互換補間も warning を出した上で resample 可
- `vrma` 保存では glTF/VRMA へ落とせる補間へ優先変換する

## keyframe object

### 共通形

```js
{
  time: 0,
  frameNum: 0,
  value: [0, 0, 0]
}
```

追加フィールドを持ってよい。

例:

- `vmdInterpolation`
- `inTangent`
- `outTangent`

### 共通規則

- `time` は秒
- `frameNum` は `timelineFps` 基準の整数 frame
- `value` の型は target/path に依存
- `time` と `frameNum` が矛盾する場合、内部 runtime では `time` を優先し、UI/保存時は warning を出して再同期してよい

## metadata

`clip.metadata` は以下のような互換・補助情報を保持してよい。

- `sourceFormat`
- `modelName`
- `vmdSignature`
- `vrmAnimation`
- `cameraKeyframes`
- `lightKeyframes`
- `selfShadowKeyframes`

ただし canonical animation payload は `channels` である。`metadata` は以下の用途に限る。

- 保存形式固有の補助情報
- 現行実装との移行互換
- warning を出しつつ保持したい未正規化情報

## 保存方針

## VMD 保存

VMD 保存は内部 clip からの lossy export とみなす。

- 保存可能なのは bone translation/rotation, morph weights, camera, light, self-shadow
- bone scale は warning を出して落としてよい
- node / pointer / lookAt / expression metadata はそのままでは保存できない
- `camera`, `light`, `shadow` は VMD keyframe へ再構成する
- `lookAt` は原則保存不能として warning を出す
- `expression` は morph weight に落ちていれば保存できる

## VRMA 保存

VRMA 保存も lossy export を許容するが、VMD より表現力は高い。

- humanoid bone channel は優先して保存する
- expression は morph channel から node translation ベースへ変換して保存してよい
- camera/light は OpenMMD 独自補助 node / pointer として保存してよい
- helper bone に依存する情報は `openMmdBoneChannels` などの拡張領域へ退避してよい
- self-shadow, post effect, renderer 固有値は標準 VRMA に落とせない場合 warning を出して落としてよい

## モデルとアニメーションの責務分離

モデルとアニメーションは以下の責務で分離する。

- model は bind/rest state と静的構造を持つ
- clip は時間変化だけを持つ
- runtime pose, manual correction, dirty flag, world matrix cache は scene / instance 側が持つ

### manual rotation 補正

- manual local/world rotation は clip の canonical 値ではなく scene / instance 側の残差補正である
- `baseRotationQuaternion` を持つ bone では、ローカル回転の実適用順は `baseRotation -> manualRotation -> animationRotation`
- manual local rotation の逆算は上記順を逆に解く
- manual world rotation の逆算はさらに `parentWorldRotation` と `inheritRotation` を先に取り除いてから行う
- manual rotation は表示上の local/world 回転を維持するための runtime correction として扱う

特に以下は model / clip に直接保存しない。

- 再生中 frame cursor
- isPlaying
- worldMatrix cache
- localDirty / worldDirty
- physics simulation state
- manual local/world correction の現在値

## 未決定事項

以下は今回の仕様で完全には固定しない。

### camera 回転の canonical 形式

- quaternion で統一するか
- VMD 互換の Euler を併記するか

現時点では runtime 再生系が一意に評価できればよい。

### lookAt の canonical 値

- yaw/pitch
- quaternion
- target position

のどれを第一正規形にするかは今後確定する。

### self-shadow の channel 化実装

仕様上は animation 対象に含めるが、現行実装は metadata 依存経路が残ってよい。

### renderer 固有アニメーション項目

UI から設定できる値のうち、どこまで `pointer` channel へ統一するかは未確定である。

推奨方針は以下である。

- scene graph で意味を持つものは `bone` / `node`
- scalar/vec3 parameter は `pointer`
- 形式固有の再構成 convenience は `camera` / `light` / `shadow` / `lookAt`

## 今後の実装指針

- 新規機能は可能な限り `clip.channels` を canonical source にする
- `metadata.cameraKeyframes` などの旧互換情報は channel から再構成できるようにする
- VRM は `XZ Flip` 済みの内部前方だけを前提とする
- helper bone は削除せず、正規化方式だけを切り替える
- 保存時 warning は情報欠落の明示を優先し、黙って丸めない
