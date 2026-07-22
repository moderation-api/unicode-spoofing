"""Character taggers: the trainable Layer 2.

Every architecture here is a *non-autoregressive byte tagger*: one forward
pass reads the UTF-8 bytes of a message and emits, per byte, what that byte
should become — kept, deleted, or replaced with a printable ASCII character.
Decoding is a table lookup over the argmax, so inference cost is exactly one
encoder pass. This is the property that makes single-digit-millisecond CPU
latency possible at all; a seq2seq model of the same size pays one forward
pass PER OUTPUT BYTE (see benchmark_latency.py --autoregressive for the
measured difference).

The tagging formulation is also the hallucination guard: the model cannot
emit anything that is not anchored to an input byte, so it can mangle a word
at worst — it cannot invent one.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn

# Label space: 0 = KEEP (copy the input byte), 1 = DELETE, 2 + i = emit
# printable ASCII 0x20 + i. 97 classes total.
KEEP = 0
DELETE = 1
EMIT_BASE = 2
NUM_CLASSES = EMIT_BASE + (0x7F - 0x20)

PAD_BYTE = 256  # padding token id in the byte vocabulary
VOCAB = 257


def labels_to_bytes(input_bytes: list[int], labels: list[int]) -> bytes:
    """Apply predicted labels to input bytes — the whole decoder."""
    out = bytearray()
    for b, lab in zip(input_bytes, labels):
        if lab == KEEP:
            out.append(b)
        elif lab == DELETE:
            continue
        else:
            out.append(0x20 + (lab - EMIT_BASE))
    return bytes(out)


class EncoderBlock(nn.Module):
    """Pre-norm transformer block with attention written out long-hand.

    nn.TransformerEncoder's fused fast paths bake static sequence lengths into
    the ONNX graph; plain matmul attention exports with fully dynamic shapes.
    """

    def __init__(self, d_model: int, nhead: int, dim_ff: int) -> None:
        super().__init__()
        self.nhead = nhead
        self.dk = d_model // nhead
        self.norm1 = nn.LayerNorm(d_model)
        self.qkv = nn.Linear(d_model, d_model * 3)
        self.proj = nn.Linear(d_model, d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.ff = nn.Sequential(
            nn.Linear(d_model, dim_ff), nn.GELU(), nn.Linear(dim_ff, d_model)
        )

    def forward(self, h: torch.Tensor, pad: torch.Tensor) -> torch.Tensor:
        B, T, _ = h.shape
        q, k, v = self.qkv(self.norm1(h)).chunk(3, dim=-1)
        q = q.view(B, T, self.nhead, self.dk).transpose(1, 2)
        k = k.view(B, T, self.nhead, self.dk).transpose(1, 2)
        v = v.view(B, T, self.nhead, self.dk).transpose(1, 2)
        scores = q @ k.transpose(-2, -1) / math.sqrt(self.dk)
        scores = scores.masked_fill(pad[:, None, None, :], float("-inf"))
        att = torch.softmax(scores, dim=-1) @ v
        h = h + self.proj(att.transpose(1, 2).reshape(B, T, -1))
        return h + self.ff(self.norm2(h))


class TransformerTagger(nn.Module):
    def __init__(
        self,
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 2,
        dim_ff: int = 256,
        max_len: int = 1024,
    ) -> None:
        super().__init__()
        self.embed = nn.Embedding(VOCAB, d_model, padding_idx=PAD_BYTE)
        self.pos = nn.Embedding(max_len, d_model)
        self.blocks = nn.ModuleList(
            EncoderBlock(d_model, nhead, dim_ff) for _ in range(num_layers)
        )
        self.norm = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, NUM_CLASSES)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # (B, T) -> (B, T, C)
        positions = torch.arange(x.shape[1], device=x.device).unsqueeze(0)
        pad = x == PAD_BYTE
        h = self.embed(x) + self.pos(positions)
        for block in self.blocks:
            h = block(h, pad)
        return self.head(self.norm(h))


class ConvBlock(nn.Module):
    def __init__(self, channels: int, kernel: int, dilation: int) -> None:
        super().__init__()
        pad = (kernel - 1) // 2 * dilation
        self.conv = nn.Conv1d(channels, channels, kernel, padding=pad, dilation=dilation)
        self.norm = nn.LayerNorm(channels)
        self.act = nn.GELU()

    def forward(self, h: torch.Tensor) -> torch.Tensor:  # (B, T, C)
        residual = h
        h = self.conv(h.transpose(1, 2)).transpose(1, 2)
        return self.norm(residual + self.act(h))


class CNNTagger(nn.Module):
    """Dilated convolutions: receptive field grows exponentially with depth,
    which is plenty — deciding whether byte 57 is a leet "3" needs the
    surrounding word, not the whole message."""

    def __init__(self, channels: int = 128, layers: int = 4, kernel: int = 5) -> None:
        super().__init__()
        self.embed = nn.Embedding(VOCAB, channels, padding_idx=PAD_BYTE)
        self.blocks = nn.ModuleList(
            ConvBlock(channels, kernel, dilation=2**i) for i in range(layers)
        )
        self.head = nn.Linear(channels, NUM_CLASSES)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.embed(x)
        for block in self.blocks:
            h = block(h)
        return self.head(h)


class BiGRUTagger(nn.Module):
    def __init__(self, hidden: int = 96, layers: int = 1) -> None:
        super().__init__()
        self.embed = nn.Embedding(VOCAB, hidden, padding_idx=PAD_BYTE)
        self.rnn = nn.GRU(hidden, hidden, num_layers=layers, batch_first=True, bidirectional=True)
        self.head = nn.Linear(hidden * 2, NUM_CLASSES)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h, _ = self.rnn(self.embed(x))
        return self.head(h)


SIZES: dict[str, dict[str, dict]] = {
    "transformer": {
        "tiny": dict(d_model=64, nhead=2, num_layers=2, dim_ff=128),
        "small": dict(d_model=128, nhead=4, num_layers=2, dim_ff=256),
        "base": dict(d_model=192, nhead=6, num_layers=4, dim_ff=384),
    },
    "cnn": {
        "tiny": dict(channels=64, layers=3),
        "small": dict(channels=128, layers=4),
        "base": dict(channels=192, layers=5),
    },
    "gru": {
        "tiny": dict(hidden=64, layers=1),
        "small": dict(hidden=96, layers=1),
        "base": dict(hidden=128, layers=2),
    },
}

ARCHS = {
    "transformer": TransformerTagger,
    "cnn": CNNTagger,
    "gru": BiGRUTagger,
}


def build_model(arch: str, size: str) -> nn.Module:
    return ARCHS[arch](**SIZES[arch][size])


def param_count(model: nn.Module) -> str:
    n = sum(p.numel() for p in model.parameters())
    return f"{n / 1e6:.2f}M" if n >= 1e6 else f"{n / 1e3:.0f}k"
