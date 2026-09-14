import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { changedSince, defaultRef, git, headSha, mergeBase, statusEntries } from './git.mjs';
import { sha256 } from './hash.mjs';

const EXCLUDED = /^\.claude\/web-dev\/(work|state|maps|shots)\//;
export const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html?)$/i;
export const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json)$/;
export const TOOL_OUTPUT = /(^|\/)(next-env\.d\.ts|.+\.tsbuildinfo)$/;

function untracked(root) {
  const out = git(root, ['ls-files', '-o', '--exclude-standard', '-z']) || '';
  return out.split('\0').filter((f) => f && !EXCLUDED.test(f));
}

function fileDigest(root, rel) {
  try {
    return sha256(fs.readFileSync(path.join(root, rel)));
  } catch {
    return 'missing';
  }
}

const TREE_EXCLUDED = /^(\.claude\/|CLAUDE\.md$|CLAUDE\.local\.md$)/;

export function treeHash(root) {
  const entries = new Map();
  const index = git(root, ['ls-files', '-s', '-z']) || '';
  for (const record of index.split('\0')) {
    const m = /^\d+ ([0-9a-f]+) \d\t(.+)$/.exec(record);
    if (m && !TREE_EXCLUDED.test(m[2])) entries.set(m[2], m[1]);
  }
  const pending = [];
  for (const entry of statusEntries(root) || []) {
    if (TREE_EXCLUDED.test(entry.path)) continue;
    if (!fs.existsSync(path.join(root, entry.path))) {
      entries.delete(entry.path);
      continue;
    }
    pending.push(entry.path);
  }
  if (pending.length) {
    const hashed = spawnSync('git', ['hash-object', '--stdin-paths'], { cwd: root, input: pending.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const shas = (hashed.stdout || '').trim().split('\n');
    pending.forEach((rel, i) => entries.set(rel, shas[i] || fileDigest(root, rel)));
  }
  return sha256([...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([rel, sha]) => `${rel} ${sha}`).join('\n'));
}

export function branchBase(root, config) {
  return mergeBase(root, defaultRef(root, config.defaultBranch)) || null;
}

export function branchFiles(root, config) {
  const base = branchBase(root, config);
  return changedSince(root, base).filter((f) => !EXCLUDED.test(f));
}

export function buildDiff(root, config) {
  const base = branchBase(root, config) || 'HEAD';
  const diff = spawnSync('git', ['diff', base, '--', '.', ':(exclude).claude/web-dev/work', ':(exclude).claude/web-dev/state', ':(exclude).claude/web-dev/maps', ':(exclude).claude/web-dev/shots'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let patch = diff.stdout || '';
  const extra = untracked(root).sort();
  for (const rel of extra) {
    const r = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', rel], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    patch += r.stdout || '';
  }
  const files = [...new Set([...changedSince(root, base === 'HEAD' ? null : base), ...extra])].filter((f) => !EXCLUDED.test(f));
  return { base, patch, hash: sha256(patch), files };
}

export function uiHash(root, files) {
  const ui = files.filter((f) => UI_FILE.test(f) && !/(\.test\.|\.spec\.|__tests__\/|(^|\/)e2e\/)/.test(f)).sort();
  return sha256(ui.map((f) => `${f}:${fileDigest(root, f)}`).join('\n'));
}

export function workingChanges(root) {
  return (statusEntries(root) || []).filter((e) => !EXCLUDED.test(e.path));
}
