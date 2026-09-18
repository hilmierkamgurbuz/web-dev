import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { decisionsBacked, parseBrief, validateBrief } from '../scripts/lib/brief.mjs';
import { withLock } from '../scripts/lib/lock.mjs';
import { pdataDir } from '../scripts/lib/pdata.mjs';
import { PLUGIN, readFile, SAMPLE_BRIEF, tempProject, writeFile } from './helpers.mjs';
import {
  addTurnWrite,
  approval,
  briefHash,
  classifySize,
  clearDirty,
  clearStuck,
  isSelfWrite,
  markDirty,
  markStuck,
  markTamper,
  readDirty,
  readQuestions,
  readTask,
  readTurn,
  recordApproval,
  recordQuestion,
  startTurn,
  writeTask,
} from '../scripts/lib/state.mjs';

function writeBrief(dir, text) {
  writeFile(dir, '.claude/web-dev/work/task.md', text);
}

describe('lock.mjs', () => {
  test('withLock releases the lock even when fn throws', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/x.lock');
    assert.throws(() => withLock(lockPath, () => {
      throw new Error('boom');
    }));
    assert.equal(fs.existsSync(lockPath), false);
    let ran = false;
    withLock(lockPath, () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test('withLock is reentrant within the same process', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/reentrant.lock');
    const seen = withLock(lockPath, () => withLock(lockPath, () => 'inner'));
    assert.equal(seen, 'inner');
    assert.equal(fs.existsSync(lockPath), false);
  });

  test('an old lock whose holder is dead is taken over', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/dead.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483646, at: Date.now() }));
    let ran = false;
    withLock(lockPath, () => { ran = true; }, { staleMs: 50 });
    assert.equal(ran, true);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test('an old lock with no readable pid is taken over on age alone', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/pidless.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'not json');
    const old = (Date.now() - 100000) / 1000;
    fs.utimesSync(lockPath, old, old);
    let ran = false;
    withLock(lockPath, () => { ran = true; }, { staleMs: 50 });
    assert.equal(ran, true);
  });

  test('age alone never evicts a live holder — a slow map render is not an abandoned lock', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/slow.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
    const old = (Date.now() - 100000) / 1000;
    fs.utimesSync(lockPath, old, old);
    let ran = false;
    assert.throws(() => withLock(lockPath, () => { ran = true; }, { staleMs: 50, timeoutMs: 200 }));
    assert.equal(ran, false, 'the live holder kept the lock');
  });

  test('a lock is not stolen from a live holder before it is stale, and waiting gives up loudly', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/fresh.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
    let ran = false;
    assert.throws(() => withLock(lockPath, () => {
      ran = true;
    }, { staleMs: 100000, giveUpMs: 60 }));
    assert.equal(ran, false);
    assert.equal(fs.existsSync(lockPath), true);
    fs.rmSync(lockPath, { force: true });
  });

  test('a lock held by a dead pid is reclaimed immediately, even if recent', () => {
    const dir = tempProject();
    const lockPath = path.join(dir, '.claude/web-dev/state/dead.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, at: Date.now() }));
    let ran = false;
    withLock(lockPath, () => {
      ran = true;
    }, { staleMs: 30000 });
    assert.equal(ran, true);
  });
});

describe('state.mjs concurrency', () => {
  test('concurrent addTurnWrite from two processes loses no entry', async () => {
    const dir = tempProject();
    const script = path.join(dir, '_addwrite.mjs');
    fs.writeFileSync(script, [
      `import { addTurnWrite } from ${JSON.stringify(path.join(PLUGIN, 'scripts', 'lib', 'state.mjs'))};`,
      'addTurnWrite(process.argv[2], process.argv[3]);',
    ].join('\n'));
    const count = 12;
    const runs = [];
    for (let i = 0; i < count; i++) {
      runs.push(new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, dir, `file-${i}.ts`]);
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr}`))));
        child.on('error', reject);
      }));
    }
    await Promise.all(runs);
    const turn = readTurn(dir);
    assert.equal(turn.writes.length, count);
    assert.deepEqual([...new Set(turn.writes)].sort(), turn.writes.slice().sort());
    for (let i = 0; i < count; i++) assert.ok(turn.writes.includes(`file-${i}.ts`), `missing file-${i}.ts`);
  });
});

describe('turn ledger', () => {
  test('addTurnWrite keeps a flat write list and richer observed metadata', () => {
    const dir = tempProject();
    startTurn(dir, 'p1');
    addTurnWrite(dir, 'src/a.ts', { via: 'tool', event: 'change' });
    addTurnWrite(dir, 'src/b.ts', { via: 'watch', event: 'add' });
    addTurnWrite(dir, 'src/a.ts', { via: 'watch', event: 'change' });
    const turn = readTurn(dir);
    assert.deepEqual(turn.writes, ['src/a.ts', 'src/b.ts']);
    assert.equal(turn.observed.length, 3);
    assert.equal(turn.observed[1].via, 'watch');
    assert.equal(turn.observed[1].rel, 'src/b.ts');
  });
});

describe('dirty ledger', () => {
  test('markDirty/readDirty/clearDirty round trip', () => {
    const dir = tempProject();
    assert.deepEqual(readDirty(dir), { paths: [], deps: false, tree: false });
    markDirty(dir, 'src/a.ts');
    markDirty(dir, 'src/a.ts');
    markDirty(dir, 'deps');
    markDirty(dir, '*');
    const dirty = readDirty(dir);
    assert.deepEqual(dirty.paths, ['src/a.ts']);
    assert.equal(dirty.deps, true);
    assert.equal(dirty.tree, true);
    clearDirty(dir);
    assert.deepEqual(readDirty(dir), { paths: [], deps: false, tree: false });
  });
});

describe('self-write tracking', () => {
  test('isSelfWrite recognizes our own writes and flags external edits', () => {
    const dir = tempProject();
    writeTask(dir, { state: 'building' });
    assert.equal(isSelfWrite(dir, '.claude/web-dev/state/task.json'), true);
    fs.writeFileSync(path.join(dir, '.claude/web-dev/state/task.json'), '{"tampered":true}');
    assert.equal(isSelfWrite(dir, '.claude/web-dev/state/task.json'), false);
  });

  test('isSelfWrite trusts files it does not track', () => {
    const dir = tempProject();
    fs.mkdirSync(path.join(dir, '.claude/web-dev/state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/web-dev/state/verify.json'), '{}');
    assert.equal(isSelfWrite(dir, '.claude/web-dev/state/verify.json'), true);
  });

  test('markTamper records the incident in task state and counts repeats', () => {
    const dir = tempProject();
    markTamper(dir, '.claude/web-dev/state/task.json', 'change');
    assert.equal(readTask(dir).tamper.count, 1);
    markTamper(dir, '.claude/web-dev/state/task.json', 'change');
    assert.equal(readTask(dir).tamper.count, 2);
  });
});

describe('stuck state', () => {
  test('stuck state survives a round trip and clears', () => {
    const dir = tempProject();
    markStuck(dir, 'no recorded verification: run wd verify');
    let task = readTask(dir);
    assert.equal(task.stuck.count, 1);
    assert.ok(task.stuck.since);
    assert.equal(task.stuck.lastReason, 'no recorded verification: run wd verify');
    markStuck(dir, 'no recorded verification: run wd verify');
    task = readTask(dir);
    assert.equal(task.stuck.count, 2);
    assert.equal(task.stuck.since, readTask(dir).stuck.since);
    markStuck(dir, 'a completely different blocker');
    task = readTask(dir);
    assert.equal(task.stuck.count, 1);
    clearStuck(dir);
    assert.equal(readTask(dir).stuck, null);
  });
});

describe('question ledger', () => {
  test('recordQuestion appends and readQuestions reads them back; missing ledger is null', () => {
    const dir = tempProject();
    assert.equal(readQuestions(dir), null);
    recordQuestion(dir, { question: 'max length?', header: 'Length', options: ['100', '500'], chosen: '500' });
    recordQuestion(dir, { question: 'auth required?', chosen: 'yes' });
    const qs = readQuestions(dir);
    assert.equal(qs.length, 2);
    assert.equal(qs[0].question, 'max length?');
    assert.equal(qs[1].chosen, 'yes');
  });

  test('a by: user decision with no recorded question fails validation', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    const problems = validateBrief(brief, []);
    assert.ok(problems.some((p) => /no recorded question/.test(p)));
  });

  test('a by: user decision backed by a recorded question passes', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    const problems = validateBrief(brief, [{ question: 'What is the maximum length allowed?', chosen: '500 characters' }]);
    assert.equal(problems.some((p) => /no recorded question/.test(p)), false);
  });

  test('validateBrief skips the ledger check entirely when no ledger exists', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    assert.deepEqual(validateBrief(brief, null), validateBrief(brief));
    assert.equal(validateBrief(brief).length, 0);
  });

  test('decisionsBacked returns only the unbacked by: user lines', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    assert.deepEqual(decisionsBacked(brief, []), ['- Q: maximum length? → A: 500 characters · by: user']);
    assert.deepEqual(decisionsBacked(brief, [{ question: 'maximum length', chosen: '500 characters' }]), []);
    assert.equal(decisionsBacked(brief, [{ question: 'maximum length' }]).length, 1, 'a ledger entry with no recorded answer backs nothing');
  });
});

describe('approval integrity (D-16d, D-18)', () => {
  test('a bare APPROVE token is refused and names the current hash', () => {
    const dir = tempProject();
    writeBrief(dir, SAMPLE_BRIEF());
    const hash = briefHash(dir);
    const result = recordApproval(dir, { via: 'token', sessionId: 's1' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /no hash given/);
    assert.match(result.reason, new RegExp(hash.slice(0, 8)));
  });

  test('an approved brief is recorded and verified end to end', () => {
    const dir = tempProject();
    writeBrief(dir, SAMPLE_BRIEF());
    const hash = briefHash(dir);
    const result = recordApproval(dir, { hash8: hash.slice(0, 8), via: 'token', sessionId: 's1' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const status = approval(dir);
    assert.equal(status.ok, true);
    assert.equal(status.mode, 'home');
    const record = path.join(pdataDir(dir), 'approval.json');
    assert.ok(fs.existsSync(record), 'the signed record exists');
    assert.ok(!record.startsWith(dir), 'and it never lives inside the project the gate has to defend');
    const mirror = JSON.parse(readFile(dir, '.claude/web-dev/state/approval-mirror.json'));
    assert.equal(mirror.authoritative, false);
  });

  test('HMAC verification rejects a hand-edited approval record', () => {
    const dir = tempProject();
    writeBrief(dir, SAMPLE_BRIEF());
    const hash = briefHash(dir);
    recordApproval(dir, { hash8: hash.slice(0, 8), via: 'token', sessionId: 's1' });
    assert.equal(approval(dir).ok, true);

    const recordPath = path.join(pdataDir(dir), 'approval.json');
    const stored = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    stored.hash = `${'0'.repeat(64)}`;
    fs.writeFileSync(recordPath, JSON.stringify(stored));

    const status = approval(dir);
    assert.equal(status.ok, false);
    assert.equal(status.tampered, true);
  });

  test('a brief with [OPEN] cannot be approved', () => {
    const dir = tempProject();
    writeBrief(dir, SAMPLE_BRIEF({ open: true }));
    const hash = briefHash(dir);
    const result = recordApproval(dir, { hash8: hash.slice(0, 8), via: 'token', sessionId: 's1' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /\[OPEN\]/);
  });

  test('the approval record moves outside the project when CLAUDE_PLUGIN_DATA is set', () => {
    const dir = tempProject();
    const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dev-plugin-data-'));
    const prior = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    try {
      writeBrief(dir, SAMPLE_BRIEF());
      const hash = briefHash(dir);
      const result = recordApproval(dir, { hash8: hash.slice(0, 8), via: 'token', sessionId: 's1' });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.mode, 'plugin');
      assert.equal(fs.existsSync(path.join(dir, '.claude/web-dev/state/approval.json')), false);
      assert.ok(fs.existsSync(path.join(pdataDir(dir), 'approval.json')));
      const status = approval(dir);
      assert.equal(status.ok, true);
      assert.equal(status.mode, 'plugin');
      assert.ok(fs.existsSync(path.join(dir, '.claude/web-dev/state/approval-mirror.json')));
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = prior;
      fs.rmSync(pluginData, { recursive: true, force: true });
    }
  });
});

function locateBlock({ write = 'src/features/orders/note.ts', callers = '-', contracts = '-', extra = '' } = {}) {
  return [
    'Locate:',
    '- Found at step: 4',
    '- Feature: orders',
    `- Read: ${write}:1-20`,
    `- Write: ${write}`,
    `- Callers affected: ${callers}`,
    `- Contracts touched: ${contracts}`,
    '- Map repairs: -',
    `- Unresolved: ${extra || '-'}`,
  ].join('\n');
}

describe('classifySize (D-06)', () => {
  test('a single file with no signal is a touch', () => {
    const result = classifySize(locateBlock(), null);
    assert.equal(result.size, 'touch');
    assert.ok(result.reasons.length);
  });

  test('no locate text and no brief is still a touch', () => {
    assert.equal(classifySize(null, null).size, 'touch');
    assert.equal(classifySize('', null).size, 'touch');
  });

  test('more than one written file with no other signal is a task', () => {
    const result = classifySize(locateBlock({ write: 'a.ts, b.ts' }), null);
    assert.equal(result.size, 'task');
    assert.match(result.reasons.join(' '), /2 files/);
  });

  test('locate Write: count overrides the brief manifest length', () => {
    const result = classifySize(locateBlock({ write: 'a.ts' }), { manifest: ['a.ts', 'b.ts', 'c.ts'] });
    assert.equal(result.size, 'touch');
  });

  test('a single file whose callers are affected is a task', () => {
    assert.equal(classifySize(locateBlock({ callers: 'src/list.ts calls saveNote' }), null).size, 'task');
  });

  test('a route contract touched is a task', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'GET /api/orders/:id' }), null).size, 'task');
  });

  test('a table touched is a task', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'orders table gains a column' }), null).size, 'task');
  });

  test('an env var touched is a task', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'ORDERS_WEBHOOK_SECRET env var' }), null).size, 'task');
  });

  test('a new dependency forces arch even for a single touch-shaped file', () => {
    const result = classifySize(locateBlock(), { manifest: ['a.ts'], dependencies: ['left-pad'] });
    assert.equal(result.size, 'arch');
    assert.match(result.reasons.join(' '), /dependenc/);
  });

  test('a schema or migration mention forces arch', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'prisma schema migration adds a column' }), null).size, 'arch');
  });

  test('an auth mention forces arch', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'POST /api/login' }), null).size, 'arch');
  });

  test('a payment path in the written files forces arch', () => {
    assert.equal(classifySize(locateBlock({ write: 'src/features/checkout/stripe.ts' }), null).size, 'arch');
  });

  test('a destructive migration named in the brief forces arch', () => {
    assert.equal(classifySize(locateBlock(), { migrations: ['drop column orders.legacy_note'] }).size, 'arch');
  });

  test('the same words in the free-text part of locate do NOT force arch', () => {
    const prose = classifySize(locateBlock({ extra: 'the stripe checkout flow calls this; drop the legacy_orders idea' }), null);
    assert.equal(prose.size, 'touch', 'a classifier that reads its own prose escalates every task it cannot parse');
    assert.equal(classifySize(locateBlock({ write: 'src/lib/auth-helpers.test.ts' }), null).size, 'arch');
  });

  test('a destructive migration line in the brief forces arch without a locate signal', () => {
    const result = classifySize(locateBlock(), { migrations: ['drop the legacy_orders table'] });
    assert.equal(result.size, 'arch');
  });

  test('a new route in Contracts touched forces arch', () => {
    assert.equal(classifySize(locateBlock({ contracts: 'new route POST /api/exports' }), null).size, 'arch');
  });

  test('a file the whole app renders through forces arch', () => {
    assert.equal(classifySize(locateBlock({ write: 'src/middleware.ts' }), null).size, 'arch');
    assert.equal(classifySize(locateBlock({ write: 'src/app/layout.tsx' }), null).size, 'arch');
  });

  test('a change spread across three separate areas forces arch', () => {
    const write = 'src/features/orders/note.ts, src/lib/db.ts, server/api/orders.ts';
    assert.equal(classifySize(locateBlock({ write }), null).size, 'arch');
  });

  test('an explicitly declared arch signal is honoured', () => {
    const block = `${locateBlock()}\n- Arch signal: the session shape changes for every route`;
    const result = classifySize(block, null);
    assert.equal(result.size, 'arch');
    assert.match(result.reasons.join(' '), /declared in locate/);
  });

  test('wd class persists the classification in task state', () => {
    const dir = tempProject();
    writeTask(dir, { size: classifySize(locateBlock(), null).size });
    assert.equal(readTask(dir).size, 'touch');
    writeTask(dir, { size: classifySize(locateBlock({ contracts: 'POST /api/login' }), null).size });
    assert.equal(readTask(dir).size, 'arch');
  });
});

describe('a decision must match the answer the user actually chose', () => {
  test('the recorded question is not enough on its own — the answer has to line up', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    const asked = [{ question: 'maximum length?', chosen: 'no limit at all', options: ['no limit at all', 'something else'] }];
    assert.equal(decisionsBacked(brief, asked).length, 1, 'the brief claims 500 characters; the user chose no limit');
  });

  test('the same question with the same answer passes', () => {
    const brief = parseBrief(SAMPLE_BRIEF());
    const asked = [{ question: 'maximum length?', chosen: '500 characters', options: ['500 characters', 'no limit'] }];
    assert.deepEqual(decisionsBacked(brief, asked), []);
  });
});
