# Direct Viewer API Bridge via server.js

## Summary

- Remove the control.html relay path and make the viewer itself subscribe to the local API bus exposed by
server.js.
- Change POST /api/command from “accepted into queue” to “execute against the connected viewer and return the
execution result”.
- Keep the existing viewer-side command executor in source/api-bridge.js; reuse server.js as the transport/
orchestration layer instead of introducing a second command implementation.

## Key Changes

- server.js
    - Remove /control and the control.html static dependency.
    discard its ability to receive commands.
    - Replace the fire-and-forget command queue with a request/response registry keyed by command id.
    - Make POST /api/command:
        - normalize the command as today,
        - fail with 503 when no viewer bridge is connected,
        - publish the command to the active viewer,
        - await a matching viewer response,
        - return { ok: true, result } on success,
        - return { ok: false, error } with an execution-status code on viewer failure or timeout.
    - Add a dedicated viewer callback endpoint, e.g. POST /api/command-result, for the viewer to report { id,
    ok, result?, error? }.
    - Keep /api/runtime-state, /api/models, /api/active-model-name, and /api/models/:modelName/bones unchanged
    except for health metadata if useful.
    - Update /api/health to expose viewer connection state instead of SSE control-panel client count.
- source/api-bridge.js
    - Keep executeCommand() as the single command implementation.
    - Add a server-bridge mode alongside the existing postMessage handler:
        - open EventSource('/api/events'),
        - execute incoming commands with executeCommand(),
        - POST the result to /api/command-result,
        - continue periodic POST /api/runtime-state.
    - Keep the postMessage bridge only if needed for internal tests; otherwise remove it with control.html.
    - Add reconnection handling so a viewer refresh re-establishes the server bridge automatically.
    - On startup, initialize the server bridge from index.html where setupOpenMmdMessageBridge() is currently
    called.
- API/docs/contracts
    - Update docs/specification/api-specification.md and docs/specification/api-specification-ja.md.
    - Document that:
        - /control is removed,
        - /api/events is now consumed by the viewer bridge,
        - POST /api/command returns execution results,
        - 503 means no viewer is connected,
        - binary-returning commands like export-video need an explicit JSON-safe response policy.
    - For export-video, default to returning metadata plus a downloadable server-side response form only if
    already supported; otherwise explicitly exclude binary body passthrough from this migration and keep it
    documented as unsupported over direct HTTP until a follow-up.

## Public API / Interface Changes

- POST /api/command
    - Old: { ok: true, command }
    - New: synchronous execution response:
        - success: { ok: true, id, result }
        - viewer error: { ok: false, id, error }
        - no viewer: HTTP 503
        - viewer timeout: HTTP 504
- New POST /api/command-result
    - viewer-only callback endpoint carrying command completion for a previously issued id.
- Removed: /control

## Test Plan

- Server tests
    - POST /api/command returns 503 when no viewer is connected.
    - Connected viewer receives the command from /api/events and POST /api/command resolves with the reported
    result.
    - Viewer-reported failure becomes an HTTP error response with the same message.
    - Missing callback / stalled viewer becomes 504.
    - Runtime snapshot GET endpoints still return cached state exactly as before.
- Viewer bridge tests
    - Add a non-DOM-heavy test for the new server bridge flow in source/api-bridge.js:
        - command received from mocked event stream,
        - executeCommand() called,
        - result posted back to server callback endpoint,
        - runtime-state sync continues.
    - Keep existing executeCommand() behavior tests in tests/api-control-flow.test.mjs.
- Manual verification
    - Start node server.js, open /, then call POST /api/command for ping, get-state, load-vmd, playback
    controls, and set-bone-params.
    - Confirm the same flows fail with 503 if the viewer tab is closed or not yet loaded.

## Assumptions

- One active viewer bridge at a time is sufficient; newest viewer connection replaces the old one.
- control.html and source/control-panel.js are removed rather than preserved for compatibility.
- This migration targets command/result transport only; if export-video cannot be safely serialized in the new
HTTP contract, it is documented as out of scope for direct-result delivery in this pass and kept for a follow-
up.