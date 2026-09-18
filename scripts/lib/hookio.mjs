export function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

export function ask(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } };
}

export function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

export const WD = 'node .claude/web-dev/wd.mjs';
