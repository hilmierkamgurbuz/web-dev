import fs from 'node:fs';
import path from 'node:path';

export const SHIM_REL = '.claude/web-dev/wd.mjs';

function shimSource(cliPath) {
  return [
    "import { existsSync, readdirSync } from 'node:fs';",
    "import path from 'node:path';",
    "import os from 'node:os';",
    "import { pathToFileURL } from 'node:url';",
    '',
    `const pinned = ${JSON.stringify(cliPath)};`,
    '',
    'function discovered() {',
    "  const cache = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'web-dev', 'web-dev');",
    '  if (!existsSync(cache)) return null;',
    '  const found = [];',
    '  for (const name of readdirSync(cache)) {',
    "    const candidate = path.join(cache, name, 'scripts', 'wd.mjs');",
    '    if (existsSync(candidate)) found.push(candidate);',
    '  }',
    '  found.sort();',
    '  return found.pop() || null;',
    '}',
    '',
    'const target = existsSync(pinned) ? pinned : discovered();',
    'if (!target) {',
    "  console.error('web-dev: the plugin is not installed on this machine. Install it with:\\n  claude plugin marketplace add hilmierkamgurbuz/web-dev\\n  claude plugin install web-dev@web-dev');",
    '  process.exit(1);',
    '}',
    'await import(pathToFileURL(target).href);',
    '',
  ].join('\n');
}

export function pluginCli(pluginRoot) {
  return pluginRoot ? path.join(pluginRoot, 'scripts', 'wd.mjs') : null;
}

export function writeShim(root, pluginRoot) {
  const cli = pluginCli(pluginRoot);
  if (!cli) return { written: false, reason: 'plugin root unknown' };
  const file = path.join(root, SHIM_REL);
  const next = shimSource(cli);
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = null; }
  if (current === next) return { written: false, reason: 'current' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return { written: true, reason: current == null ? 'created' : 'plugin path changed' };
}
