/*
 * Live exchange rates for the CON currency category.
 *
 * Pure and DOM-free apart from an injected `fetch`, so the tests drive it with a
 * stub and nothing in the suite touches the network.
 *
 * Source is Frankfurter (ECB-derived daily reference rates). It was chosen for
 * one blunt reason: this repo is public and has no server, so an API key would
 * be world-readable the moment it was committed. Every near-realtime provider
 * needs one. Keyless therefore means *daily reference rates*, and the UI has to
 * caption the date rather than let the number imply a freshness it lacks.
 *
 * Two clocks, and the distinction is the whole point:
 *
 *   `date`      the feed's own publication date
 *   `fetchedAt` when *we* last reached the feed
 *
 * The ECB does not publish at weekends, so a Friday rate served on a Sunday is
 * correct rather than stale. Staleness keys off `fetchedAt` alone — anything
 * else would flag every weekend and teach the user to ignore the warning.
 */

/** Everything is quoted against ZAR, so any cross is one division. */
export const PIVOT = 'ZAR';

export const ENDPOINT = 'https://api.frankfurter.dev/v2/rates';
export const STORAGE_KEY = 'manocalc.rates';

/**
 * The majors plus the SA trade partners and the CMA pegs. Every one is verified
 * present on the feed; a code the feed does not carry would simply never get a
 * factor and would render as unavailable rather than as a wrong number.
 */
export const CODES = [
  'ZAR', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD',
  'SEK', 'NOK', 'CNY', 'INR', 'AED', 'SGD', 'HKD', 'BWP', 'NAD',
];

const QUOTES = CODES.filter((c) => c !== PIVOT);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/** Past this, we have not reached the feed for a day and the UI says so. */
export const STALE_AFTER_MS = DAY_MS;

export const url = () => `${ENDPOINT}?base=${PIVOT}&quotes=${QUOTES.join(',')}`;

const isRate = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * A feed response as a snapshot, or `null`.
 *
 * The feed is untrusted input in exactly the way `localStorage` already is, so
 * it gets the same treatment as `history.js` gives stored entries. A malformed
 * or partial payload is rejected *whole*: a half-applied rate set would leave
 * some currencies live and others silently on yesterday's number, which is worse
 * than being uniformly stale and is invisible on screen.
 *
 * The feed quotes ZAR -> X. A `units.js` factor converts *to* the category base,
 * which is ZAR, so it is the reciprocal. Getting this backwards yields plausible
 * numbers in the wrong direction, which is why the tests pin a known cross.
 */
export function parseFeed(data, now) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const factors = { [PIVOT]: 1 };
  let date = null;

  for (const row of data) {
    if (!row || typeof row !== 'object') return null;
    if (typeof row.quote !== 'string' || !CODES.includes(row.quote)) return null;
    if (typeof row.date !== 'string' || !ISO_DATE.test(row.date)) return null;
    if (!isRate(row.rate)) return null;

    // Rows can carry different dates when a thinly-traded currency did not
    // publish today. The oldest is the honest one to show for the set.
    if (date === null || row.date < date) date = row.date;
    factors[row.quote] = 1 / row.rate;
  }

  if (date === null) return null;
  return { date, fetchedAt: now, factors };
}

/** True for a snapshot shape we are willing to hand to the conversion table. */
export function isValidSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return false;
  if (typeof snap.date !== 'string' || !ISO_DATE.test(snap.date)) return false;
  if (typeof snap.fetchedAt !== 'number' || !Number.isFinite(snap.fetchedAt)) return false;
  if (!snap.factors || typeof snap.factors !== 'object') return false;

  const codes = Object.keys(snap.factors);
  if (codes.length === 0) return false;
  return codes.every((c) => CODES.includes(c) && isRate(snap.factors[c]));
}

/**
 * The current rates, or `null`.
 *
 * Never throws. Offline, DNS failure and a CSP block are all normal conditions
 * here rather than errors — the app is a calculator first and works completely
 * without the network, so a refusal has to be as unremarkable as a cache miss.
 */
export async function fetchRates(fetchImpl = fetch, now = Date.now()) {
  try {
    const res = await fetchImpl(url(), { cache: 'no-store' });
    if (!res || !res.ok) return null;
    return parseFeed(await res.json(), now);
  } catch {
    return null;
  }
}

export function loadCached(storage) {
  try {
    const snap = JSON.parse(storage.getItem(STORAGE_KEY));
    return isValidSnapshot(snap) ? snap : null;
  } catch {
    return null;
  }
}

export function saveCached(storage, snapshot) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false; // private mode, or quota — rates just will not survive a reload
  }
}

/** Whether we have failed to reach the feed for long enough to say so. */
export function isStale(snapshot, now) {
  if (!snapshot) return true;
  return now - snapshot.fetchedAt >= STALE_AFTER_MS;
}

/**
 * Whether to spend a request on this open.
 *
 * Once per calendar day, in local time. A fixed hour was considered and is not
 * buildable: a PWA has no background scheduler, so nothing wakes the app at 8am
 * unless it is already open. "First open of the day" is the honest version of
 * the same intent, and at 237 bytes gzipped the request is not worth a finer
 * policy than that.
 */
export function needsRefresh(snapshot, now) {
  if (!snapshot) return true;
  const a = new Date(snapshot.fetchedAt);
  const b = new Date(now);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}
