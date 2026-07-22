import { describe, it, expect } from 'vitest';
import {
  analyze,
  confusableLookalikes,
  EVASION_SCORE_THRESHOLD,
  findKeywordEvasions,
  prefilter,
} from '../src';

const KEYWORDS = ['free', 'crypto', 'viagra', 'ass', 'asshole', 'money'];

const hit = (text: string, keywords: readonly string[] = KEYWORDS) =>
  findKeywordEvasions(text, keywords).map((m) => m.keyword);

describe('findKeywordEvasions — leet substitutions', () => {
  it.each([
    ['fr33', 'free'],
    ['fr33!', 'free'],
    ['FR33', 'free'],
    ['fr£€', 'free'],
    ['cryp+0', 'crypto'],
    ['crypt0!', 'crypto'],
    ['v14gr4', 'viagra'],
    ['a$$', 'ass'],
    ['@ss', 'ass'],
    ['45s', 'ass'],
    ['m0n3y', 'money'],
    ['phree', 'free'],
  ])('%s → %s', (word, keyword) => {
    expect(hit(`buy ${word} now`)).toEqual([keyword]);
  });

  it('reads multi-character ASCII art', () => {
    expect(hit('|-|3llo there', ['hello'])).toEqual(['hello']);
    expect(hit('\\/\\/33d for sale', ['weed'])).toEqual(['weed']);
  });

  it('reports the span exactly as written', () => {
    const [m] = findKeywordEvasions('get fr33 now', ['free']);
    expect(m).toEqual({ keyword: 'free', index: 4, text: 'fr33', score: 4 });
  });
});

describe('findKeywordEvasions — separators', () => {
  it.each([
    ['f-r-e-e', 'free'],
    ['f r e e', 'free'],
    ['f.r.e.e', 'free'],
    ['f_r_e_e', 'free'],
    ['f*r*e*e', 'free'],
    ['a s s', 'ass'],
    ['fr e e', 'free'],
    ['m-o-n-e-y', 'money'],
  ])('%s → %s', (spaced, keyword) => {
    expect(hit(`get ${spaced} today`)).toEqual([keyword]);
  });

  it('sees through zero-width characters as separators', () => {
    expect(hit('get f\u200Br\u200Be\u200Be now')).toEqual(['free']);
  });

  it('a single separator is not evasion — hyphenated words are ordinary writing', () => {
    expect(hit('read your e-mail', ['email'])).toEqual([]);
    expect(hit('fr-ee', ['free'])).toEqual([]); // one device, score 1: below threshold
  });

  it('does not bridge gaps longer than the cap', () => {
    expect(hit('f     r     e     e')).toEqual([]);
  });
});

describe('findKeywordEvasions — combined devices', () => {
  it.each([
    ['f-r-3-3', 'free'],
    ['a-$-$', 'ass'],
    ['c r y p t 0', 'crypto'],
    ['v-1-a-g-r-a', 'viagra'],
  ])('%s → %s', (word, keyword) => {
    expect(hit(`${word}`)).toEqual([keyword]);
  });

  it('folds Unicode lookalikes into the match', () => {
    // Cyrillic а + $$: lookalike substitution + leet, one disguised word.
    expect(hit('а$$')).toEqual(['ass']);
    // Fullwidth digits read through the confusable fold, then the leet table.
    expect(hit('fr３３')).toEqual(['free']);
  });

  it('consumes stretched letters', () => {
    expect(hit('fuuuck this', ['fuck'])).toEqual(['fuck']);
    expect(hit('freee stuff')).toEqual([]); // one extra letter: everyday typo
  });
});

describe('findKeywordEvasions — precision guards', () => {
  it('never reports a plain occurrence', () => {
    expect(hit('free money for all')).toEqual([]);
  });

  it('never matches inside a longer word', () => {
    expect(hit('my assistant is great')).toEqual([]);
    expect(hit('classic a$$umption')).toEqual([]); // trailing letters continue the word
  });

  it('does not treat a hyphenated prefix as a boundary', () => {
    expect(hit('cl-ass is in session')).toEqual([]);
  });

  it('rejects matches made only of ASCII substitutions', () => {
    expect(hit('room 505', ['sos'])).toEqual([]);
    expect(hit('gate 455 is closed')).toEqual([]); // no plain letter anchors "ass"
  });

  it('ignores everyday letter-digit words', () => {
    expect(hit('the iphone15 and mp3 and b4 and 24h', ['phone', 'bad'])).toEqual([]);
  });

  it('longest keyword wins at the same start', () => {
    expect(hit('a$$hole')).toEqual(['asshole']);
  });

  it('ignores keywords that cannot be matched safely', () => {
    expect(hit('a$ b3', ['as', 'be'])).toEqual([]); // under three letters
    expect(hit('fr33', ['fr ee'])).toEqual([]); // phrases are not supported
  });

  it('leaves clean multilingual text alone', () => {
    expect(hit('Привет, как дела?')).toEqual([]);
    expect(hit('das ist ein Straße', ['strass'])).toEqual([]);
  });
});

describe('analyze with keywords', () => {
  it('fires the signal, reports the finding, and rewrites the span', () => {
    const r = analyze('get f-r-3-3 crypto', { keywords: ['free'] });
    expect(r.spoofed).toBe(true);
    expect(r.signals.keyword_evasion).toBe(true);
    expect(r.normalized).toBe('get free crypto');
    expect(r.words).toEqual([
      {
        word: 'f-r-3-3',
        index: 4,
        signals: ['keyword_evasion'],
        scripts: [],
        keyword: 'free',
      },
    ]);
  });

  it('keyword rewrite supersedes the invisible-stripping rewrite inside it', () => {
    const r = analyze('get f\u200Br\u200B33 now', { keywords: ['free'] });
    expect(r.signals.keyword_evasion).toBe(true);
    expect(r.normalized).toBe('get free now');
  });

  it('composes with the other signals on unaffected words', () => {
    const r = analyze('НОТ fr33 stuff', { keywords: ['free'] });
    expect(r.signals.confusable_word).toBe(true);
    expect(r.signals.keyword_evasion).toBe(true);
    expect(r.normalized).toBe('HOT free stuff');
  });

  it('without keywords nothing changes', () => {
    const r = analyze('get fr33 now');
    expect(r.signals.keyword_evasion).toBe(false);
    expect(r.normalized).toBe('get fr33 now');
  });
});

describe('prefilter', () => {
  it.each([
    'Hello, how are you today?',
    'The meeting was moved to Thursday.',
    "I'll send the invoice tomorrow morning.",
    'thanks so much, talk soon',
    'Prices start at 40 dollars per month.',
  ])('clean prose passes: %s', (text) => {
    expect(prefilter(text)).toBe(false);
  });

  it.each([
    'get fr33 stuff', // digit against letter
    'a$$ hat', // leet symbol against letter
    'f r e e', // spaced-out letters
    'f-r-e-e', // dashed letters
    'fr e e', // partial split, two isolated singles
    'НОТ deal', // non-ASCII
    'bad\u0007text', // control character
    'f\u200Bree', // zero-width
  ])('suspicious text trips it: %s', (text) => {
    expect(prefilter(text)).toBe(true);
  });

  it('is a superset of what the matcher can match on ASCII traffic', () => {
    const evasions = [
      'fr33',
      'a$$',
      'f-r-e-e',
      'f r e e',
      'a s s',
      'fr e e',
      'cryp+0',
      'v14gr4',
      'm0n3y!',
    ];
    for (const e of evasions) {
      const text = `buy ${e} now`;
      if (findKeywordEvasions(text, KEYWORDS).length > 0) {
        expect(prefilter(text), e).toBe(true);
      }
    }
  });
});

describe('confusableLookalikes', () => {
  it('inverts the confusable table for an ASCII letter', () => {
    const lookalikes = confusableLookalikes('a');
    expect(lookalikes.length).toBeGreaterThan(10);
    expect(lookalikes).toContain('а'); // Cyrillic а
    for (const l of lookalikes) {
      expect(l.codePointAt(0)! >= 0x80).toBe(true);
    }
  });

  it('returns nothing for non-ASCII input — the map is keyed by prototypes', () => {
    expect(confusableLookalikes('\u20AC')).toEqual([]);
  });
});

describe('score threshold constant', () => {
  it('is exported for documentation and tooling', () => {
    expect(EVASION_SCORE_THRESHOLD).toBe(2);
  });
});
