# Calc

A personal arithmetic calculator PWA. Static files, no dependencies, no build step.

See [BUILD-SPEC.md](BUILD-SPEC.md) for the full spec and staging plan.
**Stages 1–5 are complete**, plus the history tape and long-press copy from
stage 6. Only the optional `ANS` key remains unbuilt.

Arithmetic is `+ − × ÷`, exponent `^`, unary minus, decimals and arbitrarily
nested parentheses, with live evaluation as you type.

## Run locally

Service workers and ES modules need a real origin, so `file://` will not work.

```bash
python -m http.server 8123
```

Then open `http://localhost:8123`.

## Test

```bash
node test/run.mjs
```

`test/engine.test.mjs` is the assertion suite; `test/fuzz.test.mjs` throws 100k
random expressions and 20k random keypad sequences at the engine and asserts that
nothing but a `CalcError` ever escapes. Both are dependency-free. The fuzzer is
seeded — reproduce a failure with `FUZZ_SEED=<seed> node test/fuzz.test.mjs`.

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
| `src/eval.js` | AST → number |
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

## Keyboard

Usable from a hardware keyboard when opened on a desktop.

| Key | Action |
| --- | --- |
| `0`–`9`, `.`, `,` | Digits and decimal point |
| `+` `-` `*` `x` `/` `^` | Operators |
| `(` `)` | Explicit brackets — unlike the `( )` key, these do not guess |
| `←` `→` `Home` `End` | Move the caret |
| `Enter` or `=` | Evaluate |
| `Backspace` | Delete before the caret |
| `Esc` | Clear |
