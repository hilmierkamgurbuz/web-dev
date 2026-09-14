import path from 'node:path';
import { deny } from './lib/hookio.mjs';
import { emit, exists, readStdinJson } from './lib/io.mjs';

const HANDLERS = {
  'session-start': './handlers/session_start.mjs',
  'prompt-submit': './handlers/prompt_submit.mjs',
  'pre-tool': './handlers/pre_tool.mjs',
  'post-tool': './handlers/post_tool.mjs',
  'subagent-start': './handlers/subagent_start.mjs',
  'subagent-stop': './handlers/subagent_stop.mjs',
  stop: './handlers/stop.mjs',
};
const GATED_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell']);

const event = process.argv[2];
const input = await readStdinJson();
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

if (HANDLERS[event] && exists(path.join(root, '.claude', 'web-dev'))) {
  try {
    const handler = await import(HANDLERS[event]);
    const output = await handler.default({ input, root });
    if (output) emit(output);
  } catch (error) {
    const message = String(error?.stack || error).split('\n').slice(0, 3).join(' | ');
    if (event === 'pre-tool' && GATED_TOOLS.has(input.tool_name) && exists(path.join(root, '.claude', 'web-dev', 'enforce.json'))) {
      emit(deny(`web-dev gate error, so the action was blocked to stay safe: ${message}. Tell the user; a broken gate must be fixed, not bypassed.`));
    } else {
      emit({ systemMessage: `web-dev ${event} hook error: ${message}` });
    }
  }
}
process.exit(0);
