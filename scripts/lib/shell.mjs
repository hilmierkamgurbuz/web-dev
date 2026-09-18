export function findHeredocOps(text) {
  const ops = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      let j = i + 2;
      let stripTabs = false;
      if (text[j] === '-') {
        stripTabs = true;
        j++;
      }
      while (text[j] === ' ' || text[j] === '\t') j++;
      let quoteChar = null;
      if (text[j] === "'" || text[j] === '"') {
        quoteChar = text[j];
        j++;
      }
      const start = j;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const terminator = text.slice(start, j);
      if (terminator && /^[A-Za-z_]/.test(terminator)) {
        if (quoteChar && text[j] === quoteChar) j++;
        ops.push({ stripTabs, quoted: !!quoteChar, terminator });
        i = j - 1;
      }
    }
  }
  return ops;
}

export function extractHeredocs(command) {
  const shellLines = [];
  const heredocs = [];
  const queue = [];
  let current = null;
  for (const line of command.split('\n')) {
    if (current) {
      const compare = (current.stripTabs ? line.replace(/^\t+/, '') : line).replace(/\r$/, '');
      if (compare === current.terminator) {
        heredocs.push({ terminator: current.terminator, quoted: current.quoted, stripTabs: current.stripTabs, body: current.lines.join('\n') });
        current = queue.shift() || null;
        continue;
      }
      current.lines.push(current.stripTabs ? line.replace(/^\t+/, '') : line);
      continue;
    }
    shellLines.push(line);
    for (const op of findHeredocOps(line)) queue.push({ ...op, lines: [] });
    if (queue.length) current = queue.shift();
  }
  if (current) heredocs.push({ terminator: current.terminator, quoted: current.quoted, stripTabs: current.stripTabs, body: current.lines.join('\n'), unterminated: true });
  for (const pending of queue) heredocs.push({ terminator: pending.terminator, quoted: pending.quoted, stripTabs: pending.stripTabs, body: pending.lines.join('\n'), unterminated: true });
  return { shell: shellLines.join('\n'), heredocs };
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
