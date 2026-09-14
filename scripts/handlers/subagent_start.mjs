import { context } from '../lib/hookio.mjs';
import { readJson, truncate } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';

const CONTRACT = [
  'web-dev map contract for this project:',
  'Locations are answered from .claude/web-dev/maps/ in a fixed order: index.md, then .claude/web-dev/blueprint.md, then the layer map involved (apimap.md for endpoints and their callers, uimap.md for pages and component trees, datamap.md for tables, writers and env), then codemap-<shard>.md.',
  'Codemap symbol lines carry L<start>-<end> ranges, so source is read with Read offset/limit for just those lines.',
  'Grep and Glob come last, inside directories the maps already narrowed.',
  'Source code in this project carries no comments; the explanation of each function and connection is the note in the maps.',
];

export default async function ({ input, root }) {
  const L = layout(root);
  const health = readJson(L.healthState, null);
  const lines = [...CONTRACT];
  if (health?.counts) {
    lines.push(`Map status at last render (${health.at}): ${health.status}, ${health.owed?.length || 0} note(s) owed, ${health.counts.unmatched || 0} unmatched call(s), ${health.counts.unresolved || 0} unresolved.`);
  } else {
    lines.push('Maps have not been rendered on this machine yet.');
  }
  if (input.agent_type === 'web-dev-reviewer') {
    lines.push('Review inputs: .claude/web-dev/work/task.md, .claude/web-dev/state/review/diff.patch and .claude/web-dev/state/review/context.md. The first line of the final answer is VERDICT: PASS or VERDICT: FAIL.');
  }
  if (input.agent_type === 'web-dev-annotator') {
    lines.push('Notes are written only with node .claude/hooks/web-dev/wd.mjs note set; source files are read-only for this agent.');
  }
  return context('SubagentStart', truncate(lines.join('\n'), 3000));
}
