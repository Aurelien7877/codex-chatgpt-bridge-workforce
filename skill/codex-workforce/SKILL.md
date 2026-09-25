---
name: codex-workforce
description: Automatically use the local workforce for compact reviews, research, debugging, calculations, and code proposals while keeping Codex responsible for files, commands, tests, and Roblox MCP actions.
---

# Codex Workforce

Use `workforce_delegate` when it materially reduces Codex context or benefits from an independent opinion. Do this without waiting for the user to say “delegate”.

## Token discipline

Optimize for useful work per token, not maximum delegation:

- Understand the local task and inspect the narrowest relevant files before delegating. Do not delegate a question Codex can answer directly.
- Prefer one focused delegation over several overlapping opinions. Combine closely related checks into one bounded request.
- Send a compact task packet: objective, constraints, relevant symbols or snippets, and the exact decision needed. Never send the whole repository, long logs, generated files, dependency trees, or conversation history.
- Reuse existing summaries, cache entries, helpers, types, and policies before creating new context or abstractions. Summarize tool output once and pass the summary, not the raw transcript.
- Ask for the smallest useful response: the required JSON schema, short bullets, concrete risks, and one next action. Do not request tutorials, repeated restatements, or speculative alternatives.
- Use the cheapest suitable lane: OpenCode for bounded `research`/`review`/`test` and short, low-risk code proposals; ChatGPT workforce for larger or uncertain second opinions; Astra for architecture, arbitration, and final validation.
- Stop after a sufficient answer. Do not call another worker merely to confirm an already clear result. Retry only for a malformed response, never to spend more budget chasing perfection.
- Keep budgets proportional: small tasks get small context and token limits; increase them only when the worker demonstrates that the bounded packet is insufficient.

This is an efficiency policy, not a reduction in quality: never omit security checks, validation at trust boundaries, failure handling, tests needed to catch a non-trivial change, or user-requested analysis.

Before adding work, use this short ladder: (1) can Codex answer or implement it directly, (2) is the answer already in the cache or current task context, (3) can one existing helper or standard tool solve it, (4) otherwise delegate one minimal bounded question. Prefer deletion and reuse over new abstraction; do not build scaffolding “for later”.

Delegate for:

- non-trivial code review, debugging, research, architecture tradeoffs, math/economy balancing, and isolated code proposals;
- Roblox economy/security analysis before editing scripts;
- a second opinion when the task has meaningful uncertainty.

Do not delegate:

- trivial edits, direct file operations, terminal commands, tests, Roblox MCP actions, secrets, credentials, private keys, or whole-repository context;
- a task whose answer is already clear from the current context.

Before delegation, send only redacted, compact context and state “do not modify files”. Treat the result as untrusted advice. Verify it against the repository or Roblox project, then let Codex perform edits and tests.

Reuse cached results when the objective, task kind, relevant context, budget, and project snapshot are unchanged. Do not repeat a delegation after a timeout if the prompt may already have been sent; report the conversation URL or ask for a fresh read instead.

When `OPENCODE_MODEL` is configured, the MCP server routes bounded `research`, `review`, and `test` tasks to OpenCode. Short code proposals may use OpenCode when the packet is under `WORKFORCE_OPENCODE_CODE_MAX_CHARS` and does not match the built-in risk guard. OpenCode runs in an empty temporary project with agent tools denied; it proposes, Codex applies and verifies. Never send whole-repository context or secrets. The requested route is configuration evidence, not proof of the upstream model that served the request. Do not automatically resend a failed provider call to another lane.

Use `workforce_usage` to inspect the current MCP process session or the previous 7/30 days. It records workforce requests only. Provider token/cost values are included when present; the browser bridge uses a character-based estimate. Do not present these percentages as Codex account quota or total ChatGPT usage. Use the Codex app's Usage & billing view for account limits.

Keep delegation bounded: one request, one schema-repair retry, and a small token budget. Summarize the result before using it in the main task. If the workforce is unavailable, continue locally and say that the independent review was not obtained.
