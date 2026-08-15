# ManoCalc — user guide

A calculator that does four jobs: ordinary arithmetic, hexadecimal, unit and
currency conversion, and time durations.

**Live: https://manoangazi.github.io/calc/**

On iPhone, open that in Safari and use **Share → Add to Home Screen**. It then
runs full-screen, launches like an app, and works with no signal — including the
last exchange rates it fetched.

Building it or changing it? See [DEVELOPING.md](DEVELOPING.md) and
[BUILD-SPEC.md](BUILD-SPEC.md).

---

## The screen

| | |
| --- | --- |
| **App bar** | The mode picker (`DEC` / `HEX` / `TIM` / `CON`) and `↻` for history |
| **Display card** | Your expression, and the result live beneath it as you type |
| **Utility row** | `⋯` menu · the conversion pickers, in `CON` only · `⌫ AC` |
| **Keypad** | Changes with the mode |

The result updates on **every keystroke** — there is no need to press `=` to see
where you are. `=` is for committing a line to the history tape and starting the
next one.

When something is wrong the result line shows a dash and a quiet hint underneath
("Divide by zero", "Not a time operation"). Nothing pops up, and nothing is
thrown away — fix the expression and the answer comes back.

---

## Buttons that do two jobs

This is the short list worth knowing. **Hold** means press and keep holding for
about half a second; you get a small buzz when the second action arms, and it
fires when you lift your finger.

| Button | Tap | Hold |
| --- | --- | --- |
| `⌫ AC` | Delete the character before the caret | **Clear everything** |
| `( )` | Insert whichever bracket fits here | Insert **the other one** |
| `&` *(hex)* | Bitwise AND | `≪` shift left |
| `⊻` *(hex)* | Bitwise XOR | `≫` shift right |
| `\|` *(hex)* | Bitwise OR | `%` remainder |
| The **result** | — | **Copy it** to the clipboard |
| A **history entry** | Load it back into the calculator | **Copy it** |

Where a key has a second job, the second label is printed small on the key face —
that is what the little `AC` on the backspace key and the `≪ ≫ %` on the hex
operators are.

**There is no separate `AC` key.** Backspace does both jobs, which is why it is
in the danger colour and labelled `⌫ AC`.

**The `( )` key guesses**, and is right nearly always: it opens a bracket where
an open bracket makes sense and closes one where a close does. Holding it
overrides the guess. The small number on its corner is how many brackets are
still open.

Two more gestures, on the display rather than the keypad:

- **Tap anywhere in the expression** to put the caret there — you can edit the
  middle of a line, not just the end.
- **`⋯` → Copy result** does the same as holding the result, if a hold is awkward.

---

## DEC — ordinary arithmetic

`+ − × ÷`, exponent `^`, square root `√`, unary minus, decimals, and brackets
nested as deep as you like.

`√` takes the **next value only**, not the rest of the line: `√9+7` is 10, and
`√(9+7)` is 4. It stacks, so `√√16` is 2. Put a number in front of it and it
means multiply — `2√9` is 6 — the same way `(2+3)4` does. A negative under the
root is refused rather than answered with nonsense.

`00` types two zeros, for round numbers.

### Decimal places

`⋯` → **Decimal places** — `Auto`, or a fixed 1 to 5.

This is a display setting, not a rounding of your data. The full value is kept,
so switching from 2 places to 4 shows you the digits that were always there, and
it re-renders past history entries at the new setting too.

### Long numbers

A number is never split across two lines. If the expression wraps, it breaks at
an operator, so `10000000000+5000000` never shows as `10000000000+50` with the
rest orphaned below. The text shrinks a step or two first. None of this touches
the arithmetic.

---

## HEX — hexadecimal

Pick `HEX` and the keypad becomes a nibble table: `0`–`F` in reading order across
five columns.

**Switching rewrites the whole expression, not just the result** — so a
half-typed calculation survives the switch, and typing `255` then switching is
all a base conversion takes. Switching `DEC → HEX` drops any fraction (`12.75`
becomes `C`) and tells you it did.

Hex is **whole numbers only**, and exact — `FFFFFFFFFFFFFFFF` comes back to the
last digit rather than approximately, which is the point of the mode. So:

- **Division truncates.** `10/3` is `5`. There is no decimal point key.
- **`√` truncates too.** `√FF` is `F`, because 15² is 225 and 16² is 256.
- **Negatives are plain negatives.** `5-A` is `-5`, not `FFFFFFFB`. There is no
  register width to choose, and no wrap-around.

### The bitwise row

The bottom row is `& ⊻ |`, each holding a second operator (`≪ ≫ %`). Grouping
follows C, so `FF&0F+1` means `FF&(0F+1)`, and `1≪2+1` is `1≪3` = 8.

Shifts are exact arithmetic — `1≪40` is 2⁶⁴ exactly rather than wrapping to
zero. That is deliberate: this mode has no register width, so nothing can
overflow, but for the same reason **`NOT` and rotate are not offered** — neither
means anything until you say how wide the register is.

**Bitwise refuses a negative operand** rather than inventing an answer for it,
for the same reason.

`%` is not hex-only — a remainder is meaningful on a decimal too, so it works in
`DEC` from a hardware keyboard.

`^` and `√` are still available from a hardware keyboard in hex; the keys gave up
their slots to the bitwise row. `^` was worth losing anyway — it means XOR in
every language a hex user knows, so leaving it as exponentiation was a trap.

The app always opens in decimal; the base is not remembered.

---

## CON — units and currency

`CON` is ordinary decimal arithmetic **with a conversion applied to the answer**.
So you can type `12*3` and it converts 36 — you are not limited to typing a bare
number.

- The **from** and **to** pickers sit in the utility row.
- **`⇄` swaps them.** Your expression is left alone; only the units flip.
- The **category** (length, mass, temperature, …) is in the `⋯` menu, because you
  pick it once and then change units repeatedly.
- The converted value gets **its own line** under the result. Hold that line to
  copy it — in `CON`, the line you press is the line you get.
- Pressing `=` tapes the plain calculation. The converted value is not stored.

Eleven categories: length, mass, temperature, volume, area, speed, data, time,
pressure, energy, and currency.

Worth knowing:

- **Data carries both scales, correctly named.** `kB/MB/GB/TB` are 1000ⁿ and
  `KiB/MiB/GiB/TiB` are 1024ⁿ. One scale would be wrong half the time with no way
  to tell which was in force.
- **Volume is labelled `gal US` / `gal UK`**, and the same for teaspoons, cups,
  pints and quarts — they differ by about 20%, so the label always says which.
- **Time conversion stops at weeks.** A month is 28–31 days; converting to one
  would be quietly making something up.

### Currency

Currency is a category inside `CON`, not a separate mode — same pickers, same
converted line, same arithmetic. 18 currencies: the majors plus the SA trade
partners and the CMA pegs (`BWP`, `NAD`).

Rates are the **European Central Bank's daily reference rates**, via
[Frankfurter](https://api.frankfurter.dev).

- **Fetched once a day, on the first open of that day.** An app on a phone cannot
  wake itself at a set hour, so that is the honest version of "daily".
- **They work offline**, from whatever was last fetched. A note under the
  converted line shows the feed's own date.
- **The note turns red and says `Stale`** when the app has not reached the feed
  in 24 hours. A Friday rate read on a Sunday is *not* stale — the ECB does not
  publish at weekends, and that is the rate.
- `⋯` → **Refresh rates** forces a fetch, for when you have just reconnected.

These are daily reference rates. They are not a dealing rate, and there is no
forward cover — no free feed publishes one, and a number computed from hand-typed
rates would look like a quote without being one.

---

## TIM — time durations

For adding up hours worked, timings and stopwatch splits.

Type a duration with the `h`, `m` and `s` keys: `1h20m45s`. Results always read
back as `H:MM:SS`.

You can leave the last unit off, and the calculator takes the next one down —
which is how people actually write it:

| You type | Means |
| --- | --- |
| `1h20m45s` | 1 h 20 m 45 s |
| `1h20` | 1 h 20 **m** |
| `20m45` | 20 m 45 **s** |
| `90m` | 90 minutes — overflowing a field is fine, it normalises to `1:30:00` |
| `2` | the plain **number** two, because it carries no unit at all |

On a hardware keyboard `:` and `.` do the same job: `:` separates hours from
minutes and `.` separates minutes from seconds, always. So `1:20.45` is the same
as `1h20m45s`, `1:20` is 1 h 20 m, and **`.1` is one second** — a field, not a
fraction. Because the meaning comes from the markers and never from counting
digits, there is no `H:MM`-versus-`MM:SS` ambiguity to get caught by. Don't mix
the two spellings inside one duration (`1h20.45`) — that is rejected rather than
guessed at.

Hours accumulate past 24: a long total reads `27:30:00`, not "1 day 3 hours".

### What you can and cannot do with a duration

- **Add and subtract durations** — `1h20m45s + 1h5m1s` = `2:25:46`. Negative
  results are fine: `2h - 3h` is `-1:00:00`.
- **Multiply or divide by a plain number** — `1h / 2` = `0:30:00`.
- **Divide a duration by a duration and you get a count**: `3h / 20m` is `9`,
  nine twenty-minute slots, and it shows as `9` — not `0:00:09`.
- **`2h * 3h`, `1h + 2`, `1h ^ 2` and `√2h` are refused** with "Not a time
  operation". A duration squared is not a thing, and `1h + 2` does not say plus
  what. A plausible wrong answer would be worse than none.

The calculator works in **whole seconds**, so `×` and `÷` round as they go: `1h/7`
is `0:08:34`, and multiplying that back by 7 gives `0:59:58`. That is the honest
answer at one-second granularity.

The line under the result is **decimal hours** — the number a timesheet or an
invoice wants, and the one thing `H:MM:SS` is bad at. The decimal-places setting
governs that line.

There is **no `AC`** on the time keypad — hold `⌫`.

### Switching in and out of TIM

Only plain whole-number arithmetic survives the switch, because it means the same
thing everywhere. Anything carrying a unit marker or a decimal point is cleared,
with a note saying so: `20.45` is twenty-point-four-five in `DEC` and 20 m 45 s
here, and silently changing what you typed would be worse than clearing it.

---

## History

`↻` in the app bar opens the tape. It holds your recent committed lines — the
ones you pressed `=` on.

- **Tap an entry** to load it back and carry on from it.
- **Hold an entry** to copy it.
- **Clear** empties the tape.

Entries are stored on the device, and each is rendered in the mode it was
calculated in — a duration still reads `2:25:46` while you are sitting in `DEC`.

---

## Hardware keyboard

Everything works from a keyboard when the app is open on a desktop.

| Key | Action |
| --- | --- |
| `0`–`9`, `.`, `,` | Digits and decimal point (`,` also types `.`, for numeric keypads) |
| `a`–`f` | Hex digits, in hex mode only — in decimal `x` still means multiply |
| `+` `-` `*` `x` `/` `^` | Operators |
| `%` | Remainder |
| `:` `.` | Duration separators, in time mode |
| `(` `)` | Explicit brackets — unlike the `( )` key, these do not guess |
| `←` `→` `Home` `End` | Move the caret |
| `Enter` or `=` | Evaluate and commit to history |
| `Backspace` | Delete before the caret |
| `Esc` | Clear |

---

## Privacy

There are no accounts, no analytics and no tracking. Your history and settings
are stored on your own device and never leave it. The app makes exactly one
network request of its own — the daily exchange-rate feed — and nothing about
your calculations is sent with it.
