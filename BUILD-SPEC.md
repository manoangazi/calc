# ManoCalc — personal single-page calculator PWA

A private, installable arithmetic calculator served from GitHub Pages and added to
the iOS home screen. No backend, no build server, no App Store.

---

## 1. Product definition

**What it is:** a one-screen numeric calculator in the spirit of CleverCalc — an
editable expression line on top, a live result underneath, a numeric keypad below.

**Scope (final state):**

- Arithmetic: `+ − × ÷`, exponent `^`, unary minus, decimal point.
- Arbitrarily nested parentheses.
- Live evaluation as you type; `=` commits the result.
- Backspace, clear, caret positioning by tap.
- Runs offline once installed.

**Explicitly out of scope:** scientific functions, memory registers, unit
conversion, currency, history sync, accounts, analytics, anything networked.

**Target:** one user, one iPhone (iOS 17+ Safari), landscape not required.

---

## 2. Delivery model

| Concern | Decision |
| --- | --- |
| Hosting | GitHub Pages on a private-personal repo (`gh-pages` or `/docs` on `main`) |
| URL | `https://<user>.github.io/calc/` |
| Install | Safari → Share → Add to Home Screen (iOS has no `beforeinstallprompt`) |
| Offline | Service worker, cache-first, precache the whole app (it is a handful of KB) |
| Auth | None. The URL is unguessable-ish but public — do not put anything private in it |
| Updates | Push to `main` → Pages redeploys → SW picks up new version on next launch |

> GitHub Pages sites are publicly reachable even from a private repo's Pages in
> some plan tiers. Treat the deployed app as public. That is fine here: a
> calculator holds no data worth protecting.

### Why no framework

The whole app is ~600 lines of vanilla JS/CSS/HTML. A framework adds a build step,
a `node_modules`, and a bundler config to deploy a keypad. Staying dependency-free
means `git push` *is* the deploy, and the service worker precache list is three
files.

---

## 3. Architecture

```
index.html        markup: display region + keypad grid
app.css           layout, safe-area insets, tap targets, dark mode
src/tokenizer.js  string -> token stream
src/parser.js     tokens -> AST (recursive descent, precedence climbing)
src/eval.js       AST -> number (decimal-safe)
src/format.js     number -> display string
src/model.js      expression buffer, caret, keypad command reducer
src/ui.js         DOM binding, event delegation, haptics
sw.js             service worker, precache + cache-first
manifest.webmanifest
icons/            180/192/512 PNG + maskable
test/             plain-JS assertion runner, opened directly in a browser
```

**Data flow:** keypad tap → `model.apply(command)` → new immutable state →
`ui.render(state)`. Evaluation is a pure function of the expression string; it is
re-run on every keystroke and failures are swallowed into "incomplete" rather than
shown as errors while typing.

### Evaluation core

Recursive descent over this grammar:

```
expr    := term (('+' | '-') term)*
term    := factor (('*' | '/') factor)*
factor  := ('-')? power
power   := primary ('^' factor)?
primary := NUMBER | '(' expr ')'
```

`power` sits below `factor` and recurses back into it, which buys two things at
once: exponent binds tighter than unary minus (`-2^2` is `-4`) and associates to
the right (`2^3^2` is `2^9`), while `2^-3` still parses.

Two things get decided here and never revisited:

1. **`eval()` and `Function()` are banned.** The parser exists precisely so no
   user-typed string is ever executed. This also keeps the app CSP-clean.
2. **Float artifacts are a display problem, not a math problem.** Compute in
   IEEE doubles, then round the *rendered* value to 12 significant digits
   (`0.1 + 0.2` → `0.3`). Revisit only if a real-world case breaks it; a decimal
   library is a stage-6 option, not a stage-1 obligation.

### Implicit-close rule

`12×(3+4` evaluates live as `12×(3+4)` — missing right parens are closed
virtually for the preview only. The buffer is never mutated behind the user's
back. `=` materialises the closing parens into the buffer, then evaluates.

---

## 4. Screen spec

Modelled on the ClevCalc reference layout.

```
┌─────────────────────────────┐
│ ☰  Calc              ⟲   ⋮  │  app bar (dark)
├─────────────────────────────┤
│                             │
│            5 566×555÷33     │  expression   39px, right-aligned, wraps
│                             │
│                    93 610   │  live result  26px, dimmed, right-aligned
│  ⋯        ⌃              ⌫  │  utility row  inside the same card
├─────────────────────────────┤
│  C    ( )    ^      /       │
│  7     8     9      ×       │
│  4     5     6      −       │
│  1     2     3      +       │
│  0    00     .      =       │
└─────────────────────────────┘
```

**Display region — one card, two zones.** The expression and the result share a
single white surface. The result sits dimmed (`--text-muted`) while it is a
*preview*; on `=` it swaps places — the result becomes the large primary line and
the expression shrinks to a dimmed line above it. That swap is the whole feedback
model, so it belongs in stage 1, not in polish.

**Operators are tinted in the expression.** Digits render in primary text,
`× ÷ + −` in the accent colour. It makes a long expression scannable at a glance
and costs one span-per-token in the renderer.

**Type scale on the keypad — size by ink, not by font-size.** Digits are 28px
semibold. `×` and `+` draw well below their em box, so at the same nominal size
they render *smaller* than a digit: at 35px their ink measured 20px against the
digits' 20px only after being pushed to 41px. Font-size is therefore the wrong
number to reason about here. Measure with canvas `actualBoundingBoxAscent` +
`actualBoundingBoxDescent` and match on that.

The division key shows `/` rather than `÷`. As a full-height diagonal it is the
opposite case — at an equal font-size its ink runs about 1.4× the others — so it
is set smaller (24px) and heavier (700) to carry the same visual mass.

`C`, `( )` and `=` stay at digit size. Every value has a landscape counterpart
and a third set below 360px height. In both landscape blocks the constraint is
the key box, not the ink: with `line-height: 1` a glyph much above the row height
overflows its key, so fitting wins over parity there.

**Clear is not a function key.** `C` carries its own colour (`--danger`) on its
own tint rather than sharing the accent with `( )` and `^` — it throws work away
and should not look like a sibling of the keys that build an expression. Measured
6.1:1 in light and 7.1:1 in dark.

**Digit grouping while typing.** Integer parts are grouped with a thin space
(`5 566`), never a comma — a comma would collide with the decimal separator on a
locale that uses it. Grouping is applied at render time only; the buffer holds
raw digits.

**The `( )` key is one key, and it decides.** Rule, in order:

1. If the previous token is an operator, an open paren, or the buffer is empty → insert `(`.
2. Else if open depth > 0 → insert `)`.
3. Else (previous token is a digit or `)` and depth is 0) → insert `×(`.

Long-press the key to force the opposite choice. Nesting depth is shown as a small
count on the key face when depth > 0 — that replaces the separate depth badge.

**Utility row** sits inside the display card, not in the keypad grid:
`⋯` (overflow — copy result, decimal places) and `⌫` (backspace, accent-filled).
Long-press `⌫` clears.

A `⌃` control used to sit between them, collapsing a wrapped expression to one
line. It was removed: it is disabled until an expression wraps past three lines,
which almost never happens, so in practice it was a permanently dead button in
the middle of the row. The auto-shrink already keeps long expressions readable.

**Keypad rules that matter on a phone:**

- Keys are white tiles on the page background; the gutter *is* the background.
- Minimum tap target 44×44 pt; rows are 50 pt with 5 pt gutters.
- Only `=` is accent-filled, one cell, bottom-right. Operators are accent text on
  white. Digits are primary text on white.
- Grid uses `1fr` columns and `dvh`-based row height so it fills without scrolling.
- Bottom row clears the home indicator via `env(safe-area-inset-bottom)`.
- `user-select: none`, `touch-action: manipulation`, no `300ms` tap delay.
- `-webkit-text-size-adjust: 100%` and `viewport-fit=cover`.
- No system keyboard ever appears: the expression is a `div`, not an `<input>`.
  Caret is drawn and managed by the app.

**Decimal separator** is always `.`. It was briefly switchable to `,` from the
overflow menu and persisted per device, but the setting was removed in favour of
one less thing to knock out of place — the owner uses `.` only. It still lives in
one config object in `format.js` rather than scattered through the renderer, so
reinstating a switch is a small change. Grouping uses a space, never a comma, so
it could not collide with a comma decimal in any case.

**Decimal places** are chosen from the overflow menu: `Auto` or 1–5, as a row of
six buttons rather than a control you cycle through — one tap to pick, and the
current choice is visible without opening anything else. The menu stays open on
a pick, because choosing places is something you compare rather than commit to.

Rounding is display-only. The stored result keeps full precision, so switching
from 2 places to 5 re-renders old history entries at 5 places without anything
having been lost. One deliberate exception: when a non-zero result is too small
for the chosen places, it is shown the `Auto` way instead of as a flat `0.00` —
a calculator claiming a non-zero answer is zero is worse than one that ignores
the setting for a moment.

**`00` key** inserts two zeros, subject to the same leading-zero guard as `0`.

**States the display must handle:** empty (show `0`), incomplete (`12+` → result
line shows the last valid partial, dimmed), divide-by-zero (`—`), overflow (`∞`),
too-long expression (wrap to 3 lines, then ellipsise the head and keep the tail).

---

## 5. Build stages

Each stage is independently shippable and independently useful. Stop after any
one of them and you still have a working calculator.

### Stage 1 — MVP: it computes and it is on the phone · done

The point of this stage is to prove the deployment path, not the maths.

- Static `index.html` + `app.css` + one `app.js`.
- Tokenizer + recursive-descent parser + evaluator for `+ − × ÷`, decimals,
  nested parens, unary minus.
- Display card with expression + dimmed live result, and the promote-on-`=` swap.
- Full keypad: digits, `00`, `.`, four operators, `C`, smart `( )`, `=`, `⌫`.
- Live evaluation on every keystroke with implicit-close preview.
- Digit grouping and accent-tinted operators in the expression renderer.
- Repo created, GitHub Pages enabled, URL opens in mobile Safari.

**Done when:** typing `12.5×(3+(4−1)×2)` on the actual iPhone shows `112.5`
before you press `=`.

### Stage 2 — Installable and offline · done

- `manifest.webmanifest`: `display: standalone`, `theme_color`, `background_color`,
  `orientation: portrait`.
- iOS-specific tags: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style=black-translucent`,
  `apple-touch-icon` at 180×180.
- `sw.js` precaching every asset, cache-first, versioned cache name.
- Safe-area padding so nothing sits under the notch or home indicator.

**Done when:** aeroplane mode, tap the home-screen icon, it launches full-screen
with no browser chrome and works.

### Stage 3 — Real input ergonomics · done

This is the stage that decides whether you actually use the thing.

- Tap-to-place caret in the expression window; insert and delete at the caret.
- Long-press `⌫` to clear the whole buffer; long-press `( )` to force the
  opposite paren.
- Operator replacement (`5+×` → `5×`), leading-zero and double-decimal guards,
  `00` guard.
- Depth count rendered on the `( )` key face.
- Haptics via a short `navigator.vibrate` where supported, silent fallback on iOS.
- App bar with the overflow menu (`⋯` → copy result).

**Done when:** you can fix a typo in the middle of a long expression without
retyping it.

### Stage 4 — Robustness and tests · done

- Test suite covering: precedence, deep nesting (20+ levels), unary minus chains,
  `÷0`, empty parens, malformed input, float-artifact cases, very large and very
  small magnitudes.
- Parser fuzz loop: random token strings must either parse or fail cleanly —
  never throw an unhandled exception, never hang.
- Explicit recursion depth cap with a friendly message.
- Error taxonomy rendered as quiet UI states, not alerts.

**Done when:** the fuzz loop runs 100k iterations with zero unhandled throws.

### Stage 5 — Fit and finish · done

- Dark mode via `prefers-color-scheme`, both palettes checked at AA contrast.
- Key press animation under 100 ms; result transition on `=`.
- Expression window auto-shrinks font from 39 → 24 px as the line grows.
- Landscape layout (wider keypad, same rows).
- VoiceOver labels and `aria-keyshortcuts` on every key.
- Hardware-keyboard support for when it is opened on a desktop.

Two deviations, both deliberate:

- **The keypad stays `role="group"`, not `role="grid"`.** A conforming grid needs
  `role="row"` / `role="gridcell"` wrappers, and putting `gridcell` on the buttons
  themselves strips their button semantics — VoiceOver would stop announcing them
  as buttons and stop offering the activate gesture. Labelled buttons in a labelled
  group is the better outcome for the only user this app has.
- **Landscape sizes the keypad by flex, not by `dvh`.** Any fixed row height that
  fits one phone overflows another; letting the display take its content height
  and the keypad absorb the remainder means five rows always fit.

### Stage 6 — Optional extras, only if wanted

Listed so they are decisions rather than scope creep. None are required for
"completed" as specified.

**Built:**

- **History tape** behind the `⟲` app-bar icon — the last 50 committed
  expressions, newest first, tap to recall into the buffer and keep editing.
  Consecutive repeats collapse. Persisted in `localStorage`, and *validated on
  read as well as on write*: anything that can run script on this origin can edit
  that store, so a recalled expression is treated as untrusted input and goes
  through the same character and length checks as a keystroke.
- **Copy result on long press** of the result line, alongside the menu item.
  The clipboard write fires on *release*, not when the 500 ms timer elapses:
  Safari only honours `navigator.clipboard` inside a user-gesture task, and a
  `setTimeout` callback is no longer one. The timer only arms the action, dims
  the result, and buzzes. Feedback is a caption on the hint line, not a toast.

**Not built:**

- `ANS` key referencing the previous result. Largely redundant now — an operator
  pressed straight after `=` already continues from the result, and the tape
  covers recall of anything older.
- A percent key, should it ever be wanted. The slot it was reserved in now holds
  `^` instead. Its semantics were always the blocker: `200+10%` meaning `220`
  (percent-of-preceding-term) and `200×10%` meaning `20` are two different rules,
  and picking one by accident is how percent keys become untrustworthy. Exponent
  had no such ambiguity, which is why it could ship immediately.
- Swap doubles for a decimal library if a real rounding case ever bites. The
  engine computes in IEEE 754 doubles and hides the artifacts by rounding the
  *display* to 12 significant digits, which is why `0.1+0.2` shows `0.3`. The
  error is still there underneath, so a case could exist where it survives the
  rounding and reaches the screen. If one ever does, the fix is to swap the
  arithmetic in `eval.js` for a decimal library (decimal.js, big.js) that stores
  numbers as digits and a scale instead of binary fractions. Deliberately
  deferred: it costs a dependency, a build step, and roughly an order of
  magnitude of speed, to fix a class of bug that has not appeared in 400k
  fuzzed expressions.

### Stage 7 — Hex mode · done

A `DEC`/`HEX` control in the app bar, hex arithmetic, and DEC↔HEX conversion.

**BigInt, not doubles.** Hex mode is integer-only, so `evaluateHex` in `eval.js`
is a sibling of `evaluate` working on `BigInt`. The reason is exactness: a
programmer calculator that cannot hold `FFFFFFFFFFFFFFFF` is not much use, and
doubles go inexact above 2^53 — only 14 hex digits. It also makes truncating
division fall out for free, since `BigInt` division already truncates toward
zero.

**The hazard BigInt adds.** Floats overflow to `Infinity` and stop. `BigInt` has
no ceiling, so `2^FFFFFFFF` would allocate until the tab dies rather than
returning a value — a hang, not an error. Every result is therefore size-checked
against a 1024-bit cap, and `^` is checked *before* it is computed:

```
a^b needs between (bits(a)-1)*b+1 and bits(a)*b bits.
```

The lower bound is what gets tested, so only what is *certainly* too large is
refused; anything that slips past is at most twice the cap and cheap to compute,
and the result check then rejects it on its real size. Testing the upper bound
instead was the first attempt and was wrong — for base 2 it overestimates by 2×
and refused values that fit comfortably.

**A negative exponent truncates to 0** rather than erroring, for the same reason
`1/2` is `0`: the mode holds integers, and `1/(a^n)` is not one.

**Switching converts the whole buffer**, not just the result — `255+16` becomes
`FF+10`. That keeps a half-typed calculation alive across the switch, and makes
the converter use case (type a number, flip the control) fall out of the same
code path. DEC→HEX truncates fractions, which is lossy, so the hint line says
"Fractions dropped" rather than letting `12.75` quietly become `C`. A conversion
that would outgrow `MAX_LENGTH` is refused outright instead of truncating the
expression — hex is denser than decimal, so a full buffer can fail to fit.

**Signed magnitude, not two's complement.** `5-A` is `-5`. Two's complement is
what a programmer calculator usually shows, but it forces a word-size setting
(8/16/32/64) and a second control to pick it; signed magnitude matches how the
expression buffer already handles a minus.

**The keypad is a nibble table.** Five columns, `0`–`F` in reading order, rather
than the phone digit order used in decimal:

```
0   1   2   3   /
4   5   6   7   ×
8   9   A   B   −
C   D   E   F   +
AC  ( ) ^   00  =
```

This was chosen over a 5×5 grid that kept phone order with the letters in a
column (`F` ended up stranded, and it read as arbitrary) and over a six-across
letter strip above an unchanged keypad. The strip is the smaller change and the
better answer if decimal is the common case; the nibble table wins when hex is.
The cost is that flipping the control relocates every digit.

Clear reads `AC` in hex. With a hex `C` two keys away, distinguishing them by
colour alone was a real misread risk on a phone.

**Storage.** A hex tape entry carries `radix: 16` and holds its value as a
decimal *string*. Both are load-bearing: without the radix, `FF+FF` is ambiguous
once the mode has switched back, and `JSON.stringify` throws outright on a
`BigInt` — a throw `saveHistory` already swallows, which would have silently
killed persistence for the entire tape rather than just the hex entries. Entries
written before hex existed have no `radix` and read as decimal.

**Not persisted.** The app always opens in decimal, so a keypad full of letters
is never the first thing you meet.

### Stage 8 — Unit conversion (CON) · done

A third option on the same control, converting the result between everyday
units. Ten categories: length, mass, temperature, volume, area, speed, data,
time, pressure, energy.

**No library.** There is no zero-dependency option — `Intl.NumberFormat` formats
a unit but does not convert it, and `convert-units`, `js-quantities` and `mathjs`
are all npm packages. Adding one means adding a bundler to a project whose
defining property is not having one, to import what is fundamentally a table of
factors. So `src/units.js` is that table, hand-written and dependency-free.

**CON is not a radix.** This is the load-bearing decision. `config.radix` looks
like a mode flag but is really a *table key*, used in `tokenizer.NUM_CHAR`,
`format.NUM_CHARS`/`GROUP_SIZE`, four regex maps in `model.js` and
`history.LEGAL_SRC` — and the `model.js` maps have no `?? DEC` fallback, so an
unrecognised value throws rather than degrading. A third radix value would mean
adding CON to every one of those tables, plus deciding what a "CON entry" means
in the history tape.

It does not need to mean anything. CON's arithmetic *is* decimal arithmetic; the
conversion is a post-step on the evaluated result. So `config.radix` stays `DEC`
throughout, the mode lives in `ui.js` alone, and `tokenizer.js`, `parser.js`,
`eval.js`, `model.js`, `format.js`, `radix.js` and `history.js` are untouched by
this stage. It also means `12*3` in CON converts 36, for free.

**One owner for the mode.** `applyRadix` used to write `radixSel.value` itself,
which was fine with two options and wrong with three: boot and history recall
both call it with `DEC`, so either would have silently knocked the control out of
CON. It now only does the radix work and returns whether it succeeded; a new
`applyMode` is the sole writer of the select. The return value is not cosmetic —
entering CON from HEX is a real base conversion that `convertBuffer` can refuse
when the decimal form exceeds `MAX_LENGTH`, and proceeding after a refusal would
leave CON holding a hex buffer and a `BigInt` result.

**Offsets, not just factors.** Every unit is `value * factor + offset` against
its category's base. The offset exists for temperature: °F is factor `5/9`,
offset `-160/9`, from `C = F·5/9 − 160/9`. Because the category is affine, there
is no `factor[from] / factor[to]` shortcut anywhere — a conversion always goes
through the base. `convert` does short-circuit `from === to`, since `x*f/f` is
not `x` for most `f` and shifting the last digit of a visibly unchanged number
reads as a bug.

**Both data scales.** `kB/MB/GB/TB` at 1000ⁿ and `KiB/MiB/GiB/TiB` at 1024ⁿ.
This app has a hex mode, so it gets used for "the disk says 500 GB" and "the
allocator says 4 MiB" alike; one scale is wrong half the time and the user cannot
tell which is in force. Labelling 1024² as "MB" was never an option.

**Where the controls went.** The converted value gets its own line rather than
borrowing `#hint`, which is the shared fault caption and is wiped 1.4 s after any
flash message. The from/to pickers go in the utility row, which already had a
button at each end and dead space between — so they cost the display card no
height, and the landscape breakpoints do not lose a keypad row. Category lives in
the `⋯` menu because it is picked once and the units are changed repeatedly.

**The tape stays arithmetic.** `=` in CON records the plain decimal calculation,
untagged; the converted value is never stored. `history.js` needed no changes.

**Not persisted**, matching the base.

---

## 6. Repo and deployment

```
calc/
  index.html
  app.css
  src/…
  sw.js
  manifest.webmanifest
  icons/
  test/index.html
  .github/workflows/pages.yml
  README.md
```

Pages workflow is the stock `actions/deploy-pages` static upload — no build, it
just publishes the repo root. Enable Pages once in repo settings
(Source: GitHub Actions).

**Cache-busting:** bump `CACHE_VERSION` in `sw.js` on every release, and have the
SW `skipWaiting()` + `clients.claim()`. Without this, iOS will happily serve you a
month-old calculator and you will lose an evening to it.

**Local development:** any static file server (`python -m http.server`) — service
workers need `http://localhost`, not `file://`.

---

## 6a. Security review

Reviewed 2026-08-08 against the deployed tree. No vulnerabilities were found. What
was checked, and why each holds:

| Area | Finding |
| --- | --- |
| Injection sinks | No `eval`, `Function`, `innerHTML`, `insertAdjacentHTML` or `document.write` anywhere. Every DOM write is `textContent` or `createElement`, which the browser never parses as markup. |
| Expression evaluation | User input is parsed, never executed. The hand-written tokenizer/parser/evaluator is the only path from string to number — that is the reason it exists. |
| Stored history | `localStorage` is editable by anything with script access to the origin, so tape entries are validated on read (`isValidEntry`) *and* again when recalled through the reducer (`load:`). A hand-edited entry can only ever produce a legal buffer. |
| Service worker | Fixed same-origin precache allowlist, cache-first, non-GET ignored, no `message` handler, no opaque responses cached. Nothing can poison the cache. |
| Permissions | Clipboard *write* inside a user gesture, and vibration. Nothing else is requested. |
| Deployment | Workflow token is `contents: read`. `.env`, `.wolf/` and `.claude/` are gitignored and return 404 on the live site. |

**CSP.** GitHub Pages cannot set response headers, so the policy ships as a
`<meta http-equiv>` tag in `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
connect-src 'self'; manifest-src 'self'; worker-src 'self';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

There is no third-party code and no injection sink, so this guards against a
future mistake rather than a present risk. `'unsafe-inline'` is deliberately
absent from both `script-src` and `style-src` — the app has no inline script and
no inline `style` attribute, and it must stay that way. Adding either will break
silently in the browser while the tests still pass, so re-check the console after
any change to markup or styling.

`frame-ancestors` is deliberately absent: it is ignored when a policy arrives by
`<meta>` rather than a header, and including it logs a console error on every
load. Clickjacking protection therefore has to come from a real
`X-Frame-Options`/`frame-ancestors` header, which GitHub Pages cannot set — an
accepted limitation for a calculator with no accounts and no state worth framing.

**Not adopted:** pinning `actions/*` to commit SHAs rather than major-version
tags. Standard practice for GitHub's own actions, and disproportionate for a
static deploy holding a read-only token.

---

## 7. Acceptance criteria for "completed"

1. Installed on the iOS home screen, launches standalone, works offline.
2. Evaluates any well-formed arithmetic expression with nested parentheses
   correctly, verified against the test suite.
3. Live result updates on every keystroke without perceptible lag.
4. Malformed input never crashes, never alerts, never leaves a stale result.
5. Every key is reachable one-handed and meets the 44 pt target.
6. Total transfer size under 50 KB uncompressed.
7. A push to `main` is a complete deploy.
