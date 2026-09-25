import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UsageLedger } from '../dist/usage.js';

test('usage ledger aggregates providers and stores metadata only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workforce-usage-'));
  try {
    const ledger = new UsageLedger(path.join(dir, 'usage.jsonl'));
    await ledger.record({ provider: 'opencode', model: 'free-model', kind: 'review', status: 'ok', cacheHit: false, durationMs: 80, inputChars: 100, inputTokens: 20, outputTokens: 5, tokenBasis: 'provider', costUsd: 0 });
    await ledger.record({ provider: 'cache', selectedProvider: 'opencode', kind: 'review', status: 'ok', cacheHit: true, durationMs: 0, inputChars: 100, inputTokens: 0, outputTokens: 0, tokenBasis: 'none' });
    const summary = await ledger.summary('session');
    assert.equal(summary.modelCalls, 1); assert.equal(summary.cacheHits, 1); assert.equal(summary.totalRequests, 2);
    assert.equal(summary.providers.opencode.costUsdReported, 0);
    const file = await readFile(path.join(dir, 'usage.jsonl'), 'utf8');
    assert.equal(file.includes('objective'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
