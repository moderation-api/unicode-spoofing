import type { AnalyzeOptions, SpoofSignal } from '../src/index';

/**
 * Community case registry — the front door for "this string should (not) be
 * flagged, but isn't handled the way I expect".
 *
 * The contribution flow is test-first:
 *
 *   1. Add a case below describing the behaviour you want, with
 *      `status: 'unsupported'`. CI stays green: an unsupported case is allowed
 *      to not-yet-behave as described, and it documents the gap.
 *   2. (Optional) Implement the fix in `src/`. When the library starts
 *      satisfying your case, the runner will FAIL that test on purpose with a
 *      message telling you to flip `status` to `'supported'`. Do that in the
 *      same PR as the fix.
 *
 * So: a bug report becomes a case; a fix becomes `status: 'supported'`. Either
 * half is a welcome PR on its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPLATE — copy this, fill it in, drop it in the array:
 *
 *   {
 *     category: 'confusable',              // free-form grouping label
 *     name: 'flags fullwidth "admin"',     // shown as the test name
 *     input: 'ａｄｍｉｎ',                      // paste RAW — do not "clean" it
 *     status: 'unsupported',               // 'unsupported' until the fix lands
 *     expect: { spoofed: true, signals: { confusable_word: true } },
 *     ref: 'https://github.com/moderation-api/unicode-spoofing/issues/123',
 *   },
 *
 * `expect` fields are all optional — assert only what your case is about:
 *   - spoofed:    analyze().spoofed must equal this
 *   - signals:    each listed signal must equal the given boolean (others free)
 *   - normalized: analyze().normalized must equal this exact string
 *   - word:       some affected word's `.word` must equal this
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface SpoofCase {
  /** Free-form grouping label (becomes a describe block). */
  category: string;
  /** Human description; shown as the test name. */
  name: string;
  /** Exact input passed to analyze(). Paste raw — do not normalize it yourself. */
  input: string;
  /**
   * 'supported'   → the library must behave as `expect` says (a normal test).
   * 'unsupported' → a known gap: allowed to not-yet-match; flip to 'supported'
   *                 once a fix makes it pass.
   */
  status: 'supported' | 'unsupported';
  /** Assert only what this case is about; every field is optional. */
  expect: {
    spoofed?: boolean;
    signals?: Partial<Record<SpoofSignal, boolean>>;
    normalized?: string;
    word?: string;
  };
  /** Optional options passed to analyze(). */
  options?: AnalyzeOptions;
  /** Optional link to the originating issue or PR. */
  ref?: string;
}

export const CASES: SpoofCase[] = [
  {
    category: 'confusable',
    name: 'flags a Cyrillic whole-word lookalike and normalizes it (НОТ → HOT)',
    input: 'НОТ busіnеss рrоduсt',
    status: 'supported',
    expect: {
      spoofed: true,
      signals: { confusable_word: true, mixed_script: true },
      normalized: 'HOT business product',
    },
    ref: 'https://github.com/moderation-api/unicode-spoofing#readme',
  },
  {
    category: 'multilingual (must NOT flag)',
    name: 'leaves genuine Russian text alone',
    input: 'привет как дела',
    status: 'supported',
    expect: { spoofed: false },
  },
  {
    category: 'digit systems',
    name: 'flags fullwidth digits masquerading as ASCII (１２３)',
    input: 'order １２３ now',
    status: 'unsupported',
    expect: { spoofed: true },
    ref: 'https://github.com/moderation-api/unicode-spoofing/issues/1',
  },
];
