# Codex app setup

1. Run `npm install` and `npm run build` in this repository.
2. In Codex settings, add an MCP server using STDIO.
3. Command: `node`.
4. Argument: `F:\codeAI\codex-workforce\dist\mcp.js`.
5. Optionally set `OPENCODE_MODEL` to an exact model ID from `opencode models` to enable the cheap lane.
6. Optionally set `CGPT_BRIDGE_CLI` to the bridge's built CLI path.
7. On Windows, set `CGPT_BROWSER_EXECUTABLE_PATH` to the real Chrome executable if a managed/automated Chrome reports unsupported flags: `C:\Program Files\Google\Chrome\Application\chrome.exe`.
8. For an already logged-in normal Chrome, set `CGPT_CDP_URL` to `http://127.0.0.1:9222` and start Chrome with `--remote-debugging-port=9222` and a dedicated non-default `--user-data-dir`.
9. Restart Codex and type `/mcp`.

Without `CGPT_BRIDGE_CLI`, premium-lane tasks return a manual task packet. With `OPENCODE_MODEL`, eligible tasks use the selected OpenCode model. The `workforce_usage` tool reports workforce-only local session or 7/30-day counts. It cannot read Codex root-model usage or all ChatGPT account activity.
