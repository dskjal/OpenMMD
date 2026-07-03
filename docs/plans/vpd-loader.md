# VPD ローダーと姿勢適用の追加

## Summary

source/loader/vpd-loader.js に Shift-JIS の VPD パーサーを追加し、.vpd をモデル姿勢として読み込めるようにしま
す。
VPD は VMDManager に保存するのではなく、読み込み後に対象モデルへ即時適用します。

## Key Changes

- VPDLoader を新規追加し、test-data/test.vpd を parse できるようにします。
- 仕様書とサンプルの不一致に備え、ヘッダ後の modelName / boneCount の並びは両方受け入れるようにします。
- 位置は Z-flip、回転クォータニオンは X/Y flip して右手系へ変換します。
- 既存の load-vmd 系フローを拡張し、.vpd を受け取ったらモデル姿勢として適用します。
- ZIP/folder ロード時は .vpd を同梱物として収集し、モデル読み込み後に自動適用します。
- 単体ファイルの VPD は、モデル名一致を優先し、未一致時はアクティブモデルへの適用確認を出します。
- control.html と index.html のファイル選択 accept に .vpd を追加します。
- source/file-loading.js に ZIP 内 VPD 収集ヘルパーを追加するか、同等の共通処理を切り出します。

## Test Plan

- tests/vpd-loader.test.mjs を追加し、test-data/test.vpd の以下を検証します。
- signature が正しいこと。
- modelName が正しく復号できること。
- ボーン数とボーン名が読めること。
- 位置の Z-flip と回転の X/Y flip が適用されていること。
- ZIP 同梱 VPD がモデル読み込み後に自動適用されること。
- 単体 VPD がモデル名一致時に対象モデルへ適用されること。
- モデル名不一致時にアクティブモデルへの適用確認が動くこと。
- 既存の VMD 読み込みとタイムライン挙動が壊れていないこと。

## Assumptions

- VPD は pose データとして扱い、VMDManager には保存しません。
- window.confirm を既存の不一致確認と同様に使います。
- VPD の適用先は、model.name の一致を最優先にし、必要なら basename も照合します。
- 既存 API の新設はしないため、API 仕様書の更新は不要です。