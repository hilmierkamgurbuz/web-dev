import fs from 'node:fs';
import path from 'node:path';
import { pathMatches } from './extract/ast.mjs';
import { linkProject } from './extract/link.mjs';
import { findCycles, loadBlueprint } from './lib/blueprint.mjs';
import { loadConfig } from './lib/config.mjs';
import { readJson } from './lib/io.mjs';
import { loadNotes } from './lib/notes.mjs';
import { layout } from './lib/paths.mjs';
import { analyzeProject } from './lib/project.mjs';
import { detectStack } from './lib/stack.mjs';

function routeKey(route) {
  if (route.kind === 'http') return { kind: route.method, target: route.path };
  if (route.kind === 'action') return { kind: 'ACTION', target: route.key };
  if (route.kind === 'rpc') return { kind: route.method, target: route.key };
  return { kind: 'GQL', target: route.key };
}

function declaredInBlueprint(blueprint, kind, target) {
  return blueprint.routes.some((r) => {
    if (kind === 'PAGE' || /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)$/.test(kind)) {
      return (r.kind === kind || r.kind === 'ANY' || kind === 'ANY') && r.target.startsWith('/') && (r.target === target || pathMatches(r.target, target));
    }
    return r.kind === kind && r.target === target;
  });
}

export function checkBlueprint(root) {
  const L = layout(root);
  const findings = [];
  const add = (level, code, message) => findings.push({ level, code, message });
  const blueprint = loadBlueprint(root);
  if (!blueprint.present) {
    add('ERROR', 'BP-MISSING', 'blueprint.md does not exist: write it (bootstrap.md step 4 or adopt.md step 9)');
    return { findings, model: null };
  }
  const config = loadConfig(root);
  const stack = detectStack(root);
  const tags = config.frameworks?.length ? config.frameworks : stack.tags;
  const analysis = analyzeProject(root, { config, tags });
  if (!analysis.ok) {
    add('ERROR', 'BP-PARSER', 'parser missing: run wd setup');
    return { findings, model: null };
  }
  const model = linkProject(root, { files: analysis.files, tags, config, stack });
  const notes = loadNotes(root);
  const features = new Map(blueprint.features.map((f) => [f.sys, f]));
  const sysOf = (file) => {
    const sys = notes.files.get(file)?.sys;
    return sys && sys !== '-' ? sys : null;
  };

  const usedSys = new Map();
  for (const rel of analysis.fileList) {
    const sys = sysOf(rel);
    if (!sys) continue;
    if (!usedSys.has(sys)) usedSys.set(sys, []);
    usedSys.get(sys).push(rel);
  }
  for (const [sys, files] of usedSys) {
    if (!features.has(sys)) add('ERROR', 'BP-UNKNOWN-SYS', `sys "${sys}" is used by ${files.length} file(s) (${files.slice(0, 3).join(', ')}) but is not a feature in blueprint.md`);
  }
  for (const feature of blueprint.features) {
    if (!usedSys.has(feature.sys)) add('INFO', 'BP-PLANNED-FEATURE', `feature "${feature.sys}" has no code yet`);
    for (const dep of feature.deps) if (!features.has(dep)) add('WARN', 'BP-UNKNOWN-DEP', `feature "${feature.sys}" depends on "${dep}", which is not a feature`);
  }
  for (const cycle of findCycles(blueprint.features)) add('ERROR', 'BP-CYCLE', `dependency cycle: ${cycle.join(' → ')}`);

  const reported = new Set();
  for (const [from, targets] of model.importEdges) {
    const a = sysOf(from);
    if (!a || !features.has(a)) continue;
    const typeOnly = new Set((analysis.files.get(from)?.imports || []).filter((i) => i.typeOnly).map((i) => i.spec));
    for (const to of targets) {
      const b = sysOf(to);
      if (!b || b === a || !features.has(b)) continue;
      const viaTypeOnly = [...typeOnly].some((spec) => model.localImports.get(from) && [...model.localImports.get(from).values()].some((imp) => imp.spec === spec && imp.target === to));
      if (viaTypeOnly) continue;
      if (!features.get(a).deps.includes(b)) {
        const key = `${a}->${b}`;
        if (reported.has(key)) continue;
        reported.add(key);
        add('WARN', 'BP-UNDECLARED-DEP', `${a} → ${b} is not a blueprint arrow (e.g. ${from} imports ${to})`);
      }
    }
  }

  const routesOnDisk = [...model.routes.map(routeKey), ...model.pages.map((p) => ({ kind: 'PAGE', target: p.path }))];
  if (!blueprint.routes.length && routesOnDisk.length) {
    add('ERROR', 'BP-ROUTES-EMPTY', `blueprint.md lists no routes but ${routesOnDisk.length} exist; run wd check --draft-blueprint and record the inventory`);
  } else {
    for (const r of routesOnDisk) if (!declaredInBlueprint(blueprint, r.kind, r.target)) add('ERROR', 'BP-UNDECLARED-ROUTE', `${r.kind} ${r.target} exists but is not in the blueprint route inventory`);
    for (const r of blueprint.routes) {
      const built = routesOnDisk.some((d) => (d.kind === r.kind || r.kind === 'ANY' || d.kind === 'ANY') && (d.target === r.target || (r.target.startsWith('/') && d.target?.startsWith?.('/') && pathMatches(r.target, d.target))));
      if (!built) add('INFO', 'BP-PLANNED-ROUTE', `${r.kind} ${r.target} is planned but not built`);
    }
  }

  for (const table of model.tables) {
    const declared = blueprint.tables.find((t) => t.table === table.table || t.table === table.name);
    if (!declared) {
      add('ERROR', 'BP-UNDECLARED-TABLE', `table ${table.table} exists but is not in the blueprint table inventory`);
      continue;
    }
    const writerSys = [...new Set(table.writers.map((w) => sysOf(w.file)).filter(Boolean))];
    const foreign = writerSys.filter((s) => s !== declared.owner);
    if (foreign.length) add('WARN', 'BP-TABLE-OWNER', `table ${table.table} is owned by ${declared.owner} but written by ${foreign.join(', ')}`);
  }

  if (blueprint.folders.length) {
    const declaredTop = new Set(blueprint.folders.map((f) => f.split('/').slice(0, 2).join('/')));
    const actualTop = new Set();
    for (const rel of analysis.fileList) {
      const parts = rel.split('/');
      if (parts.length > 2) actualTop.add(parts.slice(0, 2).join('/'));
      else if (parts.length === 2) actualTop.add(parts[0]);
    }
    for (const dir of actualTop) {
      const covered = [...declaredTop].some((d) => d === dir || dir.startsWith(`${d}/`) || d.startsWith(`${dir}/`) || d.split('/')[0] === dir);
      if (!covered) add('WARN', 'BP-UNDECLARED-FOLDER', `${dir}/ holds code but is not in the blueprint folder layout`);
    }
  } else {
    add('WARN', 'BP-NO-LAYOUT', 'blueprint.md has no folder layout block');
  }

  const health = readJson(L.healthState, null);
  if (health?.counts) {
    for (const item of health.unmatched || []) add('ERROR', 'WD-API-UNMATCHED', item);
    for (const item of health.unauthenticated || []) add('ERROR', 'WD-API-UNAUTH', `${item} has no authentication and no declaration`);
    for (const item of health.unvalidated || []) add('ERROR', 'WD-API-UNVALIDATED', `${item} parses no input schema and has no declaration`);
    for (const item of health.multiWriter || []) add('ERROR', 'WD-DATA-MULTIWRITER', `table ${item} is written by more than one feature`);
    for (const item of health.envErrors || []) add('ERROR', 'WD-SEC-PUBLIC-ENV', item.replace(/^ERROR WD-SEC-PUBLIC-ENV /, ''));
    if (health.owed?.length) add('WARN', 'MAP-NOTES-OWED', `${health.owed.length} note(s) owed: wd note missing`);
    if (health.orphans?.length) add('WARN', 'MAP-ORPHANS', `${health.orphans.length} orphan note(s): delete them with wd note set {"key":…,"delete":true} or restore the symbol`);
  }
  return { findings, model, analysis };
}

export function draftBlueprint(root) {
  const config = loadConfig(root);
  const stack = detectStack(root);
  const tags = config.frameworks?.length ? config.frameworks : stack.tags;
  const analysis = analyzeProject(root, { config, tags });
  if (!analysis.ok) return 'parser missing: run wd setup';
  const model = linkProject(root, { files: analysis.files, tags, config, stack });
  const notes = loadNotes(root);
  const lines = ['## Routes'];
  for (const page of [...model.pages].sort((a, b) => a.path.localeCompare(b.path))) lines.push(`- PAGE ${page.path} — ${notes.files.get(page.file)?.sys || '<sys>'}`);
  for (const r of [...model.routes].sort((a, b) => `${a.path || a.key}`.localeCompare(`${b.path || b.key}`))) {
    const key = routeKey(r);
    lines.push(`- ${key.kind} ${key.target} — ${notes.files.get(r.file)?.sys || '<sys>'}`);
  }
  lines.push('', '## Tables');
  for (const t of model.tables) lines.push(`- ${t.table} — owner: ${[...new Set(t.writers.map((w) => notes.files.get(w.file)?.sys).filter(Boolean))][0] || '<sys>'}`);
  lines.push('', '## Folder layout', '```');
  const dirs = new Set();
  for (const rel of analysis.fileList) {
    const parts = rel.split('/');
    for (let depth = 1; depth <= Math.min(3, parts.length - 1); depth++) dirs.add(parts.slice(0, depth).join('/'));
  }
  for (const dir of [...dirs].sort()) lines.push(`${'  '.repeat(dir.split('/').length - 1)}${dir.split('/').pop()}/`);
  lines.push('```', '', '## Feature candidates (top-level code directories)');
  const candidates = new Set();
  for (const rel of analysis.fileList) {
    const m = /(?:^|\/)(?:features|modules|domains)\/([^/]+)\//.exec(rel);
    if (m) candidates.add(m[1]);
  }
  for (const c of [...candidates].sort()) lines.push(`- ${c} — <responsibility> → depends on: -`);
  if (!candidates.size) lines.push('- none found under features/, modules/ or domains/; propose features from the route groups above');
  return lines.join('\n');
}

export function formatCheck(findings, limit = 40) {
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const errors = findings.filter((f) => f.level === 'ERROR').length;
  const warnings = findings.filter((f) => f.level === 'WARN').length;
  const lines = sorted.slice(0, limit).map((f) => `${f.level} ${f.code} ${f.message}`);
  if (sorted.length > limit) lines.push(`… ${sorted.length - limit} more finding(s)`);
  lines.push(`${errors} error(s), ${warnings} warning(s)`);
  return { text: lines.join('\n'), errors, warnings };
}

export function listDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  } catch {
    return [];
  }
}
