---
'@moderation-api/unicode-spoofing': minor
---

Judge Latin words on UTS #39 Identifier_Status instead of skeleton luck.

A word already written in Latin cannot be impersonating Latin, so the
cross-script skeleton test measured only whether its fold happened to reach
ASCII — which it does for ordinary European orthography, and arbitrarily.
`æ` is a ligature that UTS #39 dissolves to `ae`, while `ø` keeps its stroke as
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
