import { analyze } from '../src/index';

/**
 * Throughput guards. These are deliberately loose so they don't flake on a
 * loaded CI box, but tight enough to catch an accidental O(n²) regression or a
 * runaway per-token cost. We assert against total wall-clock for a fixed corpus
 * rather than a fragile "ops/sec" number.
 */

/** Median of several timed runs — smooths out GC / JIT warmup noise. */
function medianMs(fn: () => void, runs = 5): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** Build a realistic mixed corpus of clean, spoofed, and heavy tokens. */
function buildCorpus(paragraphs: number): string {
  const templates = [
    'The quick brown fox jumps over the lazy dog near the riverbank.',
    'Contact support at help@example.com for any account questions today.',
    'Пришлите ваш раураl логин прямо сейчас — это срочно и важно!', // confusable + cyrillic
    'Free 𝐜𝐫𝐲𝐩𝐭𝐨 giveaway, click the l​ink b​elow to c​laim now', // math styles + ZWSP
    'НОТ deals: buy ѕtock, get free ѕhipping on every оrder this week',
    'Z̸̢͇a̴̧͖l̷̪͝g̶̯͝o̶̪͝ text stress test with stacked combining marks here',
  ];
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    out.push(templates[i % templates.length]);
  }
  return out.join('\n');
}

describe('analyze performance', () => {
  it('processes a large mixed corpus within a time budget', () => {
    const corpus = buildCorpus(2000); // ~120k chars, thousands of tokens
    // Warm up so JIT/regex compilation isn't charged to the measured run.
    analyze(corpus);

    const elapsed = medianMs(() => analyze(corpus));
    const kchars = corpus.length / 1000;

    // Generous ceiling: on modern hardware this runs in well under 50ms.
    // 250ms leaves ~5x headroom for slow/loaded CI while still flagging a
    // catastrophic regression.
    expect(elapsed).toBeLessThan(250);

    // Sanity floor on throughput so a future refactor can't silently tank it.
    const kcharsPerMs = kchars / elapsed;
    expect(kcharsPerMs).toBeGreaterThan(0.1); // >100 chars/ms
  });

  it('scales roughly linearly with input size (no quadratic blowup)', () => {
    const small = buildCorpus(500);
    const large = buildCorpus(2000); // 4x the tokens

    analyze(small);
    analyze(large);

    const smallMs = medianMs(() => analyze(small)) || 0.01;
    const largeMs = medianMs(() => analyze(large));

    // Linear would give ~4x. Allow up to 8x for fixed-cost noise on tiny
    // timings; a quadratic path would blow well past this (≈16x+).
    expect(largeMs / smallMs).toBeLessThan(8);
  });

  it('handles a pathological single long token quickly', () => {
    // A single enormous run of combining marks (zalgo) — exercises the
    // per-character mark-run loop without token boundaries to break it up.
    const base = 'a';
    const zalgo = base + '́'.repeat(50_000);

    const elapsed = medianMs(() => analyze(zalgo), 3);
    expect(elapsed).toBeLessThan(250);
  });
});
