# Animation Mapping Tab 追加計画

  ## Summary

  - Texture と Pose Copy の間に Animation Mapping タブを追加する。
  - タブのロジックは新規 /D:/data/program/openmmd/source/animation-mapper.js に集約し、index.html から初期化する。
  - マッピングは「アクティブモデル × アクティブ animation source」単位で保持する。
  - 対象 source は現行の vmd と、将来の vrma を見据えた汎用 animation clip ベースで扱う。glTF 専用にはしない。
  - 未割当の行は空欄のまま保持し、選択された行だけ再生時に適用する。
  - 回転オフセットは XYZ 入力からクォータニオン化し、再生時に targetRotation = offset * sampledRotation の前掛けで
    適用する。位置オフセットは加算、スケールオフセットは乗算。

  ## Key Changes

  - index.html
      - タブボタンを Texture と Pose Copy の間へ追加する。
      - tab-animation-mapping の本体を追加する。
      - 表示は 3 列固定。
          1. 左列: animation source 側のボーン名
          2. 中列: マッピング先ボーンの select
          3. 右列: rotation XYZ, position XYZ, scale XYZ の入力群

      - 初期文言と空状態を追加する。
      - browser bootstrap で setupAnimationMappingTab() を初期化する。

  - /D:/data/program/openmmd/source/animation-mapper.js
      - タブ DOM 取得、行構築、アクティブモデル/アクティブ source 変更時の再描画、入力イベント束縛を担当する。
      - source 側ボーン一覧は、アクティブ animationSource.clip.channels から target.kind === 'bone' の target.name
        を一意抽出して並べる。

      - ターゲット候補はアクティブモデルの model.bones から生成する。
      - 行データは以下の形で保持する。
          - targetBoneName: string
          - rotationOffsetEuler: [x, y, z]
          - translationOffset: [x, y, z]
          - scaleOffset: [x, y, z]

      - 初期値は rotation=[0,0,0], translation=[0,0,0], scale=[1,1,1]。
      - 右列入力は数値入力を 3 グループ横並びで持たせる。回転は XYZ 順の度数表示で統一する。
      - 内部ヘルパーとして
          - source の bone 名抽出
          - instance/source ごとのマッピング状態の取得・初期化
          - Euler XYZ -> quaternion 変換
          - UI 再描画
            を持たせる。

      - window 直参照を最小限にし、初期化時に modelManager, selection, timelineManager, getActiveInstance 相当を受
        け取る。

  - source/model-manager.js
      - instance 生成時に animation mapping 用 state を追加する。
      - 推奨形:
          - animationMappingBySourceKey: Map<string, AnimationMappingState>

      - source key は kind:name を基本にし、名前未設定時のみ index/fallback を使う。将来 vrma を足しても同じ枠組み
        で扱えるようにする。

      - 既定 source がある場合でも、マッピングは遅延初期化にして不要データを増やしすぎない。

  - source/animation.js
      - AnimationController に source ごとの解決済みマッピング設定を受け取る経路を追加する。
      - setAnimationClip() 時または別 setter で、source bone 名 -> target bone 名/offset の解決済み辞書を保持す
        る。

      - updateBones() の適用ループを「モデル骨ループ」から「マッピング/チャネル基準ループ」へ切り替える。
          - 未割当はスキップ
          - physicsMode === 1 は既存どおりスキップ
          - translation = sampledTranslation + translationOffset
          - rotation = offsetQuaternion * sampledRotation
          - scale = sampledScale * scaleOffset を成分ごとに適用


      - そのため animation-mapper.js 側で、既に他行に選ばれているターゲット骨は選択不可にするか、選択時に既存側を
        未割当に戻す。計画上は「重複選択時は古い行を未割当に戻す」で固定する。

  - source/timeline-manager.js
      - assignAnimationSourceToActiveInstance() 後に、アクティブ instance の animation mapping を
        AnimationController へ再反映するフックを追加する。

      - source 切替時にタブ再描画が必要なので、UI 側から呼べる同期ポイントを 1 つ用意する。
      - 再生 source 更新後の _refreshActiveAnimationSource() でも、clip 再設定と合わせて mapping 再反映を行う。

  - source/renderer.js または source/renderer-ui.js
      - 既存の「アクティブ instance 切替」「VMD/source 切替」「モデルロード/削除」時に animation mapping タブの再
        同期を呼ぶ。

      - 追加する責務は最小限にして、実際の DOM 更新は animation-mapper.js 側へ寄せる。

  ## Interfaces / Types

  - 新規内部型
      - AnimationMappingEntry
          - sourceBoneName: string
          - targetBoneName: string
          - rotationOffsetEuler: [number, number, number]
          - translationOffset: [number, number, number]
          - scaleOffset: [number, number, number]

      - AnimationMappingState
          - entries: Map<string, AnimationMappingEntry>

      - ResolvedAnimationMapping
          - targetBoneIndex: number
          - rotationOffsetQuaternion: [number, number, number, number]
          - translationOffset: [number, number, number]
          - scaleOffset: [number, number, number]

  - AnimationController に追加する内部 API
      - setBoneMapping(mappingStateOrResolvedMap)
      - clearBoneMapping()

  - instance に追加する内部 state
      - animationMappingBySourceKey

  ## Test Plan

  - markup/初期化
      - index.html に Animation Mapping タブが Texture と Pose Copy の間に存在する。
      - 初期化スクリプトが setupAnimationMappingTab() を呼ぶ。

  - UI state
      - source 未選択または bone channel なしなら空状態表示になる。
      - アクティブモデル切替でターゲット骨候補が更新される。
      - アクティブ source 切替で左列ボーン一覧と保存済み設定が切り替わる。
      - 未割当が初期状態で保持される。
      - 同一ターゲット骨の重複選択が発生した場合、既存行が未割当に戻る。

  - animation application
      - マッピングなしでは未割当 bone は適用されない。
      - rotationOffset=[90,0,0] が前掛けで適用される。
      - translationOffset=[1,2,3] が sampled translation に加算される。
      - scaleOffset=[2,1,0.5] が sampled scale に成分乗算される。
      - physicsMode === 1/2 の既存挙動を壊さない。

  - source lifecycle
      - assignAnimationSourceToActiveInstance() 後に mapping が controller へ反映される。
      - _refreshActiveAnimationSource() 後も mapping が維持される。

  - 回帰
      - 既存 VMD 再生で、マッピング未設定時は従来の bone-name 一致挙動を維持する。
      - glTF source が存在するモデルでも既存 timeline 編集が壊れない。

  ## Assumptions

  - source 側は animation clip の bone channel 名をそのまま左列へ表示する。
  - 今回は UI 保存/読込 JSON や外部 API には含めない。内部 runtime state のみ。
  - 回転入力は度数法、適用順は workspace 仕様どおり XYZ。
  - スケールオフセットは 1 軸ごとの乗算補正で、初期値は [1,1,1]。
  - source が vmd でも vrma でも、実装は clip.channels を読む共通経路に寄せる。

# PMX-VRMA Retarget via T-Pose Normalization

  ## Summary

  source/animation-mapper.js の方針を「VRMA humanoid 名を PMX 標準名へ直接 seed するだけ」から変更し、PMX を T
  ポーズ相当の正規化空間へ変換してから VRMA を適用する 方式にする。

  狙いは、PMX ごとに異なる localX/localY/localZ と 1 軸回転の差を、ボーン名対応だけで吸収しようとせず、source rest
  rotation -> normalized rotation -> target rest rotation の形で処理すること。VRMA -> VRM で使っている rest
  rotation ベースの考え方を PMX 側にも拡張するが、PMX には humanoid 定義が無いので、PMX 標準ボーン名を humanoid 相
  当の semantic 名へ解決する層を追加する。

  ## Implementation Changes

  - source/animation-mapper.js に PMX 用の humanoid 相当対応表を追加する。
  - 役割は VRMA humanoid 名 <-> PMX 標準ボーン名 の相互解決。
  - 初期対応は標準 MMD 名のみ。
      - hips -> センター
      - spine -> 上半身
      - upperChest/chest -> 上半身２ / 上半身 の優先フォールバック
      - neck -> 首, head -> 頭
      - left/rightShoulder -> 左右肩
      - left/rightUpperArm -> 左右腕
      - left/rightLowerArm -> 左右ひじ
      - left/rightHand -> 左右手首
      - left/rightUpperLeg -> 左右足
      - left/rightLowerLeg -> 左右ひざ
      - left/rightFoot -> 左右足首
      - left/rightToes -> 左右つま先
      - 指は 親指/人差指/中指/薬指/小指 の 1-3 へ対応

  - ensureAnimationMappingState() は PMX + VRMA で、target 名に PMX 実ボーン名ではなく PMX semantic 名対応の既定値
    を seed する。

  - createResolvedAnimationBoneMappings() に VRMA -> PMX 専用分岐を追加する。generic mapping には落とさない。
  - PMX 用の T ポーズ正規化データを resolved mapping 作成時に前計算する。
  - 各対象ボーンについて以下を構築する。
      - PMX 実ボーンの local rest rotation
      - 親チェーン込み world rest rotation
  - canonical basis は humanoid semantic ごとに定義する。
      - 体幹・頭・肩・上腕・手・上脚は VRMA humanoid の T ポーズ向きに揃える
      - ひじ・親指は Y 主軸
      - 指は Z 主軸
      - ひざ・足首・つま先は X 主軸

  - canonical basis の生成は既存 buildXAxisBasis/buildYAxisBasis/buildZAxisBasis 相当のロジックを流用する前提で、
    animation-mapper.js 側に必要最小限の helper を持つか、共有 helper 化する。

  - PMX 実ボーン基底そのものを source/target 変換の基準にはしない。PMX 実基底は T ポーズ正規化空間へ入るための
    rest rotation を求める入力として使う。

  - VRMA -> PMX の回転適用は VRM 仕様の rest rotation 変換式に揃える。
  - 手順は以下に固定する。
      1. VRMA source の sourceLocalRestRotation/sourceWorldRestRotation を読む
      2. source rotation を NormalizedLocalRotation へ変換する
      3. PMX target の targetLocalRestRotation/targetWorldRestRotation へ戻す
      4. 必要な semantic basis 補正を掛ける

  - 非必須ボーン差分は VRM Animation の説明に合わせて扱う。
      - source にあって target に無い非必須ボーンは、既定では最も近い下流必須ボーンへ畳み込まない
      - 今回は「存在するボーンだけを適用する」に留める
      - upperChest は 上半身2 が無い場合のみ 上半身 へフォールバックする

  - hips は既定で センター にマップする。
  - hips translation は source hips 高さ / target hips 高さ ではなく、仕様どおり target/source の T ポーズ hips 高
    さ比 でスケールする。

  - PMX 側の hips 高さ は センター の Y ではなく、脚長に相当する値として センター から脚チェーンを使って求める。実
    装は次で固定する。
      - まず 左足 -> 左ひざ -> 左足首 が揃えばその chain 長を採用
      - 無ければ右脚 chain
      - 両方無ければ センター.position[1] を fallback とする

  - hips rotation は同じ target センター に適用する。現行 mapping 構造のまま進め、センター/下半身 分離は今回行わな
    い。

  - source/animation.js に VRMA -> PMX 適用分岐を追加する。
  - VRMA -> VRM 既存分岐は維持し、PMX 用に別フィールドを追加する。
      - pmxVrmaUseWorldRestRetarget
      - pmxVrmaSourceLocalRestRotation
      - pmxVrmaSourceWorldRestRotation
      - pmxVrmaTargetLocalRestRotation
      - pmxVrmaTargetWorldRestRotation
      - pmxVrmaBasisCorrectionQuaternion
      - pmxVrmaBasisCorrectionInverseQuaternion
      - pmxVrmaTranslationScale

  - 適用式は VRM 用の applyVrmaMappedRotation() を共通化するか、PMX 用の wrapper を追加して分岐を明示する。

  ## Tests

  - tests/animation-mapper.test.mjs
      - PMX + VRMA で既定 mapping が seed される
      - resolved mapping が generic ではなく PMX-VRMA 用 rest rotation 情報を持つ
      - ひじ・指・ひざ・足首・つま先が優先軸ベースの canonical basis を使う
      - upperChest が 上半身２ 不在時に 上半身 へフォールバックする

  - tests/animation-loop-physics.test.mjs
      - PMX-VRMA mapping が rest rotation 変換経由で rotation を適用する
      - hips translation が脚長比でスケールされる

  - 新規回帰テストを追加する
      - PMX モデルで左右腕または脚の local basis が異なっていても、同じ VRMA ポーズで見た目方向が揃う
      - 1 軸回転ボーンで X/Y/Z 主軸差があっても、T ポーズ正規化後に期待軸へ回る
      - 上半身２ なし PMX に upperChest を含む VRMA を適用しても破綻しない

  - 既存の VRMA -> VRM 回帰は維持する
  - source/animation-mapper.js または source/animation.js を変更するため、最終的に node --test .\\tests\
    \*.test.mjs を実行して失敗を報告する前提にする

  ## Assumptions

  - 今回の PMX 対応は標準 MMD 日本語ボーン名ベースで行い、英語名やモデル固有名の推定までは含めない
  - PMX の semantic 解決に失敗したボーンは未マップのまま残す
  - hips の rotation/translation を別 target へ分離する multi-target mapping は今回やらない
  - 非必須ボーンの回転合成は最小限に留め、まずは「存在する target へ正規化済み rotation を適用する」ことを完成条件
    にする

# PMX VRMA T-Pose Basis Normalization

  ## Summary

  VRMA -> PMX の適用時だけ、PMX 側に一時的な VRM rest pose 相当の正規化を入れます。
  目的は、VRMA の humanoid rest pose に対して、PMX の対象ボーンも「ローカル基底 = ワールド基底 = identity」とみな
  せる空間へ変換してから回転を適用することです。

  探索結果では、現状の VRMA -> PMX は source/animation-mapper.js で PMX ボーンの実 localX/Y/Z +
  baseRotationQuaternion をそのまま targetLocalRestRotation / targetWorldRestRotation に入れており、
  AliciaSolid.vrm と違って identity になっていません。
  そのため、AliciaSolid.vrm と Alicia_solid.pmx で同じ VRMA を適用しても、回転適用の前提行列が一致していません。

  ## Key Changes

  - source/animation-mapper.js
      - VRMA -> PMX 専用に、「PMX humanoid を VRMA 用 T-pose 正規化空間へ写す」ヘルパーを追加する。
      - この正規化は createResolvedVrmaPmxBoneMapping() からだけ使う。
      - 正規化後の resolved mapping は次を満たすようにする。
          - targetLocalRestRotation = identity
          - targetWorldRestRotation = identity
          - sourceLocalRestRotation / sourceWorldRestRotation は VRMA metadata のまま使う
          - translationScale と hips の translationCorrectionQuaternion は現行仕様を維持する

      - 実装は「PMX の実 rest rotation を消す補正 quaternion」を導入し、VRMA retarget に渡す target rest を正規化
        済み値へ差し替える形にする。

      - 既存の VRMA -> VRM 経路、VMD 経路、通常 PMX animation 経路は変更しない。

  - source/animation.js
      - applyVrmaMappedRotation() の式は基本維持する。
      - 追加補正が必要なら resolved mapping に PMX 用の前処理/後処理 quaternion を持たせ、VRMA 回転適用の前後で明
        示的に掛ける。

      - ただし最終的な意味は「PMX target を identity rest pose に正規化してから VRMA rotation を適用する」に固定す
        る。

  - 分析基盤
      - AliciaSolid.vrm と Alicia_solid.pmx に同一 VRMA_07.vrma を適用したときの resolved mapping 比較テストを追加
        する。

      - 主要ボーン hips/spine/chest/upperChest/leftUpperArm/rightUpperArm/leftUpperLeg/rightUpperLeg/feet で、
          - VRM 側は従来どおり targetLocalRestRotation/targetWorldRestRotation = identity
          - PMX 側も新仕様では同等の正規化結果になる
          - そのうえで適用後 local rotation の差が許容範囲内に収まる
            を確認する。

  ## Public Interfaces / Data

  - 外部 API の追加はしない。
  - resolved mapping の内部フィールドは必要なら追加する。
      - 候補: vrmaPmxPreNormalizeQuaternion, vrmaPmxPostNormalizeQuaternion

  - 追加する場合は内部専用フィールドとして扱い、公開仕様ドキュメントの更新は不要。
  - 既存フィールド名を流用して実現できるなら新規フィールドは増やさない。

  ## Test Plan

  - tests/animation-mapper.test.mjs
      - VRMA -> PMX resolved mapping で humanoid 対象ボーンの targetLocalRestRotation / targetWorldRestRotation が
        identity になることを確認する。

      - hips の translationScale が現行どおり維持されることを確認する。

  - tests/alicia-vrma-07-regression.test.mjs
      - AliciaSolid.vrm と Alicia_solid.pmx に同じ VRMA_07.vrma を適用した比較テストを追加する。
      - 両者の resolved mapping 差分を固定し、PMX 側で rest basis 差が消えていることを確認する。
      - frame 0 の主要ボーン回転を比較し、少なくとも体幹・腕・脚で基底差由来の不一致が解消したことを確認する。

  - 変更が source/ 配下なので、実装後は node --test .\tests\*.test.mjs を全件実行する。

  ## Assumptions

  - 新仕様は「VRMA -> PMX のときだけ PMX を VRM 的な identity rest pose 空間へ正規化する」で確定とする。
  - 正規化対象は VRMA humanoid mapping のみで、PMX の非 humanoid ボーンや IK 補助ボーンには適用しない。
  - hips translation のスケール補正と parent 補正は現行仕様を維持する。
  - Alicia_solid.pmx での正規化は一時的な retarget 空間の話であり、モデル本体の rest pose データは破壊的に変更しな
    い。
