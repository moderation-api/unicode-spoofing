---
'@moderation-api/unicode-spoofing': minor
---

Add keyword-evasion detection and a prefilter gate.

`analyze(text, { keywords: [...] })` finds caller-supplied words written in
disguise — leetspeak (`fr33`, `a$$`), ASCII art (`|-|ot`), separator splitting
(`f-r-e-e`, zero-width splits), stretched letters, Unicode lookalikes, and
combinations — as a new `keyword_evasion` signal, with the plain keyword in
the finding and in `normalized`. Matching is scored so everyday writing
(`e-mail`, `iphone15`, `b4`, `room 505`) never fires. Also exported:
`findKeywordEvasions` (the matcher standalone), `prefilter` (a table-free
linear gate that lets clean ASCII traffic skip analysis entirely),
`confusableLookalikes` (the UTS #39 table inverted, for red-team tooling and
training-data generation), and the `LEET_ALTERNATIVES`/`LEET_SEQUENCES`
tables.
