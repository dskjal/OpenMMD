# VRM 1.0 ローダー実装で参照すべき情報

このメモは、VRM 1.0 を OpenMMD に取り込むローダーを実装する際に、先に読んでおくべき箇所をまとめたものです。
仕様の根拠と、プロジェクト内の既存実装の参照点を分けて記録しています。

## まず読む仕様

- VRM 1.0 の全体像と、同時に使う拡張の前提は `docs/vrm-1.0/VRMC_vrm-1.0/README.md:52`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:56`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:61`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:62`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:63` を確認する。
- VRM は glTF のシーン全体として扱い、モデル移動は Hips だけでなく glTF scene root を動かす前提があるので、`docs/vrm-1.0/VRMC_vrm-1.0/README.md:87`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:91`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:96` を押さえる。
- OpenMMD では VRM を `GLTFLoader` の出力として受け取り、鏡映の Z flip は行わない。VRM 用の後処理は、ボーンマップや MToon の付与に加えて、loader 段階で `XZ Flip` を入れる。
- 仕様上、VRM 1.0 は `.glb` に保存し `.vrm` 拡張子を使うので、入出力の扱いは `docs/vrm-1.0/VRMC_vrm-1.0/README.md:143` を見る。
- glTF 側の更新点として、`animations` と `cameras` は使わず、`TANGENT` は再計算可、`meshes[*].extras.targetNames` を morph 名に使うので、`docs/vrm-1.0/VRMC_vrm-1.0/README.md:151`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:160`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:165`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:173`, `docs/vrm-1.0/VRMC_vrm-1.0/README.md:179` を読む。

## Humanoid と T-pose

- Humanoid の骨一覧と必須親子関係は `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:34`, `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:40`, `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:47`, `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:50`, `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:51`, `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:127` を参照する。
- Humanoid bone の transform は正の uniform scale が必須なので、スケールが壊れているモデルはローダー側で扱いを決める必要がある。根拠は `docs/vrm-1.0/VRMC_vrm-1.0/humanoid.md:36`。
- VRM T-pose は見た目と数値の両方で定義され、頭から足先までの向き、足の向き、床面、腕の水平、肩の低さ、手の向き、指の向きが規定される。`docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:8`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:24`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:26`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:33`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:39`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:48`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:53`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:61`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:66`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:71`, `docs/vrm-1.0/VRMC_vrm-1.0/tpose.md:84` を確認する。
- VRM-1.0 では rest rotation が無回転に固定されていないので、アニメーションや retarget の実装は rest rotation を前提にする。`docs/vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md:20`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md:23`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md:42`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md:86`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md:98` が重要。
- 左右非対称モデルでは鏡映変換を使うと見た目の左右意味と humanoid 名の左右意味がずれる。OpenMMD ではこれを避けるため、VRM は `XZ Flip` で内部前方をそろえる。

## Meta, FirstPerson, LookAt, Expressions

- Meta は必須項目が多く、`name`, `authors`, `licenseUrl` が最低限のコア情報になる。`docs/vrm-1.0/VRMC_vrm-1.0/meta.md:14`, `docs/vrm-1.0/VRMC_vrm-1.0/meta.md:28`, `docs/vrm-1.0/VRMC_vrm-1.0/meta.md:30`, `docs/vrm-1.0/VRMC_vrm-1.0/meta.md:36`, `docs/vrm-1.0/VRMC_vrm-1.0/meta.md:121` を見る。
- `licenseUrl` は VRM Public License の URL に制約があるので、ライセンス UI や保存処理の実装で流し読みしない。`docs/vrm-1.0/VRMC_vrm-1.0/meta.md:15`, `docs/vrm-1.0/VRMC_vrm-1.0/meta.md:20` を参照する。
- FirstPerson は meshAnnotations が基本で、`auto` のときは Head 由来の頂点を thirdPersonOnly に分割する。未指定なら全 mesh を auto とみなす。`docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:16`, `docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:20`, `docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:26`, `docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:37`, `docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:43`, `docs/vrm-1.0/VRMC_vrm-1.0/firstPerson.md:46` が実装の基準になる。
- LookAt は右手系・Y-Up・Z-Forward を使い、LookAt space は Head の rest rotation を逆向きにした空間で計算する。`docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:23`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:25`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:82`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:84`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:89`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:97` を読む。
- LookAt の yaw/pitch の正方向、bone と expression の適用先、rangeMap のゼロ入力時の扱いは落とし穴なので、`docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:98`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:120`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:129`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:136`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:164`, `docs/vrm-1.0/VRMC_vrm-1.0/lookAt.md:178` を優先する。
- Expressions は MorphTarget, MaterialColor, TextureTransform の集合で、値は [0,1] に clamp される。`docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:121`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:133`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:200` を確認する。
- 規定の preset, procedural override, `isBinary` の相互作用はローダー側で見落としやすい。`docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:137`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:206`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:241`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:268`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:282`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:294`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:321`, `docs/vrm-1.0/VRMC_vrm-1.0/expressions.md:336` が重要。

## VRM Animation

- VRM Animation は「アニメーション専用 glTF」に付く拡張で、基本は glTF の animation を使う。先頭の animation を読むのが原則で、30 fps を目安にする。`docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:84`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:97`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:99`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:103` を見る。
- Humanoid の animation は T-pose を基準にし、scale を含めず、Hips 以外への translation を含めない。`docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:127`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:131`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:132`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:133`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:137`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:142` を参照する。
- Expressions の animation は translation の X 成分で weight を表し、LookAt 由来の preset は別扱いになる。`docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:145`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:157`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:163`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:165` を読む。
- LookAt の animation は quaternion を yaw-pitch に変換し、Euler の解釈は Extrinsic ZXY である。`docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:167`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:180`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:181`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:182`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:187`, `docs/vrm-1.0/VRMC_vrm_animation-1.0/README.md:192` を参照する。

## SpringBone と Constraint

- SpringBone は root から descendants の順に解決し、world space を基本にする。center space は spring ごとに指定できる。`docs/vrm-1.0/VRMC_springBone-1.0/README.md:193`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:197`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:201`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:442`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:444` が核になる。
- SpringBone の joint は連続した親子関係が前提で、末端以外のスキップや重複は注意が必要。`docs/vrm-1.0/VRMC_springBone-1.0/README.md:382`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:385`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:387`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:388`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:159`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:188` を見る。
- Collider は sphere/capsule で、offset/tail は target node の local coordinate で定義される。`docs/vrm-1.0/VRMC_springBone-1.0/README.md:319`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:324`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:326`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:327`, `docs/vrm-1.0/VRMC_springBone-1.0/README.md:328` を押さえる。
- Node Constraint は roll / aim / rotation の 3 種で、source の循環依存は禁止、weight は 0..1 の slerp だと解釈する。`docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:79`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:96`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:100`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:105`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:107` を確認する。
- Roll/Aim/Rotation の意味と軸の取り方は実装差が出やすいので、`docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:111`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:132`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:164`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:184`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:213`, `docs/vrm-1.0/VRMC_node_constraint-1.0/README.md:225` を参照する。

## Materials

- `VRMC_materials_mtoon` は `KHR_materials_unlit` より優先され、色とテクスチャは基本的に linear colorspace で扱う。`docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:98`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:100`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:144` を確認する。
- MToon は vertex color を無視し、alphaMode / transparentWithZWrite / renderQueueOffsetNumber / doubleSided の扱いに独自ルールがある。`docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:148`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:175`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:179`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:187`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:211`, `docs/vrm-1.0/VRMC_materials_mtoon-1.0/README.md:240` を見る。
- Emissive の HDR 拡張は旧 `VRMC_materials_hdr_emissiveMultiplier` で、今は `KHR_materials_emissive_strength` に置き換えられている。既存実装との互換や import 対応では `docs/vrm-1.0/VRMC_materials_hdr_emissiveMultiplier-1.0/README.md:15`, `docs/vrm-1.0/VRMC_materials_hdr_emissiveMultiplier-1.0/README.md:23`, `docs/vrm-1.0/VRMC_materials_hdr_emissiveMultiplier-1.0/README.md:54` を見る。

## OpenMMD 側の実装前提

- OpenMMD 全体は右手系で、MMD 由来データは左手系から変換する。一般 Euler は `X -> Y -> Z`、物理回転は `Y -> X -> Z` なので、VRM の LookAt や spring/constraint と混同しないこと。`docs/openmmd-specification.md:31`, `docs/openmmd-specification.md:33`, `docs/openmmd-specification.md:37`, `docs/openmmd-specification.md:44`, `docs/openmmd-specification.md:48`, `docs/openmmd-specification.md:202` を参照する。
- VRM は MMD 系入力と違って left-handed -> right-handed の鏡映変換を使わない。現行実装では SpringBone、LookAt、animation、IK は `XZ Flip` 済み内部データをそのまま world space で解釈する。
- モデルの 1 軸回転やローカル基底の補完方針は `docs/openmmd-specification.md:54`, `docs/openmmd-specification.md:58`, `docs/openmmd-specification.md:68` と `source/model-scene.js:339`, `source/model-scene.js:401`, `source/model-scene.js:511`, `source/model-scene.js:524`, `source/model-scene.js:537` を合わせて読むと分かりやすい。
- アニメーションは VMD 前提から glTF 互換の clip/channel/sampler に寄せつつあり、保存や再生の基礎は `docs/openmmd-specification.md:140`, `docs/openmmd-specification.md:144`, `docs/openmmd-specification.md:146`, `source/gltf-animation.js:25`, `source/gltf-animation.js:120`, `source/gltf-animation.js:155` が参考になる。

## 既存コードの参照点

- `source/loader/gltf-loader.js:110`, `source/loader/gltf-loader.js:118`, `source/loader/gltf-loader.js:172`, `source/loader/gltf-loader.js:194`, `source/loader/gltf-loader.js:285` は、glTF を内部モデルへ落とし込むときの骨・頂点・材質・アニメーションの基本形として参照価値が高い。
- `source/loader/vpd-loader.js:200`, `source/loader/vpd-loader.js:213` は、左手系から右手系への位置・クォータニオン変換の最小例として使える。
- `source/loader/pmx-loader.js:78`, `source/loader/pmx-loader.js:84`, `source/loader/pmx-loader.js:134`, `source/loader/pmx-loader.js:178` は、Z-flip と winding 補正の実例として参照する。
- `source/loader/triangle-winding.js:1` は、3 頂点単位で winding を反転する共通処理。
- `source/physics.js:806`, `source/physics.js:813` は、物理回転が `YXZ` 扱いであることの実装根拠。
- `source/model-scene.js:339`, `source/model-scene.js:348`, `source/model-scene.js:428`, `source/model-scene.js:461` は、骨の local basis 補完と回転ロック初期化の参照点になる。
- `source/gltf-animation.js:25`, `source/gltf-animation.js:99`, `source/gltf-animation.js:163`, `source/gltf-animation.js:180` は、glTF animation を内部 clip に変換する流れと、LookAt / expression / bone TRS の扱いを考えるときに役立つ。
- `pmx-inspector.html:96`, `pmx-inspector.html:138`, `pmx-inspector.html:153`, `pmx-inspector.html:175`, `pmx-inspector.html:231`, `pmx-inspector.html:248` は、既存のインスペクタが PMX の header / material / bone / rigidbody / joint をどう表示しているかの比較材料になる。

## 実装メモ

- VRM 1.0 は「Humanoid + Meta が必須」「FirstPerson / Expressions / LookAt は任意」「SpringBone / Node Constraint は実運用でほぼ必須」という見方をすると整理しやすい。
- ローダー実装では、まず glTF の素の構造を取り込んでから、VRMC_vrm の各サブ拡張を順に解釈するのが安全。
- 特に `LookAt`、`Expressions`、`SpringBone`、`Node Constraint` は更新順の依存があるので、単純なデータ読み込みではなく実行順まで意識して設計する。

### VRM displayFrame

- VRM の `displayFrames` は Humanoid のボーン群から OpenMMD 側で合成する。
- グループは `胴 (Torso)`, `頭 (Head)`, `脚 (Legs)`, `腕 (Arms)`, `指 (Fingers)` を使い、どれにも入らないボーンは `その他 (rest)` にまとめる。
- 実際にボーンが入るグループだけを出力し、空の displayFrame は作らない。
- `displayFrames` はタイムラインのボーン表示順に使うので、Humanoid の分類と `rest` の範囲を崩さないこと。

### 実装サンプル
- [pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- [virtual-cast/babylon-vrm-loader](https://github.com/virtual-cast/babylon-vrm-loader/)



## ローカル座標

VRM1.0の仕様では、OpenMMD（ひじ＝Y軸、ひざ＝X軸など）のように「ボーン単体の特定のローカル回転軸を拘束・強制するルール」はないが、ボーンの構造定義や、ポーズの互換性を保つための「レスト回転（初期回転）」の扱いについて重要な定義がある。

### 1. ボーンのグループ化と分類（Humanoidボーン）

humanoid.ja.md にて、人型モデルとして定義されるボーン（ HumanBone）の一覧と親子関係が定義されています。ボーンは以下のグループに分類されています。

• 胴 ( hips  [必須],  spine  [必須],  chest ,  upperChest ,  neck )
• 頭 ( head  [必須],  leftEye ,  rightEye ,  jaw )
• 脚 ( leftUpperLeg  [必須],  leftLowerLeg  [必須],  leftFoot  [必須],  leftToes ,  rightUpperLeg  [必須], rightLowerLeg  [必須],  rightFoot  [必須],  rightToes )
• 腕 ( leftShoulder ,  leftUpperArm  [必須],  leftLowerArm  [必須],  leftHand  [必須],  rightShoulder , rightUpperArm  [必須],  rightLowerArm  [必須],  rightHand  [必須])
• 指 (親指・人差し指・中指・薬指・小指それぞれの関節。左右それぞれ  ThumbMetacarpal ,  ThumbProximal , ThumbDistal ,  IndexProximal ,  IndexIntermediate ,  IndexDistal  等)

VMD では `人差指` ではなく `人指` と書かれる場合がある。また `親指先` が `親指２` 相当として入ることがある。OpenMMD の VMD→VRM マッピングではこれらの表記ゆれを正規化して扱う。

hips  をルートとする親子階層構造（humanoid.ja.md）もここで厳密に定義されています。

### 2. 初期ポーズ（T-pose）における軸と方向の定義

tpose.ja.md にて、VRMモデルが初期姿勢（VRM T-pose）のときに、メッシュや各部位が向くべき「グローバル方向」が規定されています。

• 基本の向き: 足・胴体・頭・目の見た目は +Z軸 の方向を向き、X軸で左右対称に立つ。
• 腕・手: 腕および手は X軸 に沿って伸び、地面と平行。手のひらは -Y軸 の方向を向く。
• 指（親指以外）: 4本の指は X軸 に沿って伸び、爪の面は +Y軸 の方向を向く。
• 親指: 地面と平行で、 X軸と+Z軸の中間（45度） の方向に伸びる。爪の面は他の指から90度ロールした向き（左手親指は+Xと+Zの中間、右手親指は-Xと+Zの中間を向く）。

### 3. ローカル回転軸（レスト回転）の仕様とポーズ変換

how_to_transform_human_pose.ja.md に、ボーンのローカル座標・回転軸に最も関係する仕様が記載されています。

• レスト回転の制約撤廃:
VRM-0.Xでは「T-pose状態でのボーンの初期回転（レスト回転）は無回転（Identity）」と制限されていましたが、VRM-1.0ではレスト回転の制約が撤廃されました。これにより、VRM-1.0モデルは任意のレスト回転（初期ローカル軸）を持つことができます。
• 中間形式（NormalizedLocalRotation）によるポーズ変換:
モデルごとにローカル軸（レスト回転）が異なるため、ポーズデータの互換性を保つための中間形式
NormalizedLocalRotation

（レスト回転が無回転のモデルに適用したときの回転値）が導入され、以下のようなクォータニオンの変換式が定義されています。

$$ \mathrm{NormalizedLocalRotation} = W \cdot L^{-1} \cdot A.\mathrm{LocalRotation} \cdot W^{-1} $$

（※ $W$ はWorldレスト回転、$L$ はLocalレスト回転）

### 4. その他の軸・回転関連の記述

• オイラー角の回転順序:
README.ja.md では、アニメーションデータの記述として「オイラー角の回転順序は、Extrinsic ZXYで解釈し、Y軸周りをyaw、X軸周りをpitchとする」とされています。
• コンストレイント（ねじれ・エイム）の軸:
README.ja.md では、補助ボーン（ツイストボーン等）に対して、どのローカル軸（ "X" ,  "Y" ,  "Z"）を元に回転制限・追従を行うか（ Roll Axis  /  Aim Axis ）を指定するプロパティが定義されています。
