# OpenMMD Local API Specification

## Summary

OpenMMD can be run behind a local `Express` server. The server exposes the viewer at `/`, accepts commands through `POST /api/command`, and publishes the latest viewer snapshot through GET endpoints. The viewer bridge keeps that snapshot fresh by posting runtime state to the server and consumes commands from `/api/events`.

## Internal Viewer API

UI settings JSON save/load is currently exposed only as an internal viewer API. The application command/facade layer provides:

- `commands.buildUiSettingsData()`
- `commands.applyUiSettingsData(data)`
- `commands.loadUiSettingsFile(file)`
- `appFacade.system.buildUiSettingsData()`
- `appFacade.system.applyUiSettingsData(data)`
- `appFacade.assets.loadUiSettingsFile(file)`

These APIs serialize the nested UI JSON schema described in `docs/specification/openmmd-json.md`. There is no dedicated HTTP command for UI settings yet.

## URLs

- `/` - OpenMMD viewer
- `/api/command` - JSON command ingestion endpoint
- `/api/command-result` - Viewer command response callback endpoint
- `/api/events` - Server-sent event stream used by the viewer bridge
- `/api/models` - Loaded model list snapshot
- `/api/active-model-name` - Active model name snapshot
- `/api/models/:modelName/bones` - Bone transforms for a named model
- `/api/runtime-state` - Runtime state snapshot sync endpoint used by the viewer bridge

## Rotation Conventions

- Bone and camera Euler rotations use the standard `X -> Y -> Z` order.
- Physics rigid-body and joint Euler rotations use `Y -> X -> Z` order.

## HTTP API

### `POST /api/command`

Submits a command to the local API bus and waits for the connected viewer to execute it.

Request body:

```json
{
  "id": "optional-command-id",
  "command": "toggle-playback",
  "payload": {}
}
```

Response:

```json
{
  "ok": true,
  "id": "cmd-...",
  "result": {
    "isPlaying": false
  }
}
```

If the viewer reports a command failure, the server returns `ok: false` with HTTP status `422`. If no viewer is connected, the server returns `503`. If the viewer does not answer in time, the server returns `504`.

Binary outputs are serialized in the result payload. For `export-video`, the `blob` field is returned as:

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

Supported commands:

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

Server-sent event stream consumed by the viewer bridge.

- `ready`: emitted when the stream opens
- `command`: emitted when a command is posted to `/api/command`

The viewer listens to this stream, executes the command locally, and posts the result back to `/api/command-result`.

### `POST /api/command-result`

The viewer posts a command execution response here.

Request body:

```json
{
  "namespace": "openmmd-api",
  "type": "response",
  "id": "cmd-...",
  "ok": true,
  "result": {}
}
```

Responses are accepted with `200` when the `id` matches a pending command, and `404` when the command has already timed out or was never issued.

### `POST /api/runtime-state`

Stores the latest viewer snapshot for the GET endpoints.

Request body:

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

`postEffects.bloomEnabled` と `postEffects.dofEnabled` が正規の個別フラグで、`enabled` は後方互換のための派生値です。
`postEffects.ambientOcclusionEnabled` と関連パラメータは screen-space Ambient Occlusion を制御します。Ambient Occlusion は prepass depth / normal から mask を生成し、main shading で可視フラグメントにだけ適用されます。
`postEffects.contactShadowEnabled` と関連パラメータは screen-space Contact Shadow を制御します。Contact Shadow は prepass depth / normal から mask を生成し、main shading で可視フラグメントにだけ適用されます。
`environmentHdrPath` は HDR ソースのパス、`environmentHdrName` は UI 表示名、`environmentHdrIntensity` は HDR の明るさ、`environmentHdrLoaded` は実ファイルの読み込み成否を表します。

Response:

```json
{
  "ok": true
}
```

### `GET /api/models`

Returns the loaded model list from the latest viewer snapshot.

Response:

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

Returns the currently active model name from the latest viewer snapshot.

Response:

```json
{
  "ok": true,
  "activeInstanceIndex": 0,
  "activeModelName": "Alicia"
}
```

### `GET /api/models/:modelName/bones`

Returns every bone for the named model.

`modelName` must be URL-encoded and matches the first loaded model whose name is exactly equal.

Response:

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

The `local` values are the current local pose after animation and manual adjustments, and the `world` values are the current world-space pose.

## Legacy Viewer `postMessage` API

The viewer accepts messages from the same origin only.

Message format:

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

The viewer replies with:

```json
{
  "namespace": "openmmd-api",
  "type": "response",
  "id": "same-id-as-request",
  "ok": true,
  "result": {}
}
```

### File payload rules

For `load-zip` and `load-vmd`, the command payload can include either:

- `payload.file` as a real `File` object sent from another same-origin window, or
- `payload.fileName`, `payload.fileType`, and `payload.fileData` where `fileData` is base64 text.

The viewer converts the payload into a `File` and calls the existing load helpers.

### `set-bone-params`

Updates one or more bone parameters on the active model or on a specified model.

Request body:

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

Rules:

- `modelName` is optional. If omitted, the active model is used.
- `targets` is a required array and each item applies to one bone.
- `space` must be `local` or `world`.
- `kind` must be `position`, `rotationEuler`, or `rotationQuaternion`.
- `rotationEuler` uses degrees.
- `position` uses a 3-element array `[x, y, z]`.
- `rotationEuler` uses a 3-element array `[x, y, z]`.
- `rotationQuaternion` uses a 4-element array `[x, y, z, w]`.

## Command behavior

- `load-zip`: loads a ZIP model archive and auto-loads contained VMDs
- `load-vmd`: loads a single VMD file
- `unload-model`: removes the currently active model
- `toggle-playback`: toggles the current animation state
- `play` / `pause`: starts or stops playback
- `rewind` / `go-to-end`: jumps to the playback range start or end
- `seek-frame`: moves the shared global timeline to a frame
- `step-frame` / `step-keyframe`: moves by frame or keyframe
- `set-playback-range`: updates the shared global playback range used by every loaded model
- `assign-vmd`: binds a loaded VMD to the active model
- `export-video`: runs the configured video exporter and returns the result. Set `includeAudio` to `true` to include the currently loaded BGM when available. Set `transparentBackground` to `true` to export alpha background when the format is `webm` or `mkv`; unsupported formats ignore the flag.
- `set-bone-params`: updates one or more bone parameters on a model
- `reset-physics`: resets rigid-body state
- `enter-fullscreen` / `exit-fullscreen`: toggles app fullscreen mode
- `select-model`: switches the active model instance
- `get-state`: returns a snapshot of the current viewer state. `currentFrame`, `isPlaying`, and `playbackRange` describe the shared global timeline, while `activeModelName` still identifies the editing target.

## Assumptions

- The viewer and the local API server run on the same origin and same local port.
- The server bridge is the primary command path; `postMessage` remains only as a legacy/internal transport.
- Large binary outputs are serialized as base64 in JSON for simplicity.
