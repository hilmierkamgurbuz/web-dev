import { readJson } from './io.mjs';
import { layout } from './paths.mjs';

export const DEFAULT_SHARDS = [
  { name: 'tests', patterns: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', 'tests/**', 'e2e/**', 'test/**'] },
  { name: 'data', patterns: ['prisma/**', 'drizzle/**', '**/migrations/**', '**/db/**', '**/database/**', '**/models/**', '**/entities/**', '**/schema/**', '**/schemas/**'] },
  { name: 'server', patterns: ['server/**', '**/api/**', '**/controllers/**', '**/services/**', '**/middleware/**', '**/middlewares/**', '**/*.server.*', '**/+server.*', '**/trpc/**', '**/graphql/**', '**/resolvers/**'] },
  { name: 'ui', patterns: ['**/components/**', '**/app/**', '**/pages/**', '**/views/**', '**/layouts/**', '**/*.vue', '**/*.svelte', '**/*.tsx', '**/*.jsx'] },
  { name: 'client', patterns: ['**/hooks/**', '**/stores/**', '**/store/**', '**/composables/**', '**/state/**'] },
  { name: 'features', patterns: ['**/features/**', '**/modules/**', '**/domains/**'] },
  { name: 'shared', patterns: ['**/lib/**', '**/utils/**', '**/shared/**', '**/types/**', '**/config/**'] },
  { name: 'core', patterns: ['**'] },
];

const REGEX_SPECIAL = /[.+^$()|[\]\\]/g;
const compiled = new Map();

function escapeLiteral(text) {
  return text.replace(REGEX_SPECIAL, '\\$&');
}

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        out += `(?:${glob.slice(i + 1, end).split(',').map(escapeLiteral).join('|')})`;
        i = end;
      } else {
        out += '\\{';
      }
    } else {
      out += escapeLiteral(c);
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchGlob(rel, glob) {
  let re = compiled.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    compiled.set(glob, re);
  }
  return re.test(rel);
}

export function matchAny(rel, globs) {
  return (globs || []).some((glob) => matchGlob(rel, glob));
}

export function loadShards(root) {
  const data = readJson(layout(root).shards, null);
  const shards = Array.isArray(data?.shards) ? data.shards.filter((s) => s?.name && Array.isArray(s.patterns)) : [];
  return shards.length ? shards : DEFAULT_SHARDS;
}

export function shardOf(rel, shards) {
  for (const shard of shards) if (matchAny(rel, shard.patterns)) return shard.name;
  return shards[shards.length - 1].name;
}

export const DEFAULT_MAX_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function shardBudget(root) {
  const data = readJson(layout(root).shards, null);
  const n = Number(data?.maxTokens);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

export function splitByBudget(entries, maxTokens) {
  const parts = [[]];
  let used = 0;
  for (const entry of entries) {
    const part = parts[parts.length - 1];
    if (part.length && used + entry.tokens > maxTokens) {
      parts.push([]);
      used = 0;
    }
    parts[parts.length - 1].push(entry);
    used += entry.tokens;
  }
  return parts;
}

export function partName(base, index) {
  return index === 0 ? base : `${base}-${index + 1}`;
}
