import { foldChar, skeleton } from './confusables';
import { analyzeWordScripts, primaryScript } from './scripts';
import type { AnalysisResult, AnalyzeOptions, SpoofSignal, WordFinding } from './types';

/**
 * Tokens are runs of letters, marks, digits, format (invisible) characters,
 * and apostrophes. Punctuation and emoji sit between tokens, which keeps
 * emoji ZWJ sequences out of word analysis entirely.
 */
const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;

const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const FORMAT_RE = /\p{Cf}/u;
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/;
const ASCII_LETTER_RE = /[a-zA-Z]/;

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
]);

/** Combining marks stacked deeper than this on one base = zalgo. */
const ZALGO_MARK_RUN = 3;

function emptySignals(): Record<SpoofSignal, boolean> {
  return {
    mixed_script: false,
    confusable_word: false,
    invisible: false,
    zalgo: false,
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
  const letters = chars.filter((ch) => LETTER_RE.test(ch));
  const signals: SpoofSignal[] = [];

  // Letterless tokens (numbers, stray format characters between emoji) carry
  // no spoofing evidence — analyzing them only produces noise like flagging
  // the ZWJs inside an emoji family sequence.
  if (letters.length === 0) {
    return { signals, scripts: [], normalized: token };
  }

  const { scripts, mixed } = analyzeWordScripts(letters);
  const scriptExempt = scripts.some((s) => FORMAT_CHAR_SCRIPTS.has(s));

  // invisible: format characters inside a word of non-joining scripts.
  const hasFormatChars = chars.some((ch) => FORMAT_RE.test(ch));
  if (hasFormatChars && !scriptExempt) signals.push('invisible');

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

  // confusable_word: a whole word written as lookalikes of Latin — e.g.
  // all-Cyrillic "НОТ" whose skeleton is "HOT". Requires:
  //  - at least two letters (single letters are too ambiguous),
  //  - the word itself is not plain ASCII,
  //  - its UTS #39 skeleton IS plain ASCII with at least one letter,
  //  - it is not written in a script the caller expects, and
  //  - the context suggests Latin content: the message is Latin-dominant,
  //    other words in it already mix scripts, or the word's own script is
  //    Latin (fullwidth/math styles carry Script=Latin).
  if (!mixed && letters.length >= 2 && !ASCII_PRINTABLE_RE.test(token)) {
    const inExpectedScript = scripts.length > 0 && scripts.every((s) => expectedScripts.has(s));
    const latinContext =
      dominantScript === 'Latin' ||
      anyMixedInMessage ||
      (scripts.length > 0 && scripts.every((s) => s === 'Latin'));
    if (!inExpectedScript && latinContext) {
      const sk = skeleton(token);
      if (ASCII_PRINTABLE_RE.test(sk) && ASCII_LETTER_RE.test(sk)) {
        signals.push('confusable_word');
      }
    }
  }

  // De-obfuscate affected tokens only. Order matters: drop invisibles and
  // zalgo marks first, then fold lookalikes of mixed/confusable words.
  let normalized = token;
  if (signals.length > 0) {
    const foldLookalikes = signals.includes('mixed_script') || signals.includes('confusable_word');
    normalized = chars
      .map((ch) => {
        if (signals.includes('invisible') && FORMAT_RE.test(ch)) return '';
        if (zalgo && MARK_RE.test(ch)) return '';
        return foldLookalikes ? foldChar(ch) : ch;
      })
      .join('')
      .normalize('NFC');
  }

  return {
    signals,
    scripts,
    skeleton:
      signals.includes('mixed_script') || signals.includes('confusable_word')
        ? skeleton(token)
        : undefined,
    normalized,
  };
}

export function analyze(text: string, options: AnalyzeOptions = {}): AnalysisResult {
  const expectedScripts = new Set(options.expectedScripts ?? []);
  const tokens = [...text.matchAll(TOKEN_RE)];

  // Dominant script: most frequent primary script across all letters.
  const scriptCounts = new Map<string, number>();
  for (const ch of text) {
    if (!LETTER_RE.test(ch)) continue;
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
