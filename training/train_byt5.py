"""Fine-tune ByT5 on the same generated pairs — the OFFLINE quality baseline.

The latency benchmark rules seq2seq out of the serving path (1.6 s/message on
CPU vs ~1 ms for the taggers), but it is still the quality ceiling to measure
the tagger against, and the label source for anything a tagger cannot express
(insertions: `fck` → `fuck`, phonetic leet: `l8r` → `later`). This script
exists so that comparison can actually be run — same data in, exact-match and
false-rewrite out, numbers comparable with train.py's.

Practical notes:
  - Run on a GPU. It works on CPU (that is how it is smoke-tested) but a
    full fine-tune there is hours, not minutes.
  - needs: pip install transformers accelerate

Usage:
    python train_byt5.py --data data/train.jsonl --steps 2000 \
        --out checkpoints/byt5-small-ft
    python train_byt5.py --data data/train.jsonl --eval-only \
        --out checkpoints/byt5-small-ft
"""

from __future__ import annotations

import argparse
import json
import random

import torch


def load_pairs(path: str, max_chars: int = 160) -> list[tuple[str, str]]:
    pairs = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if len(row["src"]) <= max_chars:
                pairs.append((row["src"], row["tgt"]))
    return pairs


def evaluate(model, tok, pairs: list[tuple[str, str]], device: str) -> dict[str, float]:
    model.eval()
    exact = 0
    identity_total = 0
    identity_rewritten = 0
    with torch.no_grad():
        for src, tgt in pairs:
            inputs = tok(src, return_tensors="pt").to(device)
            out = model.generate(**inputs, max_new_tokens=len(src.encode("utf-8")) + 16)
            decoded = tok.decode(out[0], skip_special_tokens=True)
            if decoded == tgt:
                exact += 1
            if src == tgt:
                identity_total += 1
                if decoded != src:
                    identity_rewritten += 1
    return {
        "exact": exact / max(len(pairs), 1),
        "false_rewrite": identity_rewritten / max(identity_total, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="google/byt5-small")
    ap.add_argument("--steps", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--eval-n", type=int, default=200)
    ap.add_argument("--eval-only", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="checkpoints/byt5-small-ft")
    args = ap.parse_args()

    from transformers import AutoTokenizer, T5ForConditionalGeneration

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    source = args.out if args.eval_only else args.model
    tok = AutoTokenizer.from_pretrained(source)
    model = T5ForConditionalGeneration.from_pretrained(source).to(device)

    pairs = load_pairs(args.data)
    random.shuffle(pairs)
    val = pairs[: args.eval_n]
    train = pairs[args.eval_n :]
    print(f"{len(train)} train / {len(val)} val pairs on {device}")

    if not args.eval_only:
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
        model.train()
        for step in range(1, args.steps + 1):
            batch = random.sample(train, min(args.batch, len(train)))
            enc = tok([s for s, _ in batch], return_tensors="pt", padding=True).to(device)
            labels = tok([t for _, t in batch], return_tensors="pt", padding=True).input_ids
            labels[labels == tok.pad_token_id] = -100
            loss = model(**enc, labels=labels.to(device)).loss
            opt.zero_grad()
            loss.backward()
            opt.step()
            if step % 50 == 0 or step == 1:
                print(f"step {step}: loss {loss.item():.4f}")
        model.save_pretrained(args.out)
        tok.save_pretrained(args.out)
        print(f"saved {args.out}")

    metrics = evaluate(model, tok, val, device)
    print(f"exact {metrics['exact']:.4f} false_rewrite {metrics['false_rewrite']:.4f}")


if __name__ == "__main__":
    main()
