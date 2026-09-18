import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';
import { runResponsive } from '../scripts/responsive_check.mjs';
import { git, PLUGIN, writeFile } from './helpers.mjs';

function playwrightAvailable() {
  try {
    createRequire(import.meta.url)('@playwright/test');
    return true;
  } catch {
    return false;
  }
}

function inTreeProject() {
  const dir = fs.mkdtempSync(path.join(PLUGIN, '.responsive-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'responsive-probe', private: true, type: 'module' }, null, 2));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'baseline');
  return dir;
}

const AVAILABLE = playwrightAvailable();

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Good</title>
<style>body{font-family:system-ui;margin:0;padding:1rem}main{max-width:60rem;margin:0 auto}
button{font-size:1rem;padding:.75rem 1.25rem;min-height:44px}</style></head>
<body><main><h1>Bakery</h1><p>Fresh bread.</p><button type="button">Order now</button></main></body></html>`;

const WIDE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Wide</title></head>
<body><table id="pricing" style="width:1400px"><tr><td>A wide table nobody made scrollable.</td></tr></table></body></html>`;

let server;
let base;
let dir;

before(async () => {
  if (!AVAILABLE) return;
  dir = inTreeProject();
  writeFile(dir, 'public/index.html', GOOD);
  writeFile(dir, 'public/wide.html', WIDE);
  const root = path.join(dir, 'public');
  server = createServer((req, res) => {
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    const full = path.join(root, file);
    if (!fs.existsSync(full)) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>404</title>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(full));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('wd responsive', { skip: !AVAILABLE && '@playwright/test is not installed' }, () => {
  test('a page that is actually responsive passes every viewport', async () => {
    const result = await runResponsive(dir, { config: DEFAULT_CONFIG, paths: ['/'], baseUrl: base });
    assert.equal(result.infra, undefined, String(result.infra));
    assert.equal(result.ok, true, JSON.stringify(result.details?.flatMap((r) => r.findings)));
    assert.equal(result.details.length, DEFAULT_CONFIG.responsive.viewports.length);
    assert.deepEqual(result.results, [{ path: '/', ok: true }]);
  });

  test('horizontal overflow is caught on the narrow viewports and not on the wide one', async () => {
    const result = await runResponsive(dir, { config: DEFAULT_CONFIG, paths: ['/wide.html'], baseUrl: base });
    assert.equal(result.infra, undefined, String(result.infra));
    assert.equal(result.ok, false);
    const byViewport = Object.fromEntries(result.details.map((r) => [r.viewport, r.findings]));
    assert.match(byViewport['360x800'].join(' '), /horizontal overflow \d+px/, 'a 1400px table on a 360px screen is the defect this gate exists for');
    assert.match(byViewport['360x800'].join(' '), /table#pricing/, 'and it has to name the element');
    assert.deepEqual(byViewport['1440x900'], [], '1400px fits in 1440, so there is nothing to report');
  });

  test('a screenshot is written for every viewport, so a finding can be looked at', async () => {
    const result = await runResponsive(dir, { config: DEFAULT_CONFIG, paths: ['/'], baseUrl: base });
    assert.equal(result.details.length, DEFAULT_CONFIG.responsive.viewports.length);
    for (const entry of result.details) {
      assert.ok(fs.existsSync(path.join(dir, entry.screenshot)), entry.screenshot);
    }
  });
});
