import { parse } from './parser.js';
import { evaluate, evaluateHex, evaluateTime } from './eval.js';
import { isCalcError } from './errors.js';
import { toPlainString, config } from './format.js';
import { DEC, HEX, TIM } from './tokenizer.js';
import { canInsertMarker, toBuffer } from './time.js';

export const MAX_LENGTH = 120;

/** Every binary operator key. Kept in one place so ^ cannot be missed. */
/* `√` is included so pressing a binary operator straight after one corrects it
   — `√` then `+` gives `+`, not the unparseable `√+`. It is deliberately absent
   from AFTER_OPEN's own logic path: see the `sqrt` branch, which inserts. */
export const OPERATORS = '+-*/^√';
const AFTER_OPEN = OPERATORS + '(';

/* Radix-dependent character classes. Hex has no point, so `dot` is inert there
   and the keypad hides the key rather than relying on that. */
const TRAILING = { [DEC]: /[0-9.]+$/, [HEX]: /[0-9A-F]+$/, [TIM]: /[0-9:.hms]+$/ };
const LEADING = { [DEC]: /^[0-9.]+/, [HEX]: /^[0-9A-F]+/, [TIM]: /^[0-9:.hms]+/ };
const LEGAL_SRC = {
  [DEC]: /^[0-9.+\-*/^()√]*$/,
  [HEX]: /^[0-9A-F+\-*/^()√]*$/,
  [TIM]: /^[0-9:.hms+\-*/^()√]*$/,
};
const LEGAL_DIGIT = { [DEC]: /^[0-9]$/, [HEX]: /^[0-9A-F]$/, [TIM]: /^[0-9]$/ };

const radix = () => (config.radix === HEX ? HEX : config.radix === TIM ? TIM : DEC);

export function initialState() {
  return { buf: '', caret: 0, committed: false, result: null, error: null };
}

export function openDepth(buf) {
  let d = 0;
  for (const c of buf) {
    if (c === '(') d++;
    else if (c === ')' && d > 0) d--;
  }
  return d;
}

/** The buffer with missing right parens virtually closed. Never mutates state. */
export function previewSource(buf) {
  return buf + ')'.repeat(openDepth(buf));
}

/** Parse and evaluate in whichever base is live. */
function run(src) {
  const r = radix();
  const ast = parse(src, r);
  if (r === HEX) return evaluateHex(ast);
  if (r === TIM) return evaluateTime(ast);
  return evaluate(ast);
}

/** Evaluate for the live preview. Returns a value, or null if not yet valid. */
export function preview(buf) {
  if (buf === '') return null;
  try {
    return run(previewSource(buf));
  } catch {
    return null;
  }
}

const lastChar = (s) => (s.length ? s[s.length - 1] : '');

/** Digits of the number token ending at the caret. */
const trailingNumber = (before) => (before.match(TRAILING[radix()]) || [''])[0];

/** Digits of the number token continuing after the caret. */
const leadingNumber = (after) => (after.match(LEADING[radix()]) || [''])[0];

/**
 * A result rendered as something the buffer can legally hold: plain digits in
 * the current base, no exponent. Returns null when the value cannot be written
 * that way, which is why continuing from a result is allowed to fail rather than
 * inject an "e" the tokenizer would choke on for the rest of the session.
 */
export function plainDecimal(n) {
  // Hex results are exact integers, so the only thing that can go wrong is length.
  if (typeof n === 'bigint') {
    const s = (n < 0n ? '-' : '') + (n < 0n ? -n : n).toString(16).toUpperCase();
    return s.length > MAX_LENGTH ? null : s;
  }

  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === 0) return '0';

  const abs = Math.abs(n);
  if (abs >= 1e21 || abs < 1e-9) return null;

  const s = toPlainString(Number(n.toPrecision(12)));
  if (!/^-?(\d+(\.\d+)?)$/.test(s) || s.length > MAX_LENGTH) return null;
  return s;
}

function resumeFrom(state) {
  if (state.result === null) return '';
  if (radix() === TIM) {
    const v = state.result;
    // A duration writes back in the suffix spelling the keys produce. A scalar
    // writes back as digits — but only if it is a whole number, because "2.5"
    // in a TIM buffer would read as 2m 5s, which is a different value entirely.
    if (v.duration) return toBuffer(v) ?? '';
    return Number.isInteger(v.seconds) ? (plainDecimal(v.seconds) ?? '') : '';
  }
  return plainDecimal(state.result) ?? '';
}

/** Base buffer for an insertion, honouring the post-"=" rules. */
function base(state, kind) {
  if (!state.committed) return { buf: state.buf, caret: state.caret };
  // After "=", an operator continues from the result; anything else starts fresh.
  const buf = kind === 'op' ? resumeFrom(state) : '';
  return { buf, caret: buf.length };
}

function insert(state, before, text, after) {
  if (before.length + text.length + after.length > MAX_LENGTH) return state;
  return {
    buf: before + text + after,
    caret: before.length + text.length,
    committed: false,
    result: null,
    error: null,
  };
}

/** True when an opening bracket is what naturally belongs at this position. */
const wantsOpen = (before) => before === '' || AFTER_OPEN.includes(lastChar(before));

/** An opening bracket, with the implicit multiply if one is needed. */
const openText = (before) => (wantsOpen(before) ? '(' : '*(');

/**
 * Which bracket the smart key inserts. `forced` (long press) picks the other,
 * and the keyboard bypasses this entirely with explicit open/close commands.
 */
function parenInsert(before, forced) {
  const canClose = openDepth(before) > 0;
  if (forced) return wantsOpen(before) ? (canClose ? ')' : null) : openText(before);
  if (wantsOpen(before)) return '(';
  return canClose ? ')' : openText(before);
}

/**
 * Apply a keypad command. Returns a new state; never mutates the input.
 * Commands:
 *   digit:<0-9A-F> | zeros | dot | colon | unit:<h|m|s> | op:<+-*\/> | paren
 *   parenforce
 *   clear | back | equals | caret:<n>
 */
export function apply(state, cmd) {
  const [kind, arg] = cmd.split(':');

  if (kind === 'clear') return initialState();

  // Recalling a tape entry. The source comes from storage, so it is validated
  // here rather than trusted.
  if (kind === 'load') {
    const buf = cmd.slice('load:'.length);
    if (buf.length > MAX_LENGTH || !LEGAL_SRC[radix()].test(buf)) return state;
    return { buf, caret: buf.length, committed: false, result: null, error: null };
  }

  if (kind === 'caret') {
    const caret = Math.max(0, Math.min(state.buf.length, Number(arg)));
    return { ...state, caret, committed: false, error: null };
  }

  if (kind === 'back') {
    // After "=", backspace returns you to the expression, not to the result.
    if (state.committed) {
      return { ...initialState(), buf: state.buf, caret: state.buf.length };
    }
    if (state.caret === 0) return state;
    return {
      ...state,
      buf: state.buf.slice(0, state.caret - 1) + state.buf.slice(state.caret),
      caret: state.caret - 1,
      error: null,
    };
  }

  if (kind === 'equals') {
    if (state.buf === '' || state.committed) return state;
    const src = previewSource(state.buf);
    try {
      const value = run(src);
      // Overflow still commits: the result line shows ∞ rather than nothing.
      // A hex result is a BigInt and is exact by construction, so it never is one.
      const finite = typeof value === 'bigint'
        ? true
        : Number.isFinite(radix() === TIM ? value.seconds : value);
      return { buf: src, caret: src.length, committed: true, result: value, error: finite ? null : 'overflow' };
    } catch (e) {
      if (!isCalcError(e)) throw e;
      return { ...state, error: e.code };
    }
  }

  const { buf, caret } = base(state, kind);
  let before = buf.slice(0, caret);
  const after = buf.slice(caret);

  if (kind === 'digit' || kind === 'zeros') {
    if (kind === 'digit' && !LEGAL_DIGIT[radix()].test(arg)) return state;
    if (lastChar(before) === ')') before += '*';       // (2+3)4 -> implicit multiply
    const cur = trailingNumber(before);
    let text = kind === 'zeros' ? '00' : arg;
    if (cur === '0') {
      before = before.slice(0, -1);                     // replace a lone leading zero
      if (text === '00') text = '0';
    } else if (cur === '' && text === '00') {
      text = '0';
    }
    return insert(state, before, text, after);
  }

  /*
   * The field markers. In TIM the point is one of them — it separates minutes
   * from seconds rather than introducing a fraction — so `dot` routes here
   * alongside `colon` and `unit:<h|m|s>`, and `time.js` owns the one rule they
   * all obey: each marker at most once, strictly descending, no mixing the two
   * spellings inside a literal.
   */
  if (kind === 'colon' || kind === 'unit' || (kind === 'dot' && radix() === TIM)) {
    if (radix() !== TIM) return state;
    const marker = kind === 'colon' ? ':' : kind === 'dot' ? '.' : arg;
    if (!':.hms'.includes(marker) || marker === '') return state;
    if (lastChar(before) === ')') before += '*';
    if (!canInsertMarker(trailingNumber(before), leadingNumber(after), marker)) return state;
    return insert(state, before, marker, after);
  }

  if (kind === 'dot') {
    // Hex mode is integer-only; there is no point to insert.
    if (radix() === HEX) return state;
    if (lastChar(before) === ')') before += '*';
    // The number token spans the caret, so check both sides for an existing point.
    if ((trailingNumber(before) + leadingNumber(after)).includes('.')) return state;
    if (trailingNumber(before) === '') before += '0';
    return insert(state, before, '.', after);
  }

  /*
   * The root is prefix, so none of the binary-operator rules below apply to it:
   * it is legal where a number is legal — at the start, after `(`, after another
   * operator, and after itself — and it never replaces the character before it.
   * Following a value it means multiplication, `2√9`, so the `*` is written in
   * for the same reason `(2+3)4` gets one.
   */
  if (kind === 'sqrt') {
    if (trailingNumber(before) !== '' || lastChar(before) === ')') before += '*';
    return insert(state, before, '√', after);
  }

  if (kind === 'op') {
    const last = lastChar(before);
    if (before === '' || last === '(') {
      return arg === '-' ? insert(state, before, '-', after) : state;
    }
    // A minus after × ÷ ^ is a sign, not a correction: 2^-2, 3*-4.
    const isSign = arg === '-' && '*/^'.includes(last);
    if (!isSign && OPERATORS.includes(last)) before = before.slice(0, -1);
    return insert(state, before, arg, after);
  }

  if (kind === 'open') return insert(state, before, openText(before), after);

  if (kind === 'close') {
    return openDepth(before) > 0 ? insert(state, before, ')', after) : state;
  }

  if (kind === 'paren' || kind === 'parenforce') {
    const text = parenInsert(before, kind === 'parenforce');
    return text === null ? state : insert(state, before, text, after);
  }

  return state;
}
