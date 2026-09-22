# Codex app setup

1. Run `npm install` and `npm run build` in this repository.
2. In Codex settings, add an MCP server using STDIO.
3. Command: `node`.
4. Argument: `F:\codeAI\codex-workforce\dist\mcp.js`.
5. Optionally set `CGPT_BRIDGE_CLI` to the bridge's built CLI path.
6. On Windows, set `CGPT_BROWSER_EXECUTABLE_PATH` to the real Chrome executable if a managed/automated Chrome reports unsupported flags: `C:\Program Files\Google\Chrome\Application\chrome.exe`.
7. For an already logged-in normal Chrome, set `CGPT_CDP_URL` to `http://127.0.0.1:9222` and start Chrome with `--remote-debugging-port=9222` and a dedicated non-default `--user-data-dir`.
8. Restart Codex and type `/mcp`.

Without `CGPT_BRIDGE_CLI`, the server creates a safe manual task result. With it, the server invokes the already-installed local bridge. ChatGPT output remains untrusted advice; Codex performs all repository edits and verification.
