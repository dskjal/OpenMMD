# VRM 0.x secondaryAnimation 実装計画

## Summary

- 既存の source/vrm-springbone.js を VRM 1.0 専用から「VRM 1.0 VRMC_springBone / VRM 0.x secondaryAnimation 共通
ランタイム」へ拡張する。

- childless root は Synthetic Tail で扱う。VRM 0.x は T-pose 正規化、bone local rotation なし、scale なしが前提
なので、仮想 tail 方向は「親から当該 bone へのベクトルの延長」、必要なのは長さ推定だけに絞る。

- 仕様根拠:
    - VRM 0.0 spec README (https://github.com/vrm-c/vrm-specification/blob/master/specification/0.0/README.md)
    - UniVRM humanoid overview (https://vrm.dev/univrm/humanoid/humanoid_overview/)
    - VRM development notes (https://vrm.dev/en/vrm/vrm_development/)

## Key Changes

- source/loader/vrm-loader.js
    - model.vrm.springBone は常に共通正規化形を保持する。
    - model.vrm.version === 'vrm0' のときは extensions.VRM.secondaryAnimation を parseVrmSpringBone に渡せるよう
    にする。

    - model.vrm.springBone.sourceVersion を追加し、'vrm0-secondaryAnimation' | 'vrm1-springBone' を保持する。

- source/vrm-springbone.js
    - parseVrmSpringBone(model, gltfJson) を 2 系統対応にする。
    - VRM 0.x 正規化規則:
        - secondaryAnimation.colliderGroups[*].colliders[*] の sphere をフラットな colliders に展開する。
        - 展開後の collider index を使って colliderGroups[*].colliders を再構築する。
        - boneGroups[*] は「1 group = 1 spring」ではなく、「bones[*] の各 root から single-child descendant を
        leaf まで辿った chain ごとに 1 spring」へ展開する。

        - group 単位パラメータ stiffiness, gravityPower, gravityDir, dragForce, hitRadius, center,
        colliderGroups を、その chain の全 joint にコピーする。

        - stiffiness の綴りは 0.x 仕様どおりそのまま受け、内部では stiffness に正規化する。

    - childless root / leaf-only chain の仮想 tail 規則:
        - tailBoneIndex = -1 を許す runtime shape を追加する。
        - 仮想 tail 方向は normalize(currentBone.position - parentBone.position) を使う。
        - 仮想 tail 長はまず distance(currentBone.position, parentBone.position) を採用する。
        - 親距離が取れない場合は、同じ boneGroup 内で実 chain から得た segment 長の中央値を使う。
        - それも無い場合は max(hitRadius * 2, 0.01) を使う。
        - 親ベクトルがゼロに近い場合だけ bone.localY、それも無ければ world +Y を使う。

    - runtime state:
        - segment は tailBoneIndex に加えて virtualTailOffsetLocal と hasVirtualTail を持てるようにする。
        - 初期化・更新・衝突・長さ拘束は bone tail / virtual tail の両方で同じ solver を通す。
        - synthetic tail の world 位置は head world matrix * virtualTailOffsetLocal から得る。

- source/model-scene.js, source/model-manager.js, source/ui-overlay.js
    - 既存の createVrmSpringBoneState / updateVrmSpringBone 経路は維持する。
    - 0.x 追加で更新順は変えない。animation -> recompute -> IK -> VRM springbone -> physics の現状を保つ。
    - collider debug 表示は 0.x でもそのまま見えるようにする。

## Tests

- tests/vrm-springbone.test.mjs
    - VRM 0.x secondaryAnimation を 1.0 相当 shape に正規化できる。
    - boneGroups[*].bones が複数 root のとき、root ごとに別 spring へ展開される。
    - group 単位の stiffiness などが joint へコピーされる。
    - colliderGroups 内包 sphere がフラット collider 配列へ展開される。
    - childless root で hasVirtualTail が立ち、親距離ベースの長さが入る。

- 統合テスト
    - tests/gltf-loader.test.mjs に test-data/AliciaSolid.vrm の model.vrm.springBone 検証を追加する。
    - AliciaSolid.vrm 読み込み後に scene.vrmSpringBoneState が生成される。
    - 0.x springbone 更新後、少なくとも 1 本の chain で tail 位置が変化し、segment 長が保持される。
    - childless root を含んでも更新が落ちない。

- 回帰
    - 既存 VRM 1.0 テストはそのまま通ること。
    - 既存 collider debug 表示が 1.0 で壊れないこと。

## Assumptions

- 今回は VRM 0.x secondaryAnimation の読み込みと runtime 適用までを対象にし、公開 API・UI 操作・保存機能は追加し
ない。

- 0.x collider は sphere のみ対応でよい。capsule 等は 0.x 経路では扱わない。
- childless root の synthetic tail は互換近似であり、UniVRM と完全一致ではなく「破綻せず自然に揺れる」ことを受け
入れる。

- API を増やさないため、docs/specification/api-specification.md と docs/specification/api-specification-ja.md は
更新しない。必要なら docs/openmmd-specification.md に 0.x secondaryAnimation の正規化方針を追記する。