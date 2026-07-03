# Headless Runtime Refactor For Load / Apply / Export

  ## Summary

  - source/ に、モデル読込・アニメーション読込・アニメーション割当/適用・vmd/vrma 書き出しを UI 非依存で呼べる
    headless runtime API を追加する。

  - ModelManager、TimelineManager、VMDManager はその API を使う薄い orchestrator に寄せる。
  - テストは個別の createFileLike、最小 instance 手組み、setAnimationClip + applyAnimationMappingToController の直
    列記述をやめ、同じ headless API を使う。

  - 方針は source追加 を採用する。テスト専用の別実装は増やさず、本番経路をそのまま再利用する。

  ## Key Changes

  - 新しい shared runtime モジュールを source/ に追加する。
      - 役割1: モデル読込結果を「正規化済み model」から「実行用 instance」へ組み立てる。
      - 役割2: animation source の読込結果を vmd / vrma / gltf で正規化し、instance へ割り当てる。
      - 役割3: export 入力を sourceOrClip と instance の両対応で正規化し、VMDWriter / VRMAWriter 呼び出し前の分岐
        を 1 箇所へ集約する。

  - モデルロード経路を 2 段に分離する。
      - 共有 factory は meshBuffers / pipelineResources を optional にし、headless 実行では GPU 依存を最小化する。

  - アニメーションロード経路を source 単位に統一する。
      - VMDManager.loadVmd / loadVrma / loadFromZip の戻り値を、内部 Map 格納用データではなく共通 animation source
        生成関数経由に揃える。

      - vmd は { kind: 'vmd', name, data, clip }、vrma は { kind: 'vrma', name, clip }、glTF は既存 source 形を維
        持しつつ同じ accessor で扱う。

  - アニメーション適用経路を 1 箇所に統一する。
      - timeline-manager.js の assignAnimationSourceToInstance を shared API の薄い wrapper に置き換える。
      - その shared API が animationSource 系フィールド更新、setVmd / setAnimationClip、
        applyAnimationMappingToController、VRMA 時の IK ON/OFF 同期まで一括で担当する。

      - テストはこの API を使って「割当済み instance」を得る。手動で animationController や mapping を触るのは、そ
        の API 自体の単体テストだけに限定する。

  - 保存経路を共通 export session に寄せる。
      - VMDManager.downloadVrma と UI 側の VMD 保存導線は、共通の export normalize 関数を通して writer を呼ぶ。
      - VRMAWriter.write / VMDWriter.write の前段で必要な source 解決、既定 filename、warning 収集を共通化する。
      - 既存 writer 本体のフォーマット責務は維持し、UI 都合の file download 処理だけ manager 側に残す。

  - テスト共通ユーティリティを整理する。
      - createFileLike、fetch/FileReader モック、最小 GPU device は tests/ の共有 helper に集約する。
      - ただしモデル/アニメーションの組立は helper ではなく shared runtime API を使う。
      - 既存の tests/vrma-loader.test.mjs のローカル変更は上書きせず、その内容を取り込む前提で差分を最小化する。

  ## Public Interfaces

  - 新規追加する shared API は内部利用前提だが source/ から export する。
  - 追加対象の公開関数は次の責務に固定する。
      - createModelRuntimeInstance(...): 正規化済み model から実行用 instance を作る。
      - loadAnimationSourceFromFile(...) / loadAnimationSourcesFromZip(...): VMD/VRMA 読込結果を共通 source 形式で
        返す。

      - assignAnimationSourceToRuntimeInstance(...): source を instance に割り当てて controller/mapping/IK を同期
        する。

      - exportRuntimeAnimationAsVmd(...) / exportRuntimeAnimationAsVrma(...): source/instance を正規化して writer
        を呼ぶ。

  - 既存 public API の挙動は維持する。
      - loadModelData* の戻り値は変更しない。
      - TimelineManager.assignAnimationSourceToInstance は残すが shared API へ委譲する。
      - VMDManager の外向けメソッド名は維持する。

  ## Test Plan

  - モデルロード
      - 同一ファイルを loadModelDataFromFile と shared runtime instance factory 経由で読み込み、骨数・VRM humanoid
        map・runtime bone state が一致すること。

      - ZIP/単体ファイルの両方で同じ runtime instance が組めること。

  - アニメーションロード
      - vmd / vrma / glTF animation source が共通 source 形式に正規化され、kind・name・clip が期待通りであること。

  - アニメーション適用
      - shared assign API で、既存の setVmd / setAnimationClip + applyAnimationMappingToController と同じ bone
        mapping・IK state・controller state になること。

      - VRMA 割当時に IK disable、解除時に restore されること。

  - 保存
      - shared export API 経由の vmd / vrma 出力が既存 writer 直呼びと同じ round-trip 結果を保つこと。
      - PMX/VMD -> VRMA、VRM/VRMA -> VRMA、VMD round-trip の既存回帰テストを shared API 使用へ置き換えて通すこと。

  - 回帰
      - ロード/適用/保存を横断する既存代表テストを shared API ベースへ移行する。
      - source/ を変更するので、実装時は node --test .\tests\*.test.mjs を全件実行する。

  ## Assumptions

  - 追加する shared runtime API は internal utility ではなく source/ の再利用可能 API として扱う。
  - GPU 実リソース生成が不要なテストでは headless instance を使い、描画パイプライン生成までは共有しない。
  - VMDWriter / VRMAWriter のバイナリ仕様責務は保持し、今回の中心は「前段の組立と分岐の共有化」に置く。
  - docs/plans/ は参照しない。
  - 既存の tests/vrma-loader.test.mjs の未コミット変更はユーザー作業として保持する。