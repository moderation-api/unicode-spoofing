"""Measure single-message CPU latency of every candidate architecture.

This exists to answer, with numbers instead of estimates, whether a trained
normalizer fits a ~10 ms preprocessing budget. Weights are random — latency
does not depend on what the weights are, only on the architecture — so the
benchmark needs no training run first.

For each (arch, size): export to ONNX, dynamically quantize to int8, and time
batch-1 inference at several message lengths with a single intra-op thread
(the honest serving configuration: a moderation API burns its cores on
concurrent requests, not on one message).

--autoregressive additionally times the SAME transformer used generatively —
one forward per output byte, the way a seq2seq decoder works — so the tagger
vs seq2seq comparison is apples to apples.

--byt5 times real google/byt5-small generation (needs `transformers`, and
downloads ~1.2 GB on first run).

Usage:
    python benchmark_latency.py --iters 100 --out results.md
"""

from __future__ import annotations

import argparse
import os
import platform
import statistics
import tempfile
import time

import numpy as np
import torch

from export_onnx import export, quantize
from model import ARCHS, SIZES, build_model, param_count

SEQ_LENS = [32, 128, 512]


def make_session(path: str):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    return ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])


def time_session(session, seq_len: int, iters: int) -> tuple[float, float]:
    x = np.random.randint(0, 256, size=(1, seq_len), dtype=np.int64)
    for _ in range(10):  # warmup
        session.run(None, {"bytes": x})
    samples = []
    for _ in range(iters):
        t0 = time.perf_counter()
        session.run(None, {"bytes": x})
        samples.append((time.perf_counter() - t0) * 1000)
    return statistics.median(samples), sorted(samples)[int(len(samples) * 0.95)]


def time_autoregressive(session, seq_len: int, iters: int = 5) -> float:
    """The same model, used the way a seq2seq decoder is: one forward per
    output position. Median total milliseconds to 'generate' seq_len bytes."""
    samples = []
    for _ in range(iters):
        t0 = time.perf_counter()
        for t in range(1, seq_len + 1):
            x = np.random.randint(0, 256, size=(1, t), dtype=np.int64)
            session.run(None, {"bytes": x})
        samples.append((time.perf_counter() - t0) * 1000)
    return statistics.median(samples)


def bench_canine(iters: int = 15) -> list[str]:
    """Single-pass CANINE-S latency, fp32 and int8-dynamic, at SEQ_LENS
    characters. Run this on the machine you plan to SERVE on — the numbers
    in the README are from a 4-core sandbox container and only set the
    order of magnitude."""
    from transformers import AutoTokenizer, CanineForTokenClassification

    name = "google/canine-s"
    tok = AutoTokenizer.from_pretrained(name)
    model = CanineForTokenClassification.from_pretrained(name, num_labels=2)
    model.eval()
    torch.set_num_threads(1)
    quantized = torch.ao.quantization.quantize_dynamic(
        model, {torch.nn.Linear}, dtype=torch.qint8
    )
    lines = []
    for precision, m in [("fp32", model), ("int8", quantized)]:
        for seq_len in SEQ_LENS:
            enc = tok("a" * seq_len, return_tensors="pt")
            with torch.no_grad():
                m(**enc)  # warmup
                samples = []
                for _ in range(iters):
                    t0 = time.perf_counter()
                    m(**enc)
                    samples.append((time.perf_counter() - t0) * 1000)
            p50 = statistics.median(samples)
            p95 = sorted(samples)[int(len(samples) * 0.95)]
            lines.append(
                f"| canine-s (single pass) | 132M | {precision} | {seq_len} | "
                f"{p50:.0f} | {p95:.0f} |"
            )
    return lines


def bench_byt5(iters: int = 3) -> list[str]:
    from transformers import AutoTokenizer, T5ForConditionalGeneration

    name = "google/byt5-small"
    tok = AutoTokenizer.from_pretrained(name)
    model = T5ForConditionalGeneration.from_pretrained(name)
    model.eval()
    torch.set_num_threads(1)
    text = "g3t fr€€ crýpt0 n0w l1mited t1me 0ffer"
    lines = []
    with torch.no_grad():
        inputs = tok(text, return_tensors="pt")
        # warmup
        model.generate(**inputs, max_new_tokens=8)
        samples = []
        for _ in range(iters):
            t0 = time.perf_counter()
            out = model.generate(**inputs, max_new_tokens=48)
            samples.append((time.perf_counter() - t0) * 1000)
        decoded = tok.decode(out[0], skip_special_tokens=True)
        lines.append(
            f"| byt5-small (real, generate 48 tokens) | 300M | fp32 | ~40 in | "
            f"{statistics.median(samples):.0f} | — |"
        )
        lines.append(f"<!-- byt5 output: {decoded!r} -->")
    return lines


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=100)
    ap.add_argument("--autoregressive", action="store_true")
    ap.add_argument("--byt5", action="store_true")
    ap.add_argument("--canine", action="store_true")
    ap.add_argument("--skip-sweep", action="store_true", help="only the --canine/--byt5 extras")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    torch.set_num_threads(1)
    lines = [
        f"CPU: {platform.processor() or platform.machine()}, "
        f"{os.cpu_count()} cores, single-thread inference, batch 1",
        "",
        "| model | params | precision | seq len | p50 ms | p95 ms |",
        "|---|---|---|---|---|---|",
    ]

    for arch in [] if args.skip_sweep else ARCHS:
        for size in SIZES[arch]:
            model = build_model(arch, size)
            params = param_count(model)
            with tempfile.TemporaryDirectory() as tmp:
                fp32_path = os.path.join(tmp, "m.onnx")
                export(model, fp32_path)
                int8_path = os.path.join(tmp, "m.int8.onnx")
                quantize(fp32_path, int8_path)
                for precision, path in [("fp32", fp32_path), ("int8", int8_path)]:
                    session = make_session(path)
                    for seq_len in SEQ_LENS:
                        p50, p95 = time_session(session, seq_len, args.iters)
                        lines.append(
                            f"| {arch}-{size} | {params} | {precision} | "
                            f"{seq_len} | {p50:.2f} | {p95:.2f} |"
                        )
                if args.autoregressive and arch == "transformer":
                    session = make_session(int8_path)
                    for seq_len in [32, 128]:
                        total = time_autoregressive(session, seq_len)
                        lines.append(
                            f"| {arch}-{size} AS SEQ2SEQ (1 pass/byte) | {params} | int8 | "
                            f"{seq_len} | {total:.1f} | — |"
                        )
            print("\n".join(lines[-8:]))

    if args.canine:
        lines.extend(bench_canine())

    if args.byt5:
        lines.extend(bench_byt5())

    report = "\n".join(lines) + "\n"
    print(report)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(report)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
