import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STALE_MS = 30000;
const DEFAULT_GIVE_UP_MS = 10000;
const MIN_BACKOFF_MS = 4;
const MAX_BACKOFF_MS = 100;

const held = new Map();

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

function tryCreate(lockPath) {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

function holderAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLock(lockPath) {
  let stat;
  try {
    stat = fs.statSync(lockPath);
  } catch {
    return null;
  }
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {}
  return { stat, info, raw: `${info?.pid ?? '?'}:${info?.at ?? stat.mtimeMs}` };
}

function isAbandoned(held, staleMs) {
  if (held.info && Number.isInteger(held.info.pid)) return !holderAlive(held.info.pid);
  return Date.now() - held.stat.mtimeMs > staleMs;
}

function acquire(lockPath, staleMs, giveUpMs) {
  const deadline = Date.now() + giveUpMs;
  let backoff = MIN_BACKOFF_MS;
  for (;;) {
    if (tryCreate(lockPath)) return;
    const held = readLock(lockPath);
    if (!held) continue;
    if (isAbandoned(held, staleMs)) {
      const still = readLock(lockPath);
      if (still && still.raw === held.raw) {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {}
      }
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`web-dev: timed out waiting for a lock: ${lockPath}`);
    sleepSync(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

export function withLock(lockPath, fn, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const giveUpMs = options.giveUpMs ?? DEFAULT_GIVE_UP_MS;
  const key = path.resolve(lockPath);
  if (held.has(key)) {
    held.set(key, held.get(key) + 1);
    try {
      return fn();
    } finally {
      const next = held.get(key) - 1;
      if (next <= 0) held.delete(key);
      else held.set(key, next);
    }
  }
  fs.mkdirSync(path.dirname(key), { recursive: true });
  acquire(key, staleMs, giveUpMs);
  held.set(key, 1);
  try {
    return fn();
  } finally {
    held.delete(key);
    try {
      fs.rmSync(key, { force: true });
    } catch {}
  }
}
