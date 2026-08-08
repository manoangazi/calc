/**
 * The history tape. Pure functions over a plain array so the storage round-trip
 * can be tested without a DOM.
 *
 * Entries are newest-first and validated on the way in *and* on the way out of
 * storage: localStorage is editable by anything that can run script on this
 * origin, so a stored expression is treated as untrusted input, not as data we
 * wrote and can trust.
 */
export const MAX_ENTRIES = 50;
export const STORAGE_KEY = 'manocalc.history';

const LEGAL_SRC = /^[0-9.+\-*/^()]+$/;
const MAX_SRC = 120;

export function isValidEntry(entry) {
  return (
    !!entry &&
    typeof entry.src === 'string' &&
    entry.src.length > 0 &&
    entry.src.length <= MAX_SRC &&
    LEGAL_SRC.test(entry.src) &&
    typeof entry.value === 'number' &&
    Number.isFinite(entry.value)
  );
}

/** Newest first, consecutive repeats collapsed, capped. */
export function addEntry(list, entry) {
  if (!isValidEntry(entry)) return list;
  const rest = list[0] && list[0].src === entry.src ? list.slice(1) : list;
  return [entry, ...rest].slice(0, MAX_ENTRIES);
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
