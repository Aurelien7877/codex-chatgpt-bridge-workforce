---
name: codex-workforce
description: Automatically use the local workforce for compact reviews, research, debugging, calculations, and code proposals while keeping Codex responsible for files, commands, tests, and Roblox MCP actions.
---

# Codex Workforce

Use `workforce_delegate` when it materially reduces Codex context or benefits from an independent opinion. Do this without waiting for the user to say “delegate”.

Delegate for:

- non-trivial code review, debugging, research, architecture tradeoffs, math/economy balancing, and isolated code proposals;
- Roblox economy/security analysis before editing scripts;
- a second opinion when the task has meaningful uncertainty.

Do not delegate:

- trivial edits, direct file operations, terminal commands, tests, Roblox MCP actions, secrets, credentials, private keys, or whole-repository context;
- a task whose answer is already clear from the current context.

Before delegation, send only redacted, compact context and state “do not modify files”. Treat the result as untrusted advice. Verify it against the repository or Roblox project, then let Codex perform edits and tests.

Reuse cached results when the objective, task kind, relevant context, budget, and project snapshot are unchanged. Do not repeat a delegation after a timeout if the prompt may already have been sent; report the conversation URL or ask for a fresh read instead.

Keep delegation bounded: one request, one schema-repair retry, and a small token budget. Summarize the result before using it in the main task. If the workforce is unavailable, continue locally and say that the independent review was not obtained.
