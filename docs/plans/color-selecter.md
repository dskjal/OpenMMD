# 汎用色選択 UI と光源色導入

UI 上の見え方は `docs/plans/color-selecter-on-ui.jpg` 、 ポップアップは `docs/plans/color-selecter.jpg` を参照。

## Summary
色領域クリックでポップアップを開く。
- 初回の実接続先は 光源色 にする。Render 系設定へ Light Color 行を追加し、選択結果を renderer の照明計算へ反映す
る。
- 内部表現は linear RGBA を正とし、UI 上で Linear / Perceptual と RGB / HSV を切り替えられるようにする。

## Key Changes

- index.html
    - 色入力 1 行の共通マークアップ用スタイルを追加する。
    - ポップアップ本体の DOM とスタイルを追加する。
    - 既存の Render 設定に Light Color 行を追加する。見た目は提示画像どおり、左ラベル・中央スウォッチ・右数値欄
    の 1 行にする。
- source/renderer-ui.js
    - 汎用色ピッカー管理を追加する。
    - 必要機能:
        - スウォッチ押下でポップアップ開閉
        - hue/saturation/value 操作
        - value スライダー
        - alpha 入力
        - hex 入力
        - Linear / Perceptual 切替
        - RGB / HSV 数値表示切替
        - outside click / Escape / フォーカス復帰
    - コンポーネント API は「対象 state オブジェクトの RGBA 配列を双方向同期し、変更時に onChanged() を呼ぶ」形
    にする。
    - 変換処理は UI 層に閉じ込め、renderer 側には常に linear RGBA を渡す。
- source/renderer.js と必要な GPU/Shader 側
    - rendererState に lightColor: [1, 1, 1, 1] を追加する。
    - 光源色を global uniform に載せる。現状 lightingParams が方向ベクトル専用なので、既存レイアウトを壊さない形
    で色用スロットを追加する。
    - forward shading と post effect 内で参照する光色があれば同じ state から読む。
    - shader 側は光強度計算に lightColor.rgb を乗算する。alpha は UI 一貫性のため保持するが、初回は照明計算には
    使わない。
- i18n / docs
    - source/langs/ja.json, source/langs/en.json に Light Color, Hue, Saturation, Value, Alpha, Hex, Perceptual
    など未定義キーを追加する。
    - API 追加は行わないので docs/specification/api-specification*.md は更新不要。

## Test Plan

- UI/状態同期
    - スウォッチ表示色が state の linear RGBA と一致すること
    - Perceptual 表示で編集しても内部 state は linear RGBA に正規化されること
    - RGB と HSV の切替後も同じ色が保持されること
    - Hex 入力、数値入力、色面ドラッグ、value スライダー操作が相互同期すること
    - outside click / Escape でポップアップが閉じ、再オープン時に前回値が保持されること
- Render 反映
    - rendererState.lightColor 変更で uniform が更新されること
    - neutral white では既存見た目と一致すること
    - 有色光に変えたとき、材質の拡散反射と影付き領域の見え方が破綻しないこと
- 自動テスト
    - tests/ に色変換ユーティリティの単体テストを追加する
    - 可能なら renderer-ui.js の DOM ベーステストを追加し、Hex/RGB/HSV/Linear-Perceptual の同期を検証する
    - shader/uniform 変更は既存 render helper 系テストへの影響を確認する

## Assumptions

- 今回は汎用色ピッカー本体と Light Color の 1 箇所導入までを実装対象にする。Diffuse / emission / SSS Color など
への横展開はこの部品を再利用して次段で行う。
- Perceptual は UI 表示モードとして扱い、保存値や renderer state は常に linear RGBA に統一する。
- 画像参照のフル機能は UI として再現するが、初回実装では eyedropper 連携は必須にしない。Hex 横のスポイト風ボタン
は未接続または EyeDropper API 対応ブラウザのみ有効化でよい。
- 既存の固定 light direction は維持し、今回は light color のみ追加する。