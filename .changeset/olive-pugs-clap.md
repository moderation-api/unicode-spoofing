---
'@moderation-api/unicode-spoofing': minor
---

Stop reporting zero-width runs that are isolated in whitespace.

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
