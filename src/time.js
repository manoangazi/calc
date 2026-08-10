/*
 * Durations for TIM mode. Pure and DOM-free, so the tests import it directly.
 *
 * A duration is an integer number of seconds. Whole-second granularity is the
 * *model*, not a display rounding — × and ÷ round at the point of the operation,
 * so (1h / 7) * 7 is 0:59:58 rather than 1:00:00. That is the honest answer at
 * this granularity, and pinning it in the tests is deliberate.
 *
 * Two spellings are accepted and converge here, into one value:
 *
 *   colon   1:20.45     `:` splits hours from minutes, `.` minutes from seconds
 *   suffix  1h20m45s    units h > m > s, descending, each at most once
 *
 * Both are positional: the meaning of a field comes from the *markers present*,
 * never from counting digits. That is what kills the H:MM-versus-MM:SS ambiguity
 * every other time calculator suffers from. `1:20` is unambiguously 1 h 20 m and
 * `20.45` is unambiguously 20 m 45 s, because the marker says which is which.
 *
 * A literal with no marker at all is a *scalar*, not a duration — that is what
 * makes `1h / 2` mean what it looks like. See evaluateTime in eval.js for the
 * type rules that fall out of the distinction.
 */

import { CalcError } from './errors.js';

export const MINUTE = 60;
export const HOUR = 3600;

/** Marker → its position in the descending field order, within its own family. */
const RANK = { ':': 0, '.': 1, h: 0, m: 1, s: 2 };
const SCALE = [HOUR, MINUTE, 1];

export const MARKERS = /[:.hms]/;
const COLON_MARKERS = /[:.]/;
const SUFFIX_MARKERS = /[hms]/;
const SCALAR = /^\d+$/;

/*
 * With a colon present, group 2 is minutes; without one but with a point, group
 * 2 is still minutes. That falls out of the pattern rather than needing a branch,
 * and it is why `20.45` and `1:20` cannot be confused.
 */
const COLON_FORM = /^(?:(\d*):)?(\d*)(?:\.(\d*))?$/;

const dur = (seconds) => ({ seconds, duration: true });
export const scalar = (seconds) => ({ seconds, duration: false });

function parseColonForm(text) {
  const m = COLON_FORM.exec(text);
  // A bare ":" or "." carries no number. Rejected rather than read as zero: it
  // is a half-typed literal, and the preview should stay blank until it is not.
  if (!m || !/\d/.test(text)) return null;
  const [, h, min, sec] = m;
  return Number(h || 0) * HOUR + Number(min || 0) * MINUTE + Number(sec || 0);
}

/**
 * `1h20m45s`, and the shorthand people actually write: a **trailing bare group
 * takes the next unit down**, so `1h20` is 1 h 20 m and `20m45` is 20 m 45 s.
 * Only the last group may be bare, and only if something named a unit before it.
 */
function parseSuffixForm(text) {
  const re = /(\d+)([hms]?)/y;
  let seconds = 0;
  let last = -1;
  let i = 0;

  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return null;
    i = re.lastIndex;

    let rank;
    if (m[2]) {
      rank = RANK[m[2]];
      // Strictly descending, so `20m1h` and `1h2h` are both rejected rather
      // than quietly summed in whatever order they were typed.
      if (rank <= last) return null;
    } else {
      if (last < 0 || i !== text.length) return null;
      rank = last + 1;
      if (rank > RANK.s) return null;
    }
    last = rank;
    seconds += Number(m[1]) * SCALE[rank];
  }

  return last < 0 ? null : seconds;
}

/**
 * One TIM literal as a value. Throws `CalcError('syntax')` rather than returning
 * null, because the tokenizer has already decided this is a number token and the
 * caller has no other way to say "that was not one".
 *
 * Fields may overflow on input — `90m` is 90 minutes and `100h` is 100 hours.
 * Normalisation is the formatter's job, not the parser's.
 */
export function parseLiteral(text) {
  if (SCALAR.test(text)) return scalar(Number(text));

  const suffix = SUFFIX_MARKERS.test(text);
  const colon = COLON_MARKERS.test(text);

  // `1h20.45` is the one input where the two grammars could disagree about which
  // field the trailing number belongs to. Rejected outright rather than resolved
  // by precedence, which would be a rule nobody could guess.
  const seconds = suffix && colon ? null
    : suffix ? parseSuffixForm(text)
    : colon ? parseColonForm(text)
    : null;

  if (seconds === null || !Number.isFinite(seconds)) {
    throw new CalcError('syntax', `malformed time "${text}"`);
  }
  return dur(seconds);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Canonical `H:MM:SS`. Always three fields, so the display — unlike the input —
 * can never be ambiguous, and hours accumulate past 24 rather than rolling into
 * days, which is what a timesheet wants.
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return seconds > 0 ? '∞' : '-∞';
  const t = Math.round(Math.abs(seconds));
  const h = Math.floor(t / HOUR);
  const m = Math.floor((t % HOUR) / MINUTE);
  return `${seconds < 0 ? '-' : ''}${h}:${pad(m)}:${pad(t % MINUTE)}`;
}

/** The number a timesheet or an invoice actually wants. */
export const decimalHours = (seconds) => seconds / HOUR;

/**
 * A duration as buffer text, so a result can be continued from, or null when it
 * cannot be written as one — the same contract `plainDecimal` in model.js has,
 * and for the same reason: better to refuse than to inject something the
 * tokenizer will choke on for the rest of the session.
 *
 * Emits the suffix spelling, because that is what the on-screen keys produce.
 */
export function toBuffer(value) {
  if (!value || !value.duration || !Number.isFinite(value.seconds)) return null;
  const t = Math.round(Math.abs(value.seconds));
  if (!Number.isSafeInteger(t)) return null;

  const h = Math.floor(t / HOUR);
  const m = Math.floor((t % HOUR) / MINUTE);
  const s = t % MINUTE;

  let out = '';
  if (h) out += `${h}h`;
  if (m) out += `${m}m`;
  if (s || out === '') out += `${s}s`;
  return (value.seconds < 0 ? '-' : '') + out;
}

/**
 * Whether `marker` may be inserted between `left` and `right`, which are the two
 * halves of the literal the caret sits inside.
 *
 * Split rather than passed whole because a literal can be edited from the
 * middle: everything to the left must rank above the new marker and everything
 * to the right below it, which is the same check the ordering rule in
 * `parseSuffixForm` makes, applied one marker at a time.
 */
export function canInsertMarker(left, right, marker) {
  const all = left + right;
  if (all.includes(marker)) return false;
  // No mixing the spellings inside one literal.
  if (SUFFIX_MARKERS.test(all) && COLON_MARKERS.test(marker)) return false;
  if (COLON_MARKERS.test(all) && SUFFIX_MARKERS.test(marker)) return false;
  // `h` names the digits before it, so it needs some. `:` and `.` do not —
  // `.45` and `:90` are legitimate minutes-and-seconds-only literals.
  if (SUFFIX_MARKERS.test(marker) && !/\d$/.test(left)) return false;

  const rank = RANK[marker];
  for (const c of left) if (c in RANK && RANK[c] >= rank) return false;
  for (const c of right) if (c in RANK && RANK[c] <= rank) return false;
  return true;
}
