---
'@moderation-api/unicode-spoofing': patch
---

Keep the typographic apostrophe in `normalized` when a lookalike word is folded.

`Ivа’s` (with a Cyrillic `а`) normalized to `Iva's`: the fold ran every
character of the word through the confusables map, including U+2019, whose
prototype is the ASCII `'`. Only the letters are lookalikes, so the apostrophe
is now kept as typed and the word normalizes to `Iva’s`. Detection is
unchanged.
