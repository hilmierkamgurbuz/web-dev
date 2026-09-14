import { renderMaps } from '../build_maps.mjs';
import { loadConfig } from '../lib/config.mjs';
import { currentBranch, isRepo, upstreamStatus } from '../lib/git.mjs';
import { context } from '../lib/hookio.mjs';
import { exists, truncate } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';
import { workingChanges } from '../lib/review.mjs';
import { approval, enforced, readTask } from '../lib/state.mjs';
import { loadTs, PARSER_VERSION } from '../lib/ts.mjs';
import { toolStatus } from '../security/external.mjs';

export default async function ({ input, root }) {
  const L = layout(root);
  const source = input.source || 'startup';
  const config = loadConfig(root);
  const ts = loadTs();
  const lines = [];
  lines.push(`[web-dev] enforcement: ${enforced(root) ? 'on' : 'OFF — .claude/web-dev/enforce.json is missing, so no gate runs'} · parser: ${ts ? `typescript ${PARSER_VERSION}` : 'missing (wd setup)'} · session: ${source}`);

  if (isRepo(root)) {
    const up = upstreamStatus(root);
    const changes = workingChanges(root).length;
    lines.push(`git: branch ${currentBranch(root) || 'detached'} · default ${config.defaultBranch} · ${changes} uncommitted path(s)${up.upstream ? ` · ${up.ahead} ahead / ${up.behind} behind ${up.upstream}` : ' · no upstream'}`);
  } else {
    lines.push('git: not a repository');
  }

  const task = readTask(root);
  if (exists(L.task)) {
    const status = approval(root);
    const brief = status.brief;
    lines.push(`task: ${task.state === 'none' || !status.ok ? 'briefing' : task.state} · "${brief?.title || '?'}" · brief ${status.hash?.slice(0, 8) || '?'} ${status.ok ? 'approved' : 'not approved'} · manifest ${brief?.manifest.length || 0} path(s) · branch ${brief?.branch || '?'}${exists(L.postflight) ? ' · postflight written' : ''}`);
  } else if (task.state === 'closed') {
    lines.push(`task: none active · last closed "${task.title || ''}"${task.pr ? ` · ${task.pr}` : ''}`);
  } else {
    lines.push('task: none active');
  }

  if (ts) {
    try {
      const health = renderMaps(root);
      const c = health.counts || {};
      lines.push(`maps: ${health.status} · ${c.files ?? 0} files · ${c.symbols ?? 0} symbols · notes owed ${health.owed?.length ?? 0} · orphans ${c.orphan ?? 0} · routes ${c.routes ?? 0} (unmatched ${c.unmatched ?? 0}, unresolved ${c.unresolved ?? 0}, unauthenticated ${c.unauthenticated ?? 0}, unvalidated ${c.unvalidated ?? 0}) · tables ${c.tables ?? 0} · env errors ${c.envErrors ?? 0}`);
      if (health.owed?.length) lines.push(`notes owed, first 6: ${health.owed.slice(0, 6).join(', ')}`);
    } catch (error) {
      lines.push(`maps: render failed (${String(error.message).slice(0, 160)})`);
    }
  } else {
    lines.push('maps: not rendered because the parser is missing');
  }

  const tools = toolStatus(config);
  lines.push(`security tools: built-in scanner on · gitleaks ${tools.gitleaks ? 'on' : 'absent'} · deep scan ${tools.deepScan || 'absent'} · osv-scanner ${tools.osv ? 'on' : 'absent'}`);
  if (source === 'clear') lines.push('context: cleared; the brief, notes, maps and decisions on disk are the complete record');
  if (source === 'compact') lines.push('context: compacted; the active brief at .claude/web-dev/work/task.md is the authoritative plan');
  if (input.permission_mode === 'plan') lines.push('permission mode: plan — web-dev plans through the brief, so plan mode is left before intake');
  return context('SessionStart', truncate(lines.join('\n'), 2000));
}
