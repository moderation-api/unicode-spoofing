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
import { analyze, type ScriptName } from '../src';

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
