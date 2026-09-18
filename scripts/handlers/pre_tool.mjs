import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageNameOf, parseBrief } from '../lib/brief.mjs';
import { loadConfig } from '../lib/config.mjs';
import { detect } from '../lib/detect.mjs';
import { alreadyTold, rememberTold } from '../lib/pdata.mjs';
import { currentBranch, git, isRepo } from '../lib/git.mjs';
import { ask, deny, WD } from '../lib/hookio.mjs';
import { exists, isInside, readJson, readText, relPath } from '../lib/io.mjs';
import { layout, REL } from '../lib/paths.mjs';
import { projectTags } from '../lib/project.mjs';
import { extractHeredocs, findHeredocOps, splitCommands, stripEnvPrefix, tokenize } from '../lib/shell.mjs';
import { matchAny, matchGlob } from '../lib/shards.mjs';
import { POWERSHELL_WRITE, SOURCE_EXT, WRITE_TOOLS } from '../lib/writes.mjs';
import { approval, enforced, readTask, writeTask } from '../lib/state.mjs';
import { detectStack } from '../lib/stack.mjs';
import { isCodeFile, loadTs } from '../lib/ts.mjs';
import { gitleaksStaged } from '../security/external.mjs';
import { formatFindings, isClientPath, scanContent } from '../security/scan.mjs';
import { secretFindings } from '../security/secrets.mjs';

const ENFORCEMENT_FILES = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks/web-dev/**',
  REL.enforce,
  REL.config,
  REL.shards,
  '.claude/agents/Explore.md',
  '.claude/agents/web-dev-reviewer.md',
  '.claude/agents/web-dev-annotator.md',
];
const HARNESS_DOCS = ['CLAUDE.md', '.claude/web-dev/*.md', '.claude/web-dev/facts/**', '.claude/web-dev/work/**', '.claude/rules/web-dev-*.md'];

const HARNESS_ONLY = /^(\.claude\/|CLAUDE\.md$|\.gitignore$)/;
const PROTECTED_PATH = /\.claude\/(web-dev\/(state|notes|maps)\/|web-dev\/(enforce|config|shards)\.json|settings(\.local)?\.json|hooks\/web-dev\/|agents\/(Explore|web-dev-reviewer|web-dev-annotator)\.md)/;
const WRITE_CALL = /writeFileSync|appendFileSync|writeFile\(|appendFile\(|createWriteStream|open\([^)]*['"][wa]|write_text|File\.write|fs\.write|os\.write|Files\.write|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item|Rename-Item|\[IO\.File\]::|\[System\.IO\.File\]::/i;
const WRITE_LITERAL = /(?:writeFileSync|appendFileSync|createWriteStream)\(\s*(['"`])([^'"`]+)\1|\bopen\(\s*(['"`])([^'"`]+)\3\s*,\s*(['"`])[wa]/g;
const STDIN_INTERPRETERS = new Set(['node', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'sh', 'bash', 'zsh', 'osascript']);
const INLINE_FLAGS = new Set(['-e', '-c', '--eval', '-p', '--print']);
const NESTED_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function applyEdit(current, edit) {
  if (current == null) return edit.old_string ? null : edit.new_string ?? null;
  if (!edit.old_string) return null;
  if (!current.includes(edit.old_string)) return null;
  return edit.replace_all
    ? current.split(edit.old_string).join(edit.new_string ?? '')
    : current.replace(edit.old_string, () => edit.new_string ?? '');
}

function computeNewText(input, abs) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (tool === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  if (tool === 'Edit') return applyEdit(readText(abs), ti);
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(ti.edits) ? ti.edits : [];
    if (!edits.length) return null;
    let text = readText(abs);
    for (const edit of edits) {
      text = applyEdit(text, edit);
      if (text == null) return null;
    }
    return text;
  }
  return null;
}

function gateSource(root, rel, config) {
  if (!isRepo(root)) return { error: 'web-dev needs a git repository: run git init (procedures/bootstrap.md step 6)' };
  const branch = currentBranch(root);
  if (!branch) return { error: 'HEAD is detached: switch to the branch named in the brief' };
  if (branch === config.defaultBranch) return { error: `source files are never written on ${branch}. Create the brief's branch first: git switch -c <branch from the brief>` };
  const status = approval(root);
  if (!status.ok) return { error: `${status.reason}. Source writes need an approved brief (gates/brief.md).` };
  if (status.brief.branch && branch !== status.brief.branch) return { error: `the approved brief names branch ${status.brief.branch}, but HEAD is ${branch}: git switch ${status.brief.branch}` };
  return { brief: status.brief, branch };
}

function preWrite(input, root) {
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!target) return null;
  const abs = path.resolve(root, target);
  if (!isInside(root, abs)) return deny(`${abs} resolves outside the project root ${root}; edit files inside the project instead.`);
  const rel = relPath(root, abs);
  if (ENFORCEMENT_FILES.some((glob) => matchGlob(rel, glob))) return deny(`${rel} belongs to the web-dev enforcement layer. Only the user changes it (by re-running init_project); report what you wanted to change instead.`);
  if (rel.startsWith(`${REL.state}/`)) return deny('files under .claude/web-dev/state/ are written only by the hooks and the wd commands. If a state file looks wrong, do not edit it: say so and let the next turn audit re-derive it.');
  if (rel.startsWith(`${REL.notes}/`)) return deny(`notes are written with ${WD} note set (JSON lines on stdin), which stamps the symbol hashes; the notes file never needs to be opened.`);
  if (rel.startsWith(`${REL.maps}/`)) return deny(`maps are generated. Change notes with ${WD} note set, or re-render with ${WD} maps.`);
  const config = loadConfig(root);
  const newText = computeNewText(input, abs);
  const oldText = readText(abs);

  if (HARNESS_DOCS.some((glob) => matchGlob(rel, glob))) {
    if (newText == null) return null;
    const findings = secretFindings(newText, { oldText });
    return findings.length ? deny(`web-dev blocked this write:\n${formatFindings(findings)}\nFix the code the finding names. If it is genuinely a false positive, it is accepted only through a "Security exceptions:" line in the brief, which needs approval again.`) : null;
  }

  const gate = gateSource(root, rel, config);
  if (gate.error) return deny(gate.error);
  const { brief } = gate;
  const generated = matchAny(rel, brief.generated) || matchAny(rel, config.generated);
  if (!brief.manifest.includes(rel) && !generated) {
    return deny(`${rel} is not in the approved brief's ## Manifest. If the task needs this file, that is a scope change: add it to the brief (which voids the approval) and ask the user again.`);
  }
  if (newText == null) return null;
  const ts = loadTs();
  if (!ts && isCodeFile(rel)) return deny(`the web-dev parser is not installed on this machine: run ${WD} setup, then retry.`);
  const tags = projectTags(root, config);
  const { findings, notices } = scanContent({ ts, root, rel, newText, oldText, config, brief, tags, generated, clientFile: isClientPath(rel, newText, tags) });
  if (findings.length) {
    return deny(`web-dev blocked this write to ${rel} (${findings.length} finding(s)):\n${formatFindings(findings)}\nFix the code. A finding that is truly acceptable needs a "Security exceptions: <rule-id> | ${rel} | <reason>" line in the brief and a new approval from the user.${notices.length ? `\n(${notices.join('; ')})` : ''}`);
  }
  return null;
}

function redirectTargets(segment) {
  const targets = [];
  for (const m of segment.matchAll(/(^|[^0-9&>])>>?\s*("?)([^\s"'|;&<>]+)\2/g)) {
    if (!/^(\/dev\/(null|stdout|stderr)|&\d)$/.test(m[3])) targets.push(m[3]);
  }
  return targets;
}

function programWrites(text) {
  if (!text) return null;
  if (WRITE_CALL.test(text)) return 'a filesystem write call';
  const targets = redirectTargets(text);
  if (targets.length) return `a shell redirect into ${targets[0]}`;
  if (/\btee\b/.test(text)) return 'a tee into a file';
  return null;
}

function writtenPaths(text) {
  const paths = [...redirectTargets(text)];
  let m;
  WRITE_LITERAL.lastIndex = 0;
  while ((m = WRITE_LITERAL.exec(text))) paths.push(m[2] || m[4]);
  return paths;
}

function interpreterProgramArg(tokens) {
  let hasInlineFlag = false;
  let inlineIndex = -1;
  let hasPositional = false;
  let hasHeredocOp = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '<<' || t === '<<-') {
      hasHeredocOp = true;
      i++;
      continue;
    }
    if (/^<<-?[A-Za-z_]/.test(t)) {
      hasHeredocOp = true;
      continue;
    }
    if (INLINE_FLAGS.has(t) || /^(--eval|--print)=/.test(t)) {
      hasInlineFlag = true;
      if (inlineIndex === -1) inlineIndex = i;
      continue;
    }
    if (t.startsWith('-')) continue;
    hasPositional = true;
  }
  return { hasInlineFlag, inlineIndex, hasPositional, hasHeredocOp };
}

function stdinInterpreterRule(root, tokens, rawSeg, segHeredocs, config) {
  const cmd = tokens[0];
  if (!STDIN_INTERPRETERS.has(cmd)) return null;
  const { hasInlineFlag, hasHeredocOp, hasPositional } = interpreterProgramArg(tokens);
  if (!hasInlineFlag && !(hasHeredocOp && !hasPositional)) return null;
  const programText = [hasInlineFlag ? rawSeg : '', ...segHeredocs.map((h) => h.body)].join('\n');
  const reason = programWrites(programText);
  if (!reason) return null;
  const status = approval(root);
  const paths = writtenPaths(programText).map((p) => relPath(root, p));
  const protectedTarget = paths.find((p) => PROTECTED_PATH.test(p) || HARNESS_ONLY.test(p));
  if (protectedTarget) {
    return deny(`${cmd} would write ${protectedTarget}, which the hooks own. No brief can grant that: use wd commands for notes, maps and config, and let the user change the enforcement files.`);
  }
  const covered = status.ok && paths.length > 0 && paths.every((p) => status.brief.manifest.includes(p) || matchAny(p, status.brief.generated) || matchAny(p, config.generated));
  if (covered) return null;
  const source = hasInlineFlag ? 'an inline flag' : 'a heredoc';
  return deny(`${cmd} reads its program from ${source} containing ${reason}, which the write gate cannot see. Make this change with Edit or Write instead of ${cmd}.`);
}

function writesSource(tokens, segment) {
  const cmd = tokens[0] || '';
  if (redirectTargets(segment).some((t) => SOURCE_EXT.test(t))) return 'shell redirection into a source file';
  if (cmd === 'tee' && tokens.slice(1).some((t) => !t.startsWith('-') && SOURCE_EXT.test(t))) return 'tee into a source file';
  if ((cmd === 'sed' || cmd === 'gsed') && tokens.some((t) => /^-i/.test(t) || t === '--in-place') && tokens.some((t) => SOURCE_EXT.test(t))) return 'sed -i on a source file';
  if (cmd === 'perl' && tokens.some((t) => /^-[a-z]*i/.test(t)) && tokens.some((t) => SOURCE_EXT.test(t))) return 'perl -i on a source file';
  if (['cp', 'install', 'rsync', 'ln', 'ditto'].includes(cmd)) {
    const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
    if (args.length && SOURCE_EXT.test(args[args.length - 1])) return `${cmd} onto a source file`;
  }
  if (cmd === 'dd' && tokens.some((t) => /^of=/.test(t) && SOURCE_EXT.test(t.slice(3)))) return 'dd onto a source file';
  if (cmd === 'truncate' && tokens.some((t) => SOURCE_EXT.test(t))) return 'truncate on a source file';
  if (['node', 'bun', 'deno', 'python', 'python3', 'ruby'].includes(cmd) && tokens.some((t) => ['-e', '-c', '--eval', 'eval', '-p'].includes(t))) {
    if (/writeFile|appendFile|createWriteStream|open\([^)]*['"][wa]|write_text|File\.write/.test(segment) && SOURCE_EXT.test(segment.replace(/wd\.mjs/g, ''))) return 'inline script writing a source file';
  }
  return null;
}

function gitEffectiveDir(cwd, tokens) {
  let dir = cwd;
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C') {
      dir = path.resolve(dir, tokens[i + 1] || '.');
      i += 2;
    } else if (tokens[i] === '-c') {
      i += 2;
    } else {
      i += 1;
    }
  }
  return { dir, i };
}

function outsideRoot(root, dir) {
  const rel = path.relative(root, dir);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

function gitRule(root, tokens, config, cwd) {
  const { dir, i } = gitEffectiveDir(cwd, tokens);
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  if (sub === 'worktree') {
    if (args[0] === 'add') return deny('git worktree add creates a second working tree that the security gate never inspects; do the work on a branch in this repository instead.');
    return null;
  }
  if (outsideRoot(root, dir)) return deny(`git resolves to ${dir}, outside the project root ${root}; run git without -C/cd pointing outside the project.`);
  const branch = currentBranch(dir);
  const defaultBranch = config.defaultBranch;
  if (sub === 'commit') {
    if (args.includes('--no-verify') || args.includes('-n')) return deny('git commit --no-verify skips the project\'s hooks and is blocked.');
    const staged = (git(dir, ['diff', '--cached', '--name-only', '-z']) || '').split('\0').filter(Boolean);
    const willStageAll = args.some((a) => a === '-a' || a === '--all' || /^-[a-zA-Z]*a/.test(a));
    const candidates = willStageAll ? [...staged, ...(git(dir, ['diff', '--name-only', '-z']) || '').split('\0').filter(Boolean)] : staged;
    if (branch === defaultBranch && candidates.some((f) => !HARNESS_ONLY.test(f))) {
      return deny(`committing application changes on ${defaultBranch} is blocked: switch to the task branch named in the brief.`);
    }
    const envFile = candidates.find((f) => /(^|\/)\.env(\.[^/]*)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
    if (envFile) return deny(`${envFile} is staged. Environment files never enter git: git restore --staged ${envFile} and make sure it is gitignored.`);
    const patch = git(dir, ['diff', '--cached', '-U0']) || '';
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
    const findings = secretFindings(added, {});
    const external = gitleaksStaged(dir, config);
    const all = [...findings, ...external.findings];
    if (all.length) return deny(`the staged changes contain credentials:\n${all.slice(0, 8).map((f) => `- ${f.file ? `${f.file} ` : ''}${f.message}`).join('\n')}\nRemove them from the code, unstage, and move the values to server-only environment variables.`);
    return null;
  }
  if (sub === 'push') {
    const force = args.some((a) => a === '--force' || a === '-f' || /^\+/.test(a));
    const lease = args.some((a) => a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes'));
    const positional = args.filter((a) => !a.startsWith('-'));
    const refspec = positional[1] || '';
    const targetBranch = (refspec.split(':').pop() || branch || '').replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if ((force || lease) && targetBranch === defaultBranch) return deny(`force-pushing ${defaultBranch} is blocked: rewriting the default branch destroys work the team already has. Push the task branch and open a PR instead.`);
    if (force && !lease) return deny('use git push --force-with-lease instead of --force, so remote work is never overwritten silently.');
    if (args.includes('--delete') || args.includes('-d') || /^:/.test(refspec)) return ask('this deletes a remote branch; the user decides.');
    return null;
  }
  if (sub === 'add') {
    const envFile = args.find((a) => /(^|\/)\.env(\.[^/]*)?$/.test(a) && !/\.(example|sample|template)$/.test(a));
    if (envFile) return deny(`${envFile} must not be added to git: add it to .gitignore, and record the variable names it holds in .claude/web-dev/stack.md so the value stays out of the repository.`);
    if (args.includes('-f') || args.includes('--force')) return deny('git add --force would stage ignored files (build output, env files, harness state); stage explicit paths instead.');
    return null;
  }
  if ((sub === 'reset' && args.includes('--hard')) || (sub === 'clean' && args.some((a) => /^-[a-zA-Z]*f/.test(a))) || ((sub === 'checkout' || sub === 'restore') && args.some((a) => a === '.' || a === '--' && args[args.indexOf(a) + 1] === '.')) || (sub === 'stash' && ['drop', 'clear'].includes(args[0])) || (sub === 'branch' && args.includes('-D'))) {
    return ask(`git ${sub} ${args.join(' ')} discards work that cannot be recovered; the user decides.`);
  }
  return null;
}

function installedPackages(root) {
  const stack = detectStack(root);
  return new Set(stack.deps.keys());
}

function binExists(root, name) {
  return exists(path.join(root, 'node_modules', '.bin', name)) || exists(path.join(root, 'node_modules', '.bin', `${name}.cmd`));
}

function dependencyRule(root, tokens) {
  const [cmd, verb, ...rest] = tokens;
  const managers = new Set(['npm', 'pnpm', 'yarn', 'bun']);
  let packages = [];
  let runner = false;
  if (managers.has(cmd) && ['install', 'i', 'add', 'isntall'].includes(verb)) {
    packages = rest.filter((t) => !t.startsWith('-'));
    if (rest.includes('-g') || rest.includes('--global')) return ask(`global install of ${packages.join(', ')}; the user decides.`);
  } else if (cmd === 'npx' || cmd === 'bunx' || (managers.has(cmd) && ['dlx', 'exec', 'x'].includes(verb))) {
    const args = cmd === 'npx' || cmd === 'bunx' ? [verb, ...rest] : rest;
    const pkg = args.find((t) => t && !t.startsWith('-'));
    const pkgFlag = args.find((t) => t.startsWith('--package='))?.split('=')[1];
    packages = [pkgFlag || pkg].filter(Boolean);
    runner = true;
  } else {
    return null;
  }
  if (!packages.length) return null;
  const installed = installedPackages(root);
  const status = approval(root);
  const declared = new Set(status.ok ? status.brief.dependencies.map(packageNameOf) : []);
  const blocked = packages.filter((spec) => {
    const name = packageNameOf(spec);
    if (declared.has(name)) return false;
    if (installed.has(name)) return false;
    if (runner && binExists(root, name.split('/').pop())) return false;
    return true;
  });
  if (!blocked.length) return null;
  return deny(`${blocked.join(', ')} ${blocked.length > 1 ? 'are' : 'is'} not a declared dependency. A new package is a technology decision: present it with procedures/tech-choice.md, add it to "Dependencies:" in the brief, and get approval again.`);
}

function gateCommandText(root, commandText, startCwd, depth) {
  const { shell, heredocs } = extractHeredocs(String(commandText || ''));
  if (!shell.trim()) return null;
  const config = loadConfig(root);
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  let heredocIndex = 0;
  let cwd = startCwd;
  for (const segment of splitCommands(shell)) {
    const raw = segment.replace(/^\|\s*/, '');
    const segHeredocs = heredocs.slice(heredocIndex, heredocIndex + findHeredocOps(raw).length);
    heredocIndex += segHeredocs.length;
    const tokens = stripEnvPrefix(tokenize(raw));
    if (!tokens.length) continue;
    if (tokens[0] === 'cd') {
      cwd = path.resolve(cwd, (tokens[1] || '').replace(/^["']|["']$/g, '') || '.');
      continue;
    }
    const isWd = tokens[0] === 'node' && /(^|\/)\.claude\/web-dev\/wd\.mjs$/.test((tokens[1] || '').replace(/^["']|["']$/g, '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, ''));
    if (isWd) continue;
    if (/\b(curl|wget)\b/.test(segment) && /\|\s*(sudo\s+)?(sh|bash|zsh|node|python3?)\b/.test(shell)) return deny('piping a downloaded script into an interpreter is blocked. Download it, show it to the user, and run it only with their approval.');
    const bodies = segHeredocs.map((h) => h.body);
    const touchesProtected = PROTECTED_PATH.test(raw) || bodies.some((b) => PROTECTED_PATH.test(b)) || (pluginData && bodies.some((b) => b.includes(pluginData)));
    const shellVerb = /\b(rm|mv|cp|tee|sed|awk|perl|truncate|dd|chmod|ln|touch|unlink|python3?|node|deno|bun|ruby|php|osascript|git\s+(checkout|restore|rm))\b/.test(raw);
    const heredocVerb = bodies.some((b) => programWrites(b));
    if (touchesProtected && (redirectTargets(raw).length || shellVerb || heredocVerb)) {
      return deny('web-dev state, notes, maps, settings and hooks are not changed from the shell (including from a heredoc). Use wd commands for notes and maps; enforcement files are changed only by the user.');
    }
    const shellWrite = writesSource(tokens, raw);
    if (shellWrite) return deny(`${shellWrite} is blocked: write source files with Edit or Write so the manifest and security gate can check them.`);
    const stdinResult = stdinInterpreterRule(root, tokens, raw, segHeredocs, config);
    if (stdinResult) return stdinResult;
    if (tokens[0] === 'rm' || tokens[0] === 'unlink' || (tokens[0] === 'git' && ['rm', 'mv'].includes(tokens[1])) || tokens[0] === 'mv') {
      const paths = tokens.slice(tokens[0] === 'git' ? 2 : 1).filter((t) => !t.startsWith('-')).map((t) => relPath(root, t));
      const sourcePaths = paths.filter((p) => SOURCE_EXT.test(p) && isInside(root, path.resolve(root, p)));
      if (sourcePaths.length) {
        const gate = gateSource(root, sourcePaths[0], config);
        if (gate.error) return deny(gate.error);
        const outside = sourcePaths.filter((p) => !gate.brief.manifest.includes(p));
        if (outside.length) return deny(`${outside.join(', ')} ${outside.length > 1 ? 'are' : 'is'} not in the approved manifest; deleting or moving a file is part of the task's scope.`);
      }
    }
    if (tokens[0] === 'git') {
      const result = gitRule(root, tokens, config, cwd);
      if (result) return result;
    }
    if (tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') return ask('merging the PR is the user\'s decision.');
    if (tokens[0] === 'gh' && tokens[1] === 'repo' && tokens[2] === 'delete') return deny('deleting a repository is blocked.');
    const dep = dependencyRule(root, tokens);
    if (dep) return dep;
    const nested = inlinePayload(tokens);
    if (nested !== null) {
      if (depth >= 3) return deny('a shell nested inside a shell more than three levels deep is blocked: the gate cannot read what it would finally run. Run the command directly.');
      const result = gateCommandText(root, nested, cwd, depth + 1);
      if (result) return result;
    }
  }
  return null;
}

function inlinePayload(tokens) {
  if (!NESTED_SHELLS.has(path.basename(tokens[0] || ''))) return null;
  for (let i = 1; i < tokens.length; i++) {
    if (!INLINE_FLAGS.has(tokens[i])) continue;
    const payload = tokens[i + 1];
    if (payload === undefined) return null;
    return payload.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return null;
}

function preBash(input, root) {
  return gateCommandText(root, input.tool_input?.command, root, 0);
}

function prePowerShell(input, root) {
  const command = String(input.tool_input?.command || '');
  if (!command.trim()) return null;
  if (POWERSHELL_WRITE.test(command)) {
    return deny('PowerShell writes are blocked here. The write gate parses POSIX shell, so it cannot tell what a PowerShell cmdlet would change, and a gate that cannot see is a gate that must refuse: make file changes with Edit or Write, and use PowerShell only to read or to run the commands in config.json.');
  }
  return gateCommandText(root, command, root, 0);
}

function preAsk(input) {
  const answers = input.tool_input?.answers;
  if (answers && typeof answers === 'object' && Object.keys(answers).length) {
    return deny('AskUserQuestion answers come from the user. Remove the "answers" field and ask again.');
  }
  return null;
}

const WEB_TARGET = SOURCE_EXT;

function unarmedGate(input, root) {
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!target) return null;
  const rel = relPath(root, path.resolve(root, target));
  if (!WEB_TARGET.test(rel)) return null;
  const { kind, frameworks } = detect(root);
  if (kind !== 'web' && kind !== 'empty') return null;
  if (alreadyTold(root, 'adopt', input.session_id)) return null;
  rememberTold(root, 'adopt', input.session_id);
  return ask(`web-dev is installed but this project has no harness state yet, and ${rel} is web source. Adopting it is what gives the maps, the manifest gate and the task cycle something to work from: follow procedures/${kind === 'empty' ? 'bootstrap' : 'adopt'}.md and run the installer yourself with \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs" . --setup\`${kind === 'empty' ? '' : ` (${frameworks.join(' + ') || 'JavaScript/TypeScript'} detected)`}. Approve this write only to make it deliberately ungated.`);
}

function clearGate(input, root) {
  const task = readTask(root);
  if (task.state !== 'closed' || !task.closedSession || task.closedSession !== input.session_id) return null;
  if (task.clearAsked) return null;
  writeTask(root, { clearAsked: true });
  return ask(`"${task.title || 'the previous task'}" closed in this session${task.pr ? ` (${task.pr})` : ''}, and this is the first write of the next one. The harness works one task per context: run /clear first, and the next session reloads every piece of state from disk. Approve this write only to keep going in the same context deliberately.`);
}

export default async function ({ input, root, armed }) {
  if (!armed) return WRITE_TOOLS.has(input.tool_name) ? unarmedGate(input, root) : null;
  if (!enforced(root)) return null;
  const tool = input.tool_name;
  if (WRITE_TOOLS.has(tool)) return clearGate(input, root) || preWrite(input, root);
  if (tool === 'PowerShell') return prePowerShell(input, root);
  if (tool === 'Bash') return preBash(input, root);
  if (tool === 'AskUserQuestion') return preAsk(input);
  return null;
}

export { preBash, prePowerShell, preWrite, computeNewText, writesSource, redirectTargets };
