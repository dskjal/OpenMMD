# 単位系統一方針: 内部をメートル系へ寄せる

## Summary

内部標準は glTF / VRM 側、つまり 1 = 1 meter に統一するのが妥当です。
PMD / PMX / VMD は保守終了の外部フォーマットとして扱い、入出力境界で 10x / 0.1x 変換する方針にします。

理由は明確です。

- 今後伸ばす対象が glTF / VRM で、こちらは仕様・周辺ツール・エクスポーターがメートル前提。
- PMD / PMX / VMD は今後拡張しないので、互換層に押し込めるのが最も安全。
- ランタイム物理・アニメーション・将来の機能追加で、MMD の 10 倍単位を内部標準に持ち続ける利点が薄い。

## Key Changes

- 内部ランタイムの長さ単位を meter に固定する。
- PMD / PMX ローダーで座標・剛体・ジョイント・ボーン位置を 0.1 倍して内部へ入れる。
- VMD ローダーで bone/camera の translation 系を 0.1 倍して内部 clip に正規化する。
- VMD / 将来の PMX 書き出しがある箇所では、保存直前に 10 倍して外部仕様へ戻す。
- glTF / VRM ローダーと GLTFExporter 系は原則無変換にする。
- PhysicsEngine の重力・しきい値・補正量はメートル系に合わせて再基準化する。
    - 例: 現在の -100 重力は、内部が meter 化された後は -9.8 近傍を基準に再設計する。
- カメラ既定値、UI の距離感、gizmo サイズ、shadow bias、contact shadow / AO 半径など、長さ依存の定数は meter 基
準で見直す。
- 互換境界を明確化するため、単位変換はローダー / ライター / exporter adapter に集約し、ランタイム中盤へ散らさな
い。

## Public Interfaces / Format Rules

- OpenMMD 内部モデル・内部 animation clip・物理 state の長さ単位は meter と明文化する。
- PMD / PMX / VMD は「互換入力フォーマット」であり、内部へ取り込む時点で meter に正規化する。
- glTF / VRM は現状どおり meter 入出力を維持する。
- 仕様書更新対象:
    - docs/openmmd-specification.md
    - 必要なら docs/specification/api-specification.md
    - 必要なら docs/specification/api-specification-ja.md

## Test Plan

- PMX 読み込み後の人物高さが従来見た目を維持しつつ、内部数値としては 1/10 になっていること。
- glTF / VRM は読み込み前後で追加スケーリングなしに既存寸法を維持すること。
- VMD を PMX モデルへ適用したとき、従来と同じ見た目の移動量になること。
- glTF animation と VMD animation が同じ内部 clip evaluator 上で、単位差なしに再生できること。
- VMD 保存時、内部 meter 値が外部 VMD 単位へ正しく 10x 変換されること。
- 物理で重力、剛体追従、joint 制約、rayTest、manual transform 反映が破綻しないこと。
- glTF/VRM の GLB export 後、外部 viewer で想定スケールを維持すること。

## Assumptions

- 目的は「内部統一」であり、既存 MMD 資産の見た目や操作感は互換変換で維持する。
- 既存の MMD 向け UI 文言や VMD 中心の操作フローはそのままでもよいが、内部単位は meter として扱う。
- 互換コストは主に PMD / PMX / VMD 入出力と物理定数再調整に集中し、将来コストは大きく下がる。