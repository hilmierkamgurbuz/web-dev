import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, test } from 'node:test';
import { renderMaps } from '../scripts/build_maps.mjs';
import { loadTs } from '../scripts/lib/ts.mjs';
import { readFile, tempProject } from './helpers.mjs';

const ts = loadTs();
const dirs = [];

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
