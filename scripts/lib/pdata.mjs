import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, readJson, writeJson } from './io.mjs';
import { withLock } from './lock.mjs';
import { layout } from './paths.mjs';

function projectId(root) {
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {}
  return crypto.createHash('sha256').update(real).digest('hex').slice(0, 24);
}

export function pdataMode() {
  return process.env.CLAUDE_PLUGIN_DATA ? 'plugin' : 'home';
}

export function pdataDir(root) {
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'web-dev-data');
  return path.join(base, 'projects', projectId(root));
}

function secretFile(dir) {
  return path.join(dir, 'secret.json');
}

function approvalFile(dir) {
  return path.join(dir, 'approval.json');
}

function lockFile(dir) {
  return path.join(dir, '.pdata.lock');
}

function loadOrCreateSecret(dir) {
  const existing = readJson(secretFile(dir), null);
  if (existing?.key) return Buffer.from(existing.key, 'hex');
  ensureDir(dir);
  return withLock(lockFile(dir), () => {
    const again = readJson(secretFile(dir), null);
    if (again?.key) return Buffer.from(again.key, 'hex');
    const key = crypto.randomBytes(32);
    writeJson(secretFile(dir), { key: key.toString('hex'), createdAt: new Date().toISOString() });
    return key;
  });
}

function sign(secret, hash, decisionsDigest) {
  return crypto.createHmac('sha256', secret).update(`${hash}:${decisionsDigest}`).digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'hex');
  const bufB = Buffer.from(String(b || ''), 'hex');
  if (!bufA.length || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function writeApprovalRecord(root, record) {
  const dir = pdataDir(root);
  const mode = pdataMode();
  const secret = loadOrCreateSecret(dir);
  const hmac = sign(secret, record.hash, record.decisionsDigest);
  const stored = { ...record, mode, hmac };
  return withLock(lockFile(dir), () => {
    writeJson(approvalFile(dir), stored);
    return stored;
  });
}

export function readApprovalRecord(root) {
  const dir = pdataDir(root);
  const mode = pdataMode();
  const stored = readJson(approvalFile(dir), null);
  if (!stored) return { ok: false, exists: false, tampered: false, mode };
  const secret = loadOrCreateSecret(dir);
  const expected = sign(secret, stored.hash, stored.decisionsDigest);
  if (!safeEqual(expected, stored.hmac)) return { ok: false, exists: true, tampered: true, mode, record: stored };
  return { ok: true, exists: true, tampered: false, mode, record: stored };
}

export function clearApprovalRecord(root) {
  const dir = pdataDir(root);
  withLock(lockFile(dir), () => {
    try {
      fs.rmSync(approvalFile(dir), { force: true });
    } catch {}
  });
}

function noticeFile(dir) {
  return path.join(dir, 'notices.json');
}

export function alreadyTold(root, kind, sessionId) {
  const stored = readJson(noticeFile(pdataDir(root)), null);
  return stored?.[kind] === (sessionId || 'no-session');
}

export function rememberTold(root, kind, sessionId) {
  const dir = pdataDir(root);
  ensureDir(dir);
  const stored = readJson(noticeFile(dir), {}) || {};
  stored[kind] = sessionId || 'no-session';
  writeJson(noticeFile(dir), stored);
}
