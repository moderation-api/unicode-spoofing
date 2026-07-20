import { analyze } from '../src/index';

// The message from the customer report that triggered this feature. Words like
// "busіnеss" mix Latin and Cyrillic; "Неу"/"НОТ" are written entirely in
// Cyrillic lookalikes (no intra-word mixing at all).
const CUSTOMER_SAMPLE =
  'Неу Anatoly, НОТ busіnеss рrоduсt just drоppеd. Рrіmе +1 rеvоlvіng uр tо 20MM+, quіск сlоsе. Just tеll mе hоw muсh? Reply STOP to opt out.';

describe('analyze — spoofed content', () => {
  it('flags the customer sample with mixed_script and confusable_word', () => {
    const r = analyze(CUSTOMER_SAMPLE);
    expect(r.spoofed).toBe(true);
    expect(r.signals.mixed_script).toBe(true);
    expect(r.signals.confusable_word).toBe(true);
    expect(r.dominantScript).toBe('Latin');
    expect(r.counts.wordsAffected).toBeGreaterThanOrEqual(14);
  });

  it('catches whole-word confusables that have no intra-word mixing', () => {
    const hot = analyze(CUSTOMER_SAMPLE).words.find((w) => w.word === 'НОТ');
    expect(hot).toBeDefined();
    expect(hot!.signals).toContain('confusable_word');
    expect(hot!.skeleton).toBe('HOT');
    expect(hot!.scripts).toEqual(['Cyrillic']);
  });

  it('de-obfuscates the customer sample to clean English', () => {
    const r = analyze(CUSTOMER_SAMPLE);
    expect(r.changed).toBe(true);
    expect(r.normalized).toBe(
      'Hey Anatoly, HOT business product just dropped. Prime +1 revolving up to 20MM+, quick close. Just tell me how much? Reply STOP to opt out.',
    );
  });

  it('flags intra-word mixed scripts', () => {
    const r = analyze('a busіnеss opportunity');
    const finding = r.words.find((w) => w.word === 'busіnеss');
    expect(finding).toBeDefined();
    expect(finding!.signals).toContain('mixed_script');
    expect(finding!.scripts.sort()).toEqual(['Cyrillic', 'Latin']);
    expect(r.normalized).toBe('a business opportunity');
  });

  it('flags a lookalike brand word in Latin text (classic paypal case)', () => {
    const r = analyze('Verify your раураl account now');
    expect(r.spoofed).toBe(true);
    expect(r.normalized).toBe('Verify your paypal account now');
  });

  it('flags fullwidth, mathematical, and Greek lookalikes as confusable words', () => {
    for (const text of ['ＨＯＴ deal today', '𝐇𝐎𝐓 deal today', 'ΗΟΤ deal today']) {
      const r = analyze(text);
      expect(r.spoofed).toBe(true);
      expect(r.signals.confusable_word).toBe(true);
      expect(r.normalized).toContain('HOT');
    }
  });

  it('flags zero-width characters inside Latin words and strips them', () => {
    const r = analyze('fr​ee mo‍ney');
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('free money');
  });

  it('flags zalgo and strips the combining marks', () => {
    const r = analyze('Z̸̢̬̈a̛̠͎lg̕o̶ text');
    expect(r.signals.zalgo).toBe(true);
    expect(r.normalized).toBe('Zalgo text');
  });

  it('flags confusable words even when lookalikes outnumber Latin letters', () => {
    // Nearly every word obfuscated — dominant script may not be Latin, but
    // the mixed-script words establish evasion context for "НОТ".
    const r = analyze('Неу уоu, НОТ рrоduсt drоppеd tоdау quіск');
    const hot = r.words.find((w) => w.word === 'НОТ');
    expect(hot).toBeDefined();
    expect(hot!.signals).toContain('confusable_word');
  });

  it('flags Unicode non-characters as illegal code points', () => {
    // Two disjoint ranges reach the same verdict: the BMP block U+FDD0–U+FDEF
    // and the U+xxFFFE/U+xxFFFF pair that closes every plane.
    for (const text of ['hi ﷐ there', 'hi ￾ there', 'hi \u{1fffe} there']) {
      const r = analyze(text);
      expect(r.signals.illegal).toBe(true);
      expect(r.normalized).toBe('hi  there');
    }
  });

  it('reports codepoint-accurate word offsets', () => {
    const r = analyze(CUSTOMER_SAMPLE);
    for (const w of r.words) {
      expect(CUSTOMER_SAMPLE.slice(w.index, w.index + w.word.length)).toBe(w.word);
    }
  });
});

describe('analyze — legitimate content', () => {
  const CLEAN_CASES: Array<[string, string]> = [
    ['plain English', 'Hey Anatoly, HOT business product just dropped.'],
    ['Russian', 'Привет, как дела? Это обычное русское сообщение без обмана.'],
    ['bilingual EN/RU', 'The Russian word привет means hello.'],
    ['French diacritics', "L'élève naïve a déjà mangé à Zürich."],
    ['Japanese (Han + kana in one word)', '日本語のテキストです。食べる、飲む。'],
    ['Korean', '한국어 텍스트입니다'],
    ['Hebrew with points', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים'],
    ['Arabic', 'مرحبا بالعالم'],
    ['Persian with ZWNJ', 'می‌خواهم بروم'],
    ['emoji ZWJ sequences', 'family 👨‍👩‍👧‍👦 emoji ✌🏻'],
    ['numbers and symbols', 'Call +1 555-0100 re: 20MM+ ARR'],
    // U+2019 is a token character, so contractions are ASCII words carrying one
    // curly apostrophe — their skeleton folds it back to "'", which must not
    // read as a disguised ASCII word.
    ['typographic apostrophes', 'Sounds good, I’ll call — don’t worry, it’s Kaysie’s job.'],
    ['& apos; in HTML', 'Sounds good, I&#39;ll call — don&#39;t worry, it&#39;s Kaysie&#39;s job.'],
    ['test', 'Hansen&sons'],
    ['empty string', ''],
  ];

  it.each(CLEAN_CASES)('does not flag %s', (_name, text) => {
    const r = analyze(text);
    expect(r.spoofed).toBe(false);
    expect(r.words).toEqual([]);
    expect(r.changed).toBe(false);
    expect(r.normalized).toBe(text);
  });

  it('still flags a lookalike word that carries a curly apostrophe', () => {
    // The apostrophe exemption is about punctuation only — the letters still
    // decide. "Ivаn’s" hides a Cyrillic "а".
    const r = analyze('Ivа’s');
    expect(r.signals.mixed_script).toBe(true);
  });

  it('does not call a styled word confusable unless the whole word folds to ASCII', () => {
    // "𝗉𝗋é" has two styled letters that individually fold to ASCII, but the
    // token folds to "pré" — still non-ASCII, so it is not a disguised word.
    const r = analyze('𝗉𝗋é');
    expect(r.signals.confusable_word).toBe(false);
  });

  it('ignores runs of enclosed digits, which fold to non-letters', () => {
    // ①②③ → "123": a styled run, but not a disguised WORD. Legitimate
    // enclosed numbering must survive untouched.
    const r = analyze('see item ①②③ below');
    expect(r.signals.confusable_word).toBe(false);
  });

  it('treats expected scripts as legitimate for whole words', () => {
    // Without expectedScripts this could look suspicious in Latin-dominant
    // text; with them, whole Cyrillic words are the sender's normal traffic.
    const text = 'Order confirmed — спасибо за покупку!';
    expect(analyze(text, { expectedScripts: ['Cyrillic'] }).spoofed).toBe(false);
  });

  it('still flags intra-word mixing when the script is expected', () => {
    const r = analyze('Неllо приятель', { expectedScripts: ['Cyrillic'] });
    // "Неllо" mixes Cyrillic Не with Latin llo — expectedScripts must not
    // excuse blending inside a single word.
    expect(r.signals.mixed_script).toBe(true);
  });
});

describe('analyze — result shape', () => {
  it('counts letter-bearing words only', () => {
    const r = analyze('one two 33 44 five');
    expect(r.counts.wordsTotal).toBe(3);
  });

  it('handles long input without pathological slowdown', () => {
    const text = `${'The quick brown fox jumps over the lazy dog. '.repeat(200)}Неу НОТ рrоduсt`;
    const start = performance.now();
    const r = analyze(text);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(r.spoofed).toBe(true);
  });
});
