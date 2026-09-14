import { normalizeServerPath } from '../extract/ast.mjs';
import { readText } from './io.mjs';
import { layout } from './paths.mjs';

const ROUTE_KINDS = new Set(['PAGE', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY', 'ACTION', 'QUERY', 'MUTATION', 'SUBSCRIPTION', 'GQL']);

function sections(text) {
  const map = new Map();
  let current = null;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^```/.test(line)) inFence = !inFence;
    const heading = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      map.set(current, []);
    } else if (current) {
      map.get(current).push(line);
    }
  }
  return map;
}

function splitDash(value) {
  const m = /^(.+?)\s+[—–]\s+(.*)$/.exec(value) || /^(.+?)\s+-\s+(.*)$/.exec(value);
  return m ? [m[1].trim(), m[2].trim()] : [value.trim(), ''];
}

export function parseBlueprint(text) {
  const result = { features: [], routes: [], tables: [], folders: [], present: text != null };
  if (text == null) return result;
  const map = sections(text);
  for (const line of map.get('features') || []) {
    const m = /^-\s+(.+)$/.exec(line);
    if (!m || m[1].includes('<')) continue;
    const [left, rest] = splitDash(m[1]);
    const depends = /→\s*depends on:\s*(.*)$/i.exec(rest);
    const deps = depends ? depends[1].split(',').map((d) => d.trim()).filter((d) => d && d !== '-') : [];
    result.features.push({ sys: left, responsibility: rest.replace(/→\s*depends on:.*$/i, '').trim(), deps });
  }
  for (const line of map.get('routes') || []) {
    const m = /^-\s+([A-Z]+)\s+(\S+)\s+[—–-]\s+(\S+)/.exec(line);
    if (!m || !ROUTE_KINDS.has(m[1]) || m[0].includes('<')) continue;
    const isPath = m[2].startsWith('/');
    result.routes.push({ kind: m[1], target: isPath ? normalizeServerPath(m[2].replace(/\[\.\.\.[^\]]+\]/g, '*').replace(/\[[^\]]+\]/g, ':p')) : m[2], sys: m[3] });
  }
  for (const line of map.get('tables') || []) {
    const m = /^-\s+(\S+)\s+[—–-]\s+owner:\s*(\S+)/.exec(line);
    if (m && !m[0].includes('<')) result.tables.push({ table: m[1], owner: m[2] });
  }
  const folderLines = [];
  let inFence = false;
  for (const line of map.get('folder layout') || []) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) folderLines.push(line);
  }
  const stack = [];
  for (const line of folderLines) {
    const m = /^(\s*)([^\s#][^\s]*?\/)(\s|$)/.exec(line);
    if (!m || m[2].includes('<')) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const full = [...stack.map((s) => s.name), m[2].replace(/\/$/, '')].join('/');
    stack.push({ indent, name: m[2].replace(/\/$/, '') });
    result.folders.push(full);
  }
  return result;
}

export function loadBlueprint(root) {
  return parseBlueprint(readText(layout(root).blueprint));
}

export function findCycles(features) {
  const graph = new Map(features.map((f) => [f.sys, f.deps]));
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 1) cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (!state.get(dep)) visit(dep);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.get(node)) visit(node);
  return cycles;
}
