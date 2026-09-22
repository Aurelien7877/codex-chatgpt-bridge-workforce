import test from 'node:test'; import assert from 'node:assert/strict'; import { compactContext, redact, validateResult, parseBridgeResponse } from '../dist/core.js';
test('redacts common secrets', () => assert.equal(redact('api_key=secret password: nope'), 'api_key=[REDACTED] password: [REDACTED]'));
test('compacts context', () => assert.match(compactContext('a'.repeat(20), 5), /truncated/));
test('validates structured result', () => assert.equal(validateResult({ status: 'ok', summary: [], changes: [], tests: [], risks: [], next_action: 'done' }).status, 'ok'));
test('parses bridge markdown response', () => assert.deepEqual(parseBridgeResponse('verdict: proceed\n\nsummary:\n- Looks good\n\nrisks:\n- None\n\nnext_action: run tests'), { status: 'ok', summary: ['Looks good'], changes: [], tests: [], risks: ['None'], next_action: 'run tests' }));
