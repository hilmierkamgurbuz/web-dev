import { sha256 } from './hash.mjs';

export const REQUIRED_HEADINGS = ['Request (verbatim)', 'Understanding', 'Decisions', 'Acceptance', 'Risk', 'Verification', 'Git', 'Manifest'];

const BRANCH_RE = /^(feat|fix|refactor|perf|test|docs|chore)\/[a-z0-9][a-z0-9-]*$/;

function splitSections(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  return sections;
}

function fieldBlock(lines, label) {
  const start = lines.findIndex((l) => new RegExp(`^-\\s*${label}\\s*:`, 'i').test(l));
  if (start === -1) return null;
  const first = lines[start].replace(new RegExp(`^-\\s*${label}\\s*:\\s*`, 'i'), '').trim();
  const values = [];
  if (first && first !== '-') values.push(...first.split(/\s*;\s*/).filter(Boolean));
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s+-\s+/.test(line)) values.push(line.replace(/^\s+-\s+/, '').trim());
    else if (/^\S/.test(line) || line.trim() === '') break;
  }
  return values.filter((v) => v && v !== '-');
}

function stripCode(value) {
  return value.replace(/^`|`$/g, '').trim();
}

export function packageNameOf(spec) {
  const clean = stripCode(spec.split('|')[0].trim());
  if (clean.startsWith('@')) {
    const at = clean.indexOf('@', 1);
    return at === -1 ? clean : clean.slice(0, at);
  }
  const at = clean.indexOf('@');
  return at === -1 ? clean : clean.slice(0, at);
}

export function parseBrief(text) {
  const sections = splitSections(text);
  const get = (name) => sections.get(name) || [];
  const title = (/^#\s+Brief:\s*(.+)$/m.exec(text) || [])[1]?.trim() || '';
  const manifest = [];
  const generated = [];
  for (const line of get('Manifest')) {
    const m = /^-\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = stripCode(m[1]);
    const gen = /^generated:\s*(.+)$/i.exec(value);
    if (gen) generated.push(stripCode(gen[1]));
    else if (value !== '-') manifest.push(value.replace(/^\.\//, ''));
  }
  const risk = get('Risk');
  const verification = get('Verification');
  const understanding = get('Understanding');
  const exceptions = (fieldBlock(risk, 'Security exceptions') || []).map((entry) => {
    const [rule, file, ...reason] = entry.split('|').map((s) => stripCode(s.trim()));
    return { rule, path: (file || '').replace(/^\.\//, ''), reason: reason.join(' | ') };
  }).filter((e) => e.rule && e.path);
  const dependencies = (fieldBlock(risk, 'Dependencies') || []).map(packageNameOf).filter(Boolean);
  const migrations = fieldBlock(risk, 'Migrations') || [];
  const testsLine = verification.find((l) => /^-\s*Tests\s*:/i.test(l)) || '';
  const responsive = (fieldBlock(verification, 'Responsive') || [])
    .flatMap((v) => v.split(/\s*,\s*/))
    .map((v) => stripCode(v).split(/\s+/)[0])
    .filter((v) => v.startsWith('/'));
  const branch = (/^-\s*Branch:\s*`?([^\s`]+)`?/m.exec(get('Git').join('\n')) || [])[1] || '';
  const durable = [...new Set((get('Durable').join('\n').match(/\b[DR]-\d{3,}\b/g) || []))];
  const goal = ((understanding.find((l) => /^-\s*Goal\s*:/i.test(l)) || '').replace(/^-\s*Goal\s*:\s*/i, '')).trim();
  const acceptance = get('Acceptance').filter((l) => /^-\s*\[[ xX]\]/.test(l)).map((l) => l.replace(/^-\s*\[[ xX]\]\s*/, '').trim());
  return {
    title,
    goal,
    headings: [...sections.keys()],
    sections,
    manifest,
    generated,
    exceptions,
    dependencies,
    migrations,
    testsNone: /^-\s*Tests\s*:\s*`?none\b/i.test(testsLine),
    responsive,
    branch,
    durable,
    acceptance,
    hasOpen: /\[OPEN\]/.test(text),
  };
}

export function decisionsDigest(brief) {
  return sha256((brief.sections?.get('Decisions') || []).join('\n').trim());
}

function words(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-zçğıöşü0-9]{3,}/gi) || []);
}

function overlaps(a, b) {
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

export function decisionsBacked(brief, questions) {
  const lines = brief.sections?.get('Decisions') || [];
  const asked = (questions || []).map((q) => ({
    question: words(q.question),
    answer: words(q.chosen || ''),
  }));
  const unbacked = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^-\s*Q:\s*(.+?)\s*→\s*A:\s*(.+?)\s*·\s*by:\s*user\s*$/i.exec(line);
    if (!m) continue;
    const qWords = words(m[1]);
    const aWords = words(m[2]);
    const backed = asked.some((entry) => overlaps(entry.question, qWords) && (!aWords.size || overlaps(entry.answer, aWords)));
    if (!backed) unbacked.push(line);
  }
  return unbacked;
}

export function validateBrief(brief, questions = null) {
  const problems = [];
  const harness = (brief.manifest || []).filter((rel) => /^(\.claude\/|CLAUDE\.md$|CLAUDE\.local\.md$)/.test(rel));
  if (harness.length) problems.push(`the manifest lists harness path(s) ${harness.join(', ')}: harness documents never need listing, and the files that decide what is enforced are changed only by the user`);
  for (const heading of REQUIRED_HEADINGS) if (!brief.headings.includes(heading)) problems.push(`missing heading "## ${heading}"`);
  if (!brief.title) problems.push('missing "# Brief: <task name>" title');
  if (brief.hasOpen) problems.push('brief still contains [OPEN]');
  if (!brief.branch) problems.push('missing "- Branch:" line under ## Git');
  else if (!BRANCH_RE.test(brief.branch)) problems.push(`branch "${brief.branch}" must match <feat|fix|refactor|perf|test|docs|chore>/<kebab-slug>`);
  if (!brief.manifest.length && !brief.generated.length) problems.push('## Manifest lists no paths');
  if (!brief.acceptance.length) problems.push('## Acceptance has no "- [ ]" criteria');
  if (questions) for (const line of decisionsBacked(brief, questions)) problems.push(`decision has no recorded question backing it: "${line}"`);
  return problems;
}
