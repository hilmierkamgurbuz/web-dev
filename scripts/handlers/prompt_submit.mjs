import { detect } from '../lib/detect.mjs';
import { alreadyTold, rememberTold } from '../lib/pdata.mjs';

const WEB_INTENT = [
  /\b(web|website|web ?site|webapp|landing|dashboard|portal)\w*/i,
  /\b(site|sayfa|panel|yönetim|arayüz|tasarım|ekran)\w*/i,
  /\b(react|next\.?js|vue|nuxt|svelte|sveltekit|angular|astro|solid|remix|qwik|vite|express|fastify|hono|nest\.?js|tailwind|shadcn|prisma|drizzle)\w*/i,
  /\b(component|bileşen|route|rota|endpoint|api|rest|graphql|trpc|middleware|schema|şema|migration|migrasyon|orm|veritabanı|database)\w*/i,
  /\b(frontend|front-?end|backend|back-?end|fullstack|full-?stack|ssr|csr|rsc|hydration|responsive|mobil|mobile)\w*/i,
  /\b(login|signup|kayıt|giriş|auth|oauth|session|oturum|checkout|ödeme|payment|stripe|cart|sepet|form|kullanıcı)\w*/i,
  /\b(button|buton|modal|navbar|header|footer|sidebar|dropdown|carousel|hero|css|scss|styling|stil|tema|theme|dark mode|menü|menu)\w*/i,
  /\.(tsx|jsx|vue|svelte|astro|css|scss)\b/i,
  /\b(npm|pnpm|yarn|bun|npx)\b/i,
  /(?=[\s\S]*\b(build|derleme|deploy|yayın|kurulum|install)\w*)(?=[\s\S]*\b(fail|failed|error|hata|bozuk|bozul|patla|kırıl|çalışmıyor|broken)\w*)/i,
  /\b(localhost|:3000|:5173|:8080|dev server|hot reload|hmr)\b/i,
];

const CONTINUE_INTENT = /\b(devam|kaldığımız|kaldığın|continue|resume|pick up where|nerede kalmıştık|next task|sıradaki)\b/i;

function looksWeb(prompt) {
  return WEB_INTENT.some((pattern) => pattern.test(prompt));
}

function unarmedNotice(root, prompt, sessionId) {
  const { kind, frameworks } = detect(root);
  if (kind === 'other') return null;
  const web = looksWeb(prompt);
  const resuming = CONTINUE_INTENT.test(prompt);
  if (!web && !resuming) return null;
  if (kind === 'candidate' && !web) return null;
  if (alreadyTold(root, 'route', sessionId)) return null;
  rememberTold(root, 'route', sessionId);

  if (kind === 'empty') {
    return 'web-dev: this directory is empty and the request is web work. The web-dev skill owns it — start at procedures/bootstrap.md. Ask the intake questions and get the brief approved before scaffolding anything.';
  }
  return `web-dev: this is a ${frameworks.length ? frameworks.join(' + ') : 'JavaScript/TypeScript'} project and the harness has no state here yet. Invoke the web-dev skill and follow procedures/adopt.md before changing any source file. You run the installer yourself with \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs" . --setup\`; /web-dev:init is only the user-typed shortcut for it, so never stop and wait for the user to type it.`;
}

export default async function ({ input, root, armed }) {
  const prompt = String(input.prompt || '');

  if (!armed) {
    const notice = unarmedNotice(root, prompt, input.session_id);
    return notice ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notice } } : null;
  }

  const [{ loadConfig }, state, { layout }, { exists, readText, removeFile }] = await Promise.all([
    import('../lib/config.mjs'),
    import('../lib/state.mjs'),
    import('../lib/paths.mjs'),
    import('../lib/io.mjs'),
  ]);

  const L = layout(root);
  const config = loadConfig(root);
  state.startTurn(root, input.prompt_id);
  const lines = [];

  for (const line of prompt.split(/\r?\n/)) {
    const match = /^\s*([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+([0-9a-f]{8})\s*$/.exec(line.trim());
    const bare = config.approval.tokens.includes(line.trim());
    if (!match && !bare) continue;
    if (bare) {
      const current = state.briefHash(root);
      lines.push(`web-dev: an approval token arrived without a brief hash, so nothing was approved. Approval must name the exact version it approves. Ask the user to send \`${config.approval.tokens[0]} ${current ? current.slice(0, 8) : '<hash8>'}\`, or use the AskUserQuestion approval, which carries the hash already.`);
      continue;
    }
    if (!config.approval.tokens.includes(match[1].toUpperCase())) continue;
    const result = state.recordApproval(root, { hash8: match[2], via: 'token', sessionId: input.session_id });
    lines.push(result.ok
      ? `web-dev: brief ${result.hash.slice(0, 8)} approved by token · branch ${result.brief.branch}.`
      : `web-dev: approval not recorded — ${result.reason}.`);
  }

  if (input.permission_mode === 'plan') {
    lines.push('web-dev: plan mode is on, and this project plans through the approved brief instead (gates/brief.md). Plan mode blocks the brief and the write gate. Ask the user to leave it with Shift+Tab, then continue at locate.');
  }

  const task = state.readTask(root);
  if (task.state === 'closed' && !task.reminded && task.closedSession === input.session_id) {
    state.writeTask(root, { reminded: true });
    lines.push(`web-dev: "${task.title || ''}" closed in this session${task.pr ? ` (${task.pr})` : ''} and its context is still loaded. Recommend /clear before this request; every piece of state is on disk and the next session reloads it automatically.`);
  }

  if (exists(L.next) && CONTINUE_INTENT.test(prompt)) {
    const next = readText(L.next);
    if (next?.trim()) {
      removeFile(L.next);
      lines.push(`web-dev: the queued next task is:\n${next.trim()}`);
    }
  }

  return lines.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') } } : null;
}
