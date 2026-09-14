const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

function blank(text, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += text[i] === '\n' ? '\n' : ' ';
  return out;
}

export function scriptBlocks(text) {
  const blocks = [];
  SCRIPT_RE.lastIndex = 0;
  let match;
  while ((match = SCRIPT_RE.exec(text))) {
    const attrs = match[1] || '';
    const lang = (/\blang\s*=\s*["']?(tsx|ts|jsx|js)["']?/i.exec(attrs) || [])[1] || 'js';
    const start = match.index + match[0].indexOf('>') + 1;
    blocks.push({
      start,
      end: start + match[2].length,
      lang: lang.toLowerCase(),
      setup: /\bsetup\b/.test(attrs),
      module: /context\s*=\s*["']module["']|\bmodule\b/.test(attrs),
    });
  }
  return blocks;
}

export function scriptProjection(text) {
  const blocks = scriptBlocks(text);
  let out = '';
  let cursor = 0;
  for (const block of blocks) {
    out += blank(text, cursor, block.start);
    out += text.slice(block.start, block.end);
    cursor = block.end;
  }
  out += blank(text, cursor, text.length);
  const lang = blocks.some((b) => b.lang.startsWith('ts')) ? 'ts' : 'js';
  return { text: out, lang, blocks };
}

export function templateProjection(text) {
  let out = text;
  for (const re of [SCRIPT_RE, STYLE_RE]) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => m.replace(/[^\n]/g, ' '));
  }
  return out;
}

export function styleBlocks(text) {
  const blocks = [];
  STYLE_RE.lastIndex = 0;
  let match;
  while ((match = STYLE_RE.exec(text))) {
    const open = match[0].indexOf('>') + 1;
    blocks.push({ start: match.index + open, end: match.index + match[0].lastIndexOf('</style>') });
  }
  return blocks;
}
