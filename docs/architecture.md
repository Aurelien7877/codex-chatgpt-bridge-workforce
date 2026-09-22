# Architecture

`Astra → PLAN → DELEGATE → COLLECT → VERIFY → DECIDE`

- Astra owns global understanding, architecture, routing, arbitration and final acceptance.
- ChatGPT workforce handles compact code, review, debug, research and test proposals.
- Codex remains the local executor: files, patches, commands and verification.
- `Orchestrator` is provider-neutral. `ManualAdapter` creates copy/paste packets; `ChatGPTBridgeAdapter` invokes the existing local `codex-chatgpt-bridge` CLI and parses its response file without taking control of the repo.
- Context is compacted and redacted before delegation. Results are validated and retried through a repair prompt.
