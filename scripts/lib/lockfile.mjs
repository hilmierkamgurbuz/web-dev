import path from 'node:path';
import { readJson, readText } from './io.mjs';

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function installedVersion(root, name, dir = '.') {
  const base = path.join(root, dir);
  const pkgLock = readJson(path.join(root, 'package-lock.json'), null);
  if (pkgLock?.packages) {
    const entry = pkgLock.packages[`${dir === '.' ? '' : `${dir}/`}node_modules/${name}`] || pkgLock.packages[`node_modules/${name}`];
    if (entry?.version) return entry.version;
  }
  const pnpm = readText(path.join(root, 'pnpm-lock.yaml'));
  if (pnpm) {
    const importer = new RegExp(`\\n\\s+['"]?${escapeRe(name)}['"]?:\\n\\s+specifier:[^\\n]*\\n\\s+version:\\s*['"]?([0-9][^\\s('"]*)`).exec(pnpm);
    if (importer) return importer[1];
    const pkg = new RegExp(`\\n\\s+['"]?/?${escapeRe(name)}@([0-9][^:('"\\s]*)`).exec(pnpm);
    if (pkg) return pkg[1];
  }
  const yarn = readText(path.join(root, 'yarn.lock'));
  if (yarn) {
    const m = new RegExp(`\\n"?${escapeRe(name)}@[^\\n]*:\\n\\s+version:?\\s+"?([0-9][^"\\s]*)`).exec(yarn);
    if (m) return m[1];
  }
  const bun = readText(path.join(root, 'bun.lock'));
  if (bun) {
    const m = new RegExp(`"${escapeRe(name)}":\\s*\\["${escapeRe(name)}@([0-9][^"]*)"`).exec(bun);
    if (m) return m[1];
  }
  const nm = readJson(path.join(base, 'node_modules', name, 'package.json'), null) || readJson(path.join(root, 'node_modules', name, 'package.json'), null);
  if (nm?.version) return nm.version;
  return null;
}

export function declaredRange(root, name, packages = [{ dir: '.' }]) {
  for (const p of packages) {
    const pkg = readJson(path.join(root, p.dir, 'package.json'), null);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg?.[field]?.[name]) return pkg[field][name];
    }
  }
  return null;
}

export function parseVersion(value) {
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(String(value || ''));
  if (!m) return null;
  const num = (v) => (v === undefined || v === 'x' || v === '*' ? null : Number(v));
  return { major: Number(m[1]), minor: num(m[2]), patch: num(m[3]) };
}

export function lockfiles(root, dirs = []) {
  const names = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
  const found = [];
  for (const dir of ['.', ...dirs]) for (const name of names) if (readText(path.join(root, dir, name)) != null) found.push(path.posix.join(dir, name).replace(/^\.\//, ''));
  return [...new Set(found)];
}
