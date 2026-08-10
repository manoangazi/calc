import { initialState, apply, preview, openDepth } from './model.js';
import { formatExpression, formatResult, config, setDecimals, setRadix } from './format.js';
import { ERRORS } from './errors.js';
import { addEntry, loadHistory, saveHistory, fromStored } from './history.js';
import { convertBuffer, DEC, HEX } from './radix.js';
import { TIM } from './tokenizer.js';
import { decimalHours } from './time.js';
import { CATEGORIES, DEFAULT_CATEGORY, applyRates, convert, defaultPair, findCategory, findUnit } from './units.js';
import { fetchRates, isStale, loadCached, needsRefresh, saveCached } from './currency.js';

const card = document.querySelector('.display');
const exprEl = document.getElementById('expression');
const resultEl = document.getElementById('result');
const hintEl = document.getElementById('hint');
const keypads = [...document.querySelectorAll('.keypad')];
const utility = document.querySelector('.utility');
const menuBtn = document.querySelector('[data-act="menu"]');
const menu = document.querySelector('.menu');
const dpBlock = document.querySelector('.dp-block');
const radixSel = document.getElementById('radix');
const convertedEl = document.getElementById('converted');
const convRow = document.querySelector('.conv');
const convFromSel = document.getElementById('conv-from');
const convToSel = document.getElementById('conv-to');
const catBlock = document.querySelector('.cat-block');
const catRow = document.querySelector('.cat-row');
const rateNoteEl = document.getElementById('rate-note');
// One per keypad: only the visible one is on screen, but both are kept in step
// so switching mode never reveals a stale bracket count.
const parenDepthEls = [...document.querySelectorAll('[data-cmd="paren"] .depth')];
const historyBtn = document.querySelector('[data-act="history"]');
const historyPanel = document.querySelector('.history');
const tapeEl = document.querySelector('.tape');
const tapeEmptyEl = document.querySelector('.tape-empty');

const DP_KEY = 'manocalc.decimals';
const LONG_PRESS_MS = 500;
const MIN_EXPR_PX = 24;

let state = initialState();
let lastGood = '';
let history = [];
let flashMsg = '';
let flashTimer = null;

/* 'dec' | 'hex' | 'con' | 'tim'. CON is *not* a radix — it is decimal arithmetic
   with a conversion applied to the result, so config.radix stays DEC throughout
   and the engine modules need to know nothing about it. TIM is the opposite: a
   real radix with its own literals, evaluator and keypad, exactly as HEX is. */
let mode = 'dec';

/** The radix each mode runs on. CON is absent because it runs on DEC. */
const MODE_RADIX = { hex: HEX, tim: TIM };
const RADIX_MODE = { [HEX]: 'hex', [TIM]: 'tim' };
let conversion = null;

/* The rate set currently loaded into the currency category, or null if we have
   never reached the feed on this device. Held here only so the caption can name
   its date and age — the numbers themselves live on the unit objects. */
let rates = null;

/* ---- rendering ---------------------------------------------------------- */

function renderExpression() {
  exprEl.textContent = '';
  if (state.buf === '') {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = '0';
    exprEl.append(span);
    return;
  }

  const caret = () => {
    const c = document.createElement('span');
    c.className = 'caret';
    return c;
  };

  /*
   * Each number goes in its own wrapper so a line break cannot land inside one.
   * Splitting `10000000000` across two lines reads as two different numbers —
   * the eye has no way to tell a wrap from a `+`. Operators and parens stay
   * outside the wrappers, so those are where the line is allowed to break.
   *
   * This is nesting only. The parts, their text and their `data-i` indices are
   * exactly as before, so the buffer, the caret arithmetic and tap-to-place are
   * untouched — `querySelectorAll('[data-i]')` still finds every character.
   */
  const showCaret = !state.committed;
  let run = null;
  for (const part of formatExpression(state.buf)) {
    const inNumber = part.kind === 'num' || part.kind === 'group';
    if (inNumber && !run) {
      run = document.createElement('span');
      run.className = 'run';
      exprEl.append(run);
    } else if (!inNumber) {
      run = null;
    }
    const target = run ?? exprEl;
    if (showCaret && part.i === state.caret) target.append(caret());
    const span = document.createElement('span');
    span.className = part.kind;
    span.textContent = part.text;
    if (part.i !== undefined) span.dataset.i = part.i;
    target.append(span);
  }
  if (showCaret && state.caret >= state.buf.length) exprEl.append(caret());
}

function render() {
  renderExpression();

  if (state.buf === '') lastGood = '';

  const fault = state.error ? ERRORS[state.error] : null;
  let text;
  // Kept alongside `text` so the converted line can reuse the number render()
  // already resolved rather than evaluating the buffer a second time.
  let value = null;
  if (fault) {
    text = state.error === 'overflow' ? formatResult(state.result) : fault.display;
  } else if (state.committed) {
    value = state.result;
    text = formatResult(state.result);
  } else {
    value = preview(state.buf);
    if (value !== null) lastGood = formatResult(value);
    text = state.buf === '' ? '' : lastGood;
  }
  resultEl.textContent = text;
  renderConverted(state.buf === '' ? null : value);

  // Errors are a quiet caption, never an alert. A flash message borrows the
  // same line rather than introducing a toast.
  hintEl.textContent = flashMsg || (fault ? fault.hint : '');

  card.classList.toggle('committed', state.committed && !state.error);
  card.classList.toggle('error', !!state.error && state.error !== 'overflow');

  const depth = openDepth(state.buf);
  for (const el of parenDepthEls) el.textContent = depth > 0 ? String(depth) : '';

  fitExpression();
}

/**
 * Space the card can actually give the expression: its own content box, less
 * every sibling that has to stay visible.
 *
 * A fixed three-line budget was wrong, because the card's other rows are not
 * fixed. TIM shows the decimal-hours line and CON's currency category adds the
 * rate note on top of that, so the same three lines that fit in DEC pushed the
 * utility row — and with it backspace — down behind the keypad. Measuring is
 * also self-maintaining: a future row costs the expression its height without
 * anyone having to remember to retune a constant.
 *
 * Called after renderConverted and renderRateNote, so the hidden flags are
 * current rather than a frame stale.
 */
function expressionRoom() {
  const cs = getComputedStyle(card);
  let used = 0;
  for (const el of card.children) {
    if (el === exprEl || el.hidden) continue;
    const s = getComputedStyle(el);
    if (s.position === 'absolute' || s.display === 'none') continue;   // the popover menu
    used += el.getBoundingClientRect().height
          + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
  }
  return card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - used;
}

/**
 * Step the expression down through a few sizes until it fits. The base size is
 * read back from the stylesheet rather than hardcoded, so the landscape and
 * committed rules stay in charge of the starting point.
 *
 * Three lines stays the ceiling on looks; the measured room is the hard limit.
 * If even the smallest size overflows, `.expression` scrolls rather than
 * shoving the rows below it out of the card.
 */
function fitExpression() {
  exprEl.style.fontSize = '';
  exprEl.classList.remove('breakable');
  if (state.committed) return;
  const base = parseFloat(getComputedStyle(exprEl).fontSize);
  const sizes = [base, base * 0.85, base * 0.74, Math.max(MIN_EXPR_PX, base * 0.63)];
  const room = expressionRoom();

  const step = () => {
    for (const size of sizes) {
      exprEl.style.fontSize = `${size}px`;
      if (exprEl.scrollHeight <= Math.min(size * 1.35 * 3 + 2, room)) break;
    }
  };
  step();

  // Numbers are unbreakable, so one longer than the card would run off the edge
  // rather than wrap. Let that number break after all — a split number is bad,
  // a number with its tail off-screen is worse — and re-fit at the new shape.
  if (exprEl.scrollWidth > exprEl.clientWidth + 1) {
    exprEl.classList.add('breakable');
    step();
  }

  // Keep the caret end in view when even the smallest size had to scroll.
  exprEl.scrollTop = exprEl.scrollHeight;
}

/**
 * The converted value, under the result. Blanked rather than dashed whenever
 * there is nothing honest to show: outside CON, on an empty or faulted buffer,
 * and on a non-finite result such as 1/0 — the result line already says what
 * went wrong, and a second complaint underneath just reads as noise.
 */
function renderConverted(value) {
  renderRateNote();

  /* TIM borrows the same line for decimal hours — the number a timesheet or an
     invoice wants, and the one thing H:MM:SS is bad at. Only a duration has one;
     a scalar result is already an ordinary number and saying "9 h" of it would
     be a claim about units that nobody made. */
  if (mode === 'tim') {
    const ok = value && typeof value === 'object' && value.duration
      && Number.isFinite(value.seconds);
    convertedEl.textContent = ok
      ? `${formatResult(decimalHours(value.seconds), DEC)} h`
      : '';
    return;
  }

  if (mode !== 'con' || !conversion || value === null
      || typeof value !== 'number' || !Number.isFinite(value)) {
    convertedEl.textContent = '';
    return;
  }
  const out = convert(value, conversion.from, conversion.to);
  // A missing rate is captioned, not blanked. Every other empty case above is a
  // question the user has not finished asking; this one is a question we cannot
  // answer, and in a money context a blank line reads as zero.
  if (out === null) {
    convertedEl.textContent = 'Rates unavailable';
    return;
  }
  convertedEl.textContent = `${formatResult(out)} ${conversion.to.label}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08-10' → '10 Aug'. Parsed by hand: `new Date('…')` on a bare date is
    UTC, which renders as the previous day for anyone west of Greenwich. */
function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/**
 * The provenance line under the converted value, in the currency category only.
 *
 * These are ECB daily reference rates, not dealing rates, so the date is not
 * decoration — it is the difference between a number you can quote and a number
 * you can check against. It sits on the display card next to the figure it
 * qualifies rather than in the menu: a staleness warning you have to go looking
 * for is a staleness warning that does not exist.
 *
 * Red keys off when we last *reached* the feed, never off the feed's own date.
 * The ECB does not publish at weekends, so a Friday rate read on a Sunday is
 * correct; flagging it would go red every weekend and train the user to ignore
 * the one signal that matters.
 */
function renderRateNote() {
  const live = mode === 'con' && conversion?.category.live === true;
  rateNoteEl.hidden = !live;
  if (!live) {
    rateNoteEl.textContent = '';
    rateNoteEl.classList.remove('stale');
    return;
  }
  if (!rates) {
    rateNoteEl.textContent = 'No rates yet';
    rateNoteEl.classList.add('stale');
    return;
  }
  const stale = isStale(rates, Date.now());
  // The word carries the meaning, the colour only makes it findable — colour
  // alone fails for a colour-blind user and in bright sunlight.
  rateNoteEl.textContent = `ECB ${shortDate(rates.date)}${stale ? ' · Stale' : ''}`;
  rateNoteEl.classList.toggle('stale', stale);
}

/* ---- input -------------------------------------------------------------- */

function haptic(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function flash(msg) {
  flashMsg = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashMsg = '';
    render();
  }, 1400);
  render();
}

function run(cmd, feedback = 8) {
  const before = state;
  state = apply(state, cmd);
  // A fresh commit is the only thing that earns a tape entry.
  if (!before.committed && state.committed && !state.error) {
    history = addEntry(history, { src: state.buf, value: state.result });
    saveHistory(localStorage, history);
    renderTape();
  }
  render();
  haptic(feedback);
}

/** Buffer index nearest to a tap, choosing the side by which half was hit. */
function indexAtPoint(x, y) {
  const spans = exprEl.querySelectorAll('[data-i]');
  let best = null;
  let bestDist = Infinity;
  for (const span of spans) {
    const r = span.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = { i: Number(span.dataset.i), mid: r.left + r.width / 2 };
    }
  }
  if (!best) return state.buf.length;
  return x > best.mid ? best.i + 1 : best.i;
}

exprEl.addEventListener('click', (e) => {
  if (state.buf === '') return;
  run(`caret:${indexAtPoint(e.clientX, e.clientY)}`, 0);
});

/* Long press. `suppress` stops the click that follows the release from firing
   the short action as well. */
let timer = null;
let suppress = false;

function startPress(e) {
  const key = e.target.closest('[data-long]');
  suppress = false;
  clearTimeout(timer);
  if (!key || key.disabled) return;
  timer = setTimeout(() => {
    suppress = true;
    run(key.dataset.long, 20);
  }, LONG_PRESS_MS);
}

function endPress() {
  clearTimeout(timer);
  timer = null;
}

for (const root of [...keypads, utility]) {
  root.addEventListener('pointerdown', startPress);
  root.addEventListener('pointerup', endPress);
  root.addEventListener('pointercancel', endPress);
  root.addEventListener('pointerleave', endPress);
  root.addEventListener('click', (e) => {
    const key = e.target.closest('[data-cmd]');
    if (!key || key.disabled) return;
    if (suppress) {
      suppress = false;
      return;
    }
    run(key.dataset.cmd);
  });
}

/* ---- history tape -------------------------------------------------------- */

function renderTape() {
  tapeEl.textContent = '';
  tapeEmptyEl.hidden = history.length > 0;

  for (const stored of history) {
    const entry = fromStored(stored);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.src = entry.src;
    btn.dataset.radix = String(entry.radix);

    const src = document.createElement('span');
    src.className = 'tape-src';
    // Re-rendered from the raw source, so digit grouping and the decimal-places
    // setting apply to old entries too. Each entry renders in the base it was
    // calculated in, not the base currently selected.
    for (const part of formatExpression(entry.src, entry.radix)) {
      const span = document.createElement('span');
      span.className = part.kind;
      span.textContent = part.text;
      src.append(span);
    }

    const val = document.createElement('span');
    val.className = 'tape-value';
    // The entry's own radix, not the live one: a hex BigInt announces itself by
    // its type, but a TIM duration is an ordinary object and would otherwise
    // render as decimal seconds while the app sat in DEC.
    val.textContent = `= ${formatResult(entry.value, entry.radix)}`;

    btn.append(src, val);
    li.append(btn);
    tapeEl.append(li);
  }
}

function openHistory(open) {
  historyPanel.hidden = !open;
  historyBtn.setAttribute('aria-expanded', String(open));
  if (open) renderTape();
}

historyBtn.addEventListener('click', () => openHistory(historyPanel.hidden));

historyPanel.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) {
    if (act.dataset.act === 'history-close') openHistory(false);
    if (act.dataset.act === 'history-clear') {
      history = [];
      saveHistory(localStorage, history);
      renderTape();
    }
    return;
  }
  const entry = e.target.closest('[data-src]');
  if (!entry) return;
  // Recalling switches the mode to the entry's own base rather than
  // reinterpreting its digits in whichever base happens to be selected — the
  // reducer would reject "FF" in decimal and silently drop the recall.
  // Unconditional: in CON the radix is already DEC, so a `radix !== config.radix`
  // guard would be false and leave the app in CON with a stale unit pair applied
  // to a recalled arithmetic entry.
  applyMode(RADIX_MODE[Number(entry.dataset.radix)] ?? 'dec', { rewrite: false });
  run(`load:${entry.dataset.src}`);
  openHistory(false);
});

/* ---- copy ---------------------------------------------------------------- */

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    flash('Copied');
  } catch {
    flash('Could not copy');
  }
}

/*
 * The clipboard write happens on release, not when the timer fires: Safari only
 * honours navigator.clipboard inside a user-gesture task, and a setTimeout
 * callback is no longer one. The timer only arms the action and buzzes.
 */
/* In CON the number the user is looking at is the converted one, so the line
   they press is the line they get. */
const copyResult = () => copyText(resultEl.textContent);

function bindHoldToCopy(el) {
  let timer = null;
  let armed = false;

  el.addEventListener('pointerdown', () => {
    armed = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      armed = true;
      el.classList.add('armed');
      haptic(20);
    }, LONG_PRESS_MS);
  });

  const release = (commit) => {
    clearTimeout(timer);
    el.classList.remove('armed');
    if (commit && armed) copyText(el.textContent);
    armed = false;
  };

  el.addEventListener('pointerup', () => release(true));
  el.addEventListener('pointercancel', () => release(false));
  el.addEventListener('pointerleave', () => release(false));
}

bindHoldToCopy(resultEl);
bindHoldToCopy(convertedEl);

/* ---- utility controls and menu ------------------------------------------ */

function closeMenu() {
  menu.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
});

document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) closeMenu();
});

/**
 * Rounding is display-only, so the tape re-renders too: an entry calculated at
 * 2 places shows 5 places the moment the setting changes, because the stored
 * value never lost anything.
 */
function applyDecimals(value) {
  const applied = setDecimals(value);
  for (const btn of menu.querySelectorAll('[data-act="dp"]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.dp === String(applied)));
  }
  try {
    localStorage.setItem(DP_KEY, String(applied));
  } catch { /* private mode: the setting just will not persist */ }
  renderTape();
  render();
}

/**
 * Switching base rewrites every number literal in the buffer, not just the
 * result, so a half-typed calculation survives the switch — and so typing a
 * number and flipping the control is all a base conversion takes.
 *
 * `rewrite` is off when the mode is following something that already carries its
 * own digits, such as recalling a hex entry from the tape.
 *
 * Returns whether the switch happened. It can genuinely be refused, and the
 * caller has to know: `applyMode` routes HEX → CON through here, and going ahead
 * after a refusal would leave CON holding a hex buffer and a BigInt result.
 *
 * This does *not* touch the select. `applyMode` is the single owner of
 * `radixSel.value`, so that a plain radix change cannot knock the control out of
 * CON behind its back.
 */
const PAD_CLASS = { [DEC]: 'dec', [HEX]: 'hex', [TIM]: 'tim' };

/* Markers that make a buffer mean something mode-specific: TIM's field
   separators, and the decimal point, which is a fraction in DEC and a
   minutes/seconds boundary in TIM. All lowercase, so a hex buffer full of
   uppercase A-F never matches. */
const TIME_MARKED = /[.:hms]/;

/**
 * The buffer across a switch into or out of TIM.
 *
 * TIM shares no literal grammar with the other bases, so `convertBuffer` has
 * nothing to rewrite — the two would have to *reinterpret*, and `20.45` means
 * twenty-point-four-five in DEC and 20 m 45 s in TIM. Rather than change an
 * expression's meaning behind the user's back, only pure integer arithmetic
 * crosses; that means the same thing in every mode. Anything carrying a marker
 * is cleared and the user is told.
 *
 * Integer digits still need converting when hex is the other side, so that leg
 * goes through the existing `convertBuffer` rather than duplicating it.
 */
function crossTime(buf, from, to) {
  if (TIME_MARKED.test(buf)) return { buf: '', lossy: false, tooLong: false, cleared: true };
  if (from === HEX) return convertBuffer(buf, HEX, DEC);
  if (to === HEX) return convertBuffer(buf, DEC, HEX);
  return { buf, lossy: false, tooLong: false };
}

function applyRadix(value, { rewrite = true } = {}) {
  const from = config.radix;
  const to = setRadix(value);

  if (rewrite && from !== to) {
    const crossing = from === TIM || to === TIM;
    const { buf, lossy, tooLong, cleared } = crossing
      ? crossTime(state.buf, from, to)
      : convertBuffer(state.buf, from, to);
    if (tooLong) {
      // Hex is denser than decimal, so a full buffer can fail to fit. Refusing
      // the switch keeps the expression; going ahead would truncate it.
      setRadix(from);
      flash('Too long to convert');
      return false;
    }
    // `committed` cannot survive the switch: the stored result belongs to the
    // old base. Dropping it re-evaluates the converted buffer as a live preview.
    state = { ...initialState(), buf, caret: buf.length };
    if (cleared) flash('Expression cleared');
    else if (lossy) flash('Fractions dropped');
  }

  const pad = PAD_CLASS[to] ?? 'dec';
  for (const el of keypads) el.hidden = !el.classList.contains(pad);
  // The utility row sits inside the display card, above every keypad, so CSS
  // cannot see which one is showing. Backspace needs it to match the operator
  // column's width, which differs between the four- and five-column grids.
  document.body.dataset.pad = pad;
  // Hidden in hex, where results are exact integers. Kept in TIM, where results
  // are whole seconds but the decimal-hours line underneath is what it governs.
  dpBlock.hidden = to === HEX;
  return true;
}

/**
 * The one place that decides what mode the app is in. Everything mode-dependent
 * hangs off here: the select's own value, which keypad is on screen, and whether
 * the decimal-places and conversion controls exist.
 *
 * CON runs on decimal arithmetic and the decimal keypad, so entering it from HEX
 * means a real base conversion first — which `applyRadix` can refuse.
 */
function applyMode(next, { rewrite = true } = {}) {
  const radix = MODE_RADIX[next] ?? DEC;
  if (!applyRadix(radix, { rewrite: rewrite && mode !== next })) {
    // Refused: stay put, and put the control back where it was.
    radixSel.value = mode === 'con' ? 'con' : String(config.radix);
    render();
    return;
  }

  mode = next;
  radixSel.value = next === 'con' ? 'con' : String(radix);

  if (next === 'con') {
    if (!conversion) selectCategory(DEFAULT_CATEGORY);
  } else {
    // Cleared, not just hidden — a stale conversion must not flash back into
    // view the next time CON or TIM is selected.
    convertedEl.textContent = '';
  }
  convRow.hidden = next !== 'con';
  // The one piece of display shared by two modes: converted units in CON,
  // decimal hours in TIM.
  convertedEl.hidden = next !== 'con' && next !== 'tim';
  catBlock.hidden = next !== 'con';

  renderTape();
  render();
}

/* Branch on the string. `Number('con')` is NaN, which setRadix would quietly
   collapse to DEC — right answer, wrong reason, and it would break the moment a
   fourth option appeared. */
radixSel.addEventListener('change', () => {
  const v = radixSel.value;
  applyMode(v === 'con' ? 'con' : (RADIX_MODE[Number(v)] ?? 'dec'));
});

/* ---- unit conversion ----------------------------------------------------- */

function fillUnitSelect(sel, category, selected) {
  sel.textContent = '';
  for (const unit of category.units) {
    const opt = document.createElement('option');
    opt.value = unit.id;
    opt.textContent = unit.label;
    if (unit.id === selected.id) opt.selected = true;
    sel.append(opt);
  }
}

function selectCategory(id) {
  const category = findCategory(id) ?? findCategory(DEFAULT_CATEGORY);
  const { from, to } = defaultPair(category);
  conversion = { category, from, to };
  fillUnitSelect(convFromSel, category, from);
  fillUnitSelect(convToSel, category, to);
  for (const btn of catRow.querySelectorAll('[data-act="cat"]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.cat === category.id));
  }
}

/* Built from the table rather than the markup, so adding a category is a
   one-line edit in units.js. */
for (const category of CATEGORIES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.act = 'cat';
  btn.dataset.cat = category.id;
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = category.label;
  catRow.append(btn);
}

/**
 * Fetch rates and adopt them if they arrive.
 *
 * Fire-and-forget by design and never awaited: a failure keeps the cached set,
 * and the caption is already saying how old that is. There is no spinner — the
 * figure quietly correcting itself a moment later is the whole feedback, and a
 * spinner would imply the calculator was waiting on something, which it is not.
 */
function refreshRates() {
  fetchRates().then((snap) => {
    if (!snap) return;
    rates = snap;
    applyRates(snap);
    saveCached(localStorage, snap);
    render();
  });
}

for (const [sel, side] of [[convFromSel, 'from'], [convToSel, 'to']]) {
  sel.addEventListener('change', () => {
    if (!conversion) return;
    conversion[side] = findUnit(conversion.category, sel.value) ?? conversion[side];
    render();
  });
}

menu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-act]');
  if (!item) return;
  if (item.dataset.act === 'copy') {
    copyResult();
    closeMenu();
  } else if (item.dataset.act === 'dp') {
    // Menu stays open — picking places is something you compare, not commit to.
    applyDecimals(item.dataset.dp);
  } else if (item.dataset.act === 'cat') {
    // Closes, unlike decimal places: picking a category is a commitment, and the
    // units it chose are behind the menu.
    selectCategory(item.dataset.cat);
    closeMenu();
    render();
  } else if (item.dataset.act === 'rates') {
    // For the case the daily gate cannot cover: the caption went red while you
    // were offline and you have just reconnected.
    refreshRates();
    closeMenu();
  }
});

/* ---- hardware keyboard --------------------------------------------------- */

/* Brackets map to the explicit open/close commands rather than the smart key —
   if you typed the bracket, you meant that bracket. */
const KEYMAP = {
  '+': 'op:+', '-': 'op:-', '*': 'op:*', 'x': 'op:*', 'X': 'op:*',
  '/': 'op:/', '^': 'op:^', '.': 'dot', ',': 'dot',
  '(': 'open', ')': 'close',
  'Enter': 'equals', '=': 'equals',
  'Backspace': 'back', 'Delete': 'back',
  'Escape': 'clear',
};

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!historyPanel.hidden) {
    if (e.key === 'Escape') openHistory(false);
    return;
  }

  let cmd = null;
  if (e.key >= '0' && e.key <= '9') cmd = `digit:${e.key}`;
  // a-f are digits only in hex. In decimal they stay free for KEYMAP, where x
  // already means multiply.
  else if (config.radix === HEX && /^[a-f]$/i.test(e.key)) cmd = `digit:${e.key.toUpperCase()}`;
  // h/m/s are field markers only in TIM. Elsewhere they stay free, and in hex
  // "f" above has already claimed its letter.
  else if (config.radix === TIM && /^[hms]$/i.test(e.key)) cmd = `unit:${e.key.toLowerCase()}`;
  else if (config.radix === TIM && e.key === ':') cmd = 'colon';
  else if (e.key === 'ArrowLeft') cmd = `caret:${state.caret - 1}`;
  else if (e.key === 'ArrowRight') cmd = `caret:${state.caret + 1}`;
  else if (e.key === 'Home') cmd = 'caret:0';
  else if (e.key === 'End') cmd = `caret:${state.buf.length}`;
  else cmd = KEYMAP[e.key] ?? null;

  if (!cmd) return;
  e.preventDefault();
  run(cmd, 0);
});

window.addEventListener('resize', render);

history = loadHistory(localStorage);
renderTape();

/* The decimal separator used to be switchable and was persisted per device. The
   setting is gone and the point is always "."; drop the stored value so a phone
   that was left on "," does not keep it. */
try {
  localStorage.removeItem('manocalc.decimalSep');
} catch { /* private mode — nothing was persisted to begin with */ }

/* setDecimals validates, so a hand-edited storage value cannot get through. */
let storedDecimals = null;
try {
  storedDecimals = localStorage.getItem(DP_KEY);
} catch { /* private mode */ }
applyDecimals(storedDecimals);

/* Neither the mode nor the unit pair is persisted — the app always opens in
   decimal, so a keypad full of letters is never the first thing you meet. */
selectCategory(DEFAULT_CATEGORY);
applyMode('dec', { rewrite: false });

/* Rates, unlike the mode, *are* persisted: the alternative is an app that cannot
   convert currency until it has been online, including on the flight where you
   most want it to. Loaded synchronously so the first paint already has numbers,
   then corrected in the background if today's set has not been fetched yet. */
try {
  rates = loadCached(localStorage);
} catch { /* private mode */ }
if (rates) applyRates(rates);

/* Fire-and-forget, and deliberately not awaited anywhere. Offline, a DNS failure
   and a CSP block are ordinary conditions here rather than errors — this is a
   calculator that works completely without the network, and a rate refresh must
   never be able to take the boot path down with it. */
if (needsRefresh(rates, Date.now())) refreshRates();
render();
