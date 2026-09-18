export default async function ({ input, root }) {
  const state = await import('../lib/state.mjs');
  state.writeTask(root, { lastSessionEnd: new Date().toISOString(), lastSessionEndReason: input.reason || 'other' });
  return null;
}
