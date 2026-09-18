import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { preBash, prePowerShell, preWrite } from '../scripts/handlers/pre_tool.mjs';
import { extractHeredocs } from '../scripts/lib/shell.mjs';
import { decisionOf, PLUGIN as PLUGIN_ROOT, tempProject } from './helpers.mjs';

const dirs = [];

function project() {
  const dir = tempProject();
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function bash(dir, command) {
  return preBash({ tool_name: 'Bash', tool_input: { command } }, dir);
}

const STATE_WRITE = "require('fs').writeFileSync('.claude/web-dev/state/task.json', JSON.stringify({approvedHash:'forged'}))";

describe('shell.mjs: extractHeredocs', () => {
  test('separates the shell line from a quoted heredoc body', () => {
    const { shell, heredocs } = extractHeredocs(`node <<'EOF'\n${STATE_WRITE}\nEOF`);
    assert.equal(shell, "node <<'EOF'");
    assert.equal(heredocs.length, 1);
    assert.equal(heredocs[0].terminator, 'EOF');
    assert.equal(heredocs[0].quoted, true);
    assert.equal(heredocs[0].body, STATE_WRITE);
  });

  test('<<- strips leading tabs from the body and the delimiter line', () => {
    const command = `node <<-'EOF'\n\t${STATE_WRITE}\n\tEOF`;
    const { heredocs } = extractHeredocs(command);
    assert.equal(heredocs.length, 1);
    assert.equal(heredocs[0].body, STATE_WRITE);
  });

  test('several heredocs on one line are read back in the order they open', () => {
    const { heredocs, shell } = extractHeredocs('cat <<A <<B\nfirst\nA\nsecond\nB');
    assert.equal(shell, 'cat <<A <<B');
    assert.deepEqual(heredocs.map((h) => h.terminator), ['A', 'B']);
    assert.equal(heredocs[0].body, 'first');
    assert.equal(heredocs[1].body, 'second');
  });

  test('a nested heredoc keeps the inner body instead of losing it', () => {
    const command = `bash <<'OUTER'\nnode <<'INNER'\n${STATE_WRITE}\nINNER\nOUTER`;
    const { shell, heredocs } = extractHeredocs(command);
    assert.equal(shell, "bash <<'OUTER'");
    assert.equal(heredocs.length, 1);
    assert.match(heredocs[0].body, /writeFileSync/);
    assert.match(heredocs[0].body, /INNER/);
  });
});

describe('pre_tool: Bash gate bypasses (D-16a/b/c)', () => {
  test('a heredoc forging a state write is denied even though the visible token is only `node <<\'EOF\'`', () => {
    const dir = project();
    const out = bash(dir, `node <<'EOF'\n${STATE_WRITE}\nEOF`);
    assert.equal(decisionOf(out), 'deny');
  });

  test('a nested heredoc cannot smuggle a state write past the gate', () => {
    const dir = project();
    const command = `bash <<'OUTER'\nnode <<'INNER'\n${STATE_WRITE}\nINNER\nOUTER`;
    assert.equal(decisionOf(bash(dir, command)), 'deny');
  });

  test('<<- with a tab-indented delimiter is still parsed and the write is denied', () => {
    const dir = project();
    const command = `node <<-'EOF'\n\t${STATE_WRITE}\n\tEOF`;
    assert.equal(decisionOf(bash(dir, command)), 'deny');
  });

  test('a bare heredoc that writes nothing is allowed', () => {
    const dir = project();
    assert.equal(bash(dir, "node <<'EOF'\nconsole.log(1 + 1)\nEOF"), null);
  });

  test('a heredoc piped into wd.mjs stays allowed', () => {
    const dir = project();
    const command = "node .claude/web-dev/wd.mjs note set <<'EOF'\n{\"key\":\"src/a.ts#f\",\"note\":\"x\"}\nEOF";
    assert.equal(bash(dir, command), null);
  });

  test('git -C pointed outside the project root is denied', () => {
    const dir = project();
    const out = bash(dir, 'git -C ../other status');
    assert.equal(decisionOf(out), 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside the project root/);
  });

  test('a preceding cd redirects the git check to the new directory', () => {
    const dir = project();
    const out = bash(dir, 'cd /tmp && git push');
    assert.equal(decisionOf(out), 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside the project root/);
  });

  test('git worktree add is denied; list is left alone', () => {
    const dir = project();
    assert.equal(decisionOf(bash(dir, 'git worktree add ../wt feat/x')), 'deny');
    assert.equal(bash(dir, 'git worktree list'), null);
  });

  test('an Edit whose resolved path escapes the root is denied', () => {
    const dir = project();
    const out = preWrite({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '../outside.ts'), old_string: 'a', new_string: 'b' } }, dir);
    assert.equal(decisionOf(out), 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /outside the project root/);
  });
});

describe('pre_tool: a shell inside a shell', () => {
  test('bash -c hides nothing: the payload runs through the same rules', () => {
    const dir = project();
    const out = bash(dir, 'bash -c "npm install left-pad"');
    assert.equal(decisionOf(out), 'deny');
  });

  test('sh -c cannot smuggle a force push past the git rule', () => {
    const dir = project();
    const out = bash(dir, `sh -c 'git push --force origin main'`);
    assert.equal(decisionOf(out), 'deny');
  });

  test('sh -c cannot smuggle a write to harness state', () => {
    const dir = project();
    const out = bash(dir, `sh -c 'echo x > .claude/web-dev/state/task.json'`);
    assert.equal(decisionOf(out), 'deny');
  });

  test('a harmless payload inside bash -c is still allowed', () => {
    const dir = project();
    assert.equal(bash(dir, 'bash -c "echo hello"'), null);
  });

  test('shells nested past three levels are refused rather than guessed at', () => {
    const dir = project();
    const out = bash(dir, `bash -c "bash -c \\"bash -c 'bash -c ls'\\""`);
    assert.equal(decisionOf(out), 'deny');
  });
});

describe('pre_tool: the files that decide what is enforced', () => {
  test('config.json and shards.json cannot be written, brief or no brief', () => {
    const dir = project();
    for (const rel of ['.claude/web-dev/config.json', '.claude/web-dev/shards.json', '.claude/web-dev/enforce.json']) {
      const out = preWrite({ tool_name: 'Write', tool_input: { file_path: path.join(dir, rel), content: '{}' } }, dir);
      assert.equal(decisionOf(out), 'deny', rel);
    }
  });

  test('the shell cannot reach them either', () => {
    const dir = project();
    assert.equal(decisionOf(bash(dir, 'echo "{}" > .claude/web-dev/config.json')), 'deny');
    assert.equal(decisionOf(bash(dir, `sed -i '' s/a/b/ .claude/web-dev/shards.json`)), 'deny');
  });
});

describe('pre_tool: PowerShell', () => {
  const ps = (dir, command) => prePowerShell({ tool_name: 'PowerShell', tool_input: { command } }, dir);

  test('a PowerShell write is refused rather than parsed with a POSIX parser', () => {
    const dir = project();
    for (const command of [
      'Set-Content -Path src/a.ts -Value "x"',
      'Add-Content .claude/web-dev/enforce.json "{}"',
      '"x" | Out-File src/a.ts',
      '[System.IO.File]::WriteAllText("src/a.ts", "x")',
      'echo x > src/a.ts',
    ]) {
      assert.equal(decisionOf(ps(dir, command)), 'deny', command);
    }
  });

  test('a read-only PowerShell command still passes', () => {
    const dir = project();
    assert.equal(ps(dir, 'Get-ChildItem src'), null);
  });
});

describe('the dispatcher and the gate share one definition of a write', () => {
  test('there is no second hand-copied write-tool list to drift', async () => {
    const shared = await import('../scripts/lib/writes.mjs');
    const dispatcher = fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks/hook.mjs'), 'utf8');
    const gate = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts/handlers/pre_tool.mjs'), 'utf8');
    assert.ok(shared.WRITE_TOOLS.has('MultiEdit'));
    for (const source of [dispatcher, gate]) {
      assert.ok(source.includes("lib/writes.mjs"), 'both import the shared definition');
      assert.ok(!/new Set\(\['Edit'/.test(source), 'and neither redeclares it');
    }
  });
});
