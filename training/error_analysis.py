"""Where does a trained tagger struggle? Decode and show, don't guess.

Two modes, both against a saved checkpoint:

  --data data/train.jsonl   held-out slice of generated data: prints every
                            miss, bucketed by tier, plus per-tier rates.
  --probe                   a hand-written battery of out-of-distribution
                            inputs: unseen sentences, unseen devices, casing,
                            and number-preservation traps. Prints src → out
                            so the failure modes are visible, not summarized.

Usage:
    python error_analysis.py --checkpoint checkpoints/cnn-small.pt --probe
    python error_analysis.py --checkpoint checkpoints/cnn-small.pt \
        --data data/train.jsonl --limit 2000
"""

from __future__ import annotations

import argparse
import json
import random

import torch

from model import build_model, labels_to_bytes

PROBES: list[tuple[str, str]] = [
    # (category, input) — expected output is the obvious clean reading.
    ("unseen clean + numbers", "invoice 4055 is due in 30 days"),
    ("unseen clean + numbers", "wait 45s more and call 0800 455 455"),
    ("unseen clean + numbers", "the iphone15 costs 999 dollars"),
    ("unseen clean + numbers", "room 505 was rebooked to room 404"),
    ("in-corpus clean", "room 505 is on the fifth floor"),
    ("unseen words, in-table leet", "the m4rketing c4mpaign is l1ve"),
    ("unseen words, in-table leet", "un1corn startup raises funding"),
    ("unseen words, lookalikes", "the еlеphant in the room"),
    ("seen words, in-table leet", "fr33 m0ney and ch3ap crypt0"),
    ("seen words, separators", "f r e e m o n e y now"),
    ("seen words, mixed", "b-u-y ch34p v14gr4 t0day"),
    ("UNSEEN DEVICE: em dash", "f—r—e—e money"),
    ("UNSEEN DEVICE: slash", "f/r/e/e money"),
    ("UNSEEN DEVICE: zalgo marks", "f̸r̸e̸e̸ money"),
    ("UNSEEN DEVICE: chunk split", "gar b age day is monday"),
    ("UNSEEN DEVICE: uppercase", "FR33 CRYPTO NOW"),
    ("UNSEEN DEVICE: title case", "Get Fr33 Crypto Now"),
    ("UNSEEN DEVICE: ph digraph", "phree stuff today"),
]


def decode(model: torch.nn.Module, text: str) -> str:
    data = list(text.encode("utf-8"))
    x = torch.tensor([data], dtype=torch.long)
    with torch.no_grad():
        labels = model(x).argmax(-1)[0].tolist()
    return labels_to_bytes(data, labels).decode("utf-8", errors="replace")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--data", default=None)
    ap.add_argument("--limit", type=int, default=2000)
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model = build_model(ckpt["arch"], ckpt["size"])
    model.load_state_dict(ckpt["state"])
    model.eval()

    if args.probe:
        print("=== out-of-distribution probes ===")
        width = max(len(c) for c, _ in PROBES)
        for category, text in PROBES:
            out = decode(model, text)
            print(f"{category:<{width}}  {text!r}")
            print(f"{'':<{width}}  → {out!r}")
        print()

    if args.data is not None:
        rows = [json.loads(line) for line in open(args.data, encoding="utf-8")]
        # The train script shuffles with its own seed; a fixed slice from the
        # END of a differently-seeded shuffle approximates held-out data well
        # enough for error ANALYSIS (not for reporting a headline metric).
        random.seed(args.seed)
        random.shuffle(rows)
        rows = rows[: args.limit]

        totals: dict[str, list[int]] = {}
        misses: list[tuple[str, str, str, str]] = []
        for row in rows:
            out = decode(model, row["src"])
            tier = row.get("tier", "?")
            ok = out == row["tgt"]
            totals.setdefault(tier, [0, 0])
            totals[tier][0] += int(ok)
            totals[tier][1] += 1
            if not ok:
                misses.append((tier, row["src"], row["tgt"], out))

        print("=== exact-match by tier ===")
        for tier, (ok, n) in sorted(totals.items()):
            print(f"{tier:>9}: {ok}/{n} = {ok / n:.3f}")

        print(f"\n=== misses ({len(misses)} of {len(rows)}) — first 25 ===")
        for tier, src, tgt, out in misses[:25]:
            print(f"[{tier}] src: {src!r}")
            print(f"{'':>9} tgt: {tgt!r}")
            print(f"{'':>9} out: {out!r}")


if __name__ == "__main__":
    main()
