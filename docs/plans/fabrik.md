 # FABRIK IK 既定化

  ## Summary

  - source/ik.js に _fabrikSolver(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty) を追加し、
    solveIk() の既定経路を _ccdSolver から _fabrikSolver に切り替える。

  - 既存の solveIk シグネチャと worldDeltaToLocalDelta などの公開 API は維持する。
  - 仕様書は docs/openmmd-specification.md の IK 節を CCD + damping 前提から、FABRIK を既定ソルバーとする実装に更
    新する。

  ## Implementation Changes

  - source/ik.js
      - solveIk() を _fabrikSolver() 呼び出しへ変更する。
      - _fabrikSolver() は chain ごとに以下の順で処理する。
          1. 現在の各 link/world 位置を収集し、chain root から effector までの各セグメント長を固定長として取得。
          2. 目標点が到達不能なら、root から target 方向へ各セグメントを一直線に並べる。
          3. 到達可能なら backward/forward pass を chain.loopCount 回まで回し、effector-target 距離が
             getChainDistanceEpsilon(chain) 以下なら停止。

          4. 各反復後、各 link の新しい world 向きから local 回転を再構成し、markBoneLocalTransformDirty() と
             recomputeWorldTransforms() を通して scene を同期する。

      - 既存の補助ロジックは流用または FABRIK 用に組み替える。
          - getChainDistanceEpsilon() はそのまま使用。
          - constrainLinkRotation() と単軸 X 制約ロジックは FABRIK で算出した local 回転へ毎 link 適用する。
          - 肘の優先軸射影 projectRotationToBonePreference() は、回転再構成後に単軸回転ボーンへ適用する。
          - runtime IK の rotationTargetBoneIndex 後処理は現行の applyRuntimeEffectorRotation() を維持し、位置解決
            後に同じ順序で適用する。

      - chain.links.length === 1 の回転専用 IK も _fabrikSolver() 内で扱う。
          - セグメント位置更新ではなく、link から effector と target を向かせる回転を直接構成し、既存制約適用後に
            正規化する。

      - _ccdSolver() は残すが既定経路からは外す。新旧比較や将来の退避用途として private helper のまま保持する。

  ## Tests

  - 既存回帰が通ることを確認する。
      - tests/left-leg-ik-upward-regression.test.mjs
      - tests/knee-flip-repro.test.mjs
      - tests/miku-runtime-elbow-ik-regression.test.mjs
      - tests/alicia-right-leg-ik-regression.test.mjs

  - FABRIK 固有の追加テストを入れる。
      - 2-link 脚 IK で target に届く or distanceEpsilon 以内へ収束すること。
      - 到達不能 target で root から target 方向へ最大伸長し、各セグメント長が保持されること。
      - 単軸 X 制約付き膝で制約範囲外へ出ないこと。
      - chain.links.length === 1 の回転専用 IK で effector の向きだけが更新され、不要な並進が入らないこと。
      - runtime IK で effector 位置一致と rotationTargetBoneIndex の後追い回転が維持されること。

  ## Important Interfaces

  - 公開 API 変更なし。
      - solveIk(model, scene, recomputeWorldTransforms, markBoneLocalTransformDirty)
      - worldDeltaToLocalDelta(scene, model, boneIndex, deltaWorld)

  - 追加するのは private helper のみ。
      - _fabrikSolver(...)
      - FABRIK 用の chain position/rebuild helper 群

  ## Assumptions

  - 既存の scene.ikChains 構造はそのまま使い、solver 切替用の新規設定値や UI は追加しない。
  - FABRIK 実装でも link 回転は最終的に local quaternion へ反映し、OpenMMD の既存 dirty/recompute フローを崩さな
    い。

  - ドキュメント更新対象は docs/openmmd-specification.md の IK 節に限定し、API 仕様書の更新は不要。