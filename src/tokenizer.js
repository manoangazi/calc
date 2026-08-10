import { CalcError } from './errors.js';

export const NUM = 'num';
export const OP = 'op';
export const LPAREN = 'lparen';
export const RPAREN = 'rparen';

export const DEC = 10;
export const HEX = 16;
/* Base 60, honestly: TIM's fields really are sexagesimal. Keeping it a radix
   rather than a mode flag is what lets every lookup table below stay one map. */
export const TIM = 60;

/* `√` is here rather than in a function/identifier arm because it is a prefix
   operator, not a call: there are no names in this grammar and no argument list
   to parse. It tokenizes as an OP and the parser gives it unary precedence. */
const OPS = '+-*/^√&⊻|';

/**
 * What counts as part of a number token, per radix. Hex has no fractional form —
 * hex mode is integer-only — so the point is not a number character there and
 * falls through to the "unexpected character" arm.
 *
 * TIM's units are lowercase and hex's digits are uppercase, so the two letter
 * sets are disjoint even though both modes admit letters.
 */
const NUM_CHAR = { [DEC]: /[0-9.]/, [HEX]: /[0-9A-F]/, [TIM]: /[0-9:.hms]/ };

/*
 * A TIM literal is a bare integer (a scalar), or one of the two duration
 * spellings. Checked loosely here — shape only — because `time.js` owns the
 * field ordering rules and rejecting twice in two places is how the two drift
 * apart. What matters is that `1:20.45` comes out as *one* token, not three.
 */
const TIM_FORM = /^(?:\d+|(?:\d*:)?\d*(?:\.\d*)?|(?:\d+[hms])+\d*)$/;

const WELL_FORMED = {
  [DEC]: /^(\d+(\.\d*)?|\.\d+)$/,
  [HEX]: /^[0-9A-F]+$/,
  [TIM]: TIM_FORM,
};

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
