import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';
import { loadTs } from '../scripts/lib/ts.mjs';
import { scanContent } from '../scripts/security/scan.mjs';

const ts = loadTs();
const B = '`';

const cases = [
  ['dangerouslySetInnerHTML with a variable', 'src/A.tsx', 'export function A({ html }: { html: string }) { return <div dangerouslySetInnerHTML={{ __html: html }} />; }', ['WD-SEC-XSS-HTML']],
  ['sanitized HTML', 'src/A.tsx', "import DOMPurify from 'dompurify';\nexport function A({ html }: { html: string }) { return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />; }", []],
  ['innerHTML assignment', 'src/a.ts', 'export function f(el: HTMLElement, v: string) { el.innerHTML = v; }', ['WD-SEC-XSS-HTML']],
  ['interpolated SQL', 'src/db.ts', `export async function f(db: any, id: string) { return db.query(${B}SELECT * FROM users WHERE id = \${id}${B}); }`, ['WD-SEC-SQL-INTERP']],
  ['tagged SQL template', 'src/db.ts', `import { sql } from 'drizzle-orm';\nexport async function f(db: any, id: string) { return db.execute(sql${B}SELECT * FROM users WHERE id = \${id}${B}); }`, []],
  ['concatenated SQL through a variable', 'src/db.ts', "export async function f(db: any, id: string) { const q = 'SELECT * FROM users WHERE id = ' + id; return db.query(q); }", ['WD-SEC-SQL-INTERP']],
  ['eval', 'src/a.ts', 'export function f(code: string) { return eval(code); }', ['WD-SEC-EVAL']],
  ['exec with interpolation', 'src/a.ts', `import { exec } from 'node:child_process';\nexport function f(dir: string) { exec(${B}ls \${dir}${B}); }`, ['WD-SEC-CMD-INTERP']],
  ['TLS verification off', 'src/a.ts', "import https from 'node:https';\nexport const agent = new https.Agent({ rejectUnauthorized: false });", ['WD-SEC-TLS-OFF']],
  ['JWT none algorithm', 'src/a.ts', "import jwt from 'jsonwebtoken';\nexport function f(t: string, k: string) { return jwt.verify(t, k, { algorithms: ['none'] }); }", ['WD-SEC-JWT']],
  ['CORS any origin with credentials', 'server/app.ts', "import cors from 'cors';\nimport express from 'express';\nconst app = express();\napp.use(cors({ origin: '*', credentials: true }));", ['WD-SEC-CORS']],
  ['open redirect', 'server/app.ts', "import express from 'express';\nconst app = express();\napp.get('/r', (req, res) => res.redirect(req.query.next as string));", ['WD-SEC-REDIRECT']],
  ['SSRF through a local variable', 'server/app.ts', "import express from 'express';\nconst app = express();\napp.get('/p', async (req, res) => { const url = req.query.url as string; const r = await fetch(url); res.send(await r.text()); });", ['WD-SEC-SSRF']],
  ['path traversal', 'server/app.ts', "import express from 'express';\nimport path from 'node:path';\nconst app = express();\napp.get('/f', (req, res) => res.sendFile(path.join('/srv/files', req.params.name)));", ['WD-SEC-PATH']],
  ['deep merge of the body', 'server/a.ts', "import _ from 'lodash';\nexport function f(req: any, config: any) { _.merge(config, req.body); }", ['WD-SEC-PROTO']],
  ['mass assignment', 'server/a.ts', 'export async function f(req: any, prisma: any) { return prisma.user.update({ where: { id: req.params.id }, data: req.body }); }', ['WD-SEC-PROTO']],
  ['Math.random for a token', 'src/a.ts', 'export function f() { const resetToken = Math.random().toString(36); return resetToken; }', ['WD-SEC-RANDOM']],
  ['Math.random for layout', 'src/a.tsx', 'export function f() { const offset = Math.random() * 10; return offset; }', []],
  ['session cookie without flags', 'server/a.ts', "export function f(res: any, id: string) { res.cookie('session', id); }", ['WD-SEC-COOKIE']],
  ['session cookie with flags', 'server/a.ts', "export function f(res: any, id: string) { res.cookie('session', id, { httpOnly: true, secure: true, sameSite: 'lax' }); }", []],
  ['secret behind a public prefix', 'src/a.tsx', "'use client';\nexport const key = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;", ['WD-SEC-PUBLIC-ENV']],
  ['hardcoded live key', 'src/a.ts', `export const stripeKey = 'sk_live_${'51HxQmF2eZvKYlo2C0aBcDeFgHiJ'}';`, ['WD-SEC-SECRET']],
  ['message listener without origin check', 'src/a.ts', "window.addEventListener('message', (e) => { console.log(e.data); });", ['WD-SEC-POSTMESSAGE']],
  ['md5 password hash', 'server/a.ts', "import { createHash } from 'node:crypto';\nexport function hashPassword(password: string) { return createHash('md5').update(password).digest('hex'); }", ['WD-SEC-HASH']],
  ['added line comment', 'src/a.ts', 'export function f() {\n  // explain the trick\n  return 1;\n}', ['WD-COMMENT'], 'export function f() {\n  return 1;\n}'],
  ['pre-existing comment', 'src/a.ts', 'export function f() {\n  // explain the trick\n  return 2;\n}', [], 'export function f() {\n  // explain the trick\n  return 1;\n}'],
  ['JSX comment but not JSX text', 'src/A.tsx', "export function A() { return <div>{/* hidden */}<p>// not a comment</p><a href='https://x.y'>x</a></div>; }", ['WD-COMMENT']],
  ['allowed pragma', 'src/a.ts', 'export function f(x: unknown) {\n  // @ts-expect-error legacy typing in upstream lib\n  return x.y;\n}', []],
  ['slashes inside strings', 'src/a.ts', "export const u = 'https://example.com//path'; export const v = '// not';", []],
  ['Vue v-html and template comment', 'src/C.vue', '<template>\n  <!-- note -->\n  <div v-html="raw"></div>\n</template>\n<script setup lang="ts">\nconst raw = \'<b>x</b>\';\n</script>', ['WD-SEC-XSS-HTML', 'WD-COMMENT']],
  ['Svelte {@html}', 'src/C.svelte', '<script lang="ts">\n  export let body: string;\n</script>\n{@html body}', ['WD-SEC-XSS-HTML']],
  ['undeclared destructive migration', 'prisma/migrations/001_init/migration.sql', 'DROP TABLE users;', ['WD-SEC-MIGRATION']],
  ['declared destructive migration', 'prisma/migrations/001_init/migration.sql', 'DROP TABLE users;', [], null, { migrations: ['drop users after export'] }],
  ['undeclared dependency', 'package.json', JSON.stringify({ dependencies: { next: '15', 'left-pad': '1' } }), ['WD-DEP'], JSON.stringify({ dependencies: { next: '15' } })],
  ['declared dependency', 'package.json', JSON.stringify({ dependencies: { next: '15', 'left-pad': '1' } }), [], JSON.stringify({ dependencies: { next: '15' } }), { dependencies: ['left-pad'] }],
  ['security exception in the brief', 'src/a.ts', 'export function f(code: string) { return eval(code); }', [], null, { exceptions: [{ rule: 'WD-SEC-EVAL', path: 'src/a.ts', reason: 'sandboxed' }] }],
  ['clean authenticated route', 'src/app/api/orders/route.ts', "import { z } from 'zod';\nimport { auth } from '@/auth';\nimport { prisma } from '@/lib/db';\nconst Input = z.object({ total: z.number().int().positive() });\nexport async function POST(req: Request) {\n  const session = await auth();\n  if (!session) return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });\n  const body = Input.parse(await req.json());\n  const order = await prisma.order.create({ data: { total: body.total, userId: session.user.id } });\n  return Response.json({ id: order.id }, { status: 201 });\n}", []],
];

for (const [name, rel, text, expected, oldText = null, brief = null] of cases) {
  test(`security: ${name}`, { skip: !ts && 'parser not installed (wd setup)' }, () => {
    const { findings } = scanContent({
      ts,
      rel,
      newText: text,
      oldText,
      config: DEFAULT_CONFIG,
      brief: brief ? { exceptions: [], dependencies: [], migrations: [], ...brief } : null,
      tags: rel.startsWith('server') ? ['express'] : ['next', 'react'],
    });
    assert.deepEqual([...new Set(findings.map((f) => f.rule))].sort(), [...expected].sort(), JSON.stringify(findings, null, 2));
  });
}
