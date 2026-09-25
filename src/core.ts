import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { estimateTokens, type UsageLedger } from './usage.js';

export type TaskKind = 'code' | 'review' | 'debug' | 'research' | 'test';
export type Status = 'ok' | 'needs_revision' | 'blocked' | 'failed';
export interface Budget { maxTokens: number; maxRetries: number; }
export interface DelegationTask { id: string; kind: TaskKind; objective: string; context: string; budget: Budget; }
export interface WorkerResult { status: Status; summary: string[]; changes: string[]; tests: string[]; risks: string[]; next_action: string; }
export interface AdapterRoute { provider: string; model?: string; verified: boolean; }
export interface ProviderUsage { inputTokens?: number; outputTokens?: number; costUsd?: number; tokenBasis?: 'provider' | 'estimate' | 'none'; outputChars?: number; }
export type UsageReporter = (usage: ProviderUsage) => void;
export interface WorkforceConfig { adapter: 'manual' | 'http'; endpoint?: string; budget: Budget; redact: boolean; cache?: boolean; cacheDir?: string; cacheTtlMs?: number; usage?: UsageLedger; log?: (event: string, data: Record<string, unknown>) => void; }
export interface WorkforceAdapter {
  delegate(task: DelegationTask, reportUsage?: UsageReporter, repair?: string): Promise<WorkerResult>;
  route?(): AdapterRoute;
  select?(task: DelegationTask): WorkforceAdapter;
}
export class WorkerResponseFormatError extends Error {
  constructor(message: string, readonly response: string) { super(message); this.name = 'WorkerResponseFormatError'; }
}
const execFileAsync = promisify(execFile);

const secretPatterns = [/(api[_-]?key\s*[:=]\s*)[^\s,]+/gi, /(token\s*[:=]\s*)[^\s,]+/gi, /(password\s*[:=]\s*)[^\s,]+/gi, /(secret\s*[:=]\s*)[^\s,]+/gi, /Bearer\s+[A-Za-z0-9._-]+/gi];
export function redact(input: string): string { return secretPatterns.reduce((s, p) => s.replace(p, '$1[REDACTED]'), input); }
export function compactContext(input: string, max = 12000): string { const value = input.trim(); return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 16))}\n...[truncated]`; }
export function createTask(kind: TaskKind, objective: string, context: string, budget: Budget): DelegationTask {
  const inputLimitChars = Math.min(12000, Math.max(256, budget.maxTokens * 4));
  return { id: randomUUID(), kind, objective: compactContext(objective, 2000), context: compactContext(context, inputLimitChars), budget };
}
export function validateResult(value: unknown): WorkerResult {
  if (!value || typeof value !== 'object') throw new WorkerResponseFormatError('Worker response must be an object', JSON.stringify(value));
  const v = value as Record<string, unknown>;
  const arrays = ['summary', 'changes', 'tests', 'risks'];
  if (!['ok', 'needs_revision', 'blocked', 'failed'].includes(String(v.status)) || typeof v.next_action !== 'string' || arrays.some(k => !Array.isArray(v[k]) || (v[k] as unknown[]).some(item => typeof item !== 'string'))) throw new WorkerResponseFormatError('Invalid worker response schema', JSON.stringify(value));
  return value as WorkerResult;
}

export class ManualAdapter implements WorkforceAdapter {
  constructor(private readonly log = (event: string, data: unknown) => console.error(JSON.stringify({ event, ...data as object }))) {}
  route(): AdapterRoute { return { provider: 'manual', verified: true }; }
  async delegate(task: DelegationTask): Promise<WorkerResult> { this.log('delegation.created', { taskId: task.id, kind: task.kind }); return { status: 'blocked', summary: ['Manual adapter created the task packet.'], changes: [], tests: [], risks: ['No worker response was supplied.'], next_action: `Answer task ${task.id} using the generated packet.` }; }
}

/** Adapter for the local browser bridge. ChatGPT remains advice-only. */
export class ChatGPTBridgeAdapter implements WorkforceAdapter {
  constructor(private readonly cliPath: string, private readonly options: { node?: string; projectUrl?: string; channel?: string; executablePath?: string; cdpUrl?: string; timeoutMs?: number } = {}) {}
  route(): AdapterRoute { return { provider: 'chatgpt-bridge', model: 'ChatGPT web (usage unavailable)', verified: false }; }
  async delegate(task: DelegationTask, reportUsage?: UsageReporter, repair?: string): Promise<WorkerResult> {
    const question = repair ? `${task.objective}\n\n${repair}` : task.objective;
    const args = [this.cliPath, 'ask', '--adapter', 'playwright', '--mode', task.kind === 'code' ? 'plan' : task.kind, '--question', question, '--context', task.context];
    if (this.options.projectUrl) args.push('--project-url', this.options.projectUrl);
    if (this.options.channel) args.push('--channel', this.options.channel);
    const env = { ...process.env, ...(this.options.executablePath ? { CGPT_BROWSER_EXECUTABLE_PATH: this.options.executablePath } : {}), ...(this.options.cdpUrl ? { CGPT_CDP_URL: this.options.cdpUrl } : {}) };
    const { stdout } = await execFileAsync(this.options.node ?? process.execPath, args, { env, timeout: this.options.timeoutMs ?? 180_000, maxBuffer: 1024 * 1024 });
    const match = stdout.match(/^response:\s*(.+)$/m);
    if (!match) throw new Error(`Bridge did not complete a response. Output: ${compactContext(stdout, 1200)}`);
    const markdown = await readFile(match[1].trim(), 'utf8');
    reportUsage?.({ outputChars: markdown.length, tokenBasis: 'estimate', outputTokens: estimateTokens(markdown) });
    return parseBridgeResponse(markdown);
  }
}

export interface OpenCodeOutput { text: string; inputTokens?: number; outputTokens?: number; costUsd?: number; actualModel?: string; }
export function parseOpenCodeOutput(output: string): OpenCodeOutput {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let sawTokens = false;
  let costUsd = 0;
  let sawCost = false;
  let actualModel: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const part = event.part && typeof event.part === 'object' ? event.part as Record<string, unknown> : {};
      if (event.type === 'text' && typeof part.text === 'string') text += `${part.text}\n`;
      if (event.type === 'step_finish' && part.type === 'step-finish') {
        const tokens = part.tokens && typeof part.tokens === 'object' ? part.tokens as Record<string, unknown> : undefined;
        if (tokens) {
          const input = finite(tokens.input); const outputCount = finite(tokens.output);
          if (input !== undefined || outputCount !== undefined) { inputTokens += input ?? 0; outputTokens += outputCount ?? 0; sawTokens = true; }
        }
        const cost = finite(part.cost); if (cost !== undefined) { costUsd += cost; sawCost = true; }
      }
      const info = event.info && typeof event.info === 'object' ? event.info as Record<string, unknown> : {};
      if (typeof info.modelID === 'string' && typeof info.providerID === 'string') actualModel = `${info.providerID}/${info.modelID}`;
    } catch { /* Ignore non-JSON CLI diagnostics. */ }
  }
  return { text: text.trim(), ...(sawTokens ? { inputTokens, outputTokens } : {}), ...(sawCost ? { costUsd } : {}), ...(actualModel ? { actualModel } : {}) };
}

/** Invokes OpenCode in an empty temporary project with all agent tools denied. */
export class OpenCodeAdapter implements WorkforceAdapter {
  constructor(private readonly model: string, private readonly options: { command?: string; commandArgs?: string[]; timeoutMs?: number } = {}) {}
  route(): AdapterRoute { return { provider: 'opencode', model: this.model, verified: false }; }
  async delegate(task: DelegationTask, reportUsage?: UsageReporter, repair?: string): Promise<WorkerResult> {
    const isolatedDir = await mkdtemp(path.join(os.tmpdir(), 'codex-workforce-opencode-'));
    try {
      const config = { $schema: 'https://opencode.ai/config.json', permission: { '*': 'deny' }, agent: { workforce: { mode: 'primary', permission: { '*': 'deny' } } } };
      await writeFile(path.join(isolatedDir, 'opencode.json'), JSON.stringify(config), { encoding: 'utf8', flag: 'wx' });
      const prompt = [
        'You are an advice-only workforce. Do not use tools. Do not edit files or run commands.',
        'Return ONLY JSON: {"status":"ok|needs_revision|blocked|failed","summary":["..."],"changes":["..."],"tests":["..."],"risks":["..."],"next_action":"..."}.',
        'Keep the whole answer under 140 words. Use empty arrays when there is nothing to report.',
        `Task kind: ${task.kind}`, `Objective: ${task.objective}`, `Context:\n${task.context}`,
        repair ? `Repair the previous response to match the exact JSON contract. Do not redo the analysis. Previous response:\n${compactContext(redact(repair), 1600)}` : '',
      ].filter(Boolean).join('\n\n');
      const args = ['run', '--standalone', '--model', this.model, '--agent', 'workforce', '--format', 'json', '--dir', isolatedDir, prompt];
      let stdout = '';
      try {
        ({ stdout } = await execFileAsync(this.options.command ?? 'opencode', [...(this.options.commandArgs ?? []), ...args], { cwd: isolatedDir, timeout: this.options.timeoutMs ?? 120_000, maxBuffer: 2 * 1024 * 1024 }));
      } catch (error) {
        const output = error && typeof error === 'object' && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '';
        const parsed = parseOpenCodeOutput(output);
        reportUsage?.({ inputTokens: parsed.inputTokens ?? estimateTokens(prompt), outputTokens: parsed.outputTokens, costUsd: parsed.costUsd, tokenBasis: parsed.inputTokens !== undefined ? 'provider' : 'estimate', outputChars: parsed.text.length });
        throw error;
      }
      const parsed = parseOpenCodeOutput(stdout);
      reportUsage?.({ inputTokens: parsed.inputTokens ?? estimateTokens(prompt), outputTokens: parsed.outputTokens ?? estimateTokens(parsed.text), costUsd: parsed.costUsd, tokenBasis: parsed.inputTokens !== undefined && parsed.outputTokens !== undefined ? 'provider' : 'estimate', outputChars: parsed.text.length });
      try { return validateResult(parseJsonObject(parsed.text || stdout)); }
      catch (error) { throw new WorkerResponseFormatError(`OpenCode returned an invalid workforce response: ${String(error)}`, parsed.text || stdout); }
    } finally {
      await rm(isolatedDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  const candidate = fenced ?? (start >= 0 && end >= start ? text.slice(start, end + 1) : '');
  if (!candidate) throw new Error('JSON object not found');
  return JSON.parse(candidate);
}

/** Routes routine tasks cheaply. Code proposals qualify only when short and low-risk. */
export class WorkforceRouter implements WorkforceAdapter {
  constructor(private readonly premium: WorkforceAdapter, private readonly cheap?: WorkforceAdapter, private readonly cheapKinds: readonly TaskKind[] = ['research', 'review', 'test'], private readonly smallCodeMaxChars = 0) {}
  select(task: DelegationTask): WorkforceAdapter {
    if (!this.cheap) return this.premium;
    if (task.kind !== 'code' && this.cheapKinds.includes(task.kind)) return this.cheap;
    const packet = `${task.objective}\n${task.context}`;
    const risky = /\b(auth(?:entication|orization)?|security|permission|credential|secret|payment|billing|crypto|migration|delete|production|deploy|database|schema|access control)\b/i.test(packet);
    if (task.kind === 'code' && this.smallCodeMaxChars > 0 && packet.length <= this.smallCodeMaxChars && !risky) return this.cheap;
    return this.premium;
  }
  route(): AdapterRoute { return { provider: 'router', verified: false }; }
  async delegate(task: DelegationTask, reportUsage?: UsageReporter, repair?: string): Promise<WorkerResult> { return this.select(task).delegate(task, reportUsage, repair); }
}

export function parseBridgeResponse(markdown: string): WorkerResult {
  const section = (name: string) => {
    const match = markdown.match(new RegExp(`(?:^|\\n)${name}:\\s*\\n([\\s\\S]*?)(?=\\n\\w[\\w_]*:|$)`, 'i'));
    return (match?.[1] ?? '').split(/\r?\n/).map(line => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  };
  const verdict = markdown.match(/^verdict:\s*(proceed|revise|blocked)\s*$/im)?.[1];
  if (!verdict) throw new WorkerResponseFormatError('Bridge response is missing verdict', markdown);
  const summary = section('summary');
  if (!summary.length) throw new WorkerResponseFormatError('Bridge response is missing summary', markdown);
  const next = markdown.match(/^next_action:\s*(.+)$/im)?.[1]?.trim();
  return { status: verdict === 'proceed' ? 'ok' : verdict === 'revise' ? 'needs_revision' : 'blocked', summary, changes: section('changes'), tests: section('tests'), risks: section('risks'), next_action: next ?? 'Codex must review the advice before acting.' };
}

export class Orchestrator {
  constructor(private readonly adapter: WorkforceAdapter, private readonly config: WorkforceConfig) {}
  async run(objective: string, context: string, kind: TaskKind = 'code'): Promise<WorkerResult> {
    const safeObjective = this.config.redact ? redact(objective) : objective;
    const safeContext = this.config.redact ? redact(context) : context;
    const task = createTask(kind, safeObjective, safeContext, this.config.budget);
    const worker = this.adapter.select?.(task) ?? this.adapter;
    const route = worker.route?.() ?? { provider: 'unknown', verified: false };
    const cacheKey = createHash('sha256').update(JSON.stringify({ kind, objective: task.objective, context: task.context, budget: task.budget, route, version: 2 })).digest('hex');
    const cacheDir = this.config.cacheDir ?? path.resolve('.codex-workforce', 'cache');
    if (this.config.cache !== false) {
      const cached = await readCache(cacheDir, cacheKey, this.config.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000);
      if (cached) {
        this.config.log?.('delegation.cache_hit', { taskId: task.id, cacheKey, provider: route.provider });
        await this.recordUsage({ provider: 'cache', selectedProvider: route.provider, model: route.model, kind, status: cached.result.status, cacheHit: true, durationMs: 0, inputChars: task.objective.length + task.context.length, inputTokens: cached.usage?.inputTokens ?? estimateTokens(`${task.objective}\n${task.context}`), outputTokens: cached.usage?.outputTokens, tokenBasis: cached.usage?.tokenBasis ?? 'estimate' });
        return cached.result;
      }
    }
    let lastError: unknown;
    let repair: string | undefined;
    const retries = Math.min(1, Math.max(0, this.config.budget.maxRetries));
    for (let attempt = 0; attempt <= retries; attempt++) {
      const started = Date.now();
      let providerUsage: ProviderUsage | undefined;
      try {
        const result = sanitizeResult(validateResult(await worker.delegate(task, usage => { providerUsage = usage; }, repair)));
        const elapsed = Date.now() - started;
        const usageRow = this.usageRow(route, providerUsage, kind, result.status, false, elapsed, task);
        await this.recordUsage(usageRow);
        if (this.config.cache !== false && result.status !== 'failed') await writeCache(cacheDir, cacheKey, result, usageRow);
        return result;
      } catch (error) {
        lastError = error;
        const response = error instanceof WorkerResponseFormatError ? error.response : '';
        const measured = providerUsage ?? { inputTokens: estimateTokens(`${task.objective}\n${task.context}`), tokenBasis: 'estimate' as const };
        await this.recordUsage(this.usageRow(route, measured, kind, 'failed', false, Date.now() - started, task));
        if (error instanceof WorkerResponseFormatError && attempt < retries) {
          repair = makeRepair(task, redact(response), route.provider);
          this.config.log?.('delegation.schema_repair', { taskId: task.id, provider: route.provider });
          continue;
        }
        break; // Provider/network timeouts are never retried automatically.
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'Unknown worker failure');
    return { status: 'failed', summary: ['Worker response could not be completed or validated.'], changes: [], tests: [], risks: [compactContext(redact(message), 1000)], next_action: 'Review the failure and retry explicitly only if the provider did not already receive the request.' };
  }

  private usageRow(route: AdapterRoute, usage: ProviderUsage | undefined, kind: TaskKind, status: string, cacheHit: boolean, durationMs: number, task: DelegationTask) {
    const promptChars = task.objective.length + task.context.length;
    const basis = usage?.tokenBasis ?? 'estimate';
    return {
      provider: route.provider, model: route.model, kind, status, cacheHit, durationMs,
      inputChars: promptChars, outputChars: usage?.outputChars,
      inputTokens: usage?.inputTokens ?? estimateTokens(`${task.objective}\n${task.context}`),
      outputTokens: usage?.outputTokens, tokenBasis: basis, costUsd: usage?.costUsd,
    } as const;
  }

  private async recordUsage(event: Parameters<UsageLedger['record']>[0]): Promise<void> {
    try { await this.config.usage?.record(event); }
    catch (error) { this.config.log?.('usage.write_failed', { error: String(error) }); }
  }
}

function makeRepair(task: DelegationTask, invalid: string, provider: string): string {
  if (provider === 'chatgpt-bridge') return `Correct your previous answer without redoing the analysis. Return exactly this format:\nverdict: proceed|revise|blocked\n\nsummary:\n- ...\n\nchanges:\n- ...\n\ntests:\n- ...\n\nrisks:\n- ...\n\nnext_action: ...\nTask: ${task.objective}\nMalformed answer:\n${compactContext(invalid, 1200)}`;
  return `Correct the previous answer without redoing the analysis. Return only the required JSON object. Task: ${task.objective}\nMalformed answer:\n${compactContext(invalid, 1200)}`;
}

interface CachedWorkerResult { result: WorkerResult; usage?: { inputTokens?: number; outputTokens?: number; tokenBasis: 'provider' | 'estimate' | 'none'; }; }
function sanitizeResult(result: WorkerResult): WorkerResult {
  return { status: result.status, summary: result.summary.map(redact), changes: result.changes.map(redact), tests: result.tests.map(redact), risks: result.risks.map(redact), next_action: redact(result.next_action) };
}
async function readCache(dir: string, key: string, ttlMs: number): Promise<CachedWorkerResult | undefined> {
  try {
    const file = path.join(dir, `${key}.json`); const stat = await (await import('node:fs/promises')).stat(file);
    if (Date.now() - stat.mtimeMs > ttlMs) return undefined;
    const value = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    if (value.result && typeof value.result === 'object') {
      const usage = value.usage && typeof value.usage === 'object' ? value.usage as CachedWorkerResult['usage'] : undefined;
      return { result: validateResult(value.result), usage };
    }
    return { result: validateResult(value) };
  } catch { return undefined; }
}
async function writeCache(dir: string, key: string, result: WorkerResult, usage: { inputTokens?: number; outputTokens?: number; tokenBasis: 'provider' | 'estimate' | 'none' }): Promise<void> { await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, `${key}.json`), JSON.stringify({ result, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, tokenBasis: usage.tokenBasis }, cached_at: new Date().toISOString() }, null, 2), 'utf8'); }
