## BGM Playback And Export Plan

### Summary

- 動画タブの BGM セクションを実装し、BGM ファイルのアップロード、音量調整、ループ設定、動画書き出し時の音声出力有無を管理する。
- live 再生と動画書き出しで責務を分けるため、BGM 管理を source/bgm-manager.js に切り出す前提で進める。
- BGM はビューア全体の単一 state とし、モデルごと・VMD ごとの設定保存は行わない。

### Key Changes

- UI
    - 動画タブの BGM ラベルに id と data-i18n を付け、ja/en の文言を追加する。
    - BGM セクションにクリック + drag & drop 対応のアップロード領域、隠し input[type=file]、選択中ファイル名表示、音量スライダー、ループ再生チェックボックスを追加する。
    - 動画書き出しセクションに「音声を出力」チェックボックスを追加する。BGM 未ロード時は disabled、BGM ロード時は checked を既定値にする。
    - BGM を入れ替える操作は再アップロードで対応し、v1 では専用の削除ボタンは作らない。
- BGM 入力と再生管理
    - source/bgm-manager.js を追加し、File、object URL、HTMLAudioElement、decode 済み AudioBuffer、volume、loop 設定を一元管理する。
    - 対応ファイルは「ブラウザが標準再生できるもの」のみとし、選択時に audio.canPlayType(file.type) を使って maybe/probably の MIME だけ受け付ける。file.type が空、または canPlayType が空文字なら拒否する。
    - live 再生の時間基準は VMD の 30fps を使い、(currentFrame - playbackRangeStart) / 30 秒を BGM の再生位置に変換する。
    - renderer.js 側の毎フレーム更新で、アクティブ AnimationController の isPlaying/currentFrame/playbackRange を BgmManager に同期する。
    - 再生中は audio を追従再生し、停止中は必ず pause する。seek、rewind、再生範囲変更、アクティブモデル変更時も currentTime を再計算する。
    - ループチェックが off のときは BGM 末尾で音だけ止め、その後のアニメ再生は無音で継続する。on のときは BGM だけループする。
    - audio.play() がブラウザ制約で失敗してもアニメ再生は継続し、BGM セクションの状態表示だけ更新する。
- 動画書き出し
    - VideoExportManager.exportVideo() の options に includeAudio を追加する。
    - 書き出し時に includeAudio && BGM loaded の場合だけ、BGM の decode 済み AudioBuffer から export 用バッファを生成して audio track を追加する。
    - export 用バッファは再生範囲秒数に合わせて構成する。開始位置は startFrame / 30、終了位置は endFrame / 30 を使う。
    - BGM が長い場合は範囲長に合わせて trim、短い場合は loop off なら末尾以降を無音で埋め、loop on なら範囲長まで繰り返す。
    - 音量スライダー値は live 再生の audio.volume と export 用バッファの gain の両方に反映する。
    - 音声 codec はコンテナ互換 + ブラウザ encode 可否で決める。getEncodableAudioCodecs() と format の supported audio codecs の積集合から選び、優先順位は mp4/mov: aac、webm: opus、mkv: opus > aac > mp3 >
    vorbis > flac とする。
    - source/video-export-manager.js は audio track を追加できるように Mediabunny の audio source を import し、video-only の current flow は includeAudio=false でそのまま維持する。
    - API を増やすので docs/specification/api-specification.md と docs/specification/api-specification-ja.md に export-video の includeAudio を追記する。
    - get-state の viewer snapshot に BGM 状態は追加しない。

### Test Plan

- BGM validator
    - canPlayType が probably/maybe の MIME は受理し、空 MIME と unsupported MIME は拒否される。
- Playback sync
    - frame/range から currentTime への変換が 30fps 基準で正しい。
    - play、pause、seek、rewind、range change、active model change で audio state が期待通り更新される。
    - loop off では BGM 末尾後に pause、loop on では再開位置が巻き戻る。
- Export audio composition
    - trim、silence pad、loop fill、volume gain が期待通りの長さと波形になる。
    - includeAudio=false で audio track が付かない。
    - includeAudio=true かつ BGM ありで audio track が付く。
    - format ごとの audio codec resolver が互換のある codec を選ぶ。
- UI
    - BGM 未ロード時は export audio checkbox が disabled。
    - BGM ロード後に checkbox が有効化され、既定値が checked。
    - i18n key が動画タブ BGM ラベルと新規 controls に適用される。

### Assumptions

- BGM はグローバル state で、モデルや VMD には紐付けない。
- ループ再生チェックボックスは追加し、既定値は unchecked。
- 音量スライダーは 0.0..1.0、step 0.01、既定値 1.0。
- export audio checkbox は BGM ロード済みなら既定値 checked、未ロードなら disabled + unchecked。
- v1 では BGM メタデータ表示、波形表示、複数曲管理、API からの BGM アップロード/切替は扱わない。