import { randomUUID } from 'node:crypto';

export type TaskKind = 'code' | 'review' | 'debug' | 'research' | 'test';
export type Status = 'ok' | 'needs_revision' | 'blocked' | 'failed';
export interface Budget { maxTokens: number; maxRetries: number; }
export interface DelegationTask { id: string; kind: TaskKind; objective: string; context: string; budget: Budget; }
export interface WorkerResult { status: Status; summary: string[]; changes: string[]; tests: string[]; risks: string[]; next_action: string; }
export interface WorkforceConfig { adapter: 'manual' | 'http'; endpoint?: string; budget: Budget; redact: boolean; }
export interface WorkforceAdapter { delegate(task: DelegationTask): Promise<WorkerResult>; }

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
