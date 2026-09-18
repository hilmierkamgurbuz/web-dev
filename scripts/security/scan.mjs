import path from 'node:path';
import { packageNameOf } from '../lib/brief.mjs';
import { matchGlob } from '../lib/shards.mjs';
import { CODE_EXTENSIONS, SFC_EXTENSIONS } from '../lib/ts.mjs';
import { addedCommentFindings } from './comments.mjs';
import { gitleaksFindings } from './external.mjs';
import { astFindings } from './rules.mjs';
import { addedLines, envFileFindings, secretFindings } from './secrets.mjs';

const MIGRATION_PATH = /(^|\/)(migrations?|migrate|db\/migrate|drizzle|prisma\/migrations)\//i;
const SQL_DESTRUCTIVE = [
  [/\bdrop\s+(table|schema|database|view|materialized\s+view|type)\b/i, 'DROP'],
  [/\balter\s+table\s+\S+\s+drop\b/i, 'ALTER TABLE … DROP'],
  [/\bdrop\s+column\b/i, 'DROP COLUMN'],
  [/\btruncate\b/i, 'TRUNCATE'],
  [/\bdelete\s+from\s+[`"\w.]+\s*(;|$)/i, 'DELETE without WHERE'],
  [/\balter\s+column\s+\S+\s+(type|set\s+data\s+type)\b/i, 'column type change'],
  [/\brename\s+(column|to)\b/i, 'RENAME'],
];
const CODE_DESTRUCTIVE = [
  [/\b(dropTable|dropTableIfExists|dropColumn|dropColumns|renameColumn|renameTable|dropSchema|truncate)\s*\(/, 'destructive schema call'],
  [/\.(dropTable|dropColumn|renameColumn)\s*\(/, 'destructive schema call'],
];

export function isTestPath(rel) {
  return /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)e2e\/|(^|\/)tests?\/)/.test(rel);
}

const FAKE_DATA_DIR = /(^|\/)(mocks?|__mocks__|msw|fixtures|seeds?|demo-data)\//i;
const FAKE_DATA_FILE = /\.(stories|story|mock)\.[cm]?[jt]sx?$|(^|\/)seeds?\.[cm]?[jt]sx?$/i;

export function isFakeDataPath(rel) {
  return FAKE_DATA_DIR.test(rel) || FAKE_DATA_FILE.test(rel);
}

function migrationFindings(newText, oldText, brief, patterns) {
  if (brief?.migrations?.length) return [];
  const findings = [];
  for (const { text, line } of addedLines(newText, oldText)) {
    for (const [re, label] of patterns) {
      if (re.test(text)) {
        findings.push({ rule: 'WD-SEC-MIGRATION', line, message: `${label} in a migration that the brief does not declare`, fix: 'declare it under "Migrations:" in the brief with a data preservation plan, and get approval again' });
        break;
      }
    }
  }
  return findings;
}

function prismaFindings(newText, oldText, brief) {
  if (oldText == null || brief?.migrations?.length) return [];
  const models = (text) => {
    const map = new Map();
    for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
      const fields = new Map();
      for (const l of m[2].split('\n')) {
        const f = /^\s*(\w+)\s+([\w\[\]?]+)/.exec(l);
        if (f && !l.trim().startsWith('@@') && !l.trim().startsWith('//')) fields.set(f[1], f[2]);
      }
      map.set(m[1], fields);
    }
    return map;
  };
  const before = models(oldText);
  const after = models(newText);
  const findings = [];
  for (const [model, fields] of before) {
    if (!after.has(model)) {
      findings.push({ rule: 'WD-SEC-MIGRATION', line: 1, message: `model ${model} removed`, fix: 'declare the removal under "Migrations:" in the brief and get approval again' });
      continue;
    }
    for (const [field, type] of fields) {
      const next = after.get(model).get(field);
      if (next === undefined) findings.push({ rule: 'WD-SEC-MIGRATION', line: 1, message: `${model}.${field} removed or renamed`, fix: 'declare it under "Migrations:" in the brief (expand/contract), then get approval again' });
      else if (next.replace('?', '') !== type.replace('?', '') || (type.endsWith('?') && !next.endsWith('?'))) findings.push({ rule: 'WD-SEC-MIGRATION', line: 1, message: `${model}.${field} changed ${type} → ${next}`, fix: 'declare the type change under "Migrations:" with a backfill plan' });
    }
  }
  return findings;
}

function dependencyFindings(newText, oldText, brief) {
  let next;
  let prev = {};
  try {
    next = JSON.parse(newText);
    prev = oldText ? JSON.parse(oldText) : {};
  } catch {
    return [];
  }
  const collect = (pkg) => new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((f) => Object.keys(pkg?.[f] || {})));
  const before = collect(prev);
  const declared = new Set((brief?.dependencies || []).map(packageNameOf));
  const findings = [];
  for (const name of collect(next)) {
    if (!before.has(name) && !declared.has(name)) {
      findings.push({ rule: 'WD-DEP', line: 1, message: `dependency "${name}" is not declared in the brief`, fix: 'add it to "Dependencies:" in the brief (tech-choice.md), then get approval again' });
    }
  }
  findings.push(...scriptFindings(next.scripts || {}, prev.scripts || {}));
  return findings;
}

const LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'preuninstall', 'uninstall', 'postuninstall']);
const PIPED_INTERPRETER = /\b(curl|wget|iwr|Invoke-WebRequest)\b[\s\S]{0,160}\|\s*(sudo\s+)?(sh|bash|zsh|node|python3?|ruby|perl)\b/i;
const REMOTE_EXEC = /\b(npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+(--yes\s+|-y\s+)?https?:\/\//i;

function scriptFindings(next, prev) {
  const findings = [];
  for (const [name, body] of Object.entries(next)) {
    const text = String(body || '');
    if (prev[name] === body) continue;
    if (PIPED_INTERPRETER.test(text) || REMOTE_EXEC.test(text)) {
      findings.push({
        rule: 'WD-SEC-SCRIPT-FETCH',
        line: 1,
        message: `package.json script "${name}" downloads code and runs it: ${text.slice(0, 80)}`,
        fix: 'vendor the script into the repository and run it from there, so what executes is reviewable and pinned',
      });
      continue;
    }
    if (LIFECYCLE.has(name) && !(name in prev)) {
      findings.push({
        rule: 'WD-SEC-LIFECYCLE',
        line: 1,
        message: `package.json adds the "${name}" lifecycle script, which every install runs automatically`,
        fix: 'declare it in the brief and say what it does, or move the work into an explicit script the user runs on purpose',
      });
    }
  }
  return findings;
}

export function applyExceptions(findings, rel, brief) {
  const exceptions = brief?.exceptions || [];
  if (!exceptions.length) return findings;
  return findings.filter((f) => !exceptions.some((e) => e.rule === f.rule && (e.path === rel || matchGlob(rel, e.path))));
}

export function scanContent({ ts, root, rel, newText, oldText = null, config, brief = null, tags = [], generated = false, clientFile = false }) {
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  const isTest = isTestPath(rel) || isFakeDataPath(rel);
  const findings = [];
  const notices = [];

  if (/^\.env(\..+)?$/.test(base)) {
    findings.push(...envFileFindings(newText, { example: /\.(example|sample|template)$/.test(base) }));
    return { findings: applyExceptions(findings, rel, brief), notices };
  }

  findings.push(...secretFindings(newText, { oldText, isTest }));
  if (root) {
    const external = gitleaksFindings(root, rel, newText, oldText, config);
    findings.push(...external.findings);
    if (external.notice) notices.push(external.notice);
  }
  if (generated) return { findings: applyExceptions(findings, rel, brief), notices };

  if (CODE_EXTENSIONS.has(ext)) {
    if (!ts) return { findings: applyExceptions(findings, rel, brief), notices, parserMissing: true };
    try {
      findings.push(...astFindings(ts, rel, newText, { tags, clientFile }));
    } catch (error) {
      notices.push(`pattern scan skipped: ${error.message}`);
    }
    const comments = addedCommentFindings(ts, rel, newText, oldText, config);
    findings.push(...comments.findings);
    notices.push(...comments.warnings);
    if (MIGRATION_PATH.test(rel)) findings.push(...migrationFindings(newText, oldText, brief, [...CODE_DESTRUCTIVE, ...SQL_DESTRUCTIVE]));
  } else if (['.css', '.scss', '.sass', '.less', '.html', '.htm'].includes(ext)) {
    const comments = addedCommentFindings(ts, rel, newText, oldText, config);
    findings.push(...comments.findings);
    notices.push(...comments.warnings);
  } else if (ext === '.sql') {
    findings.push(...migrationFindings(newText, oldText, brief, SQL_DESTRUCTIVE));
  } else if (ext === '.prisma') {
    findings.push(...prismaFindings(newText, oldText, brief));
  }
  if (base === 'package.json') findings.push(...dependencyFindings(newText, oldText, brief));
  return { findings: applyExceptions(findings, rel, brief), notices };
}

export function formatFindings(findings, limit = 12) {
  const lines = findings.slice(0, limit).map((f) => `- ${f.rule} L${f.line}: ${f.message} → ${f.fix}`);
  if (findings.length > limit) lines.push(`- … ${findings.length - limit} more`);
  return lines.join('\n');
}

const SERVER_ONLY_SPECIFIERS = new Set([
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2',
  'net', 'node:net', 'tls', 'node:tls', 'dgram', 'node:dgram',
  'dns', 'node:dns', 'dns/promises', 'node:dns/promises',
  'child_process', 'node:child_process', 'cluster', 'node:cluster', 'worker_threads', 'node:worker_threads',
  'express', 'fastify', 'koa', '@koa/router', 'hono', '@nestjs/core', 'h3', 'elysia', '@trpc/server',
  'pg', 'pg-promise', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'sequelize', 'knex', 'kysely', 'better-sqlite3',
  'ioredis', 'redis', '@prisma/client', 'drizzle-orm', 'typeorm', 'server-only',
]);
const IMPORT_SPECIFIER = /\b(?:from|require\()\s*['"]([^'"]+)['"]/g;

function moduleBase(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

function hasServerEvidence(text) {
  for (const m of text.matchAll(IMPORT_SPECIFIER)) {
    if (SERVER_ONLY_SPECIFIERS.has(m[1]) || SERVER_ONLY_SPECIFIERS.has(moduleBase(m[1]))) return true;
  }
  return false;
}

export function isClientPath(rel, text) {
  if (/^\s*['"]use client['"]/.test(text)) return true;
  if (/^\s*['"]use server['"]/.test(text)) return false;
  if (/(^|\/)(server|api|controllers|services|db|middleware|middlewares)\//.test(rel) || /(\.server\.|\+server\.|\+page\.server\.|hooks\.server\.)/.test(rel)) return false;
  if (hasServerEvidence(text)) return false;
  if (SFC_EXTENSIONS.has(path.extname(rel))) return true;
  return false;
}
