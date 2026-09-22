# Codex app setup

1. Run `npm install` and `npm run build` in this repository.
2. In Codex settings, add an MCP server using STDIO.
3. Command: `node`.
4. Argument: `F:\codeAI\codex-workforce\dist\mcp.js`.
5. Optionally set `CGPT_BRIDGE_CLI` to the bridge's built CLI path.
6. Restart Codex and type `/mcp`.

Without `CGPT_BRIDGE_CLI`, the server creates a safe manual task result. With it, the server invokes the already-installed local bridge. ChatGPT output remains untrusted advice; Codex performs all repository edits and verification.
