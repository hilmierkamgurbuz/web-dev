import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from './lib/config.mjs';
import { headSha, isRepo } from './lib/git.mjs';
import { ensureDir, exists, readJson, readText, writeJson, writeText } from './lib/io.mjs';
import { layout } from './lib/paths.mjs';
import { DEFAULT_SHARDS } from './lib/shards.mjs';
import { SHIM_REL, writeShim } from './lib/shim.mjs';
import { detectStack } from './lib/stack.mjs';
import { installParser, loadTs, PARSER_VERSION } from './lib/ts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');
const TEMPLATES = path.join(PLUGIN, 'templates');
const MIN_CLAUDE = [2, 1, 200];
const log = (line = '') => process.stdout.write(`${line}\n`);
const warnings = [];

function fatal(message) {
  process.stderr.write(`web-dev init: ${message}\nNothing was written.\n`);
  process.exit(1);
}

function copyIfAbsent(from, to, label) {
  if (exists(to)) {
    log(`  kept     ${label}`);
    return false;
  }
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  log(`  created  ${label}`);
  return true;
}

function tailoredShards(tags) {
  const shards = JSON.parse(JSON.stringify(DEFAULT_SHARDS));
  const serverFramework = ['express', 'fastify', 'hono', 'koa', 'nest'].some((t) => tags.includes(t));
  const fileRouting = ['sveltekit', 'remix', 'react-router'].some((t) => tags.includes(t));
  if (fileRouting) shards.find((s) => s.name === 'ui').patterns.unshift('**/routes/**');
  else if (serverFramework) shards.find((s) => s.name === 'server').patterns.unshift('**/routes/**', '**/modules/**');
  return { _comment: 'Path pattern -> codemap shard. First match wins; the last entry is the catch-all. `**/` matches zero or more directories, `*` does not cross `/`.', shards };
}

function mergeSettings(target, template) {
  const current = readJson(target, null);
  if (!current) {
    writeJson(target, template);
    return 'created';
  }
  fs.copyFileSync(target, `${target}.web-dev.bak`);
  const merged = { ...current };
  merged.permissions = { ...(current.permissions || {}) };
  merged.permissions.deny = [...new Set([...(current.permissions?.deny || []), ...template.permissions.deny])];
  const stale = Object.entries(merged.hooks || {}).map(([event, groups]) => [event, (groups || []).filter((group) => !(group.hooks || []).some((h) => JSON.stringify(h).includes('hooks/web-dev/hook.mjs')))]);
  if (stale.length) merged.hooks = Object.fromEntries(stale.filter(([, groups]) => groups.length));
  if (merged.hooks && !Object.keys(merged.hooks).length) delete merged.hooks;
  if (template.statusLine && !current.statusLine) merged.statusLine = template.statusLine;
  merged.extraKnownMarketplaces = { ...(template.extraKnownMarketplaces || {}), ...(current.extraKnownMarketplaces || {}) };
  merged.enabledPlugins = { ...(template.enabledPlugins || {}), ...(current.enabledPlugins || {}) };
  writeJson(target, merged);
  return 'merged (backup: settings.json.web-dev.bak)';
}

function versionAtLeast(text, min) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text || '');
  if (!m) return true;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

const args = process.argv.slice(2);
const target = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const wantSetup = args.includes('--setup');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fatal(`Node ${process.versions.node} is too old; web-dev needs Node 20 or newer`);
if (spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0) fatal('git is not installed or not on PATH');
if (!exists(target)) fatal(`${target} does not exist`);
if (!isRepo(target)) fatal(`${target} is not a git repository: run git init -b main first (procedures/bootstrap.md step 6)`);

const L = layout(target);
const stack = detectStack(target);
log(`web-dev init → ${target}`);
log(`detected: ${stack.tags.join(', ') || 'no known frameworks'} · package manager ${stack.packageManager}${stack.workspaces.length ? ` · workspaces ${stack.workspaces.join(', ')}` : ''} · default branch ${stack.defaultBranch}`);
log(`commands: ${Object.entries(stack.commands).map(([k, v]) => `${k}=${v || '∅'}`).join(' · ')}`);

log('\nharness link (the gates already run; this only gives the project a CLI):');
if (exists(L.hooks)) {
  fs.rmSync(L.hooks, { recursive: true, force: true });
  log('  removed  .claude/hooks/web-dev/ (v1 copied the scripts here; v2 runs them from the plugin, so the copy can no longer go stale)');
}
writeShim(target, PLUGIN);
log(`  wrote    ${SHIM_REL} → ${path.join(PLUGIN, 'scripts', 'wd.mjs')}`);
fs.copyFileSync(path.join(TEMPLATES, 'statusline.mjs'), path.join(L.wd, 'statusline.mjs'));
log('  wrote    .claude/web-dev/statusline.mjs');
for (const agent of ['web-dev-reviewer.md', 'web-dev-annotator.md']) {
  ensureDir(L.agents);
  fs.copyFileSync(path.join(TEMPLATES, 'agents', agent), path.join(L.agents, agent));
  log(`  wrote    .claude/agents/${agent}`);
}
const exploreTarget = path.join(L.agents, 'Explore.md');
if (exists(exploreTarget) && readText(exploreTarget) !== readText(path.join(TEMPLATES, 'agents', 'Explore.md'))) {
  fs.copyFileSync(path.join(TEMPLATES, 'agents', 'Explore.md'), `${exploreTarget}.web-dev.new`);
  warnings.push('.claude/agents/Explore.md already exists and differs; the web-dev version is at Explore.md.web-dev.new — merge it so delegated searches stay map-first');
} else {
  copyIfAbsent(path.join(TEMPLATES, 'agents', 'Explore.md'), exploreTarget, '.claude/agents/Explore.md');
}

const settingsTemplate = readJson(path.join(TEMPLATES, 'settings.json'), null);
const userSettings = readJson(path.join(os.homedir(), '.claude', 'settings.json'), {}) || {};
if (!userSettings.statusLine) settingsTemplate.statusLine = { type: 'command', command: 'node .claude/web-dev/statusline.mjs' };
log(`  settings .claude/settings.json ${mergeSettings(L.settings, settingsTemplate)}`);
copyIfAbsent(path.join(TEMPLATES, 'enforce.json'), L.enforce, '.claude/web-dev/enforce.json');

log('\nproject state (created only when absent):');
if (!exists(L.config)) {
  const config = { _comment: DEFAULT_CONFIG._comment, ...JSON.parse(readText(path.join(TEMPLATES, 'config.json'))) };
  config.defaultBranch = stack.defaultBranch;
  config.packageManager = stack.packageManager;
  config.commands = { ...config.commands, ...Object.fromEntries(Object.entries(stack.commands).filter(([, v]) => v)) };
  config.devUrl = stack.devUrl;
  config.baseline = headSha(target) || '';
  writeJson(L.config, config);
  log('  created  .claude/web-dev/config.json');
} else {
  log('  kept     .claude/web-dev/config.json');
}
if (!exists(L.shards)) {
  writeJson(L.shards, tailoredShards(stack.tags));
  log('  created  .claude/web-dev/shards.json');
} else {
  log('  kept     .claude/web-dev/shards.json');
}
for (const name of ['product.md', 'stack.md', 'decisions.md', 'blueprint.md']) copyIfAbsent(path.join(TEMPLATES, name), path.join(L.wd, name), `.claude/web-dev/${name}`);
copyIfAbsent(path.join(TEMPLATES, 'CLAUDE.md'), L.memory, '.claude/web-dev/CLAUDE.md');
for (const dir of [L.notes, L.facts]) {
  ensureDir(dir);
  if (!fs.readdirSync(dir).length) writeText(path.join(dir, '.gitkeep'), '');
}
for (const rule of fs.readdirSync(path.join(TEMPLATES, 'rules'))) copyIfAbsent(path.join(TEMPLATES, 'rules', rule), path.join(L.rules, rule), `.claude/rules/${rule}`);

const rootMemory = path.join(target, 'CLAUDE.md');
const importLine = '@.claude/web-dev/CLAUDE.md';
const memoryText = readText(rootMemory);
if (memoryText == null) {
  writeText(rootMemory, `# Project memory\n\n${importLine}\n`);
  log('  created  CLAUDE.md (imports .claude/web-dev/CLAUDE.md)');
} else if (!memoryText.includes(importLine)) {
  writeText(rootMemory, `${memoryText.replace(/\s*$/, '')}\n\n${importLine}\n`);
  log('  updated  CLAUDE.md (added the web-dev import)');
}

const gitignorePath = path.join(target, '.gitignore');
const ignoreText = readText(gitignorePath) || '';
const wanted = (readText(path.join(TEMPLATES, 'gitignore')) || '').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const missing = wanted.filter((l) => !ignoreText.split('\n').includes(l));
if (missing.length) {
  writeText(gitignorePath, `${ignoreText.replace(/\s*$/, '')}${ignoreText ? '\n\n' : ''}# web-dev\n${missing.join('\n')}\n`);
  log(`  updated  .gitignore (+${missing.length} line(s))`);
}

log('\nchecks:');
let ts = loadTs();
if (!ts && wantSetup) {
  log(`  installing parser typescript@${PARSER_VERSION} into the user cache…`);
  ts = installParser({ quiet: true });
}
log(`  parser   ${ts ? `typescript ${PARSER_VERSION} ready` : 'missing — run: node .claude/web-dev/wd.mjs setup'}`);
for (const file of [path.join(os.homedir(), '.claude', 'settings.json'), L.settings, path.join(L.claude, 'settings.local.json')]) {
  if (readJson(file, {})?.disableAllHooks === true) warnings.push(`${file} sets disableAllHooks: true — no web-dev gate will run`);
}
const claude = spawnSync('claude', ['--version'], { encoding: 'utf8' });
if (claude.status === 0 && !versionAtLeast(claude.stdout, MIN_CLAUDE)) warnings.push(`Claude Code ${claude.stdout.trim()} is older than ${MIN_CLAUDE.join('.')}; update it so every hook event is available`);
if (!stack.commands.test) warnings.push('no test script was found: set commands.test in .claude/web-dev/config.json (tests are mandatory when behavior changes)');
if (!stack.deps.has('@playwright/test')) warnings.push('@playwright/test is not a dependency: wd responsive needs it (propose it in the first brief)');

if (ts) {
  try {
    const { renderMaps } = await import('./build_maps.mjs');
    const health = renderMaps(target, { force: true });
    log(`  maps     ${health.status} · ${health.counts.files} files · ${health.counts.symbols} symbols · ${health.owed.length} note(s) owed`);
  } catch (error) {
    warnings.push(`first map render failed: ${error.message}`);
  }
}

for (const w of warnings) log(`  warning  ${w}`);
log(`
next:
  1. commit the harness: git add .claude CLAUDE.md .gitignore && git commit -m "chore: add web-dev harness"
  2. the gates are already live in this session — .claude/web-dev/ is what arms them, and it now exists
  3. the [web-dev] line appears at the start of the next session; /hooks lists the plugin hooks if you want to see them
  4. continue with procedures/adopt.md for an existing codebase, or procedures/bootstrap.md for a new one`);
