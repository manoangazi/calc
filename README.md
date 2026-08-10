# ManoCalc

A personal arithmetic calculator PWA. Static files, no dependencies, no build step.

**Live: https://manoangazi.github.io/calc/**

On iPhone, open that in Safari and use Share → Add to Home Screen. It then runs
full-screen and works offline.

See [BUILD-SPEC.md](BUILD-SPEC.md) for the full spec and staging plan.
**Stages 1–5 are complete**, plus the history tape and long-press copy from
stage 6. Only the optional `ANS` key remains unbuilt.

Arithmetic is `+ − × /`, exponent `^`, square root `√`, unary minus, decimals and
arbitrarily nested parentheses, with live evaluation as you type.

`√` is a prefix operator with the same precedence as unary minus, so it takes the
next factor rather than the rest of the line: `√9+7` is 10, and `√(9+7)` is 4.
It stacks (`√√16` is 2), and after a value it means multiplication, so `2√9` is 6
— the same implicit `×` that `(2+3)4` gets. A negative under the root is refused
rather than returned as `NaN`; this calculator is real-valued.

There is no `AC` key on the keypad. Backspace does both jobs — tap to delete, hold
to clear — and is labelled `⌫ AC` accordingly.

Results show as many decimal places as they need, or a fixed 1–5 — pick from the
`⋯` menu. Rounding is display-only, so changing it re-renders past history
entries at the new setting rather than having thrown precision away.

## Hex

The `DEC`/`HEX` control in the app bar switches base. Switching rewrites every
number literal in the expression, not just the result, so a half-typed
calculation survives it — and so typing `255` and switching is all a base
conversion takes.

Hex is **integer-only**, and runs on `BigInt` rather than doubles. That is what
makes `FFFFFFFFFFFFFFFF` come back exactly instead of approximately: doubles go
inexact above 2^53, which is only 14 hex digits. Consequences worth knowing:

- **Division truncates toward zero.** `10/3` is `5`, not `5.55…`. There is no
  point key in hex.
- **`√` truncates too**, for the same reason: `√FF` is `F`, since 15² is 225 and
  16² is 256. It is computed by Newton's method on `BigInt`, never via
  `Math.sqrt` — a double would lose the exactness above 2^53 that the hex
  evaluator exists to preserve, so `√(FFFFFFFFFFFFFFFF²)` comes back exact.
- **Switching DEC → HEX drops any fraction.** `12.75` becomes `C`, and the hint
  line says so rather than letting it happen quietly.
- **Negatives are signed magnitude**, not two's complement: `5-A` is `-5`. There
  is no word size to choose, and no `FFFFFFFB`.
- **`^` is bounded.** Floats overflow to `∞` and stop; BigInt has no ceiling, so
  a large exponent is refused before it is computed rather than allocating until
  the tab dies.

The keypad becomes a nibble table in hex — `0`–`F` in reading order across five
columns.

The base is deliberately not persisted; the app always opens in decimal.

## Unit conversion

`CON` is the third option on the same control. It is **decimal arithmetic with a
conversion applied to the result** — not a base — so the whole expression engine
is unchanged and `12*3` converts 36. The converted value gets its own line under
the result; the from/to pickers sit in the utility row, and the category is in
the `⋯` menu, because you pick it once and then change units repeatedly.

The `⇄` between the two pickers swaps them. Reversing a conversion by hand
otherwise means two trips through the native picker to set each side to what the
other already had. The units swap; the typed expression does not, since the
buffer is the input and rewriting it would answer a question nobody asked.

Ten categories: length, mass, temperature, volume, area, speed, data, time,
pressure, energy. Worth knowing:

- **Temperature is affine, not proportional.** °F and K carry an `offset` as well
  as a factor, which is why [src/units.js](src/units.js) never divides one
  factor by another and always routes through the category's base unit.
- **Data carries both scales**, correctly named: `kB/MB/GB/TB` are 1000ⁿ and
  `KiB/MiB/GiB/TiB` are 1024ⁿ. This app has a hex mode, so it gets used for disk
  capacities and allocator sizes alike; one scale would be wrong half the time
  with no way to tell which was in force.
- **`=` in CON tapes the plain decimal calculation**, untagged. The converted
  value is never stored.
- **Time stops at weeks.** A month is 28–31 days, so converting to one would be
  quietly making something up.

Conversions run on doubles, so `37 °C` is `98.60000000000001` before the
display's 12-significant-digit rounding turns it back into `98.6`.

## Currency

An eleventh category inside CON, not a fourth mode — same pickers, same
converted line, same `value * factor` arithmetic; only the factor comes from a
feed instead of a table. Rates are ECB daily reference rates from
[Frankfurter](https://api.frankfurter.dev), fetched with no API key: this repo
is public with no server, and a committed key is world-readable on sight, so
every near-realtime provider was ruled out on that basis alone.

- **Refreshed once a day, on open, not on a schedule.** A PWA cannot wake itself
  at a fixed hour, so "first open of the day" is the honest version of that. The
  request is 237 bytes gzipped — daily refresh costs about 7 KB a month.
- **Cached, so it still works offline** — from whatever was last fetched. The
  rate note under the converted line shows the feed's own date, and turns red
  with the word `Stale` when the app has not reached the feed in 24 hours.
  Staleness is keyed off *when we last fetched*, never off the feed's date
  itself: the ECB does not publish at weekends, so Friday's rate read on a
  Sunday is correct, not stale.
- **No forward cover.** ZAR forward points are an OTC bank quote with no free
  feed; South Africa's Reserve Bank publishes bond yields, not FX forwards. A
  covered-interest-parity number computed from hand-typed rates would look like
  a quote without being one, so it was left out rather than faked.
- 18 currencies: the majors plus the SA trade partners and the CMA pegs
  (`BWP`, `NAD`).

## Time

`TIM` is the fourth option on the same control, and unlike `CON` it *is* a base:
`1h20m45s` is a literal in a different number system the way `FF` is, with its
own tokenizer charset, evaluator, keypad and result format. Internally the radix
is 60.

Two spellings are accepted and mean the same thing. The keypad emits the first;
the second is there for a hardware keyboard.

| typed | also | means |
|---|---|---|
| `1h20m45s` | `1:20.45` | 1 h 20 m 45 s |
| `1h20` | `1:20` | 1 h 20 m — a trailing bare group takes the next unit down |
| `90m` | `:90` | 90 min — fields may overflow on input |
| `45s` | `.45` | 45 s |
| `2` | — | the **scalar** two, because it carries no marker at all |

Both are positional: what a field means comes from the *markers present*, never
from counting digits. That is what removes the `H:MM`-versus-`MM:SS` ambiguity —
`1:20` can only be 1 h 20 m, and `20.45` can only be 20 m 45 s. Results are
always canonical `H:MM:SS`, and hours accumulate past 24 (`27:30:00`) rather than
rolling into days.

Durations carry a **type**, and that is what makes the mode trustworthy:

- `dur ± dur` → duration; `dur × scalar` and `dur ÷ scalar` → duration.
- **`dur ÷ dur` → a plain number.** `3h / 20m` is `9` — how many 20-minute slots
  fit in three hours — and it renders as `9`, not `0:00:09`.
- `dur × dur`, `dur ± scalar`, `dur ^ anything` and `√dur` are **refused** with
  "Not a time operation" — √(4 hours) has no unit anyone can name. A duration squared is not a quantity that exists, and
  `1h + 2` does not say plus what; a plausible wrong answer would be worse than
  none.

Whole seconds is the model, not a display rounding, so `×` and `÷` round at the
operation: `1h / 7` is `0:08:34` and multiplying that back by 7 gives `0:59:58`.

The converted line under the result carries **decimal hours** — the number a
timesheet or an invoice wants, and the one thing `H:MM:SS` is bad at. The
decimal-places setting governs that line.

The keypad is its own layout rather than the decimal one with substitutions:
`h m s` share the top row with `/`, the operators run down the fourth column, and
the bottom row is `0 00 ( ) =`. **There is no `AC` key in `TIM`** — clear by
long-pressing `⌫`, which is labelled `AC` for exactly that reason, or `Esc` on a
hardware keyboard. Dropping it is what makes the grid come out at exactly twenty
keys with nothing double-width and no gap.

Only pure integer arithmetic survives a switch into or out of `TIM`, since it
means the same thing in every mode. Anything with a marker or a decimal point
would change meaning — `20.45` is twenty-point-four-five in `DEC` and 20 m 45 s
here — so it is cleared and the hint line says so.

## Run locally

Service workers and ES modules need a real origin, so `file://` will not work.

```bash
python -m http.server 8123
```

Then open `http://localhost:8123`.

**The service worker does not register on localhost.** A cache-first worker serves
the copy of a file it captured on an earlier load, so an edit becomes invisible in
the browser while looking like it silently failed — and clearing the cache by hand
does not stick, because the next reload re-registers and re-caches. Skipping
registration in dev is the only version that stays fixed. To exercise the worker
deliberately, load `http://localhost:8123/?sw=1`.

Note that `python -m http.server` sends no `Cache-Control`, so the browser's own
HTTP cache will also serve stale modules. `fetch(url, { cache: 'reload' })` forces
the network and rewrites that entry; a plain reload may not.

## Test

```bash
node test/run.mjs
```

`test/engine.test.mjs`, `test/hex.test.mjs`, `test/units.test.mjs` and
`test/currency.test.mjs` are the assertion suites. The units and currency suites
matter more than their size suggests: a wrong factor, or a reciprocal taken the
wrong way round, is a silently wrong answer rather than a crash, so every
category is pinned to an independently known value.
`test/currency.test.mjs` drives a stubbed `fetch` and a stubbed storage object —
nothing in the suite touches the network — and pins the one case a future
refactor is most likely to reintroduce: a Friday rate read on a Sunday must not
be flagged stale, because staleness tracks when *we* last fetched, not the
feed's own date.
`test/fuzz.test.mjs` throws 100k random expressions and 20k random keypad
sequences at each engine and asserts that nothing but a `CalcError` ever escapes;
its hex pass also asserts no iteration runs slow, which is how an unbounded
BigInt would show up. `test/assets.test.mjs` checks that every module in `src/`
is in the service worker's precache list — miss one and the app works perfectly
right up until the device goes offline. It also checks that every element
`ui.js` looks up exists in `index.html`, and that the markup has no `style=` or
inline handler; all three are failures that only appear in a browser.

All are dependency-free. The fuzzer is seeded — reproduce a failure with
`FUZZ_SEED=<seed> node test/fuzz.test.mjs`.

## Deploy

Push to `main`. The Pages workflow publishes the repo root as-is. Enable Pages once
in repo settings with **Source: GitHub Actions**, then add the resulting URL to the
iOS home screen via Share → Add to Home Screen.

Every path in the app is relative, so it works unchanged from a project subpath
(`user.github.io/calc/`) or a domain root.

### Releasing a change

Bump `CACHE_VERSION` in [sw.js](sw.js) whenever any cached file changes. Skip it and
iOS will keep serving the old app from its cache indefinitely. The worker calls
`skipWaiting()` and `clients.claim()`, so a bumped version takes effect on the next
launch.

### Icons

`icons/*.png` are generated, not hand-drawn. After changing the accent colour:

```bash
node tools/make-icons.mjs
```

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup: app bar, display card, keypad grid |
| `app.css` | Layout, safe-area insets, tap targets |
| `src/tokenizer.js` | String → token stream |
| `src/parser.js` | Tokens → AST, recursive descent |
| `src/eval.js` | AST → number (doubles), and AST → BigInt for hex |
| `src/radix.js` | Rewriting the expression buffer between bases |
| `src/units.js` | The unit table and the conversion arithmetic |
| `src/currency.js` | The exchange-rate feed: fetch, validation, caching, staleness |
| `src/format.js` | Number → display string; expression → tinted spans |
| `src/model.js` | Expression buffer and keypad command reducer |
| `src/ui.js` | DOM binding and event delegation |
| `src/errors.js` | The single `CalcError` type and its display taxonomy |
| `src/history.js` | History tape: validation, capping, storage round-trip |
| `src/sw-register.js` | Service worker registration |
| `sw.js` | Precache + cache-first offline support |
| `manifest.webmanifest` | Install metadata |
| `tools/make-icons.mjs` | Dependency-free PNG icon generator |

`eval()` and `Function()` are never used — the parser exists so that no user-typed
string is ever executed.

## Security

Reviewed 2026-08-08; no vulnerabilities found. See
[BUILD-SPEC.md](BUILD-SPEC.md#6a-security-review) for the full findings. In short:
there are no injection sinks (every DOM write is `textContent` or `createElement`),
user expressions are parsed rather than executed, stored history is treated as
untrusted on read as well as on write, and the deploy workflow holds a read-only
token.

A Content-Security-Policy ships as a `<meta>` tag in `index.html`, since GitHub
Pages cannot set response headers. It allows `'self'` only, with no
`'unsafe-inline'` — **so do not add an inline `<script>` or a `style="…"`
attribute.** Either will be blocked in the browser while the test suite still
passes, so check the browser console after changing markup or styling.

`connect-src` carries one exception, `https://api.frankfurter.dev`, for the
currency feed — the only host this app is allowed to reach off-origin. Widen it
by naming a host, never by relaxing it to a scheme.

## Keyboard

Usable from a hardware keyboard when opened on a desktop.

| Key | Action |
| --- | --- |
| `0`–`9`, `.`, `,` | Digits and decimal point (`,` also types a `.`, for numeric keypads) |
| `a`–`f` | Hex digits, in hex mode only — in decimal `x` still means multiply |
| `+` `-` `*` `x` `/` `^` | Operators |
| `(` `)` | Explicit brackets — unlike the `( )` key, these do not guess |
| `←` `→` `Home` `End` | Move the caret |
| `Enter` or `=` | Evaluate |
| `Backspace` | Delete before the caret |
| `Esc` | Clear |
