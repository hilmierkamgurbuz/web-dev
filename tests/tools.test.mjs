import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';
import { deepScan, hasBinary } from '../scripts/security/external.mjs';
import { PLUGIN, tempProject, writeFile } from './helpers.mjs';

const STRIPE_PREFIX = ['sk', 'live'].join('_');
const FAKE_STRIPE_KEY = `${STRIPE_PREFIX}_51H8xQwKZvKQ9mXbTnR4dLpYcVfGhJkMnOpQrStUvWxYz`;

const RULES = path.join(PLUGIN, 'scripts/security/opengrep/web-dev.yml');
const TOOL = hasBinary('opengrep') ? 'opengrep' : hasBinary('semgrep') ? 'semgrep' : null;

const TRIPWIRES = `import express from 'express';
import https from 'node:https';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const app = express();
app.get('/r', (req, res) => res.redirect(req.query.next as string));
export async function q(db: any, id: string) { return db.query(\`SELECT * FROM users WHERE id = \${id}\`); }
export function run(dir: string) { exec(\`ls \${dir}\`); }
app.get('/p', async (req, res) => { const r = await fetch(req.query.url as string); res.send(await r.text()); });
app.get('/f', (req, res) => { const p = path.join('/data', req.query.name as string); res.send(fs.readFileSync(p, 'utf8')); });
export function verify(token: string, key: string) { return jwt.verify(token, key, { algorithms: ['none'] }); }
app.use(cors({ origin: '*', credentials: true }));
export const agent = new https.Agent({ rejectUnauthorized: false });
`;

const JSX_TRIPWIRE = `export function Bad({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;

const dirs = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the bundled deep-scan ruleset', () => {
  test('is a rule file the tool accepts, not just a file that exists', { skip: !TOOL && 'opengrep/semgrep not installed' }, () => {
    const dir = tempProject();
    dirs.push(dir);
    writeFile(dir, 'probe.ts', 'export const a = 1;\n');
    const args = ['scan', '--config', RULES, '--json', '--quiet'];
    if (TOOL === 'semgrep') args.push('--metrics=off', '--disable-version-check');
    const run = spawnSync(TOOL, [...args, 'probe.ts'], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    const data = JSON.parse(run.stdout || 'null');
    assert.ok(data, `${TOOL} produced no JSON: ${run.stderr}`);
    assert.deepEqual(data.errors || [], [], 'a rule file the tool rejects makes every later scan a false all-clear');
  });

  test('every rule in it fires on code that should trip it', { skip: !TOOL && 'opengrep/semgrep not installed' }, () => {
    const dir = tempProject();
    dirs.push(dir);
    writeFile(dir, 'bad.ts', TRIPWIRES);
    writeFile(dir, 'Bad.tsx', JSX_TRIPWIRE);
    const result = deepScan(dir, ['bad.ts', 'Bad.tsx'], DEFAULT_CONFIG);
    assert.equal(result.available, true);
    assert.equal(result.error, undefined, String(result.error));
    const fired = new Set(result.findings.map((f) => f.rule.replace('WD-DEEP:', '')));
    const declared = fs.readFileSync(RULES, 'utf8').split('\n').filter((l) => l.trim().startsWith('- id:')).map((l) => l.split('- id:')[1].trim());
    assert.ok(declared.length >= 9, 'the ruleset should carry the documented rules');
    const silent = declared.filter((id) => !fired.has(id));
    assert.deepEqual(silent, [], 'a rule that never fires is a rule nobody is checking');
  });

  test('a rule file the tool rejects is reported as an error, never as a clean scan', { skip: !TOOL && 'opengrep/semgrep not installed' }, () => {
    const dir = tempProject();
    dirs.push(dir);
    writeFile(dir, 'bad.ts', TRIPWIRES);
    const broken = path.join(PLUGIN, 'scripts/security/opengrep/_broken.yml');
    fs.writeFileSync(broken, 'rules:\n  - id: x\n    languages: [typescript]\n    severity: ERROR\n    message: x\n    pattern: <$EL a={{b: $X}} />\n');
    try {
      const args = ['scan', '--config', path.dirname(broken), '--json', '--quiet'];
      const run = spawnSync(TOOL, [...args, 'bad.ts'], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
      const data = JSON.parse(run.stdout || 'null');
      assert.ok((data?.errors || []).length, 'the tool should report the broken rule file');
    } finally {
      fs.rmSync(broken, { force: true });
    }
  });
});

describe('secret scanning with gitleaks', () => {
  test('a planted credential is caught in the working tree', { skip: !hasBinary('gitleaks') && 'gitleaks not installed' }, async () => {
    const { gitleaksFindings } = await import('../scripts/security/external.mjs');
    const dir = tempProject();
    dirs.push(dir);
    const text = `export const stripe = "${FAKE_STRIPE_KEY}";\n`;
    writeFile(dir, 'src/pay.ts', text);
    const result = gitleaksFindings(dir, 'src/pay.ts', text, null, DEFAULT_CONFIG);
    assert.ok(result.findings.length, `gitleaks found nothing: ${result.notice || ''}`);
    assert.equal(result.findings[0].rule, 'WD-SEC-SECRET');
  });
});

describe('dependency vulnerabilities with osv-scanner', () => {
  test('a lockfile with a known-vulnerable package is reported', { skip: !hasBinary('osv-scanner') && 'osv-scanner not installed' }, async () => {
    const { dependencyAudit } = await import('../scripts/security/external.mjs');
    const dir = tempProject();
    dirs.push(dir);
    writeFile(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: { minimist: '0.0.8' } }, null, 2));
    writeFile(dir, 'package-lock.json', JSON.stringify({
      name: 'x',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'x', dependencies: { minimist: '0.0.8' } },
        'node_modules/minimist': { version: '0.0.8', resolved: 'https://registry.npmjs.org/minimist/-/minimist-0.0.8.tgz' },
      },
    }, null, 2));
    const result = dependencyAudit(dir, ['package-lock.json'], DEFAULT_CONFIG);
    assert.equal(result.available, true);
    if (result.error) return;
    assert.ok(result.findings.some((f) => String(f.package).startsWith('minimist')), JSON.stringify(result).slice(0, 300));
    assert.ok(result.findings.every((f) => f.id && f.summary), 'every finding names its advisory and what it is');
  });
});
