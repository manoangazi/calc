/**
 * The CON-mode unit table.
 *
 * Two things are being defended here. One is the table itself — a wrong factor
 * is a silently wrong answer, not a crash, so every category gets a fixture with
 * an independently known value. The other is the affine path: temperature is the
 * only category with an offset, and it is where a `factor[from]/factor[to]`
 * shortcut would produce plausible nonsense.
 */
import { CATEGORIES, convert, defaultPair, findCategory, findUnit } from '../src/units.js';
import { formatResult } from '../src/format.js';

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  if (Object.is(actual, expected)) pass++;
  else failures.push(`${label}: expected ${expected}, got ${actual}`);
}

/* 5/9 is not representable, so every conversion carries float noise. A relative
   epsilon is the only honest comparison; Object.is would fail on arithmetic that
   is correct. */
function near(actual, expected, label, eps = 1e-9) {
  const tol = eps * Math.max(1, Math.abs(expected));
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else failures.push(`${label}: expected ~${expected}, got ${actual}`);
}

const unit = (catId, unitId) => {
  const u = findUnit(findCategory(catId), unitId);
  if (!u) throw new Error(`no such unit: ${catId}/${unitId}`);
  return u;
};

/* ---- table integrity ----------------------------------------------------- */

eq(CATEGORIES.length, 11, 'eleven categories');

/* Currency's factors arrive from a feed and are null until they do, so it fails
   every static assertion below by design. It is not thereby less covered:
   currency.test.mjs applies a fixture snapshot and then runs this same integrity
   and round-trip battery against it. */
const STATIC = CATEGORIES.filter((c) => !c.live);
eq(STATIC.length, 10, 'ten categories with static factors');

for (const cat of STATIC) {
  if (cat.units.length >= 2) pass++;
  else failures.push(`${cat.id}: a category with one unit converts nothing`);

  const ids = new Set(cat.units.map((u) => u.id));
  eq(ids.size, cat.units.length, `${cat.id}: unit ids are unique`);

  for (const u of cat.units) {
    if (Number.isFinite(u.factor) && u.factor !== 0) pass++;
    else failures.push(`${cat.id}/${u.id}: factor must be finite and non-zero`);
    if (u.offset === undefined || Number.isFinite(u.offset)) pass++;
    else failures.push(`${cat.id}/${u.id}: offset must be finite`);
  }

  // Exactly one unit is the identity, and it is the declared base.
  const identity = cat.units.filter((u) => u.factor === 1 && (u.offset ?? 0) === 0);
  eq(identity.length, 1, `${cat.id}: exactly one identity unit`);
  eq(identity[0]?.id, cat.base, `${cat.id}: the identity unit is the declared base`);

  // The pair the category opens on has to exist in it.
  const { from, to } = defaultPair(cat);
  if (cat.units.includes(from) && cat.units.includes(to)) pass++;
  else failures.push(`${cat.id}: default pair is not from this category`);
  if (from !== to) pass++;
  else failures.push(`${cat.id}: default pair converts a unit to itself`);
}

/* ---- identity and round trips -------------------------------------------- */

const SAMPLES = [0, 1, -40, 0.5, 123.456, -7, 1e6];

for (const cat of STATIC) {
  for (const a of cat.units) {
    for (const x of SAMPLES) eq(convert(x, a, a), x, `${cat.id}/${a.id}: identity`);
    for (const b of cat.units) {
      for (const x of SAMPLES) {
        near(convert(convert(x, a, b), b, a), x, `${cat.id}: ${a.id}→${b.id}→${a.id} of ${x}`);
      }
    }
  }
}

/* ---- known values -------------------------------------------------------- */

near(convert(1, unit('length', 'mi'), unit('length', 'm')), 1609.344, '1 mi in m');
near(convert(1, unit('length', 'in'), unit('length', 'cm')), 2.54, '1 in in cm');
near(convert(1, unit('mass', 'lb'), unit('mass', 'kg')), 0.45359237, '1 lb in kg');
near(convert(1, unit('mass', 'st'), unit('mass', 'lb')), 14, '1 st in lb');

// The affine category, at both ends and at the crossing point.
near(convert(100, unit('temp', 'C'), unit('temp', 'F')), 212, '100 C in F');
near(convert(0, unit('temp', 'C'), unit('temp', 'F')), 32, '0 C in F');
near(convert(-40, unit('temp', 'C'), unit('temp', 'F')), -40, '-40 C in F');
near(convert(0, unit('temp', 'K'), unit('temp', 'C')), -273.15, '0 K in C');
near(convert(0, unit('temp', 'K'), unit('temp', 'F')), -459.67, '0 K in F');
near(convert(212, unit('temp', 'F'), unit('temp', 'K')), 373.15, '212 F in K');

near(convert(1, unit('volume', 'gal'), unit('volume', 'L')), 3.785411784, '1 gal (US) in L');
near(convert(1, unit('volume', 'galuk'), unit('volume', 'L')), 4.54609, '1 gal (UK) in L');
near(convert(1, unit('volume', 'm3'), unit('volume', 'L')), 1000, '1 m3 in L');
near(convert(1, unit('area', 'acre'), unit('area', 'm2')), 4046.8564224, '1 acre in m2');
near(convert(1, unit('area', 'ha'), unit('area', 'm2')), 10000, '1 ha in m2');
near(convert(1, unit('speed', 'kn'), unit('speed', 'kmh')), 1.852, '1 knot in km/h');
near(convert(60, unit('speed', 'mph'), unit('speed', 'kmh')), 96.56064, '60 mph in km/h');

// Both data scales, and the one that must never be conflated with the other.
near(convert(1, unit('data', 'GiB'), unit('data', 'B')), 1073741824, '1 GiB in B');
near(convert(1, unit('data', 'GB'), unit('data', 'B')), 1e9, '1 GB in B');
near(convert(1, unit('data', 'B'), unit('data', 'bit')), 8, '1 B in bit');
near(convert(1, unit('data', 'TiB'), unit('data', 'GiB')), 1024, '1 TiB in GiB');

near(convert(1, unit('time', 'h'), unit('time', 's')), 3600, '1 h in s');
near(convert(1, unit('time', 'wk'), unit('time', 'd')), 7, '1 wk in d');
near(convert(1, unit('pressure', 'atm'), unit('pressure', 'Pa')), 101325, '1 atm in Pa');
near(convert(1, unit('pressure', 'bar'), unit('pressure', 'psi')), 14.503773773, '1 bar in psi', 1e-8);
near(convert(1, unit('energy', 'kWh'), unit('energy', 'J')), 3600000, '1 kWh in J');
near(convert(1, unit('energy', 'kcal'), unit('energy', 'cal')), 1000, '1 kcal in cal');

/* ---- the display is what hides the float noise --------------------------- */

// Raw, this is 98.60000000000001. formatResult rounds to 12 significant digits,
// which is the entire reason CON can run on doubles without looking broken.
eq(formatResult(convert(37, unit('temp', 'C'), unit('temp', 'F'))), '98.6', '37 C renders as 98.6');
eq(formatResult(convert(1, unit('length', 'm'), unit('length', 'ft'))), '3.28083989501',
  '1 m renders in ft');

/* ---- nothing produces NaN ------------------------------------------------ */

/* Seeded so a failure is reproducible. Any NaN escaping here would reach the
   display as "NaN" rather than as an error, since CON has no fault path. */
let seed = 0x1a2b3c4d;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let clean = 0;
for (let i = 0; i < 20000; i++) {
  const cat = STATIC[Math.floor(rand() * STATIC.length)];
  const a = cat.units[Math.floor(rand() * cat.units.length)];
  const b = cat.units[Math.floor(rand() * cat.units.length)];
  const x = (rand() - 0.5) * 10 ** Math.floor(rand() * 20 - 10);
  const out = convert(x, a, b);
  if (Number.isNaN(out)) {
    failures.push(`convert(${x}, ${cat.id}/${a.id}, ${cat.id}/${b.id}) produced NaN`);
    break;
  }
  clean++;
}
eq(clean, 20000, 'no random conversion produces NaN');

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const f of failures.slice(0, 20)) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${pass} passed`);
