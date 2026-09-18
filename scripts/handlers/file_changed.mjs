import path from 'node:path';

const IGNORED = /(^|\/)(\.git|node_modules|\.next|\.nuxt|\.svelte-kit|\.output|\.turbo|dist|build|out|coverage)(\/|$)/;
const GENERATED = /^\.claude\/web-dev\/(maps|shots)\//;
const OWNED = /^\.claude\/web-dev\/state\//;

export default async function ({ input, root }) {
  const absolute = input.file_path;
  if (!absolute) return null;
  const rel = path.relative(root, absolute).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || IGNORED.test(rel) || GENERATED.test(rel)) return null;

  const state = await import('../lib/state.mjs');

  if (OWNED.test(rel)) {
    if (!state.isSelfWrite(root, rel)) {
      state.markTamper(root, rel, input.event);
      return { systemMessage: `web-dev: ${rel} was written by something other than the hooks. That file records approval and turn state, so the harness treats it as compromised until the next turn audit re-derives it.` };
    }
    return null;
  }

  state.addTurnWrite(root, rel, { via: 'watch', event: input.event || 'change' });
  return null;
}
