# VRMA Expression Support And VRM Morph UI Split

  ## Summary

  - VRM/VRMA の expression を load -> apply -> key register -> .vrma save まで一貫して動くようにする。
  - 既存の MMD morph UI と VRM expression UI を分離し、VRM モデルでは 目 / リップ / まゆ / その他 の既存 4 アコー
    ディオンを非表示にして使わない。

  - VRM では新しい expression アコーディオンを使う。
      - preset: 感情, リップシンク, 瞬き, 視線, その他
      - custom: custom

  ## Implementation Changes

  - source/loader/gltf-loader.js と source/loader/vrm-loader.js
      - VRM の VRMC_vrm.expressions を読み、model.vrm.expressions の形で保持する。
      - expression ごとに expressionName, expressionType, isBinary, overrideBlink, overrideMouth, overrideLookAt,
        各 bind 一覧を保持する。

      - glTF morph target 名は meshes[*].extras.targetNames ベースで解決し、VRM expression を内部 model.morphs に
        展開する。

      - internal morph は VRM 専用メタデータを持たせる。少なくとも vrmExpressionName, vrmExpressionType,
        vrmUiGroup, vrmExpressionDefinition を持つ。

  - source/morphing.js
      - VRM expression 評価を追加する。入力 weight は [0,1] clamp。
      - isBinary を適用し、その後に override 解決を入れる。
      - morphTargetBinds は既存 vertex morph 経路へ流す。
      - materialColorBinds は既存 material state 更新へ流す。
      - textureTransformBinds は material state に UV transform 系 state を追加し、レンダリング側へ渡す。
      - override の評価順は VRM spec に合わせ、blink / mouth / lookAt 系を suppression 対象として扱う。

  - source/model-manager.js と shader/material 反映経路
      - VRM expression 由来の texture transform を GPU 側へ送るための material state / buffer 反映を追加する。
      - 既存 PMX/PMD morph の挙動は変えない。

  - source/animation.js
      - VRMA morph channel の適用先を model.morphs の VRM expression morph に正しく接続する。
      - ルックアップは target.name だけでなく vrmaExpressionName 優先にする。

  - source/timeline-manager.js
      - VRM で morph key 登録時は model.morphs 名ではなく expression メタデータを優先して VRMA morph channel を生
        成する。

      - lookUp / lookDown / lookLeft / lookRight は VRMA 仕様上アニメーション不可なので、キー登録を拒否して警告す
        る。

      - custom expression は custom 扱いで保存する。

      - clip.metadata.vrmAnimation.expressions は維持しつつ、再生時は model 側 expression 定義へマッピングする。

  - source/loader/vrma-writer.js
      - morph channel を VRMC_vrm_animation.expressions と expression node に書き出す現行経路を、VRM expression
        metadata 前提で固定する。

      - look* preset は warning を出して出力しない現行方針を維持する。

  - index.html と source/renderer-ui.js
      - MMD 用 4 アコーディオンと VRM 用 expression アコーディオンを分ける。
      - VRM アクティブ時は既存 目 / リップ / まゆ / その他 を非表示。
      - VRM 用アコーディオン:
          - preset 感情: happy angry sad relaxed surprised neutral
          - preset リップシンク: aa ih ou ee oh
          - preset 瞬き: blink blinkLeft blinkRight
          - preset 視線: lookUp lookDown lookLeft lookRight
          - preset その他: 上記以外の preset
          - custom custom: 全 custom expression

      - key アイコンは 視線 preset では非表示または disabled にして、押下時も登録しない。
      - createMorphUI は model.magic === 'Vrm' で VRM 用描画ロジックに切り替える。

  - source/timeline-data.js
      - VRMA morph track を model の VRM expression 表示順で並べる。
      - クリップ由来のみの expression も track 化するが、表示ラベルは expression 名を使う。

  ## Public Interfaces / Data Shape

  - model.vrm.expressions
      - preset: Record<string, ExpressionDefinition>
      - custom: Record<string, ExpressionDefinition>

  - ExpressionDefinition
      - expressionName, expressionType, isBinary
      - overrideBlink, overrideMouth, overrideLookAt
      - morphTargetBinds, materialColorBinds, textureTransformBinds

  - model.morphs[] の VRM 専用追加 metadata
      - vrmExpressionName
      - vrmExpressionType
      - vrmUiGroup
      - vrmExpressionDefinition

  ## Test Plan

  - tests/vrma-loader.test.mjs
      - expression を含む .vrma を load すると morph channel が作られ、VRM model 側 expression に解決される。
      - morph channel を export -> reparse で round-trip できる。
      - look* expression は export warning になり channel 出力されない。

  - tests/timeline-manager.test.mjs
      - VRM model で expression key を打つと vrma source が生成される。
      - preset/custom の vrmaExpressionType が正しく付く。
      - look* はキー登録拒否になる。

  - tests/timeline-data.test.mjs
      - VRM expression track が preset/custom の表示順で出る。

  - 新規 VRM expression apply テスト
      - isBinary の 0.5 閾値。
      - overrideBlink / overrideMouth / overrideLookAt の block/blend。
      - materialColorBinds の反映。
      - textureTransformBinds の反映。

  - UI マークアップ/表示テスト
      - VRM 時に既存 4 アコーディオンが hidden。
      - VRM 用アコーディオンが表示される。
      - custom は custom のみ。

  - source/ を変更するので最終確認で node --test .\\tests\\*.test.mjs を全件実行する。

  ## Assumptions

  - VRM expression UI は MMD morph UI とは別系統にし、既存 4 アコーディオンは VRM では完全に使わない。
  - custom expression に追加カテゴリは作らず、すべて custom に入れる。
  - lookUp / lookDown / lookLeft / lookRight は UI 表示はするが、VRMA key/export 対象にはしない。
  - この対応では VRM expression の定義元は VRMC_vrm.expressions とし、VRMA 側はその expression 名への animation と
    して扱う。

# VRM Timeline Expressions Category

  ## Summary

  - VRM の displayFrames に Expressions を追加し、VRM expression morph を Other ではなく Expressions 配下に表示す
    る。

  - Expressions は常設カテゴリにする。VRM を開いた時点で、モデルが持つ全 expression track をこのカテゴリに並べる。
  - カテゴリ表示名は Expressions を使う。

  ## Key Changes

  - source/loader/vrm-loader.js
      - VRM 用 displayFrames 合成に expression 用グループを追加する。
      - model.morphs から VRM expression morph (type === 100 または vrmExpressionName を持つ morph) を収集し、
        frames に { type: 1, index } で入れる。

      - 既存のボーン系グループ順は維持し、その後に Expressions を追加し、最後にボーン残余の その他/rest を置く。
      - Expressions に入れた morph は Other へ重複して落ちない前提を維持する。

  - source/timeline-data.js
      - 既存の displayFrames[].frames 処理をそのまま使う方針にする。新しいカテゴリ型は増やさない。
      - Expressions display frame に含まれる morph track が、通常の display frame と同様に group track と child
        track を持つことを前提にする。

      - Other へ送る未所属 morph の扱いは維持し、VRM expression morph だけが Expressions に優先配置されるようにす
        る。

  - テスト
      - tests/gltf-loader.test.mjs
          - VRM の displayFrames に Expressions が追加されることを確認する。
          - Expressions の frames が type: 1 の morph entries を持ち、少なくとも AliciaSolid の既知 expression が
            含まれることを確認する。

      - tests/timeline-data.test.mjs
          - VRM 相当モデルで displayFrames に Expressions を持つケースを追加し、expression morph track が display-
            frame:*:Expressions 配下に出ることを確認する。

          - Other に expression morph が重複して出ないことを確認する。

      - 既存の VRMA/timeline 系テストは、VRM expression key が Expressions group track の keyframes に集約されるこ
        とを必要なら追記する。

  ## Acceptance Criteria

  - VRM モデルで expression にキーを打つと、その key はタイムライン上で Expressions カテゴリに表示される。
  - 同じ expression key が Other に重複表示されない。
  - ボーンの 胴 / 頭 / 脚 / 腕 / 指 / その他 の並びと挙動は壊さない。
  - PMX/PMD や displayFrames を持たない一般 glTF の挙動は変えない。

  ## Assumptions

  - Expressions は VRM 専用カテゴリで、PMX/PMD や一般 glTF には追加しない。
  - Expressions には全 VRM expression morph を常設表示する。キーが無い expression もトラックとして表示される。
  - カテゴリ名は Expressions 固定とし、nameEn も同名でよい。