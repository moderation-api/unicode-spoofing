---
'@moderation-api/unicode-spoofing': patch
---

Strip whole ANSI control sequences (CSI) from `normalized`, not just the ESC.

`ok \x1b[31mred\x1b[0m done` normalized to `ok [31mred[0m done`: only ESC is an
illegal code point, so the rest of each colour code was left in the text. A
well-formed ECMA-48 control sequence (ESC `[`, parameter bytes, intermediate
bytes, final byte) is now one `illegal` finding, whose `word` is the whole
sequence, and is removed whole, giving `ok red done`; its bytes no longer
tokenize as part of the neighbouring word. An ESC not followed by a complete
control sequence — including other escape types such as OSC strings — is still
removed on its own, as before.
