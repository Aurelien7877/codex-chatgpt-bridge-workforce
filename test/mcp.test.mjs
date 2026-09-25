import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'dist', 'mcp.js');

test('MCP exposes usage and reports configured OpenCode routing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workforce-mcp-test-'));
  const child = spawn(process.execPath, [server], {
    cwd: dir,
    env: { ...process.env, OPENCODE_MODEL: 'provider/test-model', CGPT_BRIDGE_CLI: 'bridge-not-invoked.js', WORKFORCE_USAGE_LOG: path.join(dir, 'usage.jsonl') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      try { const message = JSON.parse(line); pending.get(message.id)?.(message.result); pending.delete(message.id); } catch { /* Ignore incomplete output. */ }
    }
  });
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, 5000);
    pending.set(id, result => { clearTimeout(timer); resolve(result); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const listed = await request(2, 'tools/list');
    assert.ok(listed.tools.some(tool => tool.name === 'workforce_usage'));
    const health = await request(3, 'tools/call', { name: 'workforce_health', arguments: {} });
    const details = JSON.parse(health.content[0].text);
    assert.equal(details.openCodeConfigured, true);
    assert.equal(details.openCodeModel, 'provider/test-model');
    assert.equal(details.routeVerification, 'configured only; provider inference metadata is not assumed');
    const usage = await request(4, 'tools/call', { name: 'workforce_usage', arguments: { scope: 'session' } });
    assert.equal(JSON.parse(usage.content[0].text).totalRequests, 0);
  } finally {
    child.stdin.end();
    await new Promise(resolve => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
