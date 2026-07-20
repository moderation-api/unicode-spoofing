/**
 * The public constants. These exist so callers can enumerate script names and
 * write rules against `dominantScript` without hardcoding strings — so each
 * test here ties a constant back to the behavior it claims to describe. A
 * constant that drifts from the analyzer is worse than no constant at all.
 */

import { describe, it, expect } from 'vitest';
import {
  analyze,
  FORMAT_CHAR_SCRIPTS,
  LEGITIMATE_SCRIPT_COMBINATIONS,
  primaryScript,
  PSEUDO_SCRIPTS,
  SCRIPT_NAMES,
  SPOOF_SIGNALS,
  SUPPORTED_SCRIPTS,
  ZALGO_MARK_RUN,
} from '../src';

describe('SCRIPT_NAMES', () => {
  it('has no duplicates', () => {
    expect(new Set(SCRIPT_NAMES).size).toBe(SCRIPT_NAMES.length);
  });

  it('is what primaryScript can return', () => {
    const names = new Set<string>(SCRIPT_NAMES);
    for (const ch of 'aЯαあ字한أשא०ᐊ') {
      const s = primaryScript(ch);
      expect(names.has(s)).toBe(true);
    }
  });

  it('is what analyze reports — findings never carry a pseudo script', () => {
    const names = new Set<string>(SCRIPT_NAMES);
    const pseudo = new Set<string>(PSEUDO_SCRIPTS);
    const r = analyze('НОТ busіnеss 日本語のtext аррӏе');

    expect(r.words.length).toBeGreaterThan(0);
    for (const w of r.words) {
      for (const s of w.scripts) {
        expect(names.has(s)).toBe(true);
        expect(pseudo.has(s)).toBe(false);
      }
    }
    expect(r.dominantScript).not.toBeNull();
    expect(names.has(r.dominantScript!)).toBe(true);
  });

  it('covers every script this runtime supports', () => {
    // SUPPORTED_SCRIPTS drops names the engine's Unicode tables lack. On any
    // current runtime nothing is dropped; if this fails, CI is on an old ICU.
    expect(SUPPORTED_SCRIPTS).toEqual([...SCRIPT_NAMES]);
  });
});

describe('PSEUDO_SCRIPTS', () => {
  it('is what primaryScript returns for non-script characters', () => {
    expect(primaryScript('1')).toBe('Common');
    expect(primaryScript(' ')).toBe('Common');
    expect(primaryScript('\u0301')).toBe('Inherited'); // combining acute
    expect(PSEUDO_SCRIPTS).toEqual(['Common', 'Inherited', 'Unknown']);
  });
});

describe('SPOOF_SIGNALS', () => {
  it('is exactly the keys of the signals record', () => {
    expect(Object.keys(analyze('').signals).sort()).toEqual([...SPOOF_SIGNALS].sort());
  });
});

describe('FORMAT_CHAR_SCRIPTS', () => {
  it('lists scripts exempt from invisible and zalgo', () => {
    expect(FORMAT_CHAR_SCRIPTS).toContain('Arabic');
    // A ZWNJ inside a Persian word is orthography, not a hidden character.
    expect(analyze('می\u200Cروم').signals.invisible).toBe(false);
    // The same ZWNJ inside a Latin word — a script NOT on the list — is not.
    expect(FORMAT_CHAR_SCRIPTS).not.toContain('Latin');
    expect(analyze('fr\u200Cee').signals.invisible).toBe(true);
  });
});

describe('LEGITIMATE_SCRIPT_COMBINATIONS', () => {
  it('lists the mixes that do not fire mixed_script', () => {
    expect(LEGITIMATE_SCRIPT_COMBINATIONS).toContainEqual(['Han', 'Hiragana', 'Katakana']);
    expect(analyze('日本語の文字').signals.mixed_script).toBe(false);
    // Latin + Cyrillic is on no list.
    expect(analyze('busіnеss').signals.mixed_script).toBe(true);
  });
});

describe('ZALGO_MARK_RUN', () => {
  it('is the stack depth at which zalgo fires', () => {
    const base = 'a';
    const marks = '\u0301\u0302\u0303\u0304';
    const stack = (n: number) => analyze(base + marks.slice(0, n)).signals.zalgo;

    expect(stack(ZALGO_MARK_RUN - 1)).toBe(false);
    expect(stack(ZALGO_MARK_RUN)).toBe(true);
  });
});
