import type { ScriptName } from './scripts';

export type SpoofSignal = 'mixed_script' | 'confusable_word' | 'invisible' | 'zalgo' | 'illegal';

export const SPOOF_SIGNALS: readonly SpoofSignal[] = [
  'mixed_script',
  'confusable_word',
  'invisible',
  'zalgo',
  'illegal',
];

export interface WordFinding {
  /**
   * The token exactly as it appears in the input. For an `illegal` finding
   * (a lone control / non-character code point, which is never part of a
   * token) this is the offending character on its own.
   */
  word: string;
  /** Codepoint-safe character offset of the token in the input string. */
  index: number;
  /** Signals this token carries (a token can carry several). */
  signals: SpoofSignal[];
  /** Primary scripts of the token's letters, e.g. ['Latin', 'Cyrillic']. */
  scripts: ScriptName[];
  /**
   * UTS #39 skeleton of the token — present when it drove a
   * mixed_script/confusable_word signal (what the token resolves to).
   */
  skeleton?: string;
}

export interface AnalyzeOptions {
  /**
   * Scripts that are expected in this content (e.g. ['Cyrillic'] for a sender
   * with genuine Russian traffic). Whole words written in an expected script
   * are never reported as confusable_word; intra-word mixing still is.
   */
  expectedScripts?: readonly ScriptName[];
}

export interface AnalysisResult {
  /** True when any signal fired. */
  spoofed: boolean;
  /** Which signals fired anywhere in the text. */
  signals: Record<SpoofSignal, boolean>;
  /** Per-token evidence, in input order. Only affected tokens are listed. */
  words: WordFinding[];
  counts: {
    wordsTotal: number;
    wordsAffected: number;
  };
  /**
   * The input with affected words de-obfuscated: confusables folded to their
   * Latin lookalikes, invisible characters removed, zalgo marks stripped.
   * Unaffected text — including legitimate non-Latin words — is untouched.
   */
  normalized: string;
  /** True when `normalized` differs from the input. */
  changed: boolean;
  /** Most frequent primary script among the input's letters, if any. */
  dominantScript: ScriptName | null;
}
