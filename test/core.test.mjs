import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compactContext, redact, validateResult, parseBridgeResponse, parseOpenCodeOutput, OpenCodeAdapter, WorkforceRouter, WorkerResponseFormatError, Orchestrator } from '../dist/core.js';
import { UsageLedger } from '../dist/usage.js';

test('redacts common secrets', () => assert.equal(redact('api_key=secret password: nope'), 'api_key=[REDACTED] password: [REDACTED]'));
test('compacts context', () => assert.match(compactContext('a'.repeat(20), 5), /truncated/));
test('validates structured result', () => assert.equal(validateResult({ status: 'ok', summary: [], changes: [], tests: [], risks: [], next_action: 'done' }).status, 'ok'));
test('parses bridge markdown response', () => assert.deepEqual(parseBridgeResponse('verdict: proceed\n\nsummary:\n- Looks good\n\nrisks:\n- None\n\nnext_action: run tests'), { status: 'ok', summary: ['Looks good'], changes: [], tests: [], risks: ['None'], next_action: 'run tests' }));

test('sums OpenCode step usage and extracts final text', () => {
  const answer = '{"status":"ok","summary":["fine"],"changes":[],"tests":[],"risks":[],"next_action":"done"}';
  const output = [
    JSON.stringify({ type: 'text', part: { type: 'text', text: answer } }),
    JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 12, output: 3 }, cost: 0.001 } }),
    JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 20, output: 5 }, cost: 0.002 } }),
  ].join('\n');
  assert.deepEqual(parseOpenCodeOutput(output), { text: answer, inputTokens: 32, outputTokens: 8, costUsd: 0.003 });
});

test('routes bounded low-risk code to OpenCode, risky or long code to premium', () => {
  const premium = { route: () => ({ provider: 'premium', verified: true }), delegate: async () => ({}) };
  const cheap = { route: () => ({ provider: 'opencode', verified: false }), delegate: async () => ({}) };
  const router = new WorkforceRouter(premium, cheap, ['research', 'review', 'test'], 300);
  const task = (objective, context = '') => ({ objective, context, kind: 'code' });
  assert.equal(router.select(task('Add a small pure helper')).route().provider, 'opencode');
  assert.equal(router.select(task('Change authentication validation')).route().provider, 'premium');
  assert.equal(router.select(task('Refactor a large module', 'x'.repeat(400))).route().provider, 'premium');
  assert.equal(router.select({ ...task('Research API'), kind: 'research' }).route().provider, 'opencode');
});

test('OpenCode runs in an isolated empty directory with every tool denied', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workforce-opencode-test-'));
  const command = process.execPath;
  const outputFile = path.join(root, 'capture.json');
  const output = { status: 'ok', summary: ['advice'], changes: [], tests: [], risks: [], next_action: 'Codex verifies' };
  const fakeCli = path.join(root, 'fake-opencode.mjs');
  await (await import('node:fs/promises')).writeFile(fakeCli, `import { readFile, writeFile } from 'node:fs/promises';\nimport path from 'node:path';\nconst args=process.argv.slice(2); const dir=args[args.indexOf('--dir')+1];\nawait writeFile(${JSON.stringify(outputFile)}, JSON.stringify({ args, cwd: process.cwd(), dir, config: JSON.parse(await readFile(path.join(dir,'opencode.json'),'utf8')) }));\nconsole.log(JSON.stringify({type:'text',part:{type:'text',text:${JSON.stringify(JSON.stringify(output))}}}));\nconsole.log(JSON.stringify({type:'step_finish',part:{type:'step-finish',tokens:{input:10,output:5},cost:0}}));`, 'utf8');
  try {
    const adapter = new OpenCodeAdapter('provider/model', { command, commandArgs: [fakeCli], timeoutMs: 5000 });
    const result = await adapter.delegate({ id: 'test', kind: 'review', objective: 'check', context: 'none', budget: { maxTokens: 300, maxRetries: 0 } });
    const capture = JSON.parse(await readFile(outputFile, 'utf8'));
    assert.equal(result.status, 'ok');
    assert.equal(capture.cwd, capture.dir);
    assert.ok(capture.args.includes('--standalone'));
    assert.equal(capture.args[capture.args.indexOf('--agent') + 1], 'workforce');
    assert.equal(capture.config.permission['*'], 'deny');
    assert.equal(capture.config.agent.workforce.permission['*'], 'deny');
    await assert.rejects(readdir(capture.dir)); // Generated temporary project is removed after the call.
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repairs malformed worker output once and records metadata without prompt text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workforce-test-'));
  try {
    const ledger = new UsageLedger(path.join(dir, 'usage.jsonl'));
    let calls = 0;
    const adapter = {
      route: () => ({ provider: 'test-provider', model: 'test-model', verified: true }),
      delegate: async (_task, reportUsage, repair) => {
        calls++; reportUsage?.({ inputTokens: 10, outputTokens: 4, tokenBasis: 'provider' });
        if (!repair) throw new WorkerResponseFormatError('bad schema', 'secret output');
        return { status: 'ok', summary: ['repaired'], changes: [], tests: [], risks: [], next_action: 'done' };
      },
    };
    const result = await new Orchestrator(adapter, { adapter: 'manual', budget: { maxTokens: 300, maxRetries: 1 }, redact: true, cache: false, usage: ledger }).run('objective', 'private-context');
    assert.equal(result.status, 'ok'); assert.equal(calls, 2);
    const persisted = await readFile(path.join(dir, 'usage.jsonl'), 'utf8');
    assert.equal(persisted.includes('private-context'), false); assert.equal(persisted.includes('secret output'), false);
    assert.equal((await ledger.summary('session')).modelCalls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('provider transport failures are not retried', async () => {
  let calls = 0;
  const adapter = { route: () => ({ provider: 'provider', verified: true }), delegate: async () => { calls++; throw new Error('network timeout'); } };
  const result = await new Orchestrator(adapter, { adapter: 'manual', budget: { maxTokens: 300, maxRetries: 1 }, redact: true, cache: false }).run('objective', 'context');
  assert.equal(calls, 1); assert.equal(result.status, 'failed');
});

test('cache avoids a second model call and tracks replay-equivalent tokens', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workforce-cache-test-'));
  try {
    const ledger = new UsageLedger(path.join(dir, 'usage.jsonl'));
    let calls = 0;
    const adapter = {
      route: () => ({ provider: 'opencode', model: 'provider/model-a', verified: false }),
      delegate: async (_task, reportUsage) => { calls++; reportUsage?.({ inputTokens: 80, outputTokens: 12, tokenBasis: 'provider' }); return { status: 'ok', summary: ['done'], changes: [], tests: [], risks: [], next_action: 'continue' }; },
    };
    const orchestrator = new Orchestrator(adapter, { adapter: 'manual', budget: { maxTokens: 300, maxRetries: 0 }, redact: true, cacheDir: path.join(dir, 'cache'), usage: ledger });
    await orchestrator.run('same objective', 'same compact context', 'review');
    await orchestrator.run('same objective', 'same compact context', 'review');
    assert.equal(calls, 1);
    const summary = await ledger.summary('session');
    assert.equal(summary.modelCalls, 1); assert.equal(summary.cacheHits, 1); assert.equal(summary.replayEquivalentTokens, 92);
    const otherModel = { ...adapter, route: () => ({ provider: 'opencode', model: 'provider/model-b', verified: false }) };
    await new Orchestrator(otherModel, { adapter: 'manual', budget: { maxTokens: 300, maxRetries: 0 }, redact: true, cacheDir: path.join(dir, 'cache'), usage: ledger }).run('same objective', 'same compact context', 'review');
    assert.equal(calls, 2); // Changing the configured model invalidates the cached route.
    assert.equal((await ledger.summary('session')).modelCalls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
