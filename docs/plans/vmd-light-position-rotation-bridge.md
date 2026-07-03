# VMD Light Position/Rotation Bridge

## Summary

- VMD の lightKeyframe.position を OpenMMD 内部の directional light 用回転情報へ変換する専用ヘルパーを追加する。
- 変換は VMD 専用に閉じ、通常の OpenMMD light state や他フォーマットには影響させない。
- 方針は position を「原点から見た光源位置ベクトル」とみなし、directional light の direction はその逆向きにする
近似で固定する。

## Key Changes

- source/ に VMD light 変換ヘルパーモジュールを追加する。
    - vmd light position -> directional direction/rotation
    - directional rotation/direction -> vmd light position
    - 有限値化、零ベクトル時 fallback、正規化、JSDoc を含める。
    - 既定の VMD light 距離スケールを 1 箇所に定義する。保存時は rotation だけでは長さが失われるので、この固定距
    離で position を再構成する。

- source/loader/vmd-loader.js を更新する。
    - 既存の position 読み込みは維持する。
    - 追加で内部利用向けの direction / rotation を light keyframe に持たせる。
    - Z-flip 後の内部座標をヘルパーへ渡して directional 情報を生成する。

- source/loader/vmd-writer.js を更新する。
    - lightKeyframe.rotation または lightKeyframe.direction がある場合は、それを優先して VMD position を再構成す
    る。

    - 無い場合は現行互換として position を使う。
    - 最後に VMD 保存境界の Z-flip を適用する。

- source/animation.js と source/renderer.js の light 再生経路を追加する。
    - AnimationController に lightKeyframes を保持させる。
    - camera と同様に現在 frame の light keyframe を解決する helper を用意する。
    - rendererState.lightObject に対して direction/rotation と lightColor を適用する。
    - 手動編集 UI と競合しないよう、VMD がある frame では VMD 値が再適用される現状 camera と同じ扱いに寄せる。

- docs/openmmd-specification.md を更新する。
    - VMD は点光源、OpenMMD は directional light なので、VMD 専用に position と rotation を相互変換する近似を使
    うことを明記する。

    - 完全一致は目指さず、direction ベース近似で保存・再生することを書く。

## Public Interfaces / Data Shape

- VMD light keyframe の内部 shape を拡張する。
    - 既存: frameNum, color, position
    - 追加: direction, rotation

- 追加 field は OpenMMD 内部利用専用で、VMD バイナリ仕様自体は変更しない。

## Test Plan

- tests/ に VMD light 変換の単体テストを追加する。
    - position -> direction/rotation の基本ケース
    - direction/rotation -> position の基本ケース
    - 零ベクトルや不正値時の fallback
    - round-trip が完全一致ではなくても、方向が十分近いこと

- loader/writer テストを追加する。
    - VMD light keyframe 読み込みで direction/rotation が生成されること

## Summary

- VMD の light keyframe は引き続き color + position を基準に扱うが、OpenMMD 内部では directional light 用の
rotation/direction を導出できるようにする。

- 今回の影響範囲は VMD のみとし、通常の OpenMMD light UI / 他フォーマット / デフォルト light 動作は変えない。
- 近似は VMD position を「原点から見た仮想点光源位置」とみなし、directional light の照射方向をその逆ベクトルとし
て求める方式で固定する。

## Implementation Changes

- source/light-object.js か専用 light 変換モジュールに、JSDoc 付きの VMD light 変換ヘルパーを追加する。
    - createDirectionalLightDirectionFromVmdPosition(position):
        - 入力の position を正規化し、directional light の direction = -normalize(position) を返す。
        - 零ベクトル時は既定方向へフォールバックする。

    - createVmdLightPositionFromDirectionalLight(direction, length?):
        - position = -normalize(direction) * length を返す。
        - length は VMD 互換の仮想距離として固定値を使う。既定値は現行 spec の記述に合わせ、既存の見た目を崩しに
        くい値を 1 箇所で定数化する。

    - 必要なら createLightRotationFromVmdPosition(position) / createVmdLightPositionFromRotation(rotation,
    length?) も追加し、rotation ベースで直接扱えるようにする。

- source/loader/vmd-loader.js
    - light keyframe 読み込み時に従来の position を残しつつ、内部利用向けの direction と必要なら rotation を付加
    する。

    - 既存の VMD 座標変換方針との整合を取り、VMD light の Z flip が load/save で対になるように整理する。

- source/loader/vmd-writer.js
    - light keyframe 書き出し時は position が無くても direction または rotation から VMD position を復元して保存
    できるようにする。

    - position と direction/rotation が両方ある場合は、今回の方針に従って direction/rotation を優先して再計算し
    た position を書く。

- runtime 適用
    - light motion 再生処理を camera と同様に追加し、アクティブ VMD の現在 frame から light keyframe を取得して
    rendererState.lightObject に反映する。

    - 補間は VMD light に専用補間が無いため、少なくとも frame 区間の線形補間で color と position を補間し、その
    結果から direction/rotation を毎回導出する。

    - UI 表示値も runtime の light state と同期する。

- docs/openmmd-specification.md
    - 「VMD は点光源、OpenMMD は directional light」の差と、今回の近似変換ルールを明記する。
    - 完全再現ではなく、position から direction を近似復元していること、保存時は逆変換で position を生成すること
    を追記する。

## Test Plan

- tests/ に VMD light 変換テストを追加する。
    - position -> direction が期待向きになる。
    - direction -> position が固定長つきで期待値になる。
    - 零ベクトル入力でフォールバックする。

- loader/writer roundtrip テストを追加する。
    - VMD light keyframe を load すると position に加えて direction/rotation が得られる。
    - そのデータを save すると、VMD 上の light position が一貫して書き戻される。

- runtime 適用テストを追加する。
    - 複数 light keyframe 間で現在 frame に応じて light direction が更新される。
    - color も同時に補間される。

- 既存の VMD roundtrip / unit conversion テストに light keyframe を含むケースがあれば期待値を更新する。

## Assumptions

- 変換近似は direction = -normalize(position) を採用する。
- VMD point light の絶対距離は directional light では表現できないため、保存時の position 長は固定値で再構成す
る。

- 今回は VMD 専用対応で、glTF/VRM/light UI の一般仕様は拡張しない。
- API 追加は行わないため docs/specification/api-specification.md と docs/specification/api-specification-ja.md
は更新対象外とする。