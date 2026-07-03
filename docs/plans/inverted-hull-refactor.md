# Inverted Hull 輪郭線の透過描画修正

## Summary

現行の透明描画方式は維持し、PMX 順 alpha 合成の中で inverted hull を正しく扱う。主因は shader の alpha 式ではな
く、edge が独立した前倒しパスで描かれ、しかも depth 書き込み付きで scene color に直接混ざっている点にある。修正
は ModelManager の描画順、edge 用 pipeline の depth/blend 設定、必要最小限の shader/ドキュメント更新を中心に行
## Implementation Changes

- 描画順を opaque edge -> opaque surface -> transparent surface から、opaque surface -> opaque edge ->
transparent materialごとに surface then edge に変える。
    - transparent 材質は PMX 順を維持し、各材質の本体描画直後に同じ材質の edge を描く。
    - transparent 材質の edge を opaque グループから除外せず、transparent 側でも描画対象に含める。
- edge 用 pipeline を surface 用 pipeline から分離する。
    - edge pass は depthCompare: less-equal を維持しつつ depthWriteEnabled: false にする。
    - opaque/transparent の両方で同じ edge pipeline を使ってよいが、少なくとも surface pipeline と設定を共有しな
    い形にする。
    - 目的は、edge が後続の transparent 材質を depth で塞がないことと、surface が作った depth を使って
    silhouette のみを残すこと。
- ModelManager.drawInstance の材質分類を見直す。
    - opaque/transparent の分類は現行ロジックを維持する。
    - ただし edge 描画対象は opaque だけに限定せず、transparent 材質も個別描画経路に乗せる。
    - opaque 側は shader ごとの group 描画のままでよいが、edge は surface 後に回す。
- shader 側は大きく変えない。
    - inverted hull の頂点押し出しは現行の共通 vs_main を維持する。
    - fragment 側の outline alpha は sample_outline_alpha(uv) を使う前提を維持し、今回の主修正点を render
    order / depth に置く。
    - もし edge 用 fragment が surface 用 MRT 出力に不要な値を書いているなら、normal/mask への影響がないことだけ
    確認する。
- ドキュメントを現実の描画順に合わせて更新する。
    - docs/openmmd-specification.md の輪郭線説明を、前倒し描画ではなく「surface 後の silhouette overlay」として
    書き直す。
    - docs/custom-shader.md には、custom shader の edge 分岐は alpha だけでなく render order 依存で見え方が決ま
    ることを補足する。

## Important Internal Interfaces

- source/model-manager-pipelines.js
    - edge 専用 pipeline 定義を surface pipeline から独立させる。
    - 必要なら createPipelineSet の戻り値に transparentEdgePipeline を追加せず、edgePipeline を depthWrite 無効
    の共通 outline pipeline として再定義する。
- source/model-manager.js
    - drawInstance の opaque/transparent 描画ループを再構成する。
    - transparent 材質 1 件ごとに drawMaterial(surface) の直後 drawMaterial(edge) を呼べるようにする。
- source/shaders/shaders.wgsl / source/shaders/custom-shaders/*.wgsl
    - shader API は増やさない。
    - 現行の sample_outline_alpha(uv) 契約を維持する。

## Test Plan

- ModelManager.drawInstance の単体テストを追加する。
    - opaque 材質では surface 描画後に edge が呼ばれること。
    - transparent 材質では PMX 順を保ったまま surface -> edge で呼ばれること。
    - edge なし transparent 材質は surface のみ描かれること。
- pipeline 作成テストを追加する。
    - edge pipeline の depthWriteEnabled が false であること。
    - surface pipeline の depth 設定が従来通りであること。
- 手動確認シナリオ
    - 半透明 PMX で edge opacity を下げたとき、輪郭線が背景クリア色に置き換わるのではなく、材質順に重なった
    scene の上で自然に薄く見えること。
    - 前後に transparent 材質が複数あるモデルで、edge が後続材質を depth で不正に隠さないこと。
    - opaque モデルの既存輪郭線の見た目が大きく崩れないこと。

## Assumptions

- 今回の目標は OIT ではなく、現行の PMX 順 alpha 合成の中で inverted hull を正しく見せること。
- glTF / cell shader を含む shared outline path に同じ描画順修正を適用する。
- API 追加は行わないので docs/specification/api-specification.md と docs/specification/api-specification-ja.md
は更新しない。
- これでも多層透明の完全な順不同合成問題は解決しないが、今回の不具合原因には十分に対処できる。