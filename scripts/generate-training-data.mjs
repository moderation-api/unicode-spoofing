// Synthetic training data for the character tagger in training/.
//
// Takes clean sentences and corrupts them with the SAME devices the detector
// knows — leet substitutions, Unicode lookalikes (the UTS #39 table run in
// reverse), separator insertion, zero-width insertion, letter stretching, and
// whole-word spacing — emitting (corrupted, clean) pairs as JSONL. Because the
// corruption is applied character by character, the exact alignment is known
// at generation time and shipped along (`tags`): for every character of the
// corrupted text, the target string it should become ("" = delete, itself =
// keep, a letter = substitute). The trainer never has to reconstruct the
// alignment with edit distance.
//
// Usage:
//   node scripts/generate-training-data.mjs \
//     --count 20000 --out training/data/train.jsonl --seed 42
//
// Options:
//   --input <file>     clean sentences, one per line (default: sample corpus)
//   --count <n>        examples to emit (default 20000)
//   --seed <n>         PRNG seed — same seed, same data (default 42)
//   --identity <rate>  share of untouched examples (default 0.35). Identity
//                      pairs are what teach the model to leave clean text,
//                      numbers, and prices alone; do not starve them.
//   --out <file>       output path (default training/data/train.jsonl)
//
// Requires a build first (`pnpm build`) — the corruption tables are imported
// from the library itself so generator and detector can never drift apart.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'index.js');
if (!existsSync(DIST)) {
  console.error('dist/index.js not found — run `pnpm build` first.');
  process.exit(1);
}
const { LEET_ALTERNATIVES, LEET_SEQUENCES, confusableLookalikes } = await import(DIST);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const COUNT = Number(opt('count', '20000'));
const SEED = Number(opt('seed', '42'));
const IDENTITY_RATE = Number(opt('identity', '0.35'));
const OUT = opt('out', join(ROOT, 'training', 'data', 'train.jsonl'));
const INPUT = opt('input', join(ROOT, 'scripts', 'sample-corpus.txt'));

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reruns with the same seed are identical.
// ---------------------------------------------------------------------------
let state = SEED >>> 0;
function rand() {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ---------------------------------------------------------------------------
// Corruption tables, inverted from the library's exports.
// ---------------------------------------------------------------------------

/** letter → single-character leet substitutes ("a" → ["4", "@"]). */
const LEET_INVERSE = new Map();
for (const [sub, letters] of Object.entries(LEET_ALTERNATIVES)) {
  for (const letter of letters) {
    if (!LEET_INVERSE.has(letter)) LEET_INVERSE.set(letter, []);
    LEET_INVERSE.get(letter).push(sub);
  }
}

/** letter → multi-character ASCII-art spellings ("h" → ["|-|"]). */
const SEQ_INVERSE = new Map();
for (const [seq, letter] of LEET_SEQUENCES) {
  if (!SEQ_INVERSE.has(letter)) SEQ_INVERSE.set(letter, []);
  SEQ_INVERSE.get(letter).push(seq);
}

/** letter → Unicode lookalikes, capped so wild rarities don't dominate. */
const LOOKALIKES = new Map();
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const all = [...confusableLookalikes(letter), ...confusableLookalikes(letter.toUpperCase())];
  // Only single code points that survive a round trip through the string type.
  const usable = all.filter((l) => [...l].length === 1);
  if (usable.length > 0) LOOKALIKES.set(letter, usable.slice(0, 24));
}

const SEPARATORS = [' ', '.', '-', '_', '*', '~'];
const INVISIBLES = ['\u200B', '\u200C', '\u200D', '\u2060'];

// ---------------------------------------------------------------------------
// Corruption. A sentence is a list of {out, tgt} cells; every op rewrites
// cells and the alignment falls out for free.
// ---------------------------------------------------------------------------

/**
 * Corrupt one word's cells in place. `intensity` scales per-character odds.
 * Returns the number of edits made.
 */
function corruptWord(cells, intensity, devices) {
  let edits = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    const lower = c.tgt.toLowerCase();
    if (!/[a-z]/.test(lower)) continue;

    if (devices.has('leet') && chance(0.25 * intensity)) {
      const seqs = SEQ_INVERSE.get(lower);
      const subs = LEET_INVERSE.get(lower);
      // ASCII art is rarer than single-character leet in the wild.
      if (seqs !== undefined && chance(0.15)) {
        const seq = pick(seqs);
        cells.splice(
          i,
          1,
          ...[...seq].map((ch, j) => ({ out: ch, tgt: j === 0 ? c.tgt : '' })),
        );
        i += seq.length - 1;
        edits += 1;
        continue;
      }
      if (subs !== undefined) {
        c.out = pick(subs);
        edits += 1;
        continue;
      }
    }

    if (devices.has('lookalike') && chance(0.2 * intensity)) {
      const looks = LOOKALIKES.get(lower);
      if (looks !== undefined) {
        c.out = pick(looks);
        edits += 1;
        continue;
      }
    }

    if (devices.has('stretch') && chance(0.06 * intensity)) {
      const extra = 1 + Math.floor(rand() * 3);
      const copies = Array.from({ length: extra }, () => ({ out: c.out, tgt: '' }));
      cells.splice(i + 1, 0, ...copies);
      i += extra;
      edits += 1;
    }
  }

  if (devices.has('separators')) {
    if (chance(0.12 * intensity) && cells.length >= 3) {
      // Space the whole word out with one separator.
      const sep = pick(SEPARATORS);
      for (let i = cells.length - 1; i > 0; i -= 1) {
        cells.splice(i, 0, { out: sep, tgt: '' });
      }
      edits += cells.length >> 1;
    } else {
      for (let i = cells.length - 1; i > 0; i -= 1) {
        if (chance(0.05 * intensity)) {
          cells.splice(i, 0, { out: pick(SEPARATORS), tgt: '' });
          edits += 1;
        }
      }
    }
  }

  if (devices.has('invisible')) {
    for (let i = cells.length - 1; i > 0; i -= 1) {
      if (chance(0.04 * intensity)) {
        cells.splice(i, 0, { out: pick(INVISIBLES), tgt: '' });
        edits += 1;
      }
    }
  }

  return edits;
}

const ALL_DEVICES = ['leet', 'lookalike', 'separators', 'invisible', 'stretch'];

function corruptSentence(sentence) {
  // Tier: mild = one device gently, medium = two, heavy = several, hard.
  const tierRoll = rand();
  const tier = tierRoll < 0.4 ? 'mild' : tierRoll < 0.75 ? 'medium' : 'heavy';
  const intensity = tier === 'mild' ? 0.6 : tier === 'medium' ? 1.0 : 1.6;
  const deviceCount = tier === 'mild' ? 1 : tier === 'medium' ? 2 : 3 + Math.floor(rand() * 3);
  const devices = new Set();
  while (devices.size < deviceCount) devices.add(pick(ALL_DEVICES));

  const words = sentence.split(' ');
  const outCells = [];
  let edits = 0;
  for (let w = 0; w < words.length; w += 1) {
    const cells = [...words[w]].map((ch) => ({ out: ch, tgt: ch }));
    // Corrupt roughly half the words; evasion in the wild hides one or two
    // words in an otherwise ordinary sentence.
    if (chance(0.55)) edits += corruptWord(cells, intensity, devices);
    outCells.push(...cells);
    if (w < words.length - 1) outCells.push({ out: ' ', tgt: ' ' });
  }
  if (edits === 0) return null; // corruption chose nothing — caller retries

  const src = outCells.map((c) => c.out).join('');
  const tags = outCells.flatMap((c) => {
    const chars = [...c.out];
    // A multi-character cell (ASCII-art) puts the target on its first char.
    return chars.map((_, j) => (j === 0 ? c.tgt : ''));
  });
  return { src, tgt: sentence, tags, tier };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const corpus = readFileSync(INPUT, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

const lines = [];
let identity = 0;
let corrupted = 0;
while (lines.length < COUNT) {
  const sentence = pick(corpus);
  if (chance(IDENTITY_RATE)) {
    const tags = [...sentence].map((ch) => ch);
    lines.push(JSON.stringify({ src: sentence, tgt: sentence, tags, tier: 'identity' }));
    identity += 1;
    continue;
  }
  const ex = corruptSentence(sentence);
  if (ex === null) continue;
  lines.push(JSON.stringify(ex));
  corrupted += 1;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(
  `wrote ${lines.length} examples to ${OUT} (${corrupted} corrupted, ${identity} identity, seed ${SEED})`,
);
