/**
 * Script classification built on the engine's own Unicode property tables
 * (`\p{Script=…}` / `\p{Script_Extensions=…}`), so script data stays current
 * with the runtime's ICU and we ship none of it ourselves.
 */

/**
 * Script names tested in order when classifying a character; common scripts
 * first so the average lookup terminates early. This list only needs to cover
 * scripts we can *name* — characters outside it classify as `Unknown`, which
 * the analyzer treats conservatively (never as spoofing evidence).
 */
const SCRIPT_NAMES = [
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
];

const scriptRegexes: Array<{ name: string; re: RegExp }> = [];
for (const name of SCRIPT_NAMES) {
  try {
    scriptRegexes.push({ name, re: new RegExp(`\\p{Script=${name}}`, 'u') });
  } catch {
    // Unsupported script name on this ICU version — skip it.
  }
}

const COMMON_RE = /\p{Script=Common}/u;
const INHERITED_RE = /\p{Script=Inherited}/u;

const primaryCache = new Map<number, string>();

/**
 * Primary script of a character: a name from SCRIPT_NAMES, or the pseudo
 * values 'Common', 'Inherited', 'Unknown'.
 */
export function primaryScript(ch: string): string {
  const cp = ch.codePointAt(0)!;
  const cached = primaryCache.get(cp);
  if (cached !== undefined) return cached;

  let result = 'Unknown';
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
 * (Han + Hangul), and Bopomofo-annotated Chinese.
 */
const LEGITIMATE_COMBINATIONS: string[][] = [
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
  scripts: string[];
  mixed: boolean;
} {
  const scripts = new Set<string>();
  for (const ch of letters) {
    const s = primaryScript(ch);
    if (s !== 'Common' && s !== 'Inherited' && s !== 'Unknown') scripts.add(s);
  }
  const list = [...scripts];
  if (list.length <= 1) return { scripts: list, mixed: false };

  if (
    LEGITIMATE_COMBINATIONS.some((combo) =>
      list.every((s) => combo.includes(s)),
    )
  ) {
    return { scripts: list, mixed: false };
  }

  const isWildcard = (ch: string) => {
    const s = primaryScript(ch);
    return s === 'Common' || s === 'Inherited' || s === 'Unknown';
  };
  const covered = list.some((candidate) =>
    letters.every(
      (ch) => isWildcard(ch) || inScriptExtensions(ch, candidate),
    ),
  );
  return { scripts: list, mixed: !covered };
}
