# ボーン複数選択・複数編集 実装プラン

## Summary

- 現状は selection.selectedBoneIndex を中心に単一ボーン前提が renderer.js、renderer-interaction.js、gizmo.js、timeline-manager.js、ui-overlay.js に分散しているため、実装前に選択 state と選択 helper の整理が必要です。
- Plan Mode のためリファクタリング実行はしていません。実装時は最初に selection 周りのリファクタリングを入れ、その上でクリック選択、ボックス選択、複数編集を載せます。
- 操作仕様は以下で固定します。
    - PC モード: ボーンボックス選択は単純ドラッグ
    - タブレットモード: ショートカットパネルのラジオボタンでボックス選択モードに切り替えてドラッグ
    - Shift+クリック: 同一モデル内の選択集合に対する追加/トグル
    - ボックス選択で複数件選ばれた場合: アクティブ無し

## Key Changes

### 1. 先行リファクタリング

- source/renderer-selection.js を選択 state の正規化レイヤーに拡張する。
- selection に以下を追加し、既存単一値は「アクティブ解決結果」として扱う。
    - selectedBoneIndices: number[]
    - activeBoneIndex: number
    - selectionMode: 'default' | 'bone-box-select'
    - boxSelectionSource: 'mouse' | 'touch' | null
- 既存 selectedBoneIndex は互換維持のため当面残すが、activeBoneIndex の mirror に限定する。新規処理は selectedBoneIndices / activeBoneIndex を直接参照する。
- helper を追加する。
    - clearBoneSelection(selection)
    - setSingleBoneSelection(selection, boneIndex, options)
    - toggleBoneSelection(selection, boneIndex, options)
    - setMultiBoneSelection(selection, boneIndices, options)
    - getSelectedBoneIndices(selection, instance)
    - resolveActiveBoneContext(modelManager, selection)
- resetSelectionForInstanceChange() は複数選択 state も初期化する。
- resolveSelectedBoneContext() は「アクティブがあるときのみ」返す動作に寄せ、複数選択一括処理は別 helper へ分離する。
- source/renderer.js のボーン入力更新処理を、表示用の「アクティブ 1 件」と適用用の「選択集合」へ責務分離する。
- source/gizmo.js は「描画/ピック対象ボーン」と「差分適用対象ボーン群」を分けられる state 構造へ整理する。

### 1.5. ギズモのリファクタリング

- source/gizmo.js の責務を「集約 gizmo pose の算出」「描画/ヒットテスト」「ドラッグ差分の保持」「選択ボーン群への差分適用」に分割する。
- 選択集合から gizmo の基準 pose を返す helper を追加する。
    - 1 本のみ選択時はそのボーンの world position / local basis をそのまま使う
    - 複数選択時は選択ボーンの world position 平均を gizmo 位置に使う
    - 複数選択時の local 座標系は、各選択ボーンの localX / localY / localZ を平均して正規直交化した基底を使う
    - world coordinate mode では既存どおり world 軸を使う
- gizmo 描画と pick は単一 `selectedBoneIndex` 前提をやめ、集約 gizmo pose helper の戻り値だけを見るようにする。
- gizmo drag state は単一ボーン値ではなく、選択集合のスナップショットを保持するように拡張する。
    - `selectedBoneIndices`
    - 各ボーンの `startManualRotation`
    - 各ボーンの `startManualTranslation`
    - 集約 gizmo の `startPosition`
    - 回転/平行移動で共通に使う `dragAxisWorld` と `dragPlaneNormal`
- 回転差分と平行移動差分は、ドラッグ中に一度だけ求めた gizmo delta を各ボーンへ配る形に統一する。
    - rotation: gizmo delta quaternion を各ボーンの開始姿勢へ適用
    - translation: gizmo delta translation を各ボーンの開始位置へ適用
- source/renderer-interaction.js は「gizmo を押したか」「どの drag mode か」の判定だけを担当し、複数ボーンへの反映ロジックは source/gizmo.js へ閉じ込める。
- source/ui-overlay.js の gizmo 表示位置も同じ集約 gizmo pose helper を使い、描画位置と drag 計算位置のずれをなくす。
- tests/gizmo.test.mjs は単一ボーン用ケースと複数ボーン用ケースを分離し、平均位置・平均ローカル基底・回転差分・平行移動差分を個別に検証する。

### 2. 選択仕様

- モデル間複数選択は禁止する。新規選択対象が別モデルなら、まずそのモデルをアクティブ化し、既存ボーン選択集合は破棄する。
- 単クリック:
    - ヒットしたボーンのみ単独選択し、そのボーンをアクティブ化
    - IK target / custom rig circle から入った場合も実体ボーン index に正規化
- Shift+クリック:
    - 同一モデル内ならトグル
    - 追加時は activeBoneIndex をそのボーンへ更新
    - 除去しても他の選択が残る場合、アクティブは「直前まで active でなかったら維持、active を外したら未選択でない最後尾」へ更新
    - 0 件になったら activeBoneIndex = -1
- タイムラインからのボーン選択:
    - 対象トラックのボーンだけを単独選択
    - 既存複数選択は解除
- 剛体選択やモデル面選択に入ったらボーン複数選択は解除する。

### 3. ボックス選択

- renderer-interaction.js の範囲ズーム矩形処理を共通化し、矩形 overlay 更新/非表示ロジックを range box interaction helper として再利用する。
- PC モード:
    - 通常左ドラッグでカメラ操作していない現在の入力系に対し、短距離クリックは従来 pick、閾値超えドラッグはボッ
    クス選択へ分岐する。
    - ギズモ hit、既存カメラ操作、depth pick、physics pick より後順位ではなく、左ボタンダウン時に「ギズモ未ヒッ
    トかつ bone selection mode のときのみ」候補化する。
- タブレットモード:
    - ショートカットパネルへラジオボタン追加
    - selectionMode === 'bone-box-select' のときだけドラッグ矩形を出す
- ヒット判定:
    - 既存 createViewProjection() とボーン投影処理を使い、アクティブモデルの可視ボーン中心の screen 座標が矩形内にあるものを抽出
    - hideIkBones の除外条件は通常 pick と揃える
    - ボックス選択結果は bone index 昇順ではなく、画面走査順に依存しない安定順として既存 index 昇順へ正規化する
- 結果反映:
    - 1 件: 単独選択 + そのボーンをアクティブ
    - 複数件: selectedBoneIndices のみ設定し activeBoneIndex = -1
    - 0 件: 既存選択解除

### 4. UI / Overlay / Timeline

- ボーン名ラベルとボーン情報表示は activeBoneIndex のみ参照する。
- activeBoneIndex === -1 かつ selectedBoneIndices.length > 0 のとき:
    - ボーン情報入力欄は値を空表示
    - 入力欄自体は disabled にしない
    - 背景色の keyframe 表示は off
    - ボーン名ラベルは None のまま
- ui-overlay.js は単一赤ハイライトを複数対応へ拡張する。
    - 選択ボーン: 赤
    - activeBoneIndex がある場合はそのボーンだけ強調色を別にするか、既存赤を active に使い、その他選択は薄赤にする
    - IK target の黄色強調は activeBoneIndex または target 骨が選択集合に含まれる場合に点灯
    - custom rig circle も選択集合対応
- gizmo の表示位置は選択集合から算出する。
    - 1 本のみ選択時はそのボーン位置を使う
    - 複数選択時は選択ボーン位置の平均を使う
    - ローカル座標表示も各選択ボーンのローカル座標の平均を使う
- timeline-manager.js
    - registerBoneKeyframe() を複数選択対応
    - syncViewState() は active bone があるときだけ track 選択同期
- renderer-ui.js / renderer.js
    - 入力変更、リセット、コピー/ペーストは active bone 依存と複数適用処理を分ける
    - ショートカットパネルへタブレット用 selection mode ラジオを追加

### 5. 複数編集動作

    - interpolation は現在と同じ配列を全ボーンに適用
    - 各ボーンの manual transform reset も個別に実施
- 数値手入力:
    - アクティブ有り: 表示中の値を基準に従来どおり
    - アクティブ無し複数選択: 入力された同一 position / rotation 値を選択中の全ボーンへ同一適用
    - world/local 切替の意味は現状どおり維持
- ギズモ回転:
    - ギズモは active bone があるときのみ表示
    - ドラッグ開始時に各選択ボーンの startManualRotation と必要な基準姿勢を配列で保持する
    - 更新時は active bone から得た delta angle / delta quaternion を全選択ボーンへ適用する
    - local mode: 各ボーン自身の local axis に対して同じ角度差分を適用
    - world mode: 同じ world-space delta rotation を各ボーンへ適用
    - これにより「0 度/15 度の 2 ボーンへ 15 度回すと 15 度/30 度」になる
- ギズモ平行移動:
    - 回転と同様に差分更新にする
    - ドラッグ開始時に各選択ボーンの startManualTranslation と基準位置を配列で保持する
    - 更新時は gizmo の移動差分を全選択ボーンへ適用する
    - local mode: 各ボーンの local translation に対して同じ差分を適用する
    - world mode: 同じ world-space translation delta を各ボーンへ適用する
- キーボード操作 w/a/s/d/q/e/r:
    - 既存単一処理のままにせず、複数選択時は数値入力と同じポリシーで全件適用
    - r は選択中全ボーンの manual transform を reset

## Public APIs / Interfaces

- selection state に以下を追加する。
    - selectedBoneIndices: number[]
    - activeBoneIndex: number
    - selectionMode: 'default' | 'bone-box-select'
    - boxSelectionSource: 'mouse' | 'touch' | null
- source/renderer-selection.js の helper API を追加する。
- API bridge / snapshot で selection を外部公開している箇所があれば、後方互換のため selectedBoneIndex を残しつつ selectedBoneIndices と activeBoneIndex を追加する。
- もし外部 API へ selection snapshot を追加した場合は docs/specification/api-specification.md と docs/specification/api-specification-ja.md を更新する。

## Test Plan

- tests/renderer-selection.test.mjs
    - 複数選択追加/トグル/解除
    - instance 切替時に複数選択が初期化されること
    - active bone 解決規則
- tests/renderer-interaction.test.mjs
    - Shift+クリックで追加選択
    - Shift+クリック再実行でトグル解除
    - 別モデル bone を Shift+クリックすると前モデル選択が破棄されること
    - PC モード単純ドラッグでボックス選択になること
    - タブレットモードで selection mode 有効時のみボックス選択になること
    - 矩形選択 1 件で active あり、複数件で active なし
- tests/ui-overlay.test.mjs
    - 複数ボーンがハイライトされること
    - IK target が選択集合に応じて強調されること
- tests/gizmo.test.mjs
    - 複数選択時に active bone 基準の delta rotation が全選択ボーンへ適用されること
    - 複数選択時に gizmo 位置が選択ボーン平均になること
    - 複数選択時の平行移動が回転と同様に差分更新されること
    - world/local 両モードで差分回転が保存されること
- tests/timeline-manager 既存または新規
    - 複数選択時の key 登録で全ボーンへ keyframe が追加されること
- tests/renderer または UI ハーネス
    - active なし複数選択時にボーン情報は空表示だが input 変更で全ボーンへ反映されること

## Assumptions

- ボックス選択は bone center 投影で判定し、ボーン線分全体は対象にしない。
- ボックス選択結果が複数件のときは active bone を持たない。1 件だけのときはそのボーンを active にする。
- 複数選択の v1 では「回転」「平行移動」「キー登録」「数値入力」を主対象とする。
- 既存 selectedBoneIndex 参照は段階的に activeBoneIndex へ寄せる。初回実装では互換目的で mirror を維持する。
