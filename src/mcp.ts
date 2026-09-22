import { ChatGPTBridgeAdapter, ManualAdapter, Orchestrator, type TaskKind } from './core.js';

type Json = Record<string, unknown>;
const bridgeCli = process.env.CGPT_BRIDGE_CLI;
const adapter = bridgeCli ? new ChatGPTBridgeAdapter(bridgeCli, { projectUrl: process.env.CGPT_PROJECT_URL, channel: process.env.CGPT_BROWSER_CHANNEL }) : new ManualAdapter();
const orchestrator = new Orchestrator(adapter, { adapter: bridgeCli ? 'http' : 'manual', budget: { maxTokens: Number(process.env.WORKFORCE_MAX_TOKENS ?? 4000), maxRetries: 1 }, redact: true });

function reply(id: unknown, result: Json) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function error(id: unknown, message: string) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message } })}\n`); }
function tools() { return { tools: [
  { name: 'workforce_delegate', description: 'Delegate a compact code/review/debug/research/test task to the configured local workforce. ChatGPT output is advice only; Codex must verify it.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['code', 'review', 'debug', 'research', 'test'] }, objective: { type: 'string' }, context: { type: 'string' } }, required: ['objective'] } },
  { name: 'workforce_health', description: 'Show whether the local workforce is configured for bridge or manual mode.', inputSchema: { type: 'object', properties: {} } }
] }; }
process.stdin.setEncoding('utf8'); let buffer = '';
process.stdin.on('data', async (chunk: string) => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line) continue; let message: Json; try { message = JSON.parse(line); } catch { continue; } const id = message.id; const method = String(message.method ?? '');
  if (method === 'initialize') reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codex-workforce', version: '0.1.0' } });
  else if (method === 'notifications/initialized') continue;
  else if (method === 'tools/list') reply(id, tools());
  else if (method === 'tools/call') { const params = (message.params ?? {}) as Json; const name = String(params.name ?? ''); const args = (params.arguments ?? {}) as Json; if (name === 'workforce_health') reply(id, { content: [{ type: 'text', text: JSON.stringify({ mode: bridgeCli ? 'bridge' : 'manual', redaction: true, bridgeConfigured: Boolean(bridgeCli) }) }] }); else if (name === 'workforce_delegate') { const objective = typeof args.objective === 'string' ? args.objective.trim() : ''; if (!objective) { error(id, 'objective is required'); continue; } const kind = (typeof args.kind === 'string' ? args.kind : 'code') as TaskKind; const context = typeof args.context === 'string' ? args.context : ''; try { const result = await orchestrator.run(objective, context, kind); reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }); } catch (e) { error(id, String(e)); } } else error(id, `Unknown tool: ${name}`); }
  else if (id !== undefined) error(id, `Unknown method: ${method}`);
} });
