import path from 'node:path';

export const REL = {
  wd: '.claude/web-dev',
  state: '.claude/web-dev/state',
  maps: '.claude/web-dev/maps',
  notes: '.claude/web-dev/notes',
  work: '.claude/web-dev/work',
  shots: '.claude/web-dev/shots',
  facts: '.claude/web-dev/facts',
  hooks: '.claude/hooks/web-dev',
  task: '.claude/web-dev/work/task.md',
  postflight: '.claude/web-dev/work/postflight.md',
  next: '.claude/web-dev/work/next.md',
  questions: '.claude/web-dev/work/questions.jsonl',
  enforce: '.claude/web-dev/enforce.json',
  config: '.claude/web-dev/config.json',
  shards: '.claude/web-dev/shards.json',
};

export function layout(root) {
  const claude = path.join(root, '.claude');
  const wd = path.join(claude, 'web-dev');
  const state = path.join(wd, 'state');
  const work = path.join(wd, 'work');
  return {
    root,
    claude,
    wd,
    state,
    work,
    maps: path.join(wd, 'maps'),
    notes: path.join(wd, 'notes'),
    shots: path.join(wd, 'shots'),
    facts: path.join(wd, 'facts'),
    hooks: path.join(claude, 'hooks', 'web-dev'),
    agents: path.join(claude, 'agents'),
    rules: path.join(claude, 'rules'),
    settings: path.join(claude, 'settings.json'),
    config: path.join(wd, 'config.json'),
    shards: path.join(wd, 'shards.json'),
    enforce: path.join(wd, 'enforce.json'),
    blueprint: path.join(wd, 'blueprint.md'),
    product: path.join(wd, 'product.md'),
    stack: path.join(wd, 'stack.md'),
    decisions: path.join(wd, 'decisions.md'),
    memory: path.join(wd, 'CLAUDE.md'),
    task: path.join(work, 'task.md'),
    postflight: path.join(work, 'postflight.md'),
    prBody: path.join(work, 'pr-body.md'),
    next: path.join(work, 'next.md'),
    locate: path.join(work, 'locate.md'),
    deferred: path.join(work, 'deferred.md'),
    questionsLog: path.join(work, 'questions.jsonl'),
    taskState: path.join(state, 'task.json'),
    turnState: path.join(state, 'turn.json'),
    stopState: path.join(state, 'stop.json'),
    dirtyState: path.join(state, 'dirty.json'),
    verifyState: path.join(state, 'verify.json'),
    responsiveState: path.join(state, 'responsive.json'),
    reviewState: path.join(state, 'review.json'),
    reviewDir: path.join(state, 'review'),
    healthState: path.join(state, 'health.json'),
    extractCache: path.join(state, 'extract-cache.json'),
    mapsSig: path.join(state, 'maps-sig.json'),
    selfLedger: path.join(state, '.self.json'),
    approvalMirror: path.join(state, 'approval-mirror.json'),
  };
}
