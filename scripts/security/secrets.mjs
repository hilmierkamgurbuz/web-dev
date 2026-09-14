const PATTERNS = [
  { id: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-key', re: /aws.{0,20}secret.{0,20}['"][0-9a-zA-Z/+]{40}['"]/i },
  { id: 'github-token', re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { id: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'stripe-secret', re: /\b(sk|rk)_live_[0-9a-zA-Z]{24,}\b/ },
  { id: 'stripe-webhook-secret', re: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { id: 'openai-key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b|\bsk-proj-[A-Za-z0-9_-]{40,}\b/ },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, context: (text) => !/firebase|initializeApp|firebaseConfig/i.test(text) },
  { id: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { id: 'twilio-key', re: /\bSK[0-9a-fA-F]{32}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'private-key', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

const DB_URL = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql):\/\/([^:\s'"`/@]+):([^@\s'"`]+)@([^/\s'"`:]+)/i;
const GENERIC = /(api[_-]?key|secret|token|password|passwd|pwd|auth[_-]?key|credential|private[_-]?key|client[_-]?secret|access[_-]?key)["'`]?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;
const PLACEHOLDER = /(your|xxx|example|changeme|change_me|placeholder|dummy|fake|sample|redacted|<|>|\$\{|process\.env|import\.meta|\*\*\*|0000000|1234567|lorem|todo|replace|insert|here)/i;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|db|database|postgres|mysql|mongo|redis|host\.docker\.internal)$/i;
const WEAK_PASSWORDS = /^(postgres|password|pass|secret|root|admin|example|changeme|mysql|mongo|redis|user|test)$/i;

export function entropy(value) {
  const counts = new Map();
  for (const c of value) counts.set(c, (counts.get(c) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function addedLines(newText, oldText) {
  const lines = newText.split(/\r?\n/);
  if (oldText == null) return lines.map((text, i) => ({ text, line: i + 1 }));
  const old = new Map();
  for (const l of oldText.split(/\r?\n/)) old.set(l.trim(), (old.get(l.trim()) || 0) + 1);
  const out = [];
  lines.forEach((text, i) => {
    const key = text.trim();
    const count = old.get(key) || 0;
    if (count > 0) old.set(key, count - 1);
    else out.push({ text, line: i + 1 });
  });
  return out;
}

function redact(value) {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export function secretFindings(newText, { oldText = null, isTest = false } = {}) {
  const findings = [];
  for (const { text, line } of addedLines(newText, oldText)) {
    if (text.length > 2000) continue;
    for (const pattern of PATTERNS) {
      const m = pattern.re.exec(text);
      if (!m || (pattern.context && !pattern.context(newText))) continue;
      if (PLACEHOLDER.test(m[0]) && pattern.id !== 'private-key') continue;
      findings.push({ rule: 'WD-SEC-SECRET', line, message: `hardcoded credential (${pattern.id}: ${redact(m[0])})`, fix: 'read it from a server-only environment variable through the validated config module; rotate it if it was ever committed' });
    }
    const db = DB_URL.exec(text);
    if (db && !PLACEHOLDER.test(db[3]) && !(LOCAL_HOSTS.test(db[4]) && WEAK_PASSWORDS.test(db[3]))) {
      findings.push({ rule: 'WD-SEC-SECRET', line, message: `connection string with an embedded password (${db[1]}://${db[2]}:****@${db[4]})`, fix: 'move the URL into a server-only environment variable' });
    }
    if (!isTest) {
      const g = GENERIC.exec(text);
      if (g && !PLACEHOLDER.test(g[2]) && entropy(g[2]) >= 3.5 && !/^[a-z]+(\.[a-z]+)+$/i.test(g[2]) && !/^[A-Z0-9_]+$/.test(g[2])) {
        findings.push({ rule: 'WD-SEC-SECRET', line, message: `high-entropy value assigned to "${g[1]}" (${redact(g[2])})`, fix: 'read it from a server-only environment variable' });
      }
    }
  }
  return findings;
}

export function envFileFindings(text, { example }) {
  const findings = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(raw);
    if (!m) return;
    const key = m[1];
    const value = m[2].replace(/^["']|["']$/g, '').trim();
    if (/^(NEXT_PUBLIC_|VITE_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_)/.test(key) && /(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|ACCESS_KEY|CLIENT_SECRET)/.test(key) && !/(PUBLISHABLE|PUBLIC_KEY|SITE_KEY|ANON_KEY)/.test(key)) {
      findings.push({ rule: 'WD-SEC-PUBLIC-ENV', line: i + 1, message: `${key} exposes a secret-looking value to the browser bundle`, fix: 'drop the client-exposed prefix and read it on the server only' });
    }
    if (example && value && !PLACEHOLDER.test(value) && /(SECRET|PASSWORD|TOKEN|KEY|PRIVATE|CREDENTIAL)/.test(key) && entropy(value) >= 3) {
      findings.push({ rule: 'WD-SEC-SECRET', line: i + 1, message: `${key} in an example env file carries a real-looking value (${redact(value)})`, fix: 'leave the value empty or use a placeholder' });
    }
  });
  return findings;
}
