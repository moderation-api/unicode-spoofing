"""Fine-tune CANINE-S as a character tagger — the mid-tier with world knowledge.

CANINE-S (google/canine-s, 132M) is the smallest pretrained model with the
right shape for this task: character-level input (no subword tokenizer for
obfuscation to shatter) and a single encoder pass (no generation loop).
Measured on 4-core CPU, single thread: ~120 ms fp32 / ~53 ms int8 per
message — far outside the ~10 ms hot path, right-sized for gated traffic or
async re-scoring, and the natural pseudo-labeler for distilling world
knowledge into the from-scratch CNN.

The formulation is identical to train.py's, per CHARACTER instead of per
byte: each character is labeled KEEP / DELETE / EMIT c, decoding is a table
lookup, and hallucination stays structurally impossible.

Run on a GPU for a real fine-tune; CPU works for the smoke test only.
Needs: pip install transformers

Usage:
    python train_canine.py --data data/train.jsonl --steps 1000 \
        --out checkpoints/canine-tagger
    python train_canine.py --data data/train.jsonl --eval-only \
        --out checkpoints/canine-tagger
"""

from __future__ import annotations

import argparse
import json
import random

import torch

from model import DELETE, EMIT_BASE, KEEP, NUM_CLASSES

IGNORE = -100


def pick_device() -> str:
    """cuda → mps → cpu. On Apple Silicon set PYTORCH_ENABLE_MPS_FALLBACK=1;
    a couple of CANINE ops fall back to CPU and torch errors without it."""
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def char_label(char: str, target: str) -> int | None:
    """Per-character label. Unlike the byte scheme, a multi-byte KEEP is
    representable — KEEP copies the character, whatever its encoding."""
    if target == char:
        return KEEP
    if target == "":
        return DELETE
    if len(target) == 1 and 0x20 <= ord(target) < 0x7F:
        return EMIT_BASE + (ord(target) - 0x20)
    return None


def load_examples(path: str, max_chars: int = 160) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            chars = list(row["src"])
            if not 0 < len(chars) <= max_chars:
                continue
            labels = [char_label(c, t) for c, t in zip(chars, row["tags"], strict=True)]
            if any(lab is None for lab in labels):
                continue
            rows.append({"src": row["src"], "tgt": row["tgt"], "labels": labels, "tier": row.get("tier", "?")})
    return rows


def apply_labels(src: str, labels: list[int]) -> str:
    out = []
    for ch, lab in zip(list(src), labels):
        if lab == KEEP:
            out.append(ch)
        elif lab == DELETE:
            continue
        else:
            out.append(chr(0x20 + (lab - EMIT_BASE)))
    return "".join(out)


def make_batch(tok, rows: list[dict], device: str):
    enc = tok([r["src"] for r in rows], return_tensors="pt", padding=True, truncation=True)
    # CANINE ids are code points; row layout is [CLS] chars... [SEP] pad...
    labels = torch.full(enc.input_ids.shape, IGNORE, dtype=torch.long)
    for i, r in enumerate(rows):
        n = len(r["labels"])
        labels[i, 1 : 1 + n] = torch.tensor(r["labels"])
    return {k: v.to(device) for k, v in enc.items()}, labels.to(device)


def evaluate(model, tok, rows: list[dict], device: str, batch: int = 16) -> dict[str, float]:
    model.eval()
    exact = 0
    identity_total = 0
    identity_rewritten = 0
    with torch.no_grad():
        for i in range(0, len(rows), batch):
            chunk = rows[i : i + batch]
            enc, _ = make_batch(tok, chunk, device)
            pred = model(**enc).logits.argmax(-1)
            for j, r in enumerate(chunk):
                labels = pred[j, 1 : 1 + len(r["labels"])].tolist()
                decoded = apply_labels(r["src"], labels)
                if decoded == r["tgt"]:
                    exact += 1
                if r["tier"] == "identity":
                    identity_total += 1
                    if decoded != r["src"]:
                        identity_rewritten += 1
    return {
        "exact": exact / max(len(rows), 1),
        "false_rewrite": identity_rewritten / max(identity_total, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="google/canine-s")
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--eval-n", type=int, default=400)
    ap.add_argument("--eval-only", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="checkpoints/canine-tagger")
    args = ap.parse_args()

    from transformers import AutoTokenizer, CanineForTokenClassification

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = pick_device()

    source = args.out if args.eval_only else args.model
    tok = AutoTokenizer.from_pretrained(source)
    model = CanineForTokenClassification.from_pretrained(source, num_labels=NUM_CLASSES).to(device)

    rows = load_examples(args.data)
    random.shuffle(rows)
    val, train = rows[: args.eval_n], rows[args.eval_n :]
    print(f"{len(train)} train / {len(val)} val on {device}")

    if not args.eval_only:
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
        loss_fn = torch.nn.CrossEntropyLoss(ignore_index=IGNORE)
        model.train()
        for step in range(1, args.steps + 1):
            chunk = random.sample(train, min(args.batch, len(train)))
            enc, labels = make_batch(tok, chunk, device)
            logits = model(**enc).logits
            loss = loss_fn(logits.reshape(-1, NUM_CLASSES), labels.reshape(-1))
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
