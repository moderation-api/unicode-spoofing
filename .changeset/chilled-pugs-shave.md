---
'@moderation-api/unicode-spoofing': minor
---

Separate decode damage from spoofing with a new `encoding_damage` signal.

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
