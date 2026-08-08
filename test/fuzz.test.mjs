/**
 * Stage 4 fuzzer.
 *
 * The contract under test is not "the answer is right" — it is "nothing ever
 * escapes". Any input, however malformed, must either produce a number or throw
 * a CalcError. A TypeError, a RangeError from blown stack, or a hang is a bug.
 *
 * The RNG is seeded so a failure is reproducible: rerun with the printed seed.
 */
import { parse } from '../src/parser.js';
import { evaluate } from '../src/eval.js';
import { isCalcError } from '../src/errors.js';
import { initialState, apply, preview, previewSource } from '../src/model.js';

const EXPR_ITERATIONS = Number(process.env.FUZZ_N || 100_000);
const MODEL_ITERATIONS = Number(process.env.FUZZ_MODEL_N || 20_000);
const SLOW_MS = 100;
const SEED = Number(process.env.FUZZ_SEED || 0x5eed1e);

/** mulberry32 — small, seeded, good enough to shake out parser edge cases. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [...'0123456789.+-*/^()'];
const failures = [];

function fail(kind, input, e) {
  failures.push(`${kind}\n    seed  ${SEED}\n    input ${JSON.stringify(input)}\n    threw ${e && e.stack ? e.stack.split('\n')[0] : e}`);
}

/* ---- part A: random token soup through the engine ------------------------ */

const rand = rng(SEED);
let parsed = 0;
let rejected = 0;
let slowest = 0;

for (let n = 0; n < EXPR_ITERATIONS; n++) {
  const len = 1 + Math.floor(rand() * 24);
  let src = '';
  for (let k = 0; k < len; k++) src += ALPHABET[Math.floor(rand() * ALPHABET.length)];

  const t0 = process.hrtime.bigint();
  try {
    const value = evaluate(parse(src));
    if (typeof value !== 'number') fail('non-number result', src, value);
    parsed++;
  } catch (e) {
    if (!isCalcError(e)) fail('uncaught non-CalcError', src, e);
    else rejected++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms > slowest) slowest = ms;
  if (ms > SLOW_MS) fail(`iteration took ${ms.toFixed(1)}ms`, src, 'possible hang');

  if (failures.length > 5) break;
}

/* ---- part B: random keypad sequences through the reducer ------------------ */

const COMMANDS = [
  ...'0123456789'.split('').map((d) => `digit:${d}`),
  'zeros', 'dot', 'op:+', 'op:-', 'op:*', 'op:/', 'op:^',
  'paren', 'parenforce', 'open', 'close', 'back', 'equals', 'clear',
];
const LEGAL_BUFFER = /^[0-9.+\-*/^()]*$/;

const rand2 = rng(SEED ^ 0x9e3779b9);
let modelSteps = 0;

for (let n = 0; n < MODEL_ITERATIONS && failures.length <= 5; n++) {
  let state = initialState();
  const steps = 1 + Math.floor(rand2() * 30);
  const trail = [];
  for (let k = 0; k < steps; k++) {
    const cmd = rand2() < 0.06
      ? `caret:${Math.floor(rand2() * (state.buf.length + 2))}`
      : COMMANDS[Math.floor(rand2() * COMMANDS.length)];
    trail.push(cmd);
    try {
      state = apply(state, cmd);
      modelSteps++;
    } catch (e) {
      fail('reducer threw', trail.join(' '), e);
      break;
    }

    if (!LEGAL_BUFFER.test(state.buf)) fail('illegal character in buffer', trail.join(' '), state.buf);
    if (state.caret < 0 || state.caret > state.buf.length) fail('caret out of range', trail.join(' '), state.caret);
    if (state.buf.length > 120) fail('buffer exceeded MAX_LENGTH', trail.join(' '), state.buf.length);

    try {
      preview(state.buf);
    } catch (e) {
      fail('preview threw', trail.join(' '), e);
    }

    // Whatever the reducer builds, "=" must resolve or fail cleanly.
    try {
      if (state.buf !== '') evaluate(parse(previewSource(state.buf)));
    } catch (e) {
      if (!isCalcError(e)) fail('reducer produced a buffer that crashes the engine', trail.join(' '), e);
    }
  }
}

/* ---- report -------------------------------------------------------------- */

if (failures.length) {
  console.error(`\nfuzz FAILED — ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}

console.log(
  `fuzz passed — ${EXPR_ITERATIONS.toLocaleString()} expressions ` +
  `(${parsed.toLocaleString()} evaluated, ${rejected.toLocaleString()} rejected cleanly), ` +
  `${modelSteps.toLocaleString()} reducer steps, slowest iteration ${slowest.toFixed(2)}ms`
);
