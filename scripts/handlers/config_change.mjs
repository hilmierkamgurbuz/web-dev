import path from 'node:path';

const GUARDED = /(^|\/)\.claude\/(settings\.json|settings\.local\.json)$|(^|\/)\.claude\/web-dev\/(enforce|config)\.json$/;

export default async function ({ input, root }) {
  const file = String(input.file_path || '');
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!GUARDED.test(rel)) return null;

  const [state, { exists }, { layout }] = await Promise.all([
    import('../lib/state.mjs'),
    import('../lib/io.mjs'),
    import('../lib/paths.mjs'),
  ]);
  const L = layout(root);
  if (!exists(L.task)) return null;
  const status = state.approval(root);
  if (status.ok && status.brief.manifest.includes(rel)) return null;

  process.stderr.write(`web-dev: ${rel} changed while a task is open, and the approved brief does not list it. That file decides what the gate enforces, so the change is not applied to this session. Close or revise the task first.\n`);
  process.exit(2);
}
