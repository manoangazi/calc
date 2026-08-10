/**
 * Live currency rates.
 *
 * The failure mode this defends against is not a crash. A reciprocal taken the
 * wrong way round, or a payload half-applied, produces a plausible-looking
 * number that is simply wrong — and money is the one category where the user
 * cannot eyeball the answer for sanity the way they can with `1 m = 3.28 ft`.
 *
 * Nothing here touches the network or real localStorage: `fetch` and the storage
 * object are both injected. Neither does anything read the real clock — every
 * staleness assertion takes an explicit `now`, or the suite would fail at
 * midnight and around a DST boundary.
 */
import {
  CODES, PIVOT, STALE_AFTER_MS, STORAGE_KEY,
  fetchRates, isStale, isValidSnapshot, loadCached, needsRefresh, parseFeed, saveCached, url,
} from '../src/currency.js';
import { CATEGORIES, applyRates, convert, defaultPair, findCategory, findUnit } from '../src/units.js';

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  if (Object.is(actual, expected)) pass++;
  else failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function ok(cond, label) {
  if (cond) pass++;
  else failures.push(label);
}

function near(actual, expected, label, eps = 1e-9) {
  const tol = eps * Math.max(1, Math.abs(expected));
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else failures.push(`${label}: expected ~${expected}, got ${actual}`);
}

const CURRENCY = findCategory('currency');
const cur = (id) => {
  const u = findUnit(CURRENCY, id);
  if (!u) throw new Error(`no such currency: ${id}`);
  return u;
};

/* Real rates from the feed on 2026-08-10, quoted ZAR -> X. Real ones rather than
   round numbers so a reciprocal slip cannot hide behind a tidy figure. */
const RATES = {
  USD: 0.06162, EUR: 0.05336, GBP: 0.04576, JPY: 9.7511, CHF: 0.0499,
  AUD: 0.08749, NZD: 0.10483, CAD: 0.0862, SEK: 0.58449, NOK: 0.58635,
  CNY: 0.4155, INR: 5.8653, AED: 0.22629, SGD: 0.0789, HKD: 0.48381,
  BWP: 0.82241, NAD: 1.0011,
};
const FEED_DATE = '2026-08-10';
const feed = (over = {}) =>
  Object.entries({ ...RATES, ...over }).map(([quote, rate]) => ({
    date: FEED_DATE, base: PIVOT, quote, rate,
  }));

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const snapshot = () => parseFeed(feed(), NOW);

/* ---- the table --------------------------------------------------------- */

ok(CURRENCY !== null, 'the currency category exists');
eq(CURRENCY.live, true, 'the currency category is marked live');
eq(CURRENCY.base, PIVOT, 'the currency base is the pivot');
eq(CURRENCY.units.length, CODES.length, 'one unit per code');
eq(new Set(CODES).size, CODES.length, 'currency codes are unique');

/* ---- parsing ------------------------------------------------------------ */

const snap = snapshot();
ok(snap !== null, 'a well-formed feed parses');
eq(snap.date, FEED_DATE, 'the snapshot carries the feed date');
eq(snap.fetchedAt, NOW, 'the snapshot carries our clock, not the feed date');
eq(snap.factors[PIVOT], 1, 'the pivot is unity');
ok(isValidSnapshot(snap), 'a parsed snapshot validates');

/* The direction that matters. The feed says 1 ZAR = 0.06162 USD, so a USD
   factor — which converts *to* ZAR — must be the reciprocal, ~16.23. Taking it
   the wrong way round yields a number that still looks like an exchange rate. */
near(snap.factors.USD, 1 / RATES.USD, 'the USD factor is the reciprocal of the quote');
ok(snap.factors.USD > 10, 'one dollar is more than ten rand, not less than one');

/* Rows can legitimately carry different dates; the oldest is the honest one. */
const mixed = parseFeed(
  [{ date: '2026-08-10', base: PIVOT, quote: 'USD', rate: 0.06 },
   { date: '2026-08-07', base: PIVOT, quote: 'BWP', rate: 0.82 }],
  NOW,
);
eq(mixed.date, '2026-08-07', 'a mixed-date feed reports the oldest date');

/* ---- rejection, whole rather than partial -------------------------------- */

const BAD = [
  ['not an array', {}],
  ['empty array', []],
  ['null', null],
  ['a null row', [null]],
  ['unknown code', feed().concat([{ date: FEED_DATE, base: PIVOT, quote: 'XXX', rate: 1 }])],
  ['zero rate', feed({ USD: 0 })],
  ['negative rate', feed({ USD: -0.06 })],
  ['NaN rate', feed({ USD: NaN })],
  ['Infinity rate', feed({ USD: Infinity })],
  ['string rate', feed({ USD: '0.06' })],
  ['missing date', [{ base: PIVOT, quote: 'USD', rate: 0.06 }]],
  ['malformed date', [{ date: '10/08/2026', base: PIVOT, quote: 'USD', rate: 0.06 }]],
];
for (const [label, data] of BAD) eq(parseFeed(data, NOW), null, `rejects ${label}`);

/* Rejection has to be whole. A partially applied set leaves some currencies live
   and others silently on yesterday's number, which is worse than being uniformly
   stale because nothing on screen distinguishes them. */
applyRates(snapshot());
const beforeBad = cur('USD').factor;
const partial = parseFeed(feed({ EUR: -1 }), NOW);
eq(partial, null, 'one bad row rejects the whole payload');
eq(applyRates(partial), false, 'applyRates refuses a null snapshot');
eq(cur('USD').factor, beforeBad, 'a rejected payload leaves existing factors untouched');

/* ---- identity across a refresh ------------------------------------------ */

/* The architectural trap. ui.js holds the selected units as object references
   and convert() compares them by identity, so a refresh that rebuilt the array
   would strand a live selection on orphans: the pickers would still read
   USD -> JPY while the arithmetic used detached objects. */
const usdRef = cur('USD');
applyRates(snapshot());
applyRates(parseFeed(feed({ USD: 0.07 }), NOW + 1000));
eq(cur('USD'), usdRef, 'a refresh mutates the same unit object');
near(usdRef.factor, 1 / 0.07, 'the held reference sees the new rate');
eq(convert(123.456, usdRef, cur('USD')), 123.456, 'identity still short-circuits after a refresh');

/* ---- conversion --------------------------------------------------------- */

applyRates(snapshot());

near(convert(1, cur('USD'), cur('ZAR')), 1 / RATES.USD, '1 USD in ZAR');
near(convert(1, cur('ZAR'), cur('USD')), RATES.USD, '1 ZAR in USD');
/* A cross neither leg of which is the pivot — the case the ZAR pivot exists for. */
near(convert(1, cur('USD'), cur('JPY')), RATES.JPY / RATES.USD, '1 USD in JPY via the pivot');
near(convert(1, cur('GBP'), cur('EUR')), RATES.EUR / RATES.GBP, '1 GBP in EUR via the pivot');
/* The CMA peg, which should come back at roughly parity. */
near(convert(100, cur('NAD'), cur('ZAR')), 100 / RATES.NAD, '100 NAD in ZAR');

const SAMPLES = [0, 1, -40, 0.5, 123.456, -7, 1e6];
for (const a of CURRENCY.units) {
  for (const x of SAMPLES) eq(convert(x, a, a), x, `currency/${a.id}: identity`);
  for (const b of CURRENCY.units) {
    for (const x of SAMPLES) {
      near(convert(convert(x, a, b), b, a), x, `currency: ${a.id}→${b.id}→${a.id} of ${x}`);
    }
  }
}

const { from, to } = defaultPair(CURRENCY);
ok(CURRENCY.units.includes(from) && CURRENCY.units.includes(to), 'default pair is from this category');
eq(from.id, 'ZAR', 'currency opens on ZAR');
ok(from !== to, 'the default pair converts between two different currencies');

/* ---- the unpriced path -------------------------------------------------- */

/* Null rather than NaN, because "no rates yet" and "the sum was nonsense" get
   different captions and NaN cannot tell them apart. */
for (const u of CURRENCY.units) u.factor = u.id === PIVOT ? 1 : null;
eq(convert(1, cur('USD'), cur('ZAR')), null, 'an unpriced source converts to null');
eq(convert(1, cur('ZAR'), cur('USD')), null, 'an unpriced target converts to null');
eq(convert(5, cur('USD'), cur('USD')), 5, 'an unpriced currency is still identity with itself');
applyRates(snapshot());

/* ---- storage ------------------------------------------------------------ */

const fakeStorage = (initial = null) => {
  let v = initial;
  return {
    getItem: (k) => (k === STORAGE_KEY ? v : null),
    setItem: (k, s) => { if (k === STORAGE_KEY) v = s; },
    read: () => v,
  };
};

const store = fakeStorage();
eq(saveCached(store, snap), true, 'a snapshot saves');
const round = loadCached(store);
eq(round.date, snap.date, 'the cached date round-trips');
eq(round.fetchedAt, snap.fetchedAt, 'the cached fetchedAt round-trips');
near(round.factors.USD, snap.factors.USD, 'the cached USD factor round-trips');

/* localStorage is editable by anything that can run script on this origin, so a
   stored snapshot is untrusted input on the way out as well as in. */
const TAMPERED = [
  ['not JSON', '{'],
  ['null', 'null'],
  ['an array', '[]'],
  ['no factors', JSON.stringify({ date: FEED_DATE, fetchedAt: NOW })],
  ['empty factors', JSON.stringify({ date: FEED_DATE, fetchedAt: NOW, factors: {} })],
  ['a negative factor', JSON.stringify({ date: FEED_DATE, fetchedAt: NOW, factors: { USD: -1 } })],
  ['a string factor', JSON.stringify({ date: FEED_DATE, fetchedAt: NOW, factors: { USD: '16' } })],
  ['an unknown code', JSON.stringify({ date: FEED_DATE, fetchedAt: NOW, factors: { XXX: 1 } })],
  ['a missing fetchedAt', JSON.stringify({ date: FEED_DATE, factors: { USD: 16 } })],
  ['a malformed date', JSON.stringify({ date: 'yesterday', fetchedAt: NOW, factors: { USD: 16 } })],
];
for (const [label, raw] of TAMPERED) eq(loadCached(fakeStorage(raw)), null, `rejects cache with ${label}`);

/* Private mode: setItem throws, and that must not propagate. */
const throwingStore = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};
eq(saveCached(throwingStore, snap), false, 'a refused save reports false rather than throwing');
eq(loadCached(throwingStore), null, 'a refused read returns null rather than throwing');

/* ---- staleness: our clock, never the feed's ----------------------------- */

const MIN = 60000;
eq(isStale(null, NOW), true, 'no snapshot at all is stale');
eq(isStale({ ...snap, fetchedAt: NOW }, NOW), false, 'a just-fetched snapshot is fresh');
eq(isStale({ ...snap, fetchedAt: NOW - STALE_AFTER_MS + MIN }, NOW), false, 'just inside the window is fresh');
eq(isStale({ ...snap, fetchedAt: NOW - STALE_AFTER_MS }, NOW), true, 'exactly at the window is stale');
eq(isStale({ ...snap, fetchedAt: NOW - 3 * STALE_AFTER_MS }, NOW), true, 'three days out is stale');

/* The whole reason for two clocks. The ECB does not publish at weekends, so on
   Sunday the newest rate available *is* Friday's — that is correct data, not
   stale data. Keying the warning off the feed's date instead of ours would go
   red every weekend and train the user to ignore the one signal that matters. */
const FRIDAY = '2026-08-07';
const SUNDAY_NOON = Date.UTC(2026, 7, 9, 12, 0, 0);
const readOnSunday = { date: FRIDAY, fetchedAt: SUNDAY_NOON - MIN, factors: snap.factors };
eq(isStale(readOnSunday, SUNDAY_NOON), false, "Friday's rate fetched on Sunday is NOT stale");
ok(isValidSnapshot(readOnSunday), 'a weekend-old feed date is still a valid snapshot');

/* ---- the once-a-day gate ------------------------------------------------ */

const at = (y, m, d, h) => new Date(y, m, d, h).getTime(); // local time, as the gate is
eq(needsRefresh(null, at(2026, 7, 10, 9)), true, 'no cache always refreshes');
eq(needsRefresh({ fetchedAt: at(2026, 7, 10, 8) }, at(2026, 7, 10, 23)), false,
   'a fetch earlier the same day does not refresh again');
eq(needsRefresh({ fetchedAt: at(2026, 7, 9, 23) }, at(2026, 7, 10, 0)), true,
   'one minute over midnight refreshes');
eq(needsRefresh({ fetchedAt: at(2025, 7, 10, 12) }, at(2026, 7, 10, 12)), true,
   'the same day a year earlier refreshes');

/* ---- fetchRates, with a stubbed fetch ----------------------------------- */

const res = (body, opts = {}) => ({ ok: true, json: async () => body, ...opts });
const stub = (impl) => { let calls = 0; return { fn: async (...a) => { calls++; return impl(...a); }, calls: () => calls }; };

ok(url().startsWith('https://api.frankfurter.dev/'), 'the endpoint is the one origin the CSP allows');
ok(!url().includes(`quotes=${PIVOT},`) && url().includes('USD'), 'the pivot is not requested as its own quote');

const good = await fetchRates(async () => res(feed()), NOW);
near(good.factors.USD, 1 / RATES.USD, 'fetchRates parses a good response');
eq(good.fetchedAt, NOW, 'fetchRates stamps the injected clock');

/* Offline, a CSP block and a 500 are ordinary conditions here, not errors: this
   is a calculator that works without the network, so each must return null
   rather than escape and take the boot path down with it. */
eq(await fetchRates(async () => { throw new TypeError('Failed to fetch'); }, NOW), null,
   'a network throw returns null');
eq(await fetchRates(async () => res(null, { ok: false, status: 500 }), NOW), null,
   'a 500 returns null');
eq(await fetchRates(async () => res(null, { ok: false, status: 429 }), NOW), null,
   'a rate-limit returns null');
eq(await fetchRates(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }), NOW), null,
   'unparseable JSON returns null');
eq(await fetchRates(async () => undefined, NOW), null, 'no response at all returns null');
eq(await fetchRates(async () => res(feed({ USD: 0 })), NOW), null, 'a bad rate returns null');

const counted = stub(async () => res(feed()));
await fetchRates(counted.fn, NOW);
eq(counted.calls(), 1, 'one fetch per call, no retry storm');

/* ---- report ------------------------------------------------------------- */

if (failures.length) {
  console.error(`${failures.length} failed:`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`${pass} passed`);
