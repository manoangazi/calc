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
  // TIM only. A duration times a duration is not a quantity that exists, and a
  // duration plus a bare number does not say plus what — both are refused rather
  // than coerced, because a plausible wrong answer is worse than no answer.
  timetype: { display: '—', hint: 'Not a time operation' },
  // Hex only, both of them. Bitwise operators are meaningless on a double, and
  // meaningless on a negative here because hex is signed magnitude rather than
  // two's complement — there is no word size, so there is no -1 = FFFF….
  bitdec:  { display: '—', hint: 'Bitwise works in hex only' },
  bitneg:  { display: '—', hint: 'Bitwise needs a positive value' },
};

export const isCalcError = (e) => e instanceof CalcError && e.code in ERRORS;
