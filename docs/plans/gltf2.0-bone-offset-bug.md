# glTF Bone Translation Offset Fix

## Summary

armature-animation-test.glb の不具合は bone 階層生成ではなく、glTF の translation アニメーションを OpenMMD に取
り込むときに bind pose 基準へ正規化していないことが原因です。
現状は Bone001 の bind pose [0,1,0] に、glTF キーの先頭値 [0,1,0] をそのまま local.translation として加算してし
まい、初期状態で world [0,2,0] / local [0,1,0] になります。

## Key Changes

- source/gltf-animation.js
    - glTF の bone translation チャンネルを import するとき、対応する model.bones の bind pose 差分を引いて
    OpenMMD のローカル補正量へ変換する。
    - 具体的には bone.position - parent.position を bind pose local translation として求め、各 keyframe value か
    ら減算する。
    - root bone は bind pose world bone.position をそのまま bind pose translation として使う。
    - rotation / scale / morph は現状維持。
    - export 時は逆変換を入れ、OpenMMD の channel 値へ bind pose translation を足して Three.js track に戻す。こ
    れを入れないと .glb 再出力で translation が壊れる。
- 実装方針
    - createGltfAnimationSources(gltf, model) 内で bone 名ごとの bind pose translation map を 1 回構築して
    convertThreeTrackToAnimationChannel() に渡す。
    - createThreeAnimationClipsFromSources(sources) は現状の引数だと bind pose を参照できないので、model 参照を
    受け取れる形へ拡張するか、export 用に必要最小限の bind pose map を追加引数で渡す。
    - exportAnimationSourcesToGlb(scene, sources) も bind pose 情報へアクセスできるようにし、呼び出し元
    renderer.js と既存テストを合わせて更新する。
- 影響範囲
    - glTF animation の bone translation のみ。
    - PMX / PMD / VMD の挙動は変更しない。
    - buildBonesFromScene() の bone world 取得ロジックは今回の原因ではないので触らない。

## Test Plan

- tests/gltf-loader.test.mjs
    - armature-animation-test.glb 読み込み後、model.bones は引き続き
        - Bone: [0,0,0]
        - Bone001: [0,1,0]
        - Bone001_leaf: [0,2,0]
        を維持することを確認。
    - glTF animation source の Bone001.translation 先頭 key が [0,0,0] になることを追加確認。
    - Bone001_leaf.translation は bind pose 補正後も期待値どおりであることを確認。
    - AnimationController を 0 フレーム適用した直後に
        - Bone001 local translation 表示相当値が [0,0,0]
        - Bone001 world が [0,1,0]
        - Bone001_leaf world が [0,2,0]
        になる回帰テストを追加。
- export 回帰
    - 既存の GLB export テストを拡張し、再 export 後に再 parse した glTF 側 translation key が絶対値として維持さ
    れることを確認する。
    - 少なくとも Bone001 の先頭 translation key が exported GLB 上では [0,1,0] に戻ることを確認する。

## Public Interfaces

- 外部 API 追加なし。
- ただし内部関数の引数は変更する:
    - createGltfAnimationSources(...)
    - createThreeAnimationClipsFromSources(...)
    - exportAnimationSourcesToGlb(...)
- これらは内部実装の変更なので docs/specification/api-specification*.md の更新は不要。

## Assumptions

- OpenMMD の local.translation は bind pose からの差分として扱うのが正しい。
- glTF の node translation track は bind pose を含む絶対 local TRS なので、import/export の両方向で bind pose と
の差分変換が必要。
- _leaf bone は削除せず、そのまま terminal helper として保持する。