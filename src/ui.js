import { initialState, apply, preview, openDepth } from './model.js';
import { formatExpression, formatResult, config, setDecimals, setRadix } from './format.js';
import { ERRORS } from './errors.js';
import { addEntry, loadHistory, saveHistory, fromStored } from './history.js';
import { convertBuffer, DEC, HEX } from './radix.js';

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

  const showCaret = !state.committed;
  for (const part of formatExpression(state.buf)) {
    if (showCaret && part.i === state.caret) exprEl.append(caret());
    const span = document.createElement('span');
    span.className = part.kind;
    span.textContent = part.text;
    if (part.i !== undefined) span.dataset.i = part.i;
    exprEl.append(span);
  }
  if (showCaret && state.caret >= state.buf.length) exprEl.append(caret());
}

function render() {
  renderExpression();

  if (state.buf === '') lastGood = '';

  const fault = state.error ? ERRORS[state.error] : null;
  let text;
  if (fault) {
    text = state.error === 'overflow' ? formatResult(state.result) : fault.display;
  } else if (state.committed) {
    text = formatResult(state.result);
  } else {
    const value = preview(state.buf);
    if (value !== null) lastGood = formatResult(value);
    text = state.buf === '' ? '' : lastGood;
  }
  resultEl.textContent = text;

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
 * Step the expression down through a few sizes until it fits three lines. The
 * base size is read back from the stylesheet rather than hardcoded, so the
 * landscape and committed rules stay in charge of the starting point.
 */
function fitExpression() {
  exprEl.style.fontSize = '';
  if (state.committed) return;
  const base = parseFloat(getComputedStyle(exprEl).fontSize);
  const sizes = [base, base * 0.85, base * 0.74, Math.max(MIN_EXPR_PX, base * 0.63)];
  for (const size of sizes) {
    exprEl.style.fontSize = `${size}px`;
    if (exprEl.scrollHeight <= size * 1.35 * 3 + 2) break;
  }
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
    val.textContent = `= ${formatResult(entry.value)}`;

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
  const radix = Number(entry.dataset.radix) === HEX ? HEX : DEC;
  if (radix !== config.radix) applyRadix(radix, { convert: false });
  run(`load:${entry.dataset.src}`);
  openHistory(false);
});

/* ---- copy ---------------------------------------------------------------- */

async function copyResult() {
  const text = resultEl.textContent;
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
    if (commit && armed) copyResult();
    armed = false;
  };

  el.addEventListener('pointerup', () => release(true));
  el.addEventListener('pointercancel', () => release(false));
  el.addEventListener('pointerleave', () => release(false));
}

bindHoldToCopy(resultEl);

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
 * `convert` is off when the mode is following something that already carries its
 * own digits, such as recalling a hex entry from the tape.
 */
function applyRadix(value, { convert = true } = {}) {
  const from = config.radix;
  const to = setRadix(value);

  if (convert && from !== to) {
    const { buf, lossy, tooLong } = convertBuffer(state.buf, from, to);
    if (tooLong) {
      // Hex is denser than decimal, so a full buffer can fail to fit. Refusing
      // the switch keeps the expression; going ahead would truncate it.
      setRadix(from);
      radixSel.value = String(from);
      flash('Too long to convert');
      return;
    }
    // `committed` cannot survive the switch: the stored result belongs to the
    // old base. Dropping it re-evaluates the converted buffer as a live preview.
    state = { ...initialState(), buf, caret: buf.length };
    if (lossy) flash('Fractions dropped');
  }

  radixSel.value = String(to);
  for (const pad of keypads) pad.hidden = pad.classList.contains('hex') !== (to === HEX);
  dpBlock.hidden = to === HEX;
  renderTape();
  render();
}

radixSel.addEventListener('change', () => applyRadix(radixSel.value));

menu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-act]');
  if (!item) return;
  if (item.dataset.act === 'copy') {
    copyResult();
    closeMenu();
  } else if (item.dataset.act === 'dp') {
    // Menu stays open — picking places is something you compare, not commit to.
    applyDecimals(item.dataset.dp);
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

/* The base is deliberately not persisted — the app always opens in decimal, so
   a keypad full of letters is never the first thing you meet. */
applyRadix(DEC, { convert: false });
