import { detect, sourceRoots } from '../lib/detect.mjs';

export default async function ({ input, root, armed }) {
  const next = input.new_cwd || root;
  const { kind, frameworks } = detect(next);
  const watchPaths = sourceRoots(next);

  if (armed || kind === 'armed') {
    return { hookSpecificOutput: { hookEventName: 'CwdChanged', watchPaths } };
  }
  if (kind === 'other' || kind === 'candidate') return null;
  return {
    hookSpecificOutput: { hookEventName: 'CwdChanged', watchPaths },
    systemMessage: `web-dev: ${next} is a ${frameworks.length ? frameworks.join(' + ') : 'JavaScript/TypeScript'} project without the harness. Adopt it before writing source there.`,
  };
}
