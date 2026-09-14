import path from 'node:path';
import { calleeChain, isFunctionLike, literalText, objectProp, plainChain, propName, unwrap } from '../extract/ast.mjs';
import { scriptProjection, templateProjection } from '../lib/sfc.mjs';
import { createSource, SFC_EXTENSIONS } from '../lib/ts.mjs';

const REQUEST_ROOTS = new Set(['req', 'request', 'ctx', 'c', 'event', 'context', 'r', 'reqs']);
const REQUEST_PROPS = new Set(['query', 'params', 'body', 'headers', 'cookies', 'url', 'originalUrl', 'path', 'searchParams', 'nextUrl', 'param', 'queries', 'formData', 'json', 'text', 'valid', 'raw']);
const H3_SOURCES = new Set(['getQuery', 'readBody', 'getRouterParam', 'getRouterParams', 'getHeader', 'getHeaders', 'getCookie', 'readRawBody', 'readFormData', 'readMultipartFormData']);
const NEUTRALIZERS = /(sanitize|purify|escape|validate|allow|safe|assert|parse|check|whitelist|allowlist|isvalid|normalize|encode|clean|strip|filter|guard|verify)/i;
const SANITIZERS = /(sanitize|purify|dompurify|xss|escapehtml|escape|clean)/i;
const SQL_SINKS = new Set(['query', 'execute', 'raw', '$queryRawUnsafe', '$executeRawUnsafe', 'unsafe', 'whereRaw', 'havingRaw', 'orderByRaw', 'joinRaw', 'fromRaw', 'selectRaw', 'exec', 'run', 'all', 'prepare']);
const SQL_KEYWORDS = /\b(select|insert|update|delete|where|from|values|order\s+by|group\s+by|set|join|create|drop|alter)\b/i;
const FS_SINKS = new Set(['readFile', 'readFileSync', 'createReadStream', 'createWriteStream', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'access', 'open', 'openSync', 'mkdir', 'rename', 'copyFile', 'sendFile', 'download']);
const OUTBOUND = new Set(['fetch', 'got', 'ky', 'request', 'ofetch', '$fetch']);
const OUTBOUND_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'request']);
const DEEP_MERGE = new Set(['merge', 'mergeWith', 'defaultsDeep', 'deepmerge', 'deepMerge', 'extend', 'assignDeep']);
const ORM_WRITES = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany', 'insert', 'save', 'values', 'set']);
const RANDOM_CONTEXT = /(token|secret|password|passwd|salt|nonce|otp|verification|reset|api_?key|apikey|session|csrf|invite|coupon|pin|code)/i;
const COOKIE_SENSITIVE = /(session|token|auth|jwt|sid|refresh|access|remember|csrf)/i;

function finding(rule, line, message, fix) {
  return { rule, line, message, fix };
}

function isLiteral(ts, node) {
  const n = unwrap(ts, node);
  return !!n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword);
}

function calleeName(ts, call) {
  return plainChain(calleeChain(ts, call.expression)).pop() || '';
}

function isNeutralizedCall(ts, node) {
  const n = unwrap(ts, node);
  return !!n && ts.isCallExpression(n) && NEUTRALIZERS.test(plainChain(calleeChain(ts, n.expression)).join('.'));
}

function isSanitizedCall(ts, node) {
  const n = unwrap(ts, node);
  return !!n && ts.isCallExpression(n) && SANITIZERS.test(plainChain(calleeChain(ts, n.expression)).join('.'));
}

function enclosingFunction(ts, node) {
  let current = node.parent;
  while (current && !isFunctionLike(ts, current) && !ts.isSourceFile(current)) current = current.parent;
  return current;
}

function bindingNames(ts, name, out) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(ts, el.name, out);
  }
  return out;
}

export function createTaint(ts) {
  const cache = new Map();
  const isRequestDerived = (node, tainted) => {
    const n = unwrap(ts, node);
    if (!n) return false;
    if (ts.isIdentifier(n)) return tainted.has(n.text);
    if (ts.isTemplateExpression(n)) return n.templateSpans.some((s) => isRequestDerived(s.expression, tainted));
    if (ts.isBinaryExpression(n)) return isRequestDerived(n.left, tainted) || isRequestDerived(n.right, tainted);
    if (ts.isConditionalExpression(n)) return isRequestDerived(n.whenTrue, tainted) || isRequestDerived(n.whenFalse, tainted);
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isCallExpression(n)) {
      if (ts.isCallExpression(n) && isNeutralizedCall(ts, n)) return false;
      const chain = plainChain(calleeChain(ts, ts.isCallExpression(n) ? n.expression : n));
      if (chain.length >= 2 && REQUEST_ROOTS.has(chain[0]) && REQUEST_PROPS.has(chain[1])) return true;
      if (chain.length >= 3 && REQUEST_ROOTS.has(chain[0]) && chain[1] === 'req' && REQUEST_PROPS.has(chain[2])) return true;
      if (ts.isCallExpression(n) && H3_SOURCES.has(chain[chain.length - 1])) return true;
      if (chain.includes('searchParams') && chain[chain.length - 1] === 'get') return true;
      if (chain.length && tainted.has(chain[0])) return true;
      if (ts.isCallExpression(n)) return n.arguments.some((a) => isRequestDerived(a, tainted)) && /^(String|decodeURIComponent|decodeURI|trim|toString|join|concat|resolve|join)$/.test(chain[chain.length - 1] || '');
    }
    return false;
  };
  const taintedFor = (fn) => {
    if (cache.has(fn)) return cache.get(fn);
    const tainted = new Set();
    if (fn && isFunctionLike(ts, fn)) {
      const declarations = [];
      const walk = (node) => {
        if (ts.isVariableDeclaration(node) && node.initializer) declarations.push(node);
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) declarations.push({ name: node.left, initializer: node.right });
        ts.forEachChild(node, walk);
      };
      if (fn.body) walk(fn.body);
      for (let round = 0; round < 3; round++) {
        for (const decl of declarations) {
          if (isRequestDerived(decl.initializer, tainted)) for (const name of bindingNames(ts, decl.name, [])) tainted.add(name);
        }
      }
    }
    cache.set(fn, tainted);
    return tainted;
  };
  return (node) => isRequestDerived(node, taintedFor(enclosingFunction(ts, node)));
}

function contextName(ts, sf, node) {
  let current = node.parent;
  for (let depth = 0; current && depth < 8; depth++) {
    if (ts.isVariableDeclaration(current)) return current.name.getText(sf);
    if (ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current)) return propName(ts, sf, current.name);
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) return current.left.getText(sf);
    if (isFunctionLike(ts, current)) return current.name ? current.name.getText(sf) : contextName(ts, sf, current);
    current = current.parent;
  }
  return '';
}

function functionText(ts, sf, node) {
  const fn = enclosingFunction(ts, node);
  return (fn && !ts.isSourceFile(fn) ? fn : sf).getText(sf);
}

export function astFindings(ts, rel, text, { tags = [], clientFile = false } = {}) {
  const ext = path.extname(rel).toLowerCase();
  let source = text;
  let lang;
  if (SFC_EXTENSIONS.has(ext)) {
    const projection = scriptProjection(text);
    source = projection.text;
    lang = projection.lang;
  }
  const sf = createSource(ts, SFC_EXTENSIONS.has(ext) ? `${rel}.${lang}` : rel, source, lang);
  const findings = [];
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const requestDerived = createTaint(ts);
  const childProcessLocals = new Set();
  const jwtLocals = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const locals = [clause?.name?.text, clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : null, ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => e.name.text) : [])].filter(Boolean);
    if (spec === 'child_process' || spec === 'node:child_process') locals.forEach((l) => childProcessLocals.add(l));
    if (spec === 'jsonwebtoken' || spec === 'jose') locals.forEach((l) => jwtLocals.add(l));
  }
  const fileHasVerify = /\bverify\s*\(|jwtVerify\s*\(/.test(source);
  const serverFile = !clientFile;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const chain = plainChain(calleeChain(ts, node.expression));
      const name = chain[chain.length - 1] || '';
      const root = chain[0] || '';
      const args = node.arguments;

      if ((chain.length === 1 && name === 'eval') || (chain.length === 2 && ['window', 'globalThis', 'global'].includes(root) && name === 'eval') || (root === 'vm' && /^run/.test(name))) {
        findings.push(finding('WD-SEC-EVAL', line(node), `${chain.join('.')}() executes code built at runtime`, 'replace dynamic code execution with explicit logic or a lookup table'));
      }
      if (['setTimeout', 'setInterval', 'setImmediate'].includes(name) && chain.length <= 2 && args[0]) {
        const first = unwrap(ts, args[0]);
        if (first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first) || (ts.isBinaryExpression(first) && first.operatorToken.kind === ts.SyntaxKind.PlusToken))) {
          findings.push(finding('WD-SEC-EVAL', line(node), `${name} with a string argument evaluates code`, 'pass a function instead of a string'));
        }
      }
      if (name === 'insertAdjacentHTML' && args[1] && !isLiteral(ts, args[1]) && !isSanitizedCall(ts, args[1])) {
        findings.push(finding('WD-SEC-XSS-HTML', line(node), 'insertAdjacentHTML with a non-literal value', 'build DOM nodes with textContent, or sanitize with DOMPurify.sanitize first'));
      }
      if (root === 'document' && (name === 'write' || name === 'writeln') && args.some((a) => !isLiteral(ts, a))) {
        findings.push(finding('WD-SEC-XSS-HTML', line(node), `document.${name} with a non-literal value`, 'create elements with the DOM API instead'));
      }
      if (SQL_SINKS.has(name) && args[0]) {
        const first = unwrap(ts, args[0]);
        const unsafeName = /Unsafe$|^unsafe$/.test(name);
        let dynamic = false;
        let staticText = '';
        if (first && ts.isTemplateExpression(first)) {
          dynamic = true;
          staticText = first.head.text + first.templateSpans.map((s) => s.literal.text).join(' ');
        } else if (first && ts.isBinaryExpression(first) && first.operatorToken.kind === ts.SyntaxKind.PlusToken && !isLiteral(ts, first.left) + !isLiteral(ts, first.right) > 0) {
          dynamic = true;
          staticText = first.getText(sf);
        } else if (first && ts.isIdentifier(first)) {
          const fnText = functionText(ts, sf, node);
          const decl = new RegExp(`(?:const|let|var)\\s+${first.text}\\s*=\\s*(\`[^\`]*\\$\\{|['"][^'"]*['"]\\s*\\+)`).exec(fnText);
          if (decl) {
            dynamic = true;
            staticText = fnText.slice(decl.index, decl.index + 200);
          }
        }
        if (dynamic && (unsafeName || SQL_KEYWORDS.test(staticText))) {
          findings.push(finding('WD-SEC-SQL-INTERP', line(node), `${chain.join('.')}() receives SQL built by string interpolation`, 'use parameter placeholders or the driver\'s tagged template (sql`…`) so values are bound, not concatenated'));
        } else if (unsafeName && first && !isLiteral(ts, first)) {
          findings.push(finding('WD-SEC-SQL-INTERP', line(node), `${name} with a non-literal query`, 'use $queryRaw with a tagged template, or bind parameters'));
        }
      }
      const cpCall = (childProcessLocals.has(root) && chain.length === 2) || (chain.length === 1 && childProcessLocals.has(name));
      if (cpCall && ['exec', 'execSync'].includes(name) && args[0] && !isLiteral(ts, args[0])) {
        findings.push(finding('WD-SEC-CMD-INTERP', line(node), `${name} runs a shell command built at runtime`, 'use execFile/spawn with an argument array and no shell'));
      }
      if (cpCall && ['spawn', 'spawnSync', 'execFile', 'execFileSync'].includes(name)) {
        const opts = args.find((a) => ts.isObjectLiteralExpression(unwrap(ts, a)));
        const shell = opts ? unwrap(ts, objectProp(ts, sf, opts, 'shell')) : null;
        if (shell && shell.kind === ts.SyntaxKind.TrueKeyword && args.slice(0, 2).some((a) => !isLiteral(ts, a) && !ts.isArrayLiteralExpression(unwrap(ts, a)))) {
          findings.push(finding('WD-SEC-CMD-INTERP', line(node), `${name} with shell: true and dynamic arguments`, 'remove shell: true and pass arguments as an array'));
        }
      }
      if (/^(redirect|sendRedirect|permanentRedirect)$/.test(name) && args.some((a) => requestDerived(a))) {
        findings.push(finding('WD-SEC-REDIRECT', line(node), 'redirect target comes from the request', 'redirect only to relative paths checked with an allowlist'));
      }
      if (serverFile && ((chain.length === 1 && OUTBOUND.has(name)) || (['axios', 'got', 'ky', 'http', 'https', 'undici'].includes(root) && (OUTBOUND_METHODS.has(name) || chain.length === 1)))) {
        const target = args[0];
        const urlNode = target && ts.isObjectLiteralExpression(unwrap(ts, target)) ? objectProp(ts, sf, target, 'url') : target;
        if (urlNode && requestDerived(urlNode)) {
          findings.push(finding('WD-SEC-SSRF', line(node), `${chain.join('.')}() URL is derived from request input`, 'resolve the URL against an allowlist of hosts before requesting it'));
        }
      }
      if (serverFile && FS_SINKS.has(name) && args[0]) {
        const first = unwrap(ts, args[0]);
        const joined = first && ts.isCallExpression(first) && ['join', 'resolve'].includes(calleeName(ts, first)) && first.arguments.some((a) => requestDerived(a));
        if ((requestDerived(first) || joined) && !/startsWith\(|path\.relative\(|isInside|within|contain|safeJoin/.test(functionText(ts, sf, node))) {
          findings.push(finding('WD-SEC-PATH', line(node), `${name}() uses a path derived from request input without a containment check`, 'resolve the path, then verify it stays inside the allowed directory (path.relative must not start with "..")'));
        }
      }
      if (DEEP_MERGE.has(name) && args.slice(1).some((a) => requestDerived(a))) {
        findings.push(finding('WD-SEC-PROTO', line(node), `${chain.join('.')}() deep-merges request input`, 'parse the input with a schema and copy known fields only'));
      }
      if (root === 'Object' && name === 'assign' && args.length >= 2) {
        const target = unwrap(ts, args[0]);
        const targetIsFresh = target && ts.isObjectLiteralExpression(target) && target.properties.length === 0;
        if (!targetIsFresh && args.slice(1).some((a) => requestDerived(a))) {
          findings.push(finding('WD-SEC-PROTO', line(node), 'Object.assign copies request input onto an existing object (mass assignment)', 'parse the input with a schema and assign known fields only'));
        }
      }
      if (ORM_WRITES.has(name) && args[0]) {
        const data = objectProp(ts, sf, args[0], 'data') || (name === 'values' || name === 'set' || name === 'save' || name === 'insert' ? args[0] : null);
        const d = unwrap(ts, data);
        const raw = d && (requestDerived(d) && !ts.isIdentifier(d) ? d : null);
        const spread = d && ts.isObjectLiteralExpression(d) && d.properties.some((p) => ts.isSpreadAssignment(p) && /^(req|request|c\.req|ctx\.request)\.body$/.test(p.expression.getText(sf)));
        if ((raw && /\.body$|json\(\)$/.test(d.getText(sf))) || spread) {
          findings.push(finding('WD-SEC-PROTO', line(node), `${chain.join('.')}() writes the raw request body (mass assignment)`, 'parse the body with a schema and pass only the parsed fields'));
        }
      }
      if (name === 'cors' || name === 'enableCors') {
        const opts = args[0];
        const origin = unwrap(ts, objectProp(ts, sf, opts, 'origin'));
        const credentials = unwrap(ts, objectProp(ts, sf, opts, 'credentials'));
        const anyOrigin = origin && ((literalText(ts, origin) === '*') || origin.kind === ts.SyntaxKind.TrueKeyword);
        if (anyOrigin && credentials && credentials.kind === ts.SyntaxKind.TrueKeyword) {
          findings.push(finding('WD-SEC-CORS', line(node), 'CORS allows any origin together with credentials', 'list the allowed origins explicitly'));
        }
      }
      if ((name === 'setHeader' || name === 'header' || name === 'set') && literalText(ts, args[0])?.toLowerCase() === 'access-control-allow-origin') {
        const value = unwrap(ts, args[1]);
        if ((value && literalText(ts, value) === '*') || requestDerived(value)) {
          if (/access-control-allow-credentials['"]\s*,\s*['"]?true/i.test(functionText(ts, sf, node))) {
            findings.push(finding('WD-SEC-CORS', line(node), 'Access-Control-Allow-Origin is * or reflected while credentials are allowed', 'echo only origins from an allowlist'));
          }
        }
      }
      if (name === 'decode' && (jwtLocals.has(root) || root === 'jwt') && !fileHasVerify) {
        findings.push(finding('WD-SEC-JWT', line(node), 'JWT decoded without verifying its signature', 'use jwt.verify (or jose jwtVerify) with an explicit algorithm list'));
      }
      if (name === 'createHash' && args[0] && /^(md5|sha1)$/i.test(literalText(ts, args[0]) || '') && /pass(word|wd)?/i.test(functionText(ts, sf, node))) {
        findings.push(finding('WD-SEC-HASH', line(node), `${literalText(ts, args[0])} used near password handling`, 'hash passwords with argon2id, bcrypt or scrypt'));
      }
      if (name === 'createHash' && args[0] && /^sha(256|512)$/i.test(literalText(ts, args[0]) || '') && /hash\w*password|password\w*hash/i.test(functionText(ts, sf, node))) {
        findings.push(finding('WD-SEC-HASH', line(node), 'fast digest used to hash passwords', 'hash passwords with argon2id, bcrypt or scrypt'));
      }
      if (name === 'addEventListener' && literalText(ts, args[0]) === 'message' && args[1]) {
        const handler = unwrap(ts, args[1]);
        const body = handler && isFunctionLike(ts, handler) ? handler.getText(sf) : null;
        if (body && !/\.origin\b/.test(body)) {
          findings.push(finding('WD-SEC-POSTMESSAGE', line(node), 'message listener never checks event.origin', 'return early unless event.origin is an expected origin'));
        }
      }
      if (root === 'Math' && name === 'random' && RANDOM_CONTEXT.test(contextName(ts, sf, node))) {
        findings.push(finding('WD-SEC-RANDOM', line(node), `Math.random used for "${contextName(ts, sf, node)}"`, 'use crypto.randomBytes / crypto.randomUUID / crypto.getRandomValues'));
      }
      const cookieSetter = (name === 'cookie' && chain.length === 2) || (name === 'set' && chain.includes('cookies')) || name === 'setCookie';
      if (cookieSetter && !(tags.includes('sveltekit') && chain[0] === 'cookies')) {
        const nameArg = name === 'setCookie' ? args[1] : args[0];
        const opts = args.find((a, i) => i > 0 && ts.isObjectLiteralExpression(unwrap(ts, a))) || (ts.isObjectLiteralExpression(unwrap(ts, args[0] || sf)) ? args[0] : null);
        const cookieName = literalText(ts, nameArg) || literalText(ts, objectProp(ts, sf, opts, 'name')) || (nameArg ? nameArg.getText(sf) : '');
        if (COOKIE_SENSITIVE.test(cookieName)) {
          const flag = (key) => {
            const v = unwrap(ts, objectProp(ts, sf, opts, key));
            return !!v && v.kind !== ts.SyntaxKind.FalseKeyword && literalText(ts, v) !== 'none';
          };
          const missing = ['httpOnly', 'secure', 'sameSite'].filter((k) => !flag(k));
          if (missing.length) {
            findings.push(finding('WD-SEC-COOKIE', line(node), `cookie "${cookieName}" set without ${missing.join(', ')}`, 'set httpOnly: true, secure: true and sameSite: "lax" or "strict"'));
          }
        }
      }
    } else if (ts.isNewExpression(node)) {
      const name = plainChain(calleeChain(ts, node.expression)).pop();
      if (name === 'Function') findings.push(finding('WD-SEC-EVAL', line(node), 'new Function builds code at runtime', 'write the function explicitly'));
    } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left) && ['innerHTML', 'outerHTML'].includes(left.name.text) && !isLiteral(ts, node.right) && !isSanitizedCall(ts, node.right)) {
        findings.push(finding('WD-SEC-XSS-HTML', line(node), `${left.name.text} assigned a non-literal value`, 'set textContent, or sanitize with DOMPurify.sanitize first'));
      }
      if (ts.isPropertyAccessExpression(left) && left.name.text === 'NODE_TLS_REJECT_UNAUTHORIZED' && /^['"]?0['"]?$/.test(node.right.getText(sf))) {
        findings.push(finding('WD-SEC-TLS-OFF', line(node), 'TLS certificate verification disabled globally', 'fix the certificate chain or pass a trusted CA instead'));
      }
      if (ts.isPropertyAccessExpression(left) && left.name.text === 'onmessage' && isFunctionLike(ts, unwrap(ts, node.right)) && !/\.origin\b/.test(node.right.getText(sf))) {
        findings.push(finding('WD-SEC-POSTMESSAGE', line(node), 'onmessage handler never checks event.origin', 'return early unless event.origin is expected'));
      }
      if (ts.isElementAccessExpression(left) && requestDerived(left.argumentExpression) && !/__proto__|hasOwn|constructor|allowed|includes\(/.test(functionText(ts, sf, node))) {
        findings.push(finding('WD-SEC-PROTO', line(node), 'property name taken from request input', 'check the key against an allowlist (and reject __proto__, constructor, prototype)'));
      }
    } else if (ts.isPropertyAssignment(node)) {
      const key = propName(ts, sf, node.name);
      const value = unwrap(ts, node.initializer);
      if ((key === 'rejectUnauthorized' || key === 'strictSSL') && value?.kind === ts.SyntaxKind.FalseKeyword) {
        findings.push(finding('WD-SEC-TLS-OFF', line(node), `${key}: false disables certificate verification`, 'keep verification on and configure the trusted CA'));
      }
      if (key === 'algorithms' && value && ts.isArrayLiteralExpression(value) && value.elements.some((e) => (literalText(ts, e) || '').toLowerCase() === 'none')) {
        findings.push(finding('WD-SEC-JWT', line(node), 'JWT algorithms allow "none"', 'list only the signing algorithm you use, e.g. ["HS256"] or ["RS256"]'));
      }
      if (key === 'algorithm' && (literalText(ts, value) || '').toLowerCase() === 'none') {
        findings.push(finding('WD-SEC-JWT', line(node), 'JWT signed with algorithm "none"', 'sign with HS256/RS256/EdDSA'));
      }
      if (key === 'ignoreExpiration' && value?.kind === ts.SyntaxKind.TrueKeyword) {
        findings.push(finding('WD-SEC-JWT', line(node), 'JWT expiration ignored', 'remove ignoreExpiration and keep tokens short-lived'));
      }
    } else if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'dangerouslySetInnerHTML') {
      const init = node.initializer && ts.isJsxExpression(node.initializer) ? unwrap(ts, node.initializer.expression) : null;
      const html = init ? unwrap(ts, objectProp(ts, sf, init, '__html')) : null;
      if (!init || !html || (!isLiteral(ts, html) && !isSanitizedCall(ts, html))) {
        findings.push(finding('WD-SEC-XSS-HTML', line(node), 'dangerouslySetInnerHTML with a non-literal value', 'render text normally, or wrap the value in DOMPurify.sanitize(...)'));
      }
    } else if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'env') {
      const envName = node.name.text;
      if (/^(NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_)/.test(envName) && /(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET)/.test(envName) && !/(PUBLISHABLE|PUBLIC_KEY|SITE_KEY|ANON_KEY)/.test(envName)) {
        findings.push(finding('WD-SEC-PUBLIC-ENV', line(node), `${envName} puts a secret-looking value into the client bundle`, 'rename without the public prefix and read it only on the server'));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (SFC_EXTENSIONS.has(ext)) {
    const template = templateProjection(text);
    for (const m of template.matchAll(/\sv-html\s*=\s*"([^"]*)"/g)) {
      if (!SANITIZERS.test(m[1])) findings.push(finding('WD-SEC-XSS-HTML', template.slice(0, m.index).split('\n').length, `v-html="${m[1].slice(0, 40)}" renders unsanitized HTML`, 'render text with {{ }} or bind a value passed through DOMPurify.sanitize'));
    }
    for (const m of template.matchAll(/\{@html\s+([^}]*)\}/g)) {
      if (!SANITIZERS.test(m[1])) findings.push(finding('WD-SEC-XSS-HTML', template.slice(0, m.index).split('\n').length, `{@html ${m[1].slice(0, 40)}} renders unsanitized HTML`, 'render text normally or sanitize with DOMPurify.sanitize'));
    }
  }
  return findings;
}
