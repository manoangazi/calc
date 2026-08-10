/**
 * TIM mode: the literal grammar, the duration/scalar type system, and the
 * rounding that whole-second granularity implies.
 *
 * Three things are being defended. The **grammar**, because reading `.1` as a
 * tenth rather than as one second is a silently wrong answer, not a crash. The
 * **equivalence of the two spellings**, because they are meant to be one value
 * type reached two ways and nothing downstream may be able to tell which was
 * typed. And the **type rules**, because a time calculator that lets `2h * 3h`
 * return a number is worse than no time calculator.
 */
import { parse } from '../src/parser.js';
import { evaluateTime } from '../src/eval.js';
import { TIM } from '../src/tokenizer.js';
import { isCalcError } from '../src/errors.js';
import {
  canInsertMarker, decimalHours, formatDuration, parseLiteral, toBuffer,
} from '../src/time.js';

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

/** Evaluate a TIM source string. Returns the value, or the CalcError code. */
function run(src) {
  try {
    return evaluateTime(parse(src, TIM));
  } catch (e) {
    if (!isCalcError(e)) throw e;
    return e.code;
  }
}

/** What the display would show. */
const shown = (src) => {
  const v = run(src);
  return typeof v === 'string' ? v : v.duration ? formatDuration(v.seconds) : v.seconds;
};

const seconds = (src) => {
  const v = run(src);
  return typeof v === 'string' ? v : v.seconds;
};

/* ---- the grammar, both spellings ----------------------------------------- */

/* [colon form, suffix form, seconds]. Every row asserts three things: each
   spelling parses to the stated value, and the two agree with each other. The
   agreement check is the one that keeps them from drifting apart later. */
const GRAMMAR = [
  ['1:20.45', '1h20m45s', 1 * 3600 + 20 * 60 + 45],
  ['1:20', '1h20m', 1 * 3600 + 20 * 60],
  ['1:20', '1h20', 1 * 3600 + 20 * 60],
  ['1:', '1h', 3600],
  ['20.45', '20m45s', 20 * 60 + 45],
  ['20.45', '20m45', 20 * 60 + 45],
  ['.45', '45s', 45],
  ['.1', '1s', 1],                    // one second, not a tenth of anything
  [':90', '90m', 90 * 60],            // fields may overflow on input
  ['.90', '90s', 90],
  ['100:', '100h', 100 * 3600],
  ['0:00.00', '0s', 0],
];

for (const [colon, suffix, secs] of GRAMMAR) {
  const a = parseLiteral(colon);
  const b = parseLiteral(suffix);
  eq(a.seconds, secs, `${colon} is ${secs}s`);
  eq(b.seconds, secs, `${suffix} is ${secs}s`);
  ok(a.duration === true && b.duration === true, `${colon}/${suffix} are durations`);
  ok(a.seconds === b.seconds, `${colon} and ${suffix} agree`);
}

/* A literal with no marker at all is a scalar. This is what makes `1h / 2` mean
   what it looks like, and it is the whole reason the type system below works. */
for (const text of ['2', '0', '45', '1000']) {
  const v = parseLiteral(text);
  ok(v.duration === false, `${text} is a scalar`);
  eq(v.seconds, Number(text), `${text} carries its own value`);
}

/* ---- malformed literals -------------------------------------------------- */

const MALFORMED = [
  '1:2:3', '1.2.3', '1.2:3', ':', '.',        // colon form
  '20m1h', '1h2h', 'h', 's', '1s2s',          // suffix form: order and repeats
  '1h20.45', '1:20m', '.45s',                 // mixing the two spellings
];

for (const text of MALFORMED) {
  let threw = false;
  try {
    parseLiteral(text);
  } catch (e) {
    threw = isCalcError(e) && e.code === 'syntax';
  }
  ok(threw, `${text} is rejected as syntax`);
}

/* ---- canonical output ---------------------------------------------------- */

eq(formatDuration(0), '0:00:00', 'zero');
eq(formatDuration(45), '0:00:45', '45 seconds pads both fields');
eq(formatDuration(90), '0:01:30', '90 seconds normalises');
eq(formatDuration(3600), '1:00:00', 'an hour');
eq(formatDuration(99000), '27:30:00', 'past 24h, hours accumulate — no days');
eq(formatDuration(-3600), '-1:00:00', 'negative');
eq(formatDuration(-45), '-0:00:45', 'negative under a minute keeps its sign');
eq(formatDuration(Infinity), '∞', 'non-finite does not render as a time');

/* ---- the worked examples ------------------------------------------------- */

eq(shown('1:20.45+1:05.1'), '2:25:46', '1:20.45 + 1:05.1');
eq(shown('1h20m45s+1h5m1s'), '2:25:46', 'the same sum in the suffix spelling');
eq(shown('1:00.00/2'), '0:30:00', 'an hour halved');
eq(shown('90m+30m'), '2:00:00', '90m + 30m is two hours, not 1:20');
eq(shown('1h20+30m'), '1:50:00', '1h20 + 30m');
eq(shown('2h-3h'), '-1:00:00', 'a negative duration');
eq(shown('27h30m'), '27:30:00', 'no rollover into days');

/* ---- the type table ------------------------------------------------------ */

// duration ÷ duration cancels to a plain number, and must not render as a time.
const slots = run('3h/20m');
ok(slots.duration === false, '3h / 20m is a scalar');
eq(slots.seconds, 9, 'nine 20-minute slots in three hours');
eq(shown('3h/20m'), 9, 'and shows as 9, not 0:00:09');

ok(run('1h*3').duration === true, 'duration times scalar is a duration');
ok(run('3*1h').duration === true, 'scalar times duration is a duration');
ok(run('1h/2').duration === true, 'duration over scalar is a duration');
ok(run('2+3').duration === false, 'scalar arithmetic stays scalar');
eq(seconds('2^3'), 8, 'scalars may be raised to powers');

const ILLEGAL = [
  ['2h*3h', 'duration times duration'],
  ['1h+2', 'duration plus scalar'],
  ['2+1h', 'scalar plus duration'],
  ['1h-2', 'duration minus scalar'],
  ['2/1h', 'scalar over duration'],
  ['1h^2', 'duration to a power'],
  ['2^1h', 'a duration as an exponent'],
];

for (const [src, label] of ILLEGAL) eq(run(src), 'timetype', `${label} is refused`);

eq(run('1h/0'), 'divzero', 'divide by zero still says so');
eq(run('1h/0s'), 'divzero', 'a zero duration divisor too');

/* ---- rounding, and the trade-off it implies ------------------------------ */

/* Whole seconds is the model, not a display rounding — so the loss happens at
   the operation and is visible on the way back. Pinned deliberately: this is the
   documented cost of 1-second granularity, and a future change to it should have
   to come and edit this line. */
eq(shown('1h/7'), '0:08:34', 'an hour in sevenths rounds to the second');
eq(shown('1h/7*7'), '0:59:58', '...and does not round-trip. By design.');
eq(shown('1h/2*2'), '1:00:00', 'an exact division does round-trip');

/* ---- decimal hours ------------------------------------------------------- */

eq(decimalHours(3600), 1, 'an hour is 1.0');
eq(decimalHours(0), 0, 'zero');
ok(Math.abs(decimalHours(8746) - 2.42944) < 1e-5, '2:25:46 is about 2.4294 h');

/* ---- resuming from a result --------------------------------------------- */

/* toBuffer emits the suffix spelling, so a result can be continued from with the
   same keys that produced it. Round-tripped rather than string-compared, because
   what matters is that the value survives. */
for (const [, suffix, secs] of GRAMMAR) {
  const text = toBuffer({ seconds: secs, duration: true });
  ok(typeof text === 'string' && text.length > 0, `${suffix} writes back as text`);
  eq(parseLiteral(text).seconds, secs, `${text} round trips to ${secs}s`);
}

eq(toBuffer({ seconds: 0, duration: true }), '0s', 'zero still writes something');
eq(toBuffer({ seconds: -3600, duration: true }), '-1h', 'a negative duration');
eq(parseLiteral('1h').seconds, 3600, 'and the unsigned part parses back');
eq(toBuffer({ seconds: 5, duration: false }), null, 'a scalar is not this function\'s job');
eq(toBuffer({ seconds: Infinity, duration: true }), null, 'nor is infinity');

/* ---- marker insertion --------------------------------------------------- */

/* The keypad rule, which has to hold with the caret anywhere inside a literal —
   hence the two halves rather than one string. */
ok(canInsertMarker('1', '', 'h'), 'h after a digit');
ok(!canInsertMarker('', '', 'h'), 'h with nothing to name');
ok(!canInsertMarker('1h', '', 'h'), 'h twice');
ok(!canInsertMarker('1h20m', '', 'h'), 'h after m — out of order');
ok(canInsertMarker('1h20', '', 'm'), 'm after h');
ok(canInsertMarker('1h20m30', '', 's'), 's last');
ok(!canInsertMarker('1h', '', ':'), 'no mixing spellings');
ok(!canInsertMarker('1:', '', 'm'), 'nor the other way');
ok(canInsertMarker('', '', ':'), 'a leading colon is fine — :90 is 90 minutes');
ok(canInsertMarker('', '', '.'), 'as is a leading point — .45 is 45 seconds');
ok(canInsertMarker('20', '45', '.'), 'inserted mid-literal, ranks agree');
ok(!canInsertMarker('20.', '45', ':'), 'inserted mid-literal, ranks disagree');

/* ---- nothing produces NaN ----------------------------------------------- */

/* Seeded so a failure is reproducible. A NaN escaping here would reach the
   display as a time, which is the one thing worse than an error. */
let seed = 0x2b3c4d5e;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ATOMS = ['1h', '20m', '45s', '1h20m45s', '0s', '2', '7', '0', ':90', '.45'];
const OPS = ['+', '-', '*', '/', '^'];
const pick = (a) => a[Math.floor(rand() * a.length)];

let clean = 0;
for (let i = 0; i < 20000; i++) {
  const src = `${pick(ATOMS)}${pick(OPS)}${pick(ATOMS)}`;
  const v = run(src);
  // A code string is a legitimate outcome; a NaN is not.
  if (typeof v !== 'string' && Number.isNaN(v.seconds)) {
    failures.push(`${src} produced NaN`);
    break;
  }
  clean++;
}
eq(clean, 20000, 'no random time expression produces NaN');

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const f of failures.slice(0, 20)) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${pass} passed`);
