import { ALLOWED_RANGES_PACKED } from './data/identifier-status.generated';

/**
 * UTS #39 Identifier_Status. Unicode publishes the set of characters it
 * considers appropriate in identifiers ("Allowed"); everything else is
 * "Restricted" — technical notation, obsolete letters, limited-use scripts.
 *
 * This is the distinction that tells a legitimate non-ASCII word from a
 * disguised one *within a single script*, where script analysis has nothing to
 * say. "æ" in a Danish surname and "ɑ" (IPA alpha) standing in for "a" are
 * both lone Latin letters whose skeleton is ASCII; only their status differs.
 */
const starts: number[] = [];
const ends: number[] = [];

{
  let cursor = 0;
  for (const entry of ALLOWED_RANGES_PACKED.split(';')) {
    const dot = entry.indexOf('.');
    const start = cursor + parseInt(entry.slice(0, dot), 36);
    const end = start + parseInt(entry.slice(dot + 1), 36);
    starts.push(start);
    ends.push(end);
    cursor = end;
  }
}

/** True when Unicode marks this code point as Allowed in identifiers. */
export function isAllowedIdentifierChar(cp: number): boolean {
  // Ranges are sorted and non-overlapping, so the candidate is the last range
  // whose start is <= cp.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! > cp) hi = mid - 1;
    else if (ends[mid]! < cp) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * True when a character is Restricted — the inverse of the above, named for
 * how it reads at the call site.
 */
export function isRestrictedIdentifierChar(ch: string): boolean {
  return !isAllowedIdentifierChar(ch.codePointAt(0)!);
}
