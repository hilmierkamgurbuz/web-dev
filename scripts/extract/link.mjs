import path from 'node:path';
import { readJson, readText } from '../lib/io.mjs';
import { loadAliases, resolveImport } from '../lib/tsconfig.mjs';
import { HOLE, joinPaths, normalizeClientUrl, normalizeServerPath, pathMatches } from './ast.mjs';

export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ACTION', 'MUTATION', 'ANY']);
const VALIDATION_TERMINALS = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync', 'validate', 'validateSync', 'readValidatedBody', 'getValidatedQuery', 'getValidatedRouterParams', 'zValidator', 'validator', 'assert', 'is']);
const ROOT_RECEIVERS = new Set(['app', 'server', 'fastify', 'api', 'hono', 'instance', 'application']);
const PUBLIC_ENV = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_|GATSBY_)/;
const SECRET_ENV = /(SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|ACCESS_KEY|CLIENT_SECRET|DATABASE_URL|DB_URL|CREDENTIAL|SIGNING|WEBHOOK)/;
const NOT_SECRET_ENV = /(PUBLISHABLE|PUBLIC_KEY|SITE_KEY|ANON_KEY|_URL$|_HOST$|_PORT$|_NAME$)/;
const SERVER_FRAMEWORK_DEPS = ['express', 'fastify', 'hono', 'koa', '@nestjs/core'];
const FULLSTACK_DEPS = ['next', 'nuxt', '@sveltejs/kit', '@remix-run/react', '@react-router/dev', 'astro'];

const STORE_WRITES = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'set', 'delete', 'clear', 'add', 'sort', 'reverse', 'fill', 'copyWithin']);
const STRICT_MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ACTION', 'MUTATION']);

function holeStartsPath(raw, ordinal) {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== HOLE) continue;
    if (seen === ordinal) return !raw.slice(0, i).replaceAll(HOLE, '').includes('/');
    seen++;
  }
  return false;
}

function pascalPath(parts) {
  const pascal = parts.map((p) => p.replace(/(^|[-_.])(\w)/g, (_, __, c) => c.toUpperCase()));
  const last = pascal[pascal.length - 1];
  const prefix = pascal.slice(0, -1).join('');
  return prefix && last.startsWith(prefix) ? last : prefix + last;
}

function specificity(routePath) {
  return routePath.split('/').filter((s) => s && !s.startsWith('{')).length;
}

function methodOk(callMethod, routeMethod) {
  return !callMethod || callMethod === 'ANY' || routeMethod === 'ANY' || callMethod === routeMethod || (callMethod === 'GET' && routeMethod === 'HEAD');
}

function substituteHole(raw, ordinal, replacement) {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== HOLE) continue;
    if (seen === ordinal) return raw.slice(0, i) + replacement + raw.slice(i + 1);
    seen++;
  }
  return raw;
}

export function displayRaw(raw) {
  return raw.replaceAll(HOLE, '${…}');
}

function envExampleKeys(root, dirs) {
  const keys = new Set();
  for (const dir of ['', ...dirs]) {
    for (const name of ['.env.example', '.env.sample', '.env.local.example', '.env.template']) {
      const text = readText(path.join(root, dir, name));
      if (!text) continue;
      for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/gim)) keys.add(m[1]);
    }
  }
  return keys;
}

export function linkProject(root, { files, tags, config, stack }) {
  const fileSet = new Set(files.keys());
  const workspaces = stack?.workspaces || [];
  const aliasSets = [{ dir: '', aliases: loadAliases(root, tags) }];
  for (const dir of workspaces) {
    aliasSets.push({
      dir,
      aliases: loadAliases(path.join(root, dir), tags).map((a) => ({ pattern: a.pattern, targets: a.targets.map((t) => path.posix.join(dir, t)) })),
    });
  }
  aliasSets.sort((a, b) => b.dir.length - a.dir.length);
  const workspacePackages = new Map();
  for (const dir of workspaces) {
    const pkg = readJson(path.join(root, dir, 'package.json'), null);
    if (pkg?.name) workspacePackages.set(pkg.name, dir);
  }

  const resolveCache = new Map();
  const resolve = (fromRel, spec) => {
    const key = `${fromRel}\0${spec}`;
    if (resolveCache.has(key)) return resolveCache.get(key);
    const set = aliasSets.find((s) => !s.dir || fromRel.startsWith(`${s.dir}/`));
    let target = resolveImport(fromRel, spec, { aliases: set.aliases, fileSet });
    if (!target) {
      for (const [name, dir] of workspacePackages) {
        if (spec !== name && !spec.startsWith(`${name}/`)) continue;
        const sub = spec.slice(name.length).replace(/^\//, '');
        for (const base of sub ? [`${dir}/src/${sub}`, `${dir}/${sub}`] : [`${dir}/src/index`, `${dir}/index`, `${dir}/src`]) {
          target = resolveImport('index.ts', `./${base}`, { aliases: [], fileSet });
          if (target) break;
        }
        if (target) break;
      }
    }
    resolveCache.set(key, target || null);
    return target || null;
  };

  const localImports = new Map();
  const importEdges = new Map();
  const usedBy = new Map();
  for (const [rel, a] of files) {
    const locals = new Map();
    const targets = new Set();
    for (const imp of a.imports) {
      const target = resolve(rel, imp.spec);
      if (target && target !== rel) targets.add(target);
      if (imp.default) locals.set(imp.default, { spec: imp.spec, imported: 'default', target });
      if (imp.namespace) locals.set(imp.namespace, { spec: imp.spec, imported: '*', target });
      for (const n of imp.named) locals.set(n.local, { spec: imp.spec, imported: n.imported, target });
    }
    for (const re of a.reexports) {
      const target = resolve(rel, re.spec);
      if (target && target !== rel) targets.add(target);
    }
    localImports.set(rel, locals);
    importEdges.set(rel, targets);
    for (const target of targets) {
      if (!usedBy.has(target)) usedBy.set(target, new Set());
      usedBy.get(target).add(rel);
    }
  }

  const symbolOf = (file, name) => files.get(file)?.symbols.find((s) => s.name === name) || null;

  const exportTarget = (rel, name, depth = 0) => {
    const a = files.get(rel);
    if (!a) return null;
    let local = name;
    if (name === 'default' && a.defaultExport) local = a.defaultExport;
    if (a.symbols.some((s) => s.name === local) || (a.locals || []).includes(local)) return { file: rel, symbol: local };
    if (depth > 4) return null;
    for (const re of a.reexports) {
      const hit = re.names.find((n) => n.exported === name);
      if (!hit && !re.all) continue;
      const target = resolve(rel, re.spec);
      if (!target) continue;
      const found = exportTarget(target, hit ? hit.imported : name, depth + 1);
      if (found) return found;
    }
    const imported = localImports.get(rel)?.get(local);
    if (imported?.target) return exportTarget(imported.target, imported.imported === '*' ? name : imported.imported, depth + 1);
    return null;
  };

  const autoIndex = new Map();
  if (tags.includes('nuxt')) {
    for (const [rel, a] of files) {
      if (/(^|\/)(composables|utils|server\/utils)\//.test(rel)) {
        for (const s of a.symbols) if (s.exported && !s.name.includes('.') && !s.name.includes(' ')) autoIndex.set(s.name, { file: rel, symbol: s.name === 'default' ? 'default' : s.name });
      }
      const component = /(?:^|\/)components\/(.+)\.vue$/.exec(rel);
      if (component) autoIndex.set(pascalPath(component[1].split('/')), { file: rel, symbol: 'default' });
    }
  }

  const refTarget = (rel, ref) => {
    if (!ref) return null;
    const [root, member] = ref.split('.');
    if (!localImports.get(rel)?.has(root) && !symbolOf(rel, root) && !(files.get(rel)?.locals || []).includes(root) && autoIndex.has(root)) return autoIndex.get(root);
    const imported = localImports.get(rel)?.get(root);
    if (imported) {
      if (!imported.target) return null;
      if (imported.imported === '*' && member) return exportTarget(imported.target, member);
      const base = exportTarget(imported.target, imported.imported);
      if (base && member && symbolOf(base.file, `${base.symbol}.${member}`)) return { file: base.file, symbol: `${base.symbol}.${member}` };
      return base;
    }
    if (member && symbolOf(rel, `${root}.${member}`)) return { file: rel, symbol: `${root}.${member}` };
    if (symbolOf(rel, root)) return { file: rel, symbol: root };
    return null;
  };

  const authMarkers = new Set(config.authMarkers);
  const validationMarkers = new Set([...VALIDATION_TERMINALS, ...config.validationMarkers.filter((m) => m !== 'input')]);
  const matchAuth = (names) => (names || []).find((n) => n && (authMarkers.has(n) || authMarkers.has(n.split('.').pop()) || authMarkers.has(n.split('.')[0]))) || null;

  const handlerMemo = new Map();
  const analyzeHandler = (file, symbolName, depth = 0, seen = new Set()) => {
    const key = `${file}#${symbolName}`;
    if (depth === 0 && handlerMemo.has(key)) return handlerMemo.get(key);
    const result = { auth: null, schema: null, db: [], readsBody: false };
    const symbol = symbolOf(file, symbolName);
    if (!symbol || seen.has(key)) return result;
    seen.add(key);
    result.readsBody = !!symbol.readsBody;
    result.auth = matchAuth(symbol.calls);
    for (const call of symbol.calls) {
      const parts = call.split('.');
      const last = parts[parts.length - 1];
      if (validationMarkers.has(last) && !authMarkers.has(last)) {
        result.schema = parts.length > 1 ? parts[0] : last;
        break;
      }
    }
    result.db = [...symbol.db];
    if (depth < 2) {
      for (const call of symbol.calls) {
        const target = refTarget(file, call);
        if (!target || (target.file === file && target.symbol === symbolName)) continue;
        const inner = analyzeHandler(target.file, target.symbol, depth + 1, seen);
        if (!result.auth && inner.auth) result.auth = `${inner.auth} via ${target.symbol}`;
        if (!result.schema && inner.schema) result.schema = inner.schema;
        if (inner.readsBody && depth === 0 && target.file === file) result.readsBody = true;
        for (const d of inner.db) if (!result.db.some((x) => x.op === d.op && x.entity === d.entity)) result.db.push(d);
      }
    }
    if (depth === 0) handlerMemo.set(key, result);
    return result;
  };

  const guards = [];
  for (const [rel, a] of files) {
    const calls = a.symbols.flatMap((s) => s.calls);
    const marker = matchAuth(calls);
    if (!marker) continue;
    if (/(^|\/)(src\/)?middleware\.(t|j)s$/.test(rel)) {
      const matchers = (a.middlewareMatchers?.length ? a.middlewareMatchers : ['/:path*']).map((m) => (/[()]/.test(m) ? '/{*}' : normalizeServerPath(m)));
      guards.push({ kind: 'middleware', file: rel, marker, matchers });
    } else if (/(^|\/)src\/hooks\.server\.(t|j)s$/.test(rel) || /(^|\/)server\/middleware\/[^/]+\.(t|j)s$/.test(rel)) {
      guards.push({ kind: 'server-hook', file: rel, marker, matchers: ['/{*}'] });
    }
  }

  const routes = [];
  const pages = [];
  const layouts = [];
  const unresolved = [];
  let globalPrefix = null;
  for (const a of files.values()) if (a.globalPrefix) globalPrefix = a.globalPrefix;

  for (const [rel, a] of files) {
    for (const r of a.routes) {
      const handler = analyzeHandler(rel, r.symbol);
      const guard = r.path ? guards.find((g) => g.matchers.some((m) => pathMatches(m, r.path))) : null;
      routes.push({
        kind: r.kind,
        method: r.method,
        path: r.path,
        key: r.kind === 'action' ? r.name : null,
        file: rel,
        symbol: r.symbol,
        auth: handler.auth || (guard ? `${guard.marker}@${guard.file}` : null),
        schema: handler.schema,
        out: symbolOf(rel, r.symbol)?.signature.match(/\):\s*(.+)$/)?.[1] || null,
        db: handler.db,
        callers: [],
        framework: r.framework,
      });
    }
    for (const p of a.pages) pages.push({ ...p, file: rel });
    for (const l of a.layouts) layouts.push({ ...l, file: rel });
  }

  const mountsByTarget = new Map();
  for (const [rel, a] of files) {
    for (const mount of a.mounts) {
      for (const target of mount.targets) {
        const resolved = refTarget(rel, target) || { file: rel, symbol: target };
        const key = `${resolved.file}#${resolved.symbol}`;
        if (!mountsByTarget.has(key)) mountsByTarget.set(key, []);
        mountsByTarget.get(key).push({ prefix: mount.prefix, parentFile: rel, parentReceiver: mount.receiver, middlewares: mount.middlewares });
      }
    }
  }

  const prefixesFor = (file, receiver, enclosing, depth = 0) => {
    const a = files.get(file);
    const info = a?.receivers.find((r) => r.name === receiver);
    const own = info?.prefix || '';
    const receiverMw = (a?.receiverMiddlewares || []).filter((x) => x.receiver === receiver).flatMap((x) => x.middlewares);
    const keys = new Set([`${file}#${receiver}`]);
    if (enclosing) keys.add(`${file}#${enclosing}`).add(`${file}#${enclosing.split('.')[0]}`);
    const mounts = [...keys].flatMap((k) => mountsByTarget.get(k) || []);
    if (!mounts.length || depth > 4) {
      const rootLike = ROOT_RECEIVERS.has(receiver) || depth > 0;
      return [{ prefix: own, middlewares: receiverMw, unmounted: !rootLike }];
    }
    return mounts.flatMap((m) =>
      prefixesFor(m.parentFile, m.parentReceiver, null, depth + 1).map((parent) => ({
        prefix: joinPaths(parent.prefix, m.prefix, own),
        middlewares: [...parent.middlewares, ...m.middlewares, ...receiverMw],
        unmounted: parent.unmounted,
      })),
    );
  };

  for (const [rel, a] of files) {
    for (const def of a.routeDefs) {
      const variants = def.nest ? [{ prefix: globalPrefix || '', middlewares: [], unmounted: false }] : prefixesFor(rel, def.receiver, def.symbol);
      for (const variant of variants) {
        const handlerRef = def.handler ? refTarget(rel, def.handler) : def.symbol ? { file: rel, symbol: def.symbol } : null;
        const handler = handlerRef ? analyzeHandler(handlerRef.file, handlerRef.symbol) : { auth: null, schema: null, db: [] };
        const middlewares = [...variant.middlewares, ...def.middlewares];
        const isPublic = middlewares.includes('@Public');
        const mwSchema = middlewares.find((n) => validationMarkers.has(n.split('.').pop()) || /validat/i.test(n));
        routes.push({
          kind: 'http',
          method: def.method,
          path: joinPaths(variant.prefix, def.path),
          key: null,
          file: handlerRef?.file || rel,
          symbol: handlerRef?.symbol || def.handler || '-',
          definedAt: `${rel}:${def.line}`,
          auth: isPublic ? null : matchAuth(middlewares) || handler.auth,
          schema: def.schema || handler.schema || (mwSchema ? mwSchema : null),
          out: def.out || null,
          db: handler.db,
          callers: [],
          framework: def.nest ? 'nest' : 'code',
        });
        if (variant.unmounted) unresolved.push({ file: rel, symbol: def.symbol || '-', raw: `${def.method} ${def.path}`, via: `router "${def.receiver}" is not mounted anywhere`, line: def.line });
      }
    }
  }

  const routerIndex = new Map();
  for (const [rel, a] of files) for (const r of a.trpcRouters) routerIndex.set(`${rel}#${r.name}`, { rel, ...r });
  const childKeys = new Set();
  const childrenOf = new Map();
  for (const [key, router] of routerIndex) {
    for (const child of router.children) {
      const target = refTarget(router.rel, child.ref);
      const targetKey = target ? `${target.file}#${target.symbol}` : null;
      if (!targetKey || !routerIndex.has(targetKey)) continue;
      childKeys.add(targetKey);
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key).push({ key: child.key, targetKey });
    }
  }
  const emitRouter = (key, prefix, depth) => {
    const router = routerIndex.get(key);
    for (const p of router.procedures) {
      const fullKey = prefix ? `${prefix}.${p.key}` : p.key;
      const symbolName = symbolOf(router.rel, `${router.name}.${p.key}`) ? `${router.name}.${p.key}` : router.name;
      const handler = analyzeHandler(router.rel, symbolName);
      routes.push({
        kind: 'rpc',
        method: p.type === 'query' ? 'QUERY' : p.type === 'mutation' ? 'MUTATION' : 'SUBSCRIPTION',
        path: null,
        key: fullKey,
        file: router.rel,
        symbol: symbolName,
        auth: matchAuth([p.base]) || (/protected|authed|admin|private/i.test(p.base || '') ? p.base : null) || handler.auth,
        schema: p.input || handler.schema,
        out: null,
        db: handler.db,
        callers: [],
        framework: 'trpc',
      });
    }
    if (depth < 5) for (const child of childrenOf.get(key) || []) emitRouter(child.targetKey, prefix ? `${prefix}.${child.key}` : child.key, depth + 1);
  };
  for (const key of routerIndex.keys()) if (!childKeys.has(key)) emitRouter(key, '', 0);

  for (const [rel, a] of files) {
    for (const g of a.gqlResolvers) {
      const handler = g.symbol ? analyzeHandler(rel, g.symbol) : { auth: null, schema: null, db: [] };
      routes.push({
        kind: 'gql',
        method: g.type.toUpperCase(),
        path: null,
        key: `${g.type}.${g.field}`,
        file: rel,
        symbol: g.symbol || '-',
        auth: matchAuth(g.guards) || handler.auth,
        schema: g.schema || handler.schema,
        out: null,
        db: handler.db,
        callers: [],
        framework: 'graphql',
      });
    }
  }

  const wrappers = new Map();
  const callSites = [];
  const addCallSite = (site) => {
    const normalized = normalizeClientUrl(site.raw);
    if (normalized.external) return;
    if (!normalized.path || !normalized.resolved) {
      unresolved.push({ file: site.file, symbol: site.symbol || '-', raw: displayRaw(site.raw), via: site.via, line: site.line });
      return;
    }
    callSites.push({ ...site, path: normalized.path });
  };
  for (const [rel, a] of files) {
    for (const call of a.http) {
      const paramHole = call.holes.findIndex((h) => h.param != null);
      if (paramHole !== -1 && call.symbol && holeStartsPath(call.raw, paramHole)) {
        wrappers.set(`${rel}#${call.symbol}`, { raw: call.raw, holeOrdinal: paramHole, paramIndex: call.holes[paramHole].param, method: call.method, via: call.via });
        continue;
      }
      addCallSite({ file: rel, symbol: call.symbol, method: call.method || 'ANY', raw: call.raw, via: call.via, line: call.line });
    }
  }
  const processed = new Set();
  for (let round = 0; round < 4; round++) {
    let added = false;
    for (const [rel, a] of files) {
      for (const inv of a.invocations) {
        const id = `${rel}:${inv.line}:${inv.callee}`;
        if (processed.has(id)) continue;
        const target = refTarget(rel, inv.callee);
        const wrapper = target && wrappers.get(`${target.file}#${target.symbol}`);
        if (!wrapper) continue;
        processed.add(id);
        const arg = inv.args[wrapper.paramIndex];
        const via = `${target.symbol}()`;
        if (!arg) {
          unresolved.push({ file: rel, symbol: inv.symbol || '-', raw: `${inv.callee}(…)`, via, line: inv.line });
          continue;
        }
        const raw = substituteHole(wrapper.raw, wrapper.holeOrdinal, arg.raw);
        const nested = (arg.holes || []).findIndex((h) => h.param != null);
        if (nested !== -1 && inv.symbol && !wrappers.has(`${rel}#${inv.symbol}`) && holeStartsPath(raw, wrapper.holeOrdinal + nested)) {
          wrappers.set(`${rel}#${inv.symbol}`, { raw, holeOrdinal: wrapper.holeOrdinal + nested, paramIndex: arg.holes[nested].param, method: inv.method || wrapper.method, via });
          added = true;
          continue;
        }
        addCallSite({ file: rel, symbol: inv.symbol, method: inv.method || wrapper.method || 'ANY', raw, via, line: inv.line });
      }
    }
    if (!added) break;
  }

  const httpRoutes = routes.filter((r) => r.kind === 'http' && r.path);
  const unmatched = [];
  const externalPrefixes = config.externalApiPrefixes || [];
  for (const site of callSites) {
    const matches = httpRoutes.filter((r) => methodOk(site.method, r.method) && pathMatches(r.path, site.path));
    if (matches.length) {
      const best = Math.max(...matches.map((r) => specificity(r.path)));
      for (const r of matches) if (specificity(r.path) === best && !r.callers.some((c) => c.file === site.file && c.symbol === (site.symbol || '-'))) r.callers.push({ file: site.file, symbol: site.symbol || '-' });
      continue;
    }
    if (site.method === 'GET' && pages.some((p) => pathMatches(p.path, site.path))) continue;
    if (externalPrefixes.some((p) => site.path.startsWith(p))) continue;
    unmatched.push({ file: site.file, symbol: site.symbol || '-', method: site.method, path: site.path, via: site.via, line: site.line });
  }

  const rpcRoutes = routes.filter((r) => r.kind === 'rpc');
  for (const [rel, a] of files) {
    for (const call of a.rpcCalls) {
      const match = rpcRoutes.find((r) => r.key === call.key);
      if (match) {
        if (!match.callers.some((c) => c.file === rel && c.symbol === (call.symbol || '-'))) match.callers.push({ file: rel, symbol: call.symbol || '-' });
      } else if (rpcRoutes.length) {
        unmatched.push({ file: rel, symbol: call.symbol || '-', method: 'RPC', path: call.key, via: call.terminal, line: call.line });
      }
    }
    for (const op of a.gqlOps) {
      const match = routes.find((r) => r.kind === 'gql' && r.key === `${op.type}.${op.field}`);
      if (match && !match.callers.some((c) => c.file === rel && c.symbol === (op.symbol || '-'))) match.callers.push({ file: rel, symbol: op.symbol || '-' });
    }
  }

  for (const route of routes.filter((r) => r.kind === 'action')) {
    for (const importer of usedBy.get(route.file) || []) {
      const a = files.get(importer);
      let found = false;
      for (const symbol of a.symbols) {
        for (const call of symbol.calls) {
          const target = refTarget(importer, call);
          if (target && target.file === route.file && target.symbol === route.symbol) {
            found = true;
            if (!route.callers.some((c) => c.file === importer && c.symbol === symbol.name)) route.callers.push({ file: importer, symbol: symbol.name });
          }
        }
      }
      const imports = [...(localImports.get(importer) || new Map()).values()].some((imp) => imp.target === route.file && (imp.imported === route.symbol || imp.imported === '*'));
      if (!found && imports) route.callers.push({ file: importer, symbol: '-' });
    }
  }

  const tables = new Map();
  const lookup = new Map();
  const addTable = (entry, rel, kind) => {
    const key = entry.name;
    if (!tables.has(key)) tables.set(key, { name: entry.name, table: entry.table || entry.name, columns: entry.columns || [], source: `${rel} (${kind})`, readers: [], writers: [] });
    for (const alias of [entry.name, entry.table, entry.name && entry.name[0].toLowerCase() + entry.name.slice(1)]) if (alias) lookup.set(alias.toLowerCase(), key);
  };
  for (const [rel, a] of files) {
    if (a.schema) for (const model of a.schema.models) addTable(model, rel, a.schema.kind);
    for (const table of a.tables) addTable(table, rel, table.kind);
  }
  const storeKeys = new Map();
  for (const [rel, a] of files) {
    for (const store of a.stores || []) {
      const key = tables.has(store.name) ? `${store.name}@${rel}` : store.name;
      tables.set(key, { name: store.name, table: store.name, columns: [], source: `${rel} (in-memory ${store.kind})`, readers: [], writers: [] });
      storeKeys.set(`${rel}#${store.name}`, key);
    }
  }
  const resolveEntity = (entity) => {
    const value = String(entity);
    if (value.includes('.')) {
      const [parent, field] = value.split('.');
      const parentKey = lookup.get(parent.toLowerCase());
      const column = parentKey ? tables.get(parentKey)?.columns.find((c) => c.name === field) : null;
      return column ? lookup.get(column.type.replace(/[[\]?]/g, '').toLowerCase()) || null : null;
    }
    return lookup.get(value.toLowerCase()) || null;
  };
  const record = (rel, symbolName, access) => {
    let key = access.via === 'store' ? access.entity : resolveEntity(access.entity);
    if (!key) {
      if (!['sql', 'knex'].includes(access.via) && tables.size) return;
      key = access.entity;
      if (!tables.has(key)) tables.set(key, { name: key, table: key, columns: [], source: 'inferred from queries', readers: [], writers: [] });
      lookup.set(key.toLowerCase(), key);
    }
    const list = access.op === 'w' ? tables.get(key).writers : tables.get(key).readers;
    if (!list.some((x) => x.file === rel && x.symbol === symbolName)) list.push({ file: rel, symbol: symbolName });
  };
  for (const [rel, a] of files) {
    for (const symbol of a.symbols) {
      for (const access of symbol.db) record(rel, symbol.name, access);
      if (!storeKeys.size) continue;
      for (const call of symbol.calls) {
        const parts = call.split('.');
        if (parts.length < 2) continue;
        const target = refTarget(rel, parts[0]);
        const key = target ? storeKeys.get(`${target.file}#${target.symbol}`) : null;
        if (!key) continue;
        const op = STORE_WRITES.has(parts[1]) ? 'w' : 'r';
        symbol.db.push({ op, entity: key, via: 'store' });
        record(rel, symbol.name, { op, entity: key, via: 'store' });
      }
    }
    for (const access of a.fileDb) record(rel, '-', access);
  }
  const tableName = (entity) => (tables.has(entity) && storeKeys.size && [...storeKeys.values()].includes(entity) ? tables.get(entity).table : tables.get(resolveEntity(entity))?.table || entity);
  handlerMemo.clear();
  for (const route of routes) {
    const handler = route.symbol && route.symbol !== '-' ? analyzeHandler(route.file, route.symbol) : { db: [], readsBody: false };
    for (const d of handler.db) if (!route.db.some((x) => x.op === d.op && x.entity === d.entity)) route.db.push(d);
    route.db = route.db.map((d) => ({ op: d.op, entity: tableName(d.entity) }));
    route.mutating = STRICT_MUTATING.has(route.method) || (route.method === 'ANY' && (handler.readsBody || route.db.some((d) => d.op === 'w')));
  }
  for (const [rel, a] of files) {
    for (const r of a.jsxRoutes || []) {
      let target = r.component ? refTarget(rel, r.component) : null;
      if (!target && r.importSpec) {
        const resolved = resolve(rel, r.importSpec);
        if (resolved) target = { file: resolved, symbol: 'default' };
      }
      const pagePath = normalizeServerPath(r.path);
      if (!pages.some((p) => p.path === pagePath && p.file === (target?.file || rel))) {
        pages.push({ path: pagePath, symbol: target?.symbol || 'default', file: target?.file || rel, framework: 'client-router', declaredIn: rel });
      }
    }
  }

  const packages = stack?.packages || [];
  const packageOf = (rel) => packages.filter((p) => p.dir === '.' || rel.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const serverish = (rel) => /(^|\/)(server|api|controllers|services|db|database|middleware|middlewares|prisma|drizzle|trpc)\//.test(rel) || /(\.server\.|\+server\.|\+page\.server\.|\+layout\.server\.|hooks\.server\.)/.test(rel) || /(^|\/)(route|middleware)\.(t|j)s$/.test(rel);
  const isClientFile = (rel, a) => {
    if (a.directives.includes('use client')) return true;
    if (a.directives.includes('use server') || serverish(rel)) return false;
    if (/\.(vue|svelte)$/.test(rel)) return true;
    const pkg = packageOf(rel);
    const deps = pkg?.deps || [];
    const spa = deps.includes('vite') && !deps.some((d) => FULLSTACK_DEPS.includes(d) || SERVER_FRAMEWORK_DEPS.includes(d));
    return spa;
  };
  const exampleKeys = envExampleKeys(root, workspaces);
  const envMap = new Map();
  for (const [rel, a] of files) {
    const client = isClientFile(rel, a);
    for (const use of a.env) {
      if (!envMap.has(use.name)) envMap.set(use.name, { name: use.name, uses: [], exposed: false, secretLike: false, inExample: exampleKeys.has(use.name) });
      const entry = envMap.get(use.name);
      const exposedModule = use.module && /\/public$/.test(use.module);
      if (PUBLIC_ENV.test(use.name) || exposedModule) entry.exposed = true;
      entry.secretLike = SECRET_ENV.test(use.name) && !NOT_SECRET_ENV.test(use.name.replace(/^(NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_)/, ''));
      if (!entry.uses.some((u) => u.file === rel)) entry.uses.push({ file: rel, client });
    }
  }

  const componentTree = (file, depth, seen) => {
    const a = files.get(file);
    if (!a || depth > 4 || seen.has(file)) return [];
    const next = new Set(seen).add(file);
    const nodes = [];
    const tags = [...new Set(a.jsx.map((j) => j.tag))];
    for (const tag of tags) {
      const target = refTarget(file, tag);
      if (!target) continue;
      const ta = files.get(target.file);
      nodes.push({
        tag,
        file: target.file,
        client: !!ta && (ta.directives.includes('use client') || /\.(vue|svelte)$/.test(target.file)),
        fetches: !!ta && (ta.http.length > 0 || ta.rpcCalls.length > 0),
        children: componentTree(target.file, depth + 1, next),
      });
    }
    return nodes;
  };
  for (const page of pages) {
    const a = files.get(page.file);
    page.client = page.framework === 'client-router' || (!!a && a.directives.includes('use client'));
    page.metadata = !!a && a.metadata;
    page.layouts = layouts
      .filter((l) => l.framework === page.framework && (l.path === '/' || page.path === l.path || page.path.startsWith(`${l.path}/`)))
      .sort((x, y) => x.path.length - y.path.length)
      .map((l) => l.file);
    const main = a?.symbols.find((s) => s.name === page.symbol) || a?.symbols.find((s) => s.name === 'default');
    const serverData = [];
    if (main) {
      const handler = analyzeHandler(page.file, main.name);
      for (const d of handler.db) serverData.push(`${d.op} ${tableName(d.entity)}`);
      for (const call of main.calls) {
        const target = refTarget(page.file, call);
        const targetSymbol = target ? symbolOf(target.file, target.symbol) : null;
        if (target && target.file !== page.file && !/\.(tsx|jsx|vue|svelte)$/.test(target.file) && targetSymbol && ['function', 'wrapped', 'method', 'hook'].includes(targetSymbol.kind)) serverData.push(call);
      }
    }
    page.data = [...new Set(serverData)];
    page.clientFetch = a ? a.http.length + a.rpcCalls.length > 0 : false;
    page.components = componentTree(page.file, 0, new Set());
  }

  return {
    fileSet,
    importEdges,
    usedBy,
    localImports,
    refTarget,
    symbolOf,
    routes,
    pages,
    layouts,
    unmatched,
    unresolved,
    tables: [...tables.values()],
    env: [...envMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    guards,
    tableName,
  };
}
