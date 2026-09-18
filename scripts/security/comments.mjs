import path from 'node:path';
import { scriptProjection, styleBlocks, templateProjection } from '../lib/sfc.mjs';
import { createSource, SFC_EXTENSIONS } from '../lib/ts.mjs';

const EMPTY_CONTAINERS = new Set(['Block', 'ObjectLiteralExpression', 'ArrayLiteralExpression', 'ModuleBlock', 'CaseBlock', 'ClassDeclaration', 'InterfaceDeclaration', 'TypeLiteral', 'EnumDeclaration', 'NamedImports', 'NamedExports']);
const SECURITY_LINT_RULES = /(no-eval|no-implied-eval|no-new-func|react\/no-danger|security\/|no-script-url|jsx-no-target-blank|no-sync-scripts|no-unsanitized|detect-)/;
const TODO_COMMENT = /^(TODO|FIXME)\b/i;

function commentBody(text) {
  return text.replace(/^\/\/+|^\/\*+|\*+\/$|^<!--|-->$/g, '').trim();
}

function lineAt(text, pos) {
  let line = 1;
  for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function jsComments(ts, rel, text) {
  const ext = path.extname(rel).toLowerCase();
  let source = text;
  let lang;
  if (SFC_EXTENSIONS.has(ext)) {
    const projection = scriptProjection(text);
    source = projection.text;
    lang = projection.lang;
  }
  const sf = createSource(ts, SFC_EXTENSIONS.has(ext) ? `${rel}.${lang}` : rel, source, lang);
  const ranges = new Map();
  const collect = (list) => {
    for (const r of list || []) if (!ranges.has(r.pos)) ranges.set(r.pos, r);
  };
  const isJsxChild = (node) => {
    const parent = node.parent;
    return !!parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) && parent.children.includes(node);
  };
  const visit = (node) => {
    if (!isJsxChild(node)) {
      collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
      const next = node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent));
      if (!next) collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    }
    if (ts.isJsxExpression(node) && !node.expression) {
      const inner = source.slice(node.getStart(sf) + 1, node.getEnd() - 1);
      const m = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/.exec(inner);
      if (m) {
        const pos = node.getStart(sf) + 1 + m.index;
        ranges.set(pos, { pos, end: pos + m[0].length, kind: ts.SyntaxKind.MultiLineCommentTrivia });
      }
    }
    if (EMPTY_CONTAINERS.has(ts.SyntaxKind[node.kind])) {
      const open = source.indexOf('{', node.getStart(sf)) >= 0 ? source.indexOf('{', node.getStart(sf)) : -1;
      const bracket = ts.isArrayLiteralExpression(node) ? node.getStart(sf) : open;
      if (bracket >= 0 && bracket < node.getEnd()) collect(ts.getLeadingCommentRanges(source, bracket + 1));
    }
    let lastChild = null;
    ts.forEachChild(node, (child) => {
      visit(child);
      lastChild = child;
    });
    if (lastChild && !isJsxChild(lastChild)) collect(ts.getLeadingCommentRanges(source, lastChild.getEnd()));
  };
  visit(sf);
  collect(ts.getLeadingCommentRanges(source, sf.endOfFileToken.getFullStart()));
  return [...ranges.values()]
    .map((r) => ({ text: source.slice(r.pos, r.end), line: lineAt(source, r.pos) }))
    .filter((c) => c.text.startsWith('//') || c.text.startsWith('/*'));
}

export function markupComments(text) {
  const out = [];
  const template = templateProjection(text);
  for (const m of template.matchAll(/<!--([\s\S]*?)-->/g)) out.push({ text: m[0], line: lineAt(template, m.index) });
  return out;
}

export function styleComments(text, ext) {
  const out = [];
  for (const m of text.matchAll(/\/\*[\s\S]*?\*\//g)) out.push({ text: m[0], line: lineAt(text, m.index) });
  if (ext === '.scss' || ext === '.sass' || ext === '.less') {
    text.split('\n').forEach((line, i) => {
      if (/url\(/.test(line)) return;
      const m = /(^|\s)(\/\/.*)$/.exec(line);
      if (m) out.push({ text: m[2], line: i + 1 });
    });
  }
  return out;
}

function sfcStyleComments(text) {
  const out = [];
  for (const block of styleBlocks(text)) {
    const body = text.slice(block.start, block.end);
    for (const m of body.matchAll(/\/\*[\s\S]*?\*\//g)) out.push({ text: m[0], line: lineAt(text, block.start + m.index) });
  }
  return out;
}

export function isAllowedComment(comment, { rel, config, isFirst }) {
  const body = commentBody(comment.text);
  const pragmas = config.comments?.allowedPragmas || [];
  if (/^eslint-disable-next-line\b/.test(body)) return !SECURITY_LINT_RULES.test(body) && body.split(/\s+/).length > 1;
  if (/^@ts-expect-error\b/.test(body)) return body.replace('@ts-expect-error', '').trim().length > 0;
  if (pragmas.some((p) => p !== 'eslint-disable-next-line' && p !== '@ts-expect-error' && body.includes(p))) return true;
  if (/\.(js|mjs|cjs|jsx)$/.test(rel) && /^\*?\s*@(type|typedef|satisfies|param|returns|template|import)\b/.test(body)) return true;
  if (/^\/\/\/\s*<reference\b/.test(comment.text)) return true;
  const license = config.comments?.licenseHeader;
  if (isFirst && license && body.includes(license.trim())) return true;
  return false;
}

export function commentsOf(ts, rel, text) {
  const ext = path.extname(rel).toLowerCase();
  if (SFC_EXTENSIONS.has(ext)) return [...jsComments(ts, rel, text), ...markupComments(text), ...sfcStyleComments(text)];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) return jsComments(ts, rel, text);
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) return styleComments(text, ext);
  if (ext === '.html' || ext === '.htm') return markupComments(text);
  return [];
}

export function addedCommentFindings(ts, rel, newText, oldText, config) {
  let current;
  let previous = [];
  try {
    current = commentsOf(ts, rel, newText);
    previous = oldText == null ? [] : commentsOf(ts, rel, oldText);
  } catch {
    return { findings: [], warnings: [] };
  }
  const pool = new Map();
  for (const c of previous) {
    const key = c.text.replace(/\s+/g, ' ').trim();
    pool.set(key, (pool.get(key) || 0) + 1);
  }
  const sorted = [...current].sort((a, b) => a.line - b.line);
  const findings = [];
  const warnings = [];
  sorted.forEach((comment, index) => {
    const key = comment.text.replace(/\s+/g, ' ').trim();
    const count = pool.get(key) || 0;
    if (count > 0) {
      pool.set(key, count - 1);
      return;
    }
    if (isAllowedComment(comment, { rel, config, isFirst: index === 0 })) return;
    const preview = key.length > 60 ? `${key.slice(0, 57)}…` : key;
    if (TODO_COMMENT.test(commentBody(comment.text))) {
      warnings.push(`L${comment.line}: TODO/FIXME comment added (${preview}) — not blocking; track it with wd note set instead`);
      return;
    }
    findings.push({ rule: 'WD-COMMENT', line: comment.line, message: `comment added: ${preview}`, fix: 'remove it; put the explanation in the symbol note with wd note set' });
  });
  return { findings, warnings };
}
