# VRMA/VRM Execution Path Split Refactor

  ## Summary

  - 目的は、vrma -> vrm と vmd -> vrm の実行パスを関数レベルで分離し、今回壊れた VRMA 挙動を既存回帰テストが通る状
    態へ戻すこと。

  - 分離対象は source/animation-mapper.js と source/animation.js の両方にする。
  - 方針は「VRMA の既存挙動を復元してから分離」。仕様変更や期待値更新はしない。

  ## Key Changes

  - source/animation-mapper.js
      - createResolvedAnimationBoneMappings() の中にある source-kind 分岐を、少なくとも以下の専用関数へ切り出す。
      - createResolvedVmdVrmBoneMapping(...)
      - createResolvedVrmaVrmBoneMapping(...)
      - 共通部分は createBaseResolvedBoneMapping(...) のような source-kind 非依存ヘルパーへ寄せるが、VMD/VRMA の
        basis correction・rest rotation・world retarget 判定は共有しない。

      - createVmdVrmBasisCorrectionQuaternion() と createVrmaBasisCorrectionQuaternion() の周辺も、命名上・呼び出
        し上ともに完全に別経路にする。

      - 今回壊した VRMA 補正は復元する。
      - getVrmaTargetBasisQuaternion() は前回の「上半身/指/手をまとめて新定数に寄せた変更」をやめ、既存テスト期待
        値に一致する軸補正へ戻す。

      - VMD_* 定数変更が VRMA 側に影響しないよう、VMD 用と VRMA 用の basis 定数セットを別グループとして整理する。

  - source/animation.js
      - AnimationController.updateBones() の explicit mapping 適用分岐を、source kind ごとの専用関数へ切り出す。
      - 例:
          - applyMappedBoneTranslation(...)
          - applyVmdMappedBoneRotation(...)
          - applyVrmaMappedBoneRotation(...)
          - applyMappedBoneScale(...)

      - if (mapping.sourceKind === 'vrma') の inline 分岐をやめ、呼び出し側でディスパッチする。
      - applyVrmaMappedRotation(...) は維持しつつ、VRMA path 専用 helper として閉じる。VMD path は別 helper にし
        て、basis correction と rotationOffset の合成順を VRMA と共有しない。

  - 実装上の復元ポイント
      - VRMA の失敗は「補正軸が変わった」ことが原因なので、前回追加した VRMA_XZ_FLIP_BASIS_QUATERNION /
        VRMA_UPPER_LIMB_AXIS_CORRECTION_QUATERNION の使い方を見直し、既存回帰に合う補正へ戻す。

      - getVrmArmTargetBasisQuaternion() から消した VRM0 特例は、VRMA には不要でも VMD 側回帰との関係があるので、
        source kind ごとに責務を分けたうえで必要な経路だけへ戻す。

      - 変更範囲は animation-mapper と animation に閉じ、loader・model data・テスト期待値そのものは変えない。

  ## Test Plan

  - 単体:
      - node --test tests/animation-mapper.test.mjs
      - VMD path の unit と VRMA path の unit が両方通ること。

  - VRMA 回帰:
      - node --test tests/alicia-vrma-arm-rotation-regression.test.mjs
      - node --test tests/alicia-vrma-right-leg-rotation-regression.test.mjs
      - ここで少なくとも torso, upperArm, lowerArm, upperLeg, lowerLeg, finger の既存期待値が復元されること。

  - VMD 側の非回帰確認:
      - node --test tests/alicia-vmd-arm-rotation-regression.test.mjs tests/alicia-vmd-ik-translation-
        regression.test.mjs

      - まだ skip のままにしているなら、この refactor では skip を維持してよい。ただし新たな失敗を増やさないこと。

  - 受け入れ条件:
      - animation-mapper.js と animation.js の両方で、VMD/VRMA の main execution path が専用関数に分かれている。
      - VRMA 回帰テストが通る。
      - VMD 用の refactor が VRMA の軸補正を再び壊さない。

  ## Assumptions

  - ユーザーの「vrm とvrma とで関数レベルで実行パスを分ける」は、実質的には vmd -> vrm と vrma -> vrm の source-
    kind ごとの明確な関数分離を指すものとして扱う。

  - 既存 VRMA 回帰テストの期待値が正で、今回はそれを仕様の基準にする。
  - API 追加や docs 更新は不要。内部リファクタと回帰修正に限定する。