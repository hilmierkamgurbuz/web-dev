import { execFileSync } from 'node:child_process';

export function git(root, args, { input } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.endsWith('\n') ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
}

export function gitOk(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function hasCommits(root) {
  return gitOk(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
}

export function currentBranch(root) {
  return git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
}

export function headSha(root) {
  return git(root, ['rev-parse', 'HEAD']);
}

export function headShort(root) {
  return git(root, ['rev-parse', '--short', 'HEAD']) || 'no-git';
}

export function listFiles(root) {
  const out = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (out == null) return null;
  return [...new Set(out.split('\0').filter(Boolean))];
}

export function statusEntries(root) {
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out == null) return null;
  const parts = out.split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    if (!item) continue;
    const code = item.slice(0, 2);
    const file = item.slice(3);
    entries.push({ code, path: file });
    if (code[0] === 'R' || code[0] === 'C') i++;
  }
  return entries;
}

export function resolveRef(root, candidates) {
  for (const ref of candidates) if (ref && gitOk(root, ['rev-parse', '--verify', '--quiet', ref])) return ref;
  return null;
}

export function defaultRef(root, branch) {
  return resolveRef(root, [`origin/${branch}`, branch]);
}

export function mergeBase(root, ref) {
  return ref ? git(root, ['merge-base', 'HEAD', ref]) : null;
}

export function changedSince(root, base) {
  const files = new Set();
  const diff = base ? git(root, ['diff', '--name-only', '-z', base]) : git(root, ['diff', '--name-only', '-z', 'HEAD']);
  for (const f of (diff || '').split('\0')) if (f) files.add(f);
  const untracked = git(root, ['ls-files', '-o', '--exclude-standard', '-z']);
  for (const f of (untracked || '').split('\0')) if (f) files.add(f);
  return [...files];
}

export function showFile(root, ref, rel) {
  return ref ? git(root, ['show', `${ref}:${rel}`]) : null;
}

export function isIgnored(root, rel) {
  return gitOk(root, ['check-ignore', '-q', '--no-index', rel]);
}

export function upstreamStatus(root) {
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream) return { upstream: null, ahead: null, behind: null };
  const counts = git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) || '0\t0';
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  return { upstream, ahead, behind };
}

export function remoteUrl(root, remote = 'origin') {
  return git(root, ['remote', 'get-url', remote]);
}

export function detectDefaultBranch(root) {
  const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head.replace(/^origin\//, '');
  for (const name of ['main', 'master', 'trunk', 'develop']) if (gitOk(root, ['rev-parse', '--verify', '--quiet', name])) return name;
  return currentBranch(root) || 'main';
}
