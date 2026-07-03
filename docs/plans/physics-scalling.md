# Physics-Only 10x Ammo Scale in source/physics.js

## Summary

PhysicsEngine 内だけに AMMO_LENGTH_SCALE = 10 を導入し、OpenMMD 側の長さをそのまま保ったまま、Ammo に渡す長さ関
連値だけを 10 倍して、Ammo から戻す位置系だけを 1/10 に戻す。

回転、ボーン階層、ローダー、他モジュールのデータ構造は変更しない。source/physics.js の外へ API 追加もしない。

## Key Changes

- source/physics.js の先頭付近に長さ変換定数を追加する。
    - AMMO_LENGTH_SCALE = 10
    - AMMO_INV_LENGTH_SCALE = 0.1
    - 重力と長さしきい値は Ammo 空間基準へ再定義する。
    - GRAVITY_ACCELERATION_AMMO = -9.8 * AMMO_LENGTH_SCALE
    - SPLIT_IMPULSE_PENETRATION_THRESHOLD_AMMO = -0.01 * AMMO_LENGTH_SCALE
    - CONTACT_PROCESSING_THRESHOLD_AMMO = 0.05 * AMMO_LENGTH_SCALE
- PhysicsEngine 内に長さ変換ヘルパーを追加する。
    - OpenMMD vec3 -> Ammo 長さへ変換する helper
    - Ammo 長さ -> OpenMMD vec3 へ戻す helper
    - mat4 の平行移動成分だけを拡大・縮小する helper
    - Bullet btTransform の origin だけを拡大・縮小付きで読み書きする helper
    - 既存の _setBTTransformFromMat4 / _getMat4FromBTTransform はそのまま置き換えるか、内部で scale-aware helper
    を呼ぶようにする
- world 初期化時の Ammo 定数を Ammo 空間へ切り替える。
    - setGravity を GRAVITY_ACCELERATION_AMMO に変更
    - split impulse threshold を Ammo 空間値へ変更
    - 接触しきい値 setContactProcessingThreshold を Ammo 空間値へ変更
- 剛体生成を Ammo 空間へ変換する。
    - sphere / box / capsule の size を 10 倍して shape を生成
    - rbData.position と bone.position を 10 倍した値で rbWorldMatrixBind / boneWorldMatrixBind /
    boneOffsetMat / invBoneOffsetMat を作る
    - 初期 transform 設定時も Ammo 側は 10 倍空間で保持する
    - 質量、減衰、反発、摩擦、回転は変更しない
- ジョイント生成を Ammo 空間へ変換する。
    - jointData.position を 10 倍して joint world transform を作る
    - posMin / posMax を 10 倍して linear limit に設定する
    - rotMin / rotMax、posSpring、rotSpring は現状維持
    - ERP / CFM は現状維持
- pre/post simulation の同期を scale-aware にする。
    - _preSimulation
        - ボーン world matrix と boneOffsetMat から作る rbWorldMatrix は Ammo 空間で計算する
        - mode 0 の linear velocity は Ammo 空間差分で計算する
        - mode 2 の origin warp も Ammo 空間で行う
    - _postSimulation
        - Ammo から読む rigid body origin は 1/10 に戻して OpenMMD 空間の rbWorldMatrix を作る
        - ただし invBoneOffsetMat も Ammo 空間で保持されるので、rbWorldMatrix と同じ空間に揃える
        - 実装を単純化するため、_postSimulation では Ammo の transform をまず Ammo 空間 mat4 にし、その後
        translation だけ縮小した OpenMMD 空間 mat4 を別に作って以降のボーン逆算に使う
        - mode 1 の local.translation 取得結果は OpenMMD 空間のまま既存ロジックへ流す
        - mode 2 の回転のみ反映挙動は維持する
- rayTest の入出力を scale-aware にする。
    - 引数 rayFrom / rayTo を Ammo へ渡す前に 10 倍する
    - 戻り値の shape/body 特定ロジックはそのまま
    - ヒット body 情報の公開 shape は変えない

## Test Plan

- mode 0 の kinematic rigid body が、同じボーン操作で従来と同じ見た目位置へ追従する
- mode 1 の物理ボーンが、シミュレーション後に従来と同じ OpenMMD 座標へ書き戻される
- mode 2 の「位置は FK、回転は物理」挙動が崩れない
- joint の linear limit が 10 倍誤差なく効き、拘束が過度に緩くも硬くもならない
- rayTest が物理 wireframe や剛体選択で従来どおり当たる
- reset / rebuild / addModel 後の初期姿勢で rigid body の見た目位置ズレが出ない
- 重力感が従来より不自然に遅くならず、少なくとも「長さだけ 10 倍して重力未補正」の失敗ケースを避けられている

## Assumptions

- 変更範囲は source/physics.js のみで固定する
- OpenMMD 側の public API、model data、scene data の単位は変更しない
- Bullet 側で安定性を稼ぐための局所拡大が目的であり、仕様書との単位整合まではこの変更では扱わない
- posSpring の厳密な単位解釈はこの段階では固定せず、まずは現状維持で比較検証する
- 既存のデバッグ表示やログ出力は OpenMMD 空間基準のまま維持する