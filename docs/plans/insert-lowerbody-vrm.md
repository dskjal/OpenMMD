# VRM ロード時の 下半身 ボーン挿入

  VRM ロード時のボーン正規化に、既存の 全ての親 挿入に続く形で 下半身 ボーン挿入を追加する。
  下半身 は hips を親にし、初期位置は spine と同じ、初期回転は 0、hips の直下にある spine 以外の子ボーンをすべて
  下半身 配下へ付け替える。既存の humanoid 名解決や UI 側 API は変更しない。

  ## Implementation Changes

  - source/loader/gltf-loader.js
      - VRM 用ボーン正規化を 全ての親 だけでなく 下半身 まで一括で扱う形に整理する。
      - 全ての親 挿入後のボーン配列に対して 下半身 を追加する専用処理を実装する。
      - 挿入条件:
          - hips に対応する実ボーン名と spine に対応する実ボーン名を、ボーン名ベースで解決できる場合のみ適用する。
          - 既に 下半身 が存在する場合は二重追加しない。

      - 挿入内容:
          - 新規ボーン名は 下半身
          - 親は hips
          - position は spine.position のコピー
          - 回転系は初期状態のまま 0 相当を維持し、追加の回転値は持たせない
          - gltfNodeIndex は -1
          - ローカル軸は単位基底
          - transformLevel は hips より 1 段深くし、子側の transform 順が破綻しないように整合させる

      - 親子付け替え:
          - parentIndex === hipsIndex のボーンのうち spine 本体を除外し、すべて 下半身 を親に変更する
          - これにより通常の脚系や hips 直下の補助ボーンは 下半身 配下へ移る
          - spine の親は引き続き hips

      - 参照整合:
          - 配列途中への 1 件追加になるため、parentIndex / tailIndex / inheritParentIndex / ikTargetIndex の後方
            index をシフトする

          - object, gltfNodeIndex, humanoid 対応表の意味は維持する

  - source/loader/vrm-loader.js
      - GLTFModelLoader へ渡す VRM 用オプションを 全ての親 と 下半身 の両方を含む名前に整理するか、少なくとも実装
        意図が分かるようにコメントを補う

      - 既存の applyVrmBoneTranslatability() は hips と 全ての親 のみ translatable のままでよい。下半身 を追加で
        translatable にはしない

  - docs/openmmd-specification.md
      - VRM の注意点に、全ての親 に加えて 下半身 もロード時に挿入されることを追記する
      - 下半身 の親子ルール:
          - 親は hips
          - 位置は spine と同じ
          - hips 直下の spine 以外の子を受け持つ

      - vrma への扱いは既存方針に合わせて、OpenMMD 内部拡張ボーンとして記述する

  ## Public Interfaces / Types

  - 外部 API 追加なし
  - モデル構造の読み込み結果として、VRM では内部ボーン配列に 下半身 が追加される
  - model.vrm.humanoidBoneNameMap のキー/値仕様は変更しない

  ## Test Plan

  - tests/gltf-loader.test.mjs
      - VRM 読み込み時に 全ての親 に加えて 下半身 が存在すること
      - 下半身.parentIndex が hips を指すこと
      - 下半身.position が spine.position と一致すること
      - spine.parentIndex は hips のままであること
      - hips 直下だった spine 以外の子ボーンが 下半身 配下へ移ること

  - tests/model-scene-bone-getters.test.mjs
      - VRM の名前解決後も 全ての親 / hips / 下半身 が期待どおり取得できること

  - 既存 VRM 回帰
      - 自動 IK, spring bone, custom rig が 下半身 追加で壊れないことを既存テストで確認する
      - 特に 全ての親 固定前提の index 断定があれば、名前解決ベースの assertion に寄せて壊れにくくする

  ## Assumptions

  - 対象は VRM ロード時のみで、通常の glTF / PMX / PMD には適用しない
  - 下半身 は humanoid bone ではなく OpenMMD の内部拡張ボーンとして扱う
  - spine または hips が解決できない異常系では、無理に挿入せず既存構造を維持する
  - 既存コードスタイルに合わせて JSDoc を付け、手動実装コメントは最小限に留める