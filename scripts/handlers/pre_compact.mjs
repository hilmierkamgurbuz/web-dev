import { detect } from '../lib/detect.mjs';
import { exists, readText, truncate } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';
import { approval, readTask } from '../lib/state.mjs';

export default async function ({ root, armed }) {
  const L = layout(root);
  if (!armed || !exists(L.task)) {
    const { kind, frameworks } = detect(root);
    if (kind === 'web') return `web-dev: this is a ${frameworks.join(' + ') || 'JavaScript/TypeScript'} project the harness has not adopted yet. Keep that in the summary: procedures/adopt.md runs before any source file is written here.`;
    if (kind === 'empty') return 'web-dev: this directory is empty. Keep that in the summary: a request for a site or app starts at procedures/bootstrap.md, with intake before any scaffolding.';
    return null;
  }
  const status = approval(root);
  const task = readTask(root);
  if (!status.brief) return null;

  const locate = readText(L.locate);
  return [
    'web-dev is mid-task. Preserve these verbatim in the summary; everything else about this task is on disk and will be reloaded.',
    `- Brief: ${L.task} · hash ${status.hash?.slice(0, 8)} · ${status.ok ? 'APPROVED' : `NOT APPROVED (${status.reason})`} · state ${task.state || 'none'}`,
    `- Goal: ${status.brief.goal || status.brief.title}`,
    `- Branch: ${status.brief.branch}`,
    `- Manifest (the only writable paths): ${status.brief.manifest.join(', ')}`,
    status.brief.acceptance?.length ? `- Acceptance: ${status.brief.acceptance.map((a) => `[ ] ${a}`).join(' ; ')}` : '',
    locate ? `- Locate result:\n${truncate(locate, 900)}` : '',
    '- After compaction: do not re-plan and do not re-ask approval. Re-read the brief, then continue the build.',
  ].filter(Boolean).join('\n');
}
