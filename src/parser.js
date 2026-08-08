import { NUM, OP, LPAREN, RPAREN, tokenize } from './tokenizer.js';
import { CalcError } from './errors.js';

/**
 * Bounded so a pathological input cannot exhaust the JS stack. 64 is far past
 * anything typed by hand and well inside the engine's real recursion limit.
 */
export const MAX_DEPTH = 64;

export function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  let depth = 0;

  const peek = () => tokens[i];
  const at = (type, value) => {
    const t = peek();
    return !!t && t.type === type && (value === undefined || t.value === value);
  };

  function expr() {
    let node = term();
    while (at(OP, '+') || at(OP, '-')) {
      const op = tokens[i++].value;
      node = { type: 'binary', op, left: node, right: term() };
    }
    return node;
  }

  function term() {
    let node = factor();
    while (at(OP, '*') || at(OP, '/')) {
      const op = tokens[i++].value;
      node = { type: 'binary', op, left: node, right: factor() };
    }
    return node;
  }

  function factor() {
    if (at(OP, '-')) {
      i++;
      if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too many nested signs');
      const node = { type: 'neg', operand: factor() };
      depth--;
      return node;
    }
    if (at(OP, '+')) {
      i++;
      if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too many nested signs');
      const node = factor();
      depth--;
      return node;
    }
    return power();
  }

  /**
   * Binds tighter than unary minus and associates to the right, so -2^2 is -4
   * and 2^3^2 is 2^9. The exponent recurses through factor() so 2^-3 works.
   */
  function power() {
    const b = primary();
    if (!at(OP, '^')) return b;
    i++;
    if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too many nested powers');
    const node = { type: 'binary', op: '^', left: b, right: factor() };
    depth--;
    return node;
  }

  function primary() {
    const t = peek();
    if (!t) throw new CalcError('syntax', 'unexpected end of expression');
    if (t.type === NUM) {
      i++;
      return { type: 'num', value: Number(t.value) };
    }
    if (t.type === LPAREN) {
      i++;
      if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too deeply nested');
      const node = expr();
      if (!at(RPAREN)) throw new CalcError('syntax', 'missing ")"');
      i++;
      depth--;
      return node;
    }
    throw new CalcError('syntax', `unexpected "${t.value}"`);
  }

  if (tokens.length === 0) throw new CalcError('syntax', 'empty expression');
  const node = expr();
  if (i < tokens.length) throw new CalcError('syntax', `unexpected "${tokens[i].value}"`);
  return node;
}
