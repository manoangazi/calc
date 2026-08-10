# ManoCalc

A personal arithmetic calculator PWA. Static files, no dependencies, no build step.

**Live: https://manoangazi.github.io/calc/**

On iPhone, open that in Safari and use Share → Add to Home Screen. It then runs
full-screen and works offline.

See [BUILD-SPEC.md](BUILD-SPEC.md) for the full spec and staging plan.
**Stages 1–5 are complete**, plus the history tape and long-press copy from
stage 6. Only the optional `ANS` key remains unbuilt.

Arithmetic is `+ − × /`, exponent `^`, unary minus, decimals and arbitrarily
nested parentheses, with live evaluation as you type.

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
- **Switching DEC → HEX drops any fraction.** `12.75` becomes `C`, and the hint
  line says so rather than letting it happen quietly.
- **Negatives are signed magnitude**, not two's complement: `5-A` is `-5`. There
  is no word size to choose, and no `FFFFFFFB`.
- **`^` is bounded.** Floats overflow to `∞` and stop; BigInt has no ceiling, so
  a large exponent is refused before it is computed rather than allocating until
  the tab dies.

The keypad becomes a nibble table in hex — `0`–`F` in reading order across five
columns. Clear reads `AC` there so it cannot be misread as the hex digit `C` two
keys away.

The base is deliberately not persisted; the app always opens in decimal.

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

`test/engine.test.mjs` and `test/hex.test.mjs` are the assertion suites.
`test/fuzz.test.mjs` throws 100k random expressions and 20k random keypad
sequences at each engine and asserts that nothing but a `CalcError` ever escapes;
its hex pass also asserts no iteration runs slow, which is how an unbounded
BigInt would show up. `test/assets.test.mjs` checks that every module in `src/`
is in the service worker's precache list — miss one and the app works perfectly
right up until the device goes offline.

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
