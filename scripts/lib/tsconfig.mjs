import path from 'node:path';
import { readText } from './io.mjs';

export function parseJsonc(text) {
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === quote) {
        inString = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readConfigChain(root, rel, depth = 0) {
  const file = path.join(root, rel);
  const text = readText(file);
  if (text == null || depth > 3) return {};
  let data;
  try {
    data = parseJsonc(text);
  } catch {
    return {};
  }
  let base = {};
  const ext = data.extends;
  if (typeof ext === 'string' && ext.startsWith('.')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ext.endsWith('.json') ? ext : `${ext}.json`));
    base = readConfigChain(root, target, depth + 1);
    if (base.compilerOptions?.baseUrl) {
      base.compilerOptions.baseUrl = path.posix.join(path.posix.dirname(target), base.compilerOptions.baseUrl);
    }
  }
  const options = { ...(base.compilerOptions || {}), ...(data.compilerOptions || {}) };
  if (data.compilerOptions?.baseUrl) options.baseUrl = path.posix.join(path.posix.dirname(rel), data.compilerOptions.baseUrl);
  if (data.compilerOptions?.paths) options.pathsBase = path.posix.dirname(rel);
  return { compilerOptions: options };
}

export function loadAliases(root, frameworks = []) {
  const aliases = [];
  for (const rel of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json']) {
    const options = readConfigChain(root, rel).compilerOptions;
    if (!options?.paths) continue;
    const base = options.baseUrl ?? options.pathsBase ?? '.';
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets) || !targets.length) continue;
      aliases.push({
        pattern,
        targets: targets.map((t) => path.posix.normalize(path.posix.join(base, t))),
      });
    }
    break;
  }
  const has = (name) => frameworks.includes(name);
  if (has('sveltekit')) aliases.push({ pattern: '$lib/*', targets: ['src/lib/*'] }, { pattern: '$lib', targets: ['src/lib'] });
  if (has('nuxt')) aliases.push({ pattern: '~/*', targets: ['./*', 'app/*'] }, { pattern: '@/*', targets: ['./*', 'app/*'] });
  if (!aliases.some((a) => a.pattern === '@/*')) aliases.push({ pattern: '@/*', targets: ['src/*', './*'] });
  return aliases;
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];

function candidates(base) {
  const list = [base];
  const stripped = base.replace(/\.(m|c)?jsx?$/, '');
  if (stripped !== base) for (const ext of ['.ts', '.tsx', '.mts', '.cts']) list.push(stripped + ext);
  for (const ext of EXTENSIONS) list.push(base + ext);
  for (const ext of EXTENSIONS) list.push(`${base}/index${ext}`);
  return list.map((p) => path.posix.normalize(p).replace(/^\.\//, ''));
}

function firstExisting(base, fileSet) {
  for (const candidate of candidates(base)) if (fileSet.has(candidate)) return candidate;
  return null;
}

export function resolveImport(fromRel, spec, { aliases, fileSet }) {
  if (!spec) return null;
  if (spec.startsWith('.')) return firstExisting(path.posix.join(path.posix.dirname(fromRel), spec), fileSet);
  if (spec.startsWith('/')) return firstExisting(spec.slice(1), fileSet);
  for (const alias of aliases) {
    const star = alias.pattern.indexOf('*');
    if (star === -1) {
      if (spec !== alias.pattern) continue;
      for (const target of alias.targets) {
        const hit = firstExisting(target, fileSet);
        if (hit) return hit;
      }
      continue;
    }
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    const middle = spec.slice(prefix.length, spec.length - suffix.length);
    for (const target of alias.targets) {
      const hit = firstExisting(target.replace('*', middle), fileSet);
      if (hit) return hit;
    }
  }
  return null;
}
