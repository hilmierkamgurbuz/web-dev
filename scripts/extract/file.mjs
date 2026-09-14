import path from 'node:path';
import { short } from '../lib/hash.mjs';
import { scriptProjection, templateProjection } from '../lib/sfc.mjs';
import { CODE_EXTENSIONS, createSource, SFC_EXTENSIONS } from '../lib/ts.mjs';
import { calleeChain, collapse, collectConsts, isFunctionLike, isPascal, literalText, nodeEndLine, nodeLine, plainChain, propName, unwrap } from './ast.mjs';
import { inspectDbCall, inspectEntityClass, inspectSqlText, inspectTableDeclaration, parsePrisma, parseSqlSchema, repositoryParams } from './db.mjs';
import { gqlOperations, inspectClientCall, inspectInvocation } from './http.mjs';
import { inspectNestClass, inspectReceiverDeclaration, inspectRouteCall, inspectRouterDeclaration } from './routes/code.mjs';
import { fileRoutes } from './routes/filesystem.mjs';

export const ANALYZER_VERSION = 3;

const NOTE_KINDS = new Set(['function', 'component', 'hook', 'method', 'class', 'wrapped']);
const JSX_EXT = new Set(['.tsx', '.jsx', '.vue', '.svelte']);
const METADATA_EXPORTS = new Set(['metadata', 'generateMetadata', 'meta', 'head', 'generateStaticParams']);
const METADATA_CALLS = new Set(['useHead', 'useSeoMeta', 'definePageMeta', 'useServerSeoMeta']);
const HEAD_TAGS = new Set(['title', 'Head', 'Helmet', 'Meta', 'Title']);

export function emptyAnalysis(rel) {
  return {
    v: ANALYZER_VERSION,
    rel,
    directives: [],
    imports: [],
    exports: [],
    reexports: [],
    symbols: [],
    routes: [],
    pages: [],
    layouts: [],
    routeDefs: [],
    mounts: [],
    receivers: [],
    receiverMiddlewares: [],
    globalPrefix: null,
    trpcRouters: [],
    gqlResolvers: [],
    gqlOps: [],
    http: [],
    rpcCalls: [],
    invocations: [],
    fileDb: [],
    env: [],
    jsx: [],
    metadata: false,
    schema: null,
    tables: [],
    methodChecks: [],
    actionsKeys: [],
    inlineActions: [],
    middlewareMatchers: null,
    defaultExport: null,
    locals: [],
    stores: [],
    jsxRoutes: [],
    parseDiagnostics: 0,
  };
}

const ROUTER_FACTORIES = new Set(['router', 'createTRPCRouter', 'createRouter', 'mergeRouters']);

function isJsDocNode(ts, node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

export function hashNode(ts, sf, node, skip) {
  const out = [];
  const visit = (n) => {
    if (n === skip || isJsDocNode(ts, n)) return;
    if (n.getChildCount(sf) === 0) {
      let text = n.getText(sf);
      if (n.kind === ts.SyntaxKind.JsxText) text = text.replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
      return;
    }
    for (const child of n.getChildren(sf)) visit(child);
  };
  visit(node);
  return short(out.join(' '));
}

function hasModifier(ts, node, kind) {
  return !!node.modifiers?.some((m) => m.kind === kind);
}

function signatureOf(ts, sf, name, fn) {
  const typeParams = fn.typeParameters?.length ? `<${fn.typeParameters.map((p) => p.getText(sf)).join(', ')}>` : '';
  const params = (fn.parameters || []).map((p) => p.getText(sf)).join(', ');
  const ret = fn.type ? `: ${fn.type.getText(sf)}` : '';
  const isAsync = hasModifier(ts, fn, ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  return collapse(`${isAsync}${name}${typeParams}(${params})${ret}`, 220);
}

function innerFunction(ts, call, depth = 0) {
  if (depth > 3) return null;
  for (const arg of call.arguments) {
    const a = unwrap(ts, arg);
    if (isFunctionLike(ts, a)) return a;
    if (a && ts.isCallExpression(a)) {
      const inner = innerFunction(ts, a, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

function refineKind(kind, name, jsxFile) {
  if (kind !== 'function' && kind !== 'wrapped') return kind;
  if (jsxFile && isPascal(name)) return 'component';
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  return kind;
}

function collectSymbols(ts, sf, rel, analysis) {
  const jsxFile = JSX_EXT.has(path.extname(rel).toLowerCase());
  const entries = [];
  const exportedLocals = new Set();

  const add = (name, kind, node, { fn = null, exported = false, skip = null, signature = null } = {}) => {
    const line = nodeLine(sf, node);
    const endLine = nodeEndLine(sf, node);
    const finalKind = refineKind(kind, name, jsxFile);
    const lines = endLine - line + 1;
    const symbol = {
      name,
      kind: finalKind,
      exported,
      signature: signature || (fn ? signatureOf(ts, sf, name, fn) : name),
      line,
      endLine,
      lines,
      hash: hashNode(ts, sf, node, skip),
      calls: [],
      db: [],
      readsBody: false,
      requiresNote: NOTE_KINDS.has(finalKind) && (exported || lines > 5),
    };
    entries.push({ symbol, node });
    return symbol;
  };

  for (const statement of sf.statements) {
    const exported = hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text || 'default';
      add(isDefault ? 'default' : name, 'function', statement, { fn: statement, exported, skip: statement.name });
      if (isDefault && statement.name) analysis.exports.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const init = unwrap(ts, decl.initializer);
        if (!init) {
          if (exported) add(name, 'const', decl, { exported, skip: decl.name });
          continue;
        }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          add(name, 'function', decl, { fn: init, exported, skip: decl.name });
        } else if (ts.isCallExpression(init) && ROUTER_FACTORIES.has(plainChain(calleeChain(ts, init.expression)).pop()) && init.arguments[0] && ts.isObjectLiteralExpression(unwrap(ts, init.arguments[0]))) {
          const keys = [];
          for (const prop of unwrap(ts, init.arguments[0]).properties) {
            if (!prop.name) continue;
            const key = propName(ts, sf, prop.name);
            keys.push(key);
            if (!ts.isPropertyAssignment(prop)) continue;
            const value = unwrap(ts, prop.initializer);
            const fn = value && ts.isCallExpression(value) ? innerFunction(ts, value) : null;
            if (fn) add(`${name}.${key}`, 'method', prop, { fn, exported, skip: prop.name });
          }
          add(name, 'const', decl, { exported, skip: decl.name, signature: `${name} = ${plainChain(calleeChain(ts, init.expression)).pop()}({ ${collapse(keys.join(', '), 120)} })` });
        } else if (ts.isCallExpression(init)) {
          const inner = innerFunction(ts, init);
          if (inner) {
            const wrapper = plainChain(calleeChain(ts, init.expression)).join('.');
            const sig = `${signatureOf(ts, sf, name, inner)} ⟵ ${collapse(wrapper, 40)}`;
            add(name, 'wrapped', decl, { fn: inner, exported, skip: decl.name, signature: sig });
          } else if (exported) {
            add(name, 'const', decl, { exported, skip: decl.name, signature: `${name} = ${collapse(plainChain(calleeChain(ts, init.expression)).join('.'), 60)}(…)` });
          }
        } else if (ts.isObjectLiteralExpression(init)) {
          const keys = [];
          for (const prop of init.properties) {
            if (!prop.name) continue;
            const key = propName(ts, sf, prop.name);
            keys.push(key);
            if (ts.isMethodDeclaration(prop)) {
              add(`${name}.${key}`, 'method', prop, { fn: prop, exported, skip: prop.name });
            } else if (ts.isPropertyAssignment(prop)) {
              const value = unwrap(ts, prop.initializer);
              if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) add(`${name}.${key}`, 'method', prop, { fn: value, exported, skip: prop.name });
            }
          }
          if (exported) add(name, 'const', decl, { exported, skip: decl.name, signature: `${name} { ${collapse(keys.join(', '), 120)} }` });
          if (exported && name === 'actions') analysis.actionsKeys.push(...keys);
        } else if (ts.isClassExpression(init)) {
          add(name, 'class', decl, { exported, skip: decl.name, signature: `class ${name}` });
        } else if (exported) {
          const type = decl.type ? `: ${collapse(decl.type.getText(sf), 80)}` : '';
          add(name, 'const', decl, { exported, skip: decl.name, signature: `${name}${type}` });
        }
      }
    } else if (ts.isClassDeclaration(statement)) {
      const className = statement.name?.text || 'default';
      const heritage = statement.heritageClauses?.map((h) => h.getText(sf)).join(' ') || '';
      add(className, 'class', statement, { exported, skip: statement.name, signature: collapse(`class ${className} ${heritage}`, 160) });
      for (const member of statement.members) {
        const isPrivate = hasModifier(ts, member, ts.SyntaxKind.PrivateKeyword) || hasModifier(ts, member, ts.SyntaxKind.ProtectedKeyword) || (member.name && ts.isPrivateIdentifier(member.name));
        if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
          const key = propName(ts, sf, member.name);
          add(`${className}.${key}`, 'method', member, { fn: member, exported: exported && !isPrivate, skip: member.name });
        } else if (ts.isConstructorDeclaration(member) && member.body) {
          add(`${className}.constructor`, 'method', member, { fn: member, exported: false });
        } else if (ts.isPropertyDeclaration(member) && member.initializer) {
          const value = unwrap(ts, member.initializer);
          if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
            add(`${className}.${propName(ts, sf, member.name)}`, 'method', member, { fn: value, exported: exported && !isPrivate, skip: member.name });
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const expr = unwrap(ts, statement.expression);
      if (expr && (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr))) {
        add('default', 'function', statement, { fn: expr, exported: true });
      } else if (expr && ts.isIdentifier(expr)) {
        exportedLocals.add(expr.text);
        analysis.exports.push('default');
        analysis.defaultExport = expr.text;
      } else if (expr && ts.isCallExpression(expr)) {
        const inner = innerFunction(ts, expr);
        const wrapper = plainChain(calleeChain(ts, expr.expression)).join('.');
        if (inner) add('default', 'wrapped', statement, { fn: inner, exported: true, signature: `${signatureOf(ts, sf, 'default', inner)} ⟵ ${collapse(wrapper, 40)}` });
        else add('default', 'const', statement, { exported: true, signature: `default = ${collapse(wrapper, 60)}(…)` });
      } else if (expr) {
        add('default', 'const', statement, { exported: true, signature: 'default' });
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier) {
        const spec = statement.moduleSpecifier.text;
        const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((e) => ({ exported: e.name.text, imported: (e.propertyName || e.name).text }))
          : [];
        analysis.reexports.push({ spec, names, all: !statement.exportClause });
        for (const n of names) analysis.exports.push(n.exported);
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exportedLocals.add((element.propertyName || element.name).text);
          analysis.exports.push(element.name.text);
        }
      }
    } else if (ts.isExpressionStatement(statement)) {
      const call = unwrap(ts, statement.expression);
      if (call && ts.isCallExpression(call)) {
        const plain = plainChain(calleeChain(ts, call.expression));
        const fn = [...call.arguments].reverse().map((a) => unwrap(ts, a)).find((a) => isFunctionLike(ts, a));
        let routePath = null;
        let current = call;
        while (current && ts.isCallExpression(current)) {
          const literal = literalText(ts, current.arguments[0]);
          if (literal && (literal.startsWith('/') || literal === '*')) routePath = literal;
          const callee = unwrap(ts, current.expression);
          current = callee && ts.isPropertyAccessExpression(callee) ? unwrap(ts, callee.expression) : null;
        }
        if (fn && routePath && plain.length >= 2) {
          const verb = plain[plain.length - 1];
          const name = `${plain[0]}.${verb} ${routePath}`;
          if (!entries.some((e) => e.symbol.name === name)) {
            add(name, 'function', statement, { fn, exported: false, signature: signatureOf(ts, sf, `${verb.toUpperCase()} ${routePath}`, fn) });
          }
        }
      }
    } else if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && exported) {
      const word = ts.isInterfaceDeclaration(statement) ? 'interface' : ts.isEnumDeclaration(statement) ? 'enum' : 'type';
      add(statement.name.text, 'type', statement, { exported: true, skip: statement.name, signature: `${word} ${statement.name.text}` });
    }
  }

  for (const { symbol } of entries) {
    if (symbol.name.includes(' ')) continue;
    if (exportedLocals.has(symbol.name) || exportedLocals.has(symbol.name.split('.')[0])) {
      symbol.exported = true;
      symbol.requiresNote = NOTE_KINDS.has(symbol.kind);
    }
  }
  return entries;
}

function collectImports(ts, sf, analysis) {
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const entry = { spec: statement.moduleSpecifier.text, default: null, namespace: null, named: [], typeOnly: !!clause?.isTypeOnly };
      if (clause?.name) entry.default = clause.name.text;
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) entry.namespace = clause.namedBindings.name.text;
        else for (const el of clause.namedBindings.elements) entry.named.push({ local: el.name.text, imported: (el.propertyName || el.name).text, typeOnly: !!el.isTypeOnly });
      }
      analysis.imports.push(entry);
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
      const expr = statement.moduleReference.expression;
      if (ts.isStringLiteral(expr)) analysis.imports.push({ spec: expr.text, default: statement.name.text, namespace: null, named: [], typeOnly: false });
    }
  }
}

function importLocalsOf(analysis) {
  const locals = new Map();
  for (const imp of analysis.imports) {
    if (imp.default) locals.set(imp.default, { spec: imp.spec, imported: 'default' });
    if (imp.namespace) locals.set(imp.namespace, { spec: imp.spec, imported: '*' });
    for (const n of imp.named) locals.set(n.local, { spec: imp.spec, imported: n.imported });
  }
  return locals;
}

function topLevelNames(ts, sf) {
  const names = [];
  for (const statement of sf.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names.push(statement.name.text);
    else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
    }
  }
  return names;
}

function directivesOf(ts, statements) {
  const out = [];
  for (const statement of statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) out.push(statement.expression.text);
    else break;
  }
  return out;
}

function templateComponents(text, analysis) {
  const template = templateProjection(text);
  const seen = new Set();
  for (const m of template.matchAll(/<([A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)?)[\s/>]/g)) seen.add(m[1].split('.')[0]);
  for (const m of template.matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]/g)) {
    seen.add(m[1].split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join(''));
  }
  for (const tag of seen) analysis.jsx.push({ tag, symbol: 'default' });
  if (/<svelte:head>|<Head\b|<title>/.test(template)) analysis.metadata = true;
}

const BODY_READERS = new Set(['readBody', 'readValidatedBody', 'readMultipartFormData', 'readFormData', 'readRawBody']);
const BODY_METHODS = new Set(['json', 'formData', 'text', 'arrayBuffer', 'blob']);
const REQUEST_NAMES = new Set(['req', 'request', 'ctx', 'c', 'event', 'context']);
const CLIENT_FACTORY = /(^|\.)(axios|ky|ofetch|\$fetch|got|redaxios)\.(create|extend)$|^(createClient|hc|createTRPCProxyClient|createTRPCClient|createApiClient|createFetch)$/;
const ROUTER_CONFIG_CALLS = new Set(['createBrowserRouter', 'createHashRouter', 'createMemoryRouter', 'useRoutes', 'createRouter']);

function jsxAttribute(ts, element, name) {
  const attributes = element.attributes?.properties || [];
  return attributes.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name) || null;
}

function jsxTagOf(ts, node) {
  const expr = node && ts.isJsxExpression(node) ? unwrap(ts, node.expression) : unwrap(ts, node);
  if (!expr) return null;
  if (ts.isJsxSelfClosingElement(expr)) return expr.tagName.getText();
  if (ts.isJsxElement(expr)) return expr.openingElement.tagName.getText();
  return null;
}

function joinRoutePath(prefix, segment) {
  if (!segment) return prefix || '/';
  if (segment.startsWith('/')) return segment;
  return `${(prefix || '').replace(/\/$/, '')}/${segment}`;
}

function collectRouteObjects(ts, sf, arrayNode, prefix, out) {
  const arr = unwrap(ts, arrayNode);
  if (!arr || !ts.isArrayLiteralExpression(arr)) return;
  for (const element of arr.elements) {
    const obj = unwrap(ts, element);
    if (!obj || !ts.isObjectLiteralExpression(obj)) continue;
    const pathProp = obj.properties.find((p) => ts.isPropertyAssignment(p) && propName(ts, sf, p.name) === 'path');
    const routePath = pathProp ? literalText(ts, pathProp.initializer) : null;
    const full = routePath != null ? joinRoutePath(prefix, routePath) : prefix;
    let component = null;
    let importSpec = null;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propName(ts, sf, prop.name);
      const value = unwrap(ts, prop.initializer);
      if (key === 'element') component = jsxTagOf(ts, value);
      if ((key === 'Component' || key === 'component') && value) {
        if (ts.isIdentifier(value)) component = value.text;
        else if (isFunctionLike(ts, value)) {
          const found = /import\(\s*['"]([^'"]+)['"]\s*\)/.exec(value.getText(sf));
          if (found) importSpec = found[1];
        }
      }
      if (key === 'lazy' && value && isFunctionLike(ts, value)) {
        const found = /import\(\s*['"]([^'"]+)['"]\s*\)/.exec(value.getText(sf));
        if (found) importSpec = found[1];
      }
    }
    if (routePath != null && (component || importSpec)) out.push({ path: full, component, importSpec });
    const children = obj.properties.find((p) => ts.isPropertyAssignment(p) && propName(ts, sf, p.name) === 'children');
    if (children) collectRouteObjects(ts, sf, children.initializer, full, out);
  }
}

export function analyzeFile(ts, rel, text, { tags = [], validationMarkers = [], authMarkers = [], serverCapable = true, autoImports = false } = {}) {
  const analysis = emptyAnalysis(rel);
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.prisma') {
    analysis.schema = parsePrisma(text);
    return analysis;
  }
  if (ext === '.sql') {
    analysis.schema = parseSqlSchema(text);
    return analysis;
  }
  if (ext === '.graphql' || ext === '.gql') return analysis;
  if (!CODE_EXTENSIONS.has(ext)) return analysis;

  const sfc = SFC_EXTENSIONS.has(ext);
  const projection = sfc ? scriptProjection(text) : null;
  const sf = sfc ? createSource(ts, `${rel}.${projection.lang}`, projection.text, projection.lang) : createSource(ts, rel, text);
  analysis.parseDiagnostics = sf.parseDiagnostics?.length || 0;
  analysis.directives = directivesOf(ts, sf.statements);
  collectImports(ts, sf, analysis);
  analysis.locals = topLevelNames(ts, sf);
  const entries = collectSymbols(ts, sf, rel, analysis);
  analysis.symbols = entries.map((e) => e.symbol);

  if (sfc && !analysis.symbols.some((s) => s.name === 'default')) {
    const base = path.basename(rel, ext).replace(/(^|[-_.[\]])([a-z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
    const lines = text.split('\n').length;
    analysis.symbols.unshift({
      name: 'default',
      kind: 'component',
      exported: true,
      signature: `<${base || 'Component'}> ${ext.slice(1)} component`,
      line: 1,
      endLine: lines,
      lines,
      hash: short(text.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim()),
      calls: [],
      db: [],
      requiresNote: true,
    });
    templateComponents(text, analysis);
  }

  const nodeToSymbol = new Map(entries.map((e) => [e.node, e.symbol]));
  const symbolStack = [];
  const paramStack = [];
  const importLocals = importLocalsOf(analysis);
  const topLevel = new Set([...analysis.symbols.filter((s) => !s.name.includes(' ')).map((s) => s.name.split('.')[0]), ...analysis.locals]);
  const rpcRoots = new Set(['trpc', 'api', 'client']);
  for (const [local, info] of importLocals) if (/trpc|rpc/i.test(info.spec) || /trpc/i.test(local)) rpcRoots.add(local);
  const defaultSymbol = analysis.symbols.find((s) => s.name === 'default');

  const consts = collectConsts(ts, sf);
  const clientReceivers = new Set();
  for (const [name, init] of consts) {
    const value = unwrap(ts, init);
    if (value && ts.isCallExpression(value) && CLIENT_FACTORY.test(plainChain(calleeChain(ts, value.expression)).join('.'))) clientReceivers.add(name);
  }
  if (/(^|\/)(server|db|database|data|stores?|lib\/server)\//.test(rel) || /\.server\./.test(rel)) {
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer ? unwrap(ts, decl.initializer) : null;
        if (!init || !ts.isIdentifier(decl.name)) continue;
        if (ts.isArrayLiteralExpression(init)) analysis.stores.push({ name: decl.name.text, kind: 'array' });
        else if (ts.isNewExpression(init) && /^(Map|Set|WeakMap)$/.test(init.expression.getText(sf))) analysis.stores.push({ name: decl.name.text, kind: init.expression.getText(sf).toLowerCase() });
      }
    }
  }
  const markerCalls = new Set([...authMarkers, ...BODY_READERS, 'getValidatedQuery', 'getValidatedRouterParams', ...validationMarkers.filter((m) => m.length > 5)]);

  const ctx = {
    analysis,
    tags,
    sf,
    serverCapable,
    clientReceivers,
    consts,
    rpcRoots,
    importLocals,
    topLevel,
    validationMarkers: new Set(validationMarkers),
    repos: new Map(),
    line: (node) => nodeLine(sf, node),
    currentSymbol: () => (symbolStack.length ? symbolStack[symbolStack.length - 1].name : null),
    params: () => (paramStack.length ? paramStack[paramStack.length - 1] : new Map()),
  };

  const currentSymbolObject = () => (symbolStack.length ? symbolStack[symbolStack.length - 1] : sfc ? defaultSymbol : null);

  const addDb = (access) => {
    const symbol = currentSymbolObject();
    const target = symbol ? symbol.db : analysis.fileDb;
    if (!target.some((d) => d.op === access.op && d.entity === access.entity)) target.push(access);
  };

  const addEnv = (name, node) => {
    if (!name || !/^[A-Z0-9_]+$/i.test(name)) return;
    analysis.env.push({ name, line: nodeLine(sf, node), symbol: ctx.currentSymbol() });
  };

  const handleCall = (call) => {
    const expr = call.expression;
    if (expr.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = literalText(ts, call.arguments[0]);
      if (spec) analysis.imports.push({ spec, default: null, namespace: null, named: [], typeOnly: false, dynamic: true });
      return;
    }
    const chain = calleeChain(ts, expr);
    const plain = plainChain(chain);
    if (plain.length === 1 && plain[0] === 'require') {
      const spec = literalText(ts, call.arguments[0]);
      if (spec) analysis.imports.push({ spec, default: null, namespace: null, named: [], typeOnly: false, dynamic: true });
      return;
    }
    if (METADATA_CALLS.has(plain[plain.length - 1])) analysis.metadata = true;
    const symbol = currentSymbolObject();
    if (symbol && ['useActionState', 'useFormState', 'startTransition'].includes(plain[plain.length - 1])) {
      const ref = unwrap(ts, call.arguments[0]);
      if (ref && ts.isIdentifier(ref) && (importLocals.has(ref.text) || topLevel.has(ref.text)) && !symbol.calls.includes(ref.text)) symbol.calls.push(ref.text);
    }
    if (!inspectRouteCall(ts, sf, call, ctx)) {
      const client = inspectClientCall(ts, sf, call, ctx);
      if (client) {
        client.symbol = symbol?.name || null;
        if (client.kind === 'rpc') analysis.rpcCalls.push(client);
        else analysis.http.push(client);
      }
      const invocation = inspectInvocation(ts, call, ctx);
      if (invocation) {
        invocation.symbol = symbol?.name || null;
        analysis.invocations.push(invocation);
      }
    }
    for (const access of inspectDbCall(ts, sf, call, ctx)) addDb(access);
    const lastName = plain[plain.length - 1];
    if (symbol && (BODY_READERS.has(lastName) || (BODY_METHODS.has(lastName) && REQUEST_NAMES.has(plain[0]) && plain.length <= 3))) symbol.readsBody = true;
    if (ROUTER_CONFIG_CALLS.has(lastName) && call.arguments[0]) {
      const first = unwrap(ts, call.arguments[0]);
      if (first && ts.isArrayLiteralExpression(first)) collectRouteObjects(ts, sf, first, '', analysis.jsxRoutes);
      else if (first && ts.isObjectLiteralExpression(first)) {
        const routesProp = first.properties.find((p) => ts.isPropertyAssignment(p) && propName(ts, sf, p.name) === 'routes');
        if (routesProp) collectRouteObjects(ts, sf, routesProp.initializer, '', analysis.jsxRoutes);
      }
    }
    if (symbol && plain.length) {
      const root = plain[0];
      let display = null;
      if (root === 'this' && plain.length >= 2) display = plain.slice(1, 4).join('.');
      else if (importLocals.has(root) || topLevel.has(root)) display = plain.slice(0, 3).join('.');
      else if (plain.length === 1 && (markerCalls.has(root) || (autoImports && /^use[A-Z0-9]/.test(root)))) display = root;
      if (display && display !== symbol.name && !symbol.calls.includes(display) && symbol.calls.length < 16) symbol.calls.push(display);
    }
  };

  const visit = (node) => {
    const symbol = nodeToSymbol.get(node);
    if (symbol) symbolStack.push(symbol);
    const fnLike = isFunctionLike(ts, node) || ts.isConstructorDeclaration(node);
    if (fnLike) {
      paramStack.push(new Map((node.parameters || []).map((p, i) => [ts.isIdentifier(p.name) ? p.name.text : `#${i}`, i])));
      const body = node.body;
      if (body && ts.isBlock(body) && directivesOf(ts, body.statements).includes('use server')) {
        analysis.inlineActions.push(ctx.currentSymbol() || `anonymous@${nodeLine(sf, node)}`);
      }
    }

    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const repos = repositoryParams(ts, sf, node);
      for (const [k, v] of repos) ctx.repos.set(k, v);
      const entity = inspectEntityClass(ts, sf, node);
      if (entity) analysis.tables.push(entity);
      inspectNestClass(ts, sf, node, ctx);
    } else if (ts.isVariableDeclaration(node)) {
      const statement = node.parent?.parent;
      const exported = !!statement && hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword);
      inspectReceiverDeclaration(ts, sf, node, ctx);
      inspectRouterDeclaration(ts, sf, node, exported, ctx);
      const table = inspectTableDeclaration(ts, sf, node);
      if (table) analysis.tables.push(table);
      if (ts.isObjectBindingPattern(node.name) && node.initializer) {
        const init = plainChain(calleeChain(ts, node.initializer)).join('.');
        if (init === 'process.env' || /import\.meta\.env$|\?\.env$/.test(init) || node.initializer.getText(sf) === 'import.meta.env') {
          for (const el of node.name.elements) addEnv(propName(ts, sf, el.propertyName || el.name), el);
        }
      }
      if (exported && ts.isIdentifier(node.name) && node.name.text === 'config' && /middleware\.(t|j)s$/.test(rel)) {
        const matcher = unwrap(ts, node.initializer);
        const value = matcher && ts.isObjectLiteralExpression(matcher) ? matcher.properties.find((p) => p.name && propName(ts, sf, p.name) === 'matcher') : null;
        if (value && ts.isPropertyAssignment(value)) {
          const v = unwrap(ts, value.initializer);
          const list = v && ts.isArrayLiteralExpression(v) ? v.elements.map((e) => literalText(ts, e)).filter(Boolean) : [literalText(ts, v)].filter(Boolean);
          analysis.middlewareMatchers = list;
        }
      }
      if (exported && ts.isIdentifier(node.name) && METADATA_EXPORTS.has(node.name.text)) analysis.metadata = true;
    } else if (ts.isFunctionDeclaration(node) && node.name && METADATA_EXPORTS.has(node.name.text) && hasModifier(ts, node, ts.SyntaxKind.ExportKeyword)) {
      analysis.metadata = true;
    }

    if (ts.isCallExpression(node)) {
      handleCall(node);
    } else if (ts.isPropertyAccessExpression(node)) {
      const inner = node.expression;
      if (node.name.text === 'body') {
        const bodyChain = plainChain(calleeChain(ts, node));
        const owner = currentSymbolObject();
        if (owner && REQUEST_NAMES.has(bodyChain[0]) && bodyChain.length <= 3) owner.readsBody = true;
      }
      if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'env') {
        const base = inner.expression;
        if ((ts.isIdentifier(base) && (base.text === 'process' || base.text === 'Bun')) || ts.isMetaProperty(base)) addEnv(node.name.text, node);
      }
    } else if (ts.isElementAccessExpression(node)) {
      const inner = node.expression;
      if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'env' && ts.isIdentifier(inner.expression) && inner.expression.text === 'process') {
        addEnv(literalText(ts, node.argumentExpression), node);
      }
    } else if (ts.isJsxAttribute(node) && ['action', 'formAction'].includes(node.name.getText(sf))) {
      const init = node.initializer;
      const expr = init && ts.isJsxExpression(init) ? unwrap(ts, init.expression) : null;
      const symbol = currentSymbolObject();
      if (symbol && expr && ts.isIdentifier(expr) && (importLocals.has(expr.text) || topLevel.has(expr.text)) && !symbol.calls.includes(expr.text)) symbol.calls.push(expr.text);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (HEAD_TAGS.has(tag)) analysis.metadata = true;
      if (tag === 'Route') {
        const pathAttr = jsxAttribute(ts, node, 'path');
        const own = pathAttr?.initializer ? (ts.isStringLiteral(pathAttr.initializer) ? pathAttr.initializer.text : literalText(ts, pathAttr.initializer.expression)) : null;
        const indexRoute = !!jsxAttribute(ts, node, 'index');
        const elementAttr = jsxAttribute(ts, node, 'element');
        const componentAttr = jsxAttribute(ts, node, 'Component') || jsxAttribute(ts, node, 'component');
        const component = elementAttr?.initializer ? jsxTagOf(ts, elementAttr.initializer) : componentAttr?.initializer && ts.isJsxExpression(componentAttr.initializer) ? componentAttr.initializer.expression?.getText(sf) : null;
        const prefixes = [];
        let parent = ts.isJsxOpeningElement(node) ? node.parent.parent : node.parent;
        while (parent) {
          if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(sf) === 'Route') {
            const p = jsxAttribute(ts, parent.openingElement, 'path');
            const value = p?.initializer ? (ts.isStringLiteral(p.initializer) ? p.initializer.text : literalText(ts, p.initializer.expression)) : null;
            if (value) prefixes.unshift(value);
          }
          parent = parent.parent;
        }
        const prefix = prefixes.reduce((acc, seg) => joinRoutePath(acc, seg), '');
        if ((own != null || indexRoute) && component) analysis.jsxRoutes.push({ path: joinRoutePath(prefix, own ?? ''), component, importSpec: null });
      }
      if (/^[A-Z]/.test(tag) || tag.includes('.')) {
        const root = tag.split('.')[0];
        const sym = ctx.currentSymbol();
        if (!analysis.jsx.some((j) => j.tag === root && j.symbol === sym)) analysis.jsx.push({ tag: root, symbol: sym });
      }
    } else if (ts.isTaggedTemplateExpression(node)) {
      const tag = plainChain(calleeChain(ts, node.tag)).pop();
      const template = node.template;
      const raw = ts.isNoSubstitutionTemplateLiteral(template) ? template.text : template.head.text + template.templateSpans.map((s) => ` ${s.literal.text}`).join('');
      if (tag === 'gql' || tag === 'graphql') for (const op of gqlOperations(raw)) analysis.gqlOps.push({ ...op, symbol: ctx.currentSymbol(), line: nodeLine(sf, node) });
      else for (const access of inspectSqlText(raw)) addDb(access);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const raw = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((s) => ` ${s.literal.text}`).join('') : node.text;
      if (raw.length > 12) for (const access of inspectSqlText(raw)) addDb(access);
    } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]]) {
        const chain = plainChain(calleeChain(ts, a));
        const literal = literalText(ts, b);
        if (chain[chain.length - 1] === 'method' && literal && /^[A-Z]+$/.test(literal) && !analysis.methodChecks.includes(literal)) analysis.methodChecks.push(literal);
      }
    } else if (ts.isCaseClause(node)) {
      const sw = node.parent?.parent;
      const literal = literalText(ts, node.expression);
      if (sw && ts.isSwitchStatement(sw) && plainChain(calleeChain(ts, sw.expression)).pop() === 'method' && literal && /^[A-Z]+$/.test(literal) && !analysis.methodChecks.includes(literal)) {
        analysis.methodChecks.push(literal);
      }
    }

    ts.forEachChild(node, visit);
    if (fnLike) paramStack.pop();
    if (symbol) symbolStack.pop();
  };
  visit(sf);

  for (const imp of analysis.imports) {
    if (imp.spec.startsWith('$env/')) for (const n of imp.named) analysis.env.push({ name: n.imported, line: 1, symbol: null, module: imp.spec });
  }

  if (analysis.directives.includes('use server')) {
    for (const symbol of analysis.symbols) {
      if (symbol.exported && ['function', 'wrapped'].includes(symbol.kind)) analysis.routes.push({ kind: 'action', method: 'ACTION', path: null, name: symbol.name, symbol: symbol.name, framework: 'server-action' });
    }
  }
  for (const name of analysis.inlineActions) {
    analysis.routes.push({ kind: 'action', method: 'ACTION', path: null, name, symbol: name, framework: 'server-action' });
  }

  const fsRoutes = fileRoutes(rel, analysis, tags);
  analysis.routes.push(...fsRoutes.routes);
  analysis.pages.push(...fsRoutes.pages);
  analysis.layouts.push(...fsRoutes.layouts);
  return analysis;
}
