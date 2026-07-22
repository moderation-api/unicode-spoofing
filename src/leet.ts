import { foldChar } from './confusables';

/**
 * ============================================================================
 *  KEYWORD EVASION — leetspeak, separators, and combined tricks
 * ============================================================================
 *
 * Unlike confusables, leetspeak has no safe standalone decoding: `4` is "a" in
 * `g4rbage` but a number in `b4` and `24h`, and collapsing separators turns
 * "f-r-e-e" into "free" but also every hyphenated compound into mush. The only
 * well-posed form of the problem is *matching*: given words a caller actually
 * cares about, decide whether a stretch of text is one of them in disguise.
 * That framing removes the ambiguity — `iphone15` never matches anything, and
 * `fr33` matches only when the caller listed "free".
 *
 * A match must EARN its way in: plain occurrences of a keyword score zero and
 * are never reported (exact matching is the caller's own filter's job). Each
 * obfuscation device carries a weight, and only a total of
 * `EVASION_SCORE_THRESHOLD` or more is a finding. Substitutions (leet glyphs,
 * Unicode lookalikes) weigh 2 — a single one is already deliberate. Separator
 * gaps and letter repetition weigh 1 each — one hyphen or a doubled letter is
 * everyday writing ("e-mail", a typo), but two such devices in one word is a
 * pattern.
 *
 * Design notes, relative to the closest prior art (obscenity, the npm
 * profanity filter): obscenity normalizes the whole text through a
 * transformer pipeline (resolve confusables → resolve leet → lowercase →
 * collapse duplicates) and then pattern-matches the transformed view, which
 * reports plain and disguised occurrences alike and needs a whitelist of
 * benign words ("analog") to hold precision. Matching in place against the
 * original characters instead lets every device be *scored* — this module
 * only exists to report disguise, so an occurrence must prove it is one —
 * and makes whitelists mostly unnecessary: word boundaries, the anchor rule,
 * and the score threshold refuse the embedded-substring and
 * ordinary-hyphenation matches a transform-then-match design has to
 * whitelist away.
 */

/**
 * Single characters that conventionally stand in for a letter. Values are the
 * letters each can play — `1` is both "i" (l33t) and "l" (he11o), and the
 * matcher tries whichever the keyword needs.
 *
 * Deliberately absent: phonetic substitutions (`2 → to`, `4 → for`, `8 → ate`).
 * Those replace syllables, not glyphs; resolving them needs language knowledge
 * and belongs to the trained layer (see training/), not to exact matching.
 */
export const LEET_ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  '0': ['o'],
  '1': ['i', 'l'],
  '2': ['z'],
  '3': ['e'],
  '4': ['a'],
  '5': ['s'],
  '6': ['g', 'b'],
  '7': ['t', 'l'],
  '8': ['b'],
  '9': ['g'],
  '@': ['a'],
  $: ['s'],
  '!': ['i', 'l'],
  '+': ['t'],
  '(': ['c'],
  '<': ['c'],
  '{': ['c'],
  '|': ['i', 'l'],
  '¢': ['c'],
  '£': ['l', 'e'],
  '€': ['e'],
  '¥': ['y'],
  '§': ['s'],
};

/**
 * Multi-character ASCII-art letters, longest first so `|-|` wins over `|`.
 * Only sequences with one conventional reading are listed. `ph` is the lone
 * digraph: it is a deliberate respelling when the target word has "f"
 * ("phree", "phuck"), and the score threshold plus word boundaries keep
 * ordinary "ph" words from matching on their own.
 */
export const LEET_SEQUENCES: ReadonlyArray<readonly [string, string]> = [
  ['\\/\\/', 'w'],
  ['|-|', 'h'],
  ['|\\|', 'n'],
  ['|_|', 'u'],
  ['|<', 'k'],
  ['|(', 'k'],
  ['|)', 'd'],
  ['|>', 'd'],
  ['|3', 'b'],
  ['|=', 'f'],
  ['ph', 'f'],
  ['/\\', 'a'],
  ['\\/', 'v'],
  ['()', 'o'],
  ['[]', 'o'],
  ['><', 'x'],
];

/**
 * Characters an evader can put BETWEEN the letters of a word: whitespace and
 * the ordinary intra-word punctuation people actually type. Invisible (format)
 * characters also separate — `analyze` reports them as their own signal, but
 * the matcher must still see through them ("f<ZWSP>r<ZWSP>ee").
 */
const SEPARATOR_RE = /[\s.\-_*~,:;'"`´·•=^’]|\p{Cf}/u;

/** Longest run of separator characters one gap may span. */
const MAX_GAP = 4;

/** Minimum total obfuscation score for a match to be reported. */
export const EVASION_SCORE_THRESHOLD = 2;

/** Keywords shorter than this carry too little signal to match safely. */
const MIN_KEYWORD_LENGTH = 3;

export interface KeywordEvasionMatch {
  /** The keyword that was evaded, lowercased. */
  keyword: string;
  /** UTF-16 index of the match in the input. */
  index: number;
  /** The matched slice of the input, exactly as it appears. */
  text: string;
  /** Obfuscation score — see EVASION_SCORE_THRESHOLD. */
  score: number;
}

const ASCII_ALNUM_RE = /[a-zA-Z0-9]/;
const WHITESPACE_RE = /\s/;

function isSeparator(ch: string): boolean {
  return SEPARATOR_RE.test(ch);
}

/** One keyword letter consumed at `pos`, or null. */
interface LetterStep {
  /** Index just past the consumed character(s). */
  next: number;
  /** 0 for the letter itself, 2 for any substitution. */
  score: number;
  /**
   * How the letter was read: written plainly, substituted with ASCII leet, or
   * substituted with a non-ASCII lookalike. A match made ENTIRELY of ASCII
   * substitutions is rejected — "505" is a room number, not "sos" — while a
   * non-ASCII lookalike is suspicious on its own, so "а$$" (Cyrillic а) still
   * matches with no plain letter at all.
   */
  kind: 'plain' | 'leet' | 'fold';
}

function matchLetter(text: string, pos: number, letter: string): LetterStep | null {
  for (const [seq, l] of LEET_SEQUENCES) {
    if (l === letter && text.slice(pos, pos + seq.length).toLowerCase() === seq) {
      return { next: pos + seq.length, score: 2, kind: 'leet' };
    }
  }

  const cp = text.codePointAt(pos);
  if (cp === undefined) return null;
  const ch = String.fromCodePoint(cp);

  if (ch.toLowerCase() === letter) return { next: pos + ch.length, score: 0, kind: 'plain' };

  const alts = LEET_ALTERNATIVES[ch];
  if (alts !== undefined && alts.includes(letter)) {
    return { next: pos + ch.length, score: 2, kind: 'leet' };
  }

  // Non-ASCII: fold to the Latin lookalike, then give the fold one shot at
  // the leet table too, so a fullwidth "４" still reads as "a". Styled glyphs
  // the UTS #39 table does not cover (fullwidth digits, math styles resolve
  // via NFKC, same as the styled-confusable path in analyze).
  if (cp >= 0x80) {
    for (const folded of [foldChar(ch), ch.normalize('NFKC')]) {
      if (folded === ch || folded.length !== 1 || folded.charCodeAt(0) >= 0x80) continue;
      if (folded.toLowerCase() === letter) return { next: pos + ch.length, score: 2, kind: 'fold' };
      const foldedAlts = LEET_ALTERNATIVES[folded];
      if (foldedAlts !== undefined && foldedAlts.includes(letter)) {
        return { next: pos + ch.length, score: 2, kind: 'fold' };
      }
    }
  }

  return null;
}

/**
 * Attempt to match one keyword starting at `start`. Returns the end index and
 * score, or null. Repeated letters ("fuuuck") are consumed unless the next
 * keyword letter is the same letter — "free" needs its second "e".
 */
function matchKeywordAt(
  text: string,
  start: number,
  keyword: string,
): { end: number; score: number } | null {
  let pos = start;
  let score = 0;
  let anchored = false; // saw a plain letter or a non-ASCII lookalike

  for (let ki = 0; ki < keyword.length; ki += 1) {
    const letter = keyword[ki]!;

    if (ki > 0) {
      // A gap of separators between letters. A run longer than MAX_GAP is not
      // a gap inside a word — it is the space between different things.
      let gapEnd = pos;
      let gapLen = 0;
      while (gapEnd < text.length && gapLen <= MAX_GAP) {
        const ch = String.fromCodePoint(text.codePointAt(gapEnd)!);
        if (!isSeparator(ch)) break;
        gapEnd += ch.length;
        gapLen += 1;
      }
      if (gapLen > MAX_GAP) return null;
      if (gapEnd > pos) {
        score += 1;
        pos = gapEnd;
      }
    }

    const step = matchLetter(text, pos, letter);
    if (step === null) return null;
    score += step.score;
    if (step.kind !== 'leet') anchored = true;

    let end = step.next;
    if (keyword[ki + 1] !== letter) {
      for (;;) {
        const rep = matchLetter(text, end, letter);
        if (rep === null) break;
        end = rep.next;
        score += 1;
      }
    }
    pos = end;
  }

  if (!anchored) return null;
  return { end: pos, score };
}

/**
 * The boundary rule. A match may not butt directly against a letter or digit
 * ("assistant" does not contain "ass"), and may not hide behind a non-space
 * separator that itself follows a letter — "cl-ass" is a hyphenated word, not
 * "ass" with a prefix. Whitespace and ordinary punctuation are true
 * boundaries and end the walk.
 *
 * `index` is the position just outside the match: the last code unit before it
 * (direction -1) or the first one after it (direction 1).
 */
function boundaryOk(text: string, index: number, direction: -1 | 1): boolean {
  let i = index;
  while (i >= 0 && i < text.length) {
    if (direction === -1) {
      // Step back over a low surrogate so an astral neighbour reads whole.
      const unit = text.charCodeAt(i);
      if (unit >= 0xdc00 && unit <= 0xdfff && i > 0) i -= 1;
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    if (ASCII_ALNUM_RE.test(ch)) return false;
    if (WHITESPACE_RE.test(ch)) return true;
    if (!isSeparator(ch)) return true;
    i = direction === -1 ? i - 1 : i + ch.length;
  }
  return true; // string edge
}

/**
 * Scan `text` for disguised occurrences of `keywords`.
 *
 * Keywords are lowercased and must be at least three ASCII letters; anything
 * else is ignored. Matches are non-overlapping, leftmost-first; at the same
 * position the longest keyword wins. Plain, unobfuscated occurrences are
 * never reported — see the score threshold above.
 *
 * Cost is linear in the text for realistic keyword lists: at each position a
 * keyword is attempted only if its FIRST letter is readable there (memoized
 * per position), so a hundreds-strong blocklist costs at most one
 * `matchLetter` probe per distinct first letter per position, and full
 * matching runs only where something is actually starting.
 */
export function findKeywordEvasions(
  text: string,
  keywords: readonly string[],
): KeywordEvasionMatch[] {
  // Longest first so "asshole" beats "ass" at the same start.
  const cleaned = [...new Set(keywords.map((k) => k.toLowerCase().trim()))]
    .filter((k) => k.length >= MIN_KEYWORD_LENGTH && /^[a-z]+$/.test(k))
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return [];

  const matches: KeywordEvasionMatch[] = [];
  const firstLetterOk = new Map<string, boolean>();
  let i = 0;
  while (i < text.length) {
    let advanced = false;
    firstLetterOk.clear();
    for (const keyword of cleaned) {
      const first = keyword[0]!;
      let ok = firstLetterOk.get(first);
      if (ok === undefined) {
        ok = matchLetter(text, i, first) !== null;
        firstLetterOk.set(first, ok);
      }
      if (!ok) continue;
      const m = matchKeywordAt(text, i, keyword);
      if (m === null || m.score < EVASION_SCORE_THRESHOLD) continue;
      if (!boundaryOk(text, i - 1, -1) || !boundaryOk(text, m.end, 1)) continue;
      matches.push({ keyword, index: i, text: text.slice(i, m.end), score: m.score });
      i = m.end;
      advanced = true;
      break;
    }
    if (!advanced) i += text.codePointAt(i)! > 0xffff ? 2 : 1;
  }
  return matches;
}

/**
 * ============================================================================
 *  PREFILTER — the gate in front of everything else
 * ============================================================================
 *
 * One linear pass, character classes only, no tables. Returns false for the
 * overwhelming share of real traffic — plain ASCII prose with no letter/digit
 * mixing and no spaced-out letters — so callers can skip `analyze`, keyword
 * matching, and any ML layer entirely. A true is a routing decision, not a
 * verdict: the prefilter is recall-oriented by design and false-positives
 * freely ("U.S.A.", "iphone15"), because the only cost of a wrong true is
 * running the real analysis on that message.
 *
 * What trips it:
 *  - any non-ASCII code point (confusables, invisibles, native scripts — the
 *    full `analyze` sorts out which),
 *  - any C0/C1 control other than TAB/LF/CR,
 *  - a digit or leet symbol directly touching an ASCII letter ("fr33", "a$$"),
 *  - two or more isolated single letters near short separator gaps
 *    ("f-r-e-e", "f r e e", "a s s", "fr e e").
 *
 * Known blind spots, accepted for cheapness and documented so callers can
 * decide: a word with EVERY letter substituted and none left ("4$$") shows the
 * gate only symbols, and a word split into multi-letter chunks ("fre ed om")
 * shows it only ordinary short words. Callers whose threat model includes
 * those should run `findKeywordEvasions` unconditionally — it is itself cheap.
 */
export function prefilter(text: string): boolean {
  const OTHER = 0;
  const LETTER = 1;
  const DIGIT = 2;
  const LEET = 3;
  const SEP = 4;

  let prev = OTHER;
  let groupSize = 0; // letters in the letter-group ending at the previous char
  let sepRun = 0; // consecutive separators ending at the previous char
  let sepBeforeGroup = 0; // length of the separator run before that group
  let singles = 0; // recent letter-groups of size 1 touching a short gap

  for (let i = 0; i <= text.length; i += 1) {
    // One virtual past-the-end character closes the final letter-group.
    const cp = i < text.length ? text.charCodeAt(i) : 0x20;
    if (cp >= 0x80) return true;
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return true;
    if (cp === 0x7f) return true;

    let cls = OTHER;
    if ((cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a)) cls = LETTER;
    else if (cp >= 0x30 && cp <= 0x39) cls = DIGIT;
    else if (
      cp === 0x40 || // @
      cp === 0x24 || // $
      cp === 0x21 || // !
      cp === 0x2b || // +
      cp === 0x7c || // |
      cp === 0x3c || // <
      cp === 0x7b // {
    ) {
      cls = LEET;
    } else if (
      cp === 0x20 ||
      cp === 0x09 ||
      cp === 0x2e || // .
      cp === 0x2d || // -
      cp === 0x5f || // _
      cp === 0x2a || // *
      cp === 0x7e || // ~
      cp === 0x2c // ,
    ) {
      cls = SEP;
    }

    // Leet suspicion: digit or symbol directly against a letter, either order.
    if (
      (cls === LETTER && (prev === DIGIT || prev === LEET)) ||
      ((cls === DIGIT || cls === LEET) && prev === LETTER)
    ) {
      return true;
    }

    if (cls === LETTER) {
      if (groupSize === 0) sepBeforeGroup = sepRun;
      groupSize += 1;
      sepRun = 0;
    } else {
      // A letter-group just closed. An isolated single letter — alone between
      // short gaps (or a string edge) — is one unit of the spaced-out-word
      // pattern; two units is the pattern. A multi-letter group is ordinary
      // prose and resets the count.
      if (groupSize === 1) {
        // "Short" must mean the same thing here as MAX_GAP does in the
        // matcher — "f - r - e - e" carries three-character gaps, and a gate
        // stricter than the matcher would drop real matches on the floor.
        const shortGapBefore = sepBeforeGroup >= 1 && sepBeforeGroup <= 4;
        const shortGapAfter = cls === SEP;
        if (shortGapBefore || shortGapAfter) {
          singles += 1;
          if (singles >= 2) return true;
        }
      } else if (groupSize > 1) {
        singles = 0;
      }
      groupSize = 0;

      if (cls === SEP) {
        sepRun += 1;
        if (sepRun > 4) singles = 0; // long gap — spacing, not a split word
      } else {
        sepRun = 0;
        if (cls === OTHER) singles = 0;
      }
    }

    prev = cls;
  }
  return false;
}
