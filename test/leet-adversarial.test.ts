/**
 * ============================================================================
 *  KEYWORD-EVASION ADVERSARIAL SUITE
 * ============================================================================
 *
 *  Systematic coverage of the matcher, the prefilter, and their contract with
 *  each other. Everything here asserts CURRENT, verified behavior — including
 *  deliberate rejections. Real deficiencies found while building this suite
 *  (missed separators, the greedy repeat-eater, trailing-punctuation false
 *  positives, prefilter superset violations) are NOT here: they live in
 *  known-gaps.test.ts, where a red line is an open hole. Keep the two files
 *  in sync — when a gap closes, its case moves here.
 *
 *  Table-driven where possible: the leet tables are imported and iterated, so
 *  a new table entry is covered (or exposed) without touching this file.
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, findKeywordEvasions, LEET_ALTERNATIVES, LEET_SEQUENCES, prefilter } from '../src';

const hits = (text: string, keywords: readonly string[]) =>
  findKeywordEvasions(text, keywords).map((m) => m.keyword);

/**
 * Host word per letter, used to embed each table substitution in a realistic
 * word. Chosen so the substituted position is not adjacent to a letter the
 * substitute is ALSO ambiguous with — the greedy repeat-eater (see
 * known-gaps) would otherwise consume it as a stretch. That is why `l` hosts
 * in "wall" and not "hello": `£` can play both `e` and `l`, and after
 * "he" it is eaten as a stretched `e`.
 */
const HOST: Record<string, string> = {
  o: 'moon',
  i: 'girl',
  l: 'wall',
  z: 'zebra',
  e: 'green',
  a: 'grass',
  s: 'glass',
  g: 'giggle',
  b: 'bubble',
  t: 'total',
  c: 'cocoa',
  y: 'yearly',
  k: 'kick',
  d: 'daddy',
  h: 'hehe',
  n: 'nine',
  u: 'guru',
  v: 'velvet',
  w: 'wow',
  x: 'boxer',
  f: 'fluff',
  r: 'roar',
};

const embed = (letter: string, substitute: string): { text: string; keyword: string } => {
  const word = HOST[letter];
  if (word === undefined) throw new Error(`no host word for letter "${letter}"`);
  const at = word.indexOf(letter);
  return { text: word.slice(0, at) + substitute + word.slice(at + 1), keyword: word };
};

describe('every single-character substitution in the table matches', () => {
  const cases: Array<[string, string, string, string]> = [];
  for (const [substitute, letters] of Object.entries(LEET_ALTERNATIVES)) {
    for (const letter of letters) {
      const { text, keyword } = embed(letter, substitute);
      cases.push([substitute, letter, text, keyword]);
    }
  }

  it.each(cases)('%s → %s (%s)', (_sub, _letter, text, keyword) => {
    expect(hits(`buy ${text} now`, [keyword])).toEqual([keyword]);
  });
});

describe('every ASCII-art sequence in the table matches', () => {
  const cases = LEET_SEQUENCES.map(([seq, letter]) => {
    const { text, keyword } = embed(letter, seq);
    return [seq, letter, text, keyword] as const;
  });

  it.each(cases)('%s → %s (%s)', (_seq, _letter, text, keyword) => {
    expect(hits(`buy ${text} now`, [keyword])).toEqual([keyword]);
  });

  it('sequences match case-insensitively', () => {
    expect(hits('PHREE', ['free'])).toEqual(['free']);
  });
});

describe('separator gaps — edges of the cap', () => {
  it('bridges gaps of exactly MAX_GAP characters', () => {
    expect(hits('f....r....e....e', ['free'])).toEqual(['free']);
    expect(hits('f -- r -- e -- e', ['free'])).toEqual(['free']);
  });

  it('refuses gaps one character wider', () => {
    expect(hits('f.....r.....e.....e', ['free'])).toEqual([]);
  });

  it('mixed gap widths within one match are fine', () => {
    expect(hits('f.r....e.e', ['free'])).toEqual(['free']);
  });

  it('whitespace separators include newline, CRLF, and tab', () => {
    expect(hits('f\nr\ne\ne', ['free'])).toEqual(['free']);
    expect(hits('f\r\nr\r\ne\r\ne', ['free'])).toEqual(['free']);
    expect(hits('f\tr\te\te', ['free'])).toEqual(['free']);
  });
});

describe('boundary battery', () => {
  it.each([
    ['"fr33"', 1],
    ['(fr33)', 1],
    [',fr33', 1],
    ['fr33!!!', 0],
    ['🎉fr33', 2], // astral neighbour: index counts UTF-16 units
    ['𝄞fr33', 2],
    ['fr33🎉', 0],
  ])('%s matches with correct index', (text, index) => {
    const matches = findKeywordEvasions(text, ['free']);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.index).toBe(index);
    // index/text consistency: the reported slice IS the text at that index.
    expect(text.slice(matches[0]!.index, matches[0]!.index + matches[0]!.text.length)).toBe(
      matches[0]!.text,
    );
  });

  it('a digit prefix reads as part of the token, not a boundary', () => {
    // Anti-false-positive rule: "9fr33" could be a code, not a disguised word.
    expect(hits('9fr33', ['free'])).toEqual([]);
  });

  it('an underscore handle hides its inner words — the cl-ass rule', () => {
    // Same rule that refuses "cl-ass": a non-space separator that itself
    // follows a letter is not a boundary. See known-gaps for the cost.
    expect(hits('user_fr33_x', ['free'])).toEqual([]);
  });

  it('matches at string start and string end', () => {
    expect(hits('fr33', ['free'])).toEqual(['free']);
    expect(hits('get fr33', ['free'])).toEqual(['free']);
  });
});

describe('anchor rule — numbers stay numbers', () => {
  it.each([
    ['only $5 and $3 today', ['sse']],
    ['at 4.55 pm', ['ass']],
    ['10.0.0.1', ['looo']],
    ['room 505', ['sos']],
    ['gate 455 is closed', ['ass']],
    ['call 0800 455 455', ['ass', 'boo']],
  ])('%s has no plain letter to anchor a match', (text, keywords) => {
    expect(hits(text, keywords)).toEqual([]);
  });

  it('one plain letter anchors; one non-ASCII lookalike also anchors', () => {
    expect(hits('45s', ['ass'])).toEqual(['ass']); // "s" anchors
    expect(hits('а$$', ['ass'])).toEqual(['ass']); // Cyrillic а anchors
    expect(hits('4$$', ['ass'])).toEqual([]); // nothing anchors
  });
});

describe('overlap and precedence', () => {
  it('longest keyword wins at the same start', () => {
    const m = findKeywordEvasions('a$$h0le', ['ass', 'asshole']);
    expect(m).toHaveLength(1);
    expect(m[0]!.keyword).toBe('asshole');
  });

  it('non-overlapping repeats each match', () => {
    expect(hits('fr33 fr33', ['free'])).toEqual(['free', 'free']);
  });

  it('matches never overlap — scanning resumes after each match', () => {
    const m = findKeywordEvasions('fr33 m0n3y fr33', ['free', 'money']);
    expect(m.map((x) => x.keyword)).toEqual(['free', 'money', 'free']);
    for (let i = 1; i < m.length; i += 1) {
      expect(m[i]!.index).toBeGreaterThanOrEqual(m[i - 1]!.index + m[i - 1]!.text.length);
    }
  });
});

describe('the ph digraph trade-off, as designed', () => {
  it('respells f: "phree" and standalone "phish"', () => {
    expect(hits('phree stuff', ['free'])).toEqual(['free']);
    // A caller who lists "fish" accepts that "phish" alone reads as it.
    expect(hits('phish', ['fish'])).toEqual(['fish']);
  });

  it('trailing letters protect embedded ph — a trailing ph does not', () => {
    // "phishing" survives because letters continue past the match; "graph"
    // ends at the digraph, so a caller listing "graf" reads it. The score
    // threshold keeps this confined to single-substitution words a caller
    // explicitly listed.
    expect(hits('phishing attempt', ['fish'])).toEqual([]);
    expect(hits('graph paper', ['graf'])).toEqual(['graf']);
  });
});

describe('contractions and possessives stay safe', () => {
  it.each([
    ["he'll be there", ['hell']],
    ['he’ll be there', ['hell']],
    ["we'll see", ['well']],
    ["can't stop", ['cant']],
    ["it's the user's choice", ['itst', 'users']],
  ])('%s', (text, keywords) => {
    expect(hits(text, keywords)).toEqual([]);
  });
});

describe('keyword hygiene', () => {
  it('normalizes case, trims, and deduplicates', () => {
    const m = findKeywordEvasions('fr33', ['FREE  ', 'free', 'frEE']);
    expect(m).toHaveLength(1);
    expect(m[0]!.keyword).toBe('free');
  });

  it('silently ignores unusable keywords', () => {
    expect(findKeywordEvasions('fr33', [''])).toEqual([]);
    expect(findKeywordEvasions('a$', ['as'])).toEqual([]); // too short
    expect(findKeywordEvasions('fr33 m0ney', ['free money'])).toEqual([
      // the phrase is dropped; nothing else matches "m0ney" here
    ]);
    expect(findKeywordEvasions('привет', ['привет'])).toEqual([]); // non-ASCII keyword
  });

  it('phrase keywords are dropped but plain words in the same list still work', () => {
    expect(hits('fr33 m0ney', ['free money', 'free'])).toEqual(['free']);
  });

  it('handles empty inputs', () => {
    expect(findKeywordEvasions('', ['free'])).toEqual([]);
    expect(findKeywordEvasions('fr33', [])).toEqual([]);
  });
});

describe('clean-corpus regression — zero false positives', () => {
  // The bundled corpus is ordinary chat/marketing prose with digits, prices,
  // times, and product names. An aggressive keyword list over all of it must
  // produce nothing. If a table change breaks this, precision regressed.
  const AGGRESSIVE = [
    'free',
    'crypto',
    'money',
    'ass',
    'asshole',
    'fuck',
    'shit',
    'hell',
    'weed',
    'viagra',
    'porn',
    'sex',
    'scam',
    'win',
    'winner',
    'follow',
    'discount',
    'offer',
    'cash',
    'coin',
    'trade',
    'deal',
    'sale',
    'click',
    'link',
    'sos',
    'pill',
    'drug',
    'bet',
    'loan',
  ];
  const corpus = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sample-corpus.txt'),
    'utf8',
  )
    .trim()
    .split('\n');

  it('a 30-keyword blocklist over the whole corpus: no matches', () => {
    expect(corpus.length).toBeGreaterThan(80);
    for (const line of corpus) {
      expect(findKeywordEvasions(line, AGGRESSIVE), line).toEqual([]);
    }
  });

  it('the prefilter passes almost every clean line', () => {
    const tripped = corpus.filter((line) => prefilter(line));
    // "see you b4 the show starts" trips the digit-adjacency rule — the
    // documented recall-oriented false positive. Anything beyond that little
    // means the gate got noisier.
    expect(tripped).toEqual(['see you b4 the show starts']);
  });
});

describe('prefilter unit behavior', () => {
  it.each([
    ['NUL', '\u0000'],
    ['BEL', '\u0007'],
    ['ESC', '\u001B'],
    ['DEL', '\u007F'],
  ])('control %s trips it', (_name, c) => {
    expect(prefilter(`hello${c}world`)).toBe(true);
  });

  it('TAB, LF, CR are ordinary whitespace', () => {
    expect(prefilter('hello\tworld')).toBe(false);
    expect(prefilter('hello\nworld')).toBe(false);
    expect(prefilter('hello\r\nworld')).toBe(false);
  });

  it.each(['@', '$', '!', '+', '|', '<', '{'])('leet symbol %s against a letter trips it', (c) => {
    expect(prefilter(`a${c}b`)).toBe(true);
    expect(prefilter(`${c}word`)).toBe(true);
  });

  it('digits against letters trip it, digits alone do not', () => {
    expect(prefilter('fr33')).toBe(true);
    expect(prefilter('iphone15')).toBe(true); // documented, acceptable
    expect(prefilter('call 0800 123')).toBe(false);
    expect(prefilter('the total is 40 dollars')).toBe(false);
  });

  it('two isolated single letters are the spaced-word pattern', () => {
    expect(prefilter('f r e e')).toBe(true);
    expect(prefilter('a s s')).toBe(true);
    expect(prefilter('fr e e')).toBe(true);
    expect(prefilter('U.S.A.')).toBe(true); // documented, acceptable
    expect(prefilter('plan b now')).toBe(false); // one single letter is prose
    expect(prefilter('option a or option b')).toBe(false);
  });

  it('any non-ASCII trips it — analyze sorts out which kind', () => {
    expect(prefilter('café')).toBe(true);
    expect(prefilter('Привет')).toBe(true);
    expect(prefilter('f\u200Bree')).toBe(true);
  });
});

describe('prefilter ⊇ matcher, on the devices the gate claims', () => {
  // Property: for evasions built from devices the prefilter documents
  // covering — digit/symbol leet from its own set, non-ASCII substitutes,
  // and separators from its own set — a matcher hit implies gate true.
  // Devices the gate does NOT claim (`(`, `: ; ' " = ^` separators,
  // all-letter devices like ph/stretching) are its documented blind spots:
  // they are asserted red in known-gaps.test.ts, not silently skipped.
  const GATE_LEET = new Set(['@', '$', '!', '+', '|', '<', '{']);
  const GATE_SEPARATORS = [' ', '.', '-', '_', '*', '~', ','];

  it('holds for every in-gate single-character substitution', () => {
    for (const [substitute, letters] of Object.entries(LEET_ALTERNATIVES)) {
      const inGate =
        /[0-9]/.test(substitute) || GATE_LEET.has(substitute) || substitute.charCodeAt(0) >= 0x80;
      if (!inGate) continue;
      for (const letter of letters) {
        const { text, keyword } = embed(letter, substitute);
        const message = `buy ${text} now`;
        if (findKeywordEvasions(message, [keyword]).length > 0) {
          expect(prefilter(message), message).toBe(true);
        }
      }
    }
  });

  it('holds for every in-gate separator splitting a word', () => {
    for (const sep of GATE_SEPARATORS) {
      const message = `get f${sep}r${sep}e${sep}e now`;
      if (findKeywordEvasions(message, ['free']).length > 0) {
        expect(prefilter(message), JSON.stringify(sep)).toBe(true);
      }
    }
  });
});

describe('analyze integration edges', () => {
  it('indices are UTF-16 units even after astral prefixes', () => {
    const r = analyze('🎉🎉 get f-r-3-3 now', { keywords: ['free'] });
    expect(r.words).toEqual([
      { word: 'f-r-3-3', index: 9, signals: ['keyword_evasion'], scripts: [], keyword: 'free' },
    ]);
    expect(r.normalized).toBe('🎉🎉 get free now');
  });

  it('counts every evasion finding as an affected word', () => {
    const r = analyze('get f-r-3-3 and fr33', { keywords: ['free'] });
    expect(r.counts).toEqual({ wordsTotal: 5, wordsAffected: 2 });
    expect(r.normalized).toBe('get free and free');
  });

  it('a styled word carries BOTH findings, and the keyword rewrite wins', () => {
    const r = analyze('Ⓕⓡⓔⓔ stuff', { keywords: ['free'] });
    expect(r.words.map((w) => w.signals)).toEqual([['confusable_word'], ['keyword_evasion']]);
    expect(r.normalized).toBe('free stuff');
  });

  it('empty or unusable keyword lists change nothing', () => {
    expect(analyze('fr33', { keywords: [] }).signals.keyword_evasion).toBe(false);
    expect(analyze('fr33', { keywords: ['xy'] }).signals.keyword_evasion).toBe(false);
  });

  it('keywords compose with expectedScripts', () => {
    const r = analyze('Привет, get fr33', {
      keywords: ['free'],
      expectedScripts: ['Cyrillic'],
    });
    expect(r.signals.keyword_evasion).toBe(true);
    expect(r.signals.confusable_word).toBe(false);
    expect(r.normalized).toBe('Привет, get free');
  });

  it('the normalized-rerun recipe catches what the matcher alone cannot', () => {
    // A single zero-width split scores below the matcher threshold (see
    // known-gaps), but analyze strips it, so matching on `normalized` — the
    // README recipe — still catches it.
    const r = analyze('f\u200Bree stuff', { keywords: ['free'] });
    expect(r.signals.keyword_evasion).toBe(false);
    expect(r.normalized).toBe('free stuff');
    expect(r.normalized.includes('free')).toBe(true);
  });
});

describe('robustness', () => {
  it('a 10k-character message with a 30-keyword list stays fast', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(400) + 'f-r-3-3';
    const keywords = ['free', 'crypto', 'money', 'ass', 'winner', 'offer'];
    const t0 = performance.now();
    const m = findKeywordEvasions(text, keywords);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(m).toHaveLength(1);
    expect(m[0]!.index).toBe(10800);
  });

  it('lone surrogates and odd input do not throw', () => {
    expect(() => findKeywordEvasions('\uD83C fr33 \uDF89', ['free'])).not.toThrow();
    expect(() => prefilter('🎉'.repeat(100))).not.toThrow();
  });
});
