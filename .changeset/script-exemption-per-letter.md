---
'@moderation-api/unicode-spoofing': minor
---

Judge the `FORMAT_CHAR_SCRIPTS` exemption per letter instead of per word.

A single Hebrew, Arabic, Persian or Indic letter exempted its whole word from
`invisible` and `zalgo`, so a bidi override (`של<RLO>ום`), tag characters
(`مي<tags>خ`, `क<tag>ष`) or a run of zero-width spaces (`می<5×ZWSP>خواهم`)
inside such a word passed undetected and stayed in `normalized`.

Hidden characters and marks are now judged by the letters next to them. Still
exempt:

- a single ZWNJ, ZWJ or ZWSP in a word of these scripts with no letter of
  another script on either side (Persian ZWNJ, also next to numerals; Indic
  conjuncts; Malayalam chillu; Thai, Khmer and Myanmar word breaks), and the
  joiner sequences ZWJ ZWNJ (final form) and ZWJ ZWNJ ZWJ (ligature break);
- a single implicit bidi mark (LRM, RLM, ALM) or isolate next to a
  right-to-left letter, or next to a number in a right-to-left word;
- a combining grapheme joiner between the marks of such a letter;
- a format character of a neighbouring letter's script (Mongolian vowel
  separator, Syriac abbreviation mark, invisible Khmer vowels);
- mark stacks on these letters.

Script-neutral letters such as the Arabic tatweel are read as part of the
letters around them.

Everything else inside such a word is judged as in a Latin word, and only the
offending characters are removed. Newly reported there: bidi overrides and
embeddings (an `RLE…PDF` wrapper is reported where an `RLI…PDI` isolate is
not), runs of bidi marks or isolates, tag characters, runs of zero-width
characters, Hangul fillers, soft hyphens, word joiners, BOMs, a CGJ not
following a mark, variation selectors on letters with no registered sequence
(`שלום<VS16>`), and zalgo stacks on a non-letter base (`ש1` + 3 marks).

Myanmar joins the scripts whose letters take a variation selector, so its
standardized dotted forms (`က<VS1>`) stay unreported now that its words are no
longer exempt as a whole.
