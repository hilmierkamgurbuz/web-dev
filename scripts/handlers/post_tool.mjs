import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { context, WD } from '../lib/hookio.mjs';
import { isInside, relPath } from '../lib/io.mjs';
import { REL } from '../lib/paths.mjs';
import { addTurnWrite, briefHash, markDirty, readTask, recordApproval, recordQuestion, writeTask } from '../lib/state.mjs';
import { snapshotBaseline } from '../lib/checks.mjs';

function postWrite(input, root) {
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!target) return null;
  const abs = path.resolve(root, target);
  if (!isInside(root, abs)) return null;
  const rel = relPath(root, abs);
  const task = readTask(root);

  if (rel === REL.task) {
    const hash = briefHash(root);
    if (task.approvedHash && task.approvedHash !== hash) {
      return context('PostToolUse', `web-dev: the brief changed after approval (approved ${task.approvedHash.slice(0, 8)}, now ${hash.slice(0, 8)}). Source writes stay blocked until the user approves this version: run ${WD} task hash and ask.`);
    }
    if (!task.approvedHash) return context('PostToolUse', `web-dev: brief saved (hash ${hash.slice(0, 8)}). Only the user's answer records approval; ask once intake leaves no [OPEN].`);
    return null;
  }
  if (rel === REL.postflight) {
    writeTask(root, { state: 'closing' });
    return context('PostToolUse', 'web-dev: postflight recorded. End the turn; the Stop hook re-verifies every closing check and names the first one still missing.');
  }
  if (rel.startsWith('.claude/')) return null;

  addTurnWrite(root, rel, { via: 'tool', event: 'change' });
  markDirty(root, rel);
  if (task.state === 'approved') {
    writeTask(root, { state: 'building' });
    try { snapshotBaseline(root); } catch {}
  }
  return null;
}

function postBash(input, root) {
  const command = String(input.tool_input?.command || '');
  const response = JSON.stringify(input.tool_response ?? '');
  if (/\bgh\s+pr\s+(create|edit)\b/.test(command)) {
    const url = (/https:\/\/[^\s"\\]+\/pull\/\d+/.exec(response) || [])[0];
    if (url) writeTask(root, { pr: url });
  }
  if (/\bgit\s+push\b/.test(command)) writeTask(root, { closeRequested: 'git push' });
  if (/\bgh\s+pr\s+create\b/.test(command)) writeTask(root, { closeRequested: 'gh pr create' });
  if (/\bgit\s+(pull|merge|rebase|checkout|switch|stash|reset|cherry-pick|revert|am)\b/.test(command)) markDirty(root, '*');
  if (/\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|up|upgrade)\b/.test(command)) markDirty(root, 'deps');
  return null;
}

function answersOf(response) {
  if (response && typeof response === 'object' && response.answers) return response.answers;
  const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
  const out = {};
  for (const m of text.matchAll(/"([^"]+)"\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function postAsk(input, root) {
  const answers = answersOf(input.tool_response);
  const config = loadConfig(root);
  const questions = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : [];

  for (const [question, answer] of Object.entries(answers)) {
    const asked = questions.find((q) => q.question === question);
    recordQuestion(root, {
      at: new Date().toISOString(),
      question,
      header: asked?.header || null,
      options: (asked?.options || []).map((o) => o.label),
      chosen: String(answer),
    });
  }

  for (const [question, answer] of Object.entries(answers)) {
    const match = /\[web-dev brief ([0-9a-f]{8})\]/.exec(question);
    if (!match) continue;
    const label = String(answer).trim();
    const approved = config.approval.labels.some((l) => label.toLowerCase().startsWith(l.toLowerCase()));
    if (!approved) return context('PostToolUse', `web-dev: brief ${match[1]} was not approved (answer: "${label}"). Apply the change the user asked for, then ask again with the new hash.`);
    const result = recordApproval(root, { hash8: match[1], via: 'question', sessionId: input.session_id });
    if (!result.ok) return context('PostToolUse', `web-dev: approval NOT recorded: ${result.reason}.`);
    return context('PostToolUse', `web-dev: brief ${match[1]} approved · ${result.brief.manifest.length} manifest path(s) · branch ${result.brief.branch}. Switch to that branch before the first source write.`);
  }
  return null;
}

export default async function ({ input, root }) {
  switch (input.tool_name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return postWrite(input, root);
    case 'Bash':
    case 'PowerShell':
      return postBash(input, root);
    case 'AskUserQuestion':
      return postAsk(input, root);
    default:
      return null;
  }
}
