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
import { evaluate, evaluateHex } from '../src/eval.js';
import { isCalcError } from '../src/errors.js';
import { initialState, apply, preview, previewSource } from '../src/model.js';
import { setRadix } from '../src/format.js';
import { DEC, HEX } from '../src/tokenizer.js';

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

/* ---- part C: the same, in hex -------------------------------------------- */

/*
 * Hex carries a hazard decimal does not. Floats overflow to Infinity and stop;
 * BigInt has no ceiling, so 2^FFFFFFFF would allocate until the tab dies rather
 * than returning a value. The timing assertion below is the real test here — a
 * clean CalcError is the pass condition, and a slow iteration is the failure
 * mode being hunted.
 */
const HEX_ALPHABET = [...'0123456789ABCDEF+-*/^()'];
const rand3 = rng(SEED ^ 0x1f2e3d4c);
let hexParsed = 0;
let hexRejected = 0;
let hexSlowest = 0;

for (let n = 0; n < EXPR_ITERATIONS && failures.length <= 5; n++) {
  const len = 1 + Math.floor(rand3() * 24);
  let src = '';
  for (let k = 0; k < len; k++) src += HEX_ALPHABET[Math.floor(rand3() * HEX_ALPHABET.length)];

  const t0 = process.hrtime.bigint();
  try {
    const value = evaluateHex(parse(src, HEX));
    if (typeof value !== 'bigint') fail('non-BigInt hex result', src, value);
    hexParsed++;
  } catch (e) {
    if (!isCalcError(e)) fail('uncaught non-CalcError in hex', src, e);
    else hexRejected++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms > hexSlowest) hexSlowest = ms;
  if (ms > SLOW_MS) fail(`hex iteration took ${ms.toFixed(1)}ms`, src, 'unbounded BigInt growth');
}

/* And the reducer, with the letter keys live. */
setRadix(HEX);
const HEX_COMMANDS = [
  ...'0123456789ABCDEF'.split('').map((d) => `digit:${d}`),
  'zeros', 'dot', 'op:+', 'op:-', 'op:*', 'op:/', 'op:^',
  'paren', 'parenforce', 'open', 'close', 'back', 'equals', 'clear',
];
const LEGAL_HEX_BUFFER = /^[0-9A-F+\-*/^()]*$/;

const rand4 = rng(SEED ^ 0xc0ffee);
let hexSteps = 0;

for (let n = 0; n < MODEL_ITERATIONS && failures.length <= 5; n++) {
  let state = initialState();
  const steps = 1 + Math.floor(rand4() * 30);
  const trail = [];
  for (let k = 0; k < steps; k++) {
    const cmd = rand4() < 0.06
      ? `caret:${Math.floor(rand4() * (state.buf.length + 2))}`
      : HEX_COMMANDS[Math.floor(rand4() * HEX_COMMANDS.length)];
    trail.push(cmd);
    try {
      state = apply(state, cmd);
      hexSteps++;
    } catch (e) {
      fail('hex reducer threw', trail.join(' '), e);
      break;
    }

    if (!LEGAL_HEX_BUFFER.test(state.buf)) fail('illegal character in hex buffer', trail.join(' '), state.buf);
    if (state.buf.includes('.')) fail('a point reached the hex buffer', trail.join(' '), state.buf);
    if (state.caret < 0 || state.caret > state.buf.length) fail('caret out of range', trail.join(' '), state.caret);
    if (state.buf.length > 120) fail('buffer exceeded MAX_LENGTH', trail.join(' '), state.buf.length);

    // A committed hex result must be an exact integer, never a float.
    if (state.committed && state.result !== null && typeof state.result !== 'bigint') {
      fail('hex commit produced a non-BigInt', trail.join(' '), typeof state.result);
    }

    try {
      preview(state.buf);
    } catch (e) {
      fail('hex preview threw', trail.join(' '), e);
    }
  }
}
setRadix(DEC);

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
console.log(
  `hex fuzz passed — ${EXPR_ITERATIONS.toLocaleString()} expressions ` +
  `(${hexParsed.toLocaleString()} evaluated, ${hexRejected.toLocaleString()} rejected cleanly), ` +
  `${hexSteps.toLocaleString()} reducer steps, slowest iteration ${hexSlowest.toFixed(2)}ms`
);
