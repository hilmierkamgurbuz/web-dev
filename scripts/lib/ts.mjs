import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, exists, writeJson } from './io.mjs';

export const PARSER_PACKAGE = 'typescript';
export const PARSER_VERSION = '6.0.3';

export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro']);
export const SFC_EXTENSIONS = new Set(['.vue', '.svelte', '.astro']);

export function cacheRoot() {
  if (process.env.WEB_DEV_CACHE) return process.env.WEB_DEV_CACHE;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'web-dev');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'web-dev');
}

export function parserDir() {
  return path.join(cacheRoot(), `parser-${PARSER_PACKAGE}-${PARSER_VERSION}`);
}

let loaded;

export function loadTs() {
  if (loaded !== undefined) return loaded;
  const dir = parserDir();
  if (!exists(path.join(dir, 'node_modules', PARSER_PACKAGE, 'package.json'))) {
    loaded = null;
    return loaded;
  }
  try {
    nodeModule.enableCompileCache?.(path.join(cacheRoot(), 'compile-cache'));
  } catch {}
  try {
    const ts = nodeModule.createRequire(path.join(dir, 'package.json'))(PARSER_PACKAGE);
    loaded = typeof ts.createSourceFile === 'function' ? ts : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

export function installParser({ quiet = false } = {}) {
  const dir = parserDir();
  ensureDir(dir);
  if (!exists(path.join(dir, 'package.json'))) writeJson(path.join(dir, 'package.json'), { name: 'web-dev-parser', private: true });
  const isWin = process.platform === 'win32';
  execFileSync(isWin ? 'npm.cmd' : 'npm', ['install', `${PARSER_PACKAGE}@${PARSER_VERSION}`, '--save-exact', '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: quiet ? 'ignore' : 'inherit',
    shell: isWin,
  });
  loaded = undefined;
  return loadTs();
}

export function isCodeFile(rel) {
  return CODE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

export function scriptKindFor(ts, rel, lang) {
  const ext = lang ? `.${lang}` : path.extname(rel).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

export function createSource(ts, rel, text, lang) {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKindFor(ts, rel, lang));
}
