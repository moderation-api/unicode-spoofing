import { foldChar, skeleton } from './confusables';
import { analyzeWordScripts, primaryScript } from './scripts';
import type { AnalysisResult, AnalyzeOptions, SpoofSignal, WordFinding } from './types';

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
const VARIATION_BASE_SCRIPTS = new Set(['Han', 'Hiragana', 'Katakana', 'Mongolian']);

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
const FORMAT_CHAR_SCRIPTS = new Set([
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
]);

/** Combining marks stacked deeper than this on one base = zalgo. */
const ZALGO_MARK_RUN = 3;

/**
 * Code points that have no business appearing in ordinary text and that the
 * token scanner would otherwise silently drop (they are not letters, marks,
 * numbers or format characters, so they never enter a word): C0/C1 controls,
 * DEL, Unicode non-characters and the replacement character. TAB, LF and CR
 * are the only C0 controls treated as legitimate whitespace.
 */
function isIllegalCodePoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // TAB, LF, CR
  if (cp < 0x20) return true; // C0 controls
  if (cp >= 0x7f && cp <= 0x9f) return true; // DEL + C1 controls
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // non-characters (BMP block)
  if ((cp & 0xfffe) === 0xfffe) return true; // U+xxFFFE / U+xxFFFF in every plane
  if (cp === 0xfffd) return true; // replacement character (mojibake / decode damage)
  return false;
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
    invisible: false,
    zalgo: false,
    illegal: false,
  };
}

interface TokenAnalysis {
  signals: SpoofSignal[];
  scripts: string[];
  skeleton?: string;
  normalized: string;
}

function analyzeToken(
  token: string,
  dominantScript: string | null,
  anyMixedInMessage: boolean,
  expectedScripts: Set<string>,
): TokenAnalysis {
  const chars = [...token];
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
  const scriptExempt = scripts.some((s) => FORMAT_CHAR_SCRIPTS.has(s));

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
  const hasInvisible = chars.some((ch) => isInvisibleChar(ch)) || strayVariation.size > 0;
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
  let skeletonConfusable = false;
  if (!mixed && letters.length >= 2 && !ASCII_PRINTABLE_RE.test(token)) {
    const inExpectedScript = scripts.length > 0 && scripts.every((s) => expectedScripts.has(s));
    const latinContext =
      dominantScript === 'Latin' ||
      anyMixedInMessage ||
      (scripts.length > 0 && scripts.every((s) => s === 'Latin'));
    const outsideExpected =
      expectedScripts.size > 0 &&
      scripts.length > 0 &&
      scripts.every((s) => !expectedScripts.has(s));
    if (!inExpectedScript && (latinContext || outsideExpected)) {
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
  if (!mixed && letters.length >= 2 && !ASCII_PRINTABLE_RE.test(token)) {
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
        if (dropInvisible && (isInvisibleChar(ch) || strayVariation.has(i))) return '';
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
  const scriptCounts = new Map<string, number>();
  for (const ch of text) {
    if (!LETTER_RE.test(ch) || isInvisibleChar(ch)) continue;
    const s = primaryScript(ch);
    if (s === 'Common' || s === 'Inherited' || s === 'Unknown') continue;
    scriptCounts.set(s, (scriptCounts.get(s) ?? 0) + 1);
  }
  let dominantScript: string | null = null;
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

  for (const match of tokens) {
    const token = match[0];
    const result = analyzeToken(token, dominantScript, anyMixedInMessage, expectedScripts);
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
      if (!(isInvisibleChar(ch) || isVariationSelector(cp)) || inWord(i)) {
        i += width;
        continue;
      }

      // Extend over the whole invisible run so a payload reports as one finding.
      let end = i + width;
      while (end < text.length) {
        const next = text.codePointAt(end)!;
        const nextCh = String.fromCodePoint(next);
        if (!(isInvisibleChar(nextCh) || isVariationSelector(next)) || inWord(end)) break;
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
    spoofed: words.length > 0,
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
