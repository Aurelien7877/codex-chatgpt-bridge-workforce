# Architecture

`Astra → PLAN → DELEGATE → COLLECT → VERIFY → DECIDE`

- Astra owns global understanding, architecture, routing, arbitration and final acceptance.
- ChatGPT workforce handles compact code, review, debug, research and test proposals.
- Codex remains the local executor: files, patches, commands and verification.
- `WorkforceRouter` sends bounded routine work to OpenCode when configured, and leaves complex or sensitive work on the premium bridge. Small code proposals qualify only under the size limit and risk guard.
- `OpenCodeAdapter` uses `opencode run --format json` with the selected model. It runs in a temporary empty project whose OpenCode permission rules deny agent tools. It returns a proposal; Codex owns all project edits and checks.
- `ChatGPTBridgeAdapter` invokes the local `codex-chatgpt-bridge` CLI and parses its response file without taking control of the repo.
- Context and objectives are compacted and redacted. Result repair is limited to a malformed response. Provider and network failures are not retried automatically.
- The result cache key includes the selected route, task, bounded context and budget. Changing the route cannot reuse a result from another model.
- `UsageLedger` appends metadata-only JSONL events. OpenCode token and cost fields are recorded when its event stream returns them. Bridge token counts use a clearly marked character-based estimate. No prompts or responses are persisted.
- Usage scopes describe a workforce MCP process session or the prior 7/30 days. They do not include the Codex root model or other ChatGPT app activity.
