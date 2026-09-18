import fs from 'node:fs';
import path from 'node:path';
import { decisionsDigest, parseBrief, validateBrief } from './brief.mjs';
import { fileSha, sha256 } from './hash.mjs';
import { ensureDir, exists, readJson, readText, relPath, writeJson } from './io.mjs';
import { withLock } from './lock.mjs';
import { layout } from './paths.mjs';
import { clearApprovalRecord, readApprovalRecord, writeApprovalRecord } from './pdata.mjs';

const SELF_TRACKED = new Set(['task.json', 'turn.json', 'stop.json', 'dirty.json', 'approval-mirror.json']);

function stateLock(root) {
  return path.join(layout(root).state, '.lock');
}

function loadSelfLedger(root) {
  return readJson(layout(root).selfLedger, {}) || {};
}

export function markSelfWrite(root, file) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const hash = fileSha(abs);
  if (hash == null) return;
  const rel = relPath(root, abs);
  const ledger = loadSelfLedger(root);
  ledger[rel] = hash;
  writeJson(layout(root).selfLedger, ledger);
}

export function isSelfWrite(root, rel) {
  const selfRel = relPath(root, layout(root).selfLedger);
  if (rel === selfRel) return true;
  if (!SELF_TRACKED.has(rel.split('/').pop())) return true;
  const ledger = loadSelfLedger(root);
  const hash = ledger[rel];
  if (!hash) return false;
  return fileSha(path.join(root, rel)) === hash;
}

export function markTamper(root, rel, event) {
  const prior = readTask(root).tamper;
  const count = prior && prior.rel === rel ? prior.count + 1 : 1;
  return writeTask(root, { tamper: { rel, event: event || 'change', at: new Date().toISOString(), count } });
}

export function readTask(root) {
  return readJson(layout(root).taskState, { state: 'none' }) || { state: 'none' };
}

export function writeTask(root, patch) {
  return withLock(stateLock(root), () => {
    const next = { ...readTask(root), ...patch, updatedAt: new Date().toISOString() };
    writeJson(layout(root).taskState, next);
    markSelfWrite(root, layout(root).taskState);
    return next;
  });
}

export function markStuck(root, reason) {
  const reasonHash = sha256(reason).slice(0, 16);
  const prior = readTask(root).stuck;
  const same = prior && prior.reasonHash === reasonHash;
  return writeTask(root, {
    stuck: { reasonHash, count: same ? prior.count + 1 : 1, since: same ? prior.since : new Date().toISOString(), lastReason: reason },
  });
}

export function clearStuck(root) {
  return writeTask(root, { stuck: null });
}

export function briefText(root) {
  return readText(layout(root).task);
}

export function briefHash(root) {
  const text = briefText(root);
  return text == null ? null : sha256(text);
}

export function approval(root) {
  const record = readApprovalRecord(root);
  const mode = record.mode;
  const text = briefText(root);
  if (text == null) return { ok: false, reason: 'no brief: write .claude/web-dev/work/task.md (gates/brief.md) after locate and intake', mode };
  const hash = sha256(text);
  const brief = parseBrief(text);
  const task = readTask(root);
  if (!record.exists) return { ok: false, reason: `brief ${hash.slice(0, 8)} is not approved yet: run wd task hash and ask the user`, hash, brief, task, mode };
  if (record.tampered) return { ok: false, reason: 'the stored approval record failed integrity verification and is treated as absent (possible tampering): ask the user to approve again', hash, brief, task, mode, tampered: true };
  if (record.record.hash !== hash) return { ok: false, reason: `brief changed after approval (approved ${record.record.hash.slice(0, 8)}, now ${hash.slice(0, 8)}): ask the user to approve the new version`, hash, brief, task, mode };
  return { ok: true, hash, brief, task, mode, approvedAt: record.record.approvedAt, approvedVia: record.record.via };
}

function writeMirror(root, record) {
  const file = layout(root).approvalMirror;
  writeJson(file, { ...record, authoritative: false, note: 'human-readable mirror only — the signed record elsewhere is authoritative' });
  markSelfWrite(root, file);
}

export function recordApproval(root, { hash8, via, sessionId } = {}) {
  return withLock(stateLock(root), () => {
    const text = briefText(root);
    if (text == null) return { ok: false, reason: 'no brief exists' };
    const hash = sha256(text);
    if (!hash8) return { ok: false, reason: `no hash given: the current brief hash is ${hash.slice(0, 8)}; approve with "APPROVE ${hash.slice(0, 8)}" or "ONAY ${hash.slice(0, 8)}"`, hash };
    if (!hash.startsWith(hash8)) return { ok: false, reason: `the approved hash ${hash8} is not the current brief ${hash.slice(0, 8)}`, hash };
    const brief = parseBrief(text);
    const problems = validateBrief(brief, readQuestions(root));
    if (problems.length) return { ok: false, reason: `brief is not approvable: ${problems.join('; ')}`, hash };
    const approvedAt = new Date().toISOString();
    const record = writeApprovalRecord(root, { hash, decisionsDigest: decisionsDigest(brief), via, sessionId: sessionId || null, branch: brief.branch, title: brief.title, approvedAt });
    writeMirror(root, record);
    const task = writeTask(root, {
      state: 'approved',
      title: brief.title,
      branch: brief.branch,
      approvedHash: hash,
      approvedAt,
      approvedVia: via,
      sessionId: sessionId || null,
      closedAt: null,
      summarized: false,
      reminded: false,
      pr: null,
    });
    return { ok: true, task, brief, hash, mode: record.mode };
  });
}

export function clearApproval(root) {
  return clearApprovalRecord(root);
}

export function readTurn(root) {
  return readJson(layout(root).turnState, { startedAt: 0, writes: [], observed: [] }) || { startedAt: 0, writes: [], observed: [] };
}

export function startTurn(root, promptId) {
  withLock(stateLock(root), () => {
    writeJson(layout(root).turnState, { startedAt: Date.now(), promptId: promptId || null, writes: [], observed: [] });
    markSelfWrite(root, layout(root).turnState);
  });
}

export function addTurnWrite(root, rel, opts = {}) {
  withLock(stateLock(root), () => {
    const turn = readTurn(root);
    if (!turn.writes.includes(rel)) turn.writes.push(rel);
    if (!Array.isArray(turn.observed)) turn.observed = [];
    turn.observed.push({ rel, via: opts.via || 'tool', event: opts.event || 'change', at: new Date().toISOString() });
    writeJson(layout(root).turnState, turn);
    markSelfWrite(root, layout(root).turnState);
  });
}

export function readStop(root) {
  return readJson(layout(root).stopState, { reason: '', count: 0 }) || { reason: '', count: 0 };
}

export function writeStop(root, value) {
  withLock(stateLock(root), () => {
    writeJson(layout(root).stopState, value);
    markSelfWrite(root, layout(root).stopState);
  });
}

export function readDirty(root) {
  return readJson(layout(root).dirtyState, { paths: [], deps: false, tree: false }) || { paths: [], deps: false, tree: false };
}

export function markDirty(root, token) {
  withLock(stateLock(root), () => {
    const dirty = readDirty(root);
    if (token === '*') dirty.tree = true;
    else if (token === 'deps') dirty.deps = true;
    else if (!dirty.paths.includes(token)) dirty.paths.push(token);
    writeJson(layout(root).dirtyState, dirty);
    markSelfWrite(root, layout(root).dirtyState);
  });
}

export function clearDirty(root) {
  withLock(stateLock(root), () => {
    writeJson(layout(root).dirtyState, { paths: [], deps: false, tree: false });
    markSelfWrite(root, layout(root).dirtyState);
  });
}

export function readQuestions(root) {
  const text = readText(layout(root).questionsLog);
  if (text == null) return null;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

export function recordQuestion(root, entry) {
  const record = {
    at: entry.at || new Date().toISOString(),
    question: entry.question || '',
    header: entry.header ?? null,
    options: entry.options || [],
    chosen: entry.chosen ?? null,
    custom: entry.custom ?? null,
  };
  const file = layout(root).questionsLog;
  withLock(stateLock(root), () => {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  });
  return record;
}

const SCHEMA_RE = /\bschema\b|\bmigration\b|\bmigrate\b|\bprisma\b|\bdrizzle\b/i;
const AUTH_RE = /\bauth\b|authenticat|authoriz|\blogin\b|\bsession\b|\bpayment\b|\bstripe\b|\bcheckout\b|\bbilling\b/i;
const DESTRUCTIVE_RE = /\bdrop\b|\btruncate\b|delete\s+from|\bdestructive\b/i;
const ROUTE_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+\/\S+/;
const NEW_ROUTE_RE = /\bnew\s+(route|endpoint)\b/i;
const TABLE_RE = /\btable\b/i;
const ENV_RE = /\benv(ironment)?\s*var|\.env\b/i;
const CROSS_CUTTING_RE = /cross-cutting|repo-wide|across the codebase/i;
const STYLE_ONLY = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|md|mdx|txt|json5?|ya?ml)$/i;
const APP_WIDE_FILE = /(^|\/)(middleware|instrumentation|proxy)\.(m|c)?[jt]s$|(^|\/)(next|nuxt|vite|svelte|astro|angular|remix|tailwind)\.config\.[mc]?[jt]s$|(^|\/)(app|root)\.(tsx|jsx|vue|svelte)$|(^|\/)\+layout\.|(^|\/)layout\.(tsx|jsx)$/i;

function spansTheApp(paths) {
  if (paths.some((p) => APP_WIDE_FILE.test(p))) return 'a file the whole app renders through';
  const areas = new Set(paths.map((p) => p.split('/').slice(0, -1).slice(0, 2).join('/')).filter(Boolean));
  return areas.size >= 3 ? `${areas.size} separate areas of the tree` : null;
}

function locateField(text, label) {
  const m = new RegExp(`^-\\s*${label}\\s*:\\s*(.*)$`, 'im').exec(text || '');
  return m ? m[1].trim() : '';
}

function isEmptyField(value) {
  return !value || value === '-' || /^none$/i.test(value);
}

function splitPaths(value) {
  return isEmptyField(value) ? [] : value.split(',').map((v) => v.trim()).filter(Boolean);
}

function countPaths(value) {
  return splitPaths(value).length;
}

export function classifySize(locate, brief) {
  const text = typeof locate === 'string' ? locate : '';
  const contracts = locateField(text, 'Contracts touched');
  const callers = locateField(text, 'Callers affected');
  const written = locateField(text, 'Write');
  const files = countPaths(written) || (brief?.manifest?.length ?? 0);
  const dependencies = brief?.dependencies?.length ?? 0;
  const migrations = brief?.migrations || [];
  const paths = splitPaths(written).length ? splitPaths(written) : (brief?.manifest || []);
  const behaviour = paths.filter((p) => !STYLE_ONLY.test(p));
  const signal = [behaviour.join(' '), contracts, migrations.join(' ')].join('\n');

  const archReasons = [];
  if (SCHEMA_RE.test(signal)) archReasons.push('schema or migration change');
  if (AUTH_RE.test(signal)) archReasons.push('auth or payment change');
  if (dependencies) archReasons.push(`${dependencies} new dependenc${dependencies > 1 ? 'ies' : 'y'}`);
  if (DESTRUCTIVE_RE.test(signal) || migrations.some((m) => DESTRUCTIVE_RE.test(m))) archReasons.push('destructive migration');
  if (NEW_ROUTE_RE.test(contracts)) archReasons.push('new route contract');
  const declared = locateField(text, 'Arch signal');
  if (!isEmptyField(declared)) archReasons.push(`declared in locate: ${declared}`);
  if (CROSS_CUTTING_RE.test(contracts)) archReasons.push('cross-cutting refactor');
  const spread = spansTheApp(paths);
  if (spread) archReasons.push(`the change reaches ${spread}`);
  if (archReasons.length) return { size: 'arch', reasons: archReasons };

  const taskReasons = [];
  if (files > 1) taskReasons.push(`${files} files`);
  if (!isEmptyField(callers)) taskReasons.push('an exported symbol\'s callers are affected');
  if (!isEmptyField(contracts) && ROUTE_RE.test(contracts)) taskReasons.push('a route contract changed');
  if (!isEmptyField(contracts) && TABLE_RE.test(contracts)) taskReasons.push('a table changed');
  if (!isEmptyField(contracts) && ENV_RE.test(contracts)) taskReasons.push('an env var changed');
  if (taskReasons.length) return { size: 'task', reasons: taskReasons };

  return { size: 'touch', reasons: ['1 file or fewer, no exported symbol / route / table / env change, no dependency, no auth, payment or migration path'] };
}

export function enforced(root) {
  return exists(layout(root).enforce);
}
