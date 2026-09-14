import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { renderMaps } from '../scripts/build_maps.mjs';
import { loadTs } from '../scripts/lib/ts.mjs';
import { git, initHarness, readFile, tempProject, wd, writeFile } from './helpers.mjs';

const ts = loadTs();
const FILE = 'src/lib/price.ts';

function owedKeys(dir) {
  return renderMaps(dir, { force: true }).owed;
}

describe('notes lifecycle', { skip: !ts && 'parser not installed (wd setup)' }, () => {
  let dir;

  before(() => {
    dir = tempProject();
    writeFile(dir, FILE, 'export function total(items: { price: number; qty: number }[]): number {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty;\n  return sum;\n}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'price');
    initHarness(dir);
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('an exported symbol without a note is MISSING', () => {
    const owed = owedKeys(dir);
    assert.ok(owed.includes(`${FILE}#total (MISSING)`), owed.join('\n'));
    assert.ok(owed.includes(`${FILE} (MISSING header)`), owed.join('\n'));
  });

  test('wd note set clears the markers without opening the notes file', () => {
    const result = wd(dir, ['note', 'set'], [
      JSON.stringify({ key: FILE, role: 'cart price arithmetic', sys: 'cart', crit: 'K2' }),
      JSON.stringify({ key: `${FILE}#total`, note: 'sums price times quantity; empty list gives 0' }),
    ].join('\n'));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(owedKeys(dir), []);
    assert.match(readFile(dir, '.claude/web-dev/maps/codemap-shared.md'), /total\(items: \{ price: number; qty: number \}\[\]\): number \| L1-5 \| sums price times quantity/);
  });

  test('formatting and comments never make a note STALE', () => {
    writeFile(dir, FILE, 'export function total(items: { price: number; qty: number }[]): number {\n\n    let sum = 0;\n    for (const item of items)   sum += item.price * item.qty;\n    return sum;\n}\n');
    assert.deepEqual(owedKeys(dir), []);
  });

  test('a body change makes the note STALE', () => {
    writeFile(dir, FILE, 'export function total(items: { price: number; qty: number }[]): number {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty * 1.2;\n  return sum;\n}\n');
    assert.ok(owedKeys(dir).includes(`${FILE}#total (STALE)`));
  });

  test('a rename carries the note over as MOVED', () => {
    wd(dir, ['note', 'set'], JSON.stringify({ key: `${FILE}#total`, note: 'sums price times quantity with tax; empty list gives 0' }));
    writeFile(dir, FILE, 'export function grandTotal(items: { price: number; qty: number }[]): number {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty * 1.2;\n  return sum;\n}\n');
    const owed = owedKeys(dir);
    assert.ok(owed.includes(`${FILE}#grandTotal (MOVED)`), owed.join('\n'));
    assert.match(readFile(dir, '.claude/web-dev/notes/shared.md'), /grandTotal \| sums price times quantity with tax.*moved-from/);
  });

  test('notes that are too long are rejected', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const result = wd(dir, ['note', 'set'], JSON.stringify({ key: `${FILE}#grandTotal`, note: long }));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /distill/);
  });
});
