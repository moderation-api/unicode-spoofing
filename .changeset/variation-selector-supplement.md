---
'@moderation-api/unicode-spoofing': minor
---

Recognise the variation selector supplement (VS17–VS256, U+E0100–U+E01EF).

Only VS1–VS16 and the Mongolian selectors were treated as variation
selectors, so a supplement selector after a Latin letter passed unreported —
one hidden byte per letter (`h\u{E0151}e\u{E0152}l\u{E0153}lo`). And because
these selectors are combining marks, a valid ideographic variation sequence
followed by more selectors (`辻\u{E0100}\u{E0101}\u{E0102}`) was reported as
`zalgo` and normalized with the valid selector stripped too.

A supplement selector is now legitimate only directly after a Han or kana
letter (an ideographic variation sequence) and is reported as `invisible`
anywhere else: after another letter, a combining mark, a digit, an apostrophe,
or at the start of a word. A base takes one selector, so further selectors on
it are reported and removed while the first one is kept. VS1–VS16 directly
after a combining mark are reported too; at the start of a word they are left
alone, since there they end the emoji or symbol before the word (`❤️you`). A valid
selector no longer counts toward a `zalgo` stack and is never stripped as a
zalgo mark; stray selectors still count.

This also removes a quadratic path: each selector used to walk back over the
whole run of selectors before it to find its base.
