import fs from 'node:fs';
import path from 'node:path';
import { linkProject, MUTATING } from './extract/link.mjs';
import { loadBlueprint } from './lib/blueprint.mjs';
import { loadConfig } from './lib/config.mjs';
import { headSha, headShort, statusEntries } from './lib/git.mjs';
import { sha256 } from './lib/hash.mjs';
import { exists, mtimeMs, readJson, readText, writeJson, writeText } from './lib/io.mjs';
import { loadNotes, saveNotes } from './lib/notes.mjs';
import { withLock } from './lib/lock.mjs';
import { layout } from './lib/paths.mjs';
import { analyzeProject, analyzerFingerprint, projectFiles, projectTags } from './lib/project.mjs';
import { estimateTokens, loadShards, partName, shardBudget, shardOf, splitByBudget } from './lib/shards.mjs';
import { detectStack } from './lib/stack.mjs';

export const RENDER_VERSION = 2;
const LIST_LIMIT = 8;
const DEAD_ROUTE_EXEMPT = /(webhook|health|cron|callback|oauth|auth\/|sitemap|robots|\.xml|\.txt|favicon|manifest)/i;

function listOf(items, limit = LIST_LIMIT) {
  const arr = [...items];
  if (!arr.length) return '-';
  return arr.slice(0, limit).join(', ') + (arr.length > limit ? `, +${arr.length - limit}` : '');
}

function iso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function stampLine(root, status, extra = '') {
  return `<!-- stamp: ${headShort(root)} ${iso()} status: ${status}${extra ? ` ${extra}` : ''} -->`;
}

export function mapsSignature(root) {
  const L = layout(root);
  const parts = [analyzerFingerprint(), RENDER_VERSION, headSha(root) || 'nogit'];
  const status = statusEntries(root);
  if (status) {
    for (const entry of status) {
      if (entry.path.startsWith('.claude/web-dev/state/') || entry.path.startsWith('.claude/web-dev/maps/')) continue;
      parts.push(entry.code, entry.path, mtimeMs(path.join(root, entry.path)));
    }
  } else {
    const config = loadConfig(root);
    for (const rel of projectFiles(root, config)) parts.push(rel, mtimeMs(path.join(root, rel)));
  }
  for (const file of [L.config, L.shards, L.blueprint, L.decisions, L.product, L.task, L.responsiveState]) parts.push(mtimeMs(file));
  try {
    for (const name of fs.readdirSync(L.notes).sort()) parts.push(name, mtimeMs(path.join(L.notes, name)));
  } catch {}
  return sha256(parts.join('|'));
}

function headerComplete(header) {
  return !!header && [header.role, header.sys, header.crit].every((v) => v && v !== '-');
}

export function noteStatus(files, notes, { migrate = false } = {}) {
  const owed = [];
  const orphans = [];
  let migrated = false;
  const present = new Map();
  for (const [rel, a] of files) for (const s of a.symbols) present.set(`${rel}#${s.name}`, s);

  if (migrate) {
    const byHash = new Map();
    for (const [key, s] of present) {
      if (notes.symbols.has(key) || !s.requiresNote) continue;
      if (!byHash.has(s.hash)) byHash.set(s.hash, []);
      byHash.get(s.hash).push(key);
    }
    for (const [key, note] of [...notes.symbols]) {
      if (present.has(key)) continue;
      const oldFile = key.split('#')[0];
      const oldName = key.slice(oldFile.length + 1);
      const candidates = byHash.get(note.h) || [];
      const oldFileGone = !files.has(oldFile);
      const corroborated = candidates.filter((target) => {
        const targetFile = target.split('#')[0];
        const targetName = target.slice(targetFile.length + 1);
        return targetName === oldName || targetFile === oldFile || (oldFileGone && candidates.length === 1);
      });
      if (corroborated.length === 1) {
        const target = corroborated[0];
        const targetFile = target.split('#')[0];
        notes.symbols.delete(key);
        notes.symbols.set(target, { note: note.note, h: note.h, movedFrom: key });
        byHash.set(note.h, byHash.get(note.h).filter((k) => k !== target));
        if (oldFileGone && notes.files.has(oldFile) && !notes.files.has(targetFile)) {
          notes.files.set(targetFile, notes.files.get(oldFile));
          notes.files.delete(oldFile);
        }
        migrated = true;
      } else {
        orphans.push(key);
      }
    }
    for (const key of notes.files.keys()) if (!files.has(key)) orphans.push(key);
  }

  const markers = new Map();
  for (const [rel, a] of files) {
    if (a.symbols.length && !headerComplete(notes.files.get(rel))) owed.push({ key: rel, marker: 'MISSING', header: true });
    for (const s of a.symbols) {
      const key = `${rel}#${s.name}`;
      const note = notes.symbols.get(key);
      let marker = null;
      if (note) marker = note.movedFrom ? 'MOVED' : note.h !== s.hash ? 'STALE' : null;
      else if (s.requiresNote) marker = 'MISSING';
      if (marker) {
        markers.set(key, marker);
        owed.push({ key, marker });
      }
    }
  }
  const wrong = owed.filter((entry) => entry.marker !== 'MISSING');
  return { owed, wrong, orphans, migrated, markers };
}

function symbolLine(symbol, note, marker, tableName) {
  const db = symbol.db.length ? symbol.db.map((d) => `${d.op} ${tableName(d.entity)}`).join(', ') : '-';
  const calls = symbol.calls.length ? listOf(symbol.calls, 6) : '-';
  return `- ${marker ? `${marker} ` : ''}${symbol.signature} | L${symbol.line}-${symbol.endLine} | ${note?.note ?? '-'} | db: ${db} | calls: ${calls}`;
}

function fileBlock(rel, a, notes, status, model) {
  const lines = [];
  const header = notes.files.get(rel);
  let missing = a.symbols.length && !headerComplete(header) ? 1 : 0;
  let stale = 0;
  let moved = 0;
  let symbolCount = 0;
  lines.push(`## ${rel} | ${header?.crit || '?'} | sys: ${header?.sys || '?'} | role: ${header?.role || 'MISSING'}`);
  lines.push(`imports: ${listOf(model.importEdges.get(rel) || [])} | used-by: ${listOf(model.usedBy.get(rel) || [])}`);
  if (a.schema) lines.push(`- schema ${a.schema.kind}: ${listOf(a.schema.models.map((m) => (m.table && m.table !== m.name ? `${m.name}→${m.table}` : m.name)), 20)}`);
  for (const symbol of a.symbols) {
    symbolCount++;
    const marker = status.markers.get(`${rel}#${symbol.name}`);
    if (marker === 'MISSING') missing++;
    if (marker === 'STALE') stale++;
    if (marker === 'MOVED') moved++;
    lines.push(symbolLine(symbol, notes.symbols.get(`${rel}#${symbol.name}`), marker, model.tableName));
  }
  return { rel, lines, missing, stale, moved, symbolCount };
}

function shardMapFiles(L) {
  try {
    return fs.readdirSync(L.maps).filter((n) => n.startsWith('codemap-') && n.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

function blockAt(text, start) {
  const rest = text.slice(start);
  const end = rest.indexOf('\n## ', 1);
  return (end === -1 ? rest : rest.slice(0, end)).trimEnd();
}

function symbolIdent(line) {
  const m = /^-\s+(?:[A-Z]+\s+)?(.*?)\s+\|/.exec(line);
  if (!m) return null;
  const beforeParen = m[1].split('(')[0].trim().replace(/<.*$/, '');
  const tokens = beforeParen.split(/\s+/);
  return tokens[tokens.length - 1] || null;
}

function symbolMatches(line, name) {
  const ident = symbolIdent(line);
  return !!ident && (ident === name || ident.split('.').pop() === name);
}

function routeLabel(route) {
  if (route.kind === 'http') return `${route.method} ${route.path}`;
  if (route.kind === 'action') return `ACTION ${route.key}${route.path ? ` (${route.path})` : ''}`;
  if (route.kind === 'rpc') return `${route.method} ${route.key}`;
  return `GQL ${route.key}`;
}

function isMutating(route) {
  return route.mutating ?? MUTATING.has(route.method);
}

function declarationFinder(root) {
  const L = layout(root);
  const texts = [readText(L.decisions) || '', readText(L.product) || '', readText(L.task) || ''];
  return (needles) => {
    for (const text of texts) {
      for (const line of text.split('\n')) {
        if (needles.some((n) => n && line.includes(n))) return (line.match(/\b[DR]-\d{3,}\b/) || ['brief'])[0];
      }
    }
    return null;
  };
}

function comparable(text) {
  return text.replace(/^<!-- stamp: \S+ \S+ (status:.*)-->\n/, '<!-- $1-->\n');
}

function writeIfChanged(file, content) {
  const prior = readText(file);
  if (prior != null && comparable(prior) === comparable(content)) return false;
  writeText(file, content);
  return true;
}

export function renderMaps(root, options = {}) {
  const L = layout(root);
  const signature = mapsSignature(root);
  if (!options.force && readJson(L.mapsSig, null)?.sig === signature && exists(path.join(L.maps, 'index.md'))) {
    const cached = readJson(L.healthState, null);
    if (cached) return { ...cached, cached: true };
  }
  return withLock(path.join(L.state, '.maps.lock'), () => renderMapsLocked(root, options), { giveUpMs: 90000 });
}

function renderMapsLocked(root, { force = false } = {}) {
  const L = layout(root);
  const signature = mapsSignature(root);
  if (!force && readJson(L.mapsSig, null)?.sig === signature && exists(path.join(L.maps, 'index.md'))) {
    const cached = readJson(L.healthState, null);
    if (cached) return { ...cached, cached: true };
  }
  const config = loadConfig(root);
  const stack = detectStack(root);
  const tags = config.frameworks?.length ? config.frameworks : stack.tags;
  const analysis = analyzeProject(root, { config, tags, stack });
  if (!analysis.ok) {
    const health = { at: iso(), status: 'PARSER_MISSING', parser: false, counts: {}, owed: [], orphans: [] };
    writeJson(L.healthState, health);
    return health;
  }
  const { files, fileList } = analysis;
  const model = linkProject(root, { files, tags, config, stack });
  const notes = loadNotes(root);
  const shards = loadShards(root);
  const status = noteStatus(files, notes, { migrate: true });
  if (status.migrated) saveNotes(root, notes, (rel) => shardOf(rel, shards));
  const blueprint = loadBlueprint(root);
  const declared = declarationFinder(root);
  const noteOf = (file, symbol) => notes.symbols.get(`${file}#${symbol}`);
  const sysOf = (file) => notes.files.get(file)?.sys || null;

  const byShard = new Map();
  for (const rel of fileList) {
    const a = files.get(rel);
    if (!a || (!a.symbols.length && !a.schema)) continue;
    const shard = shardOf(rel, shards);
    if (!byShard.has(shard)) byShard.set(shard, []);
    byShard.get(shard).push(rel);
  }
  const shardHealth = {};
  const orphanByShard = new Map();
  for (const key of status.orphans) {
    const shard = shardOf(key.split('#')[0], shards);
    if (!orphanByShard.has(shard)) orphanByShard.set(shard, []);
    orphanByShard.get(shard).push(key);
  }
  const maxTokens = shardBudget(root);
  const partOfFile = new Map();
  const writtenMaps = new Set();
  for (const [shard, rels] of [...byShard].sort()) {
    const blocks = rels.map((rel) => fileBlock(rel, files.get(rel), notes, status, model));
    const entries = blocks.map((b) => ({ rel: b.rel, tokens: estimateTokens(b.lines.join('\n')) }));
    const parts = splitByBudget(entries, maxTokens);
    const orphans = orphanByShard.get(shard) || [];
    parts.forEach((part, index) => {
      const partRels = new Set(part.map((e) => e.rel));
      const lines = [];
      let missing = 0;
      let stale = 0;
      let moved = 0;
      let symbolCount = 0;
      for (const block of blocks) {
        if (!partRels.has(block.rel)) continue;
        lines.push(...block.lines);
        missing += block.missing;
        stale += block.stale;
        moved += block.moved;
        symbolCount += block.symbolCount;
        partOfFile.set(block.rel, partName(shard, index));
      }
      const orphanCount = index === 0 ? orphans.length : 0;
      if (orphanCount) {
        lines.push('## ORPHAN notes');
        for (const key of orphans) lines.push(`- ORPHAN ${key} | ${notes.symbols.get(key)?.note || notes.files.get(key)?.role || '-'}`);
      }
      const wrong = stale + moved + orphanCount;
      const undescribed = missing ? ` ${missing} undescribed` : '';
      const statusText = wrong ? `DEGRADED ${stale} stale, ${moved} moved, ${orphanCount} orphan${undescribed}` : `OK${undescribed}`;
      const name = partName(shard, index);
      shardHealth[name] = { files: part.length, symbols: symbolCount, missing, stale, moved, orphan: orphanCount, status: wrong ? 'DEGRADED' : 'OK' };
      const file = path.join(L.maps, `codemap-${name}.md`);
      writeIfChanged(file, `${stampLine(root, statusText)}\n# codemap: ${name}\n${lines.join('\n')}\n`);
      writtenMaps.add(path.basename(file));
    });
  }

  const routes = [...model.routes].sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)));
  const unauth = [];
  const unvalidated = [];
  const dead = [];
  const routeLines = routes.map((r) => {
    const label = routeLabel(r);
    const needles = [label, r.path ? `${r.method} ${r.path}` : null, r.key];
    if (isMutating(r) && !r.auth) unauth.push({ label, declared: declared([...needles.filter(Boolean).map((n) => `WD-API-UNAUTH | ${n}`), ...needles.filter(Boolean)]) });
    if (isMutating(r) && !r.schema) unvalidated.push({ label, declared: declared(needles.filter(Boolean).map((n) => `WD-API-UNVALIDATED | ${n}`)) });
    if (!r.callers.length && !(r.path && DEAD_ROUTE_EXEMPT.test(r.path)) && r.kind !== 'action') dead.push(label);
    const inField = r.schema || (isMutating(r) ? 'NONE' : '-');
    const db = r.db.length ? r.db.map((d) => `${d.op} ${d.entity}`).join(', ') : '-';
    const callers = listOf(r.callers.map((c) => `${c.file}:${c.symbol}`));
    return `${label} | ${r.file}:${r.symbol} | auth: ${r.auth || 'NONE'} | in: ${inField} | out: ${r.out || '-'} | db: ${db} | callers: ${callers} | note: ${noteOf(r.file, r.symbol)?.note || '-'}`;
  });
  const unauthOpen = unauth.filter((u) => !u.declared).length;
  const unvalidatedOpen = unvalidated.filter((u) => !u.declared).length;
  if (routes.length || model.unmatched.length || model.unresolved.length) {
    const degraded = model.unmatched.length + unauthOpen + unvalidatedOpen;
    const statusText = degraded ? `DEGRADED ${model.unmatched.length} unmatched, ${unauthOpen} unauthenticated, ${unvalidatedOpen} unvalidated` : 'OK';
    const body = [
      '# apimap',
      '## Routes',
      ...(routeLines.length ? routeLines : ['- none']),
      '## Unmatched calls',
      ...(model.unmatched.length ? model.unmatched.map((u) => `${u.file}:${u.symbol} → ${u.method} ${u.path} (no route${u.via && u.via.endsWith('()') ? `, via ${u.via}` : ''})`) : ['- none']),
      '## Unresolved',
      ...(model.unresolved.length ? model.unresolved.map((u) => `${u.file}:${u.symbol} → ${u.raw} (${u.via || 'dynamic'})`) : ['- none']),
      '## Dead routes',
      ...(dead.length ? dead.map((d) => `- ${d}`) : ['- none']),
      '## Unauthenticated mutations',
      ...(unauth.length ? unauth.map((u) => `- ${u.label}${u.declared ? ` (declared: ${u.declared})` : ''}`) : ['- none']),
      '## Unvalidated input',
      ...(unvalidated.length ? unvalidated.map((u) => `- ${u.label}${u.declared ? ` (declared: ${u.declared})` : ''}`) : ['- none']),
    ];
    writeIfChanged(path.join(L.maps, 'apimap.md'), `${stampLine(root, statusText)}\n${body.join('\n')}\n`);
    writtenMaps.add('apimap.md');
  }

  const responsive = readJson(L.responsiveState, null);
  const renderTree = (nodes, depth, out) => {
    for (const node of nodes) {
      const flags = [node.client ? 'client' : null, node.fetches ? 'fetch' : null].filter(Boolean).join(' ');
      out.push(`${'  '.repeat(depth)}- ${node.tag} (${node.file})${flags ? ` [${flags}]` : ''}`);
      renderTree(node.children, depth + 1, out);
    }
  };
  if (model.pages.length) {
    const body = ['# uimap'];
    for (const page of [...model.pages].sort((a, b) => a.path.localeCompare(b.path))) {
      const check = responsive?.results?.find((r) => r.path === page.path);
      body.push(`## PAGE ${page.path} | ${page.file} | ${page.client ? 'client' : 'server'} | metadata: ${page.metadata ? 'yes' : 'no'} | layouts: ${listOf(page.layouts)}`);
      body.push(`data: ${listOf(page.data)} | client fetch: ${page.clientFetch ? 'yes' : 'no'} | responsive: ${check ? `${check.ok ? 'pass' : 'fail'} ${responsive.at}` : 'not checked'} | note: ${noteOf(page.file, page.symbol)?.note || '-'}`);
      renderTree(page.components, 0, body);
    }
    writeIfChanged(path.join(L.maps, 'uimap.md'), `${stampLine(root, 'OK', `pages: ${model.pages.length}`)}\n${body.join('\n')}\n`);
    writtenMaps.add('uimap.md');
  }

  const multiWriter = [];
  const envFindings = [];
  if (model.tables.length || model.env.length) {
    const body = ['# datamap', '## Tables'];
    for (const table of [...model.tables].sort((a, b) => a.table.localeCompare(b.table))) {
      const owners = [...new Set(table.writers.map((w) => sysOf(w.file) || '?'))];
      const blueprintOwner = blueprint.tables.find((t) => t.table === table.table || t.table === table.name)?.owner;
      body.push(`${table.table} | model: ${table.name} | source: ${table.source} | columns: ${listOf(table.columns.map((c) => `${c.name}${c.type ? ` ${c.type}` : ''}`), 14)} | writers: ${listOf(table.writers.map((w) => `${w.file}:${w.symbol}`))} | readers: ${listOf(table.readers.map((r) => `${r.file}:${r.symbol}`))} | owner: ${blueprintOwner || listOf(owners)}`);
      const known = owners.filter((o) => o !== '?');
      if (known.length > 1) multiWriter.push({ table: table.table, owners: known, declared: declared([`WD-DATA-MULTIWRITER | ${table.table}`]) });
    }
    body.push('## Multiple writers', ...(multiWriter.length ? multiWriter.map((m) => `- ${m.table}: ${m.owners.join(', ')}${m.declared ? ` (declared: ${m.declared})` : ''}`) : ['- none']));
    body.push('## Config surface');
    for (const env of model.env) {
      body.push(`${env.name} | exposed: ${env.exposed ? 'yes' : 'no'} | secret-like: ${env.secretLike ? 'yes' : 'no'} | used in: ${listOf(env.uses.map((u) => `${u.file} (${u.client ? 'client' : 'server'})`))} | example: ${env.inExample ? 'yes' : 'no'}`);
      if (env.exposed && env.secretLike) envFindings.push(`ERROR WD-SEC-PUBLIC-ENV ${env.name} — secret-looking name behind a client-exposed prefix (${listOf(env.uses.map((u) => u.file), 3)})`);
      const clientUse = env.uses.find((u) => u.client);
      if (!env.exposed && clientUse) envFindings.push(`WARN ${env.name} — server-only variable read in client file ${clientUse.file}`);
      if (!env.inExample) envFindings.push(`INFO ${env.name} — missing from .env.example`);
    }
    body.push('## Config findings', ...(envFindings.length ? envFindings : ['- none']));
    const envErrors = envFindings.filter((f) => f.startsWith('ERROR')).length;
    const openMulti = multiWriter.filter((m) => !m.declared).length;
    const degraded = envErrors + openMulti;
    writeIfChanged(path.join(L.maps, 'datamap.md'), `${stampLine(root, degraded ? `DEGRADED ${envErrors} env error(s), ${openMulti} multi-writer` : 'OK')}\n${body.join('\n')}\n`);
    writtenMaps.add('datamap.md');
  }

  const features = new Set(blueprint.features.map((f) => f.sys));
  for (const header of notes.files.values()) if (header.sys && header.sys !== '-') features.add(header.sys);
  const critRank = { K1: 1, K2: 2, K3: 3 };
  const indexRows = [];
  for (const sys of [...features].sort()) {
    const sysFiles = fileList.filter((rel) => sysOf(rel) === sys);
    const shardsOfSys = [...new Set(sysFiles.map((rel) => partOfFile.get(rel) || shardOf(rel, shards)))];
    const entries = [...sysFiles].sort((a, b) => (critRank[notes.files.get(a)?.crit] || 9) - (critRank[notes.files.get(b)?.crit] || 9) || a.localeCompare(b));
    const sysRoutes = model.routes.filter((r) => sysOf(r.file) === sys).length;
    const sysPages = model.pages.filter((p) => sysOf(p.file) === sys).length;
    const sysTables = model.tables.filter((t) => t.writers.some((w) => sysOf(w.file) === sys) || blueprint.tables.some((bt) => bt.owner === sys && (bt.table === t.table || bt.table === t.name))).map((t) => t.table);
    const degraded = status.wrong?.some((o) => sysFiles.includes(o.key.split('#')[0])) ?? false;
    const entryText = entries.length ? `${entries.slice(0, 2).join(', ')}${entries.length > 2 ? ` (+${entries.length - 2})` : ''}` : 'UNMAPPED';
    indexRows.push(`| ${sys} | ${listOf(shardsOfSys)} | ${entryText} | ${sysRoutes} | ${sysPages} | ${listOf(sysTables, 5)} | ${!sysFiles.length ? 'PLANNED' : degraded ? 'DEGRADED' : 'OK'} |`);
  }
  const unmapped = fileList.filter((rel) => files.get(rel)?.symbols.length && !sysOf(rel));
  const counts = {
    files: fileList.length,
    symbols: [...files.values()].reduce((n, a) => n + a.symbols.length, 0),
    missing: status.owed.filter((o) => o.marker === 'MISSING').length,
    stale: status.owed.filter((o) => o.marker === 'STALE').length,
    moved: status.owed.filter((o) => o.marker === 'MOVED').length,
    orphan: status.orphans.length,
    routes: model.routes.length,
    pages: model.pages.length,
    tables: model.tables.length,
    unmatched: model.unmatched.length,
    unresolved: model.unresolved.length,
    unauthenticated: unauthOpen,
    unvalidated: unvalidatedOpen,
    multiWriter: multiWriter.filter((m) => !m.declared).length,
    envErrors: envFindings.filter((f) => f.startsWith('ERROR')).length,
    unmapped: unmapped.length,
  };
  const problems = counts.stale + counts.moved + counts.orphan + counts.unmatched + counts.unauthenticated + counts.unvalidated + counts.multiWriter + counts.envErrors;
  const overall = problems ? 'DEGRADED' : 'OK';
  const indexBody = [
    '# index',
    '| feature | shards | entry files | routes | pages | tables | status |',
    '|---|---|---|---|---|---|---|',
    ...(indexRows.length ? indexRows : ['| - | - | - | - | - | - | UNMAPPED |']),
    '## Unmapped',
    ...(unmapped.length ? [`- ${unmapped.length} file(s) without sys: ${listOf(unmapped, 10)}`] : ['- none']),
    '## Maps',
    ...Object.entries(shardHealth).map(([shard, h]) => `- codemap-${shard}.md — ${h.files} files, ${h.symbols} symbols, ${h.status}${h.status === 'OK' ? '' : ` (${h.missing} missing, ${h.stale} stale, ${h.moved} moved, ${h.orphan} orphan)`}`),
    writtenMaps.has('apimap.md') ? `- apimap.md — ${counts.routes} routes, ${counts.unmatched} unmatched, ${counts.unresolved} unresolved, ${counts.unauthenticated} unauthenticated, ${counts.unvalidated} unvalidated` : null,
    writtenMaps.has('uimap.md') ? `- uimap.md — ${counts.pages} pages` : null,
    writtenMaps.has('datamap.md') ? `- datamap.md — ${counts.tables} tables, ${model.env.length} env vars, ${counts.envErrors} env error(s), ${counts.multiWriter} multi-writer` : null,
  ].filter((l) => l !== null);
  writeIfChanged(path.join(L.maps, 'index.md'), `${stampLine(root, overall, `files:${counts.files} symbols:${counts.symbols} owed:${status.owed.length}`)}\n${indexBody.join('\n')}\n`);
  writtenMaps.add('index.md');
  try {
    for (const name of fs.readdirSync(L.maps)) if (name.endsWith('.md') && !writtenMaps.has(name)) fs.rmSync(path.join(L.maps, name), { force: true });
  } catch {}

  const health = {
    at: iso(),
    head: headShort(root),
    status: overall,
    parser: true,
    counts,
    shards: shardHealth,
    owed: status.owed.map((o) => `${o.key} (${o.marker}${o.header ? ' header' : ''})`),
    orphans: status.orphans,
    unmatched: model.unmatched.map((u) => `${u.method} ${u.path} ← ${u.file}:${u.symbol}`),
    unauthenticated: unauth.filter((u) => !u.declared).map((u) => u.label),
    unvalidated: unvalidated.filter((u) => !u.declared).map((u) => u.label),
    envErrors: envFindings.filter((f) => f.startsWith('ERROR')),
    multiWriter: multiWriter.filter((m) => !m.declared).map((m) => m.table),
  };
  writeJson(L.healthState, health);
  writeJson(L.mapsSig, { sig: mapsSignature(root) });
  return health;
}

export function currentSymbols(root, rels) {
  const config = loadConfig(root);
  const result = analyzeProject(root, { config, tags: projectTags(root, config), only: rels });
  if (!result.ok) return null;
  const map = new Map();
  for (const [rel, a] of result.files) for (const s of a.symbols) map.set(`${rel}#${s.name}`, s);
  return { symbols: map, files: result.files };
}

export function owedFor(root, rels) {
  const config = loadConfig(root);
  const result = analyzeProject(root, { config, tags: projectTags(root, config), only: rels });
  if (!result.ok) return { ok: false, reason: 'parser-missing', owed: [] };
  return { ok: true, owed: noteStatus(result.files, loadNotes(root)).owed };
}

export function mapForPath(root, relPath) {
  const health = renderMaps(root);
  if (health.parser === false) return { ok: false, reason: 'parser-missing' };
  const L = layout(root);
  const marker = `## ${relPath} | `;
  for (const name of shardMapFiles(L)) {
    const text = readText(path.join(L.maps, name)) || '';
    const start = text.indexOf(marker);
    if (start === -1) continue;
    return { ok: true, shard: name.replace(/^codemap-/, '').replace(/\.md$/, ''), block: blockAt(text, start) };
  }
  return { ok: false, reason: 'not-in-maps' };
}

export function findSymbol(root, name) {
  const health = renderMaps(root);
  if (health.parser === false) return { ok: false, reason: 'parser-missing', matches: [] };
  const L = layout(root);
  const matches = [];
  for (const fileName of shardMapFiles(L)) {
    const text = readText(path.join(L.maps, fileName)) || '';
    let header = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('## ')) {
        header = line.slice(3).split(' | ')[0];
        continue;
      }
      if (line.startsWith('- ') && symbolMatches(line, name)) matches.push({ file: header, line });
    }
  }
  return { ok: true, matches };
}
