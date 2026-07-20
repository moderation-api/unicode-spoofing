/**
 * ============================================================================
 *  INVISIBLE-CHARACTER CORPUS
 * ============================================================================
 *
 *  Ported from spencermountain/out-of-character (MIT), whose test suite is the
 *  most complete public inventory of characters that render as nothing. Its API
 *  is per-character (detect/replace); ours is per-word (analyze), so each case
 *  is restated in terms of the `invisible` signal and `normalized` output.
 *
 *  Code points are spelled out numerically wherever the character is invisible,
 *  so the cases stay reviewable in a diff. Cases that corpus covers but we do
 *  NOT yet handle live in `known-gaps.test.ts`.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { analyze, ZERO_WIDTH_INERT_RUN } from '../src';

/** No unpaired surrogate survived the rewrite (String#isWellFormed needs ES2024). */
const wellFormed = (s: string) =>
  [...s].every((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp < 0xd800 || cp > 0xdfff;
  });

/** `before<char>after` — the corpus' standard probe shape. */
const wrap = (cp: number) => `before${String.fromCodePoint(cp)}after`;

// Explicit bidirectional formatting controls, plus the implicit marks. These
// are the Trojan Source characters (CVE-2021-42574): they reorder rendered
// text without changing the bytes a compiler or matcher sees.
const BIDI: [string, number][] = [
  ['LEFT-TO-RIGHT EMBEDDING', 0x202a],
  ['RIGHT-TO-LEFT EMBEDDING', 0x202b],
  ['POP DIRECTIONAL FORMATTING', 0x202c],
  ['LEFT-TO-RIGHT OVERRIDE', 0x202d],
  ['RIGHT-TO-LEFT OVERRIDE', 0x202e],
  ['LEFT-TO-RIGHT ISOLATE', 0x2066],
  ['RIGHT-TO-LEFT ISOLATE', 0x2067],
  ['FIRST STRONG ISOLATE', 0x2068],
  ['POP DIRECTIONAL ISOLATE', 0x2069],
  ['LEFT-TO-RIGHT MARK', 0x200e],
  ['RIGHT-TO-LEFT MARK', 0x200f],
  ['ARABIC LETTER MARK', 0x061c],
];

// Format and zero-width characters that carry no visible glyph. Spread across
// the BMP and three astral blocks, so this doubles as a surrogate-pair check.
const INVISIBLE: [string, number][] = [
  ['SOFT HYPHEN', 0x00ad],
  ['SYRIAC ABBREVIATION MARK', 0x070f],
  ['MONGOLIAN VOWEL SEPARATOR', 0x180e],
  ['ZERO WIDTH SPACE', 0x200b],
  ['ZERO WIDTH NON-JOINER', 0x200c],
  ['ZERO WIDTH JOINER', 0x200d],
  ['WORD JOINER', 0x2060],
  ['FUNCTION APPLICATION', 0x2061],
  ['INVISIBLE TIMES', 0x2062],
  ['INVISIBLE SEPARATOR', 0x2063],
  ['INVISIBLE PLUS', 0x2064],
  ['INHIBIT SYMMETRIC SWAPPING', 0x206a],
  ['ACTIVATE SYMMETRIC SWAPPING', 0x206b],
  ['INHIBIT ARABIC FORM SHAPING', 0x206c],
  ['ACTIVATE ARABIC FORM SHAPING', 0x206d],
  ['NATIONAL DIGIT SHAPES', 0x206e],
  ['NOMINAL DIGIT SHAPES', 0x206f],
  ['ZERO WIDTH NO-BREAK SPACE', 0xfeff],
  ['SHORTHAND FORMAT LETTER OVERLAP', 0x1bca0],
  ['SHORTHAND FORMAT CONTINUING OVERLAP', 0x1bca1],
  ['SHORTHAND FORMAT DOWN STEP', 0x1bca2],
  ['SHORTHAND FORMAT UP STEP', 0x1bca3],
  ['MUSICAL SYMBOL BEGIN BEAM', 0x1d173],
  ['MUSICAL SYMBOL END BEAM', 0x1d174],
  ['MUSICAL SYMBOL BEGIN TIE', 0x1d175],
  ['MUSICAL SYMBOL END TIE', 0x1d176],
  ['MUSICAL SYMBOL BEGIN SLUR', 0x1d177],
  ['MUSICAL SYMBOL END SLUR', 0x1d178],
  ['MUSICAL SYMBOL BEGIN PHRASE', 0x1d179],
  ['MUSICAL SYMBOL END PHRASE', 0x1d17a],
];

describe('bidi control characters', () => {
  it.each(BIDI)('flags %s inside a word', (_name, cp) => {
    const r = analyze(wrap(cp));
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('beforeafter');
  });

  it('flags a Trojan Source style override sequence', () => {
    const rlo = String.fromCodePoint(0x202e);
    const pdf = String.fromCodePoint(0x202c);
    const r = analyze(`access${rlo}level${pdf}`);
    expect(r.spoofed).toBe(true);
    expect(r.normalized).toBe('accesslevel');
  });
});

describe('invisible format characters', () => {
  it.each(INVISIBLE)('flags %s inside a word', (_name, cp) => {
    const r = analyze(wrap(cp));
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('beforeafter');
  });

  it('leaves no lone surrogates after stripping astral invisibles', () => {
    const r = analyze('a\u{1D173}b\u{1BCA0}c');
    expect(r.normalized).toBe('abc');
    expect(wellFormed(r.normalized)).toBe(true);
  });

  it('reports offsets that survive an astral character earlier in the text', () => {
    // `index` is a UTF-16 offset \u2014 it round-trips through String.slice even
    // when a surrogate pair precedes the affected word.
    const text = '\u{1F600} zero\u200Bwidth';
    const r = analyze(text);
    const w = r.words[0]!;
    expect(w.word).toBe('zero\u200Bwidth');
    expect(text.slice(w.index, w.index + w.word.length)).toBe(w.word);
  });
});

describe('tag characters', () => {
  // U+E0000..U+E007F re-encode ASCII invisibly — the payload channel behind
  // "invisible prompt injection".
  const steg = 'hello\u{E0068}\u{E0069}\u{E0021}world';

  it('flags an ASCII payload spelled in tag characters', () => {
    const r = analyze(steg);
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('helloworld');
    expect(wellFormed(r.normalized)).toBe(true);
  });

  it('leaves a legitimate tag sequence alone (flag of England)', () => {
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    const r = analyze(`go ${england}!`);
    expect(r.spoofed).toBe(false);
    expect(r.changed).toBe(false);
  });
});

describe('mixed invisible characters in running text', () => {
  it('strips several different invisibles from one sentence', () => {
    // SOFT HYPHEN, then MONGOLIAN VOWEL SEPARATOR.
    const r = analyze('noth\u00ADing h\u180Eere');
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('nothing here');
    expect(r.counts.wordsAffected).toBe(2);
  });
});

describe('no false positives on emoji', () => {
  // Emoji sequences are built from ZERO WIDTH JOINER and VARIATION SELECTOR-16
  // — the same code points that are spoofing signals elsewhere. Nothing here
  // may be flagged. Corpus lifted verbatim from out-of-character.
  const EMOJI: string[] = [
    // eyeball + speech bubble
    '👁️‍🗨️',
    // faces
    '👶🧒👦👧🧑👨👱‍♂️🧔👩👱‍♀️🧓👴👵👨‍⚕️👩‍⚕️👨‍🎓👩‍🎓👨‍🏫👩‍🏫👨‍⚖️👩‍⚖️👨‍🌾👩‍🌾👨‍🍳👩',
    // people
    '‍🍳👨‍🔧👩‍🔧👨‍🏭👩‍🏭👨‍💼👩‍💼👨‍🔬👩‍🔬👨‍💻👩‍💻👨‍🎤👩‍🎤👨‍🎨👩‍🎨👨‍✈️👩‍✈️👨‍🚀👩‍🚀👨‍🚒👩‍🚒🧙‍♂️🧙‍♀️🧚‍♂️🧚‍♀️👨‍🦰🧛‍♂️🧛‍♀️👨‍🦱👨‍🦳👨‍🦲🧜‍♂️🧜‍♀️🧝‍♂️👩‍🦰👩‍🦱🧝‍♀️👩‍🦳🧞‍♂️👩‍🦲🧞‍♀️🧟‍♂️🧟‍♀️🙍‍♂️🙍‍♀️🙎‍♂️🙎‍♀️🙅‍♂️🙅‍♀️🙆‍♂️🙆‍♀️💁‍♂️💁‍♀️🙋‍♂️🙋‍♀️🙇‍♂️🙇‍♀️🤦🤦‍♂️🤦‍♀️🤷🤷‍♂️🤷‍♀️💆‍♂️💆‍♀️💇‍♂️💇‍♀️👤👥🦸‍♂️🦸‍♀️🦹‍♂️🦹‍♀️👫👬👭👩‍❤️‍💋‍👨👨‍❤️‍💋‍👨👩‍❤️‍💋‍👩👩‍❤️‍👨👨‍❤️‍👨👩‍❤️‍👩👨‍👩‍👦👨‍👩‍👧👨‍👩‍👧‍👦👨‍👩‍👦‍👦👨‍👩‍👧‍👧👨‍👨‍👦👨‍👨‍👧👨‍👨‍👧‍👦👨‍👨‍👦‍👦👨‍👨‍👧‍👧👩‍👩‍👦👩‍👩‍👧👩‍👩‍👧‍👦👩‍👩‍👦‍👦👩‍👩‍👧‍👧👨‍👦👨‍👦‍👦👨‍👧👨‍👧‍👦👨‍👧‍👧👩‍👦👩‍👦‍👦👩‍👧👩‍👧‍👦👩‍👧‍👧',
    // actions
    '🚶‍♂️🚶‍♀️🏃‍♂️🏃‍♀️💃🕺👯‍♂️👯‍♀️🧖‍♂️🧖‍♀️🧗‍♂️🧗‍♀️🧘‍♂️🧘‍♀️🛌🕴️🗣️🤺🏇⛷️🏂🏌️‍♂️🏌️‍♀️🏄‍♂️🏄‍♀️🚣‍♂️🚣‍♀️🏊‍♂️🏊‍♀️⛹️‍♂️⛹️‍♀️🏋️‍♂️🏋️‍♀️🚴‍♂️🚴‍♀️🚵‍♂️🚵‍♀️🏎️🏍️🤸🤸‍♂️🤸‍♀️🤼🤼‍♂️🤼‍♀️🤽🤽‍♂️🤽‍♀️🤾🤾‍♂️🤾‍♀️🤹🤹‍♂️🤹‍♀️',
    // flags
    '🇨🇿🇩🇪🇩🇬🇩🇯🇩🇰🇩🇲🇩🇴🇩🇿🇪🇦🇪🇨🇪🇪🇪🇬🇪🇭🇪🇷🇪🇸🇪🇹🇪🇺🇫🇮🏴‍☠️🇫🇯🇫🇰🇫🇲🇫🇴🇫🇷🇬🇦🇬🇧🇬🇩🇬🇪🇬🇫🇬🇬🇬🇭🇬🇮🇬🇱🇬🇲🇬🇳🇬🇵🇬🇶🇬🇷🇬🇸🇬🇹🇬🇺🇬🇼🇬🇾🇭🇰🇭🇲🇭🇳',
    // complex faces
    '👮‍♂️👮‍♀️🕵️‍♂️🕵️‍♀️💂‍♂️💂‍♀️👷‍♂️👷‍♀️🤴👸👳‍♂️👳‍♀️👲🧕🤵👰🤰🤱👼🎅🤶',
  ];

  it.each(EMOJI.map((s, i) => [i, s] as const))('leaves emoji corpus #%i alone', (_i, str) => {
    const r = analyze(str);
    expect(r.spoofed).toBe(false);
    expect(r.words).toEqual([]);
  });

  it('leaves legitimate variation sequences alone', () => {
    for (const str of ['\u2764\uFE0F', '#\uFE0F\u20E3', '\u8FBB\uFE00', '\u1820\u180B']) {
      expect(analyze(str).spoofed, JSON.stringify(str)).toBe(false);
    }
  });
});

describe('variation selectors', () => {
  // A selector on a base with no registered variation sequence renders as
  // nothing — the "ASCII smuggling" payload channel. Registered sequences
  // (emoji presentation, ideographic variants, Mongolian FVS) are untouched.
  it('flags a stray VARIATION SELECTOR-16 on a Latin letter', () => {
    const r = analyze('a\uFE0Fb');
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('ab');
  });

  it('flags a stray VARIATION SELECTOR-1 on a Latin letter', () => {
    const r = analyze('a\uFE00b');
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('ab');
  });

  it('flags a run of selectors hiding a payload', () => {
    const r = analyze('hi\uFE01\uFE02\uFE03\uFE04\uFE05there');
    expect(r.spoofed).toBe(true);
    expect(r.normalized).toBe('hithere');
  });

  it('leaves registered variation sequences alone', () => {
    const LEGITIMATE: [string, string][] = [
      ['emoji presentation', '\u2764\uFE0F'],
      ['keycap', '#\uFE0F\u20E3'],
      ['ideographic variant', '\u8FBB\uFE00'],
      ['Mongolian free variation selector', '\u1820\u180B'],
    ];
    for (const [name, str] of LEGITIMATE) {
      const r = analyze(str);
      expect(r.spoofed, name).toBe(false);
      expect(r.changed, name).toBe(false);
    }
  });
});

describe('blank glyphs that are not whitespace', () => {
  // These draw nothing but are not White_Space, so no `\s` normalization or
  // word split removes them: they break a word while it still reads normally.
  // The Hangul fillers are category Lo — without special handling they enter
  // the word as Hangul letters and misreport as a script mix.
  const BLANKS: [string, number][] = [
    ['HANGUL CHOSEONG FILLER', 0x115f],
    ['HANGUL JUNGSEONG FILLER', 0x1160],
    ['HANGUL FILLER', 0x3164],
    ['HALFWIDTH HANGUL FILLER', 0xffa0],
    ['BRAILLE PATTERN BLANK', 0x2800],
    ['MUSICAL SYMBOL NULL NOTEHEAD', 0x1d159],
  ];

  it.each(BLANKS)('flags %s splitting a word', (_name, cp) => {
    const r = analyze(`free${String.fromCodePoint(cp)}money`);
    expect(r.signals.invisible).toBe(true);
    expect(r.signals.mixed_script).toBe(false);
    expect(r.normalized).toBe('freemoney');
  });
});

describe('invisible combining marks', () => {
  // Category Mn rather than Cf, so the format-character rule alone misses them.
  const MARKS: [string, number][] = [
    ['COMBINING GRAPHEME JOINER', 0x034f],
    ['KHMER VOWEL INHERENT AQ', 0x17b4],
    ['KHMER VOWEL INHERENT AA', 0x17b5],
    ['KAITHI VOWEL SIGN I', 0x110b1],
  ];

  it.each(MARKS)('flags %s inside a Latin word', (_name, cp) => {
    const r = analyze(wrap(cp));
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('beforeafter');
  });

  it('leaves an invisible mark alone inside its own script', () => {
    // U+17B4 in Khmer text, U+110B1 in Kaithi: legitimate orthography there.
    expect(analyze('\u1780\u17B4\u1781').spoofed).toBe(false);
    expect(analyze('\u{11083}\u{110B1}\u{11084}').spoofed).toBe(false);
  });
});

describe('invisible characters that belong to no word', () => {
  // A lone invisible forms no word for the per-token pass to judge, so it is
  // found in a separate scan — with sequence-building invisibles (emoji ZWJ,
  // keycaps, tag flags) excluded by looking at what sits next to the run.
  it('strips every bidi control from a Trojan Source line', () => {
    // Two controls hug words; two sit against `//` and `"`.
    const trojan = 'if (level != "user\u202E \u2066// admin check\u2069 \u2066") {';
    const r = analyze(trojan);
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('if (level != "user // admin check ") {');
  });

  it('leaves a zero-width run isolated in whitespace alone', () => {
    // Nothing to split: the break it would create is already there. This shape
    // is what rich-text editors leave behind in templates, and reporting it
    // told users their own newsletter was an attack.
    const r = analyze('free \u200B money');
    expect(r.spoofed).toBe(false);
    expect(r.normalized).toBe('free \u200B money');
  });

  it('still flags a zero-width run that touches text on either side', () => {
    // One-sided contact is not inert: these render identically to the bare
    // word but compare unequal to it, which is enough to pass an exact match.
    for (const text of ['admin\u200B', '\u200Badmin', 'ad\u200Bmin', 'a = \u200B= b']) {
      expect(analyze(text).signals.invisible).toBe(true);
    }
  });

  it('flags a zero-width run in whitespace once it is long enough to carry data', () => {
    // Isolation stops excusing a run at ZERO_WIDTH_INERT_RUN: every position
    // is at least a bit, so length alone makes it a payload channel.
    const inert = `free ${'\u200B'.repeat(ZERO_WIDTH_INERT_RUN)} money`;
    const payload = `free ${'\u200B'.repeat(ZERO_WIDTH_INERT_RUN + 1)} money`;
    expect(analyze(inert).spoofed).toBe(false);
    expect(analyze(payload).signals.invisible).toBe(true);
  });

  it('flags an invisible run between punctuation', () => {
    const r = analyze('("\u200B\u200C")');
    expect(r.signals.invisible).toBe(true);
    expect(r.words[0]!.word).toBe('\u200B\u200C');
    expect(r.normalized).toBe('("")');
  });

  it('leaves the invisibles that build emoji sequences alone', () => {
    const SEQUENCES: [string, string][] = [
      ['family (ZWJ)', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'],
      [
        'England flag (tag sequence)',
        '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      ],
      ['keycap', '5\uFE0F\u20E3'],
      ['heart with emoji presentation', '\u2764\uFE0F'],
    ];
    for (const [name, str] of SEQUENCES) {
      expect(analyze(str).spoofed, name).toBe(false);
      expect(analyze(`look ${str} here`).spoofed, `${name} in a sentence`).toBe(false);
    }
  });
});

describe('no false positives on legitimate text', () => {
  // Regression sweep. Every entry contains characters the rules above look for
  // — exotic spaces, joiners, selectors, invisible marks — used the way real
  // content uses them. `ℹ️` earned its place here: U+2139 is a LETTER that
  // takes the emoji presentation selector.
  const LEGITIMATE: [string, string][] = [
    ['French spacing', 'Bonjour\u00A0! Ça va\u202F? Oui\u00A0: très bien.'],
    ['CJK ideographic space', '日本語\u3000テスト\u3000です'],
    ['typeset thin space', 'p\u2009=\u20090.05, n\u2009=\u200912'],
    ['Hindi ZWNJ', 'क्\u200Cष हिन्दी वाक्य'],
    ['Persian ZWNJ', 'می\u200Cخواهم کتاب بخوانم'],
    ['Mongolian', 'ᠮᠣᠩᠭᠣᠯ ᠬᠡᠯᠡ'],
    ['Khmer', 'ភាសាខ្មែរ សួស្ដី'],
    ['Japanese ideographic variants', '辻\uFE00さんと葛\uFE01城'],
    ['emoji with skin tones', '👋🏽 hello 👨🏿‍💻 and 👩🏻‍🚀'],
    ['keycaps', 'press 1\uFE0F\u20E3 then #\uFE0F\u20E3'],
    ['letterlike emoji', 'copyright ©\uFE0F trademark ™\uFE0F info ℹ\uFE0F'],
    ['flags', '🇩🇪 🇯🇵 🏴󠁧󠁢󠁳󠁣󠁴󠁿 🏳️‍🌈 🏴‍☠️'],
    ['code with tabs and CRLF', 'const x = foo("bar") // ok\n\ttabbed\r\n'],
  ];

  it.each(LEGITIMATE)('leaves %s untouched', (_name, str) => {
    const r = analyze(str);
    expect(r.spoofed).toBe(false);
    expect(r.changed).toBe(false);
  });
});

describe('sequence exemption is not a loophole', () => {
  // Only sequence-building neighbours (emoji, enclosing marks, regional
  // indicators) exempt an invisible run. An ordinary symbol must not — else
  // "$<ZWSP>100" would be a free hiding place next to any punctuation.
  it('flags an invisible next to a currency symbol', () => {
    const r = analyze('price: $​100');
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('price: $100');
  });

  it('flags an invisible next to a math symbol', () => {
    expect(analyze('a = ​= b').spoofed).toBe(true);
  });
});
