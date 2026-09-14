import fs from 'node:fs';
import path from 'node:path';
import { detectDefaultBranch, isRepo } from './git.mjs';
import { exists, readJson, readText, toPosix } from './io.mjs';

const DEPENDENCY_TAGS = [
  ['next', 'next'], ['nuxt', 'nuxt'], ['@sveltejs/kit', 'sveltekit'], ['svelte', 'svelte'],
  ['@remix-run/react', 'remix'], ['@react-router/dev', 'react-router'], ['react', 'react'], ['vue', 'vue'],
  ['vite', 'vite'], ['astro', 'astro'], ['@nestjs/core', 'nest'], ['express', 'express'], ['fastify', 'fastify'],
  ['hono', 'hono'], ['koa', 'koa'], ['@koa/router', 'koa'], ['@trpc/server', 'trpc'], ['graphql', 'graphql'],
  ['@prisma/client', 'prisma'], ['prisma', 'prisma'], ['drizzle-orm', 'drizzle'], ['typeorm', 'typeorm'],
  ['mongoose', 'mongoose'], ['sequelize', 'sequelize'], ['knex', 'knex'], ['kysely', 'kysely'],
  ['next-auth', 'next-auth'], ['@auth/core', 'authjs'], ['better-auth', 'better-auth'], ['@clerk/nextjs', 'clerk'],
  ['lucia', 'lucia'], ['passport', 'passport'], ['@supabase/supabase-js', 'supabase'], ['firebase', 'firebase'],
  ['zod', 'zod'], ['valibot', 'valibot'], ['yup', 'yup'], ['joi', 'joi'], ['class-validator', 'class-validator'],
  ['tailwindcss', 'tailwind'], ['vitest', 'vitest'], ['jest', 'jest'], ['@playwright/test', 'playwright'],
  ['cypress', 'cypress'], ['@axe-core/playwright', 'axe'], ['eslint', 'eslint'], ['@biomejs/biome', 'biome'],
  ['typescript', 'typescript'],
];

const DEV_PORTS = [
  ['next', 3000], ['nuxt', 3000], ['nest', 3000], ['sveltekit', 5173], ['remix', 5173],
  ['react-router', 5173], ['astro', 4321], ['vite', 5173], ['express', 3000], ['fastify', 3000], ['hono', 3000],
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', '.svelte-kit', 'coverage', '.turbo']);

function expandWorkspace(root, pattern) {
  const clean = pattern.replace(/^!/, '').replace(/\/$/, '');
  if (!clean.includes('*')) return exists(path.join(root, clean, 'package.json')) ? [clean] : [];
  const [head, ...rest] = clean.split('/*');
  const recursive = clean.includes('**');
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (exists(path.join(root, rel, 'package.json'))) found.push(rel);
      if (recursive && depth < 3) walk(rel, depth + 1);
    }
  };
  if (rest.length <= 1) walk(head.replace(/\/\*$/, ''), 0);
  return found;
}

function workspaceDirs(root, pkg) {
  const patterns = [];
  if (Array.isArray(pkg?.workspaces)) patterns.push(...pkg.workspaces);
  else if (Array.isArray(pkg?.workspaces?.packages)) patterns.push(...pkg.workspaces.packages);
  const pnpm = readText(path.join(root, 'pnpm-workspace.yaml'));
  if (pnpm) {
    for (const m of pnpm.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) patterns.push(m[1]);
  }
  const dirs = new Set();
  for (const pattern of patterns) if (!pattern.startsWith('!')) for (const dir of expandWorkspace(root, pattern)) dirs.add(toPosix(dir));
  return [...dirs].sort();
}

function packageManager(root, pkg) {
  if (typeof pkg?.packageManager === 'string') return pkg.packageManager.split('@')[0];
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function runCommand(pm, script) {
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'pnpm') return `pnpm run ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}

function pickScript(scripts, names) {
  for (const name of names) {
    const value = scripts?.[name];
    if (typeof value === 'string' && value.trim() && !/no test specified/.test(value)) return name;
  }
  return null;
}

export function detectStack(root) {
  const rootPkg = readJson(path.join(root, 'package.json'), null);
  const workspaces = workspaceDirs(root, rootPkg);
  const packages = [{ dir: '.', pkg: rootPkg }, ...workspaces.map((dir) => ({ dir, pkg: readJson(path.join(root, dir, 'package.json'), null) }))].filter((p) => p.pkg);
  const deps = new Map();
  for (const { pkg } of packages) {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] || {})) if (!deps.has(name)) deps.set(name, range);
    }
  }
  const tags = [];
  for (const [dep, tag] of DEPENDENCY_TAGS) if (deps.has(dep) && !tags.includes(tag)) tags.push(tag);
  const pm = packageManager(root, rootPkg);
  const scripts = rootPkg?.scripts || {};
  const commands = { typecheck: '', lint: '', test: '', build: '', dev: '' };
  const typecheck = pickScript(scripts, ['typecheck', 'type-check', 'check-types', 'tsc', 'check']);
  if (typecheck) commands.typecheck = runCommand(pm, typecheck);
  else if (deps.has('typescript') && exists(path.join(root, 'tsconfig.json'))) commands.typecheck = pm === 'npm' ? 'npx tsc --noEmit' : `${pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bunx' : 'pnpm exec'} tsc --noEmit`;
  for (const [key, names] of [['lint', ['lint']], ['test', ['test', 'test:unit']], ['build', ['build']], ['dev', ['dev', 'start:dev', 'start']]]) {
    const name = pickScript(scripts, names);
    if (name) commands[key] = runCommand(pm, name);
  }
  const port = (DEV_PORTS.find(([tag]) => tags.includes(tag)) || [null, 3000])[1];
  return {
    root,
    packageManager: pm,
    workspaces,
    packages: packages.map(({ dir, pkg }) => ({
      dir,
      name: pkg.name || '',
      deps: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) }),
    })),
    deps,
    tags,
    scripts,
    commands,
    devUrl: `http://localhost:${port}`,
    defaultBranch: isRepo(root) ? detectDefaultBranch(root) : 'main',
    hasTypeScript: deps.has('typescript'),
  };
}
