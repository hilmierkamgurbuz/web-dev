import { loadConfig } from '../lib/config.mjs';
import { context } from '../lib/hookio.mjs';
import { enforced, readTask, recordApproval, startTurn, writeTask } from '../lib/state.mjs';

export default async function ({ input, root }) {
  if (!enforced(root)) return null;
  startTurn(root, input.prompt_id);
  const config = loadConfig(root);
  const prompt = String(input.prompt || '');
  const lines = [];

  if (prompt.split(/\r?\n/).some((line) => config.approval.tokens.includes(line.trim()))) {
    const result = recordApproval(root, { via: 'token', sessionId: input.session_id });
    lines.push(result.ok
      ? `web-dev: the user approved brief ${result.hash.slice(0, 8)} with an approval token · branch ${result.brief.branch}.`
      : `web-dev: the user sent an approval token, but approval was not recorded: ${result.reason}.`);
  }

  if (input.permission_mode === 'plan') {
    lines.push('web-dev: plan mode is active. This project plans through the approved brief (gates/brief.md); plan mode blocks the brief and the gates. Ask the user to leave plan mode with Shift+Tab, then continue with locate and intake.');
  }

  const task = readTask(root);
  if (task.state === 'closed' && !task.reminded && task.closedSession && task.closedSession === input.session_id) {
    writeTask(root, { reminded: true });
    lines.push(`web-dev: the previous task "${task.title || ''}" closed in this session${task.pr ? ` (PR ${task.pr})` : ''}. Its context is still loaded. Recommend /clear to the user before this new request; all task state is on disk. Continue here only if the user prefers.`);
  }
  return lines.length ? context('UserPromptSubmit', lines.join('\n')) : null;
}
