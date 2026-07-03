# スカート/髪反転バグ分析

• 原因は VRM の右手系変換で、hair / skirt 系ボーンのローカル基底に 180° の X 回転相当を埋め込んでしまっていることで
  す。

  /D:/data/program/openmmd/source/loader/handedness-utils.js:114 の convertModelBonesToPositiveZ() は、各ボーンで
  localX と localZ に Z flip を入れ、その後 localY = cross(localZ, localX) で再構成しています。AliciaSolid.vrm の
  hair* / skirt* は変換前の glTF 基底がほぼ全部 X=[1,0,0], Y=[0,1,0], Z=[0,0,1] なので、変換後に X=[1,0,0],
  Y=[0,-1,0], Z=[0,0,-1] になります。これはそのまま Rx(pi)、つまり X=180° のレスト回転です。実際に /D:/data/program/
  openmmd/source/math-utils.js:207 の quaternionFromBasis() に入れると q=[1,0,0,0]、Euler では x=-pi になります。

  この基底は /D:/data/program/openmmd/source/model-scene.js:2071 の createBoneLocalTransform() で quat.fromMat3() さ
  れて、そのままボーンの初期 worldRotation になります。さらに /D:/data/program/openmmd/source/model-
  manager.js:632 / /D:/data/program/openmmd/source/model-manager.js:690 では Euler 入出力がこの姿勢基準で処理される
  ので、hair / skirt のような自由回転ボーンでは X 回転だけが「最初から 180° ずれた軸」で見えます。

  hair / skirt だけ目立つ理由は、そこが humanoid 軸制約を持たない全軸アンロックの二次ボーンだからです。腕や脚も同じ
  基底変換は入っていますが、rotationLocks や IK 制約で症状が露出しにくいです。

  要するに、問題は「位置の Z flip」ではなく、「glTF/VRM のローカル基底まで鏡映して、回転基底を Rx(pi) にしてしまって
  いること」です。次に直すなら、VRM の基底変換方針を position 系と rotation basis 系で分離して扱う必要があります。

   # VRM 二次ボーン X 回転ずれ修正プラン

  ## Summary

  AliciaSolid.vrm の skirt* と hair* の X 軸回転ずれは、VRM の右手系変換でボーンのローカル基底まで鏡映し、
  localY=[0,-1,0], localZ=[0,0,-1] を作ってしまっているのが原因です。修正では、VRM の「位置系の handedness 変換」
  と「ボーン回転基底」を分離し、自由回転ボーンで Rx(pi) 相当の基底が入らないようにします。

  ## Key Changes

  - source/loader/handedness-utils.js
      - convertModelToPositiveZFacing() のボーン変換を見直す。
      - bone.position と tailOffset は引き続き Z flip する。
      - bone.localX/localY/localZ は一律の鏡映変換をやめ、右手系のまま OpenMMD が解釈できる基底へ再構成する。
      - 実装方針は「基底行列を直接鏡映して cross で戻す」のではなく、glTF の rest rotation を保持する向きで right-
        handed basis を生成する方式に統一する。

  - source/model-scene.js
      - createBoneLocalTransform() が bone.localX/Y/Z から作る初期 worldRotation が、自由回転ボーンで X=pi
        を含まないことを前提に確認する。

      - 既存の軸補完 inferMissingBoneLocalAxes() は VRM の既存基底があるボーンには介入しないまま維持する。

  - VRM の適用範囲
      - humanoid / 非 humanoid を分けず、VRM ローダーが持ち込む全ボーンで同じ基底ルールを使う。
      - position, tailOffset, SpringBone collider / gravityDir, animation translation は従来どおり handedness 変換
        対象とする。

      - 回転データは morph bone quaternion と animation quaternion のみ変換し、ボーンの rest basis は別ルールで扱
        う。

  - 期待する最終状態
      - hair* / skirt* の bone.localY は -Y にならない。
      - createBoneLocalTransform() 後の初期 worldRotation は、これらのボーンで恒常的な X=±pi を持たない。
      - PMD/PMX/VPD の既存 helper 利用は維持し、VRM だけボーン基底処理を分岐する。

  ## Test Plan

  - tests/gltf-loader.test.mjs
      - AliciaSolid.vrm の代表 hair / skirt ボーンで localY[1] > 0 を確認する。
      - 同ボーンの localZ と tailOffset が +Z 前方に整合していることを確認する。

  - 新規回帰テスト
      - AliciaSolid.vrm の hair または skirt ボーンについて、初期 worldRotation を quaternionToEulerXYZ() したとき
        |x| < 0.1 程度であることを確認する。

      - 同ボーンへ setManualWorldRotationEuler(..., [deltaX,0,0]) を与えたとき、読み戻し Euler の X が同符号・同程
        度で返ることを確認する。

  - 既存回帰
      - tests/handedness-utils.test.mjs
          - VRM 用ボーン基底の期待値を更新し、位置変換と回転基底変換を別々に検証する。

      - node --test tests/handedness-utils.test.mjs tests/gltf-loader.test.mjs tests/vrm-springbone.test.mjs
        tests/loader-winding.test.mjs tests/vpd-loader.test.mjs tests/pmd-loader.test.mjs tests/pmd-
        physics.test.mjs tests/zip-pmx-loader.test.mjs

  ## Assumptions

  - 修正対象は「VRM のボーン rest basis の扱い」であり、メッシュの Z flip と winding は変更しない。
  - hair / skirt だけの特例処理は入れず、VRM ボーン基底の一般則として直す。
  - OpenMMD 内部の前方は引き続き +Z、VRM のロード後モデルもそれに揃える。
