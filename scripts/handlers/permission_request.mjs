import { loadConfig } from '../lib/config.mjs';
import { extractHeredocs, splitCommands, stripEnvPrefix, tokenize } from '../lib/shell.mjs';

const WD_SHIM = /^(\S*[\\/])?wd\.mjs$/;

function isHarnessCall(tokens) {
  if (tokens[0] !== 'node') return false;
  const script = (tokens[1] || '').replace(/^["']|["']$/g, '').replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '');
  return WD_SHIM.test(script);
}

function isConfiguredCommand(segment, commands) {
  return commands.some((command) => segment === command || segment.startsWith(`${command} `));
}

export default async function ({ input, root }) {
  const command = String(input.tool_input?.command || '').trim();
  if (!command) return null;
  const { shell, heredocs } = extractHeredocs(command);
  if (heredocs.length) return null;

  const configured = Object.values(loadConfig(root).commands || {}).map((value) => String(value).trim()).filter(Boolean);
  const segments = splitCommands(shell).map((segment) => segment.replace(/^\|\s*/, '').trim()).filter(Boolean);
  if (!segments.length) return null;

  const ours = segments.every((segment) => {
    const tokens = stripEnvPrefix(tokenize(segment));
    if (!tokens.length) return false;
    return isHarnessCall(tokens) || isConfiguredCommand(segment, configured);
  });
  if (!ours) return null;

  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  };
}
