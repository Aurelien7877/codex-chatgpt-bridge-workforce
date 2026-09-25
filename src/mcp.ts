import os from 'node:os';
import path from 'node:path';
import { ChatGPTBridgeAdapter, ManualAdapter, OpenCodeAdapter, Orchestrator, WorkforceRouter, type TaskKind, type WorkforceAdapter } from './core.js';
import { UsageLedger, type UsageScope } from './usage.js';

type Json = Record<string, unknown>;
const bridgeCli = process.env.CGPT_BRIDGE_CLI;
const premium: WorkforceAdapter = bridgeCli
  ? new ChatGPTBridgeAdapter(bridgeCli, { projectUrl: process.env.CGPT_PROJECT_URL, channel: process.env.CGPT_BROWSER_CHANNEL, executablePath: process.env.CGPT_BROWSER_EXECUTABLE_PATH, cdpUrl: process.env.CGPT_CDP_URL })
  : new ManualAdapter();
const openCodeModel = process.env.OPENCODE_MODEL;
const cheapKinds = (process.env.WORKFORCE_CHEAP_KINDS ?? 'research,review,test').split(',').map(value => value.trim()).filter((value): value is TaskKind => ['code', 'review', 'debug', 'research', 'test'].includes(value));
const smallCodeMaxChars = Number(process.env.WORKFORCE_OPENCODE_CODE_MAX_CHARS ?? 2500);
const cheap = openCodeModel ? new OpenCodeAdapter(openCodeModel, { command: process.env.OPENCODE_COMMAND, timeoutMs: Number(process.env.OPENCODE_TIMEOUT_MS ?? 120000) }) : undefined;
const adapter: WorkforceAdapter = cheap ? new WorkforceRouter(premium, cheap, cheapKinds, smallCodeMaxChars) : premium;
const usagePath = process.env.WORKFORCE_USAGE_LOG ?? path.join(os.homedir(), '.codex', 'codex-workforce', 'usage.jsonl');
const usage = new UsageLedger(usagePath);
const orchestrator = new Orchestrator(adapter, {
  adapter: bridgeCli ? 'http' : 'manual',
  budget: { maxTokens: Number(process.env.WORKFORCE_MAX_TOKENS ?? 4000), maxRetries: 1 },
  redact: true,
  cache: process.env.WORKFORCE_CACHE !== 'false',
  cacheDir: process.env.WORKFORCE_CACHE_DIR ?? undefined,
  cacheTtlMs: Number(process.env.WORKFORCE_CACHE_TTL_MS ?? 604800000),
  usage,
  log: (event, data) => process.stderr.write(`${JSON.stringify({ event, ...data })}\n`),
});

function reply(id: unknown, result: Json) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function error(id: unknown, message: string) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message } })}\n`); }
function tools() { return { tools: [
  { name: 'workforce_delegate', description: 'Delegate one compact task. Routes routine research/review/test to OpenCode when configured, small low-risk code proposals to OpenCode, and other work to the premium bridge. Codex applies and verifies all changes.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['code', 'review', 'debug', 'research', 'test'] }, objective: { type: 'string' }, context: { type: 'string' } }, required: ['objective'] } },
  { name: 'workforce_health', description: 'Show configured lanes, session ID and routing safety settings.', inputSchema: { type: 'object', properties: {} } },
  { name: 'workforce_usage', description: 'Show workforce-only delegations, cache hits, provider-reported or estimated tokens, and provider shares for this MCP session or recent days. Does not read Codex account usage.', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['session', '7d', '30d'], description: 'Defaults to this MCP process session.' } } } },
] }; }

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', async (chunk: string) => {
  buffer += chunk;
  let end: number;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (!line) continue;
    let message: Json; try { message = JSON.parse(line); } catch { continue; }
    const id = message.id; const method = String(message.method ?? '');
    if (method === 'initialize') reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-workforce', version: '0.3.0' } });
    else if (method === 'notifications/initialized') continue;
    else if (method === 'tools/list') reply(id, tools());
    else if (method === 'tools/call') {
      const params = (message.params ?? {}) as Json; const name = String(params.name ?? ''); const args = (params.arguments ?? {}) as Json;
      if (name === 'workforce_health') {
        reply(id, { content: [{ type: 'text', text: JSON.stringify({ mode: openCodeModel ? bridgeCli ? 'opencode-plus-bridge' : 'opencode-plus-manual' : bridgeCli ? 'bridge' : 'manual', redaction: true, bridgeConfigured: Boolean(bridgeCli), openCodeConfigured: Boolean(openCodeModel), openCodeModel: openCodeModel ?? null, openCodeKinds: cheapKinds, smallCodeMaxChars, opencodeToolPermissions: 'denied in isolated temporary project', routeVerification: 'configured only; provider inference metadata is not assumed', usageLog: usagePath, usageSessionId: usage.sessionId }) }] });
      } else if (name === 'workforce_usage') {
        const scope = (['session', '7d', '30d'].includes(String(args.scope)) ? String(args.scope) : 'session') as UsageScope;
        const summary = await usage.summary(scope);
        reply(id, { content: [{ type: 'text', text: JSON.stringify(summary) }], structuredContent: summary });
      } else if (name === 'workforce_delegate') {
        const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
        if (!objective) { error(id, 'objective is required'); continue; }
        const kind = (typeof args.kind === 'string' ? args.kind : 'code') as TaskKind;
        if (!['code', 'review', 'debug', 'research', 'test'].includes(kind)) { error(id, `Unsupported task kind: ${kind}`); continue; }
        const context = typeof args.context === 'string' ? args.context : '';
        const result = await orchestrator.run(objective, context, kind);
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
      } else error(id, `Unknown tool: ${name}`);
    } else if (id !== undefined) error(id, `Unknown method: ${method}`);
  }
});
