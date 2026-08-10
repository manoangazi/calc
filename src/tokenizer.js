import { CalcError } from './errors.js';

export const NUM = 'num';
export const OP = 'op';
export const LPAREN = 'lparen';
export const RPAREN = 'rparen';

export const DEC = 10;
export const HEX = 16;

const OPS = '+-*/^';

/**
 * What counts as part of a number token, per radix. Hex has no fractional form —
 * hex mode is integer-only — so the point is not a number character there and
 * falls through to the "unexpected character" arm.
 */
const NUM_CHAR = { [DEC]: /[0-9.]/, [HEX]: /[0-9A-F]/ };
const WELL_FORMED = { [DEC]: /^(\d+(\.\d*)?|\.\d+)$/, [HEX]: /^[0-9A-F]+$/ };

export function tokenize(src, radix = DEC) {
  const isNumChar = NUM_CHAR[radix] ?? NUM_CHAR[DEC];
  const wellFormed = WELL_FORMED[radix] ?? WELL_FORMED[DEC];

  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (isNumChar.test(c)) {
      const start = i;
      while (i < src.length && isNumChar.test(src[i])) i++;
      const value = src.slice(start, i);
      if (!wellFormed.test(value)) {
        throw new CalcError('syntax', `malformed number "${value}"`);
      }
      tokens.push({ type: NUM, value, start, end: i });
    } else if (OPS.includes(c)) {
      tokens.push({ type: OP, value: c, start: i, end: i + 1 });
      i++;
    } else if (c === '(') {
      tokens.push({ type: LPAREN, value: c, start: i, end: i + 1 });
      i++;
    } else if (c === ')') {
      tokens.push({ type: RPAREN, value: c, start: i, end: i + 1 });
      i++;
    } else {
      throw new CalcError('syntax', `unexpected character "${c}"`);
    }
  }
  return tokens;
}
