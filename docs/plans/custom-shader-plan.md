# カスタムシェーダ実装計画

## Summary

- マテリアルタブに「シェーダ選択 select + 個別リロードボタン」を追加し、material-list で選択中のマテリアル群へ一
括適用する。
- 実行形態は静的配布維持を前提にし、source/shaders/custom-shaders/ の実ファイル列挙は行わず、同ディレクトリ配下
のマニフェストを一覧の正本として読む。
- 描画は「共通テンプレート WGSL + 差し込み用フラグメント本文」の方式に変更し、既存の vs_main / vs_shadow /
fs_pick_world / shadow debug は共通側に残す。
- glTF は gltf-shader.wgsl を既定にし、Three.js の glTF 2.0 標準に近い PBR を使えるよう、ローダー・material
uniform・texture bind group を拡張する。

## Key Changes

- シェーダ資産と列挙方式
    - source/shaders/custom-shaders/manifest.json を追加し、UI はこれを読んで一覧を生成する。
    - manifest には name, label, modelTypes, isDefaultFor, entryFile を持たせる。
    - 初期エントリは mmd-shader.wgsl と gltf-shader.wgsl。MMD 系は前者、model.magic === 'Gltf' は後者を既定値に
    する。
    - mmd-shader.wgsl と gltf-shader.wgsl は「fs_main の本文断片のみ」を置く契約に固定する。使える識別子は in,
    out, encodedNormal, material, uniforms, textureData, toonData, sphereData と共通 helper 群に限定する。
- WGSL 合成とシェーダ管理
    - source/shaders/shaders.wgsl から現在の 248-294 行付近の fs_main 本文を削除し、テンプレート placeholder に
    置き換える。
        - テンプレート + 断片 WGSL の文字列合成
        - GPUShaderModule キャッシュ
        - 個別シェーダ再読み込み
        - コンパイル失敗時の直前正常版へのフォールバック
    - キャッシュキーは shaderName 単位にし、refresh ボタンは選択中シェーダのみを再 fetch して当該キャッシュを無
    効化する。
    - fs_shadow, fs_pick_world, vs_shadow_debug, fs_shadow_debug は共通テンプレート側に残し、カスタム化対象は
    fs_main のみとする。
- ModelManager / pipeline 再構成
    - ModelManager の単一 shaderModule 前提をやめ、インスタンスごとに materialShaders[] を保持する。
    - createPipelineResources は「material リソース」と「shader ごとの pipeline set」を分離して返す。
    - pipeline キャッシュキーは shaderName + sampleCount。各マテリアル描画時に対応 pipeline を選ぶ。
    - refresh または shader 変更時は、影響する shader を使うマテリアルだけ pipeline を再作成する。material
    buffer や mesh buffer は再利用する。
    - depth pick / shadow pass は既存テンプレート共通実装を使い続けるため、shader 別分岐は fs_main 用の color
    pass に限定する。
- UI と状態管理
    - index.html のマテリアルタブに select と fonts/refresh_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg のボタン
    を追加する。
    - UI は選択中マテリアル群の shaderName 集約状態を表示し、混在時は空表示または専用プレースホルダにする。
    - select 変更時は選択中マテリアルへ同一 shaderName を書き込み、必要 pipeline だけ差し替える。
    - refresh ボタンは現在 select に表示中の shader を再読み込みし、その shader を使う全マテリアルを再コンパイル
    する。
    - 文言は source/langs/ja.json と source/langs/en.json に追加する。
- glTF 既定シェーダとデータ拡張
    - source/loader/gltf-loader.js を拡張し、少なくとも baseColorFactor, metalness, roughness, emissiveFactor,
    doubleSide, alphaMode, normalTexture, occlusionTexture, emissiveTexture, metallicRoughnessTexture を内部
    material に保持する。
    - source/material-resources.js と global/material bind group layout を拡張し、glTF 用の追加 uniform と追加
    texture view を渡せるようにする。
    - gltf-shader.wgsl は Three.js MeshStandardMaterial 相当の基本 PBR を OpenMMD の既存 I/O に合わせて移植す
    る。
    - 法線マップ TBN は tangent 未所持モデルでは fallback を持たせる。最低限は normal map 無効化、可能なら
    screen-space derivative で近似する。
    - MMD 用 mmd-shader.wgsl は現行 fs_main と等価な断片を移し、回帰を避ける。

## Tests

- tests/gltf-loader.test.mjs
    - glTF 読み込み時に model.magic === 'Gltf' かつ glTF 用 material 拡張情報が埋まること。
    - glTF モデル作成後の既定 shaderName が gltf-shader.wgsl になること。
- 新規 shader manager テスト
    - manifest 読み込み、テンプレート合成、個別 reload、コンパイル失敗時のフォールバック、unknown shader 指定時
    の既定復帰。
- pipeline リソース系テスト
    - 異なる shaderName を持つ複数マテリアルで pipeline cache が shader ごとに分かれること。
    - MSAA 変更時と shader reload 時で再生成対象が正しいこと。
- material UI テスト
    - 選択中マテリアル群への一括適用、混在表示、refresh ボタン押下時の再読み込み対象が 1 shader のみであること。
- 回帰確認
    - MMD モデルは mmd-shader.wgsl 既定で従来描画を維持すること。
    - shadow pass / world pick pass が custom shader 切替後も機能すること。

## Assumptions

- material-list の選択中マテリアル群へシェーダを適用する。
- 静的配布維持のため、一覧取得はディレクトリ走査ではなく manifest.json を正本とする。
- 今回は外部 API 追加を行わないため、docs/specification/api-specification.md と docs/specification/api-
specification-ja.md の更新は不要。
- カスタム化対象は color pass の fs_main 本文のみとし、shadow/pick/debug entry point は共通テンプレート管理に固
定する。
- glTF の「Three.js 標準的なデフォルトシェーダ移植」は full engine parity ではなく、MeshStandardMaterial の主要
PBR 要素を OpenMMD 現行データ構造へ落とした互換実装として進める。