# Child Of 機能追加

- ボーン情報タブに Set Child UI を追加し、選択中の単一ボーンへ「追加親」を設定できるようにする。
- 追加親は既存親とは別に合成され、元の親を動かしても追加親を動かしても子ボーンが追従する。
- 追加親は位置と回転の両方に影響する。影響力スライダーの既定値は 1.0。
- manual* 補正は Child 設定後も従来どおり有効にし、world/local 逆算は Child 状態を考慮して再計算する。

## Key Changes

- scene.boneLocalTransforms に Child 状態を追加する。
    - childEnabled
    - childSourceInstanceIndex
    - childSourceBoneName または解決済み bone index
    - childInfluence
    - childInverseEnabled
    - childLocalOffsetPosition
    - childLocalOffsetRotation
- source/model-scene.js
    - 上記 state の初期値を追加する。
    - inverse 用 offset はデフォルトでゼロ移動、単位回転。
- source/model-manager.js / source/bone-transform-utils.js
    - 通常親と追加親を合成した「実効親変換」を求める helper を追加する。
    - recomputeBoneMatrices() で local pose の適用順を次にそろえる。
        1. animation local
        2. manual local
        3. inherit
        4. Child inverse offset の適用
        5. 元の親 world と Child 親 world の合成
    - Child が有効でもモデル未選択・ボーン未選択・参照先不正なら無効扱いにする。
    - setManualWorldPosition() / setManualWorldRotationQuaternion() と対応 helper は、Child の影響と inverse on/
    off を考慮して manual 値を逆算する。
    - Child 設定時に、その時点の見た目を保つための inverse offset を保存する API を追加する。
    - Clear Inverse は保存 offset を無視した計算へ切り替え、Set Inverse は現在の Child 設定から offset を再計算
    して有効化する。
- source/bone-display-utils.js
    - ボーン情報タブの local/world 表示値を Child 状態込みで計算する。
    - world 表示は最終 worldMatrix/worldRotation、local 表示は inverse on/off と Child 影響込みの見かけの local
    を返す。
- source/physics.js
    - FK 再計算経路で使っている parent/world 組み立てにも Child 合成を反映する。
    - 物理停止中・物理駆動骨の扱いは現行規約を維持する。
- source/renderer.js / index.html / source/langs/*.json
    - ボーン情報タブに以下を追加する。
        - Set Child チェックボックス
        - モデル選択セレクト
        - ボーン選択セレクト
        - Clear Inverse / Set Inverse ボタン
        - 影響力スライダー + 数値表示
    - 複数ボーン選択時は Child UI を無効化し、単一選択時のみ編集可能にする。
    - モデル一覧更新時に Child 用モデルセレクトを再構築し、選択モデルに応じてボーン一覧を再構築する。
    - Child UI の変更時は対象ボーンを dirty にし、refreshScene() へつなぐ。
- ドキュメント
    - 公開 API は追加しない前提なので docs/specification/api-specification*.md は更新しない。
    - 必要なら機能仕様の短い追記を docs/ に追加する。

## Test Plan

- tests/model-manager-manual-setters.test.mjs
    - Child なしの既存挙動が変わらないこと。
    - 通常親 + Child 親の両方を動かすと子が追従すること。
    - Child 設定後でも setManualLocalPosition/Rotation と setManualWorldPosition/Rotation が正しく動くこと。
    - Set Inverse 直後に見た目が保持されること。
    - Clear Inverse で保存 offset を無視した位置・回転になること。
    - influence 0, 0.5, 1 のときの追従量が正しいこと。
    - 別モデルのボーンを親にできること。
    - 不正な model/bone 選択時は Child 無効扱いになること。
- tests/api-state.test.mjs
    - snapshot の local/world 値が Child 適用後の結果を返すこと。
- tests/animation-loop-physics.test.mjs もしくは専用 test
    - 物理更新経路でも Child が worldMatrix に反映されること。
- UI テストまたは renderer 周辺 test
    - Child 用 select の再構築、複数選択時無効化、inverse ボタンの状態遷移を確認する。

## Assumptions

- Child は位置と回転の両方へ影響させる。
- Child UI は単一ボーン選択時のみ編集可能にする。
- 影響力は 0.0..1.0 の float とし、既定値は 1.0。
- Child 設定はランタイム state のみで、PMX/VMD への保存機能は今回追加しない。
- inverse offset は Child 設定時または Set Inverse 実行時の現在姿勢から再計算する。