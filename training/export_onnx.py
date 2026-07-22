"""Export a trained tagger to ONNX, with optional int8 dynamic quantization.

Usage:
    python export_onnx.py --checkpoint checkpoints/cnn-small.pt \
        --out cnn-small.onnx --quantize
"""

from __future__ import annotations

import argparse

import torch

from model import build_model


def export(model: torch.nn.Module, path: str, seq_len: int = 128) -> None:
    model.eval()
    dummy = torch.randint(0, 256, (1, seq_len), dtype=torch.long)
    torch.onnx.export(
        model,
        (dummy,),
        path,
        input_names=["bytes"],
        output_names=["logits"],
        dynamic_axes={"bytes": {0: "batch", 1: "time"}, "logits": {0: "batch", 1: "time"}},
        opset_version=17,
        # The dynamo exporter traces the positional-embedding arange as a
        # static length; the TorchScript exporter handles the dynamic time
        # axis correctly.
        dynamo=False,
    )


def quantize(src: str, dst: str) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(src, dst, weight_type=QuantType.QInt8)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--quantize", action="store_true")
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model = build_model(ckpt["arch"], ckpt["size"])
    model.load_state_dict(ckpt["state"])

    export(model, args.out)
    print(f"exported {args.out}")
    if args.quantize:
        q = args.out.replace(".onnx", ".int8.onnx")
        quantize(args.out, q)
        print(f"quantized {q}")


if __name__ == "__main__":
    main()
