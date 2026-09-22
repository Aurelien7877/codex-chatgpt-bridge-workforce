import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

export type TaskKind = 'code' | 'review' | 'debug' | 'research' | 'test';
export type Status = 'ok' | 'needs_revision' | 'blocked' | 'failed';
export interface Budget { maxTokens: number; maxRetries: number; }
export interface DelegationTask { id: string; kind: TaskKind; objective: string; context: string; budget: Budget; }
export interface WorkerResult { status: Status; summary: string[]; changes: string[]; tests: string[]; risks: string[]; next_action: string; }
export interface WorkforceConfig { adapter: 'manual' | 'http'; endpoint?: string; budget: Budget; redact: boolean; }
export interface WorkforceAdapter { delegate(task: DelegationTask): Promise<WorkerResult>; }
const execFileAsync = promisify(execFile);

const secretPatterns = [/(api[_-]?key\s*[:=]\s*)[^\s,]+/gi, /(token\s*[:=]\s*)[^\s,]+/gi, /(password\s*[:=]\s*)[^\s,]+/gi, /Bearer\s+[A-Za-z0-9._-]+/gi];
export function redact(input: string): string { return secretPatterns.reduce((s, p) => s.replace(p, '$1[REDACTED]'), input); }
export function compactContext(input: string, max = 12000): string { const value = input.trim(); return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`; }
export function createTask(kind: TaskKind, objective: string, context: string, budget: Budget): DelegationTask { return { id: randomUUID(), kind, objective, context: compactContext(context), budget }; }
export function validateResult(value: unknown): WorkerResult {
  if (!value || typeof value !== 'object') throw new Error('Worker response must be an object');
  const v = value as Record<string, unknown>;
  const arrays = ['summary', 'changes', 'tests', 'risks'];
  if (!['ok', 'needs_revision', 'blocked', 'failed'].includes(String(v.status)) || typeof v.next_action !== 'string' || arrays.some(k => !Array.isArray(v[k]))) throw new Error('Invalid worker response schema');
  return value as WorkerResult;
}
export function repairPrompt(task: DelegationTask, invalid: string): string { return `Return ONLY valid JSON matching status, summary[], changes[], tests[], risks[], next_action. Task: ${task.objective}. Invalid response: ${compactContext(invalid, 2000)}`; }

export class ManualAdapter implements WorkforceAdapter {
  constructor(private readonly log = (event: string, data: unknown) => console.error(JSON.stringify({ event, ...data as object }))) {}
  async delegate(task: DelegationTask): Promise<WorkerResult> { this.log('delegation.created', { taskId: task.id, kind: task.kind }); return { status: 'blocked', summary: ['Manual adapter created the task packet.'], changes: [], tests: [], risks: ['No worker response was supplied.'], next_action: `Answer task ${task.id} using the generated packet.` }; }
}

/** Adapter for the local codex-chatgpt-bridge CLI. It treats ChatGPT as advice only. */
export class ChatGPTBridgeAdapter implements WorkforceAdapter {
  constructor(private readonly cliPath: string, private readonly options: { node?: string; projectUrl?: string; channel?: string; executablePath?: string; timeoutMs?: number } = {}) {}
  async delegate(task: DelegationTask): Promise<WorkerResult> {
    const args = [this.cliPath, 'ask', '--adapter', 'playwright', '--mode', task.kind === 'code' ? 'plan' : task.kind, '--question', task.objective, '--context', task.context];
    if (this.options.projectUrl) args.push('--project-url', this.options.projectUrl);
    if (this.options.channel) args.push('--channel', this.options.channel);
    const env = this.options.executablePath ? { ...process.env, CGPT_BROWSER_EXECUTABLE_PATH: this.options.executablePath } : process.env;
    const { stdout } = await execFileAsync(this.options.node ?? process.execPath, args, { env, timeout: this.options.timeoutMs ?? 180_000, maxBuffer: 1024 * 1024 });
    const match = stdout.match(/^response:\s*(.+)$/m);
    if (!match) throw new Error(`Bridge did not complete a response. Output: ${compactContext(stdout, 2000)}`);
    return parseBridgeResponse(await readFile(match[1].trim(), 'utf8'));
  }
}

export function parseBridgeResponse(markdown: string): WorkerResult {
  const section = (name: string) => {
    const match = markdown.match(new RegExp(`(?:^|\\n)${name}:\\s*\\n([\\s\\S]*?)(?=\\n\\w[\\w_]*:|$)`, 'i'));
    return (match?.[1] ?? '').split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  };
  const verdict = markdown.match(/^verdict:\s*(proceed|revise|blocked)\s*$/im)?.[1];
  if (!verdict) throw new Error('Bridge response is missing verdict');
  const summary = section('summary');
  if (!summary.length) throw new Error('Bridge response is missing summary');
  const next = markdown.match(/^next_action:\s*(.+)$/im)?.[1]?.trim();
  return { status: verdict === 'proceed' ? 'ok' : verdict === 'revise' ? 'needs_revision' : 'blocked', summary, changes: section('changes'), tests: section('tests'), risks: section('risks'), next_action: next ?? 'Codex must review the advice before acting.' };
}

export class Orchestrator {
  constructor(private readonly adapter: WorkforceAdapter, private readonly config: WorkforceConfig) {}
  async run(objective: string, context: string, kind: TaskKind = 'code'): Promise<WorkerResult> {
    const safe = this.config.redact ? redact(context) : context;
    const task = createTask(kind, objective, safe, this.config.budget);
    let lastError = '';
    for (let attempt = 0; attempt <= this.config.budget.maxRetries; attempt++) {
      try { return validateResult(await this.adapter.delegate(task)); } catch (error) { lastError = String(error); }
    }
    return { status: 'failed', summary: ['Worker response could not be validated.'], changes: [], tests: [], risks: [lastError], next_action: repairPrompt(task, lastError) };
  }
}
