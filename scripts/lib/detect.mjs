import fs from 'node:fs';
import path from 'node:path';

const WEB_DEPS = [
  'react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core',
  'astro', 'solid-js', 'preact', 'qwik', '@builder.io/qwik', 'lit', 'remix', '@remix-run/react',
  'react-router', 'react-router-dom', 'express', 'fastify', 'hono', '@nestjs/core', 'koa', 'h3',
  'elysia', '@hapi/hapi', 'vite', '@vitejs/plugin-react', 'webpack', 'parcel', 'tailwindcss',
];

const WEB_CONFIG = /^(next|nuxt|vite|svelte|astro|remix|angular|vue|tailwind|postcss|webpack|rollup|qwik|solid|waku)\.config\.(m|c)?[jt]s$|^(next|nuxt|svelte|astro|angular|vercel|netlify)\.config\.json$|^angular\.json$|^index\.html$/;

const WEB_SOURCE = /\.(tsx|jsx|vue|svelte|astro|html|css|scss|sass|less)$/;

const SOURCE_DIRS = [
  'src', 'app', 'pages', 'lib', 'components', 'server', 'api', 'routes', 'layouts', 'views',
  'features', 'modules', 'styles', 'hooks', 'stores', 'composables', 'utils', 'db', 'database',
  'models', 'entities', 'schemas', 'middleware', 'prisma', 'drizzle', 'migrations', 'tests',
  'test', 'e2e', '__tests__', 'apps', 'packages', 'services', 'libs', 'content', 'public',
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.output', '.astro', '.vercel',
  '.netlify', '.turbo', '.cache', '.parcel-cache', 'dist', 'build', 'out', 'coverage',
  '.vscode', '.idea', '.DS_Store', 'vendor', '.venv', '__pycache__',
]);

const IGNORABLE_ROOT = new Set([
  '.git', '.gitignore', '.gitattributes', '.DS_Store', 'README.md', 'readme.md', 'LICENSE',
  'LICENSE.md', '.editorconfig', '.vscode', '.idea', 'CLAUDE.md', 'AGENTS.md',
]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

const SCAN_BUDGET = 400;

function hasWebSource(dir, depth, budget = { left: SCAN_BUDGET }) {
  if (depth > 2 || budget.left <= 0) return false;
  for (const entry of entries(dir)) {
    if (budget.left-- <= 0) return false;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (hasWebSource(path.join(dir, entry.name), depth + 1, budget)) return true;
    } else if (WEB_SOURCE.test(entry.name)) return true;
  }
  return false;
}

function workspaceRoots(root, pkg) {
  const globs = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages || [];
  const yaml = (() => {
    try { return fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'); } catch { return ''; }
  })();
  const patterns = [...globs, ...[...yaml.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1])];
  const parents = new Set();
  for (const pattern of patterns) {
    const base = pattern.split('/')[0].replace(/\*+$/, '');
    if (base && !base.includes('*')) parents.add(base);
  }
  return [...parents];
}

function expand(dir, depth) {
  const children = entries(dir).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  if (depth === 0 || !children.some((entry) => SKIP_DIRS.has(entry.name))) return [dir];
  const kept = children.filter((entry) => !SKIP_DIRS.has(entry.name));
  if (!kept.length) return [];
  return kept.flatMap((entry) => expand(path.join(dir, entry.name), depth - 1));
}

export function sourceRoots(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const workspaces = new Set(workspaceRoots(root, pkg));
  const names = new Set([...SOURCE_DIRS, ...workspaces]);
  const roots = [];
  for (const entry of entries(root)) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    if (!names.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    roots.push(...(workspaces.has(entry.name) ? expand(dir, 2) : expand(dir, 1)));
  }
  if (!roots.length) roots.push(root);
  const harness = path.join(root, '.claude', 'web-dev');
  if (fs.existsSync(harness)) roots.push(path.join(harness, 'state'), path.join(harness, 'work'));
  const settings = path.join(root, '.claude');
  if (fs.existsSync(settings)) roots.push(settings);
  return [...new Set(roots)].filter((dir) => fs.existsSync(dir));
}

export function detect(root) {
  if (fs.existsSync(path.join(root, '.claude', 'web-dev'))) {
    return { kind: 'armed', frameworks: frameworksOf(root), reasons: ['.claude/web-dev exists'] };
  }
  const pkgFile = path.join(root, 'package.json');
  const pkg = readJson(pkgFile);
  const reasons = [];
  const top = entries(root);

  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    const found = WEB_DEPS.filter((dep) => deps && dep in deps);
    if (found.length) reasons.push(`package.json depends on ${found.slice(0, 4).join(', ')}`);
    const config = top.filter((entry) => entry.isFile() && WEB_CONFIG.test(entry.name)).map((entry) => entry.name);
    if (config.length) reasons.push(`${config.slice(0, 3).join(', ')} present`);
    if (!found.length && !config.length && hasWebSource(root, 0)) reasons.push('web source files present');
    if (reasons.length) return { kind: 'web', frameworks: frameworksOf(root), reasons };
    return { kind: 'candidate', frameworks: [], reasons: ['package.json without a web framework'] };
  }

  const meaningful = top.filter((entry) => !IGNORABLE_ROOT.has(entry.name) && !SKIP_DIRS.has(entry.name));
  if (!meaningful.length) return { kind: 'empty', frameworks: [], reasons: ['directory has no project files'] };
  if (hasWebSource(root, 0)) return { kind: 'web', frameworks: frameworksOf(root), reasons: ['web source files without package.json'] };
  return { kind: 'other', frameworks: [], reasons: ['no JavaScript or TypeScript project detected'] };
}

export function frameworksOf(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const named = [
    ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'],
    ['@angular/core', 'Angular'], ['@nestjs/core', 'NestJS'], ['remix', 'Remix'],
    ['@remix-run/react', 'Remix'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'],
    ['solid-js', 'Solid'], ['express', 'Express'], ['fastify', 'Fastify'], ['hono', 'Hono'],
  ];
  const out = [];
  for (const [dep, label] of named) if (deps && dep in deps && !out.includes(label)) out.push(label);
  return out;
}
