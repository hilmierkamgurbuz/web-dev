import { existsSync } from 'node:fs';
import path from 'node:path';

const HANDLERS = {
  'session-start': '../scripts/handlers/session_start.mjs',
  'prompt-submit': '../scripts/handlers/prompt_submit.mjs',
  'cwd-changed': '../scripts/handlers/cwd_changed.mjs',
  'pre-tool': '../scripts/handlers/pre_tool.mjs',
  'post-tool': '../scripts/handlers/post_tool.mjs',
  'post-batch': '../scripts/handlers/post_batch.mjs',
  'tool-failed': '../scripts/handlers/tool_failed.mjs',
  'file-changed': '../scripts/handlers/file_changed.mjs',
  'permission-request': '../scripts/handlers/permission_request.mjs',
  'subagent-start': '../scripts/handlers/subagent_start.mjs',
  'subagent-stop': '../scripts/handlers/subagent_stop.mjs',
  stop: '../scripts/handlers/stop.mjs',
  'pre-compact': '../scripts/handlers/pre_compact.mjs',
  'config-change': '../scripts/handlers/config_change.mjs',
  'session-end': '../scripts/handlers/session_end.mjs',
};

const ALWAYS = new Set(['session-start', 'prompt-submit', 'cwd-changed', 'pre-tool', 'pre-compact']);

async function unarmedPreToolIsRelevant(input) {
  const { SOURCE_EXT, WRITE_TOOLS } = await import('../scripts/lib/writes.mjs');
  if (!WRITE_TOOLS.has(input.tool_name)) return false;
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  return typeof target === 'string' && SOURCE_EXT.test(target);
}

const DENY_EVENT = {
  'pre-tool': 'PreToolUse',
};

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(raw));
  });
}

const event = process.argv[2];
const raw = await readStdin();

let input = {};
try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const armed = existsSync(path.join(root, '.claude', 'web-dev'));

if (!HANDLERS[event] || (!armed && !ALWAYS.has(event))) process.exit(0);
if (!armed && event === 'pre-tool' && !(await unarmedPreToolIsRelevant(input))) process.exit(0);

try {
  const handler = await import(HANDLERS[event]);
  const output = await handler.default({ input, root, armed, event });
  if (typeof output === 'string') process.stdout.write(`${output}\n`);
  else if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  const detail = String(error?.stack || error).split('\n').slice(0, 3).join(' | ');
  const denyEvent = DENY_EVENT[event];
  if (denyEvent && armed) {
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: denyEvent,
        permissionDecision: 'deny',
        permissionDecisionReason: `web-dev gate failed, so the call was blocked rather than let through unchecked: ${detail}. Tell the user; a broken gate is fixed, never bypassed.`,
      },
    })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ systemMessage: `web-dev ${event} hook error: ${detail}` })}\n`);
  }
}

process.exit(0);
