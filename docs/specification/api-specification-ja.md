# OpenMMD Local API 仕様

## Summary

OpenMMD はローカルの `Express` サーバーで動作させると API が使える。`/` が本体で、`POST /api/command` のようなアクセスもできる。さらに viewer が最新の状態スナップショットをサーバーへ送るため、GET でモデル一覧やボーン姿勢を取得できる。viewer は `/api/events` を購読してコマンドを受け取り、実行結果を `/api/command-result` に返す。

## Viewer 内部 API

UI 設定 JSON の save/load は現時点では viewer 内部 API のみで公開している。application command / facade 層から次を使える。

- `commands.buildUiSettingsData()`
- `commands.applyUiSettingsData(data)`
- `commands.loadUiSettingsFile(file)`
- `appFacade.system.buildUiSettingsData()`
- `appFacade.system.applyUiSettingsData(data)`
- `appFacade.assets.loadUiSettingsFile(file)`

これらは `docs/specification/openmmd-json.md` で定義したネスト構造の UI JSON を扱う。UI 設定専用の HTTP command はまだ追加していない。

## URLs

- `/` - OpenMMD ビューアー
- `/api/command` - JSON コマンドの投入エンドポイント
- `/api/command-result` - viewer が返すコマンド応答エンドポイント
- `/api/events` - viewer が使う、サーバー送信イベントストリーム
- `/api/models` - ロード済みモデル一覧のスナップショット
- `/api/active-model-name` - 現在アクティブなモデル名のスナップショット
- `/api/models/:modelName/bones` - 指定モデルのボーン変換
- `/api/runtime-state` - viewer ブリッジが使う状態スナップショット同期エンドポイント

## 回転規約

- ボーンとカメラの Euler 回転は標準の `X -> Y -> Z` 順。
- 物理の剛体とジョイントの Euler 回転は `Y -> X -> Z` 順。

## HTTP API

### `POST /api/command`

コマンドをローカル API バスに送信し、接続中の viewer の実行結果を待つ。

リクエスト本体:

```json
{
  "id": "optional-command-id",
  "command": "toggle-playback",
  "payload": {}
}
```

返信:

```json
{
  "ok": true,
  "id": "cmd-...",
  "result": {
    "isPlaying": false
  }
}
```

viewer がコマンド実行に失敗した場合は `ok: false` とともに HTTP ステータス `422` を返す。viewer が接続されていない場合は `503`、時間内に応答しない場合は `504` を返す。

バイナリ出力は result 側でシリアライズする。`export-video` では `blob` を次の形で返す:

```json
{
  "filename": "openmmd-export.webm",
  "mimeType": "video/webm",
  "blob": {
    "fileName": "openmmd-export.webm",
    "fileType": "video/webm",
    "fileData": "base64-encoded-bytes"
  }
}
```

サポートされているコマンドリスト:

- `ping`
- `load-zip`
- `load-vmd`
- `unload-model`
- `toggle-playback`
- `play`
- `pause`
- `rewind`
- `go-to-end`
- `seek-frame`
- `step-frame`
- `step-keyframe`
- `set-playback-range`
- `assign-vmd`
- `export-video`
- `set-bone-params`
- `load-environment-hdr`
- `set-environment-hdr-intensity`
- `reset-physics`
- `enter-fullscreen`
- `exit-fullscreen`
- `select-model`
- `get-state`

### `GET /api/events`

viewer が購読するイベントストリーム。

- `ready`: ストリーム開始時に送信される
- `command`: `/api/command` にコマンドがポストされたときに送信される

viewer はこのストリームを監視し、受け取ったコマンドをローカルで実行したあと、`/api/command-result` に結果を返す。

### `POST /api/command-result`

viewer がコマンド実行結果を送るエンドポイント。

リクエスト本体:

```json
{
  "namespace": "openmmd-api",
  "type": "response",
  "id": "cmd-...",
  "ok": true,
  "result": {}
}
```

`id` が未完了コマンドと一致する場合は `200`、既にタイムアウトしたか未発行の場合は `404` を返す。

### `POST /api/runtime-state`

viewer から送られてきた最新スナップショットを保存し、GET API の返却元にする。

リクエスト本体:

```json
{
  "timestamp": 1712345678901,
  "activeInstanceIndex": 0,
  "activeModelName": "Alicia",
  "activeVmdName": "",
  "modelNames": ["Alicia"],
  "vmdNames": [],
  "models": [],
  "postEffects": {
    "bloomEnabled": true,
    "dofEnabled": false,
    "enabled": true
  },
  "environmentHdrPath": "test-data/sundowner_deck_1k.hdr",
  "environmentHdrName": "sundowner_deck_1k.hdr",
  "environmentHdrIntensity": 1,
  "environmentHdrLoaded": true
}
```

`postEffects.bloomEnabled` と `postEffects.dofEnabled` が正規の個別フラグで、`enabled` は後方互換のための派生値。
`postEffects.ambientOcclusionEnabled` と関連パラメータは screen-space Ambient Occlusion の制御に使う。Ambient Occlusion は prepass depth / normal から mask を生成し、可視フラグメントにだけ main shading で適用する。
`postEffects.contactShadowEnabled` と関連パラメータは screen-space Contact Shadow の制御に使う。Contact Shadow は prepass depth / normal から mask を生成し、可視フラグメントにだけ main shading で適用する。
`environmentHdrPath` は HDR ソースのパス、`environmentHdrName` は UI 表示名、`environmentHdrIntensity` は HDR の明るさ、`environmentHdrLoaded` は実ファイルの読み込み成否を表す。

返信:

```json
{
  "ok": true
}
```

### `GET /api/models`

最新の viewer スナップショットからロード済みモデル一覧を返す。

返信:

```json
{
  "ok": true,
  "modelNames": ["Alicia"],
  "models": [
    {
      "instanceIndex": 0,
      "modelName": "Alicia",
      "vmdName": "",
      "boneCount": 123,
      "isActive": true
    }
  ]
}
```

### `GET /api/active-model-name`

最新の viewer スナップショットから、現在アクティブなモデル名を返す。

返信:

```json
{
  "ok": true,
  "activeInstanceIndex": 0,
  "activeModelName": "Alicia"
}
```

### `GET /api/models/:modelName/bones`

指定したモデル名のすべてのボーンを返す。

`modelName` は URL エンコードした文字列を使い、完全一致した最初のモデルを返す。

返信:

```json
{
  "ok": true,
  "instanceIndex": 0,
  "modelName": "Alicia",
  "boneCount": 2,
  "bones": [
    {
      "index": 0,
      "name": "Root",
      "local": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0, 1]
      },
      "world": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0, 1]
      }
    }
  ]
}
```

`local` はアニメーションと manual 調整後のローカル姿勢、`world` はワールド座標系の姿勢を返す。

## Legacy Viewer `postMessage` API

ビューアは同じオリジンからのメッセージのみを受け入れる。

メッセージフォーマット:

```json
{
  "namespace": "openmmd-api",
  "type": "command",
  "id": "optional-request-id",
  "command": "seek-frame",
  "payload": {
    "frame": 120
  }
}
```

ビューアの返信:

```json
{
  "namespace": "openmmd-api",
  "type": "response",
  "id": "same-id-as-request",
  "ok": true,
  "result": {}
}
```

### ファイルペイロードのルール

`load-zip` および `load-vmd` の場合、コマンドのペイロードには以下のいずれかを含められる。

- 同じオリジンにある別のウィンドウから送信された実際の `File` オブジェクトとしての `payload.file`、または
- `payload.fileName`、`payload.fileType`、および `payload.fileData`（ここで `fileData` は base64 エンコードされたテキスト）。

ビューアはペイロードを `File` オブジェクトに変換し、既存のロードヘルパーを呼び出す。

### `set-bone-params`

アクティブなモデル、または指定したモデルに対して、1つ以上のボーンパラメータを更新する。

リクエスト本体:

```json
{
  "command": "set-bone-params",
  "payload": {
    "modelName": "Alicia",
    "targets": [
      {
        "boneName": "LeftArm",
        "space": "local",
        "kind": "rotationQuaternion",
        "value": [0, 0, 0, 1]
      },
      {
        "boneName": "Center",
        "space": "world",
        "kind": "position",
        "value": [1.0, 0.0, 0.0]
      },
      {
        "boneName": "RightHand",
        "space": "local",
        "kind": "rotationEuler",
        "value": [0, 90, 0]
      }
    ]
  }
}
```

ルール:

- `modelName` は省略可。省略した場合はアクティブなモデルを使う。
- `targets` は必須の配列で、各要素が 1 つのボーンに対応する。
- `space` は `local` または `world`。
- `kind` は `position`、`rotationEuler`、`rotationQuaternion` のいずれか。
- `rotationEuler` は degree を使う。
- `position` は 3 要素配列 `[x, y, z]`。
- `rotationEuler` は 3 要素配列 `[x, y, z]`。
- `rotationQuaternion` は 4 要素配列 `[x, y, z, w]`。

## コマンドの動作

- `load-zip`: ZIP形式のモデルアーカイブを読み込み、含まれるVMDファイルを自動で読み込む
- `load-vmd`: 単一のVMDファイルを読み込む
- `unload-model`: 現在アクティブなモデルを削除する
- `toggle-playback`: 現在のアニメーション状態を切り替える
- `play` / `pause`: 再生を開始または停止する
- `rewind` / `go-to-end`: 再生範囲の先頭または末尾にジャンプする
- `seek-frame`: 共有グローバルタイムラインを特定のフレームに移動する
- `step-frame` / `step-keyframe`: フレーム単位またはキーフレーム単位で移動する
- `set-playback-range`: すべてのロード済みモデルに適用される共有グローバル再生範囲を更新する
- `assign-vmd`: 読み込まれたVMDをアクティブなモデルにバインドする
- `export-video`: 設定されたビデオエクスポーターを実行し、結果を返す。`includeAudio` を `true` にすると、読み込まれている BGM が利用可能な場合に音声を含める。`transparentBackground` を `true` にすると、`webm` または `mkv` では背景 alpha を保持して書き出す。非対応形式ではこの指定は無視される。
- `set-bone-params`: モデルのボーンパラメータを 1 つ以上更新する
- `reset-physics`: 剛体状態をリセットする
- `enter-fullscreen` / `exit-fullscreen`: アプリのフルスクリーンモードを切り替える
- `select-model`: アクティブなモデルインスタンスを切り替える
- `get-state`: 現在のビューアの状態のスナップショットを返す。`currentFrame`、`isPlaying`、`playbackRange` は共有グローバルタイムラインを表し、`activeModelName` は編集対象モデルを表す。

## 前提条件

- ビューアとローカル API サーバーは、同じオリジンおよび同じローカルポート上で実行される
- サーバーブリッジが主経路で、`postMessage` は legacy / internal 用にのみ残す
- 簡素化のため、大きなバイナリ出力は JSON 内の base64 形式で送信される
