import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(PLUGIN, 'tests', 'fixtures');

export function sh(cwd, command, args, options = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
}

export function git(cwd, ...args) {
  const result = sh(cwd, 'git', ['-c', 'user.email=test@web-dev', '-c', 'user.name=web-dev-test', ...args]);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function tempProject(fixture = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dev-test-'));
  if (fixture) fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
  else fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'empty', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'baseline');
  return dir;
}

export function writeFile(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function readFile(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

export function initHarness(dir) {
  const result = sh(dir, process.execPath, [path.join(PLUGIN, 'scripts', 'init_project.mjs'), dir]);
  if (result.status !== 0) throw new Error(`init failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function runHook(dir, event, input = {}) {
  const result = sh(dir, process.execPath, [path.join(dir, '.claude', 'hooks', 'web-dev', 'hook.mjs'), event], {
    input: JSON.stringify({ session_id: 'session-1', cwd: dir, permission_mode: 'default', ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  if (result.status !== 0) throw new Error(`hook ${event} exited ${result.status}: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export function wd(dir, args, stdin = '') {
  return sh(dir, process.execPath, [path.join(dir, '.claude', 'hooks', 'web-dev', 'wd.mjs'), ...args], { input: stdin });
}

export function decisionOf(output) {
  return output?.hookSpecificOutput?.permissionDecision || null;
}

export function contextOf(output) {
  return output?.hookSpecificOutput?.additionalContext || '';
}

export const SAMPLE_BRIEF = ({ branch = 'feat/order-note', manifest = ['src/features/orders/note.ts', 'src/features/orders/note.test.ts'], dependencies = '-', exceptions = '-', open = false } = {}) => `# Brief: Add order note

## Request (verbatim)
> siparişe not alanı ekle

## Understanding
- Goal: a buyer can store a short note on an order
- In scope: note service function and its test
- Out of scope: UI
- Located: step 4 · feature: orders
- Attachment point: src/features/orders

## Decisions
- Q: maximum length? → A: ${open ? '[OPEN]' : '500 characters'} · by: user

## Acceptance
- [ ] a note of up to 500 characters is saved

## Design
- Data source: -

## Risk
- Security: input is validated by length
- Security exceptions: ${exceptions}
- Migrations: -
- Dependencies: ${dependencies}
- Assumptions: -

## Verification
- Tests: src/features/orders/note.test.ts
- Responsive: -
- Map repairs: -

## Git
- Branch: ${branch}

## Durable
- -

## Manifest
${manifest.map((m) => `- ${m}`).join('\n')}
`;
