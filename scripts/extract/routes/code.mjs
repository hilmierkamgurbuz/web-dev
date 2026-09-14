import { calleeChain, collapse, decoratorInfo, decoratorsOf, isFunctionLike, literalText, normalizeServerPath, objectProp, plainChain, propName, refName, unwrap } from '../ast.mjs';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const NEST_VERBS = new Map([['Get', 'GET'], ['Post', 'POST'], ['Put', 'PUT'], ['Patch', 'PATCH'], ['Delete', 'DELETE'], ['All', 'ANY'], ['Options', 'OPTIONS'], ['Head', 'HEAD']]);
const ROUTER_FACTORIES = new Set(['router', 'createTRPCRouter', 'createRouter', 't.router', 'mergeRouters']);
const PROCEDURE_TERMINALS = new Set(['query', 'mutation', 'subscription']);
const ROUTER_NAME = /^(app|server|fastify|hono|instance|r|api[A-Z]\w*|\w*[Rr]outer|\w*App|\w*[Rr]outes)$/;

function isRouteReceiver(ctx, receiver) {
  if (!ctx.serverCapable || ctx.clientReceivers?.has(receiver)) return false;
  if (ctx.analysis.receivers.some((r) => r.name === receiver)) return true;
  if (ctx.params().has(receiver)) return true;
  return ROUTER_NAME.test(receiver);
}

function isHandlerArg(ts, node) {
  const n = unwrap(ts, node);
  return !!n && (isFunctionLike(ts, n) || ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) || ts.isCallExpression(n) || ts.isArrayLiteralExpression(n));
}

function namesOf(ts, sf, nodes) {
  const names = [];
  for (const node of nodes) {
    const n = unwrap(ts, node);
    if (!n) continue;
    if (ts.isArrayLiteralExpression(n)) names.push(...namesOf(ts, sf, n.elements));
    else if (ts.isObjectLiteralExpression(n)) {
      for (const key of ['preHandler', 'onRequest', 'preValidation', 'beforeHandle', 'middleware']) {
        const value = objectProp(ts, sf, n, key);
        if (value) names.push(...namesOf(ts, sf, [value]));
      }
    } else if (!isFunctionLike(ts, n)) names.push(refName(ts, sf, n));
  }
  return names.filter(Boolean);
}

function schemaFromValidators(ts, sf, nodes, markers) {
  for (const node of nodes) {
    const n = unwrap(ts, node);
    if (!n || !ts.isCallExpression(n)) continue;
    const name = plainChain(calleeChain(ts, n.expression)).pop();
    if (!markers.has(name)) continue;
    for (const arg of n.arguments) {
      const a = unwrap(ts, arg);
      if (a && ts.isIdentifier(a)) return a.text;
      if (a && ts.isCallExpression(a)) return collapse(a.getText(sf), 40);
    }
  }
  return null;
}

export function inspectRouteCall(ts, sf, call, ctx) {
  const chain = calleeChain(ts, call.expression);
  const plain = plainChain(chain);
  const last = plain[plain.length - 1];
  const receiver = plain[0];
  const args = call.arguments;
  const analysis = ctx.analysis;

  if (VERBS.has(last) && plain.length === 2 && args.length >= 2 && isRouteReceiver(ctx, receiver)) {
    const path = literalText(ts, args[0]);
    if (path == null || !(path.startsWith('/') || path === '*')) return false;
    const rest = args.slice(1);
    if (!rest.some((a) => isHandlerArg(ts, a) && !ts.isObjectLiteralExpression(unwrap(ts, a)))) return false;
    const handlerNode = unwrap(ts, rest[rest.length - 1]);
    const middlewareNodes = rest.slice(0, -1);
    analysis.routeDefs.push({
      receiver,
      method: last === 'all' ? 'ANY' : last.toUpperCase(),
      path: normalizeServerPath(path),
      middlewares: namesOf(ts, sf, middlewareNodes),
      schema: schemaFromValidators(ts, sf, middlewareNodes, ctx.validationMarkers),
      handler: handlerNode && !isFunctionLike(ts, handlerNode) ? refName(ts, sf, handlerNode) : null,
      inlineLine: handlerNode && isFunctionLike(ts, handlerNode) ? ctx.line(handlerNode) : null,
      symbol: ctx.currentSymbol(),
      line: ctx.line(call),
    });
    return true;
  }

  if (VERBS.has(last) && plain.length >= 3 && plain.slice(1, -1).includes('route') && ctx.serverCapable && !ctx.clientReceivers?.has(receiver)) {
    let routeCall = unwrap(ts, unwrap(ts, call.expression).expression);
    while (routeCall && ts.isCallExpression(routeCall) && plainChain(calleeChain(ts, routeCall.expression)).pop() !== 'route') {
      const callee = unwrap(ts, routeCall.expression);
      routeCall = callee && ts.isPropertyAccessExpression(callee) ? unwrap(ts, callee.expression) : null;
    }
    const path = routeCall && ts.isCallExpression(routeCall) ? literalText(ts, routeCall.arguments[0]) : null;
    if (path && args.length) {
      const handlerNode = unwrap(ts, args[args.length - 1]);
      analysis.routeDefs.push({
        receiver,
        method: last === 'all' ? 'ANY' : last.toUpperCase(),
        path: normalizeServerPath(path),
        middlewares: namesOf(ts, sf, args.slice(0, -1)),
        schema: schemaFromValidators(ts, sf, args.slice(0, -1), ctx.validationMarkers),
        handler: handlerNode && !isFunctionLike(ts, handlerNode) ? refName(ts, sf, handlerNode) : null,
        inlineLine: handlerNode && isFunctionLike(ts, handlerNode) ? ctx.line(handlerNode) : null,
        symbol: ctx.currentSymbol(),
        line: ctx.line(call),
      });
      return true;
    }
  }

  if (last === 'route' && plain.length === 2 && args.length === 1 && ts.isObjectLiteralExpression(unwrap(ts, args[0]))) {
    const url = literalText(ts, objectProp(ts, sf, args[0], 'url') || objectProp(ts, sf, args[0], 'path'));
    const methodNode = objectProp(ts, sf, args[0], 'method');
    const methods = [];
    const m = unwrap(ts, methodNode);
    if (m && ts.isArrayLiteralExpression(m)) m.elements.forEach((e) => literalText(ts, e) && methods.push(literalText(ts, e).toUpperCase()));
    else if (m && literalText(ts, m)) methods.push(literalText(ts, m).toUpperCase());
    const handlerNode = unwrap(ts, objectProp(ts, sf, args[0], 'handler'));
    if (url) {
      for (const method of methods.length ? methods : ['ANY']) {
        analysis.routeDefs.push({
          receiver,
          method,
          path: normalizeServerPath(url),
          middlewares: namesOf(ts, sf, [args[0]]),
          schema: objectProp(ts, sf, args[0], 'schema') ? 'schema' : null,
          handler: handlerNode && !isFunctionLike(ts, handlerNode) ? refName(ts, sf, handlerNode) : null,
          inlineLine: handlerNode && isFunctionLike(ts, handlerNode) ? ctx.line(handlerNode) : null,
          symbol: ctx.currentSymbol(),
          line: ctx.line(call),
        });
      }
      return true;
    }
  }

  if ((last === 'use' || last === 'route') && plain.length === 2 && args.length >= 1) {
    const prefix = literalText(ts, args[0]);
    if (prefix != null && prefix.startsWith('/') && args.length >= 2) {
      const targets = args.slice(1).map((a) => unwrap(ts, a)).filter((a) => a && (ts.isIdentifier(a) || ts.isPropertyAccessExpression(a))).map((a) => refName(ts, sf, a));
      const middlewares = args.slice(1).map((a) => unwrap(ts, a)).filter((a) => a && ts.isCallExpression(a)).map((a) => refName(ts, sf, a));
      if (targets.length || middlewares.length) analysis.mounts.push({ receiver, prefix: normalizeServerPath(prefix), targets, middlewares, line: ctx.line(call) });
      return true;
    }
    if (last === 'use' && prefix == null) {
      analysis.receiverMiddlewares.push({ receiver, middlewares: namesOf(ts, sf, args), line: ctx.line(call) });
      return true;
    }
  }

  if (last === 'register' && plain.length === 2 && args.length >= 1) {
    const target = unwrap(ts, args[0]);
    const prefix = literalText(ts, objectProp(ts, sf, args[1], 'prefix'));
    if (target && (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target))) {
      analysis.mounts.push({ receiver, prefix: prefix ? normalizeServerPath(prefix) : '/', targets: [refName(ts, sf, target)], middlewares: [], line: ctx.line(call) });
      return true;
    }
  }

  if (last === 'setGlobalPrefix' && args.length) {
    const prefix = literalText(ts, args[0]);
    if (prefix) analysis.globalPrefix = normalizeServerPath(prefix);
    return true;
  }

  if (ctx.tags.includes('next') && ctx.tags.length && last === 'method' && plain.length === 2) return false;
  return false;
}

export function inspectReceiverDeclaration(ts, sf, decl, ctx) {
  if (!ts.isIdentifier(decl.name) || !decl.initializer) return;
  const init = unwrap(ts, decl.initializer);
  const name = decl.name.text;
  let prefix = null;
  let isRouter = false;
  let current = init;
  while (current) {
    if (ts.isCallExpression(current)) {
      const plain = plainChain(calleeChain(ts, current.expression));
      const last = plain[plain.length - 1];
      if (last === 'basePath' && current.arguments.length) prefix = literalText(ts, current.arguments[0]);
      if (['Router', 'express', 'fastify', 'Fastify'].includes(last)) isRouter = true;
      current = ts.isPropertyAccessExpression(unwrap(ts, current.expression)) ? unwrap(ts, unwrap(ts, current.expression).expression) : null;
    } else if (ts.isNewExpression(current)) {
      const ctor = refName(ts, sf, current.expression);
      if (['Hono', 'Router', 'KoaRouter', 'Elysia'].includes(ctor.split('.').pop())) {
        isRouter = true;
        const opt = current.arguments?.[0];
        const p = literalText(ts, objectProp(ts, sf, opt, 'prefix'));
        if (p) prefix = p;
      }
      current = null;
    } else {
      current = null;
    }
  }
  if (isRouter || prefix) ctx.analysis.receivers.push({ name, prefix: prefix ? normalizeServerPath(prefix) : null, line: ctx.line(decl) });
}

export function inspectNestClass(ts, sf, cls, ctx) {
  const decorators = decoratorsOf(ts, cls).map((d) => decoratorInfo(ts, sf, d));
  const controller = decorators.find((d) => d.name === 'Controller');
  const resolver = decorators.find((d) => d.name === 'Resolver');
  if (!controller && !resolver) return;
  const className = cls.name?.text || 'default';
  let base = '/';
  if (controller?.args[0]) {
    const literal = literalText(ts, controller.args[0]);
    const pathProp = literalText(ts, objectProp(ts, sf, controller.args[0], 'path'));
    base = normalizeServerPath(literal ?? pathProp ?? '/');
  }
  const classGuards = decorators.filter((d) => d.name === 'UseGuards').flatMap((d) => d.args.map((a) => refName(ts, sf, a)));
  const classPublic = decorators.some((d) => /^(Public|AllowAnonymous|SkipAuth)$/.test(d.name));
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) || !member.name) continue;
    const methodName = propName(ts, sf, member.name);
    const decos = decoratorsOf(ts, member).map((d) => decoratorInfo(ts, sf, d));
    const guards = [...classGuards, ...decos.filter((d) => d.name === 'UseGuards').flatMap((d) => d.args.map((a) => refName(ts, sf, a)))];
    const isPublic = classPublic || decos.some((d) => /^(Public|AllowAnonymous|SkipAuth)$/.test(d.name));
    const bodyParam = member.parameters.find((p) => decoratorsOf(ts, p).some((d) => ['Body', 'Query', 'Args'].includes(decoratorInfo(ts, sf, d).name)));
    const schema = bodyParam?.type ? collapse(bodyParam.type.getText(sf), 40) : null;
    const out = member.type ? collapse(member.type.getText(sf), 40) : null;
    for (const deco of decos) {
      if (controller && NEST_VERBS.has(deco.name)) {
        const sub = deco.args[0] ? literalText(ts, deco.args[0]) ?? '' : '';
        ctx.analysis.routeDefs.push({
          receiver: `nest:${className}`,
          method: NEST_VERBS.get(deco.name),
          path: normalizeServerPath(`${base === '/' ? '' : base}/${sub}`.replace(/\/+/g, '/')),
          middlewares: isPublic ? ['@Public'] : guards,
          schema,
          out,
          handler: `${className}.${methodName}`,
          inlineLine: null,
          symbol: `${className}.${methodName}`,
          line: ctx.line(member),
          nest: true,
        });
      }
      if (resolver && ['Query', 'Mutation', 'Subscription'].includes(deco.name)) {
        ctx.analysis.gqlResolvers.push({ type: deco.name, field: methodName, symbol: `${className}.${methodName}`, guards, schema, line: ctx.line(member) });
      }
    }
  }
}

function procedureOf(ts, sf, node) {
  let current = unwrap(ts, node);
  if (!current || !ts.isCallExpression(current)) return null;
  const terminal = plainChain(calleeChain(ts, current.expression)).pop();
  if (!PROCEDURE_TERMINALS.has(terminal)) return null;
  let input = null;
  let base = null;
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = plainChain(calleeChain(ts, current.expression)).pop();
      if (name === 'input' && current.arguments[0]) input = refName(ts, sf, current.arguments[0]);
      current = unwrap(ts, current.expression);
    } else if (ts.isPropertyAccessExpression(current)) {
      current = unwrap(ts, current.expression);
    } else {
      base = refName(ts, sf, current);
      current = null;
    }
  }
  return { type: terminal, input, base };
}

function inspectRouterObject(ts, sf, obj, prefix, ctx, router) {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
    const key = propName(ts, sf, prop.name);
    const value = ts.isShorthandPropertyAssignment(prop) ? prop.name : unwrap(ts, prop.initializer);
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const procedure = procedureOf(ts, sf, value);
    if (procedure) {
      router.procedures.push({ key: fullKey, ...procedure, line: ctx.line(prop) });
      continue;
    }
    if (value && ts.isIdentifier(value)) {
      router.children.push({ key: fullKey, ref: value.text });
      continue;
    }
    if (value && ts.isCallExpression(value)) {
      const factory = plainChain(calleeChain(ts, value.expression)).join('.');
      const lastPart = factory.split('.').pop();
      if ((ROUTER_FACTORIES.has(factory) || ROUTER_FACTORIES.has(lastPart)) && value.arguments[0] && ts.isObjectLiteralExpression(unwrap(ts, value.arguments[0]))) {
        inspectRouterObject(ts, sf, unwrap(ts, value.arguments[0]), fullKey, ctx, router);
      }
    }
    if (value && ts.isObjectLiteralExpression(value) && /^(Query|Mutation|Subscription)$/.test(key)) {
      for (const field of value.properties) {
        if (field.name) ctx.analysis.gqlResolvers.push({ type: key, field: propName(ts, sf, field.name), symbol: ctx.currentSymbol(), guards: [], schema: null, line: ctx.line(field) });
      }
    }
  }
}

export function inspectRouterDeclaration(ts, sf, decl, exported, ctx) {
  if (!ts.isIdentifier(decl.name)) return;
  const init = unwrap(ts, decl.initializer);
  if (!init) return;
  if (ts.isObjectLiteralExpression(init)) {
    const hasGql = init.properties.some((p) => p.name && /^(Query|Mutation|Subscription)$/.test(propName(ts, sf, p.name)));
    if (hasGql) inspectRouterObject(ts, sf, init, '', ctx, { procedures: [], children: [] });
    return;
  }
  if (!ts.isCallExpression(init)) return;
  const factory = plainChain(calleeChain(ts, init.expression)).join('.');
  const lastPart = factory.split('.').pop();
  if (!(ROUTER_FACTORIES.has(factory) || ROUTER_FACTORIES.has(lastPart))) return;
  const arg = unwrap(ts, init.arguments[0]);
  if (!arg || !ts.isObjectLiteralExpression(arg)) return;
  const router = { name: decl.name.text, exported, procedures: [], children: [], line: ctx.line(decl) };
  inspectRouterObject(ts, sf, arg, '', ctx, router);
  if (router.procedures.length || router.children.length) ctx.analysis.trpcRouters.push(router);
}
