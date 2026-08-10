/**
 * The history tape. Pure functions over a plain array so the storage round-trip
 * can be tested without a DOM.
 *
 * Entries are newest-first and validated on the way in *and* on the way out of
 * storage: localStorage is editable by anything that can run script on this
 * origin, so a stored expression is treated as untrusted input, not as data we
 * wrote and can trust.
 *
 * A hex entry carries `radix: 16` and holds its value as a decimal *string*.
 * Both matter: without the radix, "FF+FF" is ambiguous once the mode has been
 * switched back, and BigInt cannot be serialised — JSON.stringify throws on it
 * outright, which would have silently killed persistence for the whole tape.
 */
import { DEC, HEX, TIM } from './tokenizer.js';

export const MAX_ENTRIES = 50;
export const STORAGE_KEY = 'manocalc.history';

const LEGAL_SRC = {
  [DEC]: /^[0-9.+\-*/^()√]+$/,
  [HEX]: /^[0-9A-F+\-*/^()√&⊻|]+$/,
  [TIM]: /^[0-9:.hms+\-*/^()√]+$/,
};
const LEGAL_BIGINT = /^-?[0-9]+$/;
const MAX_SRC = 120;
const MAX_VALUE_DIGITS = 400;

/** The radix an entry claims, normalised. Entries written before hex existed have none. */
export const entryRadix = (entry) => {
  if (!entry) return DEC;
  return entry.radix === HEX ? HEX : entry.radix === TIM ? TIM : DEC;
};

export function isValidEntry(entry) {
  if (!entry || typeof entry.src !== 'string') return false;

  const radix = entryRadix(entry);
  if (entry.src.length === 0 || entry.src.length > MAX_SRC) return false;
  if (!LEGAL_SRC[radix].test(entry.src)) return false;

  // A TIM entry stores the seconds count flat, plus the one bit that cannot be
  // recovered from it: whether those seconds are a duration or a plain number.
  if (radix === TIM) {
    return (
      typeof entry.value === 'number' &&
      Number.isFinite(entry.value) &&
      typeof entry.duration === 'boolean'
    );
  }

  if (radix === HEX) {
    return (
      typeof entry.value === 'string' &&
      entry.value.length > 0 &&
      entry.value.length <= MAX_VALUE_DIGITS &&
      LEGAL_BIGINT.test(entry.value)
    );
  }
  return typeof entry.value === 'number' && Number.isFinite(entry.value);
}

/** A live entry (BigInt in hex, a typed object in TIM) as something JSON can hold. */
export function toStored(entry) {
  if (typeof entry.value === 'bigint') {
    return { src: entry.src, value: entry.value.toString(10), radix: HEX };
  }
  if (entry.value && typeof entry.value === 'object') {
    return {
      src: entry.src,
      value: entry.value.seconds,
      duration: entry.value.duration === true,
      radix: TIM,
    };
  }
  return { src: entry.src, value: entry.value };
}

/** The stored shape back as something formatResult can render. */
export function fromStored(entry) {
  const radix = entryRadix(entry);
  if (radix === HEX) return { src: entry.src, value: BigInt(entry.value), radix: HEX };
  if (radix === TIM) {
    return {
      src: entry.src,
      value: { seconds: entry.value, duration: entry.duration === true },
      radix: TIM,
    };
  }
  return { src: entry.src, value: entry.value, radix: DEC };
}

/**
 * Newest first, consecutive repeats collapsed, capped. The repeat check includes
 * the radix, because "FF" in hex and "FF" in decimal are not the same entry.
 */
export function addEntry(list, entry) {
  const stored = toStored(entry);
  if (!isValidEntry(stored)) return list;
  const head = list[0];
  const dup = head && head.src === stored.src && entryRadix(head) === entryRadix(stored);
  return [stored, ...(dup ? list.slice(1) : list)].slice(0, MAX_ENTRIES);
}

export function parseHistory(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function serializeHistory(list) {
  return JSON.stringify(list.slice(0, MAX_ENTRIES));
}

export function loadHistory(storage) {
  try {
    return parseHistory(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveHistory(storage, list) {
  try {
    storage.setItem(STORAGE_KEY, serializeHistory(list));
    return true;
  } catch {
    return false; // private mode, or quota — the tape just will not persist
  }
}
