import { foldChar, skeleton } from './confusables';
import { isRestrictedIdentifierChar } from './identifier-status';
import { findKeywordEvasions } from './leet';
import { analyzeWordScripts, primaryScript, type PseudoScript, type ScriptName } from './scripts';
import {
  SPOOFING_SIGNALS,
  type AnalysisResult,
  type AnalyzeOptions,
  type SpoofSignal,
  type WordFinding,
} from './types';

/**
 * Tokens are runs of letters, marks, digits, format (invisible) characters,
 * and apostrophes. Punctuation and emoji sit between tokens, which keeps
 * emoji ZWJ sequences out of word analysis entirely.
 */
const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;

/** A single character of the token class above — used to find styled glyphs
 * (circled/parenthesized letters, category So) that fall OUTSIDE any token. */
const TOKEN_CHAR_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]/u;

const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const FORMAT_RE = /\p{Cf}/u;
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/;
const ASCII_LETTER_RE = /[a-zA-Z]/;

/**
 * TOKEN_RE deliberately keeps U+2019 inside words so contractions tokenize
 * whole. That one character is enough to make an otherwise plain-ASCII word
 * non-ASCII — and its skeleton folds straight back to "'", so "I’ll" would
 * read as an ASCII word in disguise. Judge a token's ASCII-ness against its
 * straight-apostrophe form so ordinary typographic punctuation is not evidence.
 */
const TYPOGRAPHIC_APOSTROPHE_RE = /’/g;
function isAsciiWord(token: string): boolean {
  return ASCII_PRINTABLE_RE.test(token.replace(TYPOGRAPHIC_APOSTROPHE_RE, "'"));
}

/**
 * Characters adjacent to which an invisible run is legitimate: emoji and other
 * symbols build their sequences out of ZWJ, variation selectors and tag
 * characters, and enclosing marks build keycaps. Used only by the standalone
 * pass, where an invisible character has no word to belong to.
 */
const SEQUENCE_NEIGHBOUR_RE = /[\p{Extended_Pictographic}\p{Me}\p{Regional_Indicator}]/u;

/**
 * Blank glyphs: they occupy space but draw nothing, and — unlike the Unicode
 * whitespace family (U+00A0, U+2000..U+200A, U+3000 …) — they are not
 * whitespace, so no downstream `\s` normalization or word split touches them.
 * That makes them a way to break a word ("fr<filler>ee") while it still reads
 * normally. The Hangul fillers are category Lo, so without this set they enter
 * words as Hangul letters and misreport as `mixed_script`.
 */
const BLANK_CHARS = new Set([
  0x115f, // HANGUL CHOSEONG FILLER
  0x1160, // HANGUL JUNGSEONG FILLER
  0x3164, // HANGUL FILLER
  0xffa0, // HALFWIDTH HANGUL FILLER
  0x2800, // BRAILLE PATTERN BLANK
  0x1d159, // MUSICAL SYMBOL NULL NOTEHEAD
]);

/**
 * Combining marks that render as nothing. They are category Mn rather than Cf,
 * so the format-character rule misses them. Each is legitimate inside its own
 * script (Khmer, Kaithi) — which the `scriptExempt` check below preserves — and
 * pure obfuscation inside a Latin word.
 */
const INVISIBLE_MARKS = new Set([
  0x034f, // COMBINING GRAPHEME JOINER
  0x17b4, // KHMER VOWEL INHERENT AQ
  0x17b5, // KHMER VOWEL INHERENT AA
  0x110b1, // KAITHI VOWEL SIGN I
]);

/** Variation selectors, incl. the Mongolian free variation selectors. */
function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x180b && cp <= 0x180d);
}

/**
 * Scripts whose letters legitimately take a variation selector: ideographic
 * variation sequences (Han and the Japanese kana that mix with it) and the
 * Mongolian free variation selectors. A selector on a letter of any OTHER
 * script has no registered sequence — it renders as nothing and is a payload
 * channel ("ASCII smuggling"). Selectors on symbols (❤️, keycaps, ™️) are not
 * covered here at all: they never sit in a word.
 */
const VARIATION_BASE_SCRIPTS = new Set<ScriptName | PseudoScript>([
  'Han',
  'Hiragana',
  'Katakana',
  'Mongolian',
]);

/** A handful of characters are letters AND emoji — U+2139 "ℹ" is the common
 * one — so they take the emoji presentation selector legitimately. */
const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;

/** Renders as nothing, in any context. Variation selectors are contextual and
 * are judged separately, against the base character they follow. */
function isInvisibleChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return FORMAT_RE.test(ch) || BLANK_CHARS.has(cp) || INVISIBLE_MARKS.has(cp);
}

/**
 * Scripts in which format characters (ZWJ/ZWNJ/ZWSP…) or stacked combining
 * marks are part of normal orthography. Tokens whose letters touch these
 * scripts are exempt from the invisible and zalgo signals.
 */
export const FORMAT_CHAR_SCRIPTS: readonly ScriptName[] = [
  'Arabic',
  'Syriac',
  'Nko',
  'Mongolian',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Myanmar',
  'Khmer',
  'Tibetan',
  'Hebrew',
  'Kaithi',
];

const FORMAT_CHAR_SCRIPT_SET = new Set<ScriptName>(FORMAT_CHAR_SCRIPTS);

/**
 * Zero-width AND non-reordering: these render as nothing and move nothing.
 * Deliberately excludes the other invisibles, which stay reportable wherever
 * they sit — bidi controls reorder the line (Trojan Source), tag characters
 * carry a payload (ASCII smuggling), and blank glyphs occupy space, so none of
 * them are inert just because a space is next to them.
 */
const ZERO_WIDTH_CHARS = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE
]);

/**
 * Longest run of zero-width characters still treated as inert when it is
 * isolated in whitespace. Each position in a run carries at least a bit, so a
 * long run encodes a payload wherever it sits and is always reported.
 */
export const ZERO_WIDTH_INERT_RUN = 4;

/**
 * Marks zero-width runs that touch no text at all: whitespace (or a string
 * boundary) on BOTH sides. Such a run splits no word and joins no token — it
 * sits in a gap that already exists, so it changes neither what the text
 * renders as nor how it tokenizes, and reporting it is noise.
 *
 * Requiring both sides is the whole safety of the rule. A run touching text on
 * ONE side is still doing work: "admin<ZWSP>" renders as "admin" but compares
 * unequal to it, and "<ZWSP>Valencia" glues to the front of a token the same
 * way — both evade exact matching without splitting anything. Only complete
 * isolation makes a zero-width run inert.
 *
 * Computed over the whole text because the judgement needs both neighbours,
 * which neither the per-token nor the standalone pass can see on its own.
 */
function inertZeroWidthMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  for (let i = 0; i < text.length;) {
    if (!ZERO_WIDTH_CHARS.has(text.charCodeAt(i))) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < text.length && ZERO_WIDTH_CHARS.has(text.charCodeAt(end))) end += 1;
    // A string boundary counts as whitespace: there is no text on that side.
    const isolated =
      (i === 0 || /\s/.test(text[i - 1]!)) && (end === text.length || /\s/.test(text[end]!));
    if (isolated && end - i <= ZERO_WIDTH_INERT_RUN) mask.fill(1, i, end);
    i = end;
  }
  return mask;
}

/** Combining marks stacked deeper than this on one base = zalgo. */
export const ZALGO_MARK_RUN = 3;

/**
 * Code points that have no business appearing in ordinary text and that the
 * token scanner would otherwise silently drop (they are not letters, marks,
 * numbers or format characters, so they never enter a word): C0/C1 controls,
 * DEL and Unicode non-characters. TAB, LF and CR are the only C0 controls
 * treated as legitimate whitespace.
 *
 * U+FFFD is NOT here — see `isEncodingDamage`.
 */
function isIllegalCodePoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // TAB, LF, CR
  if (cp < 0x20) return true; // C0 controls
  if (cp >= 0x7f && cp <= 0x9f) return true; // DEL + C1 controls
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // non-characters (BMP block)
  if ((cp & 0xfffe) === 0xfffe) return true; // U+xxFFFE / U+xxFFFF in every plane
  return false;
}

/**
 * U+FFFD REPLACEMENT CHARACTER: a decoder emitted this because bytes it was
 * handed were not valid in the encoding it assumed — "José" arriving as
 * "Jos��". It reports a broken pipeline upstream, never intent:
 * whatever the original bytes were, they are gone by the time this character
 * exists, so no payload survives inside it for an attacker to exploit. That is
 * what makes it safe to report without calling the text spoofed, and it is why
 * this is a separate signal rather than an exemption inside `illegal`.
 *
 * It is also left in place by the normalizer. Stripping it would silently
 * repair a corrupted message into one that reads as intact.
 */
function isEncodingDamage(cp: number): boolean {
  return cp === 0xfffd;
}

/**
 * The whole character ending at `i` — stepping back over a surrogate pair so an
 * astral neighbour (an emoji, typically) reads as itself and not as half of one.
 */
function charBefore(text: string, i: number): string {
  const unit = text.charCodeAt(i - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && i >= 2) return text.slice(i - 2, i);
  return text[i - 1]!;
}

function emptySignals(): Record<SpoofSignal, boolean> {
  return {
    mixed_script: false,
    confusable_word: false,
    keyword_evasion: false,
    invisible: false,
    zalgo: false,
    illegal: false,
    encoding_damage: false,
  };
}

interface TokenAnalysis {
  signals: SpoofSignal[];
  scripts: ScriptName[];
  skeleton?: string;
  normalized: string;
}

function analyzeToken(
  token: string,
  dominantScript: ScriptName | null,
  anyMixedInMessage: boolean,
  expectedScripts: Set<ScriptName>,
  inertMask: Uint8Array,
  tokenStart: number,
): TokenAnalysis {
  const chars = [...token];
  // Aligned with `chars`, so the inert judgement — made over the whole text —
  // is readable per code point here. Stepping by `ch.length` keeps astral
  // characters from shifting the mapping into the UTF-16 mask.
  const inertAt: boolean[] = [];
  {
    let offset = tokenStart;
    for (const ch of chars) {
      inertAt.push(inertMask[offset] === 1);
      offset += ch.length;
    }
  }
  // Blank glyphs are excluded before script analysis: a Hangul filler is a
  // Hangul *letter* to the property tables, and counting it as one would report
  // "fr<filler>ee" as a Latin/Hangul mix rather than as a hidden character.
  const letters = chars.filter((ch) => LETTER_RE.test(ch) && !isInvisibleChar(ch));
  const signals: SpoofSignal[] = [];

  // Letterless tokens (numbers, stray format characters between emoji) carry
  // no spoofing evidence — analyzing them only produces noise like flagging
  // the ZWJs inside an emoji family sequence.
  if (letters.length === 0) {
    return { signals, scripts: [], normalized: token };
  }

  const { scripts, mixed } = analyzeWordScripts(letters);
  const scriptExempt = scripts.some((s) => FORMAT_CHAR_SCRIPT_SET.has(s));

  // invisible: characters that render as nothing inside a word of a script that
  // does not use them — format characters, blank glyphs, invisible marks, and
  // variation selectors sitting on a base with no registered sequence.
  const strayVariation = new Set<number>();
  for (let i = 0; i < chars.length; i += 1) {
    const cp = chars[i]!.codePointAt(0)!;
    if (!isVariationSelector(cp)) continue;
    // The base is the last character that is not itself a selector.
    let base: string | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!isVariationSelector(chars[j]!.codePointAt(0)!)) {
        base = chars[j];
        break;
      }
    }
    if (base === undefined || !LETTER_RE.test(base) || PICTOGRAPHIC_RE.test(base)) continue;
    if (!VARIATION_BASE_SCRIPTS.has(primaryScript(base))) strayVariation.add(i);
  }
  const hasInvisible =
    chars.some((ch, i) => isInvisibleChar(ch) && !inertAt[i]) || strayVariation.size > 0;
  if (hasInvisible && !scriptExempt) signals.push('invisible');

  // zalgo: combining marks stacked beyond orthographic depth.
  let markRun = 0;
  let maxMarkRun = 0;
  for (const ch of chars) {
    markRun = MARK_RE.test(ch) ? markRun + 1 : 0;
    if (markRun > maxMarkRun) maxMarkRun = markRun;
  }
  const zalgo = maxMarkRun >= ZALGO_MARK_RUN && !scriptExempt;
  if (zalgo) signals.push('zalgo');

  if (mixed) signals.push('mixed_script');

  // confusable_word (cross-script): a whole word written as lookalikes of
  // Latin — e.g. all-Cyrillic "НОТ" whose skeleton is "HOT". Requires:
  //  - at least two letters (single letters are too ambiguous),
  //  - the word itself is not plain ASCII,
  //  - its UTS #39 skeleton IS plain ASCII with at least one letter,
  //  - it is not written in a script the caller expects, and
  //  - either the context suggests Latin content (message is Latin-dominant,
  //    other words already mix scripts, or the word's own script is Latin), or
  //    the caller declared the scripts they expect and this word is entirely
  //    OUTSIDE them — a whole word in an unexpected script is spoof evidence
  //    on its own, no Latin context needed.
  //
  // A word already written in Latin is the exception, and needs one more test.
  // Cross-script evidence does not exist there — nothing is impersonating Latin
  // because the word IS Latin — so all that remains is whether its skeleton
  // happens to reach ASCII. That fires on ordinary European orthography:
  // "Ægir" folds to "AEgir" and "ısıtır" to "isitir", both perfectly normal
  // words. Worse, it does so arbitrarily — "æ" is a ligature so UTS #39
  // dissolves it to "ae", while "ø" keeps its stroke as a combining mark and
  // never reaches ASCII, so "Ægir" was reported and "Ålborg" was not.
  //
  // Identifier_Status draws the line Unicode intends for exactly this question:
  // "æ ø å ß þ œ ı" are Allowed (letters of living alphabets), while "ɑ" (IPA
  // alpha) and "ﬁ" (a compatibility ligature) are Restricted. Requiring a
  // Restricted character keeps intra-Latin homoglyphs like "pɑypal" — which no
  // script check can catch — without indicting every Danish surname.
  let skeletonConfusable = false;
  if (!mixed && letters.length >= 2 && !isAsciiWord(token)) {
    const inExpectedScript = scripts.length > 0 && scripts.every((s) => expectedScripts.has(s));
    const latinContext =
      dominantScript === 'Latin' ||
      anyMixedInMessage ||
      (scripts.length > 0 && scripts.every((s) => s === 'Latin'));
    const outsideExpected =
      expectedScripts.size > 0 &&
      scripts.length > 0 &&
      scripts.every((s) => !expectedScripts.has(s));
    // Script-neutral characters (the ʻokina, digits) carry no script evidence
    // either way, so a word of Latin + Common letters is still a Latin word.
    const writtenInLatin = letters.every((ch) => {
      const s = primaryScript(ch);
      return s === 'Latin' || s === 'Common' || s === 'Inherited' || s === 'Unknown';
    });
    const carriesRestricted = chars.some((ch) => isRestrictedIdentifierChar(ch));
    if (
      !inExpectedScript &&
      (latinContext || outsideExpected) &&
      (!writtenInLatin || carriesRestricted)
    ) {
      const sk = skeleton(token);
      if (ASCII_PRINTABLE_RE.test(sk) && ASCII_LETTER_RE.test(sk)) {
        signals.push('confusable_word');
        skeletonConfusable = true;
      }
    }
  }

  // confusable_word (compatibility styling): a word spelled in a pseudo-script
  // presentation form — fullwidth "ａｄｍｉｎ", circled "Ⓐⓓⓜⓘⓝ", math-alphanumeric
  // "𝗉𝗋𝖾𝗆𝗂𝗎𝗆" — that NFKC folds straight to an ASCII word. Unlike genuine
  // scripts this is never legitimate orthography, so it is not gated by script
  // context or expectedScripts. Requiring at least two styled LETTERS keeps
  // isolated compatibility symbols used in real text (m², №, ½, ℃, Ⅳ) out.
  let styledConfusable = false;
  if (!mixed && letters.length >= 2 && !isAsciiWord(token)) {
    const styledLetters = letters.filter((ch) => {
      const nf = ch.normalize('NFKC');
      return nf !== ch && ASCII_PRINTABLE_RE.test(nf) && ASCII_LETTER_RE.test(nf);
    });
    if (styledLetters.length >= 2) {
      const fold = token.normalize('NFKC');
      if (fold !== token && ASCII_PRINTABLE_RE.test(fold) && ASCII_LETTER_RE.test(fold)) {
        styledConfusable = true;
        if (!signals.includes('confusable_word')) signals.push('confusable_word');
      }
    }
  }

  // De-obfuscate affected tokens only. Order matters: drop invisibles and
  // zalgo marks first, then fold lookalikes. A word that is ONLY styled folds
  // via NFKC (fullwidth/circled/math → ASCII); cross-script confusables fold
  // via the skeleton map. Using NFKC for math styles resolves the real word
  // rather than the per-glyph skeleton (e.g. "premium", not "prerniurn").
  let normalized = token;
  if (signals.length > 0) {
    const foldLookalikes = signals.includes('mixed_script') || skeletonConfusable;
    const nfkcFold = styledConfusable && !foldLookalikes;
    const dropInvisible = signals.includes('invisible');
    normalized = chars
      .map((ch, i) => {
        // Inert characters survive: they were not evidence, so removing them
        // would edit the message without cause.
        if (dropInvisible && ((isInvisibleChar(ch) && !inertAt[i]) || strayVariation.has(i)))
          return '';
        if (zalgo && MARK_RE.test(ch)) return '';
        if (nfkcFold) return ch;
        return foldLookalikes ? foldChar(ch) : ch;
      })
      .join('');
    if (nfkcFold) normalized = normalized.normalize('NFKC');
    normalized = normalized.normalize('NFC');
  }

  let resolvedSkeleton: string | undefined;
  if (signals.includes('mixed_script') || skeletonConfusable) resolvedSkeleton = skeleton(token);
  else if (styledConfusable) resolvedSkeleton = token.normalize('NFKC').normalize('NFC');

  return {
    signals,
    scripts,
    skeleton: resolvedSkeleton,
    normalized,
  };
}

export function analyze(text: string, options: AnalyzeOptions = {}): AnalysisResult {
  const expectedScripts = new Set(options.expectedScripts ?? []);
  const tokens = [...text.matchAll(TOKEN_RE)];

  // Dominant script: most frequent primary script across all letters.
  const scriptCounts = new Map<ScriptName, number>();
  for (const ch of text) {
    if (!LETTER_RE.test(ch) || isInvisibleChar(ch)) continue;
    const s = primaryScript(ch);
    if (s === 'Common' || s === 'Inherited' || s === 'Unknown') continue;
    scriptCounts.set(s, (scriptCounts.get(s) ?? 0) + 1);
  }
  let dominantScript: ScriptName | null = null;
  let dominantCount = 0;
  for (const [s, count] of scriptCounts) {
    if (count > dominantCount) {
      dominantScript = s;
      dominantCount = count;
    }
  }

  // First pass establishes whether any word mixes scripts — evasion context
  // that lets whole-word confusables flag even when lookalikes outnumber
  // genuine Latin letters (as in heavily obfuscated messages).
  const anyMixedInMessage = tokens.some(
    (t) => analyzeWordScripts([...t[0]].filter((ch) => LETTER_RE.test(ch))).mixed,
  );

  const signals = emptySignals();
  const words: WordFinding[] = [];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const inertMask = inertZeroWidthMask(text);

  for (const match of tokens) {
    const token = match[0];
    const result = analyzeToken(
      token,
      dominantScript,
      anyMixedInMessage,
      expectedScripts,
      inertMask,
      match.index,
    );
    if (result.signals.length === 0) continue;

    for (const s of result.signals) signals[s] = true;
    words.push({
      word: token,
      index: match.index,
      signals: result.signals,
      scripts: result.scripts,
      ...(result.skeleton !== undefined && { skeleton: result.skeleton }),
    });
    if (result.normalized !== token) {
      replacements.push({
        start: match.index,
        end: match.index + token.length,
        value: result.normalized,
      });
    }
  }

  // Invisible characters that belong to no word: between punctuation, between
  // spaces, or attached to a symbol. The per-token pass above cannot see them —
  // a lone format character forms a token of its own with no letters in it, and
  // a blank glyph is not a token character at all. This is what hides the two
  // isolates in a Trojan Source line ("user<RLO> <LRI>// admin").
  {
    // Positions covered by a word the token pass already judged; invisibles
    // inside one are that word's business. A mask keeps this pass linear.
    const wordMask = new Uint8Array(text.length);
    for (const t of tokens) {
      if (!LETTER_RE.test(t[0])) continue;
      wordMask.fill(1, t.index, t.index + t[0].length);
    }
    const inWord = (i: number) => wordMask[i] === 1;

    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      const ch = String.fromCodePoint(cp);
      if (!(isInvisibleChar(ch) || isVariationSelector(cp)) || inWord(i) || inertMask[i] === 1) {
        i += width;
        continue;
      }

      // Extend over the whole invisible run so a payload reports as one finding.
      let end = i + width;
      while (end < text.length) {
        const next = text.codePointAt(end)!;
        const nextCh = String.fromCodePoint(next);
        if (!(isInvisibleChar(nextCh) || isVariationSelector(next)) || inWord(end)) break;
        if (inertMask[end] === 1) break;
        end += next > 0xffff ? 2 : 1;
      }

      // A run touching a symbol is part of a sequence, not a payload: emoji ZWJ
      // sequences, the England-flag tag sequence, ❤️, and keycaps all look like
      // this. Only runs with no symbol on either side are reported.
      const before = i > 0 ? charBefore(text, i) : '';
      const after = end < text.length ? String.fromCodePoint(text.codePointAt(end)!) : '';
      const inSequence =
        (before !== '' && SEQUENCE_NEIGHBOUR_RE.test(before)) ||
        (after !== '' && SEQUENCE_NEIGHBOUR_RE.test(after));
      if (!inSequence) {
        signals.invisible = true;
        words.push({
          word: text.slice(i, end),
          index: i,
          signals: ['invisible'],
          scripts: [],
        });
        replacements.push({ start: i, end, value: '' });
      }
      i = end;
    }
  }

  // Illegal code points live *between* tokens (the token scanner drops them),
  // so they are found in a separate pass over the raw text. Each becomes its
  // own finding and is stripped from the normalized output.
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isIllegalCodePoint(cp)) {
      const char = String.fromCodePoint(cp);
      signals.illegal = true;
      words.push({ word: char, index: i, signals: ['illegal'], scripts: [] });
      replacements.push({ start: i, end: i + width, value: '' });
    }
    i += width;
  }

  // Decode damage. A run reports as ONE finding: a single destroyed character
  // usually yields several U+FFFDs (a two-byte "é" becomes two), and per-code-
  // point findings would overstate how much of the text is broken. Nothing is
  // replaced — see `isEncodingDamage`.
  for (let i = 0; i < text.length; i += 1) {
    if (!isEncodingDamage(text.charCodeAt(i))) continue;
    let end = i + 1;
    while (end < text.length && isEncodingDamage(text.charCodeAt(end))) end += 1;
    signals.encoding_damage = true;
    words.push({ word: text.slice(i, end), index: i, signals: ['encoding_damage'], scripts: [] });
    i = end - 1;
  }

  // Compatibility-styled letter runs the token scanner skips because the glyphs
  // are symbols, not letters (category So): circled "Ⓐⓓⓜⓘⓝ", parenthesized,
  // squared. A run of >=2 such glyphs whose NFKC form is an ASCII word is the
  // same disguised-word attack as fullwidth/math styling (which tokenize and are
  // handled per-token).
  {
    let runStart = -1;
    let runCount = 0;
    const flush = (end: number) => {
      if (runStart >= 0 && runCount >= 2) {
        const fold = text.slice(runStart, end).normalize('NFKC').normalize('NFC');
        // Belt-and-braces: every character in the run already passed these two
        // tests individually, so the concatenation cannot fail them.
        if (ASCII_PRINTABLE_RE.test(fold) && ASCII_LETTER_RE.test(fold)) {
          signals.confusable_word = true;
          words.push({
            word: text.slice(runStart, end),
            index: runStart,
            signals: ['confusable_word'],
            scripts: [],
            skeleton: fold,
          });
          replacements.push({ start: runStart, end, value: fold });
        }
      }
      runStart = -1;
      runCount = 0;
    };
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      const ch = String.fromCodePoint(cp);
      const nf = ch.normalize('NFKC');
      // Styled DIGITS (①②③ -> 123) fail ASCII_LETTER_RE and so never join a
      // run, keeping legitimate enclosed numbering out.
      const styledLetter =
        !TOKEN_CHAR_RE.test(ch) &&
        nf !== ch &&
        ASCII_LETTER_RE.test(nf) &&
        ASCII_PRINTABLE_RE.test(nf);
      if (styledLetter) {
        if (runStart < 0) runStart = i;
        runCount += 1;
      } else {
        flush(i);
      }
      i += width;
    }
    flush(text.length);
  }

  // Disguised keywords, when the caller supplied any. This pass sees the raw
  // text — not tokens — because a split word ("f-r-e-e") spans several tokens
  // and a leet word ("fr33") is letters-plus-digits that the per-token signals
  // have no opinion on. A match's rewrite replaces the whole matched span with
  // the plain keyword, superseding any smaller rewrite inside it (stripping a
  // ZWSP out of "f<ZWSP>r33" matters less than resolving it to "free"). A match
  // that only PARTIALLY overlaps another rewrite forfeits its rewrite —
  // stitching two half-overlapping edits would corrupt the output — but keeps
  // its finding.
  if (options.keywords !== undefined && options.keywords.length > 0) {
    const evasions = findKeywordEvasions(text, options.keywords);
    if (evasions.length > 0) {
      signals.keyword_evasion = true;
      const spans = evasions.map((m) => ({ start: m.index, end: m.index + m.text.length }));
      for (const m of evasions) {
        words.push({
          word: m.text,
          index: m.index,
          signals: ['keyword_evasion'],
          scripts: [],
          keyword: m.keyword,
        });
      }
      const kept = replacements.filter(
        (r) => !spans.some((s) => r.start >= s.start && r.end <= s.end),
      );
      replacements.length = 0;
      replacements.push(...kept);
      for (let k = 0; k < evasions.length; k += 1) {
        const s = spans[k]!;
        const collides = replacements.some((r) => r.start < s.end && r.end > s.start);
        if (!collides)
          replacements.push({ start: s.start, end: s.end, value: evasions[k]!.keyword });
      }
    }
  }

  // Findings and replacements may now be interleaved (tokens vs. illegal code
  // points vs. styled runs); sort both into ascending order so evidence reads
  // left-to-right and the single-pass rebuild below stays valid.
  words.sort((a, b) => a.index - b.index);
  replacements.sort((a, b) => a.start - b.start);

  // Rebuild in a single left-to-right pass. Replacements are collected in
  // ascending, non-overlapping order, so we can stitch the output once instead
  // of re-slicing the whole string per replacement (which is quadratic when a
  // message has many affected tokens).
  let normalized: string;
  if (replacements.length === 0) {
    normalized = text;
  } else {
    let out = '';
    let cursor = 0;
    for (const r of replacements) {
      out += text.slice(cursor, r.start) + r.value;
      cursor = r.end;
    }
    normalized = out + text.slice(cursor);
  }

  return {
    spoofed: SPOOFING_SIGNALS.some((s) => signals[s]),
    signals,
    words,
    counts: {
      wordsTotal: tokens.filter((t) => LETTER_RE.test(t[0])).length,
      wordsAffected: words.length,
    },
    normalized,
    changed: normalized !== text,
    dominantScript,
  };
}
