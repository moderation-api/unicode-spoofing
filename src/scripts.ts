/**
 * Script classification built on the engine's own Unicode property tables
 * (`\p{Script=…}` / `\p{Script_Extensions=…}`), so script data stays current
 * with the runtime's ICU and we ship none of it ourselves.
 */

/**
 * Every script the classifier can name, tested in order when classifying a
 * character; common scripts first so the average lookup terminates early. This
 * list only needs to cover scripts we can *name* — characters outside it
 * classify as `Unknown`, which the analyzer treats conservatively (never as
 * spoofing evidence).
 *
 * These are the exact values that appear in `WordFinding.scripts`,
 * `AnalysisResult.dominantScript` and `AnalyzeOptions.expectedScripts`.
 */
export const SCRIPT_NAMES = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Han',
  'Arabic',
  'Hebrew',
  'Devanagari',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Thai',
  'Bengali',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Gujarati',
  'Gurmukhi',
  'Oriya',
  'Sinhala',
  'Myanmar',
  'Khmer',
  'Lao',
  'Tibetan',
  'Georgian',
  'Armenian',
  'Ethiopic',
  'Cherokee',
  'Mongolian',
  'Syriac',
  'Thaana',
  'Nko',
  'Vai',
  'Bopomofo',
  'Yi',
  'Adlam',
  'Osage',
  'Deseret',
  'Glagolitic',
  'Coptic',
  'Tifinagh',
  'Canadian_Aboriginal',
  'Runic',
  'Ogham',
  'Braille',
  'Lisu',
  'Tai_Le',
  'Tai_Viet',
  'Javanese',
  'Balinese',
  'Sundanese',
  'Buginese',
  'Batak',
  'Cham',
  'Tagalog',
  'Hanunoo',
  'Buhid',
  'Tagbanwa',
  'Limbu',
  'New_Tai_Lue',
  'Ol_Chiki',
  // Named so its invisible vowel sign (U+110B1) is recognised as native
  // orthography rather than as a hidden character. See INVISIBLE_MARKS.
  'Kaithi',
] as const;

/** A script the classifier can name — one of {@link SCRIPT_NAMES}. */
export type ScriptName = (typeof SCRIPT_NAMES)[number];

/**
 * Classifications that are not scripts: `Common` (punctuation, digits, symbols
 * shared by every script), `Inherited` (combining marks that take their script
 * from the base) and `Unknown` (a script outside {@link SCRIPT_NAMES}). The
 * analyzer treats all three as wildcards, never as spoofing evidence, and they
 * never appear in a finding's `scripts`.
 */
export const PSEUDO_SCRIPTS = ['Common', 'Inherited', 'Unknown'] as const;

/** One of {@link PSEUDO_SCRIPTS}. */
export type PseudoScript = (typeof PSEUDO_SCRIPTS)[number];

const scriptRegexes: Array<{ name: ScriptName; re: RegExp }> = [];
for (const name of SCRIPT_NAMES) {
  try {
    scriptRegexes.push({ name, re: new RegExp(`\\p{Script=${name}}`, 'u') });
  } catch {
    // Unsupported script name on this ICU version — skip it.
  }
}

/**
 * The subset of {@link SCRIPT_NAMES} this runtime's Unicode tables actually
 * support. Older engines lack the newest scripts (Adlam, Osage …); characters
 * in a missing script classify as `Unknown`. Equals `SCRIPT_NAMES` on any
 * current Node or browser.
 */
export const SUPPORTED_SCRIPTS: readonly ScriptName[] = scriptRegexes.map((r) => r.name);

const COMMON_RE = /\p{Script=Common}/u;
const INHERITED_RE = /\p{Script=Inherited}/u;

const primaryCache = new Map<number, ScriptName | PseudoScript>();

/**
 * Primary script of a character: a name from {@link SCRIPT_NAMES}, or one of
 * the {@link PSEUDO_SCRIPTS} (`Common`, `Inherited`, `Unknown`).
 */
export function primaryScript(ch: string): ScriptName | PseudoScript {
  const cp = ch.codePointAt(0)!;
  const cached = primaryCache.get(cp);
  if (cached !== undefined) return cached;

  let result: ScriptName | PseudoScript = 'Unknown';
  if (COMMON_RE.test(ch)) result = 'Common';
  else if (INHERITED_RE.test(ch)) result = 'Inherited';
  else {
    for (const { name, re } of scriptRegexes) {
      if (re.test(ch)) {
        result = name;
        break;
      }
    }
  }
  primaryCache.set(cp, result);
  return result;
}

const scxRegexCache = new Map<string, RegExp | null>();
const scxCache = new Map<string, boolean>();

/**
 * Script_Extensions membership: whether `ch` is used with `script`. This is
 * broader than primary script — e.g. U+0951 (Devanagari stress sign) extends
 * to several Indic scripts.
 */
export function inScriptExtensions(ch: string, script: string): boolean {
  const key = `${ch.codePointAt(0)!}:${script}`;
  const cached = scxCache.get(key);
  if (cached !== undefined) return cached;

  let re = scxRegexCache.get(script);
  if (re === undefined) {
    try {
      re = new RegExp(`\\p{Script_Extensions=${script}}`, 'u');
    } catch {
      re = null;
    }
    scxRegexCache.set(script, re);
  }
  const result = re ? re.test(ch) : false;
  scxCache.set(key, result);
  return result;
}

/**
 * Script combinations that legitimately mix inside a single word, per the
 * UTS #39 "augmented script set" idea: Japanese (Han + kana), Korean
 * (Han + Hangul), and Bopomofo-annotated Chinese. A word whose scripts all fall
 * within one of these is never reported as `mixed_script`.
 */
export const LEGITIMATE_SCRIPT_COMBINATIONS: readonly (readonly ScriptName[])[] = [
  ['Han', 'Hiragana', 'Katakana'],
  ['Han', 'Hangul'],
  ['Han', 'Bopomofo'],
];

/**
 * Resolves the scripts of a word's letters and decides whether the word is
 * illegitimately mixed-script.
 *
 * A word is single-script when some script covers every letter via
 * Script_Extensions (Common/Inherited/Unknown letters count as wildcards), or
 * when its scripts form a legitimate combination (e.g. Japanese).
 */
export function analyzeWordScripts(letters: string[]): {
  scripts: ScriptName[];
  mixed: boolean;
} {
  const scripts = new Set<ScriptName>();
  for (const ch of letters) {
    const s = primaryScript(ch);
    if (s !== 'Common' && s !== 'Inherited' && s !== 'Unknown') scripts.add(s);
  }
  const list = [...scripts];
  if (list.length <= 1) return { scripts: list, mixed: false };

  if (LEGITIMATE_SCRIPT_COMBINATIONS.some((combo) => list.every((s) => combo.includes(s)))) {
    return { scripts: list, mixed: false };
  }

  const isWildcard = (ch: string) => {
    const s = primaryScript(ch);
    return s === 'Common' || s === 'Inherited' || s === 'Unknown';
  };
  const covered = list.some((candidate) =>
    letters.every((ch) => isWildcard(ch) || inScriptExtensions(ch, candidate)),
  );
  return { scripts: list, mixed: !covered };
}
