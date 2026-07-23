/**
 * ============================================================================
 *  KNOWN GAPS — behaviors we have DELIBERATELY not implemented (yet)
 * ============================================================================
 *
 *  Each case below is a real spoofing vector the detector does not cover. They
 *  live here so the boundary of the library is documented in one place.
 *
 *  This file is EXCLUDED from `pnpm test`, so these do not gate CI. Run them on
 *  demand with:
 *      pnpm test:gaps
 *
 *  Each case is a plain assertion of the behavior we WANT, so it currently
 *  FAILS — a red line here is an open gap. When one turns green, the behavior
 *  now works: delete it from this file and promote it into the main suite.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { analyze, findKeywordEvasions, prefilter, type ScriptName } from '../src';

/** Was anything flagged? */
const flagged = (input: string, expectedScripts?: ScriptName[]) =>
  analyze(input, expectedScripts ? { expectedScripts } : undefined).spoofed;

describe('known gap: allowed multi-script combinations (UTS #39 augmented sets)', () => {
  // The detector flags ANY intra-token script mix. UTS #39 treats some
  // combinations as legitimate (Latin + Han, and the Japanese/Korean sets), so
  // spaceless runs common in CJK text — "AI技術", "5G通信", "iPhone対応" — are
  // false positives today. Fixing this needs the augmented allowed-combination
  // table. It only affects same-token mixes: "iPhone 15" is already clean.
  it('does NOT flag Latin + Han in one token ("AI技術")', () => {
    expect(flagged('AI技術')).toBe(false);
  });
});

describe('known gap: URL host-separator confusables', () => {
  // Letter homographs in a domain ARE caught: "pаypal.com" (Cyrillic a) flags
  // mixed_script, and "аррӏе.com" flags confusable_word with expectedScripts.
  // What is NOT caught is a compatibility FULL STOP spoofing the label dot
  // ("example．com", "example。com"). The blocker: U+FF0E / U+3002 are ordinary
  // sentence punctuation in CJK ("終わり。次へ"), so flagging them needs URL/host
  // context the general-text analyzer does not have. See the chat for the
  // low-false-positive heuristic (compat stop between two ASCII-letter runs).
  it('flags a fullwidth full stop spoofing a hostname dot ("example．com")', () => {
    expect(flagged('example．com')).toBe(true);
  });

  it('flags an ideographic full stop in a host ("example。com")', () => {
    expect(flagged('example。com')).toBe(true);
  });
});

describe('known gap: same-script (ASCII) homoglyphs', () => {
  // Substituting visually similar ASCII for ASCII — capital "I" for lowercase
  // "l", "rn" for "m", "0" for "O" — needs a protected-word list to resolve
  // (every such string is also a legitimate word), so it is out of scope.
  it('flags capital-I standing in for l ("paypaI.com")', () => {
    expect(flagged('paypaI.com')).toBe(true);
  });
});

describe('known gap: isolated compatibility symbols', () => {
  // Group B (NFKC compatibility styling) is intentionally scoped to runs of >=2
  // styled LETTERS spelling a word (fullwidth/circled/math — those ARE caught).
  // A lone compatibility symbol is left alone because NFKC-folding it blindly
  // would flag legitimate typography: m², №, ½, ℃, ㎏, Ⅳ all NFKC-change.
  it('flags a superscript digit used as normal ("level²")', () => {
    expect(flagged('level²')).toBe(true);
  });
});

describe('known gap: mixed / confusable numeral systems', () => {
  // Letterless tokens carry no spoofing evidence (see analyze.ts — the
  // letterless-token early return), so mixed or styled DIGIT systems are not
  // analyzed. A numeral-script feature could add this later.
  it('flags ASCII mixed with Arabic-Indic digits ("1٢3")', () => {
    expect(flagged('1٢3')).toBe(true);
  });

  it('flags fullwidth digits masquerading as ASCII ("１２３")', () => {
    expect(flagged('１２３')).toBe(true);
  });

  it('flags Devanagari digits mixed with Latin ("code४2")', () => {
    expect(flagged('code४2')).toBe(true);
  });
});

describe('known gap: standalone whole-script confusables (no caller context)', () => {
  // WITH expectedScripts the detector catches these (see the main suite). But a
  // bare all-Cyrillic word whose skeleton is ASCII, analyzed with NO context,
  // is genuinely ambiguous — real Cyrillic words collide too ("оса"→"oca",
  // "сор"→"cop") — so it is not flagged by default. Callers opt in by declaring
  // the scripts they expect.
  it('flags all-Cyrillic "apple" (аррӏе) with no expectedScripts', () => {
    expect(flagged('аррӏе')).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * Gaps surfaced by porting the out-of-character corpus (see invisible.test.ts).
 * Everything else that corpus covers is now handled and lives in the main suite.
 * ------------------------------------------------------------------------- */

describe('known gap: the Unicode whitespace family', () => {
  // NOT a bug we intend to fix — recorded here because the out-of-character
  // corpus covers it and the omission is deliberate.
  //
  // These render as a space and ARE whitespace (White_Space=Yes), so every
  // JS `\s`, `String.split()` and tokenizer already treats them as a word
  // break; they cost an attacker nothing and gain them nothing. They are also
  // ordinary typography: U+00A0 in HTML, U+202F in French punctuation, U+3000
  // in CJK text, U+2009 in typeset prose. Flagging them would produce constant
  // false positives on legitimate content.
  //
  // The blank glyphs that are NOT whitespace — Hangul fillers, braille blank —
  // are the ones an attacker can actually hide behind, and those ARE flagged
  // (see invisible.test.ts).
  const WHITESPACE: [string, number][] = [
    ['OGHAM SPACE MARK', 0x1680],
    ['EN QUAD', 0x2000],
    ['EM SPACE', 0x2003],
    ['THIN SPACE', 0x2009],
    ['HAIR SPACE', 0x200a],
    ['NARROW NO-BREAK SPACE', 0x202f],
    ['MEDIUM MATHEMATICAL SPACE', 0x205f],
    ['IDEOGRAPHIC SPACE', 0x3000],
  ];

  it.each(WHITESPACE)('flags %s as a word separator', (_name, cp) => {
    expect(flagged(`free${String.fromCodePoint(cp)}money`)).toBe(true);
  });
});

/* ============================================================================
 * KEYWORD EVASION (leet layer) — gaps found by the adversarial suite.
 * Every assertion below states the behavior we WANT; red = open hole.
 * The current (wrong) behavior of each case is asserted nowhere, so closing
 * a gap only requires deleting it here and promoting it to
 * leet-adversarial.test.ts.
 * ==========================================================================*/

const evaded = (text: string, keywords: string[]) =>
  findKeywordEvasions(text, keywords).map((m) => m.keyword);

describe('known gap: separator characters outside the set', () => {
  // The matcher's separator class stops at "punctuation people type inside a
  // word". Evaders also reach for slashes, hashes, and — critically —
  // typographic dashes, which many keyboards autocorrect a hyphen INTO. All
  // of these currently pass clean.
  it.each([
    ['slash', 'f/r/e/e'],
    ['backslash', 'f\\r\\e\\e'],
    ['hash', 'f#r#e#e'],
    ['question mark', 'f?r?e?e'],
    ['ampersand', 'f&r&e&e'],
    ['percent', 'f%r%e%e'],
    ['greater-than', 'f>r>e>e'],
    ['em dash', 'f—r—e—e'],
    ['en dash', 'f–r–e–e'],
    ['ellipsis', 'f…r…e…e'],
  ])('bridges %s gaps', (_name, text) => {
    expect(evaded(text, ['free'])).toEqual(['free']);
  });

  it('bridges emoji used as separators', () => {
    expect(evaded('f🚫r🚫e🚫e', ['free'])).toEqual(['free']);
    expect(evaded('f❤r❤e❤e', ['free'])).toEqual(['free']);
  });
});

describe('known gap: combining marks split a word below the zalgo threshold', () => {
  // One mark per letter renders as decorated-but-readable text, stays under
  // ZALGO_MARK_RUN, is not invisible, and is not a separator — so neither the
  // matcher nor any analyze signal sees it. This is the cheapest unicode
  // evasion the pipeline currently misses outright.
  it('reads f̸r̸e̸e̸ as free', () => {
    expect(evaded('f\u0338r\u0338e\u0338e\u0338', ['free'])).toEqual(['free']);
  });
});

describe('known gap: a single zero-width split scores below the threshold', () => {
  // "f<ZWSP>ree" carries one gap = score 1 < 2. A zero-width character inside
  // a word is never innocent, so an invisible gap should arguably score 2
  // like a substitution. NOTE: the full pipeline still catches this — analyze
  // strips the ZWSP and the README normalized-rerun recipe matches — so this
  // gap only bites matcher-standalone callers.
  it('matches through one zero-width space', () => {
    expect(evaded('f\u200Bree', ['free'])).toEqual(['free']);
  });
});

describe('known gap: stretched letters split by separators', () => {
  // Repeat consumption runs INSIDE matchLetter steps, gap consumption runs
  // between keyword letters — but a stretched-and-separated letter needs
  // both at once. "f-u-u-c-k" walks: u matched, "-" gap, then "u" where "c"
  // is expected. Dies.
  it('reads f-u-u-c-k as fuck', () => {
    expect(evaded('f-u-u-c-k', ['fuck'])).toEqual(['fuck']);
  });
});

describe('known gap: the greedy repeat-eater has no backtracking', () => {
  // After matching a letter, the matcher eats any following characters that
  // could be repeats of it — including characters the keyword needs NEXT.
  // "fai1": "i" matches, then "1" (which can play i OR l) is eaten as a
  // stretched i, and the required l is gone. Fix needs one character of
  // lookahead or backtracking in the repeat loop.
  it.each([
    ['fai1', 'fail'],
    ['ni1', 'nil'],
    ['he£lo', 'hello'], // £ can play e and l; eaten as a stretched e
  ])('%s matches %s', (text, keyword) => {
    expect(evaded(text, [keyword])).toEqual([keyword]);
  });
});

describe('known gap: doubled evasions with no boundary between them', () => {
  // "fr33fr33": the first match ends against the letter f, the boundary
  // check refuses it, and the scan never recovers either copy.
  it('finds both copies in fr33fr33', () => {
    expect(evaded('fr33fr33', ['free']).length).toBeGreaterThan(0);
  });
});

describe('known gap: alphabets the confusable fold does not reach', () => {
  // Each of these renders as "free" (or its mirror) to a reader, and none of
  // them fold to ASCII through UTS #39 or NFKC.
  it.each([
    ['small caps', 'ꜰʀᴇᴇ'],
    ['negative squared', '🅵🆁🅴🅴'],
    ['regional indicators', '🇫🇷🇪🇪'],
  ])('reads %s', (_name, text) => {
    expect(evaded(text, ['free'])).toEqual(['free']);
  });

  it('reads upside-down text', () => {
    // Needs a reversal transform on top of the char map: ǝǝɹɟ = free.
    expect(evaded('ǝǝɹɟ', ['free'])).toEqual(['free']);
  });
});

describe('known gap: handle-embedded keywords', () => {
  // The cl-ass rule (a non-space separator following a letter is not a
  // boundary) protects hyphenated prose but also shields usernames:
  // "user_fr33_x" hides fr33 completely. Distinguishing handle context from
  // prose context needs the caller to say which it is analyzing.
  it('finds fr33 inside user_fr33_x', () => {
    expect(evaded('user_fr33_x', ['free'])).toEqual(['free']);
  });
});

describe('known gap: trailing punctuation counted as letter stretching', () => {
  // FALSE POSITIVES. "!" can play i/l and "$" can play s, so "kill!!"
  // scores 2 via two "stretches" of l — a plain word with plain enthusiasm
  // reads as an evasion. Repeat-eating should not apply leet substitutes to
  // characters after the keyword is already complete, or trailing repeats
  // should score 0.
  it.each(['lol!!', 'kill!!', 'ass$$'])('does not flag %s', (text) => {
    const keyword = text.replace(/[!$]/g, '');
    expect(evaded(text, [keyword])).toEqual([]);
  });

  it('does not flag a parenthesized word as a c-substitution', () => {
    // "(" plays c, then the real c is eaten as a repeat: "(cool" = cool + 3.
    expect(evaded('(cool stuff)', ['cool'])).toEqual([]);
    expect(evaded('(care taken)', ['care'])).toEqual([]);
  });
});

describe('known gap: duration shorthand false positive', () => {
  // "45s" (45 seconds) matches "ass" because the trailing s anchors it.
  // Any fix must NOT lose "4ss" / "a$$" — likely needs "digits are only
  // substitutes when the word also contains a substituted-or-plain letter
  // BEFORE them" or similar asymmetry.
  it('does not flag 45s as ass', () => {
    expect(evaded('wait 45s more', ['ass'])).toEqual([]);
  });
});

describe('known gap: prefilter blind spots vs the matcher', () => {
  // Every text here MATCHES via findKeywordEvasions today, but the gate says
  // clean — so a prefilter-gated pipeline drops real evasions. Each entry is
  // an input class the gate's character-level rules cannot see.
  const MATCHED_BUT_GATED: [string, string, string][] = [
    ['newline separators', 'f\nr\ne\ne', 'free'],
    ['ph digraph, all letters', 'PHREE', 'free'],
    ['stretching, all letters', 'fuuuuck', 'fuck'],
    ['doubled letters, all letters', 'ffrreeee', 'free'],
    ['paren as c', '(ocoa', 'cocoa'],
    ['multi-letter chunk split', 'gar b age', 'garbage'],
    ['colon separators', 'f:r:e:e', 'free'],
    ['apostrophe separators', "f'r'e'e", 'free'],
    ['equals separators', 'f=r=e=e', 'free'],
    ['ASCII-art w', '\\/\\/ow', 'wow'],
    ['ASCII-art d', '|)addy', 'daddy'],
    ['ASCII-art f', '|=luff', 'fluff'],
  ];

  it.each(MATCHED_BUT_GATED)('gate sees %s ("%s")', (_name, text, keyword) => {
    // Guard: the case must really match, else this gap is stale.
    expect(evaded(text, [keyword])).toEqual([keyword]);
    expect(prefilter(text)).toBe(true);
  });
});
