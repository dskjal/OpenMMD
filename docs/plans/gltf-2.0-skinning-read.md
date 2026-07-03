# glTF 2.0 の骨・スキン読み込み対応

## Summary

GLTFModelLoader に骨階層とスキン付きメッシュの取り込みを追加します。test-data/armature-animation-test.glb を使っ
て、骨 2 本とスキン付き Cube が内部モデルへ正しく変換されることを検証します。

## Implementation Changes

- source/loader/gltf-loader.js
    - 先に scene 内の Bone ノードを収集し、model.bones を構築する。
    - name / parentIndex / transformLevel / position / localX-Y-Z / tailIndex / flags を glTF の TRS から埋め
    る。
    - hasDummyBone は実骨がある場合に false 化し、dummy は使わない。
    - SkinnedMesh を静的スキップせず、skinIndex / skinWeight を vertices の既存スキニング領域へ書き込む。
    - glTF の 1..4 influence を内部の BDEF1 / BDEF2 / BDEF4 に正規化する。SDEF は使わない。
    - メッシュの bone index は skeleton.bones から内部 model.bones へのマップで解決する。
    - 既存の静的メッシュ import はそのまま維持する。
- 既存の allowUnsupportedSkins は互換用に残し、標準 glTF skin は通常パスで読む。未対応ケースだけ警告/失敗の制御
に使う。

## Test Plan

- tests/gltf-loader.test.mjs に armature-animation-test.glb 用のケースを追加する。
    - model.bones.length === 2
    - hasDummyBone === false
    - Bone -> Bone001 の親子関係が正しい
    - tailIndex が子ボーンに解決される
    - vertexCount, indices, materials が fixture と一致する
    - 最初の頂点の bone index / weight が期待通りに変換される
    - createSceneState() で boneCount === 2 と sortedBoneIndices が成立する
- 既存の plane.glb と大規模 glTF のテストはそのまま通し、静的 import の回帰がないことを確認する。

## Assumptions

- 追加対象は tests/armature-animation-test.glb ではなく、実際の fixture である test-data/armature-animation-
test.glb を使う。
- 今回の対象は骨階層とスキン変換までで、glTF animation track の取り込みは別件とする。
- API 追加はないため、docs/specification/api-specification.md 系の更新は不要。