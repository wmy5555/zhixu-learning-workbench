// Parse data, never execute exported component code or expressions.
export function eachLiteral(line) {
  const match = line.trim().match(/^\{#each\s+(\[.*\])\s+as\s+(\w+)(?:\s*,\s*(\w+))?\s*\}$/);
  if (!match) return null;
  try {
    // Some exports use unquoted object keys. Only quote keys outside strings.
    const json = match[1].split(/("(?:\\.|[^"\\])*")/g).map((part, i) => i % 2 ? part : part.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')).join('');
    const values = JSON.parse(json);
    if (values.length > 200 || values.some(v => typeof v !== 'string' && (!v || typeof v !== 'object' || Array.isArray(v)))) return null;
    return { values, name: match[2], index: match[3] };
  } catch { return null; }
}

export function literalState(line) {
  const match = line.trim().match(/^\{@body\s+const\s+\[(\w+),\s*\w+\]\s*=\s*DIL\.useState\((-?\d+(?:\.\d+)?)\)\s*;?\s*\}$/);
  return match ? { name: match[1], value: Number(match[2]) } : null;
}

export function staticNumber(expression, bindings) {
  if (expression.length > 256) return null;
  const fixed = expression.match(/\.toFixed\((\d{1,2})\)$/);
  const value = fixed ? expression.slice(0, -fixed[0].length) : expression;
  const tokens = value.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[()+*/-]/g) || [];
  if (tokens.join('') !== value.replace(/\s/g, '') || tokens.length > 128) return null;
  let cursor = 0;
  const factor = () => {
    const token = tokens[cursor++];
    if (token === '(') { const n = sum(); if (tokens[cursor++] !== ')') throw new Error(); return n; }
    if (token === '-') return -factor();
    if (token === '+') return factor();
    if (/^\d/.test(token || '')) return Number(token);
    if (Object.hasOwn(bindings, token) && typeof bindings[token] === 'number') return bindings[token];
    throw new Error();
  };
  const product = () => { let n = factor(); while (['*', '/'].includes(tokens[cursor])) { const op = tokens[cursor++], right = factor(); n = op === '*' ? n * right : n / right; } return n; };
  const sum = () => { let n = product(); while (['+', '-'].includes(tokens[cursor])) { const op = tokens[cursor++], right = product(); n = op === '+' ? n + right : n - right; } return n; };
  try { const n = sum(); return cursor === tokens.length && Number.isFinite(n) ? fixed ? n.toFixed(Math.min(12, Number(fixed[1]))) : String(n) : null; }
  catch { return null; }
}

export function interpolateLiteral(text, bindings) {
  return text.replace(/\{([^{}\n]+)\}/g, (original, expression) => {
    const simple = expression.match(/^(\w+)(?:\.(\w+))?$/);
    if (simple && Object.hasOwn(bindings, simple[1])) {
      const value = simple[2] ? bindings[simple[1]]?.[simple[2]] : bindings[simple[1]];
      return ['string', 'number'].includes(typeof value) ? String(value) : original;
    }
    return staticNumber(expression, bindings) ?? original;
  });
}
