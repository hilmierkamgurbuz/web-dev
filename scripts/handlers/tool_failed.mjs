const ADVICE = [
  [/ENOENT|no such file or directory/i, 'The path does not exist. Locate it through the maps (wd map <path>) instead of guessing a path.'],
  [/EACCES|permission denied/i, 'A permission error. Do not retry with sudo; tell the user what needs to change.'],
  [/ERESOLVE|peer dep/i, 'A dependency resolution conflict. A dependency change needs an approved brief entry before it is attempted.'],
  [/command not found/i, 'That binary is not installed here. Check config.json commands rather than inventing one.'],
  [/timed out|ETIMEDOUT/i, 'The command timed out. Run it in the background or narrow it; do not re-run it unchanged.'],
];

export default async function ({ input }) {
  if (input.is_interrupt) return null;
  const error = String(input.error || '');
  const hit = ADVICE.find(([pattern]) => pattern.test(error));
  if (!hit) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: `web-dev: ${hit[1]}`,
    },
  };
}
