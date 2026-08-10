/**
 * Converting the expression buffer between bases.
 *
 * Switching DEC/HEX rewrites every number literal in the buffer rather than just
 * the result, so a half-typed calculation survives the switch and so typing a
 * number and flipping the control is all a base conversion takes.
 */
import { DEC, HEX } from './tokenizer.js';
import { NUM_CHARS } from './format.js';
import { MAX_LENGTH } from './model.js';

export { DEC, HEX };

/**
 * One literal, from one base to the other. Returns null when the text is not a
 * number this base can read, which leaves the literal untouched rather than
 * destroying it.
 */
function convertLiteral(raw, from) {
  if (from === HEX) {
    if (!/^[0-9A-F]+$/.test(raw)) return null;
    return { text: BigInt(`0x${raw}`).toString(10), lossy: false };
  }

  // Decimal to hex: integer-only, so anything after the point is dropped.
  const [int, frac] = raw.split('.');
  const digits = int === '' ? '0' : int;
  if (!/^[0-9]+$/.test(digits)) return null;
  const lossy = frac !== undefined && /[1-9]/.test(frac);
  return { text: BigInt(digits).toString(16).toUpperCase(), lossy };
}

/**
 * Rewrite every number literal in `buf` from base `from` to base `to`.
 *
 * `lossy` reports that a fractional part was dropped — the caller says so rather
 * than letting 12.75 quietly become C. `tooLong` reports that the result would
 * not fit the buffer, in which case `buf` comes back unchanged: hex is denser
 * than decimal, so FFFFFFFFFFFFFFFF is 16 characters but 20 as a decimal.
 */
export function convertBuffer(buf, from, to) {
  if (from === to) return { buf, lossy: false, tooLong: false };

  const isNumChar = NUM_CHARS[from] ?? NUM_CHARS[DEC];
  let out = '';
  let lossy = false;
  let i = 0;

  while (i < buf.length) {
    if (!isNumChar.test(buf[i])) {
      out += buf[i];
      i++;
      continue;
    }
    const start = i;
    while (i < buf.length && isNumChar.test(buf[i])) i++;
    const raw = buf.slice(start, i);
    const converted = convertLiteral(raw, from);
    if (converted === null) {
      out += raw;
    } else {
      out += converted.text;
      lossy = lossy || converted.lossy;
    }
  }

  if (out.length > MAX_LENGTH) return { buf, lossy: false, tooLong: true };
  return { buf: out, lossy, tooLong: false };
}
