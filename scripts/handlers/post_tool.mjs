import path from 'node:path';
import { owedFor, renderMaps } from '../build_maps.mjs';
import { checkDocs } from '../check_docs.mjs';
import { snapshotBaseline } from '../lib/checks.mjs';
import { loadConfig } from '../lib/config.mjs';
import { context, WD } from '../lib/hookio.mjs';
import { isInside, relPath } from '../lib/io.mjs';
import { lockfiles } from '../lib/lockfile.mjs';
import { REL } from '../lib/paths.mjs';
import { isAnalyzable } from '../lib/project.mjs';
import { detectStack } from '../lib/stack.mjs';
import { addTurnWrite, briefHash, enforced, readTask, recordApproval, writeTask } from '../lib/state.mjs';
import { dependencyAudit } from '../security/external.mjs';

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
    if (!task.approvedHash) return context('PostToolUse', `web-dev: brief saved (hash ${hash.slice(0, 8)}). Approval is recorded only by the user's answer; ask once intake has no [OPEN] left.`);
    return null;
  }
  if (rel === REL.postflight) {
    writeTask(root, { state: 'closing' });
    return context('PostToolUse', 'web-dev: postflight recorded, task state is closing. End the turn: the Stop hook re-verifies every item and returns the first missing one.');
  }
  if (rel.startsWith('.claude/')) return null;

  addTurnWrite(root, rel);
  if (task.state === 'approved') {
    writeTask(root, { state: 'building' });
    try {
      snapshotBaseline(root);
    } catch {}
  }
  const config = loadConfig(root);
  if (!isAnalyzable(rel, config)) return null;
  const result = owedFor(root, [rel]);
  if (!result.ok || !result.owed.length) return null;
  const lines = result.owed.map((o) => `- ${o.key} (${o.marker}${o.header ? ': role, sys, crit' : ''})`);
  return context('PostToolUse', `web-dev notes owed for ${rel}; write them this turn with ${WD} note set:\n${lines.join('\n')}`);
}

function postBash(input, root) {
  const command = String(input.tool_input?.command || '');
  const response = JSON.stringify(input.tool_response ?? '');
  const notes = [];
  if (/\bgit\s+(pull|merge|rebase|checkout|switch|stash|reset|cherry-pick|revert|am)\b/.test(command)) {
    try {
      const health = renderMaps(root);
      if (health.status !== 'OK') notes.push(`web-dev maps re-rendered after git: ${health.status}, ${health.owed?.length || 0} note(s) owed, ${health.counts?.unmatched || 0} unmatched call(s).`);
    } catch {}
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|up|upgrade)\b/.test(command)) {
    const config = loadConfig(root);
    const docFindings = checkDocs(root).filter((f) => f.code.startsWith('DOCS-STACK') || f.code.startsWith('DOCS-FACT'));
    for (const f of docFindings.slice(0, 6)) notes.push(`${f.level} ${f.message}`);
    const stack = detectStack(root);
    const audit = dependencyAudit(root, lockfiles(root, stack.workspaces), config);
    if (audit.available && audit.findings.length) {
      notes.push(`osv-scanner: ${audit.findings.length} known vulnerabilit${audit.findings.length > 1 ? 'ies' : 'y'}: ${audit.findings.slice(0, 5).map((f) => `${f.package} ${f.id}`).join(', ')}`);
    }
  }
  if (/\bgh\s+pr\s+(create|edit)\b/.test(command)) {
    const url = (/https:\/\/[^\s"\\]+\/pull\/\d+/.exec(response) || [])[0];
    if (url) writeTask(root, { pr: url });
  }
  return notes.length ? context('PostToolUse', notes.join('\n')) : null;
}

function postAsk(input, root) {
  const response = input.tool_response;
  let answers = response && typeof response === 'object' ? response.answers : null;
  if (!answers) {
    const text = typeof response === 'string' ? response : JSON.stringify(response ?? '');
    answers = {};
    for (const m of text.matchAll(/"([^"]*\[web-dev brief [0-9a-f]{8}\][^"]*)"\s*=\s*"([^"]*)"/g)) answers[m[1]] = m[2];
  }
  const config = loadConfig(root);
  for (const [question, answer] of Object.entries(answers || {})) {
    const match = /\[web-dev brief ([0-9a-f]{8})\]/.exec(question);
    if (!match) continue;
    const label = String(answer).trim();
    const approved = config.approval.labels.some((l) => label.toLowerCase().startsWith(l.toLowerCase()));
    if (!approved) return context('PostToolUse', `web-dev: brief ${match[1]} was not approved (answer: "${label}"). Apply the user's changes, then ask again with the new hash.`);
    const result = recordApproval(root, { hash8: match[1], via: 'question', sessionId: input.session_id });
    if (!result.ok) return context('PostToolUse', `web-dev: approval NOT recorded: ${result.reason}.`);
    return context('PostToolUse', `web-dev: brief ${match[1]} approved by the user · ${result.brief.manifest.length} manifest path(s) · branch ${result.brief.branch}. Switch to that branch before the first source write.`);
  }
  return null;
}

export default async function ({ input, root }) {
  if (!enforced(root)) return null;
  switch (input.tool_name) {
    case 'Edit':
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
