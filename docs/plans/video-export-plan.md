# 動画書き出し機能追加計画

## Summary

- WebCodecs VideoEncoder を実利用する書き出し機能を追加し、Mediabunny で mp4 / webm / mov / mkv を mux してダウ
ンロードできるようにする。
- UI に「動画設定」タブを追加し、コーデック選択、出力幅・高さ、出力フォーマット、書き出し開始を提供する。
- 書き出し中は全画面オーバーレイで UI をロックし、進捗とキャンセルを表示する。
- 書き出しは現状の再生範囲を使い、通常の requestAnimationFrame ループとは分離した固定 fps・固定解像度の専用オフ
スクリーン経路で行う。
- 書き出し映像はクリーン映像に固定し、ボーン/物理/デバッグ系の補助表示は含めない。

## Key Changes

- source/video-export-manager.js を新設する。
    - 役割は export state 管理、利用可能コーデック列挙、コンテナ互換判定、Mediabunny Output 構築、進捗通知、キャ
    ンセル、Blob ダウンロード。
    - getAvailableVideoCodecs({ width, height, format }) を持たせ、Mediabunny の getEncodableVideoCodecs とコン
    テナ別対応表の両方でフィルタする。
    - 既定値は codec: 'avc'、format: 'mp4'。
    - 音声は今回は出力しないが、内部 API は将来 audioTrack を追加できる形にしておく。
- レンダリングを共有化する。
    - source/render-loop.js から 1 フレーム描画処理を切り出し、通常ループと動画書き出しの両方が同じ描画関数を使
    える構造にする。
    - 新しい共有描画 API は「render target / canvas targets / presentation view / export flags」を受け取り、
    present 先を swapchain に固定しない。
    - 書き出し用は OffscreenCanvas または export 専用 canvas target を使い、通常画面のサイズや一時的な UI 状態変
    更に引きずられないようにする。
- フレーム生成方式を固定ステップ化する。
    - 書き出し時はアクティブインスタンスの AnimationController を再生状態に依存させず、再生範囲 start..end をフ
    レーム列へ変換して逐次 seek() する。
    - 再生 fps は既存の rendererState.renderingFPS を採用し、frameDuration = 1 / renderingFPS 秒で
    CanvasSource.add(timestamp, duration) を流す。
    - 書き出し開始前に元のフレーム、再生中フラグ、選択/表示の一時 state を保存し、完了/キャンセル時に必ず復元す
    - export 用 render target に COPY_SRC 可能な color texture を持たせ、copyTextureToBuffer で RGBA を取得す
    る。
    - 読み出したピクセルを OffscreenCanvas の 2D context へ ImageData として転送し、その canvas を Mediabunny
    CanvasSource に渡す。
    - まずは互換性優先で CPU readback 経由に寄せ、後でゼロコピー最適化できるよう構造を分ける。
- UI を拡張する。
    - index.html に Morph の左へ 動画設定 タブを追加し、format、codec、width、height、export ボタン、説明メッ
    セージ領域を置く。
    - 初期 width/height は Rendering の internal resolution 設定を基準に解決する。auto の場合は現在 canvas 解像
    度を採用する。
    - フォーマット変更時は非対応コーデックを disabled にし、利用可能な既定値へ自動再選択する。
    - 全画面オーバーレイ要素を index.html に追加し、進捗バー、進捗テキスト、キャンセルボタンを持たせる。
- source/renderer-ui.js と source/renderer.js を拡張する。
    - 動画設定値の DOM 読み取り、UI 初期化、コーデック一覧同期、書き出しボタン/キャンセルボタン接続を追加する。
    - refreshScene とは別に export 用の deterministic render 呼び出しを video-export-manager へ注入する。
    - window.vmdManager.download() と同じく Blob ダウンロードはアンカー方式で統一する。
- i18n を追加する。
    - source/langs/ja.json と source/langs/en.json に動画設定、コーデック、フォーマット、書き出し中、キャンセ
    ル、失敗などの文言を追加する。

## Public APIs / Interfaces

- 新規 export state 例:
    - format: 'mp4' | 'webm' | 'mov' | 'mkv'
    - codec: 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8'
    - width: number
    - height: number
    - status: 'idle' | 'probing' | 'exporting' | 'cancelling'
    - progress: number
    - cancelRequested: boolean
- 新規 manager API 例:
    - probeAvailableCodecs(options): Promise<VideoCodec[]>
    - exportVideo(options): Promise<{ blob: Blob, filename: string, mimeType: string }>
    - cancel(): void
- 互換判定は実装内で固定表を持つ。
    - mp4 / mov: avc, hevc, av1
    - webm: vp8, vp9, av1
    - mkv: 上記全対応を許可
    - 実際の表示候補はこの表と getEncodableVideoCodecs の積集合にする
- 新規共有描画 API は通常描画と export 描画の双方から呼べる純粋な 1 フレーム描画関数にする。描画結果を swapchain
に出すか export texture に出すかは引数で切り替える。

## Test Plan

- 単体テスト
    - フォーマットごとのコーデック互換フィルタが期待どおりに候補を絞る。
    - internal resolution から初期 width/height を解決するロジック。
    - export 対象フレーム列が playback range と rendering FPS に従って生成される。
    - キャンセル要求で export loop が停止し、state が idle に戻る。
- UI テスト
    - 動画設定タブ表示、既定値反映、フォーマット変更時の codec disabled 制御。
    - 書き出しボタン押下でオーバーレイ表示、完了/キャンセルで非表示。
- 統合テスト
    - VideoEncoder と Mediabunny をモックし、指定フレーム数分 CanvasSource.add() が呼ばれることを検証。
    - 進捗が 0 → 1 に単調増加し、完了時に download が走ることを検証。
- 手動確認
    - mp4 + avc の成功。
    - webm + vp9 または vp8 の成功。
    - 非対応組み合わせが選択不可になること。
    - 書き出し中に UI がロックされ、キャンセルで復帰すること。
    - ボーン/物理/デバッグ表示が動画に入らないこと。
    - 書き出し後に元の再生位置と通常 UI 操作が復元されること。

## Assumptions

- 今回の v1 は映像のみで、音声トラックは出力しない。
- 初期解像度は Rendering の internal resolution 設定を基準にし、auto は現在 canvas 実寸へフォールバックする。
- 書き出し fps は新設せず、既存 Rendering の renderingFPS をそのまま使用する。
- 出力ファイル名は openmmd-export.<ext> を既定とし、必要なら後続で命名改善する。
- 書き出し中はアクティブモデルの現在再生範囲のみを対象にし、複数モデルの個別 range 差分は考慮しない。
- クリーン映像固定のため、export 時に補助表示系 state を一時無効化し、完了後に必ず復元する。
- VideoEncoder 非対応ブラウザでは書き出し開始前に明示エラーを表示し、ボタンは disabled 可能なら disabled にす
る。