import fs from 'node:fs';
import path from 'node:path';
import { currentSymbols, findSymbol, mapForPath, renderMaps } from './build_maps.mjs';
import { checkBlueprint, draftBlueprint, formatCheck } from './check_blueprint.mjs';
import { checkDocs, factsReport, nextId } from './check_docs.mjs';
import { loadBlueprint } from './lib/blueprint.mjs';
import { parseBrief, validateBrief } from './lib/brief.mjs';
import { loadConfig } from './lib/config.mjs';
import { showFile } from './lib/git.mjs';
import { ensureDir, exists, findProjectRoot, readJson, readStdin, readText, toPosix, writeText } from './lib/io.mjs';
import { applyEntries, loadNotes, saveNotes } from './lib/notes.mjs';
import { layout } from './lib/paths.mjs';
import { projectFiles, projectTags } from './lib/project.mjs';
import { branchFiles, buildDiff } from './lib/review.mjs';
import { loadShards, shardOf } from './lib/shards.mjs';
import { approval, classifySize, readTask, readTurn, writeTask } from './lib/state.mjs';
import { installParser, loadTs, PARSER_VERSION } from './lib/ts.mjs';
import { runResponsive } from './responsive_check.mjs';
import { isClientPath, scanContent } from './security/scan.mjs';
import { runVerify } from './verify.mjs';

const root = findProjectRoot(process.cwd()) || process.cwd();
const [command, ...args] = process.argv.slice(2);
const L = layout(root);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const WD_SELF = 'node .claude/web-dev/wd.mjs';
const out = (text) => process.stdout.write(`${text}\n`);
const fail = (text, code = 1) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};

function requireParser() {
  if (!loadTs()) fail(`the parser is not installed on this machine: node .claude/web-dev/wd.mjs setup`);
}

function cmdMaps() {
  requireParser();
  const health = renderMaps(root, { force: flag('--force') });
  const c = health.counts || {};
  out(`maps: ${health.status} · ${c.files} files · ${c.symbols} symbols · ${health.owed.length} note(s) owed · ${c.orphan} orphan · ${c.routes} routes (${c.unmatched} unmatched, ${c.unresolved} unresolved, ${c.unauthenticated} unauthenticated, ${c.unvalidated} unvalidated) · ${c.tables} tables · ${c.envErrors} env error(s)`);
  for (const line of health.owed.slice(0, 30)) out(`- ${line}`);
  if (health.owed.length > 30) out(`- … ${health.owed.length - 30} more (wd note missing)`);
}

async function cmdNote() {
  const sub = args[0];
  if (sub === 'set') {
    requireParser();
    const raw = (await readStdin()).trim();
    if (!raw) fail('wd note set reads JSON lines on stdin: {"key":"path#symbol","note":"…"} or {"key":"path","role":"…","sys":"…","crit":"K2"}');
    let entries = [];
    try {
      entries = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch (error) {
      fail(`invalid JSON on stdin: ${error.message}`);
    }
    const files = [...new Set(entries.map((e) => String(e.key || '').split('#')[0]).filter(Boolean))];
    const current = currentSymbols(root, files);
    const blueprint = loadBlueprint(root);
    const features = new Set(blueprint.features.map((f) => f.sys));
    const notes = loadNotes(root);
    const shards = loadShards(root);
    const result = applyEntries(notes, entries, {
      symbolHash: (key) => current?.symbols.get(key)?.hash ?? null,
      fileExists: (rel) => exists(path.join(root, rel)),
      validSys: features.size ? (sys) => features.has(sys) : null,
    });
    saveNotes(root, notes, (rel) => shardOf(rel, shards));
    out(`notes: ${result.written} written, ${result.deleted} deleted`);
    for (const w of result.warnings) out(`warning: ${w}`);
    for (const e of result.errors) out(`error: ${e}`);
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  if (sub === 'missing') {
    requireParser();
    const health = renderMaps(root);
    const shard = option('--shard');
    const shards = loadShards(root);
    const turnOnly = flag('--turn');
    const turnWrites = new Set(readTurn(root).writes || []);
    const owed = health.owed.filter((entry) => {
      const file = entry.split(' (')[0].split('#')[0];
      if (shard && shardOf(file, shards) !== shard) return false;
      if (turnOnly && !turnWrites.has(file)) return false;
      return true;
    });
    for (const line of owed) out(`- ${line}`);
    for (const orphan of shard || turnOnly ? [] : health.orphans) out(`- ${orphan} (ORPHAN)`);
    out(`${owed.length} missing${health.orphans.length && !shard && !turnOnly ? `, ${health.orphans.length} orphan` : ''}`);
    return;
  }
  fail('usage: wd note set < entries.jsonl | wd note missing [--shard <name>] [--turn]');
}

function cmdTask() {
  const sub = args[0];
  const text = readText(L.task);
  if (sub === 'hash') {
    if (text == null) fail('no brief at .claude/web-dev/work/task.md');
    const status = approval(root);
    const problems = validateBrief(parseBrief(text));
    out(status.hash.slice(0, 8));
    if (problems.length) process.stderr.write(`not approvable yet: ${problems.join('; ')}\n`);
    return;
  }
  if (sub === 'status') {
    const task = readTask(root);
    if (text == null) {
      out(`task: ${task.state === 'closed' ? `closed "${task.title}"${task.pr ? ` · ${task.pr}` : ''}` : 'none'}`);
      return;
    }
    const status = approval(root);
    const brief = status.brief;
    out(`task: "${brief.title}" · state ${status.ok ? task.state : 'briefing'} · brief ${status.hash.slice(0, 8)} ${status.ok ? 'approved' : `not approved (${status.reason})`}`);
    out(`branch: ${brief.branch || '-'} · manifest: ${brief.manifest.length} path(s)${brief.generated.length ? ` + ${brief.generated.length} generated glob(s)` : ''} · dependencies: ${brief.dependencies.join(', ') || '-'} · exceptions: ${brief.exceptions.length}`);
    const problems = validateBrief(brief);
    if (problems.length) out(`brief problems: ${problems.join('; ')}`);
    return;
  }
  fail('usage: wd task hash | wd task status');
}

function cmdCheck() {
  requireParser();
  if (flag('--draft-blueprint')) {
    out(draftBlueprint(root));
    return;
  }
  renderMaps(root);
  const findings = [...checkBlueprint(root).findings, ...checkDocs(root)];
  const report = formatCheck(findings);
  out(report.text);
  if (report.errors) process.exitCode = 1;
}

function cmdVerify() {
  const record = runVerify(root, { log: (line) => process.stderr.write(`${line}\n`) });
  out(record.summary);
  for (const r of record.results.filter((x) => x.status === 'failed' || x.status === 'timeout' || x.status === 'missing')) {
    out(`\n--- ${r.name}${r.command ? ` (${r.command})` : ''}: ${r.status}`);
    if (r.status === 'missing') out('config.json commands.test is empty: behavior changes need a test command (tests are mandatory)');
    else out(r.tail);
  }
  if (!record.ok) process.exitCode = 1;
}

async function cmdResponsive() {
  const paths = [];
  args.forEach((a, i) => a === '--path' && args[i + 1] && paths.push(args[i + 1]));
  const record = await runResponsive(root, { paths, baseUrl: option('--url'), log: (line) => process.stderr.write(`${line}\n`) });
  out(record.summary);
  for (const detail of record.details || []) {
    out(`${detail.ok ? '✓' : '✗'} ${detail.path} @ ${detail.viewport} → ${detail.screenshot}`);
    for (const f of detail.findings) out(`    - ${f}`);
  }
  if (record.infra) process.exitCode = 2;
  else if (!record.ok) process.exitCode = 1;
}

function cmdScan() {
  requireParser();
  const ts = loadTs();
  const config = loadConfig(root);
  const tags = projectTags(root, config);
  const all = flag('--all');
  const files = all ? projectFiles(root, config) : args.filter((a) => !a.startsWith('--'));
  const brief = readText(L.task) ? parseBrief(readText(L.task)) : null;
  const byRule = new Map();
  let total = 0;
  for (const rel of files) {
    const text = readText(path.join(root, rel));
    if (text == null) continue;
    const { findings } = scanContent({ ts, root: all ? null : root, rel, newText: text, oldText: all ? null : showFile(root, 'HEAD', rel), config, brief, tags, clientFile: isClientPath(rel, text, tags) });
    const relevant = all ? findings.filter((f) => f.rule !== 'WD-COMMENT') : findings;
    for (const f of relevant) {
      total++;
      if (!byRule.has(f.rule)) byRule.set(f.rule, []);
      byRule.get(f.rule).push(`${rel}:${f.line} ${f.message}`);
      if (!flag('--report')) out(`${f.rule} ${rel}:${f.line} ${f.message} → ${f.fix}`);
    }
  }
  if (flag('--report')) {
    for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
      out(`${rule} × ${list.length}`);
      for (const item of list.slice(0, 5)) out(`  - ${item}`);
    }
  }
  out(`scan: ${files.length} file(s), ${total} finding(s)`);
  if (total && !all) process.exitCode = 1;
}

function cmdReviewPrep() {
  const config = loadConfig(root);
  const diff = buildDiff(root, config);
  ensureDir(L.reviewDir);
  writeText(path.join(L.reviewDir, 'diff.patch'), diff.patch);
  writeText(path.join(L.reviewDir, 'diff.hash'), `${diff.hash}\n`);
  const notes = loadNotes(root);
  const changed = new Set(diff.files);
  const verify = readJson(L.verifyState, null);
  const responsive = readJson(L.responsiveState, null);
  const lines = ['# Review context', '', `Diff: ${diff.files.length} file(s) against ${diff.base} · hash ${diff.hash.slice(0, 8)}`, ''];
  lines.push('## Recorded results', `- ${verify?.summary || 'verify: not run'}`, `- ${responsive?.summary || 'responsive: not run'}`);
  for (const detail of (responsive?.details || []).filter((d) => !d.ok)) lines.push(`  - ${detail.path} @ ${detail.viewport}: ${detail.findings.join('; ')}`);
  lines.push('', '## Notes for changed files');
  for (const [key, header] of notes.files) if (changed.has(key)) lines.push(`${key} | role: ${header.role} | sys: ${header.sys} | crit: ${header.crit}`);
  for (const [key, entry] of notes.symbols) if (changed.has(key.split('#')[0])) lines.push(`${key} | ${entry.note}`);
  for (const mapName of ['apimap.md', 'datamap.md']) {
    const text = readText(path.join(L.maps, mapName));
    if (!text) continue;
    const relevant = text.split('\n').filter((l) => [...changed].some((f) => l.includes(f)));
    if (relevant.length) lines.push('', `## ${mapName} lines touching changed files`, ...relevant.slice(0, 60));
  }
  writeText(path.join(L.reviewDir, 'context.md'), `${lines.join('\n')}\n`);
  out(`review-prep: ${diff.files.length} file(s) · diff ${diff.hash.slice(0, 8)} · .claude/web-dev/state/review/diff.patch and context.md are ready for the web-dev-reviewer subagent`);
}

const PR_TEMPLATE = `## Summary
{{goal}}

## Request
{{request}}

## Acceptance
{{acceptance}}

## Decisions
{{decisions}}

## Changes
{{manifest}}

## Verification
- Tests: {{verify}}
- Responsive: {{responsive}}
- Review: {{review}}
- Maps: {{maps}}

## Security
{{security}}

## Durable records
{{durable}}

<sub>Prepared with web-dev.</sub>
`;

function cmdPrBody() {
  const text = readText(L.task);
  if (text == null) fail('no brief at .claude/web-dev/work/task.md');
  const brief = parseBrief(text);
  const section = (name) => (brief.sections.get(name) || []).join('\n').trim() || '-';
  const postflight = readText(L.postflight) || '';
  const verify = readJson(L.verifyState, null);
  const responsive = readJson(L.responsiveState, null);
  const review = readJson(L.reviewState, null);
  const health = readJson(L.healthState, null);
  const acceptance = brief.acceptance.map((a) => `- [x] ${a}`).join('\n') || '-';
  const values = {
    goal: brief.goal || brief.title,
    request: section('Request (verbatim)'),
    acceptance: postflight.includes('## Acceptance evidence') ? `${acceptance}\n\n${postflight.split('## Acceptance evidence')[1].split('\n## ')[0].trim()}` : acceptance,
    decisions: section('Decisions'),
    manifest: [...brief.manifest.map((m) => `- \`${m}\``), ...brief.generated.map((g) => `- generated: \`${g}\``)].join('\n') || '-',
    verify: verify?.summary || 'not run',
    responsive: responsive?.summary || 'no UI change',
    review: review ? `web-dev-reviewer VERDICT: ${review.verdict}` : 'not run',
    maps: health ? `${health.status}, ${health.owed?.length || 0} note(s) owed` : 'not rendered',
    security: section('Risk'),
    durable: brief.durable.join(', ') || '-',
  };
  const body = PR_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '-');
  writeText(L.prBody, body);
  out(body);
}

function cmdFacts() {
  const findings = factsReport(root);
  for (const f of findings) out(`${f.level} ${f.message}`);
  out(`facts: ${findings.filter((f) => f.level !== 'INFO').length} stale or orphaned`);
}

function cmdId() {
  const prefix = (args[0] || '').toUpperCase();
  if (prefix !== 'D' && prefix !== 'R') fail('usage: wd id D | wd id R');
  out(nextId(root, prefix));
}

function cmdSetup() {
  const ts = loadTs() || installParser();
  if (!ts) fail('parser installation failed');
  out(`parser ready: typescript ${PARSER_VERSION}`);
}

function cmdMap() {
  requireParser();
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail("usage: wd map <path>");
  const entry = mapForPath(root, toPosix(path.relative(root, path.resolve(root, target))));
  if (!entry.ok) {
    fail(entry.reason === 'parser-missing'
      ? `the parser is not installed on this machine: ${WD_SELF} setup`
      : `${target} is not in any map. Run ${WD_SELF} maps; if it stays missing the file is outside the analysed set (check .claude/web-dev/shards.json and config.generated).`);
  }
  out(`# codemap: ${entry.shard}\n${entry.block}`);
}

function cmdFind() {
  requireParser();
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) fail("usage: wd find <symbol>");
  const result = findSymbol(root, name);
  if (!result.ok) fail(`the parser is not installed on this machine: ${WD_SELF} setup`);
  if (!result.matches.length) fail(`no symbol named ${name} is in the maps. It may be unexported, generated, or not yet rendered: ${WD_SELF} maps.`);
  for (const hit of result.matches) out(`${hit.file}\n${hit.line}`);
}

function cmdClass() {
  const locate = readText(L.locate);
  const brief = exists(L.task) ? parseBrief(readText(L.task)) : null;
  const result = classifySize(locate, brief);
  out(`${result.size}\n${result.reasons.map((r) => `- ${r}`).join("\n")}`);
  writeTask(root, { size: result.size });
}

function cmdConfig() {
  const [action, key, ...rest] = args.filter((a) => !a.startsWith('--'));
  const current = readJson(L.config, null);
  if (!current) fail('no .claude/web-dev/config.json: run the installer first');
  if (action !== 'set') {
    out(JSON.stringify(current, null, 2));
    return;
  }
  if (!key) fail('usage: wd config set <dotted.key> <value>');
  const value = rest.join(' ');
  if (!value) fail(`usage: wd config set ${key} <value>`);
  const parts = key.split('.');
  if (parts[0].startsWith('_')) fail('keys starting with _ are comments and are not settable');
  let node = current;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) fail(`${key} is not a settable path: ${part} does not hold an object`);
    node = node[part];
  }
  const leaf = parts.at(-1);
  if (!(leaf in node)) fail(`${key} is not a key config.json already defines; the gate reads this file, so new keys are added by the user, not by a command`);
  let parsed = value;
  if (value === 'true' || value === 'false') parsed = value === 'true';
  else if (/^-?\d+$/.test(value)) parsed = Number(value);
  else if (value.startsWith('[') || value.startsWith('{')) {
    try { parsed = JSON.parse(value); } catch { fail(`${value} is not valid JSON`); }
  }
  if (typeof parsed !== typeof node[leaf] && node[leaf] !== null && !Array.isArray(node[leaf])) {
    fail(`${key} holds a ${Array.isArray(node[leaf]) ? 'list' : typeof node[leaf]}; ${JSON.stringify(parsed)} is a ${typeof parsed}`);
  }
  const before = node[leaf];
  node[leaf] = parsed;
  writeText(L.config, `${JSON.stringify(current, null, 2)}\n`);
  out(`config.json ${key}: ${JSON.stringify(before)} → ${JSON.stringify(parsed)}`);
}

function cmdDefer() {
  const item = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!item) fail(`usage: wd defer "<what was left out of scope>"`);
  ensureDir(path.dirname(L.deferred));
  const current = readText(L.deferred) || "";
  writeText(L.deferred, `${current.replace(/\s*$/, "")}${current ? "\n" : ""}- ${item}\n`);
  out(`deferred: ${item}`);
}

const HELP = `wd — web-dev harness CLI (run from the project root)
  map <path>                     one file's map entry — the default way to read a map
  find <symbol>                  every map line for a symbol name
  class                          the task class (touch | task | arch) from the locate result
  config [set <key> <value>]     read config.json, or change one key it already defines
  defer "<item>"                 queue something out of scope for after /clear
  maps [--force]                 render maps
  note set < jsonl               write notes (keys: path#symbol or path)
  note missing [--shard s] [--turn]
  task hash | task status
  check [--draft-blueprint]      blueprint/docs checks ("n error(s), m warning(s)")
  verify                         typecheck, lint, test, build
  responsive [--path /x]... [--url base]
  scan <files…> | scan --all --report
  review-prep                    prepare the reviewer's diff and context
  pr-body                        PR description from the brief and results
  facts check                    version-pinned facts vs lockfile
  id D | id R                    next free decision / requirement id
  setup                          install the pinned parser for this machine`;

const commands = {
  map: cmdMap,
  find: cmdFind,
  class: cmdClass,
  config: cmdConfig,
  defer: cmdDefer,
  maps: cmdMaps,
  note: cmdNote,
  task: cmdTask,
  check: cmdCheck,
  verify: cmdVerify,
  responsive: cmdResponsive,
  scan: cmdScan,
  'review-prep': cmdReviewPrep,
  'pr-body': cmdPrBody,
  facts: cmdFacts,
  id: cmdId,
  setup: cmdSetup,
};

if (!commands[command]) {
  out(HELP);
  process.exit(command && command !== 'help' ? 1 : 0);
}
await commands[command]();
