import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { writeJson } from './lib/io.mjs';
import { layout } from './lib/paths.mjs';
import { treeHash } from './lib/review.mjs';

const STEPS = ['typecheck', 'lint', 'test', 'build'];

function tail(text, lines) {
  return text.split('\n').filter((l) => l.trim()).slice(-lines).join('\n');
}

function testDetail(output) {
  const clean = output.replace(/\[[0-9;]*m/g, '');
  const passed = /(\d+)\s+(?:tests?\s+)?passed/i.exec(clean) || /# pass\s+(\d+)/.exec(clean);
  const failed = /(\d+)\s+(?:tests?\s+)?failed/i.exec(clean) || /# fail\s+([1-9]\d*)/.exec(clean);
  const parts = [];
  if (passed) parts.push(`${passed[1]} passed`);
  if (failed && failed[1] !== '0') parts.push(`${failed[1]} failed`);
  return parts.join(', ');
}

export function runVerify(root, { log = () => {} } = {}) {
  const config = loadConfig(root);
  const results = [];
  for (const name of STEPS) {
    const command = config.commands?.[name];
    if (!command) {
      results.push({ name, status: name === 'test' ? 'missing' : 'skipped', command: '' });
      continue;
    }
    log(`→ ${name}: ${command}`);
    const started = Date.now();
    const run = spawnSync(command, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    const timedOut = run.error?.code === 'ETIMEDOUT';
    const ok = run.status === 0 && !timedOut;
    results.push({
      name,
      command,
      status: ok ? 'ok' : timedOut ? 'timeout' : 'failed',
      exitCode: run.status,
      ms: Date.now() - started,
      detail: name === 'test' ? testDetail(output) : '',
      tail: ok ? '' : tail(output, 40),
    });
  }
  const ok = results.every((r) => r.status === 'ok' || r.status === 'skipped');
  const summary = `verify: ${results.map((r) => `${r.name} ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join(' · ')}`;
  const record = { at: new Date().toISOString(), tree: treeHash(root), ok, summary, results };
  writeJson(layout(root).verifyState, record);
  return record;
}
