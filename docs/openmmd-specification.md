# OpenMMD Specification

この文書は OpenMMD の仕様をまとめる。実装の責務分割は [openmmd-architecture.md](./openmmd-architecture.md) を参照し、内部 runtime の詳細は [specification/openmmd-internal-model-animation-format.md](./specification/openmmd-internal-model-animation-format.md) を参照する。

# 動作環境
|OS|バージョン|ハードウェア|ブラウザ|
|---:|---:|---:|---:|
|Android|12 以降|Qualcomm または<br/>ARM の GPU を搭載したデバイス|Chrome 121 以降|
|macOS|Tahoe 26 以降||Safari 26.0 以降|
|iOS/iPadOS|26 以降||Safari 26.0 以降|
|Windows|11||最新の Chrome|
|Linux|||最新の Chrome|

# 技術スタック
- html
- css
- javascript
- WebGPU

# UI 共通コンポーネント
共通ボタンと数値入力の仕様は [ui-components-specification.md](./specification/ui-components-specification.md) を参照する。
`index.html` の大半のスライダー・数値入力・ボタンは `openmmd-button`, `openmmd-number-control`, `openmmd-range-control`, `openmmd-range-number-control` に統一している。

## ライブラリ
|名前|バージョン|license|
|---:|---:|---:|
|[Ammo.js](https://github.com/kripken/ammo.js/)|2023|Zlib|
|Bullet|2.82|Zlib|
|[Mediabunny](https://github.com/Vanilagy/mediabunny)|1.44.0|MPL-2.0|
|[glMatrix](https://github.com/toji/gl-matrix)|3.4.4|MIT|
|[JSZip](https://github.com/Stuk/jszip)|3.10.1|MIT|
|[tga.js](https://github.com/vthibault/tga.js)|1.1.1|MIT|
|[encoding.js](https://github.com/polygonplanet/encoding.js)|2.2.0|MIT|
|[three.js](https://github.com/mrdoob/three.js)|0.184.0|MIT|

# 設定

## 初期値の優先順位

`source/defaults/defaults.json` で規定値を設定する。`index.html` の初期値は補助値として扱い、読み込み時は `defaults.json` を基底として初期 state を組み立てる。

## アニメーションとモデルの仕様

[specification/openmmd-internal-model-animation-format.md](./specification/openmmd-internal-model-animation-format.md) を参照する。


# 座標系の変換

内部モデル・内部アニメーションの座標系、helper bone、VRM 正規化方針、VRMA の `hips.translation`、およびロード・保存境界での handedness 変換は [specification/openmmd-internal-model-animation-format.md](./specification/openmmd-internal-model-animation-format.md) を参照。

## 物理回転の注意

Physics の剛体・ジョイントの Euler 回転は `YXZ` 順で扱う。OpenMMD 全体の一般的な Euler 回転順（X -> Y -> Z）と混同しないこと。

体幹・脚のボーン情報表示も `YXZ` 順で行う。


# モデル
## モデルサイズ

OpenMMD の内部長さ単位は meter とする。glTF / VRM はそのまま meter で扱い、PMD / PMX / VMD / VPD は MMD 系互換入力としてロード・保存境界で 10 倍系から meter へ変換する。pmd/pmx はロード時に 0.07876 倍にスケールされる。

MMD 由来の人物モデルは元データ上では Y が 16～20 程度になることが多いが、内部へ取り込んだ後はおおむね 1.6～2.0 meter 相当として扱う。

MMD のモデルサイズ 10 倍はおそらく物理を安定させるための仕様。モデルを巨大化させることで浮動小数点の精度の問題に対処している。モデル巨大化は Blender 等のツールでも有効で、アニメーションをベイクした後にスケールすることで元のサイズに変換する。

## VRM 1.0 の正規化ボーン名

[humanoid.ja.md](./vrm-1.0/VRMC_vrm-1.0/humanoid.ja.md) を参照。

## pmx/vrm のローカル回転軸

### モデルの１軸回転のボーンローカル回転軸

モデルの１軸回転のボーンローカル回転軸は、本来はモデル内で統一するのが望ましい。これは通常Ｘ軸かＺ軸が使われる。

### MMD/VRM/OpenMMD で使用する優先ローカル回転軸

VRM 0.x では T-pose が強制される。OpenMMD では肩サブツリーの初期ローカル基底を `leftShoulder` 側は `+Y up`, `-X`, `-Z`、`rightShoulder` 側は X 軸 180 度回転相当の `-Y up`, `+X`, `-Z` に正規化する。

[VRM 1.0 では任意のレスト回転を持てる](./vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.ja.md)。

VRM 1.0 の優先回転軸は [humanoid.ja.md](./vrm-1.0/VRMC_vrm-1.0/humanoid.ja.md) の humanoid 名を基準に解決する。OpenMMD では、VRM の実ボーン名ではなく humanoid 名に対して以下の軸ルールを適用する。

|名前|MMD ローカル回転軸|VRM 0.x|VRM 1.0 humanoid 名|
|---:|:---:|:---:|:---:|
|ひじ・肘 / `leftLowerArm` / `rightLowerArm`|Y|Y|Y|
|親指 / `leftThumb*` / `rightThumb*`|Y|Y|Y|
|指 / `leftIndex*` / `leftMiddle*` / `leftRing*` / `leftLittle*` / `rightIndex*` / `rightMiddle*` / `rightRing*` / `rightLittle*`|Z|Z|Z|
|ひざ・膝 / `leftLowerLeg` / `rightLowerLeg`|X|X|X|
|足首 / `leftFoot` / `rightFoot`|X|X|X|
|つま先 / `leftToes` / `rightToes`|X|X|X|

`hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `leftShoulder`, `rightShoulder`, `leftUpperArm`, `rightUpperArm`, `leftHand`, `rightHand`, `leftUpperLeg`, `rightUpperLeg` はこの優先回転軸の対象外とする。

一部の VMD は `人差指` ではなく `人指` を使う。また `親指先` が `親指２` 相当として入ることがある。OpenMMD では VMD→VRM の解決時にこれらを正規化して扱う。

VRM のマッピングは `model-scene.js` の `VRM_HUMANOID_PREFERRED_AXIS_MAP` を参照。

MMD モデルの腕や指は左右でローカル Y, Z の向きが反転している（X軸周りに 180 度回転している）。腕は左腕が +Y 右腕が -Y を向くことが多いが、指は統一されていない。

### ローカル回転軸がない場合の生成アルゴリズム
`source/model-scene.js` の `inferMissingBoneLocalAxes` 。

ローカル座標軸がない場合は、以下はアルゴリズムで生成する。
- ルートボーンの場合: グローバルに一致
- 親がある場合: 
  - 体・頭・脚のような Y 軸方向へ伸びるもの
    - 親からボーンへ向かう方向を正規化したものを Y とする
        - Y が +Y 方向なら Y と [1, 0, 0] とで外積をとり、Z を生成
        - Y が -Y 方向なら Y と [-1, 0, 0] とで外積をとり、Z を生成
    - Y と Z とから外積で X を生成
  - 腕・ひじ・指のような X 軸方向へ伸びるもの
    - 親からボーンへ向かう方向を正規化したものを X とする
        - X が +X 方向なら X と [0, 1, 0] とで外積をとり、Z を生成
        - X が -X 方向なら X と [0, -1, 0] とで外積をとり、Z を生成
    - X と Z とから外積で X を生成
  - その他 Z 軸方向へ伸びるもの
    - 親からボーンへ向かう方向を正規化したものを Z とする
        - Z が +Z 方向なら Z と [0, 1, 0] とで外積をとり、X を生成
        - Z が -Z 方向なら Z と [0, -1, 0] とで外積をとり、X を生成
    - X と Z とから外積で Y を生成

# レンダリング

Z-prepass レンダリングを採用しているのは影が落ちないマテリアルがあるから。透明・半透明マテリアルは pmx ファイル内の列挙順に描画する必要があるが、その場合、影が落ちないマテリアルが発生する。

## リニアワークフロー

入出力のガンマは 2.2。

## ダイナミックレンジ

デフォルトで 16。[Blender の AgX ビュー変換は 16.5 stops](https://docs.blender.org/manual/en/4.0/render/color_management.html#render-settings)。フルサイズカメラのダイナミックレンジが 15 EV 前後。

## レンダリングオーダー
1. Z-prepass レンダリングで深度バッファを作成
1. 不透明オブジェクトをカメラから見て手前から奥の順に描画
1. 透明・半透明テクスチャを持つマテリアルを、pmx ファイルの列挙順に描画。深度バッファを上書きする
1. 半透明マテリアルを描画。深度バッファは上書きしない
1. ポストエフェクト

## sss-mask
`sss-mask` は、描画後のポストエフェクトで参照する補助マスクである。主に bloom の shadow multiplier と SSS の可視面判定に使う。

### main pass での書き込み
- `mask` は `vec4<f32>` で、`(skinMask, encodedViewDepth, bloomShadowFactor, validFlag)` を格納する
- `skinMask` は skin 判定用の 0/1 値
- `encodedViewDepth` は `-viewPos.z` を `nearPlane` と `farPlane` で 0..1 に正規化した値
- `bloomShadowFactor` は bloom shadow 用の連続値で、材質・ライティング・影設定から計算する
- `validFlag` は可視ピクセルで 1、無効ピクセルで 0 とする

### resolve / filter
- `sss-mask.wgsl` は、main pass の mask をそのまま使わず、深度一致した可視 sample のみを残して resolve する
- MSAA 有効時は各 sample の深度を参照し、frontmost な可視 sample を 1 つ選ぶ
- depth mismatch の sample は `vec4<f32>(0.0)` として破棄する
- bloom は resolved 後の `sss-mask` を参照し、`mask.a` が 0 の sample は shadow multiplier の計算対象外とする

### 注意点
- `mask.g` は raw view depth ではなく、正規化済み深度として扱う
- `mask.a` は coverage / 有効判定であり、bloom の shadow multiplier が段差化しないよう、resolve 後も連続性を壊さないことが望ましい
- debug 表示では `mask.b` をそのまま可視化できるが、`mask.a` が 0 の sample は無効として扱う

### bloom banding の再現方法（バグが存在する場合）

ブルーム影乗算時の深度の正規化を忘れていたことで発生したバグ。

1. test-data/plane.glb をロードする
2. ブルームを有効にする
  - ブルーム閾値を 0 にする
  - ブルームぼかし量を 4 にする
  - ブルーム影乗算を 1 にする
3. カメラを真下に向けて、カメラを引く

## 輪郭線の描画
- 背面法（Inverted Hull）
- 押し出し量は `source/shaders/shaders.wgsl` の `let edgeOffset = 0.002 * pos.w;`
- 透過は `source/shaders/shaders.wgsl` の `sample_outline_alpha(uv)` で計算し、`sample_material_alpha(uv) * uniforms.edgeColor.a * uniforms.shadowParams.y` を使う
- edge は surface の直後に描画し、後続の transparent 材質に対して depth を書き込まない
- エッジポリゴンに奥行きバイアスを入れることでちらつきを抑制

## toon テクスチャ名の自動解決

OpenMMD では、toon テクスチャの参照方法を `toonMode` と `toonIndex` で次のように解決する。

- `toonMode === 0`
  - 通常のテクスチャリスト `model.textures` の `toonIndex` 番目を参照する
  - つまり `toonIndex` は texture list のインデックスとして扱う
  - ただし `toonIndex < 0` の場合は、`material.textureIndex + toonIndex` を参照する
  - この特例は、参照先のフォルダ名またはファイル名に `toon` を含む場合にのみ適用する
- `toonMode === 1` かつ `toonIndex !== 255`
  - 共有 `toon-textures/toon01.bmp` から `toon10.bmp` までの内部 toon テクスチャを参照する
  - `toonIndex` は 0 始まりで扱い、`toonIndex === 0` は `toon-textures/toon01.bmp`
  - 例: `toonIndex === 4` は `toon-textures/toon05.bmp`
  - アプリ初期化時に 10 枚を先読みしてキャッシュし、以後はそのキャッシュを使う
- `toonMode === 1` かつ `toonIndex === 255`
  - マテリアルが参照している通常テクスチャと同じ名前の `.bmp` を toon テクスチャとして扱う
  - 例: `01.png` を参照している場合は `01.bmp`

上記の条件で解決できない場合、そのマテリアルには toon テクスチャがないものとして扱う。

# アニメーション
内部アニメーションの canonical 形式、共有タイムライン、VMD/VRMA 保存時の warning 方針、manual rotation 補正、および `displayFrames` を含む内部モデル/アニメーション表現は [specification/openmmd-internal-model-animation-format.md](./specification/openmmd-internal-model-animation-format.md) を参照。

## VRM の注意点

`全ての親` / `下半身` helper bone、VRMA の humanoid 名と実ボーン名の相互解決、および VRM の内部表現は [specification/openmmd-internal-model-animation-format.md](./specification/openmmd-internal-model-animation-format.md) を参照。

## 注意点

ベジェ補間はボーンとカメラにのみ適用される。

## 補間曲線操作の『自動設定』は実装しない

出典 [MMDモーション研究所 補間曲線の『自動設定』について](https://site.nicovideo.jp/ch/userblomaga_thanks/archive/ar275497)

補間曲線の『自動設定』は、登録/削除したキーの前後のキーの補間曲線を自動修正する機能。以下の特徴がある:
- 登録したキー以外も修正される
- 自動で設定されるのは移動の補間のみ
- 回転は直線補間に強制される
- 設定される補間曲線は変化量に影響しない

# IK
- Solver: FABRIK を既定にし、互換性が必要な chain では内部で CCD を使い分ける
    - 制約のない通常の multi-link IK は FABRIK で位置を解く
    - 単軸制約付き chain、chain length が 1 の回転専用 IK、runtime rotation target を持つ chain は CCD 経路を使う
    - FABRIK 経路でも最終姿勢はローカル回転へ再構成し、既存の dirty flag / world recompute フローを維持する
    - `髪ＩＫ` 系の chain は、FABRIK の回転再構成時に現在姿勢の参照軸を平面投影した stable twist 基準を使い、180° 反転近傍でも髪の roll が急反転しないようにする
  - `./source/ik.js`

# モーフ処理

モーフの計算自体は CPU で実行、その結果を頂点属性（Attribute）として GPUに転送し、最終的な位置の合成は GPU (シェーダー) で行う。

1. CPU側:
    * 現在アクティブなモーフの重みに基づき、各頂点の変位量を計算
    * this.vmArray という配列に計算結果（各頂点の変位）を格納
2. GPUへの転送:
    * CPU で更新された vmArray を vmBuffer（頂点バッファ）を通じて GPU へ転送
3. GPU側:
    * 頂点シェーダー内で、元の頂点位置 aVertexPosition に CPU から送られてきた変位量 aVertexMorphを加算して最終的な位置を決定
    * コード例: pos = aVertexPosition + aVertexMorph;

**VMD にはモーフのベジェ補間情報はない**。

# 物理演算 (Physics)

- pmd/pmx: Ammo.js (Bullet PhysicsのJavaScriptポート)
- vrm: SpringBone

## 特徴
- シミュレーションは `PhysicsEngine` クラスにて管理。
- 剛体 (Rigid Body) と拘束 (Joint) に基づき運動を計算。
- MMDのボーン階層と物理剛体を同期させるため、`_preSimulation` (ボーンから剛体位置を更新) と `_postSimulation` (剛体からボーン位置を更新) の2段階でループ処理を実行。

## 処理フロー (毎フレーム)
1. `_preSimulation`: 剛体モードが Kinematic (モード0) または 剛体追従 (モード2) の場合、ボーンのワールド行列に基づいて剛体の位置・姿勢を更新。
2. `world.stepSimulation`: Ammo.js の世界で物理演算を1ステップ進める。
3. `_postSimulation`: 剛体追従 (モード1, 2) の場合、剛体の物理位置からボーンのワールド変換行列を逆算し、ボーンの回転・位置を更新。

## 技術的注意点
- 挙動の安定化のため内部では 10 倍スケールで動作させている
- 行列演算は GC 圧迫を避けるため、再利用可能なテンポラリ行列 (`_tempMatA`, `_tempMatB`, `_tempMatC`) を使用。
- ボーン階層の逆算時、特異行列によるエラーを防ぐため `mat4.invert` の結果を検証。
- 剛体とジョイントの姿勢は、PMX の Euler 回転 `[x, y, z]` を `YXZ` 順で扱う。一般のボーン/カメラの Euler 回転 `X -> Y -> Z` とは分けて扱う。
- `PhysicsEngine` では、剛体の回転を Bullet の quaternion として保持し、描画やボーン反映時はその quaternion を正規化してから行列へ戻す。
- ロード時の注意点: 剛体が `Physics Mode = 2` でその親の `Physics Mode` が `1` か `2` の 場合、剛体を `Physics Mode = 1` に正規化する。これは Physics Mode = 2 の連続が正しく動作しない問題の回避のために行われる

## physicsMode === 2（bone + physics）の挙動
シミュレーション開始前に rigid body をボーン位置に移動（回転は保持）。そのほかは `physicsMode === 1` と同じ。

# 言語設定と追加方法
- 設定: サイドバー下部の「Language」から日本語 (ja) / 英語 (en) を切り替え可能。
- 言語ファイルの追加方法:
    1. `source/langs/` ディレクトリに `{language_code}.json` を作成する。
    2. キー（`data-i18n` 属性に指定する値）と値（翻訳テキスト）を JSON 形式で記述する。
    3. `index.html` の `<select id="lang-selector">` に新しい言語の `<option>` を追加する。
- UI要素への適用方法:
    1. 翻訳したい HTML 要素に `data-i18n="翻訳キー"` 属性を付与する。
    2. `source/renderer.js` の `updateUIStrings` 関数が実行されると、すべての `[data-i18n]` 要素が自動的に走査され、`langData` から対応するテキストが適用される。

# 選択

`activeBoneIndex`: 最後に選択されたボーン
`selectedBoneIndices`: 選択されているボーン群

ボックス選択でボーンを選択したとき、`activeBoneIndex` が `null` かつ `selectedBoneIndices` が有効なケースが存在する。

クリックで複数選択すると両方にデータが入っている。

# ライト

OpenMMD の内部ライトは directional light。VMD のライトは色と位置しか持たないので、VMD との入出力時だけ近似変換を行う。

- VMD load:
  - `position` は保持しない
  - directional light の `direction` は `-normalize(position)` で近似生成する
  - `rotation` は `[0, -1, 0]` をその `direction` へ向ける quaternion で近似生成する
- VMD playback:
  - light keyframe 間の `color` は線形補間する
  - `position` は canonical な保存対象ではなく、VMD 由来の light では復元しない
  - `rotation` を毎フレームの light 向きの canonical source とする
- VMD save:
  - `rotation` または `direction` があればそこから VMD 用 `position` を逆算する
  - directional light では点光源距離を完全再現できないため、仮想距離を固定値で再構成する

完全再現はできないが、VMD の light position を「原点から見た仮想点光源位置」とみなすことで、保存時にはそこそこ一貫した見た目へ逆変換できるようにする。

VMD ロード時は点光源の位置を directional light の方向へ変換するが、位置そのものは内部状態へ保持しない。VMD 保存時に directional light の方向を点光源の位置へ逆変換する。

# シェーダ
- テクスチャ末尾に _s がつくものはスフィアマップとして解釈される
- toon テクスチャは陰色を指定する
- 背面法ポリゴンのちらつきを抑制するために、奥行きバイアスが設定されている

## 影
- Moment Shadow Mapping + Cascaded Shadow Mapping
- デフォルト解像度は 2048
- 輪郭のぼかしは ComputeShader

### アンチエイリアス
FXAA or MSAA

## キャラシェーダ
## ポストエフェクト

post effect planner でポストエフェクトシェーダの選択を行っている。

# テストデータ

[ニコニ立体ちゃん](https://3d.nicovideo.jp/works/td14712)

## VRM 版の注意点

- **test-data/AliciaSolid.vrm は VRM 0.x の secondaryAnimation を使っている**。
- VRM 0.x の `secondaryAnimation.boneGroups[*].bones` は root 列挙として解釈し、各 root から single-child descendant を leaf まで辿って spring へ展開する。
- childless root は VRM 0.x の T-pose 正規化前提を使い、親から当該 bone への方向へ仮想 tail を延長して処理する。長さはまず親子距離を使う。

Alicia は**影が無効になっているわけではないのに**顔に影が出ない。Alicia_face のベース色と shade 色の差が小さいため、影が極端に目立たない。
- Alicia_face は _ShadeShift = -0.5、_ShadeColor = [1, 0.8667, 0.84]
- Alicia_wear は _ShadeShift = 0、_ShadeColor = [0.5686, 0.7765, 0.9255]
- さらに埋め込み PNG を比較すると、Alicia_face の元テクスチャはかなり明るい肌色寄り、Alicia_wear はかなり暗く青寄り。つまり Alicia_face は「明部」と「影部」の色差が小さく、シェーダ上で shadow が入っても視認性が低い。
- 今の mtoon-shader.wgsl は diffuseColor = mix(shadeColor, baseColor, shadeMix) で色を切り替える実装なので、Alicia_face は影が「落ちていない」ように見えやすい。source/shaders/custom-shaders/mtoon-shader.wgsl:31

# gltf 2.0
- [KhronosGroup/glTF](https://github.com/KhronosGroup/glTF/tree/main/specification/2.0)
- [glTF™ 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

# VRMA

## VRMA は humanoid 名で保存する

VRMA 保存時は、ボーンに humanoid 名の対応があれば、その humanoid 名で書き出す。

根拠は `source/loader/vrma-writer.js`。buildInverseHumanoidBoneNameMap() が実ボーン名 -> humanoid 名の逆引きを作り、buildVrmaExportClipFromInstance() と normalizeVrmaHumanoidClipForExport() で channel.target.name をその humanoid 名に置き換える。さらに filterVrmaClipForExport() で humanoid 名集合に含まれるものだけを通しているので、最終出力も humanoid 名基準。

補足すると、createVrmaScene() と patchGlbWithVrmaExtension() でも humanoid 名をそのままノード名・humanBones キーとして使っている。例外は 全ての親 などの特別扱いボーンのみ。

# pmd/pmx - vrma マッピングと vrm - vmd マッピング

この節では、アクティブモデルとアクティブ animation source の組ごとに保持するボーンマッピングの基本方針を定義する。対象は `pmd/pmx -> vrma` と `vrm -> vmd` の両方で、source 側のボーン名を target 側の実ボーン名または humanoid 名へ解決して再生時に適用する。

- マッピングは `instance/source` ごとに遅延初期化で保持し、未使用の source には state を作らない。
- source 側の channel 名はそのまま列挙し、target はモデル側のボーン一覧から選ぶ。
- `pmd/pmx -> vrma` では、VRMA の humanoid 名と PMX の標準 MMD ボーン名を相互解決し、PMX 側は T ポーズ正規化と rest rotation を前提に適用する。
- `vrm -> vmd` では、VRM の humanoid 名と実ボーン名を正規化して VMD の bone channel 名へ対応付ける。
- 回転オフセットは Euler `XYZ` を quaternion 化して前掛けし、位置オフセットは加算、スケールオフセットは成分ごとに乗算する。
- 未割当の行は適用しない。重複した target は一意に解決し、再生時の適用先が曖昧にならないようにする。
- `source/animation-mapper.js createDefaultRotationFlipAxes` で対象外アニメーションファイルのフリップ軸の設定ができる

# ビルド

> npm run build:pages