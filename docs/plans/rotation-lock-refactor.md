## 回転ロックの XYZ 独立化

### Summary

- 「回転ロック」は 1 つの状態ではなく、X / Y / Z 各軸ごとに独立した lock / unlock を持つ仕様へ変更する。
- ボーン名からの初期解決は維持しつつ、優先軸 1 本だけを残すのではなく、軸ごとのロック状態として初期化する。
- 影響範囲は bone info と gizmo を中心にし、ショートカットパネルの旧 checkbox は削除する。

### Implementation Changes

- model-scene 側で、ボーン名から初期ロックを決める helper を軸単位にする。
    - 例: ひじは Y unlocked / XZ locked、ひざ・つま先は X unlocked / YZ locked、指は既存ルールに従い軸ごとに解決
    する。
    - 優先回転軸がないボーンは X/Y/Z すべて unlocked。
- model の runtime metadata として bone.rotationLocks = { x, y, z } を保持する。
- gizmo は bone.rotationLocks を直接参照し、ロック済み軸の rotation ring を描画・pick しない。
    - 複数選択時は、選択集合の共通 unlocked 軸だけを表示する。
    - ワールド座標モードでもロック状態は維持する。
- bone info UI は回転ヘッダー左に「ロック状態表示 + 軸別切替」を追加する。
    - X/Y/Z それぞれに lock/unlock アイコンを持たせる。
    - 各軸は独立に切り替え可能にする。
    - 表示は現在状態を反映し、未選択や複数選択の扱いは従来どおり disabled を基本にする。
- ショートカットパネルの「優先回転軸のみ表示」checkbox は削除する。
- 回転入力の編集経路は、ロック軸を維持してアンロック軸のみ反映するようにする。
    - 数値入力
    - paste / flip paste
    - gizmo drag
    - いずれも軸ロックを破らない

### Public APIs / Data Shape

- model.bones[i].rotationLocks
    - { x: boolean, y: boolean, z: boolean }
- gizmo 側は「回転可否」と「利用可能な回転軸」を分離して扱う。
- 旧 preferPrimaryRotationAxisOnly の selection state は削除する。

### Test Plan

- gizmo テスト
    - X/Y/Z 各軸が独立に lock/unlock されること
    - ロック軸は描画・pick されないこと
    - 複数選択時に共通 unlocked 軸だけが残ること
- bone info UI テスト
    - 回転ヘッダー左に軸別 lock UI が存在すること
    - 旧 checkbox が消えていること
- model-scene テスト
    - 代表的なボーン名で rotationLocks 初期値が期待どおりになること
- renderer 系テスト
    - 軸ロック状態で入力・paste・gizmo がロック軸を壊さないこと

### Assumptions

- ロック UI は「3 軸独立トグル」を前提にする。
- 今回は bone info と gizmo を主対象にし、他の回転補正ロジックは別扱いにする。
- ロック状態は runtime state として保持し、保存仕様は追加しない。

## 回転ロック化への置換計画

### Summary

- 既存の「優先回転軸のみ表示」機能を廃止し、ボーンごとの「回転ロック」へ置き換える。
- 名前ベースの優先軸判定は UI 設定ではなくモデルロード時の初期ロック解決に使う。
- ボーン情報タブでは、回転ヘッダーのキー打ちアイコン左にロック/アンロックアイコンを追加し、単一アクティブボーン
のロック状態を表示しつつクリックで切り替え可能にする。
- 今回の適用範囲は bone info と gizmo。タイムライン登録条件と既存の回転補正は変更しない。

### Implementation Changes

- 回転軸制御の責務を source/gizmo.js から切り出し、名前判定とロック状態を扱う共通 helper を新設する。
    - 例: resolvePreferredRotationAxisFromBoneName(boneName) を共通化。
    - 各 bone に rotationLocks を持たせる。形は { x: boolean, y: boolean, z: boolean } で統一。
    - モデルロード完了時に初期化する。優先軸が x/y/z の場合はその軸だけ false、他 2 軸を true。優先軸なしは全て
    false。
- source/model-scene.js かロード正規化経路で、名前ベースの初期ロック解決を追加する。
    - 既存のローカル軸補完とは別責務にし、後続処理が bone.rotationLocks を前提にできる状態で model を返す。
- source/gizmo.js は selection.preferPrimaryRotationAxisOnly 依存を削除し、bone のロック状態を直接参照する。
    - getAllowedRotationAxes() は selection ではなく bone または bone 群のロック状態から算出する。
    - 単一選択ではその bone のアンロック軸のみ回転リング表示・pick 可能にする。
    - 複数選択では選択集合の共通アンロック軸の積集合のみ表示・pick 可能にする。
    - ワールド座標でもロックは無効化しない。ワールド編集時も「回せる軸」はロック状態に従う。
- source/renderer.js と index.html で bone info UI を更新する。
    - ショートカットパネルの preferPrimaryRotationAxisOnly checkbox と selection state を削除。
    - 回転ヘッダーの key ボタン左に lock ボタンを追加し、指定 SVG を使う。
    - 単一アクティブボーン時のみ lock ボタンを有効化し、状態に応じて lock/unlock icon を切り替える。
    - active bone がない複数選択時は lock ボタンを disabled にする。
    - 回転入力欄は軸単位で disabled 制御できるようにし、ロック軸の row icon も disabled 表示にする。
- bone info 由来の回転変更経路をロック準拠に統一する。
    - 数値入力、回転 paste、flip paste、gizmo drag はロック軸を変更しない。
    - 実装は「現在の表示 Euler」と「要求 Euler/Quaternion」から、ロック軸は現在値を保持、アンロック軸だけ差し替
    えて最終回転を組み直す helper に寄せる。
    - reset rotation は全軸を初期値へ戻してよい。ロック状態自体は変えない。
- 翻訳と軽量 UI テストを更新する。
    - Prefer Primary Rotation Axis Only 文言は削除。
    - lock ボタンの title/aria-label 用の文言を追加する。

### Public Interfaces / Data Shape

- model.bones[i] に runtime メタデータ rotationLocks: {x,y,z} を追加する。
- 既存の selection.preferPrimaryRotationAxisOnlyElement と selection.preferPrimaryRotationAxisOnly は削除する。
- gizmo 側の公開 helper は「回転可否」と「アンロック軸」を分けて扱う形に整理する。
    - getBoneGizmoModes() は従来どおり平行移動/回転の大分類だけ残す。
    - 回転軸一覧は別 helper で返す。

### Test Plan

- tests/gizmo.test.mjs
    - 初期ロック済み bone でアンロック軸のみリングが出る。
    - ロック軸は pick できず、アンロック軸は pick/drag できる。
    - 複数選択時に共通アンロック軸のみ表示される。
    - ワールド座標でもロックが維持される。
- tests/button-sizing.test.mjs
    - bone rotation header に lock icon button が key button の左に存在する。
    - shortcut panel から preferPrimaryRotationAxisOnly checkbox が消えている。
- renderer 系テスト
    - 単一アクティブボーンで lock button が状態同期される。
    - active なし複数選択では lock button が disabled。
    - ロック軸の rotation input が disabled。
    - paste/flip paste がロック軸を変えない。
- モデルロード経路のテストを追加
    - ひじ、膝、指、つま先、優先軸なし bone で rotationLocks 初期値が期待どおりになる。

### Assumptions

- ロックアイコンは表示専用ではなく、クリックでそのボーンのロック状態を切り替える。
- 今回の範囲は bone info + gizmo。タイムラインの回転 key 登録条件と既存の回転補正ロジックは現状維持。
- 複数選択時の回転 gizmo は、安全側で「全選択 bone に共通してアンロックな軸」だけを出す。
- ロック状態は runtime state とし、VMD/VPD/外部 API/JSON への保存仕様は今回追加しない。
