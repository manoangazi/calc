import { parse } from '../src/parser.js';
import { evaluate } from '../src/eval.js';
import { formatResult, formatExpression, config, setDecimalSep, setDecimals } from '../src/format.js';
import { initialState, apply, preview, plainDecimal } from '../src/model.js';
import { ERRORS } from '../src/errors.js';
import { addEntry, parseHistory, serializeHistory, MAX_ENTRIES } from '../src/history.js';

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  if (Object.is(actual, expected)) pass++;
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

const calc = (src) => evaluate(parse(src));
/** Built from config so an invisible thin space can never drift out of sync. */
const g = (...chunks) => chunks.join(config.groupSep);

// ---- engine -----------------------------------------------------------------

eq(calc('1+2'), 3, 'addition');
eq(calc('2+3*4'), 14, 'precedence');
eq(calc('(2+3)*4'), 20, 'parens override precedence');
eq(calc('12.5*(3+(4-1)*2)'), 112.5, 'nested parens');
eq(calc('-5+3'), -2, 'leading unary minus');
eq(calc('2*-3'), -6, 'unary minus after operator');
eq(calc('--4'), 4, 'double negation');
eq(calc('((((1+1))))'), 2, 'redundant nesting');
eq(calc('100/4/5'), 5, 'left-associative division');
eq(calc('10-2-3'), 5, 'left-associative subtraction');

let threw = false;
try { calc('1+'); } catch { threw = true; }
eq(threw, true, 'trailing operator rejected');
threw = false;
try { calc('(1+2'); } catch { threw = true; }
eq(threw, true, 'unclosed paren rejected');
threw = false;
try { calc('1/0'); } catch { threw = true; }
eq(threw, true, 'divide by zero rejected');
threw = false;
try { calc('()'); } catch { threw = true; }
eq(threw, true, 'empty parens rejected');

// ---- formatting -------------------------------------------------------------

eq(formatResult(0.1 + 0.2), '0.3', 'float artifact rounded away');
eq(formatResult(93610), g('93', '610'), 'thousands grouped');
eq(formatResult(1234), g('1', '234'), 'four digits grouped');
eq(formatResult(123), '123', 'three digits not grouped');
eq(formatResult(1234567.89), g('1', '234', '567.89'), 'grouping with decimals');
eq(formatResult(-4500), '-' + g('4', '500'), 'negative grouped');
eq(formatResult(calc('5566*555/33')), g('93', '610'), 'reference expression');

const render = (buf) => formatExpression(buf).map((p) => p.text).join('');
eq(render('5566*555/33'), `${g('5', '566')}×555÷33`, 'expression rendered with glyphs and grouping');
eq(render('12.5*(3+(4-1)*2)'), '12.5×(3+(4−1)×2)', 'nested expression rendered');

const indices = formatExpression('5566+1').filter((p) => p.i !== undefined).map((p) => p.i);
eq(JSON.stringify(indices), JSON.stringify([0, 1, 2, 3, 4, 5]), 'every character keeps its buffer index');
eq(formatExpression('5566').some((p) => p.kind === 'group'), true, 'group separator emitted as its own part');

setDecimalSep(',');
eq(render('12.5'), '12,5', 'decimal separator setting applies to the expression');
eq(formatResult(1.5), '1,5', 'decimal separator setting applies to the result');
setDecimalSep('.');
eq(render('12.5'), '12.5', 'decimal separator reverts');

// ---- keypad -----------------------------------------------------------------

function press(...cmds) {
  return cmds.reduce((s, c) => apply(s, c), initialState());
}

eq(press('digit:0', 'digit:5').buf, '5', 'leading zero replaced');
eq(press('zeros').buf, '0', 'zeros on empty buffer gives one zero');
eq(press('digit:5', 'zeros').buf, '500', 'zeros appends two');
eq(press('dot', 'digit:5').buf, '0.5', 'bare dot gets a leading zero');
eq(press('digit:1', 'dot', 'dot').buf, '1.', 'second dot ignored');
eq(press('digit:1', 'op:+', 'op:*').buf, '1*', 'operator replaced');
eq(press('op:+').buf, '', 'leading plus ignored');
eq(press('op:-').buf, '-', 'leading minus allowed');
eq(press('paren').buf, '(', 'paren opens on empty buffer');
eq(press('digit:1', 'op:+', 'paren').buf, '1+(', 'paren opens after operator');
eq(press('paren', 'digit:1', 'paren').buf, '(1)', 'paren closes when depth > 0');
eq(press('digit:2', 'paren').buf, '2*(', 'paren after digit implies multiply');
eq(press('paren', 'digit:1', 'paren', 'digit:2').buf, '(1)*2', 'digit after close implies multiply');
eq(preview('12*(3+4'), 84, 'implicit close in preview');

const committed = press('digit:2', 'op:+', 'digit:3', 'equals');
eq(committed.result, 5, 'equals commits a result');
eq(apply(committed, 'digit:7').buf, '7', 'digit after equals starts fresh');
eq(apply(committed, 'op:*').buf, '5*', 'operator after equals continues from result');
eq(apply(committed, 'back').buf, '2+3', 'backspace after equals restores the expression');

// ---- caret ------------------------------------------------------------------

eq(press('digit:1', 'digit:2', 'digit:3').caret, 3, 'caret tracks the tail while typing');

const mid = press('digit:1', 'digit:2', 'digit:3', 'caret:1');
eq(mid.caret, 1, 'caret can be placed');
eq(apply(mid, 'digit:9').buf, '1923', 'digit inserts at the caret');
eq(apply(mid, 'digit:9').caret, 2, 'caret advances past the insertion');
eq(apply(mid, 'back').buf, '23', 'backspace deletes before the caret');
eq(apply(mid, 'back').caret, 0, 'caret retreats on backspace');
eq(apply(press('digit:1', 'caret:0'), 'back').buf, '1', 'backspace at position zero is a no-op');
eq(apply(mid, 'op:+').buf, '1+23', 'operator inserts at the caret');

const beforeNum = press('digit:1', 'digit:2', 'dot', 'digit:5', 'caret:1');
eq(apply(beforeNum, 'dot'), beforeNum, 'second dot rejected from the far side of the caret');

const atStart = press('digit:5', 'caret:0');
eq(apply(atStart, 'op:-').buf, '-5', 'minus allowed at the start of the buffer');
eq(apply(atStart, 'op:+'), atStart, 'plus rejected at the start of the buffer');

eq(apply(committed, 'caret:1').committed, false, 'placing the caret leaves the committed state');
eq(apply(press('digit:1'), 'caret:99').caret, 1, 'caret clamps to the buffer length');

// ---- long press -------------------------------------------------------------

eq(apply(press('digit:1', 'digit:2'), 'clear').buf, '', 'long-press backspace clears');
eq(press('paren', 'digit:1', 'parenforce').buf, '(1*(', 'forced paren opens where auto would close');
eq(press('digit:1', 'parenforce').buf, '1*(', 'forced paren opens after a digit');
eq(
  JSON.stringify(press('digit:1', 'op:+', 'parenforce')),
  JSON.stringify(press('digit:1', 'op:+')),
  'forced close ignored at depth zero'
);

// ---- fractions --------------------------------------------------------------
// Division, displayed as a decimal. The 12-significant-digit rounding is what
// keeps repeating and inexact-binary values from showing their artifacts.

eq(formatResult(calc('2/5')), '0.4', '2/5');
eq(formatResult(calc('1/4')), '0.25', '1/4');
eq(formatResult(calc('1/8')), '0.125', '1/8');
eq(formatResult(calc('10/4')), '2.5', '10/4');
eq(formatResult(calc('1/3')), '0.333333333333', '1/3 truncated to 12 significant digits');
eq(formatResult(calc('2/3')), '0.666666666667', '2/3 rounds at the last digit');
eq(formatResult(calc('22/7')), '3.14285714286', '22/7');
eq(formatResult(calc('2/5+1/4')), '0.65', 'fractions add');
eq(formatResult(calc('1/3*3')), '1', 'a third times three is exactly one');
eq(formatResult(calc('(1/3)*3-1')), '0', 'no residue left behind');
eq(formatResult(calc('1/6+1/6+1/6')), '0.5', 'repeating thirds sum cleanly');
eq(formatResult(calc('0.1+0.2')), '0.3', 'the classic binary artifact');

// ---- negatives and implicit multiply, end to end ----------------------------

const keyed = (...cmds) => cmds.reduce((s, c) => apply(s, c), initialState());
const keyedValue = (...cmds) => preview(keyed(...cmds).buf);

eq(keyed('op:-', 'digit:5', 'digit:6', 'op:*', 'digit:4', 'digit:4').buf, '-56*44', 'leading minus typed from the keypad');
eq(keyedValue('op:-', 'digit:5', 'digit:6', 'op:*', 'digit:4', 'digit:4'), -2464, '-56*44');
eq(keyedValue('op:-', 'digit:5', 'op:+', 'digit:4', 'digit:5', 'op:/', 'digit:2'), 17.5, '-5+45/2');
eq(keyed('digit:5', 'digit:4', 'paren', 'digit:4', 'digit:5', 'op:-', 'digit:3', 'paren').buf, '54*(45-3)', '54(45-3) gains an implicit multiply');
eq(keyedValue('digit:5', 'digit:4', 'paren', 'digit:4', 'digit:5', 'op:-', 'digit:3'), 2268, '54(45-3 evaluates unclosed');
eq(keyedValue('digit:2', 'paren', 'digit:3', 'paren', 'paren', 'digit:4', 'paren'), 24, '2(3)(4) chains implicit multiplies');
eq(keyedValue('op:-', 'paren', 'digit:3', 'op:+', 'digit:4', 'paren'), -7, 'negated bracket');
eq(keyedValue('digit:5', 'op:*', 'op:-', 'digit:3'), -15, '5*-3');

// ---- exponent ---------------------------------------------------------------

const codeOf = (fn) => {
  try { fn(); return null; } catch (e) { return e.code ?? e.name; }
};

eq(calc('2^3'), 8, 'exponent');
eq(calc('2^3^2'), 512, 'exponent is right-associative');
eq(calc('-2^2'), -4, 'exponent binds tighter than unary minus');
eq(calc('(-2)^2'), 4, 'parens override that binding');
eq(calc('2^-2'), 0.25, 'negative exponent');
eq(calc('2*3^2'), 18, 'exponent binds tighter than multiply');
eq(calc('9^0.5'), 3, 'fractional exponent');
eq(calc('2^0'), 1, 'zero exponent');
eq(codeOf(() => calc('(-8)^0.5')), 'undef', 'complex result rejected');
eq(render('2^3'), '2^3', 'exponent rendered');
eq(press('digit:2', 'op:^', 'digit:3').buf, '2^3', 'exponent key');
eq(press('digit:2', 'op:^', 'op:*').buf, '2*', 'exponent replaced like any operator');
eq(press('digit:2', 'op:^', 'paren').buf, '2^(', 'paren opens after an exponent');
eq(press('digit:2', 'op:^', 'op:-', 'digit:2').buf, '2^-2', 'negative exponent from the keypad');
eq(press('digit:3', 'op:*', 'op:-', 'digit:4').buf, '3*-4', 'minus after multiply is a sign');
eq(press('digit:3', 'op:+', 'op:-').buf, '3-', 'minus after plus still corrects');
eq(press('digit:3', 'op:*', 'op:+').buf, '3+', 'plus after multiply still corrects');
eq(calc(press('digit:3', 'op:*', 'op:-', 'digit:4').buf), -12, 'signed product evaluates');

// ---- explicit bracket commands ----------------------------------------------

eq(press('digit:2', 'open').buf, '2*(', 'open after a digit implies multiply');
eq(press('open', 'digit:2', 'close').buf, '(2)', 'close when open');
eq(press('digit:2', 'close').buf, '2', 'close ignored at depth zero');
eq(press('open', 'close').buf, '()', 'close permitted straight after open');

// ---- stage 4: depth, magnitude, error taxonomy ------------------------------

eq(calc('('.repeat(30) + '1+1' + ')'.repeat(30)), 2, 'thirty levels of nesting');
eq(calc('-'.repeat(20) + '5'), 5, 'twenty unary minuses');
eq(calc('-'.repeat(21) + '5'), -5, 'odd unary minus chain');
eq(codeOf(() => calc('('.repeat(70) + '1' + ')'.repeat(70))), 'depth', 'paren depth cap');
eq(codeOf(() => calc('-'.repeat(70) + '5')), 'depth', 'unary depth cap');
eq(codeOf(() => calc('1/0')), 'divzero', 'divide by zero code');
eq(codeOf(() => calc('1+')), 'syntax', 'incomplete expression code');
eq(codeOf(() => calc('1..2')), 'syntax', 'malformed number code');
eq(codeOf(() => calc('')), 'syntax', 'empty expression code');
eq(Object.keys(ERRORS).every((k) => ERRORS[k].display && ERRORS[k].hint), true, 'every error code has a display and a hint');

eq(calc('9'.repeat(400)), Infinity, 'overflow yields infinity');
eq(formatResult(Infinity), '∞', 'infinity displayed');
eq(formatResult(1e16).includes('×10^'), true, 'very large magnitudes use exponential');
eq(formatResult(1e-10).includes('×10^'), true, 'very small magnitudes use exponential');
eq(formatResult(1e-9) === '0.000000001', true, 'the smallest plain magnitude stays plain');

const overflowed = apply(
  { buf: '9'.repeat(320), caret: 320, committed: false, result: null, error: null },
  'equals'
);
eq(overflowed.error, 'overflow', 'overflow commits with the overflow code');
eq(overflowed.committed, true, 'overflow still commits');

// Regression: a result that JS stringifies in exponential form must never reach
// the buffer, or every later keystroke parses against an illegal "e".
eq(plainDecimal(5.04642458295e-7), '0.000000504642458295', 'tiny result written as plain decimal');
eq(plainDecimal(1e-12), null, 'unwritable magnitude refuses to resume');
eq(plainDecimal(1e22), null, 'oversized magnitude refuses to resume');
eq(plainDecimal(-2.5), '-2.5', 'negative result written plainly');
eq(plainDecimal(0), '0', 'zero written plainly');
eq(plainDecimal(Infinity), null, 'infinity refuses to resume');

const tiny = apply(press('digit:5', 'op:/', 'digit:9', 'digit:9', 'digit:0', 'digit:8', 'zeros', 'digit:5'), 'equals');
eq(/^[0-9.+\-*/()]*$/.test(apply(tiny, 'op:+').buf), true, 'resuming from a tiny result keeps the buffer legal');
eq(apply(apply(tiny, 'op:+'), 'digit:1').buf.includes('e'), false, 'no exponent leaks into the buffer');

// ---- stage 6: history tape --------------------------------------------------

const entry = (src, value) => ({ src, value });

eq(addEntry([], entry('1+1', 2)).length, 1, 'entry added');
eq(addEntry([], entry('1+1', 2))[0].src, '1+1', 'entry keeps its source');
eq(addEntry([entry('1+1', 2)], entry('2+2', 4))[0].src, '2+2', 'newest first');
eq(addEntry([entry('1+1', 2)], entry('1+1', 2)).length, 1, 'consecutive repeat collapses');
eq(addEntry([entry('2+2', 4), entry('1+1', 2)], entry('1+1', 2)).length, 3, 'non-consecutive repeat kept');

let long = [];
for (let n = 0; n < MAX_ENTRIES + 20; n++) long = addEntry(long, entry(`${n}+1`, n + 1));
eq(long.length, MAX_ENTRIES, 'tape capped');
eq(long[0].src, `${MAX_ENTRIES + 19}+1`, 'cap drops the oldest, not the newest');

eq(addEntry([], entry('1+1', Infinity)).length, 0, 'infinite result rejected');
eq(addEntry([], entry('1+1', NaN)).length, 0, 'NaN result rejected');
eq(addEntry([], entry('alert(1)', 2)).length, 0, 'illegal source rejected');
eq(addEntry([], entry('', 2)).length, 0, 'empty source rejected');
eq(addEntry([], entry('1'.repeat(200), 2)).length, 0, 'oversized source rejected');

eq(parseHistory('not json').length, 0, 'malformed storage ignored');
eq(parseHistory('{"a":1}').length, 0, 'non-array storage ignored');
eq(parseHistory(null).length, 0, 'absent storage ignored');
eq(parseHistory('[{"src":"1+1","value":2},{"src":"<script>","value":1}]').length, 1, 'poisoned entries filtered on read');
eq(parseHistory(serializeHistory([entry('2^3', 8)]))[0].value, 8, 'round-trips through storage');

// A tape entry is replayed through apply(), so the same validation applies again.
eq(apply(initialState(), 'load:12*(3+4)').buf, '12*(3+4)', 'entry recalled into the buffer');
eq(apply(initialState(), 'load:12*(3+4)').caret, 8, 'caret lands at the end of a recalled entry');
eq(apply(initialState(), 'load:12*(3+4)').committed, false, 'a recalled entry is editable');
eq(apply(committed, 'load:1+1').buf, '1+1', 'recall clears a committed state');
eq(apply(initialState(), 'load:alert(1)').buf, '', 'illegal recall refused');
eq(apply(initialState(), `load:${'1'.repeat(200)}`).buf, '', 'oversized recall refused');
eq(preview(apply(initialState(), 'load:2^3^2').buf), 512, 'a recalled entry still evaluates');


// ---- decimal places ---------------------------------------------------------

eq(setDecimals(3), 3, 'a place count in range is accepted');
eq(setDecimals(0), 'auto', 'zero places falls back to auto');
eq(setDecimals(6), 'auto', 'more than five places falls back to auto');
eq(setDecimals(2.5), 'auto', 'a fractional place count falls back to auto');
eq(setDecimals('4'), 4, 'a stored string is coerced');
eq(setDecimals('nonsense'), 'auto', 'an unparseable stored value falls back to auto');
eq(setDecimals(null), 'auto', 'a missing stored value falls back to auto');

setDecimals(2);
eq(formatResult(1 / 3), '0.33', 'fixed places round the result');
eq(formatResult(0.4), '0.40', 'fixed places pad with trailing zeros');
eq(formatResult(2), '2.00', 'a whole number still shows its places');
eq(formatResult(0), '0.00', 'zero shows its places');
eq(formatResult(-1.567), '-1.57', 'a negative rounds and keeps its sign');
// Not a bug: -1.005 is stored as -1.00499999999999989, so it rounds down. This
// is the documented cost of doubles, and the reason the display caps at 12
// significant digits rather than pretending to exactness it does not have.
eq(formatResult(-1.005), '-1.00', 'a float that is not quite .005 rounds down');
eq(formatResult(1234.567), g('1', '234.57'), 'grouping survives fixed rounding');

// A result too small for the requested places must not read as a flat zero.
eq(formatResult(0.0001), '0.0001', 'a value below the requested places falls back to auto');
eq(formatResult(-0.0001), '-0.0001', 'the fallback keeps a negative sign');

setDecimals(5);
eq(formatResult(1 / 3), '0.33333', 'five places');
setDecimals(1);
eq(formatResult(1 / 3), '0.3', 'one place');
eq(formatResult(0.06), '0.1', 'one place rounds up');

setDecimals('auto');
eq(formatResult(1 / 3), '0.333333333333', 'auto restores full display precision');
eq(formatResult(0.4), '0.4', 'auto drops trailing zeros');
eq(formatResult(2), '2', 'auto leaves a whole number bare');

setDecimals(2);
eq(formatResult(Infinity), '∞', 'fixed places do not disturb infinity');
eq(formatResult(NaN), '—', 'fixed places do not disturb NaN');
eq(formatResult(1e20).includes('×10^'), true, 'very large results stay in exponential form');
setDecimals('auto');

if (failures.length) {
  console.error(`\n${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${pass} passed`);
