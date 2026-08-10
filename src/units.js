/*
 * The unit table for CON mode.
 *
 * Pure and DOM-free, so the tests import it directly. Every unit is expressed
 * against its category's base unit as `value * factor + offset`, and the offset
 * exists for exactly one reason: temperature. °F and K are affine, not
 * proportional, which is why there is no `factor[from] / factor[to]` shortcut
 * anywhere in this file — a conversion always goes through the base.
 */

/** value in `unit` → value in the category's base unit. */
const toBase = (value, unit) => value * unit.factor + (unit.offset ?? 0);

/** value in the category's base unit → value in `unit`. */
const fromBase = (base, unit) => (base - (unit.offset ?? 0)) / unit.factor;

/**
 * Convert between two units of the same category.
 *
 * Takes resolved unit *objects*, not ids, so it is pure arithmetic with no
 * failure mode — the caller resolves ids through `findUnit` and can never hand
 * this garbage.
 */
export function convert(value, from, to) {
  // Short-circuited rather than left to fall out of the arithmetic: x*f/f is not
  // x for most f, so without this, picking the same unit on both sides would
  // shift the last digit of a number the user can see is unchanged.
  if (from === to) return value;
  return fromBase(toBase(value, from), to);
}

export const CATEGORIES = [
  {
    id: 'length',
    label: 'Length',
    base: 'm',
    units: [
      { id: 'mm', label: 'mm', factor: 0.001 },
      { id: 'cm', label: 'cm', factor: 0.01 },
      { id: 'm', label: 'm', factor: 1 },
      { id: 'km', label: 'km', factor: 1000 },
      { id: 'in', label: 'in', factor: 0.0254 },
      { id: 'ft', label: 'ft', factor: 0.3048 },
      { id: 'yd', label: 'yd', factor: 0.9144 },
      { id: 'mi', label: 'mi', factor: 1609.344 },
      { id: 'nmi', label: 'nmi', factor: 1852 },
    ],
  },
  {
    id: 'mass',
    label: 'Mass',
    base: 'kg',
    units: [
      { id: 'mg', label: 'mg', factor: 1e-6 },
      { id: 'g', label: 'g', factor: 0.001 },
      { id: 'kg', label: 'kg', factor: 1 },
      { id: 't', label: 't', factor: 1000 },
      { id: 'oz', label: 'oz', factor: 0.028349523125 },
      { id: 'lb', label: 'lb', factor: 0.45359237 },
      { id: 'st', label: 'st', factor: 6.35029318 },
    ],
  },
  {
    /*
     * The only affine category. °F comes from C = (F − 32)·5/9, which expands to
     * C = F·(5/9) − 160/9 — hence factor 5/9 and offset −160/9, written as
     * fractions so the source shows where they came from.
     *
     * These are absolute temperatures, not differences: a 10 °C *rise* is 18 °F,
     * but this converts 10 °C to 50 °F, which is the right answer for the
     * question a calculator is being asked.
     */
    id: 'temp',
    label: 'Temperature',
    base: 'C',
    units: [
      { id: 'C', label: '°C', factor: 1 },
      { id: 'F', label: '°F', factor: 5 / 9, offset: -160 / 9 },
      { id: 'K', label: 'K', factor: 1, offset: -273.15 },
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    base: 'L',
    units: [
      { id: 'mL', label: 'mL', factor: 0.001 },
      { id: 'L', label: 'L', factor: 1 },
      { id: 'm3', label: 'm³', factor: 1000 },
      { id: 'tsp', label: 'tsp (US)', factor: 0.00492892159375 },
      { id: 'tbsp', label: 'tbsp (US)', factor: 0.01478676478125 },
      { id: 'floz', label: 'fl oz (US)', factor: 0.0295735295625 },
      { id: 'cup', label: 'cup (US)', factor: 0.2365882365 },
      { id: 'pt', label: 'pt (US)', factor: 0.473176473 },
      { id: 'qt', label: 'qt (US)', factor: 0.946352946 },
      { id: 'gal', label: 'gal (US)', factor: 3.785411784 },
      { id: 'galuk', label: 'gal (UK)', factor: 4.54609 },
    ],
  },
  {
    id: 'area',
    label: 'Area',
    base: 'm2',
    units: [
      { id: 'mm2', label: 'mm²', factor: 1e-6 },
      { id: 'cm2', label: 'cm²', factor: 1e-4 },
      { id: 'm2', label: 'm²', factor: 1 },
      { id: 'ha', label: 'ha', factor: 10000 },
      { id: 'km2', label: 'km²', factor: 1e6 },
      { id: 'in2', label: 'in²', factor: 0.00064516 },
      { id: 'ft2', label: 'ft²', factor: 0.09290304 },
      { id: 'yd2', label: 'yd²', factor: 0.83612736 },
      { id: 'acre', label: 'acre', factor: 4046.8564224 },
      { id: 'mi2', label: 'mi²', factor: 2589988.110336 },
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    base: 'mps',
    units: [
      { id: 'mps', label: 'm/s', factor: 1 },
      { id: 'kmh', label: 'km/h', factor: 1000 / 3600 },
      { id: 'mph', label: 'mph', factor: 0.44704 },
      { id: 'fps', label: 'ft/s', factor: 0.3048 },
      { id: 'kn', label: 'knot', factor: 1852 / 3600 },
    ],
  },
  {
    /*
     * Both scales, correctly named. This app has a hex mode, so it gets used for
     * "the disk says 500 GB" (SI) and "the allocator says 4 MiB" (binary) alike;
     * picking one scale would be wrong half the time with no way for the user to
     * tell which was in force. What is never acceptable is labelling 1024² "MB".
     */
    id: 'data',
    label: 'Data',
    base: 'B',
    units: [
      { id: 'bit', label: 'bit', factor: 0.125 },
      { id: 'B', label: 'B', factor: 1 },
      { id: 'kB', label: 'kB', factor: 1e3 },
      { id: 'KiB', label: 'KiB', factor: 1024 },
      { id: 'MB', label: 'MB', factor: 1e6 },
      { id: 'MiB', label: 'MiB', factor: 1024 ** 2 },
      { id: 'GB', label: 'GB', factor: 1e9 },
      { id: 'GiB', label: 'GiB', factor: 1024 ** 3 },
      { id: 'TB', label: 'TB', factor: 1e12 },
      { id: 'TiB', label: 'TiB', factor: 1024 ** 4 },
    ],
  },
  {
    /* Stops at weeks. A month is 28-31 days and a year is 365 or 366, so
       converting to either would be quietly making something up. */
    id: 'time',
    label: 'Time',
    base: 's',
    units: [
      { id: 'ms', label: 'ms', factor: 0.001 },
      { id: 's', label: 's', factor: 1 },
      { id: 'min', label: 'min', factor: 60 },
      { id: 'h', label: 'h', factor: 3600 },
      { id: 'd', label: 'd', factor: 86400 },
      { id: 'wk', label: 'wk', factor: 604800 },
    ],
  },
  {
    id: 'pressure',
    label: 'Pressure',
    base: 'Pa',
    units: [
      { id: 'Pa', label: 'Pa', factor: 1 },
      { id: 'hPa', label: 'hPa', factor: 100 },
      { id: 'kPa', label: 'kPa', factor: 1000 },
      { id: 'bar', label: 'bar', factor: 100000 },
      { id: 'atm', label: 'atm', factor: 101325 },
      { id: 'psi', label: 'psi', factor: 4.4482216152605 / 0.00064516 },
      { id: 'mmHg', label: 'mmHg', factor: 133.322387415 },
      { id: 'inHg', label: 'inHg', factor: 3386.388640341 },
    ],
  },
  {
    id: 'energy',
    label: 'Energy',
    base: 'J',
    units: [
      { id: 'J', label: 'J', factor: 1 },
      { id: 'kJ', label: 'kJ', factor: 1000 },
      { id: 'cal', label: 'cal', factor: 4.184 },
      { id: 'kcal', label: 'kcal', factor: 4184 },
      { id: 'Wh', label: 'Wh', factor: 3600 },
      { id: 'kWh', label: 'kWh', factor: 3600000 },
      { id: 'BTU', label: 'BTU', factor: 1055.05585262 },
    ],
  },
];

/** The category CON opens on. Length is the one everybody reaches for first. */
export const DEFAULT_CATEGORY = 'length';

export function findCategory(id) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

export function findUnit(category, id) {
  if (!category) return null;
  return category.units.find((u) => u.id === id) ?? null;
}

/**
 * The pair a category opens on: its base unit, and the next most likely
 * counterpart. Chosen per category rather than "first two", so Length opens on
 * m → ft rather than mm → cm.
 */
const DEFAULT_PAIR = {
  length: ['m', 'ft'],
  mass: ['kg', 'lb'],
  temp: ['C', 'F'],
  volume: ['L', 'gal'],
  area: ['m2', 'ft2'],
  speed: ['kmh', 'mph'],
  data: ['MiB', 'MB'],
  time: ['h', 'min'],
  pressure: ['bar', 'psi'],
  energy: ['kJ', 'kcal'],
};

export function defaultPair(category) {
  const [from, to] = DEFAULT_PAIR[category.id] ?? [];
  return {
    from: findUnit(category, from) ?? category.units[0],
    to: findUnit(category, to) ?? category.units[1] ?? category.units[0],
  };
}
