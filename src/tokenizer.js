import { CalcError } from './errors.js';

export const NUM = 'num';
export const OP = 'op';
export const LPAREN = 'lparen';
export const RPAREN = 'rparen';

const DIGIT = /[0-9]/;
const OPS = '+-*/^';

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (DIGIT.test(c) || c === '.') {
      const start = i;
      while (i < src.length && (DIGIT.test(src[i]) || src[i] === '.')) i++;
      const value = src.slice(start, i);
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) {
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
