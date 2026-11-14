---
'@moderation-api/unicode-spoofing': minor
---

Flag invisible payloads placed right after an emoji.

An invisible run that belongs to no word was exempt whenever an emoji,
enclosing mark or regional indicator sat on either side of it, so the README's
ASCII-smuggling example passed undetected once an emoji was put in front of the
payload (`Looks helpful! 🎉` + tag characters). The same held for variation
selectors stacked after an emoji and for zero-width binary after one.

The exemption now covers only the invisible characters that are part of an
emoji sequence (UTS #51): ZWJ between emoji, one presentation selector (VS15 or
VS16) on an emoji, keycaps, and RGI subdivision-flag tag sequences. A single
ZWJ left dangling at either end of a sequence (as truncation leaves it) is
still tolerated. Everything else next to an emoji is reported as `invisible`
and stripped from `normalized`.

Newly reported, which earlier versions let through:

- bidi marks (LRM, RLM), soft hyphens, word joiners and BOMs next to an emoji —
  the same verdict they already got next to punctuation;
- subdivision flags that are well-formed but not RGI (e.g. a Texas flag tag
  sequence): the tags are reported and removed, leaving 🏴.
