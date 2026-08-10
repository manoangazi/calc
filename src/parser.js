import { NUM, OP, LPAREN, RPAREN, DEC, tokenize } from './tokenizer.js';
import { CalcError } from './errors.js';

/**
 * Bounded so a pathological input cannot exhaust the JS stack. 64 is far past
 * anything typed by hand and well inside the engine's real recursion limit.
 */
export const MAX_DEPTH = 64;

export function parse(src, radix = DEC) {
  const tokens = tokenize(src, radix);
  let i = 0;
  let depth = 0;

  const peek = () => tokens[i];
  const at = (type, value) => {
    const t = peek();
    return !!t && t.type === type && (value === undefined || t.value === value);
  };

  /*
   * The bitwise level, above + and −. Order and relative precedence are C's —
   * `&` tighter than `⊻` tighter than `|`, all three looser than arithmetic — so
   * `FF&0F+1` groups as `FF&(0F+1)`. That is what a C programmer expects, and
   * they are the only people who will type these.
   *
   * They parse in every radix but evaluate only in hex; the other two evaluators
   * refuse the node. Keeping the grammar one shape is worth more than making the
   * parser radix-aware, and `LEGAL_SRC` already stops the characters reaching a
   * decimal buffer.
   */
  function bitOr() {
    let node = bitXor();
    while (at(OP, '|')) {
      i++;
      node = { type: 'binary', op: '|', left: node, right: bitXor() };
    }
    return node;
  }

  function bitXor() {
    let node = bitAnd();
    while (at(OP, '⊻')) {
      i++;
      node = { type: 'binary', op: '⊻', left: node, right: bitAnd() };
    }
    return node;
  }

  function bitAnd() {
    let node = expr();
    while (at(OP, '&')) {
      i++;
      node = { type: 'binary', op: '&', left: node, right: expr() };
    }
    return node;
  }

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
    /*
     * Same precedence as unary minus, so `√9+7` is 10 rather than 4 — the root
     * takes the next factor, not the rest of the expression — and `-√4`, `√-4`
     * and `√√16` all parse. Anything wider needs brackets: `√(9+7)`.
     */
    if (at(OP, '√')) {
      i++;
      if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too many nested roots');
      const node = { type: 'sqrt', operand: factor() };
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
    // The literal is kept as text, not converted here: the same AST is read by
    // the float evaluator and the BigInt one, and only they know the radix.
    if (t.type === NUM) {
      i++;
      return { type: 'num', text: t.value };
    }
    if (t.type === LPAREN) {
      i++;
      if (++depth > MAX_DEPTH) throw new CalcError('depth', 'too deeply nested');
      const node = bitOr();
      if (!at(RPAREN)) throw new CalcError('syntax', 'missing ")"');
      i++;
      depth--;
      return node;
    }
    throw new CalcError('syntax', `unexpected "${t.value}"`);
  }

  if (tokens.length === 0) throw new CalcError('syntax', 'empty expression');
  const node = bitOr();
  if (i < tokens.length) throw new CalcError('syntax', `unexpected "${tokens[i].value}"`);
  return node;
}
