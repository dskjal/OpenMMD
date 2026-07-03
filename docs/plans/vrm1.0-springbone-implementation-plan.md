# VRM 1.0 SpringBone 調査・実装方針

## Summary

- 結論: VRMC_springBone 1.0 の仕様どおりの挙動を Ammo.js だけで素直に再現するのは不向き。
- 理由: 現行 VRM 仕様は剛体拘束ベースではなく、prevTail/currentTail を持つ Verlet 積分、root-to-tip 更新、center
空間、tail 点と sphere/capsule の逐次押し戻しを前提にしている。これは現在の /D:/data/program/openmmd/source/
physics.js の「MMD 剛体 + 6DoF joint」モデルと一致しない。

- 採用方針: MMD 物理 = Ammo.js、VRM SpringBone = 独自ソルバ のハイブリッドにする。Ammo.js へ VRM を寄せない。

## Key Changes

- ローダー
    - /D:/data/program/openmmd/source/loader/gltf-loader.js で extensions.VRMC_springBone を読み取り、
    model.vrm.springBone を構築する。

    - 収集対象は specVersion、colliders、colliderGroups、springs、springs[*].joints[*]、center。
    - VRM 1.0 中心とし、VRM 0.x はこの段階では実装しない。将来拡張しやすい形で別フィールドに逃がせる構造だけ確保
    する。

- 実行系
    - 新規 vrm-springbone 系モジュールを追加し、joint state に prevTail/currentTail/boneAxis/boneLength/
    initialLocalMatrix/initialLocalRotation を保持する。

    - 更新順は仕様どおり root-to-tip。評価順は LookAt -> Expression -> Node Constraint -> SpringBone を守る。
    - center 指定 spring は慣性だけ center space で評価し、重力は world space のまま扱う。
    - collider は Bullet world に入れず、OpenMMD の bone/world matrix から sphere/capsule を毎フレーム直接評価す
    る。

    - spring の結果は rigid body ではなく bone local rotation に反映する。tail 点の拘束長を維持し、
    fromToQuaternion で回転を更新する。

- 既存物理との統合
    - /D:/data/program/openmmd/source/physics.js は MMD 専用のまま維持し、VRM モデルでは model.rigidBodies /
    model.joints 依存の経路を使わない。

    - /D:/data/program/openmmd/source/model-manager.js とアニメーション更新側で、VRM bone の spring 適用タイミン
    グを recomputeBoneMatrices 後かつ最終描画前に固定する。

    - manual transform と競合しない優先順位を定義する。初期方針は「manual/animation/constraint を解決した結果に
    spring を後段適用」。

- データ/API
    - 公開 API を増やすなら model.vrm.springBone を読み取り専用で公開する。
    - 外部 API を追加する場合は spring enable/disable と reset のみを最小追加とし、追加時は docs/specification/
    api-specification.md と /D:/data/program/openmmd/docs/specification/api-specification-ja.md を更新する。

## Test Plan

- ローダー
    - VRMC_springBone の collider / colliderGroup / spring / center / joints パラメータを正しく取り込む。
    - 不正参照、空配列、末尾 joint の省略パラメータを安全に扱う。

- ソルバ
    - root-to-tip 順で親の回転が子の評価に反映される。
    - drag/stiffness/gravity の各項が単独で期待方向に働く。
    - sphere/capsule との押し戻し後も boneLength が維持される。
    - center space あり/なしで慣性結果が変わり、重力方向は変わらない。

- 統合
    - VRM モデルで SpringBone が動いても Ammo world の MMD 剛体更新に影響しない。
    - LookAt / Expression / Constraint 後に SpringBone が適用される。
    - physics pause / reset 相当の操作で SpringBone state が初期化される。

## Assumptions

- 今回の対象は VRM 1.0 + VRMC_springBone 1.0。
- 成功条件は「Ammo.js に寄せること」ではなく「VRM 仕様に近い挙動を OpenMMD に統合すること」。
- Ammo.js 主導 の VRM 再現は調査結果として不採用。必要なら将来、近似モードとして別実装に分ける。
- VRM 0.x secondaryAnimation は別フェーズ。初回実装では非対応か、明示的に未対応扱いにする。