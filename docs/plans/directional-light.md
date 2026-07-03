# ライトオブジェクト実装計画

- 単一のグローバル directional light を scene object として追加する。
- ライトはクリック選択可能にし、選択中はモデル/ボーン選択を解除する。
- ライトには移動・回転ギズモを出す。移動は見た目上のオブジェクト位置だけを変更し、shader / shadow 計算には影響さ
せない。回転は lightDirection を更新し、main shading・contact shadow・CSM に反映する。
- 見た目は fonts/sunny_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg を元にした太陽アイコン形状を、ワールド空間
billboard として depth test 付きで描画する。

## Key Changes

- 選択 state を scene object 対応へ拡張する。
    - selection にライト選択フラグ/種別を追加する。
    - ライト選択時は selectedBoneIndex / selectedBoneIndices / selectedTargetIndex / selectedRigidbodyIndex を解
    除する。
    - 既存の activeInstanceIndex は維持し、モデル UI は最後の active model を保持するが、編集対象はライトに切り
    替える。
- ライトの runtime state を rendererState に追加する。
    - lightObject.position
    - lightObject.rotationQuaternion または yaw/pitch ベースの姿勢
    - lightObject.direction
    - 初期 direction は現状固定値 normalize([-0.5, -1.0, -0.5]) と一致させる。
    - 初期 position は camera/scene から独立した固定ワールド位置に置き、移動しても lighting には使わない。
- render-loop.js のライト更新経路を差し替える。
    - 固定 lightDir 定数を廃止し、rendererState.lightObject.direction から取得する。
    - 同じ direction を以下へ流す。
        - global/edge uniform の lightingParams
        - contact shadow view direction
        - shadowManager.update({ lightDirection })
    - これで回転 gizmo が shading と shadow の両方に効く。
- ピッキングと選択をライト対応に広げる。
    - renderer-interaction.js にライト billboard 用の hit test を追加する。
    - 判定順は physics -> active model bones/custom rig -> other model bones -> light object -> model AABB では
    なく、ライトも「scene object」としてボーン系と同じクリック経路に載せる。
    - depth-aware な 3D ピックにして、モデルのように自然に選択できるようにする。
- ギズモをライト対応に抽象化する。
    - gizmo.js の「選択対象=bone」前提を、「bone または light object」に広げる。
    - ライト選択時は常に回転・移動の両方を有効にする。
    - 回転ドラッグはワールド軸/ローカル軸のどちらでも最終的に lightObject.direction を更新する。
    - 移動ドラッグは lightObject.position のみ更新する。
    - 既存 bone gizmo の挙動は変えない。
- UI overlay にライト billboard 描画を追加する。
    - ui-overlay.js にライト専用頂点生成とバッファ更新を追加する。
    - SVG の外周をそのまま取り込むのではなく、太陽の「中心円 + 放射線」の構成を line quad で近似する。
    - billboard は camera の view basis を使って毎フレームカメラ正面を向かせる。
    - depth test 付きのワールド空間 overlay として描画し、選択中は色を変える。
    - アイコンの当たり判定サイズと見た目サイズは同じ基準スケール関数で揃える。

## Test Plan

- tests/gizmo.test.mjs
    - ライト選択時に回転・移動 gizmo が両方出る。
    - ライト回転 drag で direction が更新される。
    - ライト移動 drag で position だけ更新され、direction は変わらない。
- tests/renderer-interaction.test.mjs
    - ライト icon のクリックでライト選択に切り替わり、モデル/ボーン選択が解除される。
    - ライト選択中の gizmo drag 開始/終了が通る。
    - ライト非選択状態では既存 bone pick が壊れない。
- tests/ui-overlay.test.mjs
    - ライト billboard 頂点が生成される。
    - camera 向きの変化で billboard の向きが更新される。
    - 選択中/非選択で色が変わる。
- tests/render-loop 系
    - rendererState.lightObject.direction が uniform と shadow manager に反映される。
    - ライト position を変えても lightingParams / shadow lightDirection は変わらない。

## Public Interfaces / Docs

- 外部 API は今回は追加しない前提。
- そのため docs/specification/api-specification.md と docs/specification/api-specification-ja.md は更新しない。
- 内部的には selection と rendererState の shape が拡張されるため、関連テスト stub も更新する。

## Assumptions

- directional light は 1 つだけ扱う。
- ライト選択時は「モデル解除」を採用する。
- ライト icon は depth test 付き billboard とする。
- ライト position は scene runtime state のみで使い、shader/shadow の light direction 計算には使わない。
- アイコン形状は SVG の視覚モチーフ準拠で、厳密なパス再現ではなく line overlay 向け近似形状を採用する。