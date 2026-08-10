import { CalcError } from './errors.js';

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
