#!/usr/bin/env python3
"""Layer 1 — regression eval harness for the rodent detector.

Scores a model against a FIXED held-out eval set and records the result to a
metrics history, then applies a promotion gate (new model must not regress on
recall vs. the current best). Run this on every candidate model before flashing.

IMPORTANT — which model to evaluate:
  The Vela-compiled `*_int8_vela.tflite` contains the Ethos-U custom op and can
  ONLY run on the NPU — it will NOT run here. Evaluate the **pre-Vela int8
  TFLite** (`*_full_integer_quant.tflite`) instead: it is numerically identical
  to what the NPU executes (Vela only re-schedules the same int8 ops for the
  hardware). The float `.pt` is also accepted as an architecture-level check.

Usage:
  python3 eval_model.py --model best.pt            --data eval.yaml --name v1-fp32
  python3 eval_model.py --model rodent_v1_int8.tflite --data eval.yaml --name v1-int8
  # promotion gate (exit 1 if it regresses):
  python3 eval_model.py --model cand_int8.tflite --data eval.yaml --name v2-int8 --gate

Recall is the gate metric on purpose: for an alerting product a missed rodent is
the costly error; precision is recoverable by the server-side verifier.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HISTORY = Path(__file__).parent / "metrics_history.json"


def load_history():
    if HISTORY.exists():
        return json.loads(HISTORY.read_text())
    return []


def save_history(hist):
    HISTORY.write_text(json.dumps(hist, indent=2))


def evaluate(model_path, data_yaml, imgsz):
    from ultralytics import YOLO

    model = YOLO(model_path)
    res = model.val(data=data_yaml, imgsz=imgsz, verbose=False)
    box = res.box
    # per-class AP50 keyed by class name
    per_class = {}
    try:
        names = res.names if hasattr(res, "names") else model.names
        for i, ap in zip(box.ap_class_index, box.ap50):
            per_class[str(names[int(i)])] = round(float(ap), 4)
    except Exception:
        pass
    return {
        "map50": round(float(box.map50), 4),
        "map50_95": round(float(box.map), 4),
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "per_class_ap50": per_class,
    }


def best_so_far(hist, gate_metric):
    vals = [h["metrics"].get(gate_metric, 0.0) for h in hist if h.get("metrics")]
    return max(vals) if vals else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help=".pt or *_int8.tflite (NOT the vela one)")
    ap.add_argument("--data", required=True, help="eval dataset YAML")
    ap.add_argument("--name", required=True, help="label for this run, e.g. v2-int8")
    ap.add_argument("--imgsz", type=int, default=192)
    ap.add_argument("--gate-metric", default="recall", choices=["recall", "map50", "map50_95", "precision"])
    ap.add_argument("--gate", action="store_true", help="exit 1 if metric regresses vs best")
    ap.add_argument("--gate-tolerance", type=float, default=0.0,
                    help="allowed drop vs best before failing the gate (e.g. 0.01)")
    ap.add_argument("--timestamp", default=None, help="ISO time to stamp (else now)")
    args = ap.parse_args()

    if "vela" in Path(args.model).name.lower():
        print("WARNING: this looks like a Vela model (NPU-only). It will likely fail to "
              "run here. Evaluate the *_full_integer_quant.tflite instead.", file=sys.stderr)

    hist = load_history()
    prior_best = best_so_far(hist, args.gate_metric)

    metrics = evaluate(args.model, args.data, args.imgsz)
    record = {
        "name": args.name,
        "model": Path(args.model).name,
        "data": Path(args.data).name,
        "imgsz": args.imgsz,
        "timestamp": args.timestamp or datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }
    hist.append(record)
    save_history(hist)

    print(json.dumps(metrics, indent=2))
    print(f"\nrecorded '{args.name}' to {HISTORY.name}")

    gv = metrics[args.gate_metric]
    if prior_best is None:
        print(f"gate: no prior baseline — '{args.gate_metric}'={gv:.4f} becomes the baseline.")
        return
    delta = gv - prior_best
    verdict = "PROMOTE" if delta >= -args.gate_tolerance else "REJECT"
    print(f"gate: {args.gate_metric} {gv:.4f} vs best {prior_best:.4f} "
          f"(Δ{delta:+.4f}, tol {args.gate_tolerance}) -> {verdict}")
    if args.gate and verdict == "REJECT":
        sys.exit(1)


if __name__ == "__main__":
    main()
