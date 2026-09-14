export function stripHeredocs(command) {
  const out = [];
  let terminator = null;
  for (const line of command.split('\n')) {
    if (terminator) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (m) terminator = m[2];
  }
  return out.join('\n');
}

export function splitCommands(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      current += c;
      if (c === '\\' && quote === '"') {
        current += next ?? '';
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === '\n' || c === ';' || (c === '&' && next === '&') || (c === '|' && next === '|')) {
      segments.push(current);
      current = '';
      if (c === '&' || c === '|') i++;
    } else if (c === '|') {
      segments.push(current);
      current = '|';
    } else {
      current += c;
    }
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

export function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < segment.length) current += segment[++i];
      else current += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started || current) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (started || current) tokens.push(current);
  return tokens;
}

export function stripEnvPrefix(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (tokens[i] === 'sudo' || tokens[i] === 'env' || tokens[i] === 'command' || tokens[i] === 'exec') i++;
  return tokens.slice(i);
}
