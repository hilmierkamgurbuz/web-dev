import fs from 'node:fs';
import path from 'node:path';
import { parseBrief } from './lib/brief.mjs';
import { declaredRange, installedVersion, parseVersion } from './lib/lockfile.mjs';
import { exists, readText } from './lib/io.mjs';
import { layout } from './lib/paths.mjs';
import { detectStack } from './lib/stack.mjs';

const FRAMEWORK_PACKAGES = ['next', 'nuxt', '@sveltejs/kit', '@remix-run/react', '@react-router/dev', 'astro', 'express', 'fastify', 'hono', 'koa', '@nestjs/core', '@prisma/client', 'drizzle-orm', 'typeorm', 'mongoose', 'sequelize', 'next-auth', 'better-auth', '@clerk/nextjs', 'zod', 'vitest', 'jest', '@playwright/test', 'tailwindcss', '@trpc/server'];

function idsIn(text) {
  return [...(text || '').matchAll(/^\s*([DR]-\d{3,})\s*\|/gm)].map((m) => m[1]);
}

export function nextId(root, prefix) {
  const L = layout(root);
  const all = [L.stack, L.decisions, L.product].flatMap((f) => [...(readText(f) || '').matchAll(new RegExp(`\\b${prefix}-(\\d{3,})\\b`, 'g'))].map((m) => Number(m[1])));
  const next = (all.length ? Math.max(...all) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export function checkDocs(root) {
  const L = layout(root);
  const stack = detectStack(root);
  const findings = [];
  const add = (level, code, message) => findings.push({ level, code, message });
  const stackText = readText(L.stack) || '';
  const decisionsText = readText(L.decisions) || '';
  const productText = readText(L.product) || '';

  const chosenPackages = new Set();
  for (const line of stackText.split('\n')) {
    const id = (/^\s*(D-\d{3,})\s*\|/.exec(line) || [])[1];
    if (!id || /status:\s*superseded/i.test(line)) continue;
    const chosen = (/chosen:\s*([^|]+)/.exec(line) || [])[1]?.trim();
    if (!chosen) continue;
    for (const part of chosen.split(/\s*[,+]\s*/)) {
      const m = /^(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)@([^\s]+)$/i.exec(part.trim());
      if (!m) continue;
      const [, name, range] = m;
      chosenPackages.add(name);
      const declared = declaredRange(root, name, stack.packages);
      if (!declared) {
        add('ERROR', 'DOCS-STACK-MISSING', `stack.md ${id} chooses ${name}@${range} but no package.json declares ${name}`);
        continue;
      }
      const want = parseVersion(range);
      const have = parseVersion(installedVersion(root, name) || declared);
      if (want && have && want.major !== have.major) add('WARN', 'DOCS-STACK-STALE', `stack.md ${id} says ${name}@${range}, project has ${installedVersion(root, name) || declared}: update the decision or the dependency`);
    }
  }
  for (const name of FRAMEWORK_PACKAGES) {
    if (stack.deps.has(name) && !chosenPackages.has(name) && !stackText.includes(name)) add('WARN', 'DOCS-STACK-UNRECORDED', `${name} is a project dependency but stack.md records no decision for it`);
  }

  const ids = [...idsIn(stackText), ...idsIn(decisionsText)];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) add('ERROR', 'DOCS-DUPLICATE-ID', `${id} is defined more than once across stack.md and decisions.md`);
    seen.add(id);
  }
  const rids = idsIn(productText);
  const rseen = new Set();
  for (const id of rids) {
    if (rseen.has(id)) add('ERROR', 'DOCS-DUPLICATE-ID', `${id} is defined more than once in product.md`);
    rseen.add(id);
  }

  for (const line of decisionsText.split('\n')) {
    const id = (/^\s*(D-\d{3,})\s*\|/.exec(line) || [])[1];
    if (!id || /status:\s*superseded/i.test(line)) continue;
    const affects = (/affects:\s*([^|]+)/.exec(line) || [])[1] || '';
    for (const token of affects.split(/[\s,]+/)) {
      const clean = token.replace(/[`'"]/g, '').replace(/\/\*\*?$/, '');
      if (!clean || !/[/.]/.test(clean) || /^https?:/.test(clean)) continue;
      if (!exists(path.join(root, clean))) add('WARN', 'DOCS-DECISION-PATH', `decisions.md ${id} affects ${clean}, which no longer exists`);
    }
  }

  let facts = [];
  try {
    facts = fs.readdirSync(L.facts).filter((n) => n.endsWith('.md'));
  } catch {}
  for (const name of facts) {
    const m = /^(.+)@(\d+\.\d+\.\d+[^\s]*)\.md$/.exec(name.replace(/__/g, '/'));
    if (!m) {
      add('WARN', 'DOCS-FACT-NAME', `facts/${name} is not named <package>@<exact version>.md`);
      continue;
    }
    const current = installedVersion(root, m[1]) || declaredRange(root, m[1], stack.packages);
    if (!current) {
      add('WARN', 'DOCS-FACT-ORPHAN', `facts/${name}: ${m[1]} is no longer a dependency`);
      continue;
    }
    const a = parseVersion(m[2]);
    const b = parseVersion(current);
    if (!a || !b) continue;
    if (a.major !== b.major || (a.minor !== null && b.minor !== null && a.minor !== b.minor)) add('WARN', 'DOCS-FACT-STALE', `facts/${name} was distilled for ${m[2]}, project now uses ${current}: re-verify each block against its SOURCE, then rename the file`);
    else if (a.patch !== null && b.patch !== null && a.patch !== b.patch) add('INFO', 'DOCS-FACT-PATCH', `facts/${name}: patch version moved to ${current}`);
  }

  const open = (productText.match(/\[OPEN\]/g) || []).length;
  if (open) add('INFO', 'DOCS-PRODUCT-OPEN', `product.md has ${open} [OPEN] field(s); they resurface in the first brief that touches them`);

  const brief = readText(L.task);
  if (brief) {
    const durable = parseBrief(brief).durable;
    const all = `${stackText}\n${decisionsText}\n${productText}`;
    for (const id of durable) if (!new RegExp(`^\\s*${id}\\s*\\|`, 'm').test(all)) add('WARN', 'DOCS-DURABLE-PENDING', `brief lists ${id} under Durable, but it is not recorded yet`);
  }
  return findings;
}

export function factsReport(root) {
  return checkDocs(root).filter((f) => f.code.startsWith('DOCS-FACT'));
}
