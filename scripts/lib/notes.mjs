import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText } from './io.mjs';
import { layout } from './paths.mjs';

const CRIT = new Set(['K1', 'K2', 'K3']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

export function wordCount(text) {
  return text === '-' ? 0 : text.split(/\s+/).filter(Boolean).length;
}

export function parseNotesText(text) {
  const files = new Map();
  const symbols = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(' | ');
    const key = parts[0];
    if (key.includes('#')) {
      const entry = { note: parts[1] ?? '-', h: '', movedFrom: '' };
      for (const part of parts.slice(2)) {
        if (part.startsWith('h:')) entry.h = part.slice(2);
        else if (part.startsWith('moved-from: ')) entry.movedFrom = part.slice(12);
      }
      symbols.set(key, entry);
    } else {
      const entry = { role: '', sys: '', crit: '' };
      for (const part of parts.slice(1)) {
        const m = /^(role|sys|crit):\s*(.*)$/.exec(part);
        if (m) entry[m[1]] = m[2];
      }
      files.set(key, entry);
    }
  }
  return { files, symbols };
}

export function loadNotes(root) {
  const dir = layout(root).notes;
  const files = new Map();
  const symbols = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {}
  for (const name of names) {
    const parsed = parseNotesText(readText(path.join(dir, name)) || '');
    for (const [k, v] of parsed.files) files.set(k, v);
    for (const [k, v] of parsed.symbols) symbols.set(k, v);
  }
  return { files, symbols };
}

export function formatNotes(shard, files, symbols) {
  const lines = [];
  const keys = [...new Set([...files.keys(), ...symbols.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    if (files.has(key)) {
      const f = files.get(key);
      lines.push(`${key} | role: ${f.role || '-'} | sys: ${f.sys || '-'} | crit: ${f.crit || '-'}`);
    }
    if (symbols.has(key)) {
      const s = symbols.get(key);
      lines.push(`${key} | ${s.note || '-'} | h:${s.h || ''}${s.movedFrom ? ` | moved-from: ${s.movedFrom}` : ''}`);
    }
  }
  return `# notes: ${shard}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

export function saveNotes(root, notes, shardOfPath) {
  const byShard = new Map();
  const bucket = (shard) => {
    if (!byShard.has(shard)) byShard.set(shard, { files: new Map(), symbols: new Map() });
    return byShard.get(shard);
  };
  for (const [key, value] of notes.files) bucket(shardOfPath(key)).files.set(key, value);
  for (const [key, value] of notes.symbols) bucket(shardOfPath(key.split('#')[0])).symbols.set(key, value);
  const dir = layout(root).notes;
  let existing = [];
  try {
    existing = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {}
  for (const name of existing) {
    const shard = name.slice(0, -3);
    if (!byShard.has(shard)) fs.rmSync(path.join(dir, name), { force: true });
  }
  for (const [shard, group] of byShard) {
    const file = path.join(dir, `${shard}.md`);
    const next = formatNotes(shard, group.files, group.symbols);
    if (readText(file) !== next) writeText(file, next);
  }
}

export function applyEntries(notes, entries, { symbolHash, fileExists, validSys }) {
  const results = { written: 0, deleted: 0, warnings: [], errors: [] };
  for (const entry of entries) {
    const key = clean(entry?.key);
    if (!key) {
      results.errors.push('entry without "key"');
      continue;
    }
    if (key.includes('#')) {
      if (entry.delete) {
        if (notes.symbols.delete(key)) results.deleted++;
        continue;
      }
      const hash = symbolHash(key);
      if (hash == null) {
        results.errors.push(`${key}: no such symbol in the current code (check the map key)`);
        continue;
      }
      const note = clean(entry.note) || '-';
      const words = wordCount(note);
      if (words > 30) {
        results.errors.push(`${key}: ${words} words; distill to 20 or fewer`);
        continue;
      }
      if (words > 20) results.warnings.push(`${key}: ${words} words; target is 20 or fewer`);
      notes.symbols.set(key, { note, h: hash, movedFrom: '' });
      results.written++;
    } else {
      if (entry.delete) {
        if (notes.files.delete(key)) results.deleted++;
        continue;
      }
      if (!fileExists(key)) {
        results.errors.push(`${key}: no such file`);
        continue;
      }
      const current = notes.files.get(key) || { role: '', sys: '', crit: '' };
      const next = { ...current };
      if (entry.role !== undefined) next.role = clean(entry.role);
      if (entry.sys !== undefined) next.sys = clean(entry.sys);
      if (entry.crit !== undefined) next.crit = clean(entry.crit).toUpperCase();
      if (next.crit && !CRIT.has(next.crit)) {
        results.errors.push(`${key}: crit must be K1, K2 or K3`);
        continue;
      }
      if (next.sys && validSys && !validSys(next.sys)) {
        results.errors.push(`${key}: sys "${next.sys}" is not a feature in blueprint.md`);
        continue;
      }
      notes.files.set(key, next);
      results.written++;
    }
  }
  return results;
}
