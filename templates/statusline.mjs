import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input = {};
try {
  input = JSON.parse(raw);
} catch {}

const root = input.workspace?.project_dir || input.cwd || process.cwd();
const color = (code, text) => `[${code}m${text}[0m`;
const parts = [color('36', 'web-dev')];

const branch = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 400 }).stdout?.trim();
if (branch) parts.push(branch);

let task = {};
try {
  task = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'web-dev', 'state', 'task.json'), 'utf8'));
} catch {}
const hasBrief = fs.existsSync(path.join(root, '.claude', 'web-dev', 'work', 'task.md'));
const state = hasBrief ? (task.approvedHash ? task.state || 'approved' : 'briefing') : task.state === 'closed' ? 'closed' : 'idle';
parts.push(`task: ${state}`);

const pct = input.context_window?.used_percentage;
if (typeof pct === 'number') {
  const rounded = Math.round(pct);
  const code = rounded >= 70 ? '31' : rounded >= 40 ? '33' : '32';
  parts.push(color(code, `ctx ${rounded}%`));
  if (state === 'closed' && rounded > 5) parts.push(color('35', '→ /clear before the next task'));
  else if (rounded >= 70) parts.push(color('31', '→ finish this task, then /clear'));
} else if (state === 'closed') {
  parts.push(color('35', '→ /clear before the next task'));
}
process.stdout.write(parts.join(' · '));
