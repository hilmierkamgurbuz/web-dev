import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseBrief } from './lib/brief.mjs';
import { loadConfig } from './lib/config.mjs';
import { ensureDir, readText, relPath, writeJson } from './lib/io.mjs';
import { layout } from './lib/paths.mjs';
import { branchFiles, uiHash } from './lib/review.mjs';

async function reachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    clearTimeout(timer);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitFor(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await reachable(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

function slug(routePath) {
  return (routePath.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'root').slice(0, 60);
}

function inspectPage({ minTap, minFont, mobile }) {
  const doc = document.documentElement;
  const vw = doc.clientWidth || window.innerWidth;
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (el.classList.length) s += `.${[...el.classList].slice(0, 2).join('.')}`;
    const text = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return text ? `${s} "${text}"` : s;
  };
  const visible = (el) => {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const overflowX = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - vw;
  const offenders = [];
  if (overflowX > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || !visible(el)) continue;
      let parent = el.parentElement;
      let clipped = false;
      while (parent && parent !== document.body) {
        const o = getComputedStyle(parent).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') {
          clipped = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!clipped) offenders.push(`${describe(el)} right edge ${Math.round(r.right)}px`);
      if (offenders.length >= 6) break;
    }
  }
  const smallTargets = [];
  if (mobile) {
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab]')) {
      if (!visible(el)) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, td, dd, blockquote')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < minTap || r.height < minTap) smallTargets.push(`${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}px`);
      if (smallTargets.length >= 8) break;
    }
  }
  const smallText = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body || doc, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.trim().length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minFont) smallText.push(`${describe(el)} ${size}px`);
    if (smallText.length >= 6) break;
  }
  const meta = document.querySelector('meta[name="viewport"]');
  return {
    overflowX: Math.round(overflowX),
    offenders,
    smallTargets,
    smallText,
    hasViewportMeta: !!meta,
    zoomDisabled: !!meta && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0+)?(\s|,|$)/i.test(meta.content),
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
  };
}

export async function runResponsive(root, { paths: requested = [], baseUrl = null, log = () => {} } = {}) {
  const L = layout(root);
  const config = loadConfig(root);
  const briefText = readText(L.task);
  const paths = requested.length ? requested : briefText ? parseBrief(briefText).responsive : [];
  const targets = paths.length ? paths : config.responsive.paths;
  const infra = (message) => ({ ok: false, infra: true, summary: `responsive: not run — ${message}`, results: [] });
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  let playwright;
  try {
    playwright = requireFromProject('@playwright/test');
  } catch {
    try {
      playwright = requireFromProject('playwright');
    } catch {
      return infra('Playwright is not installed in this project (add @playwright/test through a brief, then npx playwright install chromium)');
    }
  }
  let AxeBuilder = null;
  try {
    const axe = requireFromProject('@axe-core/playwright');
    AxeBuilder = axe.default || axe.AxeBuilder || axe;
  } catch {}
  const seoWanted = (() => {
    const line = (readText(L.product) || '').split('\n').find((l) => /^-\s*SEO:/i.test(l)) || '';
    return !!line && !/\[OPEN\]|:\s*(none|no|-)\s*$/i.test(line);
  })();

  const url = baseUrl || config.devUrl;
  let server = null;
  if (!(await reachable(url))) {
    if (!config.commands.dev) return infra(`${url} is not reachable and config.json has no dev command`);
    log(`starting dev server: ${config.commands.dev}`);
    const port = new URL(url).port;
    server = spawn(config.commands.dev, { cwd: root, shell: true, stdio: 'ignore', detached: process.platform !== 'win32', env: { ...process.env, BROWSER: 'none', ...(port ? { PORT: port } : {}) } });
    if (!(await waitFor(url, 120000))) {
      stopServer(server);
      return infra(`the dev server did not answer at ${url} within 120 s`);
    }
  }

  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (error) {
    stopServer(server);
    return infra(`Chromium did not start (${String(error.message).split('\n')[0]}); run npx playwright install chromium`);
  }

  ensureDir(L.shots);
  const results = [];
  try {
    for (const routePath of targets) {
      for (const [width, height] of config.responsive.viewports) {
        const mobile = width < 800;
        const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const consoleErrors = [];
        page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)));
        page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)));
        const findings = [];
        let status = null;
        try {
          const response = await page.goto(new URL(routePath, url).toString(), { waitUntil: 'networkidle', timeout: 60000 });
          status = response ? response.status() : null;
          if (status && status >= 400) findings.push(`HTTP ${status}`);
        } catch (error) {
          findings.push(`navigation failed: ${String(error.message).split('\n')[0]}`);
        }
        await page.waitForTimeout(400);
        let metrics = null;
        try {
          metrics = await page.evaluate(inspectPage, { minTap: config.responsive.minTapTargetPx, minFont: config.responsive.minFontPx, mobile });
        } catch (error) {
          findings.push(`inspection failed: ${error.message}`);
        }
        if (metrics) {
          if (metrics.overflowX > 1) findings.push(`horizontal overflow ${metrics.overflowX}px${metrics.offenders.length ? `: ${metrics.offenders.join('; ')}` : ''}`);
          if (metrics.smallTargets.length) findings.push(`tap targets below ${config.responsive.minTapTargetPx}px: ${metrics.smallTargets.join('; ')}`);
          if (metrics.smallText.length) findings.push(`text below ${config.responsive.minFontPx}px: ${metrics.smallText.join('; ')}`);
          if (!metrics.hasViewportMeta) findings.push('missing <meta name="viewport">');
          if (metrics.zoomDisabled) findings.push('viewport meta disables zoom');
          if (seoWanted && width === config.responsive.viewports[0][0]) {
            if (!metrics.title.trim()) findings.push('missing <title>');
            if (!metrics.description.trim()) findings.push('missing meta description');
          }
        }
        if (consoleErrors.length) findings.push(`console errors: ${[...new Set(consoleErrors)].slice(0, 4).join(' | ')}`);
        if (AxeBuilder) {
          try {
            const report = await new AxeBuilder({ page }).analyze();
            const serious = report.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
            if (serious.length) findings.push(`accessibility: ${serious.map((v) => `${v.id} ×${v.nodes.length}`).join(', ')}`);
          } catch {}
        }
        const shot = path.join(L.shots, `${slug(routePath)}-${width}x${height}.png`);
        try {
          await page.screenshot({ path: shot, fullPage: true });
        } catch {}
        results.push({ path: routePath, viewport: `${width}x${height}`, status, ok: findings.length === 0, findings, screenshot: relPath(root, shot) });
        log(`${findings.length ? '✗' : '✓'} ${routePath} @ ${width}x${height}${findings.length ? ` — ${findings.length} finding(s)` : ''}`);
        await context.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
    stopServer(server);
  }

  const findingCount = results.reduce((n, r) => n + r.findings.length, 0);
  const byPath = targets.map((p) => ({ path: p, ok: results.filter((r) => r.path === p).every((r) => r.ok) }));
  const record = {
    at: new Date().toISOString(),
    ok: findingCount === 0,
    summary: `responsive: ${config.responsive.viewports.length} viewports × ${targets.length} path(s) · ${findingCount} finding(s)`,
    uiHash: uiHash(root, branchFiles(root, config)),
    results: byPath,
    details: results,
    axe: !!AxeBuilder,
  };
  writeJson(L.responsiveState, record);
  return record;
}
