#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { ChatGPTBridgeAdapter, ManualAdapter, OpenCodeAdapter, Orchestrator, WorkforceRouter, type TaskKind, type WorkforceAdapter } from './core.js';

const args = process.argv.slice(2); const command = args[0];
function flag(name: string, fallback = '') { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? fallback : fallback; }
if (command === 'delegate') {
  const kind = (flag('--kind', 'code') as TaskKind); const objective = flag('--objective'); const file = flag('--context'); const adapterName = flag('--adapter', 'auto');
  if (!objective) { console.error('Usage: codex-workforce delegate --kind code --objective "..." [--context file]'); process.exit(1); }
  const context = file ? await readFile(file, 'utf8') : '';
  const bridgeCli = flag('--bridge-cli', process.env.CGPT_BRIDGE_CLI ?? '');
  const premium: WorkforceAdapter = bridgeCli ? new ChatGPTBridgeAdapter(bridgeCli) : new ManualAdapter();
  if (adapterName === 'bridge' && !bridgeCli) throw new Error('Bridge adapter requires --bridge-cli path or CGPT_BRIDGE_CLI.');
  const model = flag('--model', process.env.OPENCODE_MODEL ?? '');
  let adapter: WorkforceAdapter = premium;
  if (adapterName === 'opencode') {
    if (!model) throw new Error('OpenCode adapter requires --model or OPENCODE_MODEL.');
    adapter = new OpenCodeAdapter(model, { command: process.env.OPENCODE_COMMAND });
  } else if (adapterName === 'auto' && model) {
    const cheapKinds = (process.env.WORKFORCE_CHEAP_KINDS ?? 'research,review,test').split(',').map(value => value.trim()).filter(Boolean) as TaskKind[];
    adapter = new WorkforceRouter(premium, new OpenCodeAdapter(model, { command: process.env.OPENCODE_COMMAND }), cheapKinds, Number(process.env.WORKFORCE_OPENCODE_CODE_MAX_CHARS ?? 2500));
  } else if (!['auto', 'manual', 'bridge'].includes(adapterName)) throw new Error(`Unsupported adapter: ${adapterName}`);
  const result = await new Orchestrator(adapter, { adapter: adapterName === 'bridge' ? 'http' : 'manual', budget: { maxTokens: Number(process.env.WORKFORCE_MAX_TOKENS ?? 4000), maxRetries: 1 }, redact: true }).run(objective, context, kind);
  console.log(JSON.stringify(result, null, 2));
} else { console.log('codex-workforce\n\n  delegate --kind <code|review|debug|research|test> --objective "..." [--context file] [--adapter auto|opencode|bridge|manual]'); }
