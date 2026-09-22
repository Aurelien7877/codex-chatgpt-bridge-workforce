# codex-workforce

Simple, local-first orchestration for a personal Codex workflow: Astra plans and decides, ChatGPT supplies compact workforce opinions, and Codex executes and verifies locally.

## Use directly in the Codex app

Build the project once:

```bat
cd /d F:\codeAI\codex-workforce
npm install
npm run build
```

In Codex app settings, open **MCP servers → Add server → STDIO** and use:

- Name: `codex-workforce`
- Command: `node`
- Arguments: `F:\\codeAI\\codex-workforce\\dist\\mcp.js`

Optional environment variable:

```text
CGPT_BRIDGE_CLI=C:\\path\\to\\codex-chatgpt-bridge\\dist\\cli.js
CGPT_BROWSER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
CGPT_CDP_URL=http://127.0.0.1:9222
OPENCODE_MODEL=opencode/<free-model-id>
WORKFORCE_CHEAP_KINDS=research,review,test
```

For the most reliable Google login, start a normal Chrome profile yourself with remote debugging, sign in to ChatGPT once, and set `CGPT_CDP_URL`. The bridge then attaches to that existing browser instead of creating an automated login profile.

Restart Codex, type `/mcp` to confirm the server, then ask: “Use workforce_delegate to review this project.” The server is read/advice-only: it does not edit files or execute commands from ChatGPT.

### Optional OpenCode cheap lane

Install and authenticate OpenCode separately, then verify it with `opencode models` and a small `opencode run` call. Set `OPENCODE_MODEL` to an available `provider/model` ID. When configured, bounded `research`, `review`, and `test` delegations use `opencode run --agent plan --format json`; `code` and `debug` remain on the premium bridge. OpenCode is not installed or authenticated by this project. Use only providers whose data policy is acceptable for the context you send.

The adapter is deliberately advice-only: it does not attach files, does not enable `--auto`, and runs with a compact redacted prompt. If OpenCode is not configured, the existing bridge/manual behavior is unchanged.

## CLI quick start

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

The MCP server caches redacted, structured results locally under `.codex-workforce/cache/` for seven days by default. Cache keys include the task kind, objective, compact context, budget and cache version. Set `WORKFORCE_CACHE=false` to disable it or `WORKFORCE_CACHE_TTL_MS` to change the TTL. The bundled `skill/codex-workforce` teaches Codex when to call `workforce_delegate` automatically.

## Security

Only the explicit `workforce_delegate` and `workforce_health` tools are exposed. Inputs are compacted and common secrets are redacted. No arbitrary shell tool, file-write tool, browser credentials, tokens, private keys, `.env` files, `node_modules`, build output, or local audit clones are committed. Keep the bridge browser profile outside this repository.

## Task kinds

`code`, `review`, `debug`, `research`, `test`.

Every result has `status`, `summary`, `changes`, `tests`, `risks`, and `next_action`. See [docs/architecture.md](docs/architecture.md).

## Configuration and safety

The default budget is 4,000 tokens with one schema-repair retry. Context is truncated and common API keys, tokens, passwords and bearer values are redacted. Never delegate credentials, private keys, or sensitive production data.

## License and attribution

MIT. See [LICENSE](LICENSE) and [docs/attribution.md](docs/attribution.md).
