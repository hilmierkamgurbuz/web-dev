import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { readText, writeJson } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';
import { buildDiff } from '../lib/review.mjs';
import { enforced } from '../lib/state.mjs';

export default async function ({ input, root }) {
  if (!enforced(root) || input.agent_type !== 'web-dev-reviewer') return null;
  const L = layout(root);
  const text = String(input.last_assistant_message || '');
  const verdict = (/^\s*VERDICT:\s*(PASS|FAIL)\b/m.exec(text) || [])[1] || 'MISSING';
  const diff = buildDiff(root, loadConfig(root));
  writeJson(L.reviewState, {
    verdict,
    at: new Date().toISOString(),
    diffHash: diff.hash,
    preparedFor: readText(path.join(L.reviewDir, 'diff.hash'))?.trim() || null,
    findings: text.split('\n').filter((l) => /^\s*-\s*\[(BLOCKER|MAJOR|MINOR)\]/.test(l)).slice(0, 25).map((l) => l.trim()),
  });
  return null;
}
