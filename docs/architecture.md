# Architecture

`Astra → PLAN → DELEGATE → COLLECT → VERIFY → DECIDE`

- Astra owns global understanding, architecture, routing, arbitration and final acceptance.
- ChatGPT workforce handles compact code, review, debug, research and test proposals.
- Codex remains the local executor: files, patches, commands and verification.
- `Orchestrator` is provider-neutral. `ManualAdapter` is the safe MVP; a ChatGPT bridge adapter can be added without changing task contracts.
- Context is compacted and redacted before delegation. Results are validated and retried through a repair prompt.
