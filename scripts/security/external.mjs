import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines } from './secrets.mjs';

const binaries = new Map();

export function hasBinary(name) {
  if (binaries.has(name)) return binaries.get(name);
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
  const ok = probe.status === 0;
  binaries.set(name, ok);
  return ok;
}

function enabled(config, key) {
  return (config?.security?.[key] ?? 'auto') !== 'off';
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || 'null');
  } catch {
    return null;
  }
}

export function toolStatus(config) {
  return {
    gitleaks: enabled(config, 'gitleaks') && hasBinary('gitleaks'),
    deepScan: enabled(config, 'opengrep') ? (hasBinary('opengrep') ? 'opengrep' : hasBinary('semgrep') ? 'semgrep' : null) : null,
    osv: enabled(config, 'osvScanner') && hasBinary('osv-scanner'),
  };
}

function runGitleaks(args, reportPath) {
  const attempt = spawnSync('gitleaks', [...args, '--no-banner', '--report-format', 'json', '--report-path', reportPath, '--exit-code', '0'], { stdio: 'ignore', timeout: 20000 });
  return attempt.status === 0 && fs.existsSync(reportPath);
}

export function gitleaksFindings(root, rel, newText, oldText, config) {
  if (!enabled(config, 'gitleaks') || !hasBinary('gitleaks')) return { findings: [] };
  const dir = tempDir('wd-gl-src-');
  const out = tempDir('wd-gl-out-');
  try {
    fs.writeFileSync(path.join(dir, path.basename(rel)), newText);
    const report = path.join(out, 'report.json');
    const ok = runGitleaks(['dir', dir], report) || runGitleaks(['detect', '--no-git', '--source', dir], report);
    if (!ok) return { findings: [], notice: 'gitleaks could not scan the file' };
    const added = new Set(addedLines(newText, oldText).map((l) => l.line));
    const data = readJsonFile(report) || [];
    return {
      findings: data
        .filter((d) => added.has(d.StartLine))
        .map((d) => ({ rule: 'WD-SEC-SECRET', line: d.StartLine, message: `hardcoded credential (gitleaks ${d.RuleID})`, fix: 'read it from a server-only environment variable; rotate it if it was ever committed' })),
    };
  } catch (error) {
    return { findings: [], notice: `gitleaks failed: ${error.message}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
}

export function gitleaksStaged(root, config) {
  if (!enabled(config, 'gitleaks') || !hasBinary('gitleaks')) return { available: false, findings: [] };
  const out = tempDir('wd-gl-staged-');
  try {
    const report = path.join(out, 'report.json');
    const run = (args) => spawnSync('gitleaks', [...args, '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '0'], { cwd: root, stdio: 'ignore', timeout: 30000 });
    let result = run(['git', '--pre-commit', '--staged', '.']);
    if (result.status !== 0 || !fs.existsSync(report)) result = run(['protect', '--staged', '--source', '.']);
    const data = readJsonFile(report) || [];
    return { available: true, findings: data.map((d) => ({ rule: 'WD-SEC-SECRET', file: d.File, line: d.StartLine, message: `staged credential (gitleaks ${d.RuleID})` })) };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

export function deepScan(root, rels, config) {
  const tool = enabled(config, 'opengrep') ? (hasBinary('opengrep') ? 'opengrep' : hasBinary('semgrep') ? 'semgrep' : null) : null;
  if (!tool) return { available: false, findings: [] };
  const targets = rels.filter((rel) => /\.(m|c)?(j|t)sx?$/.test(rel) && fs.existsSync(path.join(root, rel)));
  if (!targets.length) return { available: true, tool, findings: [] };
  const rules = path.join(path.dirname(fileURLToPath(import.meta.url)), 'opengrep');
  const args = ['scan', '--config', rules, '--json', '--quiet'];
  if (tool === 'semgrep') args.push('--metrics=off', '--disable-version-check');
  const result = spawnSync(tool, [...args, ...targets], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  let data = null;
  try {
    data = JSON.parse(result.stdout || 'null');
  } catch {}
  if (!data) return { available: true, tool, findings: [], error: (result.stderr || 'no output').slice(0, 300) };
  return {
    available: true,
    tool,
    findings: (data.results || []).map((r) => ({
      rule: `WD-DEEP:${String(r.check_id).split('.').pop()}`,
      file: r.path,
      line: r.start?.line || 0,
      message: String(r.extra?.message || '').split('\n')[0],
      severity: r.extra?.severity || 'ERROR',
    })),
  };
}

export function dependencyAudit(root, lockfiles, config) {
  if (!enabled(config, 'osvScanner') || !hasBinary('osv-scanner') || !lockfiles.length) return { available: false, findings: [] };
  const lockArgs = lockfiles.flatMap((l) => ['-L', l]);
  let result = spawnSync('osv-scanner', ['scan', 'source', '--format', 'json', ...lockArgs], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (!result.stdout?.trim().startsWith('{')) {
    result = spawnSync('osv-scanner', ['--format', 'json', ...lockfiles.flatMap((l) => [`--lockfile=${l}`])], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  }
  let data = null;
  try {
    data = JSON.parse(result.stdout || 'null');
  } catch {}
  if (!data) return { available: true, findings: [], error: 'osv-scanner produced no JSON (offline?)' };
  const findings = [];
  for (const source of data.results || []) {
    for (const pkg of source.packages || []) {
      for (const vuln of pkg.vulnerabilities || []) {
        findings.push({ rule: 'WD-DEP-VULN', package: `${pkg.package?.name}@${pkg.package?.version}`, id: vuln.id, summary: String(vuln.summary || '').slice(0, 120) });
      }
    }
  }
  return { available: true, findings };
}
