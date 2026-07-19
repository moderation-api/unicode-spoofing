---
'@moderation-api/unicode-spoofing': patch
---

Docs: document the `illegal` signal (control, non-character, and replacement
code points) in the signals table, and note that declaring `expectedScripts`
enables whole-script confusable detection (e.g. all-Cyrillic `аррӏе` → `apple`
when Latin is expected). No runtime changes.
