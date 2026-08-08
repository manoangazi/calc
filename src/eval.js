import { CalcError } from './errors.js';

export function evaluate(node) {
  switch (node.type) {
    case 'num':
      return node.value;
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
