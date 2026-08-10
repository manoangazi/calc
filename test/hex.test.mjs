import { parse } from '../src/parser.js';
import { evaluate, evaluateHex } from '../src/eval.js';
import { formatResult, formatHex, config, setRadix, setDecimals } from '../src/format.js';
import { initialState, apply, preview, plainDecimal } from '../src/model.js';
import { convertBuffer, DEC, HEX } from '../src/radix.js';
import { isCalcError } from '../src/errors.js';
import {
  addEntry, parseHistory, serializeHistory, fromStored, entryRadix,
} from '../src/history.js';

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  if (Object.is(actual, expected)) pass++;
  else failures.push(`${label}\n    expected ${JSON.stringify(String(expected))}\n    actual   ${JSON.stringify(String(actual))}`);
}

/** The code of the CalcError a thunk throws, or null if it did not throw. */
function code(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    if (!isCalcError(e)) throw e;
    return e.code;
  }
}

const hex = (src) => evaluateHex(parse(src, HEX));
const g = (...chunks) => chunks.join(config.groupSep);

// ---- hex arithmetic ---------------------------------------------------------

eq(hex('FF+FF'), 0x1fen, 'FF + FF');
eq(hex('FF*FF'), 0xfe01n, 'FF * FF');
eq(hex('A-F'), -5n, 'a negative result is signed, not two’s complement');
// The exponent is read in hex too: 2^10 is 2^16, not 2^10.
eq(hex('2^10'), 0x10000n, 'the exponent is itself a hex literal');
eq(hex('2^A'), 0x400n, 'so 2^A is what gives 1024');
eq(hex('(A+A)*2'), 0x28n, 'parentheses work in hex');
eq(hex('-A'), -0xan, 'unary minus');
eq(hex('10'), 0x10n, '10 in hex is sixteen');

// Integer division truncates toward zero. This is the defining behaviour of the
// mode, not an accident of BigInt.
eq(hex('10/3'), 5n, 'division truncates (16/3 = 5)');
eq(hex('A/3'), 3n, 'division truncates (10/3 = 3)');
eq(hex('1/2'), 0n, 'a fraction truncates to zero');
eq(hex('-10/3'), -5n, 'truncation is toward zero, not toward -infinity');
eq(hex('2^-1'), 0n, 'a negative exponent truncates to zero, like 1/2 does');

// Exactness past 2^53 is the whole reason this path uses BigInt.
eq(hex('FFFFFFFFFFFFFFFF'), 2n ** 64n - 1n, '64-bit constant is exact');
eq(hex('FFFFFFFFFFFFFFFF+1'), 2n ** 64n, 'and still exact when it carries');

eq(code(() => hex('A/0')), 'divzero', 'divide by zero');
eq(code(() => hex('2^FFFFFFFF')), 'toobig', 'a huge exponent is refused, not computed');
eq(code(() => hex('2^5000')), 'toobig', 'an exponent past the cap is refused');
eq(hex('2^3FF'), 2n ** 1023n, 'a result that just fits the bit cap still evaluates');
eq(code(() => hex('2^400')), 'toobig', 'one bit past the cap is refused');
eq(code(() => hex('G')), 'syntax', 'G is not a hex digit');
eq(code(() => hex('F.8')), 'syntax', 'there is no hex point');
eq(code(() => parse('FF', DEC)), 'syntax', 'hex digits are not legal in decimal mode');

// The decimal engine must be untouched by any of this.
eq(evaluate(parse('2+3')), 5, 'decimal evaluation still works');
eq(evaluate(parse('10/4')), 2.5, 'decimal division still returns a fraction');

// ---- formatting -------------------------------------------------------------

setRadix(HEX);
eq(formatHex(0xffffffffn), g('FFFF', 'FFFF'), 'hex groups in fours');
eq(formatHex(0xfffn), 'FFF', 'a short value is not grouped');
eq(formatHex(-0x5n), '-5', 'negative renders signed');
eq(formatResult(0x1fen), '1FE', 'formatResult routes a BigInt to hex');

setDecimals(3);
eq(formatResult(0x1fen), '1FE', 'decimal places cannot apply to an integer result');
setDecimals('auto');

// ---- buffer conversion ------------------------------------------------------

eq(convertBuffer('255+16', DEC, HEX).buf, 'FF+10', 'every literal converts, not just one');
eq(convertBuffer('FF+10', HEX, DEC).buf, '255+16', 'and back again');
eq(convertBuffer('(255+1)*2', DEC, HEX).buf, '(FF+1)*2', 'operators and brackets are left alone');
eq(convertBuffer('255', DEC, DEC).buf, '255', 'converting to the same base is a no-op');
eq(convertBuffer('0', DEC, HEX).buf, '0', 'zero converts to zero');

const lossy = convertBuffer('12.75', DEC, HEX);
eq(lossy.buf, 'C', 'a fraction is truncated, not rounded');
eq(lossy.lossy, true, 'and the caller is told it happened');
eq(convertBuffer('12.0', DEC, HEX).lossy, false, 'a zero fraction loses nothing');
eq(convertBuffer('12', DEC, HEX).lossy, false, 'an integer loses nothing');

// Hex is denser than decimal, so a long hex buffer can outgrow MAX_LENGTH.
const long = convertBuffer('F'.repeat(119), HEX, DEC);
eq(long.tooLong, true, 'an overlong conversion is refused');
eq(long.buf, 'F'.repeat(119), 'and leaves the buffer untouched');

// ---- the reducer in hex mode ------------------------------------------------

setRadix(HEX);
const press = (cmds, start = initialState()) =>
  cmds.reduce((s, c) => apply(s, c), start);

eq(press(['digit:A', 'digit:F']).buf, 'AF', 'letter keys type');
eq(press(['digit:A', 'op:+', 'digit:A']).buf, 'A+A', 'letters combine with operators');
eq(press(['digit:F', 'dot']).buf, 'F', 'the point key is inert in hex');
eq(preview('FF+FF'), 0x1fen, 'the live preview evaluates in hex');

const committed = press(['digit:F', 'digit:F', 'op:+', 'digit:1', 'equals']);
eq(committed.result, 0x100n, 'equals commits a BigInt');
eq(committed.error, null, 'and is not mistaken for an overflow');
eq(press(['op:+', 'digit:1'], committed).buf, '100+1', 'continuing from a result resumes in hex');

eq(plainDecimal(0x1fen), '1FE', 'a BigInt result is written back as hex digits');
eq(plainDecimal(-0x1fen), '-1FE', 'including a negative one');
eq(plainDecimal(2n ** 4096n), null, 'a value too long for the buffer refuses to resume');

eq(apply(initialState(), 'load:FF+A').buf, 'FF+A', 'a hex tape entry can be recalled');
eq(apply(initialState(), 'load:FF+G').buf, '', 'a tampered entry is rejected');

setRadix(DEC);
eq(press(['digit:A']).buf, '', 'a letter key does nothing in decimal mode');
eq(apply(initialState(), 'load:FF').buf, '', 'a hex entry is rejected while in decimal mode');

// ---- the tape ---------------------------------------------------------------

const tape = addEntry([], { src: 'FF+FF', value: 0x1fen });
eq(tape.length, 1, 'a hex entry is accepted');
eq(tape[0].value, '510', 'and its BigInt is stored as a string, since JSON cannot hold one');
eq(tape[0].radix, HEX, 'tagged with its radix, so FF+FF is never read as decimal');

// The bug this guards: JSON.stringify throws outright on a BigInt, and
// saveHistory swallows the throw — persistence would have died silently.
eq(typeof serializeHistory(tape), 'string', 'a hex tape serialises at all');
eq(parseHistory(serializeHistory(tape))[0].value, '510', 'and round-trips');
eq(fromStored(parseHistory(serializeHistory(tape))[0]).value, 0x1fen, 'reviving gives the BigInt back');

eq(addEntry([], { src: 'FF+G', value: 1n }).length, 0, 'an illegal hex source is refused');
eq(addEntry([], { src: 'FF', value: 1 }).length, 0, 'a hex source with a float value is refused');
eq(parseHistory('[{"src":"FF","value":"nope","radix":16}]').length, 0, 'a tampered value is dropped on read');
eq(parseHistory('[{"src":"2+2","value":4}]').length, 1, 'an entry written before hex existed still loads');
eq(entryRadix({ src: '2+2', value: 4 }), DEC, 'and reads as decimal');

// "11" is legal in both bases — seventeen in hex, eleven in decimal.
const mixed = addEntry(addEntry([], { src: '11', value: 0x11n }), { src: '11', value: 11 });
eq(mixed.length, 2, 'the same source in two bases is two entries, not a repeat');

// ---- report -----------------------------------------------------------------

// ---- square root ------------------------------------------------------------

/* Integer, truncating toward zero — the same bargain division already makes,
   because there are no fractions in this mode. */
eq(hex('√FF'), 15n, 'root of FF truncates to F');
eq(hex('√100'), 16n, 'root of an exact square is exact');
eq(hex('√0'), 0n, 'root of zero');
eq(hex('√1'), 1n, 'root of one');
eq(hex('√2'), 1n, 'root of two truncates');
eq(hex('√3'), 1n, 'root of three truncates');
eq(hex('√4'), 2n, 'root of four is exact');
/* The reason this cannot go through Math.sqrt: a double loses exactness above
   2^53, and preserving that is the entire point of the BigInt evaluator.
   (2^64)^2 has an exact root that a float would round. */
eq(hex('√' + '1' + '0'.repeat(32)), 1n << 64n, 'exact root far above 2^53');
eq(hex('√(FFFFFFFFFFFFFFFF*FFFFFFFFFFFFFFFF)'), 0xFFFFFFFFFFFFFFFFn, 'root undoes a 64-bit square exactly');
eq(code(() => hex('√-4')), 'undef', 'root of a negative is refused');

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${pass} passed`);
