"""JSONL → padded byte tensors with per-byte labels.

The generator (scripts/generate-training-data.mjs) records, for every
CHARACTER of the corrupted text, the string it should become. Here that is
expanded to per-BYTE labels over the UTF-8 encoding: a character's first byte
carries its outcome (KEEP / DELETE / EMIT c), continuation bytes are DELETE.
No edit-distance alignment ever runs — the alignment was known at generation
time and travels with the data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import torch
from torch.utils.data import Dataset

from model import DELETE, EMIT_BASE, KEEP, PAD_BYTE

IGNORE = -100  # CE ignore_index for padding


@dataclass
class Example:
    src_bytes: list[int]
    labels: list[int]
    tier: str
    src: str
    tgt: str


def char_label(char: str, target: str) -> int | None:
    """Label for a character's first byte. None = unrepresentable example."""
    if target == char:
        return KEEP if len(char.encode("utf-8")) == 1 else None
    if target == "":
        return DELETE
    if len(target) == 1 and 0x20 <= ord(target) < 0x7F:
        return EMIT_BASE + (ord(target) - 0x20)
    return None


def load_examples(path: str, max_bytes: int = 192) -> list[Example]:
    examples: list[Example] = []
    skipped = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            src_bytes: list[int] = []
            labels: list[int] = []
            ok = True
            for char, target in zip(list(row["src"]), row["tags"], strict=True):
                encoded = char.encode("utf-8")
                lab = char_label(char, target)
                if lab is None:
                    ok = False
                    break
                src_bytes.extend(encoded)
                labels.append(lab)
                labels.extend([DELETE] * (len(encoded) - 1))
            if not ok or len(src_bytes) > max_bytes or len(src_bytes) == 0:
                skipped += 1
                continue
            examples.append(Example(src_bytes, labels, row.get("tier", "?"), row["src"], row["tgt"]))
    if skipped:
        print(f"load_examples: skipped {skipped} unrepresentable/overlong rows")
    return examples


class TaggingDataset(Dataset):
    def __init__(self, examples: list[Example]) -> None:
        self.examples = examples

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, i: int) -> Example:
        return self.examples[i]


def collate(batch: list[Example]) -> tuple[torch.Tensor, torch.Tensor]:
    width = max(len(e.src_bytes) for e in batch)
    x = torch.full((len(batch), width), PAD_BYTE, dtype=torch.long)
    y = torch.full((len(batch), width), IGNORE, dtype=torch.long)
    for i, e in enumerate(batch):
        x[i, : len(e.src_bytes)] = torch.tensor(e.src_bytes)
        y[i, : len(e.labels)] = torch.tensor(e.labels)
    return x, y
