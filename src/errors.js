/**
 * One error type for the whole engine. Every failure carries a code, so the UI
 * can render a quiet state instead of guessing from a message string, and the
 * fuzzer can assert that nothing else ever escapes.
 */
export class CalcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CalcError';
    this.code = code;
  }
}

export const ERRORS = {
  syntax:   { display: '—', hint: 'Incomplete expression' },
  depth:    { display: '—', hint: 'Too deeply nested' },
  divzero:  { display: '—', hint: 'Cannot divide by zero' },
  undef:    { display: '—', hint: 'Not a real number' },
  overflow: { display: '∞', hint: 'Result too large to show' },
  toobig:   { display: '—', hint: 'Number too large' },
};

export const isCalcError = (e) => e instanceof CalcError && e.code in ERRORS;
