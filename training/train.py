"""Train a character tagger on generated (corrupted, clean) pairs.

Usage:
    python train.py --data data/train.jsonl --arch cnn --size small \
        --epochs 4 --out checkpoints/cnn-small.pt

Metrics reported per epoch, on a held-out split:
  byte_acc        per-byte label accuracy (easy to inflate; ignore mostly)
  exact           decoded output == clean target, whole sequence
  false_rewrite   share of IDENTITY examples the model dared to edit.
                  This is the deployment gate: a normalizer that rewrites
                  clean text manufactures moderation false positives, so
                  false_rewrite must sit at (near) zero before exact-match
                  on corrupted text means anything.
"""

from __future__ import annotations

import argparse
import os
import random

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from dataset import IGNORE, TaggingDataset, collate, load_examples
from model import build_model, labels_to_bytes, param_count


def evaluate(model: nn.Module, loader: DataLoader, examples) -> dict[str, float]:
    model.eval()
    correct_bytes = 0
    total_bytes = 0
    exact = 0
    identity_total = 0
    identity_rewritten = 0
    idx = 0
    with torch.no_grad():
        for x, y in loader:
            logits = model(x)
            pred = logits.argmax(-1)
            mask = y != IGNORE
            correct_bytes += int((pred[mask] == y[mask]).sum())
            total_bytes += int(mask.sum())
            for row in range(x.shape[0]):
                e = examples[idx]
                idx += 1
                labels = pred[row][: len(e.src_bytes)].tolist()
                decoded = labels_to_bytes(e.src_bytes, labels).decode("utf-8", errors="replace")
                if decoded == e.tgt:
                    exact += 1
                if e.tier == "identity":
                    identity_total += 1
                    if decoded != e.src:
                        identity_rewritten += 1
    return {
        "byte_acc": correct_bytes / max(total_bytes, 1),
        "exact": exact / max(idx, 1),
        "false_rewrite": identity_rewritten / max(identity_total, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--arch", default="cnn", choices=["transformer", "cnn", "gru"])
    ap.add_argument("--size", default="small", choices=["tiny", "small", "base"])
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)

    examples = load_examples(args.data)
    random.shuffle(examples)
    n_val = max(1, int(len(examples) * args.val_frac))
    val, train = examples[:n_val], examples[n_val:]
    print(f"{len(train)} train / {len(val)} val examples")

    model = build_model(args.arch, args.size)
    print(f"{args.arch}-{args.size}: {param_count(model)} params")

    train_loader = DataLoader(
        TaggingDataset(train), batch_size=args.batch, shuffle=True, collate_fn=collate
    )
    val_loader = DataLoader(
        TaggingDataset(val), batch_size=args.batch, shuffle=False, collate_fn=collate
    )

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    loss_fn = nn.CrossEntropyLoss(ignore_index=IGNORE)

    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        steps = 0
        for x, y in train_loader:
            opt.zero_grad()
            logits = model(x)
            loss = loss_fn(logits.reshape(-1, logits.shape[-1]), y.reshape(-1))
            loss.backward()
            opt.step()
            running += loss.detach().item()
            steps += 1
        metrics = evaluate(model, val_loader, val)
        print(
            f"epoch {epoch}: loss {running / max(steps, 1):.4f} "
            f"byte_acc {metrics['byte_acc']:.4f} exact {metrics['exact']:.4f} "
            f"false_rewrite {metrics['false_rewrite']:.4f}"
        )

    out = args.out or f"checkpoints/{args.arch}-{args.size}.pt"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    torch.save({"arch": args.arch, "size": args.size, "state": model.state_dict()}, out)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
