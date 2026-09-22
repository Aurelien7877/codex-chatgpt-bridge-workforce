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

The MVP uses a manual adapter: it never automates a browser, bypasses quotas, or sends secrets. The provider adapter boundary is ready for a legitimate local ChatGPT bridge integration.

## Task kinds

`code`, `review`, `debug`, `research`, `test`.

Every result has `status`, `summary`, `changes`, `tests`, `risks`, and `next_action`. See [docs/architecture.md](docs/architecture.md).

## Configuration and safety

The default budget is 4,000 tokens with one schema-repair retry. Context is truncated and common API keys, tokens, passwords and bearer values are redacted. Never delegate credentials, private keys, or sensitive production data.

## License and attribution

MIT. See [LICENSE](LICENSE) and [docs/attribution.md](docs/attribution.md).
