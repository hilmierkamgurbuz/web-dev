import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { readText, writeJson } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';
import { buildDiff } from '../lib/review.mjs';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
}

function lastAssistantMessage(input) {
  const direct = String(input.last_assistant_message || '').trim();
  if (direct) return direct;
  const transcript = input.agent_transcript_path;
  if (!transcript || !fs.existsSync(transcript)) return '';
  let found = '';
  for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry = null;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const text = textOf(entry.message?.content).trim();
    if (text) found = text;
  }
  return found;
}

export default async function ({ input, root }) {
  if (input.agent_type !== 'web-dev-reviewer') return null;
  const L = layout(root);
  const text = lastAssistantMessage(input);
  const verdict = (/^\s*VERDICT:\s*(PASS|FAIL)\b/m.exec(text) || [])[1] || 'MISSING';
  const diff = buildDiff(root, loadConfig(root));
  writeJson(L.reviewState, {
    verdict,
    at: new Date().toISOString(),
    diffHash: diff.hash,
    preparedFor: readText(path.join(L.reviewDir, 'diff.hash'))?.trim() || null,
    findings: text.split('\n').filter((l) => /^\s*-\s*\[(BLOCKER|MAJOR|MINOR)\]/.test(l)).slice(0, 25).map((l) => l.trim()),
  });
  if (verdict === 'MISSING') {
    return {
      hookSpecificOutput: {
        hookEventName: 'SubagentStop',
        additionalContext: 'web-dev: the reviewer returned no VERDICT line, so no verdict was recorded. Run wd review-prep and the web-dev-reviewer subagent again; its first line must be "VERDICT: PASS" or "VERDICT: FAIL".',
      },
    };
  }
  return null;
}
