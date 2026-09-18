import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'PermissionRequest',
  'PermissionDenied', 'Notification', 'UserPromptSubmit', 'UserPromptExpansion', 'SessionStart',
  'SessionEnd', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
  'PreModelSwitch', 'PostModelSwitch', 'Setup', 'TeammateIdle', 'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult', 'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged', 'DirectoryAdded', 'MessageDisplay',
]);

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);

const EXPANDABLE = /\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_DATA)\}/g;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function hookEntries(spec) {
  const out = [];
  for (const [event, groups] of Object.entries(spec.hooks || {})) {
    for (const group of groups) for (const hook of group.hooks || []) out.push({ event, group, hook });
  }
  return out;
}

test('wiring: every hook declared by the plugin names a real event', () => {
  const spec = readJson('hooks/hooks.json');
  for (const event of Object.keys(spec.hooks || {})) {
    assert.ok(HOOK_EVENTS.has(event), `hooks.json declares "${event}", which is not a Claude Code hook event`);
  }
});

test('wiring: every hook script the plugin declares exists on disk', () => {
  const spec = readJson('hooks/hooks.json');
  const seen = [];
  for (const { event, hook } of hookEntries(spec)) {
    assert.equal(hook.type, 'command', `${event} hook is type "${hook.type}"; only command hooks are shipped`);
    assert.ok(Array.isArray(hook.args) && hook.args.length, `${event} hook must use exec form (command + args)`);
    const script = hook.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT);
    assert.ok(fs.existsSync(script), `${event} hook points at ${hook.args[0]}, which does not exist`);
    seen.push(script);
  }
  assert.ok(seen.length >= 10, 'the plugin should wire the full ring-0 and ring-1 hook set');
});

test('wiring: every ${...} placeholder is one Claude Code actually expands', () => {
  const files = ['hooks/hooks.json', 'templates/settings.json'];
  for (const rel of files) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const match of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) {
      assert.ok(
        ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_DATA'].includes(match[1]),
        `${rel} uses \${${match[1]}}, which Claude Code does not expand`,
      );
    }
    EXPANDABLE.lastIndex = 0;
  }
});

test('wiring: no instruction file names an environment variable that does not exist', () => {
  const docs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tests') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) docs.push(full);
    }
  };
  walk(ROOT);
  for (const file of docs) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/CLAUDE_SKILL_DIR/.test(text), `${path.relative(ROOT, file)} names \${CLAUDE_SKILL_DIR}, which Claude Code never sets`);
  }
});

test('wiring: the PreToolUse matcher reaches MCP tools', () => {
  const spec = readJson('hooks/hooks.json');
  const groups = (spec.hooks.PreToolUse || []).map((g) => g.matcher).filter(Boolean);
  assert.ok(groups.length, 'PreToolUse must declare a matcher');
  for (const matcher of groups) {
    assert.ok(/[^A-Za-z0-9_\-,| ]/.test(matcher), `matcher "${matcher}" contains only name-set characters, so Claude Code treats it as an exact-name set and no mcp__ tool ever matches`);
    assert.ok(new RegExp(matcher).test('mcp__filesystem__write_file'), `matcher "${matcher}" does not match an MCP tool name`);
    assert.ok(new RegExp(matcher).test('Write'), `matcher "${matcher}" does not match Write`);
    assert.ok(new RegExp(matcher).test('Bash'), `matcher "${matcher}" does not match Bash`);
  }
});

test('wiring: the "if" field is used only on tool events', () => {
  const spec = readJson('hooks/hooks.json');
  for (const { event, hook } of hookEntries(spec)) {
    if (hook.if !== undefined) {
      assert.ok(TOOL_EVENTS.has(event), `${event} declares an "if" filter; on a non-tool event that stops the hook from running at all`);
    }
  }
});

test('wiring: SessionEnd stays inside its shared 1.5s budget unless it raises its own timeout', () => {
  const spec = readJson('hooks/hooks.json');
  for (const { event, hook } of hookEntries(spec)) {
    if (event !== 'SessionEnd') continue;
    assert.ok(typeof hook.timeout === 'number' && hook.timeout >= 5, 'the SessionEnd hook must set an explicit timeout; the default shared budget is 1.5s');
  }
});

test('wiring: the skill frontmatter declares the fields trigger reliability depends on', () => {
  const text = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  assert.ok(front, 'SKILL.md must start with YAML frontmatter');
  const body = front[1];
  for (const field of ['name:', 'description:', 'when_to_use:', 'paths:']) {
    assert.ok(body.includes(field), `SKILL.md frontmatter is missing ${field}`);
  }
  const description = /description: >-\n([\s\S]*?)\n[a-z_]+:/.exec(body);
  assert.ok(description, 'description must be a folded block');
  const flat = description[1].replace(/\s+/g, ' ').trim();
  assert.ok(flat.length <= 1024, `description is ${flat.length} chars; the Agent Skills standard caps it at 1024`);
  for (const opener of ['landing page', 'build', 'continue']) {
    assert.ok(flat.toLowerCase().includes(opener), `description does not cover the "${opener}" opener, which the audit found it misses`);
  }
});

test('wiring: every file the router names exists', () => {
  const text = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const referenced = new Set();
  for (const match of text.matchAll(/`((?:procedures|gates|reference|examples)\/[a-z0-9-]+\.md)`/g)) referenced.add(match[1]);
  assert.ok(referenced.size >= 8, 'the router should name the procedure and gate files it routes to');
  for (const rel of referenced) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `SKILL.md routes to ${rel}, which does not exist`);
  }
});

test('wiring: instruction files stay inside their token budget', () => {
  const budget = [
    ['SKILL.md', 9600],
    ['templates/CLAUDE.md', 2000],
    ['procedures/locate.md', 3300],
    ['procedures/intake.md', 4900],
    ['procedures/security.md', 6200],
    ['gates/brief.md', 5200],
    ['gates/postflight.md', 3400],
    ['reference/maps.md', 4600],
    ['reference/cost-model.md', 1800],
    ['reference/subagents.md', 2200],
  ];
  for (const [rel, maxBytes] of budget) {
    const size = fs.statSync(path.join(ROOT, rel)).size;
    assert.ok(
      size <= maxBytes,
      `${rel} is ${size} bytes, over its ${maxBytes}-byte budget (~${Math.round(size / 4)} tokens). `
      + 'Raise a budget only when the file gained a rule that does work; otherwise cut, because every byte here is paid again on every task.',
    );
  }
});

test('wiring: the whole per-task prose floor stays under its ceiling', () => {
  const size = (rel) => fs.statSync(path.join(ROOT, rel)).size;
  const floor = {
    touch: ['SKILL.md', 'templates/CLAUDE.md', 'procedures/locate.md'],
    task: ['SKILL.md', 'templates/CLAUDE.md', 'procedures/locate.md', 'procedures/intake.md', 'gates/brief.md', 'gates/postflight.md', 'procedures/git-flow.md'],
  };
  const ceiling = { touch: 3800, task: 8000 };
  for (const [name, files] of Object.entries(floor)) {
    const tokens = Math.round(files.reduce((sum, rel) => sum + size(rel), 0) / 4);
    assert.ok(tokens <= ceiling[name], `the ${name} class loads ~${tokens} tokens of prose before any map or source, over its ${ceiling[name]}-token ceiling`);
  }
});
