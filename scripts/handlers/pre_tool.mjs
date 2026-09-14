import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageNameOf, parseBrief } from '../lib/brief.mjs';
import { loadConfig } from '../lib/config.mjs';
import { currentBranch, git, isRepo } from '../lib/git.mjs';
import { ask, deny, WD } from '../lib/hookio.mjs';
import { exists, isInside, readJson, readText, relPath } from '../lib/io.mjs';
import { layout, REL } from '../lib/paths.mjs';
import { projectTags } from '../lib/project.mjs';
import { splitCommands, stripEnvPrefix, stripHeredocs, tokenize } from '../lib/shell.mjs';
import { matchAny, matchGlob } from '../lib/shards.mjs';
import { approval, enforced } from '../lib/state.mjs';
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
  '.claude/agents/Explore.md',
  '.claude/agents/web-dev-reviewer.md',
  '.claude/agents/web-dev-annotator.md',
];
const HARNESS_DOCS = ['CLAUDE.md', '.claude/web-dev/*.md', '.claude/web-dev/facts/**', '.claude/web-dev/work/**', '.claude/rules/web-dev-*.md'];
const SOURCE_EXT = /\.(m|c)?[jt]sx?$|\.(vue|svelte|astro|css|scss|sass|less|html?|sql|prisma|graphql|gql)$|(^|\/)package\.json$/i;
const HARNESS_ONLY = /^(\.claude\/|CLAUDE\.md$|\.gitignore$)/;

function computeNewText(input, abs) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  if (tool === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  if (tool === 'Edit') {
    const current = readText(abs);
    if (current == null) return ti.old_string ? null : ti.new_string ?? null;
    if (!ti.old_string) return null;
    if (!current.includes(ti.old_string)) return null;
    return ti.replace_all ? current.split(ti.old_string).join(ti.new_string ?? '') : current.replace(ti.old_string, () => ti.new_string ?? '');
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
  if (!isInside(root, abs)) return null;
  const rel = relPath(root, abs);
  if (ENFORCEMENT_FILES.some((glob) => matchGlob(rel, glob))) return deny(`${rel} belongs to the web-dev enforcement layer. Only the user changes it (by re-running init_project); report what you wanted to change instead.`);
  if (rel.startsWith(`${REL.state}/`)) return deny('files under .claude/web-dev/state/ are written only by web-dev hooks and wd commands.');
  if (rel.startsWith(`${REL.notes}/`)) return deny(`notes are written with ${WD} note set (JSON lines on stdin), which stamps the symbol hashes; the notes file never needs to be opened.`);
  if (rel.startsWith(`${REL.maps}/`)) return deny(`maps are generated. Change notes with ${WD} note set, or re-render with ${WD} maps.`);
  const config = loadConfig(root);
  const newText = computeNewText(input, abs);
  const oldText = readText(abs);

  if (HARNESS_DOCS.some((glob) => matchGlob(rel, glob))) {
    if (newText == null) return null;
    const findings = secretFindings(newText, { oldText });
    return findings.length ? deny(`web-dev blocked this write:\n${formatFindings(findings)}`) : null;
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

function gitRule(root, tokens, config) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  const branch = currentBranch(root);
  const defaultBranch = config.defaultBranch;
  if (sub === 'commit') {
    if (args.includes('--no-verify') || args.includes('-n')) return deny('git commit --no-verify skips the project\'s hooks and is blocked.');
    const staged = (git(root, ['diff', '--cached', '--name-only', '-z']) || '').split('\0').filter(Boolean);
    const willStageAll = args.some((a) => a === '-a' || a === '--all' || /^-[a-zA-Z]*a/.test(a));
    const candidates = willStageAll ? [...staged, ...(git(root, ['diff', '--name-only', '-z']) || '').split('\0').filter(Boolean)] : staged;
    if (branch === defaultBranch && candidates.some((f) => !HARNESS_ONLY.test(f))) {
      return deny(`committing application changes on ${defaultBranch} is blocked: switch to the task branch named in the brief.`);
    }
    const envFile = candidates.find((f) => /(^|\/)\.env(\.[^/]*)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
    if (envFile) return deny(`${envFile} is staged. Environment files never enter git: git restore --staged ${envFile} and make sure it is gitignored.`);
    const patch = git(root, ['diff', '--cached', '-U0']) || '';
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
    const findings = secretFindings(added, {});
    const external = gitleaksStaged(root, config);
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
    if ((force || lease) && targetBranch === defaultBranch) return deny(`force-pushing ${defaultBranch} is blocked.`);
    if (force && !lease) return deny('use git push --force-with-lease instead of --force, so remote work is never overwritten silently.');
    if (args.includes('--delete') || args.includes('-d') || /^:/.test(refspec)) return ask('this deletes a remote branch; the user decides.');
    return null;
  }
  if (sub === 'add') {
    const envFile = args.find((a) => /(^|\/)\.env(\.[^/]*)?$/.test(a) && !/\.(example|sample|template)$/.test(a));
    if (envFile) return deny(`${envFile} must not be added to git.`);
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

function preBash(input, root) {
  const command = stripHeredocs(String(input.tool_input?.command || ''));
  if (!command.trim()) return null;
  const config = loadConfig(root);
  for (const segment of splitCommands(command)) {
    const raw = segment.replace(/^\|\s*/, '');
    const tokens = stripEnvPrefix(tokenize(raw));
    if (!tokens.length) continue;
    const isWd = tokens[0] === 'node' && /(^|\/)\.claude\/hooks\/web-dev\/wd\.mjs$/.test((tokens[1] || '').replace(/^["']|["']$/g, '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, ''));
    if (isWd) continue;
    if (/\b(curl|wget)\b/.test(segment) && /\|\s*(sudo\s+)?(sh|bash|zsh|node|python3?)\b/.test(command)) return deny('piping a downloaded script into an interpreter is blocked. Download it, show it to the user, and run it only with their approval.');
    const touchesProtected = /\.claude\/(web-dev\/(state|notes|maps)\/|web-dev\/enforce\.json|settings(\.local)?\.json|hooks\/web-dev\/|agents\/(Explore|web-dev-reviewer|web-dev-annotator)\.md)/.test(raw);
    if (touchesProtected && (redirectTargets(raw).length || /\b(rm|mv|cp|tee|sed|perl|truncate|dd|chmod|ln|touch|unlink|python3?|node|ruby|git\s+(checkout|restore|rm))\b/.test(raw))) {
      return deny('web-dev state, notes, maps, settings and hooks are not changed from the shell. Use wd commands for notes and maps; enforcement files are changed only by the user.');
    }
    const shellWrite = writesSource(tokens, raw);
    if (shellWrite) return deny(`${shellWrite} is blocked: write source files with Edit or Write so the manifest and security gate can check them.`);
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
      const result = gitRule(root, tokens, config);
      if (result) return result;
    }
    if (tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') return ask('merging the PR is the user\'s decision.');
    if (tokens[0] === 'gh' && tokens[1] === 'repo' && tokens[2] === 'delete') return deny('deleting a repository is blocked.');
    const dep = dependencyRule(root, tokens);
    if (dep) return dep;
  }
  return null;
}

function preAsk(input) {
  const answers = input.tool_input?.answers;
  if (answers && typeof answers === 'object' && Object.keys(answers).length) {
    return deny('AskUserQuestion answers come from the user. Remove the "answers" field and ask again.');
  }
  return null;
}

export default async function ({ input, root }) {
  if (!enforced(root)) return null;
  const tool = input.tool_name;
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return preWrite(input, root);
  if (tool === 'Bash' || tool === 'PowerShell') return preBash(input, root);
  if (tool === 'AskUserQuestion') return preAsk(input);
  return null;
}

export { preBash, preWrite, computeNewText, writesSource, redirectTargets };
