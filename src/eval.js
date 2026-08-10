import { CalcError } from './errors.js';
import { parseLiteral, scalar } from './time.js';

export function evaluate(node) {
  switch (node.type) {
    case 'num':
      return Number(node.text);
    case 'neg':
      return -evaluate(node.operand);
    case 'binary': {
      const a = evaluate(node.left);
      const b = evaluate(node.right);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new CalcError('divzero', 'divide by zero');
          return a / b;
        case '^': {
          const r = a ** b;
          // e.g. (-8)^0.5 — real-valued powers only.
          if (Number.isNaN(r)) throw new CalcError('undef', 'undefined power');
          return r;
        }
      }
      throw new CalcError('syntax', `unknown operator "${node.op}"`);
    }
  }
  throw new CalcError('syntax', `unknown node "${node.type}"`);
}

/*
 * The TIM evaluator. Values carry a type — duration or scalar — and the type is
 * the whole point: without it, `2h * 3h` would return a plausible number for a
 * quantity that does not exist, and there would be no way to tell a count of
 * slots from a length of time on the result line.
 *
 *   dur ± dur          duration          dur ± scalar       error
 *   dur × scalar       duration          dur × dur          error
 *   dur ÷ scalar       duration          scalar ÷ dur       error
 *   dur ÷ dur          scalar            dur ^ anything     error
 *
 * Durations round to whole seconds at the operation rather than at the display,
 * because whole seconds is the model. Scalars keep full double precision.
 */
const duration = (seconds) => ({ seconds, duration: true });
const wrongType = () => new CalcError('timetype', 'not a time operation');

function timeOp(op, a, b) {
  const both = a.duration && b.duration;
  const either = a.duration || b.duration;

  switch (op) {
    case '+':
    case '-': {
      // Requiring the *same* type is what rejects `1h + 2`: it does not say
      // plus what, and guessing "seconds" would be a silent house rule.
      if (a.duration !== b.duration) throw wrongType();
      const v = op === '+' ? a.seconds + b.seconds : a.seconds - b.seconds;
      return both ? duration(Math.round(v)) : scalar(v);
    }
    case '*':
      if (both) throw wrongType();
      return either
        ? duration(Math.round(a.seconds * b.seconds))
        : scalar(a.seconds * b.seconds);
    case '/': {
      if (b.seconds === 0) throw new CalcError('divzero', 'divide by zero');
      // A scalar over a duration is a rate, not a time. Nothing on this display
      // could carry the unit, so it is refused rather than mislabelled.
      if (b.duration && !a.duration) throw wrongType();
      const v = a.seconds / b.seconds;
      // dur ÷ dur cancels: how many 20-minute slots fit in 3 hours is 9, and 9
      // must not render as 0:00:09.
      return both ? scalar(v) : a.duration ? duration(Math.round(v)) : scalar(v);
    }
    case '^': {
      if (either) throw wrongType();
      const r = a.seconds ** b.seconds;
      if (Number.isNaN(r)) throw new CalcError('undef', 'undefined power');
      return scalar(r);
    }
  }
  throw new CalcError('syntax', `unknown operator "${op}"`);
}

export function evaluateTime(node) {
  switch (node.type) {
    case 'num':
      return parseLiteral(node.text);
    case 'neg': {
      const v = evaluateTime(node.operand);
      return { seconds: -v.seconds, duration: v.duration };
    }
    case 'binary':
      return timeOp(node.op, evaluateTime(node.left), evaluateTime(node.right));
  }
  throw new CalcError('syntax', `unknown node "${node.type}"`);
}

/**
 * The hex evaluator. Integers only, so BigInt rather than doubles: a typed
 * FFFFFFFFFFFFFFFF has to come back exactly, and doubles go approximate above
 * 2^53. Division truncates toward zero, which BigInt does natively and which is
 * what a programmer calculator is expected to do.
 *
 * The one hazard BigInt adds over floats is that there is no ∞ to overflow into
 * — 2^1000000 would allocate until the tab dies rather than returning a value.
 * Every result is therefore size-checked, and ^ is checked *before* it is
 * computed, since by then it is already too late.
 */
const MAX_BITS = 1024;
const MAX_EXPONENT = 4096n;

const bitLength = (n) => (n < 0n ? -n : n).toString(2).length;

function guard(n) {
  if (bitLength(n) > MAX_BITS) throw new CalcError('toobig', 'result too large');
  return n;
}

export function evaluateHex(node) {
  switch (node.type) {
    case 'num':
      return BigInt(`0x${node.text}`);
    case 'neg':
      return -evaluateHex(node.operand);
    case 'binary': {
      const a = evaluateHex(node.left);
      const b = evaluateHex(node.right);
      switch (node.op) {
        case '+': return guard(a + b);
        case '-': return guard(a - b);
        case '*': return guard(a * b);
        case '/':
          if (b === 0n) throw new CalcError('divzero', 'divide by zero');
          return a / b;
        case '^': {
          // A negative exponent truncates to 0 for the same reason 1/2 does:
          // this mode holds integers, and 1/(a^n) is not one.
          if (b < 0n) return 0n;
          if (b > MAX_EXPONENT) throw new CalcError('toobig', 'exponent too large');
          // a^b needs between (bits(a)-1)*b+1 and bits(a)*b bits. Test the lower
          // bound, so this only refuses what is *certainly* too large; anything
          // that slips through is at most twice the cap and cheap to compute,
          // and guard() then rejects it on the real size.
          if ((bitLength(a) - 1) * Number(b) + 1 > MAX_BITS) {
            throw new CalcError('toobig', 'result too large');
          }
          return guard(a ** b);
        }
      }
      throw new CalcError('syntax', `unknown operator "${node.op}"`);
    }
  }
  throw new CalcError('syntax', `unknown node "${node.type}"`);
}
