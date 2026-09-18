import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { findSymbol, mapForPath, noteStatus, renderMaps } from '../scripts/build_maps.mjs';
import { analyzeFile, emptyAnalysis } from '../scripts/extract/file.mjs';
import { linkProject } from '../scripts/extract/link.mjs';
import { partName, splitByBudget } from '../scripts/lib/shards.mjs';
import { loadTs } from '../scripts/lib/ts.mjs';
import { PLUGIN, readFile, tempProject, writeFile } from './helpers.mjs';

const ts = loadTs();
const dirs = [];

function project(fixture) {
  const dir = tempProject(fixture);
  dirs.push(dir);
  return dir;
}

function noteEntry(note, h, movedFrom = '') {
  return { note, h, movedFrom };
}

function fileEntry(rel, symbols) {
  return [rel, { symbols }];
}

function symbolEntry(name, hash, requiresNote = true) {
  return { name, hash, requiresNote };
}

function copyRenamed(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyRenamed(from, path.join(destDir, entry.name));
    } else {
      const name = entry.name.endsWith('.mjs') ? entry.name.replace(/\.mjs$/, '.js') : entry.name;
      fs.copyFileSync(from, path.join(destDir, name));
    }
  }
}

const emptyConfig = { authMarkers: [], validationMarkers: [], externalApiPrefixes: [] };

function render(fixture) {
  const dir = tempProject(fixture);
  dirs.push(dir);
  const health = renderMaps(dir, { force: true });
  const map = (name) => readFile(dir, `.claude/web-dev/maps/${name}`) || '';
  const section = (name, heading) => {
    const text = map(name);
    const start = text.indexOf(`## ${heading}\n`);
    if (start === -1) return '';
    const rest = text.slice(start + heading.length + 4);
    const end = rest.indexOf('\n## ');
    return end === -1 ? rest : rest.slice(0, end);
  };
  return { dir, health, map, section };
}

function line(text, startsWith) {
  return text.split('\n').find((l) => l.startsWith(startsWith)) || '';
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('maps: next-prisma', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  const { map, section } = ts ? render('next-prisma') : {};

  test('routes carry handler, auth, validation and callers', () => {
    const routes = section('apimap.md', 'Routes');
    const patch = line(routes, 'PATCH /api/orders/{} |');
    assert.match(patch, /src\/app\/api\/orders\/\[id\]\/route\.ts:PATCH \| auth: auth \| in: NONE/);
    assert.match(patch, /callers: .*useOrders\.ts:updateOrderStatus/);
    assert.match(line(routes, 'POST /api/orders |'), /in: CreateOrderSchema .*db: .*w OrderItem/);
    assert.match(line(routes, 'ACTION cancelOrderAction'), /callers: .*CancelOrderButton\.tsx/);
  });

  test('unmatched and unresolved calls are visible', () => {
    assert.match(section('apimap.md', 'Unmatched calls'), /removeCartItem → DELETE \/api\/cart\/items/);
    assert.match(section('apimap.md', 'Unmatched calls'), /getProfile → ANY \/api\/profile \(no route, via request\(\)\)/);
    assert.match(section('apimap.md', 'Unresolved'), /getProfileDynamic/);
  });

  test('a secret behind a public env prefix is an error', () => {
    assert.match(map('datamap.md'), /ERROR WD-SEC-PUBLIC-ENV NEXT_PUBLIC_STRIPE_SECRET_KEY/);
  });

  test('pages show the client boundary', () => {
    assert.match(map('uimap.md'), /CancelOrderButton \(src\/features\/orders\/components\/CancelOrderButton\.tsx\) \[client\]/);
  });
});

describe('maps: vite-react-express-drizzle', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  const { section, map } = ts ? render('vite-react-express-drizzle') : {};

  test('chained Express routes are all extracted with their mount prefix', () => {
    const routes = section('apimap.md', 'Routes');
    assert.match(line(routes, 'POST /api/posts/{}/comments |'), /comments\.controller\.ts:createComment \| auth: NONE \| in: NONE/);
    assert.match(line(routes, 'GET /api/posts/{}/comments |'), /listComments/);
  });

  test('frontend axios calls are callers, never routes', () => {
    const routes = section('apimap.md', 'Routes');
    for (const l of routes.split('\n').filter(Boolean)) assert.doesNotMatch(l.split(' | ')[1] || '', /^apps\/web\//, l);
    assert.match(line(routes, 'DELETE /api/posts/{} |'), /callers: .*usePosts\.ts:deletePost/);
    assert.equal(section('apimap.md', 'Unauthenticated mutations').trim(), '- POST /api/posts/{}/comments');
  });

  test('react-router pages build the component tree', () => {
    assert.match(map('uimap.md'), /## PAGE \/posts\/\{\} \| apps\/web\/src\/pages\/PostDetailPage\.tsx \| client/);
    assert.match(map('uimap.md'), /CommentForm/);
  });
});

describe('maps: nuxt', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  const { section, map } = ts ? render('nuxt') : {};

  test('auto-imported auth and validation helpers are recognized', () => {
    assert.match(line(section('apimap.md', 'Routes'), 'POST /api/todos |'), /auth: requireUserSession \| in: readValidatedBody .*db: w todos/);
  });

  test('read-only catch-all routes are not flagged as mutations', () => {
    assert.doesNotMatch(section('apimap.md', 'Unauthenticated mutations'), /sitemap/);
    assert.match(section('apimap.md', 'Unauthenticated mutations'), /DELETE \/api\/todos\/\{\}/);
  });

  test('in-memory stores and auto-imported components are mapped', () => {
    assert.match(map('datamap.md'), /^todos \| model: todos \| source: server\/utils\/todos\.ts \(in-memory array\)/m);
    assert.match(map('uimap.md'), /- TodoList \(components\/TodoList\.vue\)[^\n]*\n\s+- TodoItem/);
    assert.match(section('apimap.md', 'Unmatched calls'), /GET \/api\/stats/);
  });
});

describe('maps: sveltekit', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  const { section, map } = ts ? render('sveltekit') : {};

  test('tRPC procedures carry auth from the procedure base', () => {
    const routes = section('apimap.md', 'Routes');
    assert.match(line(routes, 'MUTATION product.create |'), /auth: protectedProcedure \| in: CreateProductSchema/);
    assert.match(line(routes, 'MUTATION product.remove |'), /auth: NONE/);
    assert.match(line(routes, 'QUERY product.list |'), /callers: src\/routes\/products\/\+page\.svelte/);
  });

  test('REST handlers see store writes through the functions they call', () => {
    assert.match(line(section('apimap.md', 'Routes'), 'POST /api/products |'), /db: .*w products/);
    assert.match(line(section('apimap.md', 'Routes'), 'DELETE /api/products/{} |'), /callers: .*handleRemove/);
    assert.match(section('apimap.md', 'Unmatched calls'), /GET \/api\/reviews/);
  });

  test('pages keep their layout and components', () => {
    assert.match(map('uimap.md'), /## PAGE \/products\/\{\} \| src\/routes\/products\/\[slug\]\/\+page\.svelte .*layouts: src\/routes\/\+layout\.svelte/);
  });
});

describe('maps: MOVED requires corroboration', () => {
  test('a coincidental hash match with no name or file link stays orphaned', () => {
    const files = new Map([
      fileEntry('src/a.ts', [symbolEntry('other', 'HASH1')]),
      fileEntry('src/still-here.ts', []),
    ]);
    const notes = { files: new Map(), symbols: new Map([['src/still-here.ts#noop', noteEntry('does nothing', 'HASH1')]]) };
    const status = noteStatus(files, notes, { migrate: true });
    assert.ok(status.orphans.includes('src/still-here.ts#noop'), status.orphans.join(','));
    assert.equal(notes.symbols.has('src/a.ts#other'), false);
    assert.equal(notes.symbols.get('src/still-here.ts#noop').note, 'does nothing');
  });

  test('a rename within the same file migrates on file corroboration', () => {
    const files = new Map([fileEntry('src/a.ts', [symbolEntry('grandTotal', 'HASH2')])]);
    const notes = { files: new Map(), symbols: new Map([['src/a.ts#total', noteEntry('sums it up', 'HASH2')]]) };
    const status = noteStatus(files, notes, { migrate: true });
    assert.equal(status.orphans.length, 0);
    assert.equal(notes.symbols.get('src/a.ts#grandTotal').movedFrom, 'src/a.ts#total');
  });

  test('a whole-file move with a sole hash-matching candidate migrates', () => {
    const files = new Map([fileEntry('src/new/util.ts', [symbolEntry('helperRenamed', 'HASH3')])]);
    const notes = { files: new Map(), symbols: new Map([['src/old/util.ts#helper', noteEntry('a helper', 'HASH3')]]) };
    const status = noteStatus(files, notes, { migrate: true });
    assert.equal(status.orphans.length, 0);
    assert.equal(notes.symbols.get('src/new/util.ts#helperRenamed').movedFrom, 'src/old/util.ts#helper');
  });

  test('two candidates for a gone file stay ambiguous and orphan', () => {
    const files = new Map([fileEntry('src/new/util.ts', [symbolEntry('one', 'HASH4'), symbolEntry('two', 'HASH4')])]);
    const notes = { files: new Map(), symbols: new Map([['src/old/util.ts#helper', noteEntry('a helper', 'HASH4')]]) };
    const status = noteStatus(files, notes, { migrate: true });
    assert.ok(status.orphans.includes('src/old/util.ts#helper'));
  });
});

describe('maps: unresolved ORM entities', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('every distinct unresolved entity is reported, not just the first', () => {
    const dir = project();
    const files = new Map();
    const mk = (rel, symbolName, entity, via) => {
      const a = emptyAnalysis(rel);
      a.symbols = [{ name: symbolName, kind: 'function', exported: true, signature: `${symbolName}()`, line: 1, endLine: 3, lines: 3, hash: 'h', calls: [], db: [{ op: 'r', entity, via }], readsBody: false, requiresNote: true }];
      files.set(rel, a);
    };
    mk('src/a.ts', 'readAlpha', 'Alpha', 'model');
    mk('src/b.ts', 'readBeta', 'Beta', 'model');
    mk('src/c.ts', 'rawGamma', 'gamma_table', 'sql');
    const model = linkProject(dir, { files, tags: [], config: emptyConfig, stack: {} });
    const byName = Object.fromEntries(model.tables.map((t) => [t.name, t]));
    assert.equal(byName.Alpha.source, 'UNRESOLVED');
    assert.equal(byName.Beta.source, 'UNRESOLVED');
    assert.equal(byName.gamma_table.source, 'inferred from queries');
  });
});

describe('maps: astro', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('pages and API routes under src/pages are extracted', () => {
    const dir = project();
    writeFile(dir, 'package.json', JSON.stringify({ name: 'astro-app', dependencies: { astro: '^4.5.0' } }, null, 2));
    writeFile(dir, 'src/pages/index.astro', "---\nconst title = 'Home';\n---\n<h1>{title}</h1>\n");
    writeFile(dir, 'src/pages/blog/[slug].astro', '---\nconst { slug } = Astro.params;\n---\n<p>{slug}</p>\n');
    writeFile(dir, 'src/pages/api/users.ts', "export async function GET() {\n  return new Response('ok');\n}\nexport async function POST() {\n  return new Response('created');\n}\n");
    const health = renderMaps(dir, { force: true });
    assert.equal(health.parser, true);
    const uimap = readFile(dir, '.claude/web-dev/maps/uimap.md') || '';
    assert.match(uimap, /## PAGE \/ \| src\/pages\/index\.astro/);
    assert.match(uimap, /## PAGE \/blog\/\{\} \| src\/pages\/blog\/\[slug\]\.astro/);
    const apimap = readFile(dir, '.claude/web-dev/maps/apimap.md') || '';
    assert.match(apimap, /GET \/api\/users \| src\/pages\/api\/users\.ts:GET/);
    assert.match(apimap, /POST \/api\/users \| src\/pages\/api\/users\.ts:POST/);
  });
});

describe('maps: constructor-injected services', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('this.<injectedProperty>.<method>() resolves through the injected class', () => {
    const dir = project();
    const controllerText = [
      "import { Controller, Get } from '@nestjs/common';",
      "import { UsersService } from './users.service';",
      '',
      "@Controller('users')",
      'export class UsersController {',
      '  constructor(private readonly usersService: UsersService) {}',
      '',
      '  @Get()',
      '  findAll() {',
      '    return this.usersService.findAll();',
      '  }',
      '}',
      '',
    ].join('\n');
    const serviceText = [
      "import { Injectable } from '@nestjs/common';",
      '',
      '@Injectable()',
      'export class UsersService {',
      '  findAll() {',
      "    return db.query('select * from users');",
      '  }',
      '}',
      '',
    ].join('\n');
    const files = new Map();
    files.set('src/users.controller.ts', analyzeFile(ts, 'src/users.controller.ts', controllerText, { tags: ['nest'] }));
    files.set('src/users.service.ts', analyzeFile(ts, 'src/users.service.ts', serviceText, { tags: ['nest'] }));
    const model = linkProject(dir, { files, tags: ['nest'], config: emptyConfig, stack: {} });
    const route = model.routes.find((r) => r.method === 'GET' && r.path === '/users');
    assert.ok(route, JSON.stringify(model.routes));
    assert.deepEqual(route.db, [{ op: 'r', entity: 'users' }]);
  });
});

describe('maps: dynamic import() bindings', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('a destructured dynamic import call joins the call graph', () => {
    const dir = project();
    const routeText = [
      "import express from 'express';",
      'const router = express.Router();',
      '',
      'export async function handleHealth(req, res) {',
      "  const { checkHealth } = await import('../services/health.js');",
      '  res.json(await checkHealth());',
      '}',
      "router.get('/health', handleHealth);",
      'export default router;',
      '',
    ].join('\n');
    const serviceText = ["export function checkHealth() {", "  return db.query('select 1 from health_check');", '}', ''].join('\n');
    const files = new Map();
    files.set('src/routes/health.ts', analyzeFile(ts, 'src/routes/health.ts', routeText, {}));
    files.set('src/services/health.js', analyzeFile(ts, 'src/services/health.js', serviceText, {}));
    const model = linkProject(dir, { files, tags: [], config: emptyConfig, stack: {} });
    const route = model.routes.find((r) => r.method === 'GET' && r.path === '/health');
    assert.ok(route, JSON.stringify(model.routes));
    assert.deepEqual(route.db, [{ op: 'r', entity: 'health_check' }]);
  });
});

describe('maps: secret-shaped default parameters', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('a high-entropy or known-prefix default is scrubbed, an ordinary one is kept', () => {
    const fake = `${['sk', 'live'].join('_')}_4eC39HqLyjWDarjtT1zdp7dc`;
    const text = `export function connect(apiKey = '${fake}', role = 'admin') {\n  return apiKey + role;\n}\n`;
    const a = analyzeFile(ts, 'src/connect.ts', text, {});
    const symbol = a.symbols.find((s) => s.name === 'connect');
    assert.ok(symbol, JSON.stringify(a.symbols));
    assert.match(symbol.signature, /apiKey = …/);
    assert.doesNotMatch(symbol.signature, /sk_live_/);
    assert.match(symbol.signature, /role = 'admin'/);
  });
});

describe('maps: shard token budget', () => {
  test('splitByBudget packs entries in stable path order', () => {
    const entries = [
      { rel: 'a', tokens: 1000 },
      { rel: 'b', tokens: 1000 },
      { rel: 'c', tokens: 1000 },
      { rel: 'd', tokens: 1000 },
    ];
    const parts = splitByBudget(entries, 2500);
    assert.deepEqual(parts.map((p) => p.map((e) => e.rel)), [['a', 'b'], ['c', 'd']]);
  });

  test('a size change to one file never moves an earlier file to a later part', () => {
    const grown = [
      { rel: 'a', tokens: 1000 },
      { rel: 'b', tokens: 1000 },
      { rel: 'c', tokens: 3000 },
      { rel: 'd', tokens: 1000 },
    ];
    const parts = splitByBudget(grown, 2500);
    assert.deepEqual(parts[0].map((e) => e.rel), ['a', 'b']);
  });

  test('partName numbers parts from the second one on', () => {
    assert.equal(partName('server', 0), 'server');
    assert.equal(partName('server', 1), 'server-2');
    assert.equal(partName('server', 2), 'server-3');
  });
});

describe('maps: shard splitting on disk', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('an over-budget shard splits into named parts listed in index.md', () => {
    const dir = project();
    writeFile(dir, '.claude/web-dev/shards.json', JSON.stringify({ shards: [{ name: 'lib', patterns: ['src/lib/**'] }], maxTokens: 40 }, null, 2));
    for (const n of ['a', 'b', 'c']) {
      const body = Array.from({ length: 8 }, (_, i) => `  const v${i} = ${i};`).join('\n');
      writeFile(dir, `src/lib/${n}.ts`, `export function fn${n}() {\n${body}\n  return v0;\n}\n`);
    }
    const health = renderMaps(dir, { force: true });
    assert.equal(health.parser, true);
    const names = fs.readdirSync(path.join(dir, '.claude', 'web-dev', 'maps')).filter((n) => n.startsWith('codemap-lib'));
    assert.ok(names.length >= 2, names.join(','));
    const index = readFile(dir, '.claude/web-dev/maps/index.md') || '';
    for (const name of names) assert.match(index, new RegExp(name.replace('.', '\\.')));
  });
});

describe('maps: narrow retrieval', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('mapForPath returns one file\'s block without the rest of the shard', () => {
    const dir = project();
    writeFile(dir, 'src/lib/price.ts', 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n');
    writeFile(dir, 'src/lib/other.ts', 'export function other() {\n  return 1;\n}\n');
    renderMaps(dir, { force: true });
    const result = mapForPath(dir, 'src/lib/price.ts');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.block, /^## src\/lib\/price\.ts \|/);
    assert.match(result.block, /total\(/);
    assert.doesNotMatch(result.block, /other\(/);
  });

  test('findSymbol locates a symbol by name across shards', () => {
    const dir = project();
    writeFile(dir, 'src/lib/price.ts', 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n');
    renderMaps(dir, { force: true });
    const result = findSymbol(dir, 'total');
    assert.equal(result.ok, true);
    assert.ok(result.matches.some((m) => m.file === 'src/lib/price.ts'), JSON.stringify(result.matches));
  });

  test('findSymbol matches a class method by its bare name', () => {
    const dir = project();
    writeFile(dir, 'src/lib/users.service.ts', "export class UsersService {\n  findAll() {\n    return [1, 2, 3];\n  }\n}\n");
    renderMaps(dir, { force: true });
    const result = findSymbol(dir, 'findAll');
    assert.equal(result.ok, true);
    assert.ok(result.matches.some((m) => m.file === 'src/lib/users.service.ts'), JSON.stringify(result.matches));
  });

  test('mapForPath reports a missing path without pretending it exists', () => {
    const dir = project();
    writeFile(dir, 'src/lib/price.ts', 'export function total(items) {\n  return items;\n}\n');
    renderMaps(dir, { force: true });
    const result = mapForPath(dir, 'src/lib/does-not-exist.ts');
    assert.equal(result.ok, false);
  });
});

describe('maps: token cost on a realistic corpus', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  test('the map/source ratio stays well under source size on the plugin\'s own scripts', () => {
    const dir = project();
    copyRenamed(path.join(PLUGIN, 'scripts'), path.join(dir, 'scripts'));
    const health = renderMaps(dir, { force: true });
    assert.equal(health.parser, true);
    let sourceChars = 0;
    const walkSrc = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walkSrc(full);
        else if (entry.name.endsWith('.js')) sourceChars += fs.readFileSync(full, 'utf8').length;
      }
    };
    walkSrc(path.join(dir, 'scripts'));
    let mapChars = 0;
    const mapsDir = path.join(dir, '.claude', 'web-dev', 'maps');
    for (const name of fs.readdirSync(mapsDir)) if (name.endsWith('.md')) mapChars += fs.readFileSync(path.join(mapsDir, name), 'utf8').length;
    const ratio = mapChars / sourceChars;
    assert.ok(ratio < 0.35, `ratio ${ratio.toFixed(3)} (source ${sourceChars} chars, maps ${mapChars} chars)`);
  });
});
