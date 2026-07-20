# @moderation-api/unicode-spoofing

## 0.4.0

### Minor Changes

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Separate decode damage from spoofing with a new `encoding_damage` signal.

  U+FFFD used to count as `illegal`, so a message whose name field had been
  mangled upstream — `Hi Jos�� Luis` — reported as a spoofing attack. Across a
  115-row sample of real SMS traffic that was 61% of all flags.

  U+FFFD is a decoder's output, never an author's input: whatever the original
  bytes were, they are gone by the time the character exists, so it can carry no
  payload. It now reports as `encoding_damage`, which is included in `signals`
  and `words` but deliberately does **not** set `spoofed`, and the normalizer
  leaves it in place rather than silently repairing a corrupted message.

  `SpoofSignal` gains a member and `signals` gains a key, so an exhaustive
  `switch` or a strict `toEqual` on the signals object will need updating.
  Genuinely illegal code points (NUL, C1 controls, non-characters) are unchanged.

  A `SPOOFING_SIGNALS` constant is exported alongside `SPOOF_SIGNALS` — the same
  list minus `encoding_damage` — so callers can partition the two the same way
  `spoofed` does.

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Judge Latin words on UTS [#39](https://github.com/moderation-api/unicode-spoofing/issues/39) Identifier_Status instead of skeleton luck.

  A word already written in Latin cannot be impersonating Latin, so the
  cross-script skeleton test measured only whether its fold happened to reach
  ASCII — which it does for ordinary European orthography, and arbitrarily.
  `æ` is a ligature that UTS [#39](https://github.com/moderation-api/unicode-spoofing/issues/39) dissolves to `ae`, while `ø` keeps its stroke as
  a combining mark and never reaches ASCII, so `Ægir` was reported as a disguised
  word and `Ålborg` was not. Same alphabet, opposite verdicts.

  A Latin word now needs at least one character Unicode marks **Restricted** in
  `IdentifierStatus.txt` before its skeleton counts. `Ægir`, `Þór`, `Straße`,
  `cœur`, `ısıtır` and `Hawaiʻi` are all Allowed and pass through; `pɑypal`
  (U+0251 IPA ALPHA) and `ﬁrst` (a compatibility ligature) are Restricted and are
  still caught — intra-Latin homoglyphs that no script comparison can see.

  The gate applies ONLY to Latin words. Cyrillic `а`/`о` are Allowed too, being
  ordinary Russian, so applying it everywhere would let `раураl` walk through.

  Adds `src/data/identifier-status.generated.ts` (~7 KB) and
  `scripts/generate-identifier-status.mjs`; `npm run generate:data` refreshes
  both tables.

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Stop reporting zero-width runs that are isolated in whitespace.

  A zero-width character evades a filter by splitting a word (`fr<ZWSP>ee`).
  A run with whitespace (or a string boundary) on BOTH sides splits nothing —
  the break it would create is already there — so it changes neither rendering
  nor tokenization. Rich-text editors leave these in templates constantly, and
  reporting them told senders their own newsletter was an attack.

  Requiring isolation on both sides is the safety of the rule. One-sided contact
  still does work: `admin<ZWSP>` renders as `admin` but compares unequal to it,
  and `<ZWSP>Valencia` glues to the front of a token the same way, so both are
  still reported. Runs longer than the new exported `ZERO_WIDTH_INERT_RUN` (4)
  are reported wherever they sit, because length alone makes a run a payload
  channel regardless of position.

  Scoped to genuinely zero-width, non-reordering characters (U+200B, U+200C,
  U+200D, U+2060, U+FEFF). Bidi controls, tag characters and blank glyphs are
  untouched — Trojan Source and ASCII smuggling detection are unaffected.

## 0.3.0

### Minor Changes

- [#14](https://github.com/moderation-api/unicode-spoofing/pull/14) [`86027a1`](https://github.com/moderation-api/unicode-spoofing/commit/86027a178a353937280240957d1cd1d662d64683) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Export the constants behind the analysis, so callers can enumerate values instead of hardcoding strings: `SCRIPT_NAMES` (every script `dominantScript` and `words[].scripts` can report), `SUPPORTED_SCRIPTS`, `PSEUDO_SCRIPTS`, `FORMAT_CHAR_SCRIPTS`, `LEGITIMATE_SCRIPT_COMBINATIONS`, `ZALGO_MARK_RUN`, and the `primaryScript(char)` classifier.

  Script-typed fields now use the new `ScriptName` union instead of `string`: `AnalysisResult.dominantScript`, `WordFinding.scripts` and `AnalyzeOptions.expectedScripts`. Runtime behavior is unchanged, but TypeScript callers passing a plain `string[]` to `expectedScripts` will need `ScriptName[]` — which is the point: `expectedScripts: ['Cyrilic']` no longer compiles.

## 0.2.0

### Minor Changes

- [#10](https://github.com/moderation-api/unicode-spoofing/pull/10) [`d8f002d`](https://github.com/moderation-api/unicode-spoofing/commit/d8f002d50bc2d66d2b830082587944e6ccbeee39) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Broaden the `invisible` signal to the full hidden-character corpus.

  `analyze()` now also reports and strips:

  - **Invisible characters that belong to no word** — a bidi control or
    zero-width character sitting between punctuation or spaces, rather than
    inside a token. This is what hid two of the four controls in a Trojan Source
    line (`if (level != "user<RLO> <LRI>// admin check<PDI> <LRI>") {`).
  - **Blank glyphs that are not whitespace** — Hangul fillers (U+115F, U+1160,
    U+3164, U+FFA0), BRAILLE PATTERN BLANK, MUSICAL SYMBOL NULL NOTEHEAD. The
    Hangul fillers previously misreported as `mixed_script`, since they are
    Hangul letters to the property tables.
  - **Invisible combining marks** — COMBINING GRAPHEME JOINER, the Khmer inherent
    vowels, KAITHI VOWEL SIGN I. Each stays legitimate inside its own script.
  - **Stray variation selectors** — a selector on a base with no registered
    sequence, the "ASCII smuggling" payload channel. Registered sequences (emoji
    presentation, keycaps, ideographic variants, Mongolian FVS) are untouched.

  Unicode whitespace (U+00A0, U+2000–U+200A, U+3000, …) is deliberately still not
  flagged: it is ordinary typography and every `\s` matcher already treats it as a
  space.

## 0.1.1

### Patch Changes

- [#8](https://github.com/moderation-api/unicode-spoofing/pull/8) [`183fae9`](https://github.com/moderation-api/unicode-spoofing/commit/183fae9a23010d3b5b93cc0be424b453b2316c7d) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Docs: document the `illegal` signal (control, non-character, and replacement
  code points) in the signals table, and note that declaring `expectedScripts`
  enables whole-script confusable detection (e.g. all-Cyrillic `аррӏе` → `apple`
  when Latin is expected). No runtime changes.
