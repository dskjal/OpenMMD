# Z-Prepass 導入計画

## Summary

- 目的は、transparent/half-transparent を PMX 列挙順で描画する現行方式でも、影が落ちない材質が出にくいように
main pass の前に Z-prepass を入れて可視面 depth を先に確定すること。
- 公開方式は 常時有効。今回は UI も API も追加しない。
- 対象材質は opaque / cutout / transparent(finalAlpha >= 0.5)。finalAlpha = textureAlpha * diffuseAlpha を基準に
する。
- shadow pass 自体は変更せず、main color pass の深度利用方式を変える計画にする。

## Key Changes

    - prepass は main pass と同じ深度テクスチャを使い、depthLoadOp: 'clear' で開始する。
    - 後続の main color pass は同じ depth を depthLoadOp: 'load' で再利用し、depthWriteEnabled: false を基本にす
    る。
    - depth を後段の DOF / contact shadow / grid overlay が読む現行構成は維持する。
- パイプライン
    - source/model-manager-pipelines.js に depthPrepassPipeline 群を追加する。
    - 追加対象は shader ごとの pipeline set。少なくとも以下を持たせる。
        - regular cull
        - no-cull
        - transparent/no-cull 用の prepass 版
    - prepass 用 pipeline は fragment を depth 判定専用 entry point に差し替え、color target は持たせない。
    - main color pass 側の既存 pipeline は基本維持しつつ、Z-prepass 後に使うパイプラインだけ depthWriteEnabled:
    false に分ける。
    - edge 描画は prepass 対象外のままにする。
- シェーダ
    - source/shaders/shaders.wgsl に depth-only 用 fragment entry point を追加する。
    - この entry point で finalAlpha = textureAlpha * diffuseAlpha を計算し、以下の規則で discard を行う。
        - cutout: 現行 ALPHA_CUTOUT_THRESHOLD を使う
        - transparent: finalAlpha < 0.5 を discard
        - opaque: 通す
    - custom shader 互換のため、depth-only 判定ロジックは CUSTOM_SHADER_BODY ではなく共通テンプレート側に置く。
    - vs_main は再利用し、追加の vertex entry point は作らない。
- ModelManager の描画分離
    - source/model-manager.js に drawDepthPrepass() / drawDepthPrepassInstance() を追加する。
    - 現在の材質分類を opaqueMaterials / transparentMaterials だけでなく、prepass 対象判定にも再利用する。
    - prepass の transparent 判定は PMX 順を維持したまま描画するが、目的は color 合成ではなく depth 確定なので、
    実際の color pass より前に走らせる。
    - main color pass の材質列挙順は現状維持にする。transparent の PMX 順描画ポリシーは変えない。
- 深度リソースと互換
    - source/renderer-resources.js の main depth texture 管理は流用し、prepass 用に別 depth texture は増やさな
    い。
    - depth pick 用の 1px pass と専用 depth texture は現状維持にする。
    - shadow pass、pick pass、ui overlay、grid overlay の深度資産は分離を維持する。
- 既存挙動との境界
    - shadow pass の drawShadow / drawShadowInstance は今回変更しない。
    - 今回の計画は「transparent を PMX 順で描く都合で main pass 上の shadow 受けが欠ける」問題に対する主レンダリ
    ング側の対策であり、material.drawShadow === false の仕様変更は含めない。
    - API 追加はしないため、docs/specification/api-specification.md と docs/specification/api-specification-
    ja.md は更新対象外。

## Test Plan

- 透明材質の影受け
    - PMX 順に描かれる transparent 材質が複数重なるモデルで、従来は影が落ちなかった材質に shadow が入ること。
    - finalAlpha >= 0.5 の透明面は prepass 参加で影受けが改善し、finalAlpha < 0.5 の薄い面は背後を優先できるこ
    と。
    - cutout テクスチャの穴は prepass でも抜けること。
- 回帰
    - opaque / cutout モデルで見た目が変わらないこと。
    - material.noCull 材質で前後面の depth 判定が破綻しないこと。
    - shadow pass、depth pick、DOF、contact shadow、grid overlay に回帰がないこと。
    - custom shader 適用材質でも prepass 用 shader module が正常に組み上がること。
- 条件差分
    - msaaSampleCount = 1 と 4 の両方で動くこと。
    - material morph で diffuse.a が 0.5 を跨ぐと、prepass 参加判定も同フレームで追従すること。
    - receiveShadow=false 材質は従来どおり影を受けないこと。

## Assumptions

- 問題の本体は shadow map 生成不足ではなく、main pass の透明描画順と深度確定タイミングにある。
- transparent の prepass 参加基準は finalAlpha >= 0.5 を初期値とし、今回は UI 調整値を持たせない。
- Z-prepass は常時有効でよく、比較用トグルや debug 可視化は今回の計画に含めない。
- 目的は shadow 受け改善であり、透明合成品質そのものや OIT 導入は別課題として扱う。