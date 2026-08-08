/**
 * Display formatting. The separators are runtime config, not constants, because
 * the overflow menu lets you switch the decimal point. The group separator is a
 * thin space in both settings so it can never collide with a comma decimal.
 */
export const config = {
  decimalSep: '.',
  groupSep: ' ',
  decimals: 'auto',
};

export const DECIMAL_CHOICES = ['auto', 1, 2, 3, 4, 5];
const MIN_DECIMALS = 1;
const MAX_DECIMALS = 5;

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

export function setDecimalSep(sep) {
  config.decimalSep = sep === ',' ? ',' : '.';
}

const SIG_DIGITS = 12;

export function groupInteger(digits) {
  if (digits.length <= 3) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, config.groupSep);
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

const sci = (x) => x.toExponential(6).replace('e', '×10^').replace('+', '');

export function formatResult(n) {
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

const OP_GLYPH = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };

/**
 * One part per buffer character, each carrying its buffer index `i`, plus
 * separator parts with no index. Per-character output is what lets the caret sit
 * between any two characters and lets a tap map back to a buffer position.
 */
export function formatExpression(buf) {
  const parts = [];
  let i = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (/[0-9.]/.test(c)) {
      const start = i;
      while (i < buf.length && /[0-9.]/.test(buf[i])) i++;
      const raw = buf.slice(start, i);
      const dot = raw.indexOf('.');
      const intLen = dot === -1 ? raw.length : dot;
      for (let k = 0; k < raw.length; k++) {
        const ch = raw[k];
        parts.push({ kind: 'num', text: ch === '.' ? config.decimalSep : ch, i: start + k });
        if (k < intLen - 1 && (intLen - 1 - k) % 3 === 0) {
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
