import { CONFUSABLES_PACKED } from './data/confusables.generated';

/**
 * UTS #39 confusable prototype map: source codepoint → prototype string.
 * Built once from the packed generated data.
 */
const CONFUSABLES: Map<number, string> = (() => {
  const map = new Map<number, string>();
  for (const entry of CONFUSABLES_PACKED.split(';')) {
    const [from, to] = entry.split('>');
    map.set(
      parseInt(from, 16),
      to
        .split(' ')
        .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
        .join(''),
    );
  }
  return map;
})();

/**
 * UTS #39 skeleton: NFD → map every codepoint through the confusables table →
 * NFD. Skeletons are comparison artifacts (skeleton(a) === skeleton(b) means
 * "a and b are confusable") — they are NOT suitable display text, since even
 * plain ASCII moves to prototypes (e.g. "I" → "l").
 */
export function skeleton(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFD')) {
    out += CONFUSABLES.get(ch.codePointAt(0)!) ?? ch;
  }
  return out.normalize('NFD');
}

const isAscii = (s: string) => [...s].every((c) => c.codePointAt(0)! < 0x80);

/**
 * Folds a single character to its Latin lookalike for display purposes.
 * ASCII is returned untouched (protecting it from prototype moves like
 * "I" → "l"). When a character's own prototype is not ASCII (e.g. Cyrillic
 * "к" → kra "ĸ"), its case counterpart is tried — uppercase "К" folds to
 * ASCII "K", which is lowercased back — since UTS #39 clusters are built per
 * case and often only one case reaches ASCII.
 */
export function foldChar(ch: string): string {
  if (ch.codePointAt(0)! < 0x80) return ch;
  const direct = CONFUSABLES.get(ch.codePointAt(0)!);
  if (direct && isAscii(direct)) return direct;

  const upper = ch.toUpperCase();
  if (upper !== ch && [...upper].length === 1) {
    const t = CONFUSABLES.get(upper.codePointAt(0)!);
    if (t && isAscii(t)) return t.toLowerCase();
  }
  const lower = ch.toLowerCase();
  if (lower !== ch && [...lower].length === 1) {
    const t = CONFUSABLES.get(lower.codePointAt(0)!);
    if (t && isAscii(t)) return t.toUpperCase();
  }
  return direct ?? ch;
}

/** Whether the confusables table has an entry for this character. */
export function hasConfusableMapping(ch: string): boolean {
  return CONFUSABLES.has(ch.codePointAt(0)!);
}

/**
 * Inverse confusables: ASCII prototype character → every code point whose
 * UTS #39 prototype is exactly that character. This is the *corruption*
 * direction — given "a", the lookalikes an attacker could write instead —
 * and exists for red-team tooling and the training-data generator
 * (scripts/generate-training-data.mjs), which uses it to synthesize
 * obfuscated↔clean pairs from the same pinned Unicode tables the detector
 * runs on. Built lazily: detection never pays for it.
 */
let INVERSE: Map<string, string[]> | null = null;

export function confusableLookalikes(ch: string): readonly string[] {
  if (INVERSE === null) {
    INVERSE = new Map();
    for (const [cp, proto] of CONFUSABLES) {
      if (!isAscii(proto) || [...proto].length !== 1) continue;
      const source = String.fromCodePoint(cp);
      const list = INVERSE.get(proto);
      if (list === undefined) INVERSE.set(proto, [source]);
      else list.push(source);
    }
  }
  return INVERSE.get(ch) ?? [];
}
