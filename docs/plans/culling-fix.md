## PMD/PMX Culling Regression Fix

### Summary

- 最終方針は PMD/PMX ローダーで winding 補正 を正とし、描画パイプラインは back culling に統一する。
- 原因は、左手系から右手系への変換で面の向きが反転するのに対し、可視化側を front culling で帳尻合わせしていたた
め、MMD シェーダでは可視面が実質「裏面法線」のままライティングされていたこと。
- 症状の「全体的に影になる」「ハイライトがポリゴン形状になる」は、mmd-shader.wgsl / mmd-shader-hdr.wgsl が
in.normal / in.viewNormal をそのまま使い、面の表裏補正をしていないことと整合する。

### Implementation Changes

- source/loader/pmd-loader.js
    - readIndices() 後に reverseTriangleWinding(indices) を適用する。
    - 既存の Z-flip と組み合わせて、仕様どおり LH -> RH の winding 補正を完結させる。
- source/loader/pmx-loader.js
    - サーフェス読み込み後に reverseTriangleWinding(indices) を適用する。
    - PMD と同じ変換規約に揃える。
- source/model-manager-pipelines.js
    - PMD/PMX 系の通常描画・透明描画・depth prepass の cullMode を back に統一する。
    - noCull マテリアルの分岐は維持する。
    - glTF 系と同じ表裏ルールにそろえ、シェーダ側で特例補正を持たせない。
- source/shaders/custom-shaders/mmd-shader.wgsl
    - 法線反転ロジックは追加しない。
    - normal / viewNormal は従来どおり使う前提に戻す。
- source/shaders/custom-shaders/mmd-shader-hdr.wgsl
    - 上と同様に、front_facing 依存の補正は入れない。
    - もし暫定で追加済みなら除去し、MMD 用ライティングは winding 修正済みジオメトリ前提へ戻す。
- tests/gltf-loader.test.mjs
    - 既存追加済みの cullMode === 'back' 検証は維持する。
- 追加テスト
    - PMD/PMX のローダーテストに、indices が 3 頂点単位で反転されることを追加する。
    - 可能ならパイプライン構築テストで MMD 系シェーダの pipeline/transparentPipeline/depthPrepassPipeline が
    back を使うことを追加する。

### Test Plan

- PMD ローダー
    - 単純な 1 triangle データで indices が [0,1,2] -> [0,2,1] に反転されること。
- PMX ローダー
    - 同様にサーフェス index が 3 頂点単位で反転されること。
- パイプライン
    - MMD 系パイプラインの通常描画、透明描画、depth prepass が back culling で生成されること。
- 実機確認
    - PMD/PMX モデルで正面表示時に全面が暗くならないこと。
    - ハイライトが滑らかに出て、ポリゴン境界に沿った不自然な反射にならないこと。
    - noCull 材質、エッジ描画、alpha cutout が回帰しないこと。

### Important Interfaces

- 公開 API 追加はなし。
- データ変換規約として、PMD/PMX ローダーの「Z-flip + winding 補正」を実装上も明確に確定させる。

### Assumptions

- このリポジトリの正しい座標変換仕様は AGENTS.md 記載どおりで、PMD/PMX ローダーは index 順入れ替えを行う。
- front culling を維持して法線をシェーダで反転する案は採らない。
- mmd-shader.wgsl と mmd-shader-hdr.wgsl の症状は根本原因ではなく、winding と culling の不整合が主因。