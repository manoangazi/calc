# Developing ManoCalc

Everything a contributor needs. [README.md](README.md) is the user guide;
[BUILD-SPEC.md](BUILD-SPEC.md) is the full spec, the staged build history and the
reasoning behind each decision.

Static files, no dependencies, no build step. `package.json` exists only so Node
treats `src/*.js` as ES modules when running the tests.

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
HTTP cache will *also* serve stale modules, which looks identical to a failed
edit. `fetch(url, { cache: 'reload' })` on the **exact** URL forces the network
and rewrites that entry; a plain reload may not, and adding a `?v=` query does
not help — it writes a second cache entry and leaves the stale one in place.

## Test

```bash
node test/run.mjs
```

`engine`, `hex`, `units`, `currency` and `time` are the assertion suites, about
8 200 assertions in total. The units and currency suites matter more than their
size suggests: a wrong factor, or a reciprocal taken the wrong way round, is a
silently wrong answer rather than a crash, so every category is pinned to an
independently known value.

`test/currency.test.mjs` drives a stubbed `fetch` and a stubbed storage object —
nothing in the suite touches the network — and pins the one case a future
refactor is most likely to reintroduce: a Friday rate read on a Sunday must not
be flagged stale, because staleness tracks when *we* last fetched, not the feed's
own date.

`test/time.test.mjs` asserts the two duration spellings agree **row by row**,
which is what stops them drifting into two code paths, and pins `(1h / 7) * 7`
= `0:59:58` so that a change to the whole-second granularity has to come and edit
the assertion rather than silently alter every answer.

`test/fuzz.test.mjs` throws 100k random expressions and 20k random keypad
sequences at each engine and asserts that nothing but a `CalcError` ever escapes.
Its hex pass also asserts that no iteration runs slow, which is how an unbounded
BigInt shows up — a growth bound that is checked *after* the allocation is not a
bound, and both times this bit (`a ^ b`, then `a << b`) the fuzzer's timing
assertion is what caught it.

`test/assets.test.mjs` checks that every module in `src/` is in the service
worker's precache list — miss one and the app works perfectly right up until the
device goes offline. It also checks that every element `ui.js` looks up exists in
`index.html`, and that the markup carries no `style=` attribute and no inline
handler; all three are failures that appear only in a browser.

All are dependency-free. The fuzzer is seeded — reproduce a failure with
`FUZZ_SEED=<seed> node test/fuzz.test.mjs`.

## Deploy

Push to `main`. The Pages workflow publishes the repo root as-is. Enable Pages
once in repo settings with **Source: GitHub Actions**.

Every path in the app is relative, so it works unchanged from a project subpath
(`user.github.io/calc/`) or a domain root. **Never introduce an absolute path.**

### Releasing a change

Bump `CACHE_VERSION` in [sw.js](sw.js) whenever any cached file changes. Skip it
and iOS will keep serving the old app from its cache indefinitely. The worker
calls `skipWaiting()` and `clients.claim()`, so a bumped version takes effect on
the next launch.

**Every new `src/*.js` goes into `PRECACHE` in the same commit.**
`test/assets.test.mjs` enforces it, because the failure is invisible until the
device is offline.

### Icons

`icons/*.png` are generated, not hand-drawn. After changing the accent colour:

```bash
node tools/make-icons.mjs
```

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup: app bar, display card, utility row, three keypad grids |
| `app.css` | Layout, safe-area insets, tap targets, per-glyph key sizing |
| `src/tokenizer.js` | String → token stream, per radix |
| `src/parser.js` | Tokens → AST, recursive descent |
| `src/eval.js` | AST → double (decimal), → BigInt (hex), → duration (time) |
| `src/radix.js` | Rewriting the expression buffer between bases |
| `src/units.js` | The unit table and the conversion arithmetic |
| `src/currency.js` | The exchange-rate feed: fetch, validation, caching, staleness |
| `src/time.js` | Duration literals, `H:MM:SS` formatting, decimal hours |
| `src/format.js` | Number → display string; expression → tinted spans |
| `src/model.js` | Expression buffer and keypad command reducer |
| `src/ui.js` | DOM binding and event delegation — the only file that touches the DOM |
| `src/errors.js` | The single `CalcError` type and its display taxonomy |
| `src/history.js` | History tape: validation, capping, storage round-trip |
| `src/sw-register.js` | Service worker registration |
| `sw.js` | Precache + cache-first offline support |
| `manifest.webmanifest` | Install metadata |
| `tools/make-icons.mjs` | Dependency-free PNG icon generator |

## Invariants

These are the ones that will bite. The reasoning is in
[BUILD-SPEC.md](BUILD-SPEC.md).

- **`eval()` and `Function()` are never used.** The parser exists precisely so
  that no user-typed string is ever executed.
- **Mode is not radix.** There are four modes (`dec`/`hex`/`con`/`tim`) over
  three radices (`DEC` 10, `HEX` 16, `TIM` 60). `mode` is a `ui.js`-local
  variable owned solely by `applyMode`; `config.radix` is a *table key*, and it
  stays `DEC` while CON is selected — CON is the one mode that is not a radix.
  The test for which a new feature is: **do the literals change?**
- **`applyRadix` returns a boolean**, because a conversion can be refused; a
  refused HEX → CON switch must not strand a BigInt in CON.
- **Anything read back from `localStorage` is untrusted input** and is
  re-validated, on read and again when recalled through the reducer.
- **Errors are one `CalcError` type** with a code taxonomy, surfaced as a quiet
  caption — never an alert, never a silently plausible number.
- **Display rounding is display-only.** Full precision is retained, which is why
  changing the decimal-places setting re-renders past tape entries correctly.
- **Equal ink is for standalone symbols, not letters.** Sizing `√` or `⊻` by
  measured ink is right; doing it to `h`/`m`/`s` made `m` run at 39px against
  `h`'s 27px and read visibly heavier. Letters share a baseline and must share a
  font-size.

## Security

Reviewed 2026-08-08; no vulnerabilities found. Full findings in
[BUILD-SPEC.md §6a](BUILD-SPEC.md#6a-security-review). In short: there are no
injection sinks (every DOM write is `textContent` or `createElement`), user
expressions are parsed rather than executed, stored history is treated as
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
