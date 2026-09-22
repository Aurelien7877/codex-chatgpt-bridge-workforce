import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mkdir, readFile as readJsonFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type TaskKind = 'code' | 'review' | 'debug' | 'research' | 'test';
export type Status = 'ok' | 'needs_revision' | 'blocked' | 'failed';
export interface Budget { maxTokens: number; maxRetries: number; }
export interface DelegationTask { id: string; kind: TaskKind; objective: string; context: string; budget: Budget; }
export interface WorkerResult { status: Status; summary: string[]; changes: string[]; tests: string[]; risks: string[]; next_action: string; }
export interface WorkforceConfig { adapter: 'manual' | 'http'; endpoint?: string; budget: Budget; redact: boolean; cache?: boolean; cacheDir?: string; cacheTtlMs?: number; log?: (event: string, data: Record<string, unknown>) => void; }
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
  constructor(private readonly cliPath: string, private readonly options: { node?: string; projectUrl?: string; channel?: string; executablePath?: string; cdpUrl?: string; timeoutMs?: number } = {}) {}
  async delegate(task: DelegationTask): Promise<WorkerResult> {
    const args = [this.cliPath, 'ask', '--adapter', 'playwright', '--mode', task.kind === 'code' ? 'plan' : task.kind, '--question', task.objective, '--context', task.context];
    if (this.options.projectUrl) args.push('--project-url', this.options.projectUrl);
    if (this.options.channel) args.push('--channel', this.options.channel);
    const env = { ...process.env, ...(this.options.executablePath ? { CGPT_BROWSER_EXECUTABLE_PATH: this.options.executablePath } : {}), ...(this.options.cdpUrl ? { CGPT_CDP_URL: this.options.cdpUrl } : {}) };
    const { stdout } = await execFileAsync(this.options.node ?? process.execPath, args, { env, timeout: this.options.timeoutMs ?? 180_000, maxBuffer: 1024 * 1024 });
    const match = stdout.match(/^response:\s*(.+)$/m);
    if (!match) throw new Error(`Bridge did not complete a response. Output: ${compactContext(stdout, 2000)}`);
    return parseBridgeResponse(await readFile(match[1].trim(), 'utf8'));
  }
}

/** Advice-only adapter for OpenCode's non-interactive CLI. */
export class OpenCodeAdapter implements WorkforceAdapter {
  constructor(private readonly model: string, private readonly options: { command?: string; cwd?: string; timeoutMs?: number } = {}) {}
  async delegate(task: DelegationTask): Promise<WorkerResult> {
    const prompt = `You are a bounded workforce reviewer. Do not edit files, run commands, access tools, or request secrets. Return ONLY valid JSON with exactly these fields: status (ok|needs_revision|blocked|failed), summary (string[]), changes (string[]), tests (string[]), risks (string[]), next_action (string).\nTask kind: ${task.kind}\nObjective: ${task.objective}\nContext:\n${task.context}`;
    const args = ['run', '--model', this.model, '--agent', 'plan', '--format', 'json', prompt];
    const { stdout, stderr } = await execFileAsync(this.options.command ?? 'opencode', args, { cwd: this.options.cwd, timeout: this.options.timeoutMs ?? 120_000, maxBuffer: 2 * 1024 * 1024 });
    try { return validateResult(parseJsonObject(extractOpenCodeText(stdout) || stdout)); }
    catch (error) { throw new Error(`OpenCode returned no valid workforce JSON: ${String(error)}${stderr ? `; stderr: ${compactContext(stderr, 800)}` : ''}`); }
  }
}

function extractOpenCodeText(output: string): string {
  const texts: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const walk = (item: unknown) => { if (!item || typeof item !== 'object') return; const record = item as Record<string, unknown>; if (typeof record.text === 'string') texts.push(record.text); for (const child of Object.values(record)) if (child && typeof child === 'object') walk(child); };
      walk(value);
    } catch { /* diagnostics may be mixed with JSON events */ }
  }
  return texts.join('\n');
}
function parseJsonObject(text: string): unknown { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1); if (!candidate || !candidate.includes('{')) throw new Error('JSON object not found'); return JSON.parse(candidate); }

/** Routes bounded low-risk work to OpenCode, and everything else to the premium adapter. */
export class WorkforceRouter implements WorkforceAdapter {
  constructor(private readonly premium: WorkforceAdapter, private readonly cheap?: WorkforceAdapter, private readonly cheapKinds: readonly TaskKind[] = ['research', 'review', 'test']) {}
  async delegate(task: DelegationTask): Promise<WorkerResult> { return this.cheap && this.cheapKinds.includes(task.kind) ? this.cheap.delegate(task) : this.premium.delegate(task); }
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
    const cacheKey = createHash('sha256').update(JSON.stringify({ kind, objective, context: task.context, budget: task.budget, version: 1 })).digest('hex');
    const cacheDir = this.config.cacheDir ?? path.resolve('.codex-workforce', 'cache');
    if (this.config.cache !== false) {
      const cached = await readCache(cacheDir, cacheKey, this.config.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000);
      if (cached) { this.config.log?.('delegation.cache_hit', { taskId: task.id, cacheKey }); return cached; }
    }
    let lastError = '';
    for (let attempt = 0; attempt <= this.config.budget.maxRetries; attempt++) {
      try {
        const result = validateResult(await this.adapter.delegate(task));
        if (this.config.cache !== false && result.status !== 'failed') await writeCache(cacheDir, cacheKey, result);
        return result;
      } catch (error) { lastError = String(error); }
    }
    return { status: 'failed', summary: ['Worker response could not be validated.'], changes: [], tests: [], risks: [lastError], next_action: repairPrompt(task, lastError) };
  }
}

async function readCache(dir: string, key: string, ttlMs: number): Promise<WorkerResult | undefined> {
  try { const stat = await (await import('node:fs/promises')).stat(path.join(dir, `${key}.json`)); if (Date.now() - stat.mtimeMs > ttlMs) return undefined; return validateResult(JSON.parse(await readJsonFile(path.join(dir, `${key}.json`), 'utf8'))); } catch { return undefined; }
}
async function writeCache(dir: string, key: string, result: WorkerResult): Promise<void> { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, `${key}.json`), JSON.stringify({ ...result, cached_at: new Date().toISOString() }, null, 2), 'utf8'); }
