#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { ChatGPTBridgeAdapter, ManualAdapter, Orchestrator, type TaskKind } from './core.js';

const args = process.argv.slice(2); const command = args[0];
function flag(name: string, fallback = '') { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? fallback : fallback; }
if (command === 'delegate') {
  const kind = (flag('--kind', 'code') as TaskKind); const objective = flag('--objective'); const file = flag('--context'); const adapterName = flag('--adapter', 'manual');
  if (!objective) { console.error('Usage: codex-workforce delegate --kind code --objective "..." [--context file]'); process.exit(1); }
  const context = file ? await readFile(file, 'utf8') : '';
  const adapter = adapterName === 'bridge' ? new ChatGPTBridgeAdapter(flag('--bridge-cli', process.env.CGPT_BRIDGE_CLI ?? '')) : new ManualAdapter();
  if (adapterName === 'bridge' && !flag('--bridge-cli', process.env.CGPT_BRIDGE_CLI ?? '')) throw new Error('Bridge adapter requires --bridge-cli path or CGPT_BRIDGE_CLI.');
  const result = await new Orchestrator(adapter, { adapter: adapterName === 'bridge' ? 'http' : 'manual', budget: { maxTokens: 4000, maxRetries: 1 }, redact: true }).run(objective, context, kind);
  console.log(JSON.stringify(result, null, 2));
} else { console.log('codex-workforce\n\n  delegate --kind <code|review|debug|research|test> --objective "..." [--context file]'); }
