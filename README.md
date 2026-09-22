# codex-workforce

Simple, local-first orchestration for a personal Codex workflow: Astra plans and decides, ChatGPT supplies compact workforce opinions, and Codex executes and verifies locally.

## Quick start

```bash
npm install
npm run check
npm test
npm run build
node dist/cli.js delegate --kind code --objective "Add a health endpoint"
```

Use the local bridge when it is installed and configured:

```bash
set CGPT_BRIDGE_CLI=C:\path\to\codex-chatgpt-bridge\dist\cli.js
node dist/cli.js delegate --adapter bridge --kind review --objective "Review this change" --context README.md
```

The bridge adapter invokes the existing local bridge, reads its structured response file, and still treats ChatGPT output as advice that Codex must verify. It never bypasses quotas or sends secrets.

## Task kinds

`code`, `review`, `debug`, `research`, `test`.

Every result has `status`, `summary`, `changes`, `tests`, `risks`, and `next_action`. See [docs/architecture.md](docs/architecture.md).

## Configuration and safety

The default budget is 4,000 tokens with one schema-repair retry. Context is truncated and common API keys, tokens, passwords and bearer values are redacted. Never delegate credentials, private keys, or sensitive production data.

## License and attribution

MIT. See [LICENSE](LICENSE) and [docs/attribution.md](docs/attribution.md).
