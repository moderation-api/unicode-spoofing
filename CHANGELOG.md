# @moderation-api/unicode-spoofing

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
