import { detect, sourceRoots } from '../lib/detect.mjs';
import { writeShim } from '../lib/shim.mjs';

const ROUTE = {
  empty: [
    '[web-dev] empty directory · no project yet.',
    'If the user asks for a web app, a site, a landing page, a dashboard or anything rendered in a browser, this harness owns the task: invoke the web-dev skill and follow procedures/bootstrap.md. Intake comes first; nothing is scaffolded before the questions are answered and the brief is approved.',
    'If the user wants something else, ignore this line.',
  ],
  web: [
    '[web-dev] {frameworks} project · the harness is not installed here yet.',
    'Before changing any source file, invoke the web-dev skill and follow procedures/adopt.md. You run the installer yourself — `node "${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs" . --setup` — and then build the maps; /web-dev:init is the user-typed shortcut for the same thing, not something you wait for.',
  ],
};

function unarmed(root, kind, frameworks) {
  if (kind === 'other' || kind === 'candidate') return null;
  const lines = ROUTE[kind];
  if (!lines) return null;
  const text = lines.join('\n').replace('{frameworks}', frameworks.length ? frameworks.join(' + ') : 'JavaScript/TypeScript');
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: text,
      watchPaths: sourceRoots(root),
    },
  };
}

export default async function ({ input, root, armed }) {
  const source = input.source || 'startup';
  const { kind, frameworks } = detect(root);
  if (!armed) return unarmed(root, kind, frameworks);

  const [{ loadConfig }, { currentBranch, isRepo, upstreamStatus }, { exists, readText, removeFile, truncate }, { layout }, { workingChanges }, state, { loadTs, PARSER_VERSION }, { renderMaps }] = await Promise.all([
    import('../lib/config.mjs'),
    import('../lib/git.mjs'),
    import('../lib/io.mjs'),
    import('../lib/paths.mjs'),
    import('../lib/review.mjs'),
    import('../lib/state.mjs'),
    import('../lib/ts.mjs'),
    import('../build_maps.mjs'),
  ]);

  const L = layout(root);
  const config = loadConfig(root);
  const ts = loadTs();
  const lines = [];
  const shim = writeShim(root, process.env.CLAUDE_PLUGIN_ROOT);

  const on = state.enforced(root);
  lines.push(`[web-dev] ${on ? 'armed' : 'NOT ARMED'} · parser ${ts ? PARSER_VERSION : 'MISSING — run wd setup'} · session ${source}${shim.written ? ` · wd shim refreshed (${shim.reason})` : ''}`);
  if (!on) lines.push('.claude/web-dev/enforce.json is missing, so the write gate, the security scan and the closing audit are all off while the rest of the harness still looks installed. Say this to the user and write no code until the file is back — restore it from git, or run the installer again.');

  if (isRepo(root)) {
    const up = upstreamStatus(root);
    lines.push(`git: ${currentBranch(root) || 'detached'} · default ${config.defaultBranch} · ${workingChanges(root).length} uncommitted${up.upstream ? ` · ${up.ahead}↑ ${up.behind}↓` : ' · no upstream'}`);
  } else {
    lines.push('git: not a repository — the task cycle needs one; offer git init in intake');
  }

  let health = null;
  if (ts) {
    try { health = renderMaps(root); } catch (error) { lines.push(`maps: render failed — ${error.message}`); }
  }
  if (health) {
    lines.push(`maps: ${health.status || 'rendered'}${health.owed?.length ? ` · ${health.owed.length} note(s) owed` : ''}`);
  }

  const task = state.readTask(root);
  if (task.tamper) lines.push(`TAMPER: ${task.tamper.rel} was written by something other than the hooks at ${task.tamper.at}. The approval and turn records are treated as untrusted until the next turn audit re-derives them.`);
  const status = exists(L.task) ? state.approval(root) : { ok: false };
  if (status.brief) {
    lines.push(`task: ${status.ok ? task.state || 'approved' : 'awaiting approval'} · "${status.brief.title}" · ${status.hash?.slice(0, 8)} · ${status.brief.manifest.length} path(s) · branch ${status.brief.branch}${status.mode === 'fallback' ? ' · approval stored in-project (CLAUDE_PLUGIN_DATA unset)' : ''}`);
  } else if (task.state === 'closed') {
    lines.push(`task: none open · last closed "${task.title || '?'}"${task.pr ? ` (${task.pr})` : ''}`);
  } else {
    lines.push('task: none open · next task starts at procedures/locate.md then procedures/intake.md');
  }

  if (task.stuck?.count >= 3) {
    lines.push(`STUCK: the same closing check has blocked this task ${task.stuck.count} times since ${task.stuck.since}: ${truncate(task.stuck.lastReason || '', 300)}. Resolve it with the user before doing anything else.`);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
      watchPaths: sourceRoots(root),
    },
  };
  if (status.brief?.title) output.hookSpecificOutput.sessionTitle = `web-dev: ${status.brief.title}`;

  if (source === 'clear') {
    const next = readText(L.next);
    if (next && next.trim()) {
      output.hookSpecificOutput.initialUserMessage = next.trim();
      removeFile(L.next);
    }
  }
  return output;
}
