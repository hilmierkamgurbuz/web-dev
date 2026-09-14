const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function bracketSegment(segment) {
  if (/^\[\[\.\.\..+\]\]$/.test(segment) || /^\[\.\.\..+\]$/.test(segment)) return '{*}';
  if (/^\[\[.+\]\]$/.test(segment) || /^\[.+\]$/.test(segment)) return '{}';
  return segment;
}

function toPath(segments) {
  return `/${segments.filter(Boolean).join('/')}`;
}

function nextSegments(dir) {
  const out = [];
  for (const raw of dir.split('/').filter(Boolean)) {
    if (/^\(.*\)$/.test(raw) && !/^\(\.{1,3}\)/.test(raw)) continue;
    if (raw.startsWith('@')) continue;
    if (raw.startsWith('_')) return null;
    out.push(bracketSegment(raw.replace(/^\(\.{1,3}\)/, '')));
  }
  return out;
}

function exportedNames(analysis) {
  return new Set(analysis.symbols.filter((s) => s.exported).map((s) => s.name).concat(analysis.exports || []));
}

function nextApp(rel, analysis, out) {
  const m = /(?:^|\/)app\/((?:[^/]+\/)*)(route|page|layout|default|loading|error|not-found)\.(tsx|ts|jsx|js|mdx)$/.exec(rel);
  if (!m) return false;
  const segments = nextSegments(m[1]);
  if (!segments) return true;
  const path = toPath(segments);
  const names = exportedNames(analysis);
  if (m[2] === 'route') {
    for (const method of HTTP_METHODS) if (names.has(method)) out.routes.push({ kind: 'http', method, path, symbol: method, framework: 'next' });
  } else if (m[2] === 'page') {
    out.pages.push({ path, symbol: 'default', framework: 'next' });
  } else if (m[2] === 'layout') {
    out.layouts.push({ path, symbol: 'default', framework: 'next' });
  }
  return true;
}

function nextPages(rel, analysis, out) {
  const m = /(?:^|\/)pages\/(.+)\.(tsx|ts|jsx|js)$/.exec(rel);
  if (!m) return false;
  const parts = m[1].split('/');
  if (parts.some((p) => p.startsWith('_')) || ['404', '500'].includes(parts[0])) return true;
  if (parts[parts.length - 1] === 'index') parts.pop();
  const segments = parts.map(bracketSegment);
  const path = toPath(segments);
  if (segments[0] === 'api') {
    const methods = analysis.methodChecks?.length ? analysis.methodChecks : ['ANY'];
    for (const method of methods) out.routes.push({ kind: 'http', method, path, symbol: 'default', framework: 'next-pages' });
  } else {
    out.pages.push({ path, symbol: 'default', framework: 'next-pages' });
  }
  return true;
}

function sveltekit(rel, analysis, out) {
  const m = /(?:^|\/)src\/routes\/((?:[^/]+\/)*)\+(server|page\.server|page|layout\.server|layout)\.(ts|js|svelte)$/.exec(rel);
  if (!m) return false;
  const segments = m[1].split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s)).map(bracketSegment);
  const path = toPath(segments);
  const names = exportedNames(analysis);
  if (m[2] === 'server') {
    for (const method of HTTP_METHODS) if (names.has(method)) out.routes.push({ kind: 'http', method, path, symbol: method, framework: 'sveltekit' });
    if (names.has('fallback')) out.routes.push({ kind: 'http', method: 'ANY', path, symbol: 'fallback', framework: 'sveltekit' });
  } else if (m[2] === 'page.server') {
    for (const action of analysis.actionsKeys || []) {
      out.routes.push({ kind: 'action', method: 'POST', path: action === 'default' ? path : `${path}?/${action}`, symbol: `actions.${action}`, name: action, framework: 'sveltekit' });
    }
  } else if (m[2] === 'page') {
    out.pages.push({ path, symbol: 'default', framework: 'sveltekit' });
  } else if (m[2] === 'layout') {
    out.layouts.push({ path, symbol: 'default', framework: 'sveltekit' });
  }
  return true;
}

function nuxt(rel, analysis, out) {
  const api = /(?:^|\/)server\/(api|routes)\/(.+)\.(ts|js|mjs)$/.exec(rel);
  if (api) {
    let name = api[2];
    let method = 'ANY';
    const suffix = /\.(get|post|put|patch|delete|head|options)$/i.exec(name);
    if (suffix) {
      method = suffix[1].toUpperCase();
      name = name.slice(0, -suffix[0].length);
    }
    const parts = name.split('/');
    if (parts[parts.length - 1] === 'index') parts.pop();
    const segments = parts.map(bracketSegment);
    const path = api[1] === 'api' ? toPath(['api', ...segments]) : toPath(segments);
    out.routes.push({ kind: 'http', method, path, symbol: 'default', framework: 'nuxt' });
    return true;
  }
  const page = /(?:^|\/)pages\/(.+)\.vue$/.exec(rel);
  if (page) {
    const parts = page[1].split('/');
    if (parts[parts.length - 1] === 'index') parts.pop();
    out.pages.push({ path: toPath(parts.map(bracketSegment)), symbol: 'default', framework: 'nuxt' });
    return true;
  }
  const layout = /(?:^|\/)layouts\/(.+)\.vue$/.exec(rel);
  if (layout) {
    out.layouts.push({ path: `layout:${layout[1]}`, symbol: 'default', framework: 'nuxt' });
    return true;
  }
  return false;
}

function remixSegment(segment) {
  if (segment === '_index') return null;
  if (segment.startsWith('_')) return null;
  if (segment === '$') return '{*}';
  let s = segment.replace(/_$/, '').replace(/^\((.*)\)$/, '$1').replace(/\[(.+?)\]/g, '$1');
  if (s.startsWith('$')) return '{}';
  return s;
}

function remix(rel, analysis, out) {
  const m = /(?:^|\/)app\/routes\/([^/]+?)(?:\/route)?\.(tsx|ts|jsx|js)$/.exec(rel);
  if (!m) return false;
  const segments = m[1].split('.').map(remixSegment).filter((s) => s !== null);
  const path = toPath(segments);
  const names = exportedNames(analysis);
  if (names.has('loader')) out.routes.push({ kind: 'http', method: 'GET', path, symbol: 'loader', framework: 'remix' });
  if (names.has('action')) out.routes.push({ kind: 'action', method: 'POST', path, symbol: 'action', name: 'action', framework: 'remix' });
  if (names.has('default')) out.pages.push({ path, symbol: 'default', framework: 'remix' });
  return true;
}

export function fileRoutes(rel, analysis, tags) {
  const out = { routes: [], pages: [], layouts: [] };
  if (rel.includes('node_modules/')) return out;
  const has = (t) => tags.includes(t);
  if ((has('remix') || has('react-router')) && remix(rel, analysis, out)) return out;
  if (has('sveltekit') && sveltekit(rel, analysis, out)) return out;
  if (has('nuxt') && nuxt(rel, analysis, out)) return out;
  if (has('next')) {
    if (nextApp(rel, analysis, out)) return out;
    nextPages(rel, analysis, out);
  }
  return out;
}
