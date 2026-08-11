/**
 * Display formatting. The separators and the radix are runtime config rather
 * than constants, because the overflow menu and the DEC/HEX control change them
 * while the app is running. The group separator is a thin space so it can never
 * collide with a decimal point.
 */
import { DEC, HEX, TIM } from './tokenizer.js';
import { formatDuration } from './time.js';

export const config = {
  decimalSep: '.',
  groupSep: '\u2009', // thin space, as an escape: invisible in source otherwise
  decimals: 'auto',
  radix: DEC,
};

export const DECIMAL_CHOICES = ['auto', 1, 2, 3, 4, 5];
const MIN_DECIMALS = 1;
const MAX_DECIMALS = 5;

/** Digits grouped in fours in hex (FFFF FFFF), threes in decimal. Never in TIM:
    the fields already have their own separators and a thin space between them
    would read as a fourth. */
const GROUP_SIZE = { [DEC]: 3, [HEX]: 4, [TIM]: Infinity };

/** Which characters make up a number literal, per radix. */
export const NUM_CHARS = { [DEC]: /[0-9.]/, [HEX]: /[0-9A-F]/, [TIM]: /[0-9:.hms]/ };

/**
 * 'auto' shows what the number actually is; 1..5 fixes the places. Display only —
 * the stored result keeps full precision, so changing this re-renders old history
 * entries without anything having been lost. Anything outside the range falls back
 * to 'auto', which also sanitises whatever comes back from localStorage.
 */
export function setDecimals(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  config.decimals =
    Number.isInteger(n) && n >= MIN_DECIMALS && n <= MAX_DECIMALS ? n : 'auto';
  return config.decimals;
}

/** Anything that is not a known base means decimal, including junk from storage. */
export function setRadix(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  config.radix = n === HEX ? HEX : n === TIM ? TIM : DEC;
  return config.radix;
}

export function setDecimalSep(sep) {
  config.decimalSep = sep === ',' ? ',' : '.';
}

const SIG_DIGITS = 12;

/** Split digits into groups of `size` counting from the right. */
function group(digits, size) {
  if (digits.length <= size) return digits;
  const re = new RegExp(`\\B(?=([0-9A-F]{${size}})+(?![0-9A-F]))`, 'g');
  return digits.replace(re, config.groupSep);
}

/**
 * Always threes: this is the decimal path, and it is chosen by the *value* being
 * a number rather than by the live mode. That matters for the tape, where a
 * decimal entry must keep its own grouping while the app is showing hex.
 */
export function groupInteger(digits) {
  return group(digits, GROUP_SIZE[DEC]);
}

/**
 * A number as plain digits. JS switches String() to exponential form below
 * 1e-6, which must never reach the display or the expression buffer.
 */
export function toPlainString(n) {
  const s = String(n);
  if (!s.includes('e') && !s.includes('E')) return s;
  const abs = Math.abs(n);
  const decimals = Math.min(100, Math.max(0, -Math.floor(Math.log10(abs)) + 11));
  return n.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function groupDecimalString(s) {
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [int, frac] = s.split('.');
  const out = groupInteger(int) + (frac !== undefined ? config.decimalSep + frac : '');
  return (neg ? '-' : '') + out;
}

/** A BigInt as grouped uppercase hex, signed magnitude rather than two's complement. */
export function formatHex(v) {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString(16).toUpperCase();
  return (neg ? '-' : '') + group(digits, GROUP_SIZE[HEX]);
}

const sci = (x) => x.toExponential(6).replace('e', '×10^').replace('+', '');

/**
 * `radix` is explicit for the same reason `formatExpression` takes it: the tape
 * renders each entry in the base it was calculated in, not the one currently
 * selected. It matters more here than it looks — a hex result announces itself
 * by being a BigInt, but a TIM result is an ordinary object and there is no way
 * to tell a duration from a plain number without being told.
 */
export function formatResult(n, radix = config.radix) {
  if (radix === TIM && n && typeof n === 'object') {
    // A scalar in TIM is just a number — how many 20-minute slots fit in three
    // hours is 9, and rendering that as 0:00:09 would be a different claim.
    return n.duration ? formatDuration(n.seconds) : formatResult(n.seconds, DEC);
  }

  // Hex results arrive as BigInt, where there is no NaN, no ∞ and no rounding
  // to apply — the decimal-places setting simply has nothing to act on.
  if (typeof n === 'bigint') return formatHex(n);

  if (Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';

  const places = config.decimals;
  const fixed = places !== 'auto';
  if (n === 0) return fixed ? (0).toFixed(places) : '0';

  const rounded = Number(n.toPrecision(SIG_DIGITS));
  const mag = Math.abs(rounded);
  if (mag >= 1e15) return sci(rounded);

  if (fixed) {
    const out = rounded.toFixed(places);
    // A non-zero result must never read as a flat '0.00'. When the requested
    // places cannot show it at all, fall through and display it the auto way
    // rather than claim the answer is zero.
    if (Number(out) !== 0) return groupDecimalString(out);
  }

  if (mag < 1e-9) return sci(rounded);
  return groupDecimalString(toPlainString(rounded));
}

const OP_GLYPH = {
  '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', '√': '√',
  // Hex only. Symbols rather than the words AND/OR/XOR, so they sit in the
  // expression the way × and ÷ already do instead of breaking it into prose.
  '&': '&', '⊻': '⊻', '|': '|', '≪': '≪', '≫': '≫', '%': '%',
};

/**
 * One part per buffer character, each carrying its buffer index `i`, plus
 * separator parts with no index. Per-character output is what lets the caret sit
 * between any two characters and lets a tap map back to a buffer position.
 *
 * `radix` defaults to the live setting, but the tape passes each entry's own so
 * a hex calculation keeps reading as hex after the mode has been switched back.
 */
export function formatExpression(buf, radix = config.radix) {
  const isNumChar = NUM_CHARS[radix] ?? NUM_CHARS[DEC];
  const size = GROUP_SIZE[radix] ?? 3;

  const parts = [];
  let i = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (isNumChar.test(c)) {
      const start = i;
      while (i < buf.length && isNumChar.test(buf[i])) i++;
      const raw = buf.slice(start, i);
      const dot = raw.indexOf('.');
      const intLen = dot === -1 ? raw.length : dot;
      for (let k = 0; k < raw.length; k++) {
        const ch = raw[k];
        // The point is only a decimal separator in DEC. In TIM it is a field
        // marker and must survive a decimalSep setting untouched.
        const text = ch === '.' && radix === DEC ? config.decimalSep : ch;
        parts.push({ kind: 'num', text, i: start + k });
        if (k < intLen - 1 && (intLen - 1 - k) % size === 0) {
          parts.push({ kind: 'group', text: config.groupSep });
        }
      }
    } else if (OP_GLYPH[c]) {
      parts.push({ kind: 'op', text: OP_GLYPH[c], i });
      i++;
    } else {
      parts.push({ kind: 'paren', text: c, i });
      i++;
    }
  }
  return parts;
}
