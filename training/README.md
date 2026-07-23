# training/ — the trainable Layer 2

The library itself (Layer 1) is deterministic: confusable folding, invisible
stripping, and keyword-evasion matching, all table-driven, all microseconds.
What it cannot do is *generalize* — phonetic leet (`l8r`, `gr8`), novel ASCII
art, vowel dropping, and whatever evaders invent next week. That is a learning
problem, and this directory is the scaffolding for it: synthetic data
generation, three candidate architectures, training, ONNX export, and a
latency benchmark that decides what is allowed into a serving path.

Nothing here ships in the npm package. It is a working pipeline, not a
trained production model — the bundled corpus is ~90 sentences, enough to
prove the loop end to end, not to train something deployable. Point the
generator at a real corpus (and your production evasion samples) for that.

## The architecture decision, in numbers

The serving budget for a preprocessing step is ~10 ms. That rules
architectures in or out before quality is even discussed, so the benchmark
comes first. Measured on this repo's CI-class container (x86_64, 4 cores,
**batch 1, single thread** — the honest serving configuration), ONNX Runtime,
message length 128 bytes:

| approach                                  | params | p50 latency  |
| ----------------------------------------- | ------ | ------------ |
| gru-small tagger (int8)                   | 155k   | **0.93 ms**  |
| transformer-small tagger (int8)           | 442k   | **1.47 ms**  |
| cnn-small tagger (fp32)                   | 375k   | **1.65 ms**  |
| transformer-small used as seq2seq¹        | 442k   | 109 ms       |
| byt5-small, real `generate()` (fp32)      | 300M   | **1,574 ms** |

¹ The same int8 tagger executed one forward pass per output byte — what an
autoregressive decoder does structurally. Same weights, same runtime, 75×
slower. That gap is architectural, not a tuning problem: no quantization
makes a per-byte loop fit a 10 ms budget. This is why Layer 2 is a
**non-autoregressive byte tagger** (one encoder pass, per-byte labels:
KEEP / DELETE / EMIT c) and why seq2seq models like ByT5 belong offline — as
a quality baseline and a labeler for scraped evasions (see the last section)
— never in the hot path.

Full sweep (3 architectures × 3 sizes × fp32/int8 × 32/128/512 bytes):
[`benchmark-results.md`](./benchmark-results.md). Two findings worth pulling
out:

- **Everything "small" or below fits the budget with room to spare** at
  realistic chat-message lengths. Even 512-byte messages stay under ~10 ms
  on the transformer and GRU.
- **int8 quantization helps transformers and GRUs but HURTS convolutions**
  (ONNX Runtime's dynamic-quantized ConvInteger is slower than fp32 Conv:
  cnn-small goes 1.65 ms → 7.8 ms). Measure, don't assume — serve CNNs in
  fp32 if a CNN wins on quality.

Reproduce with:

```bash
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
python benchmark_latency.py --iters 100 --autoregressive
python benchmark_latency.py --byt5   # optional; downloads ~1.2 GB
```

## Why tagging, not generation

A tagger classifies every input byte (keep / delete / replace-with-c) in one
forward pass. Besides the 75× latency win above, the formulation is the
hallucination guard: the model cannot emit anything unanchored to an input
byte, so its worst failure is mangling a word — it cannot invent one. For a
moderation pipeline that must never "correct" a username into a slur, that
property is worth more than the expressiveness it costs (insertions — e.g.
restoring dropped vowels, `fck` → `fuck` — are out of scope for a tagger;
that stays a keyword-layer and offline-model problem).

The metric that gates deployment is `false_rewrite`: the share of clean
(identity) examples the model dares to edit. It sits at 0.0000 after one
epoch on synthetic data; keep it there on real traffic before caring about
exact-match.

## Pipeline

```bash
# 1. Generate (corrupted, clean) pairs from the library's own tables.
#    Same seed → identical data. Alignment ships with each row, so training
#    never runs edit distance.
pnpm build
node ../scripts/generate-training-data.mjs --count 24000 --seed 42 \
  --out data/train.jsonl

# 2. Train a tagger.
python train.py --data data/train.jsonl --arch gru --size small --epochs 4

# 3. Export for serving.
python export_onnx.py --checkpoint checkpoints/gru-small.pt \
  --out gru-small.onnx --quantize
```

The generator corrupts with the SAME tables the detector reads —
`LEET_ALTERNATIVES`, `LEET_SEQUENCES`, and the UTS #39 confusables inverted
via `confusableLookalikes` — so generator and detector cannot drift apart.
Devices: single-char leet, ASCII art, Unicode lookalikes, separator
insertion, whole-word spacing, zero-width insertion, letter stretching, in
mild/medium/heavy tiers. ~35% of examples are untouched identity pairs;
they are what teach the model to leave numbers, prices, and clean prose
alone — do not starve them.

Number traps (`--numbers`, default 0.3) are the false-positive side of the
training signal: phone numbers, room numbers, invoices, prices, durations,
versions, IPs — generated from templates with FRESH random digits every
example, so "digits stay digits" is learned as a rule instead of memorized
per number (a fixed corpus produces exactly that failure: "room 505"
preserved because it was seen, "room 404" mangled because it was not).
Digit-only words are never corrupted by any device — inserting separators
into "505" would teach the model that spaced digits should merge, and phone
numbers are spaced digits. The hardest pairs corrupt the letters AROUND
untouched digits: "r0om 679 is r<ZWSP>e4dy" → "room 679 is ready".

## Smoke-run quality (bundled toy corpus, 24k pairs, 4 epochs, CPU)

| arch (small)    | params | exact @4ep | false_rewrite         | p50 @128B      |
| --------------- | ------ | ---------- | --------------------- | -------------- |
| **cnn**         | 375k   | **0.757**  | **0.000** (from ep 1) | 1.65 ms (fp32) |
| gru             | 155k   | 0.567      | 0.009                 | 0.93 ms (int8) |
| transformer     | 442k   | 0.550      | 0.000 (from ep 2)     | 1.47 ms (int8) |

The CNN wins this round on both axes that matter: clearly best exact-match
AND false_rewrite pinned at zero from the first epoch. That makes sense for
the task — deciding what byte 57 should become needs the surrounding word,
which is precisely a dilated convolution's receptive field, not global
attention. Serve it in fp32 (see the quantization caveat above).

Read the exact-match numbers as "the pipeline learns", nothing more — with a
~90-sentence corpus the model sees every sentence in dozens of corruptions,
so they do not predict real-world generalization. The false_rewrite column is
the one that already means something: the tagging formulation holds it at
zero even on a toy corpus.

## Serving shape

```
message → prefilter (µs, drops most clean traffic)
        → analyze + keyword matching (µs–ms, deterministic, explainable)
        → tagger (~1 ms, only for traffic that survived the gate)
        → your moderation stack
```

The deterministic layers stay first: they are free, they are explainable to
users, and they are the gate that keeps the model's amortized cost near zero.
The model earns its place only on the traffic rules cannot decide.

## Scaling this up for real

1. Swap the corpus: `--input your-clean-corpus.txt` (one sentence per line;
   include digit-heavy and price-heavy text or the model will learn that
   digits are always leet).
2. Mix in logged evasions from production, labeled via the keyword matcher or
   by hand, so the training distribution tracks live attacks — the one edge
   a self-trained model has over any public checkpoint.
3. Hold out an eval the generator did NOT produce (red-team samples, the
   Zéroe benchmark) to measure generalization instead of memorization.

## The mid-tier: CANINE-S, the smallest model with world knowledge

The from-scratch taggers know nothing they were not shown — the probe
battery (error_analysis.py) demonstrates it: unseen digit contexts get
leet-decoded ("455" → "ass") and unseen casing collapses. Pretrained
knowledge cannot be had at the ~1M scale; the smallest pretrained model
with the right shape is **CANINE-S** (132M): character-level, so no subword
tokenizer for obfuscation to shatter, and encoder-only, so one forward
pass. Measured here: ~120 ms fp32 / ~53 ms int8 per message, single thread.

`train_canine.py` fine-tunes it on the same JSONL with the same
KEEP/DELETE/EMIT formulation and the same metrics. Its two roles:

- scoring gated/flagged traffic (~53 ms is fine for the few percent the
  prefilter lets through — never for all traffic),
- pseudo-labeling a large real corpus to distill its world knowledge into
  the 1 ms CNN (knowledge transfer — distinct from label generation, which
  the generator already does perfectly for synthetic devices).

Subword minis (bert-tiny, MiniLM) are NOT alternatives: their tokenizers
shatter on exactly the obfuscated text this pipeline exists for.

## Where ByT5 fits (and where distillation does not)

Distillation is NOT part of the standard recipe here, because the usual
reason for a teacher — you cannot produce labels — does not apply: the
generator produces unlimited exactly-aligned labels for every corruption it
can express, and a teacher adds nothing to those. Train the tagger on
generated data directly.

A fine-tuned ByT5 earns its place in exactly two situations, both offline:

- **Quality ceiling.** `train_byt5.py` fine-tunes `google/byt5-small` on the
  same JSONL and reports the same exact/false_rewrite metrics as `train.py`,
  so "how much quality does the 1 ms budget cost us?" is a measurement, not
  a guess. Run it on a GPU; it is smoke-tested on CPU but a real fine-tune
  there is hours.
- **Labels the generator cannot make.** Real logged evasions arrive without
  alignment, and some need insertions (`fck` → `fuck`, `l8r` → `later`) that
  a tagger cannot express and rules cannot decode. A fine-tuned seq2seq can
  propose clean targets for THOSE rows — that is labeling scraped data, not
  distilling synthetic data you already own.

Either way it never serves: 1.6 s/message (measured above) is two orders of
magnitude outside the budget.
