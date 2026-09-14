import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYZER_VERSION, analyzeFile, emptyAnalysis } from '../extract/file.mjs';
import { loadConfig } from './config.mjs';
import { listFiles } from './git.mjs';
import { sha256 } from './hash.mjs';
import { readJson, toPosix, writeJson } from './io.mjs';
import { layout } from './paths.mjs';
import { matchAny } from './shards.mjs';
import { detectStack } from './stack.mjs';
import { CODE_EXTENSIONS, loadTs } from './ts.mjs';

const SKIP_PREFIXES = ['node_modules/', '.claude/', '.git/', 'dist/', 'build/', 'out/', '.next/', '.nuxt/', '.output/', '.svelte-kit/', 'coverage/', '.turbo/', '.vercel/', '.netlify/', 'public/', 'static/', 'vendor/', 'storybook-static/', 'playwright-report/', 'test-results/'];
const SKIP_SEGMENTS = ['/node_modules/', '/dist/', '/build/', '/.next/', '/.nuxt/', '/.output/', '/.svelte-kit/', '/coverage/', '/public/', '/.turbo/'];
const WALK_SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', 'coverage', '.turbo', '.vercel']);

let fingerprint;

export function analyzerFingerprint() {
  if (fingerprint) return fingerprint;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parts = [String(ANALYZER_VERSION)];
  const collect = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith('.mjs')) parts.push(entry.name, fs.readFileSync(full, 'utf8'));
    }
  };
  collect(path.join(here, '..', 'extract'));
  for (const name of ['sfc.mjs', 'ts.mjs', 'tsconfig.mjs']) {
    try {
      parts.push(name, fs.readFileSync(path.join(here, name), 'utf8'));
    } catch {}
  }
  fingerprint = sha256(parts.join('\n')).slice(0, 16);
  return fingerprint;
}

export function isAnalyzable(rel, config) {
  const lower = rel.toLowerCase();
  if (SKIP_PREFIXES.some((p) => lower.startsWith(p)) || SKIP_SEGMENTS.some((s) => lower.includes(s))) return false;
  if (/\.d\.(m|c)?ts$/.test(lower) || /\.min\.(js|css)$/.test(lower)) return false;
  if (matchAny(rel, config.generated)) return false;
  const ext = path.extname(lower);
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ext === '.prisma') return true;
  if (ext === '.sql') return /(^|\/)(migrations?|schema|db|database|sql)\//.test(lower) || /schema\.sql$/.test(lower);
  return false;
}

function walk(root) {
  const out = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name)) visit(dir ? `${dir}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        out.push(dir ? `${dir}/${entry.name}` : entry.name);
      }
    }
  };
  visit('');
  return out;
}

export function projectFiles(root, config) {
  const all = listFiles(root) ?? walk(root);
  return all.map(toPosix).filter((rel) => isAnalyzable(rel, config) && fs.existsSync(path.join(root, rel))).sort();
}

export function projectTags(root, config) {
  if (Array.isArray(config.frameworks) && config.frameworks.length) return config.frameworks;
  return detectStack(root).tags;
}

const SERVER_DEPS = new Set(['express', 'fastify', 'hono', 'koa', '@koa/router', '@nestjs/core', 'next', 'nuxt', '@sveltejs/kit', '@remix-run/node', '@remix-run/react', '@react-router/dev', 'astro', 'h3', 'elysia', '@trpc/server']);

function fileContext(stack, tags) {
  const packages = [...(stack?.packages || [])].sort((a, b) => b.dir.length - a.dir.length);
  const multi = packages.length > 1;
  return (rel) => {
    const pkg = packages.find((p) => p.dir === '.' || rel.startsWith(`${p.dir}/`));
    const serverCapable = !multi || !pkg || pkg.deps.some((d) => SERVER_DEPS.has(d)) || (pkg.dir === '.' && !packages.some((p) => p.dir !== '.' && rel.startsWith(`${p.dir}/`)) && tags.some((t) => ['express', 'fastify', 'hono', 'koa', 'nest', 'next', 'nuxt', 'sveltekit'].includes(t)));
    return { serverCapable, autoImports: tags.includes('nuxt') };
  };
}

export function analyzeProject(root, { config = loadConfig(root), tags = projectTags(root, config), only = null, stack = null } = {}) {
  const ts = loadTs();
  if (!ts) return { ok: false, reason: 'parser-missing', files: new Map(), fileList: [], tags };
  const L = layout(root);
  const resolvedStack = stack || detectStack(root);
  const contextOf = fileContext(resolvedStack, tags);
  const tagsKey = sha256(JSON.stringify({
    tags: [...tags].sort(),
    auth: config.authMarkers,
    validation: config.validationMarkers,
    packages: (resolvedStack.packages || []).map((p) => `${p.dir}:${p.deps.filter((d) => SERVER_DEPS.has(d)).sort().join(',')}`),
  })).slice(0, 16);
  const cache = readJson(L.extractCache, null);
  const version = analyzerFingerprint();
  const cacheValid = cache && cache.v === version && cache.tagsKey === tagsKey;
  const cached = cacheValid ? cache.files : {};
  const nextCache = {};
  const files = new Map();
  const fileList = only ? only.filter((rel) => isAnalyzable(rel, config)) : projectFiles(root, config);
  let changed = !cacheValid;
  for (const rel of fileList) {
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    const prior = cached[rel];
    if (prior && prior.mtimeMs === stat.mtimeMs && prior.size === stat.size) {
      files.set(rel, prior.analysis);
      nextCache[rel] = prior;
      continue;
    }
    let analysis;
    try {
      analysis = analyzeFile(ts, rel, fs.readFileSync(abs, 'utf8'), { tags, validationMarkers: config.validationMarkers, authMarkers: config.authMarkers, ...contextOf(rel) });
    } catch (error) {
      analysis = { ...emptyAnalysis(rel), error: String(error?.message || error) };
    }
    files.set(rel, analysis);
    nextCache[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, analysis };
    changed = true;
  }
  if (!only) {
    if (Object.keys(cached).some((rel) => !nextCache[rel])) changed = true;
    if (changed) writeJson(L.extractCache, { v: version, tagsKey, files: nextCache });
  } else if (changed) {
    writeJson(L.extractCache, { v: version, tagsKey, files: { ...cached, ...nextCache } });
  }
  return { ok: true, files, fileList, tags, ts };
}
