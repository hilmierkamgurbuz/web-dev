import { parseBrief, validateBrief } from './brief.mjs';
import { sha256 } from './hash.mjs';
import { exists, readJson, readText, writeJson } from './io.mjs';
import { layout } from './paths.mjs';

export function readTask(root) {
  return readJson(layout(root).taskState, { state: 'none' }) || { state: 'none' };
}

export function writeTask(root, patch) {
  const next = { ...readTask(root), ...patch, updatedAt: new Date().toISOString() };
  writeJson(layout(root).taskState, next);
  return next;
}

export function briefText(root) {
  return readText(layout(root).task);
}

export function briefHash(root) {
  const text = briefText(root);
  return text == null ? null : sha256(text);
}

export function approval(root) {
  const text = briefText(root);
  if (text == null) return { ok: false, reason: 'no brief: write .claude/web-dev/work/task.md (gates/brief.md) after locate and intake' };
  const hash = sha256(text);
  const brief = parseBrief(text);
  const task = readTask(root);
  if (!task.approvedHash) return { ok: false, reason: `brief ${hash.slice(0, 8)} is not approved yet: run wd task hash and ask the user`, hash, brief, task };
  if (task.approvedHash !== hash) return { ok: false, reason: `brief changed after approval (approved ${task.approvedHash.slice(0, 8)}, now ${hash.slice(0, 8)}): ask the user to approve the new version`, hash, brief, task };
  return { ok: true, hash, brief, task };
}

export function recordApproval(root, { hash8, via, sessionId }) {
  const text = briefText(root);
  if (text == null) return { ok: false, reason: 'no brief exists' };
  const hash = sha256(text);
  if (hash8 && !hash.startsWith(hash8)) return { ok: false, reason: `the approved hash ${hash8} is not the current brief ${hash.slice(0, 8)}` };
  const brief = parseBrief(text);
  const problems = validateBrief(brief);
  if (problems.length) return { ok: false, reason: `brief is not approvable: ${problems.join('; ')}` };
  const task = writeTask(root, {
    state: 'approved',
    title: brief.title,
    branch: brief.branch,
    approvedHash: hash,
    approvedAt: new Date().toISOString(),
    approvedVia: via,
    sessionId: sessionId || null,
    closedAt: null,
    summarized: false,
    reminded: false,
    pr: null,
  });
  return { ok: true, task, brief, hash };
}

export function readTurn(root) {
  return readJson(layout(root).turnState, { startedAt: 0, writes: [] }) || { startedAt: 0, writes: [] };
}

export function startTurn(root, promptId) {
  writeJson(layout(root).turnState, { startedAt: Date.now(), promptId: promptId || null, writes: [] });
}

export function addTurnWrite(root, rel) {
  const turn = readTurn(root);
  if (!turn.writes.includes(rel)) turn.writes.push(rel);
  writeJson(layout(root).turnState, turn);
}

export function readStop(root) {
  return readJson(layout(root).stopState, { reason: '', count: 0 }) || { reason: '', count: 0 };
}

export function writeStop(root, value) {
  writeJson(layout(root).stopState, value);
}

export function enforced(root) {
  return exists(layout(root).enforce);
}
