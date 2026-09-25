import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type UsageScope = 'session' | '7d' | '30d';
export interface UsageEvent {
  timestamp: string;
  sessionId: string;
  provider: string;
  selectedProvider?: string;
  model?: string;
  kind: string;
  status: string;
  cacheHit: boolean;
  durationMs: number;
  inputChars: number;
  outputChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenBasis: 'provider' | 'estimate' | 'none';
  costUsd?: number;
}

export interface ProviderUsage {
  requests: number;
  cacheHits: number;
  successes: number;
  needsRevision: number;
  blocked: number;
  failures: number;
  requestSharePercent: number;
  inputTokens: number;
  outputTokens: number;
  tokenSharePercent: number | null;
  providerReportedCalls: number;
  estimatedCalls: number;
  costUsdReported: number | null;
  selectedRoutes?: Record<string, number>;
}

export class UsageLedger {
  readonly sessionId = randomUUID();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(event: Omit<UsageEvent, 'timestamp' | 'sessionId'>): Promise<void> {
    const row: UsageEvent = { ...event, timestamp: new Date().toISOString(), sessionId: this.sessionId };
    this.pending = this.pending.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(row)}\n`, 'utf8');
    });
    await this.pending;
  }

  async summary(scope: UsageScope = 'session'): Promise<Record<string, unknown>> {
    await this.pending.catch(() => undefined);
    let content = '';
    try { content = await readFile(this.filePath, 'utf8'); } catch { /* first run */ }
    const now = Date.now();
    const days = scope === '7d' ? 7 : scope === '30d' ? 30 : undefined;
    const events = content.split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line) as UsageEvent]; } catch { return []; }
    }).filter(event => {
      const timestamp = Date.parse(event.timestamp);
      return scope === 'session'
        ? event.sessionId === this.sessionId
        : days !== undefined && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= days * 86_400_000;
    });
    const modelCalls = events.filter(event => !event.cacheHit && event.provider !== 'manual');
    const modelEvents = events.filter(event => !event.cacheHit && event.provider !== 'manual');
    const tokenTotal = modelEvents.reduce((sum, event) => sum + (event.inputTokens ?? 0) + (event.outputTokens ?? 0), 0);
    const replayEquivalentTokens = events.filter(event => event.cacheHit).reduce((sum, event) => sum + (event.inputTokens ?? 0) + (event.outputTokens ?? 0), 0);
    const byProvider = new Map<string, UsageEvent[]>();
    for (const event of events) {
      const key = event.cacheHit ? 'cache' : event.provider;
      byProvider.set(key, [...(byProvider.get(key) ?? []), event]);
    }
    const providers: Record<string, ProviderUsage> = {};
    for (const [name, rows] of byProvider) {
      const consumed = rows.filter(row => !row.cacheHit);
      const inputTokens = consumed.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
      const outputTokens = consumed.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
      const reported = consumed.filter(row => row.tokenBasis === 'provider').length;
      const estimated = consumed.filter(row => row.tokenBasis === 'estimate').length;
      const costs = consumed.filter(row => typeof row.costUsd === 'number');
      const selectedRoutes: Record<string, number> = {};
      for (const row of rows) if (row.selectedProvider) selectedRoutes[row.selectedProvider] = (selectedRoutes[row.selectedProvider] ?? 0) + 1;
      providers[name] = {
        requests: rows.length,
        cacheHits: rows.filter(row => row.cacheHit).length,
        successes: rows.filter(row => row.status === 'ok' || row.status === 'needs_revision').length,
        needsRevision: rows.filter(row => row.status === 'needs_revision').length,
        blocked: rows.filter(row => row.status === 'blocked').length,
        failures: rows.filter(row => row.status === 'failed').length,
        requestSharePercent: events.length ? roundPercent(rows.length / events.length) : 0,
        inputTokens,
        outputTokens,
        tokenSharePercent: tokenTotal ? roundPercent((inputTokens + outputTokens) / tokenTotal) : null,
        providerReportedCalls: reported,
        estimatedCalls: estimated,
        costUsdReported: costs.length ? Number(costs.reduce((sum, row) => sum + (row.costUsd ?? 0), 0).toFixed(8)) : null,
        ...(Object.keys(selectedRoutes).length ? { selectedRoutes } : {}),
      };
    }
    return {
      scope,
      sessionId: scope === 'session' ? this.sessionId : undefined,
      totalRequests: events.length,
      modelCalls: modelCalls.length,
      cacheHits: events.filter(event => event.cacheHit).length,
      inputTokens: modelEvents.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
      outputTokens: modelEvents.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
      replayEquivalentTokens,
      tokenShareNote: 'Provider-reported counts are as reported. Character-based counts are estimates. Cached replay-equivalent tokens are based on the previous identical call. Percentages cover workforce events only, not Codex root usage or the ChatGPT account quota.',
      providers,
    };
  }
}

export function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
function roundPercent(value: number): number { return Math.round(value * 1000) / 10; }
