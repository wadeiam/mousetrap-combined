#!/usr/bin/env bash
#
# deploy_model.sh — Layer 3, step 2: eval-gate then flash a new model.
#
# Refuses to flash a model that regresses on the eval set (recall gate), then
# flashes firmware+model to the Grove and registers it via AT+INFO.
#
# Usage:
#   tools/deploy_model.sh <vela.tflite> <int8.tflite> <eval.yaml> [name] [classes] [port]
#
#   <vela.tflite>  Vela-compiled model to FLASH (NPU)
#   <int8.tflite>  pre-Vela int8 model to EVAL (runs in Python; NPU-equivalent)
#   <eval.yaml>    fixed held-out eval set (from build_eval_set.py)
#
# The eval gate runs in whatever Python env has ultralytics (likely not this
# Mac). If ultralytics is missing it SKIPS the gate with a loud warning rather
# than silently flashing an unvetted model.
set -euo pipefail

VELA="${1:?need vela.tflite}"
INT8="${2:?need int8.tflite}"
EVAL="${3:?need eval.yaml}"
NAME="${4:-rodent v$(date +%Y%m%d)}"
CLASSES="${5:-rodent}"
PORT="${6:-$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FW="$ROOT/grove-vision-ai/firmware/grove_vision_ai_v2_20250102.img"

echo "==> 1/3 eval gate (recall must not regress)"
if python3 -c "import ultralytics" 2>/dev/null; then
  if python3 "$ROOT/ml-training/eval_model.py" --model "$INT8" --data "$EVAL" \
       --name "$NAME" --gate --gate-metric recall; then
    echo "eval gate: PASS"
  else
    echo "eval gate: FAIL — model regresses on recall. NOT flashing."; exit 1
  fi
else
  echo "WARNING: ultralytics not available here — SKIPPING eval gate."
  echo "         Run the gate where the model was trained before trusting this deploy:"
  echo "         python3 ml-training/eval_model.py --model $INT8 --data $EVAL --name '$NAME' --gate"
fi

echo "==> 2/3 flash firmware + model (headless — RTS hardware reset, no button)"
python3 "$ROOT/tools/himax_xmodem_send_rts.py" --port="$PORT" --baudrate=921600 \
  --protocol=xmodem --file="$FW" --model="$VELA 0x400000 0x00000"

echo "==> 3/3 register model metadata (AT+INFO)"
SIZE=$(stat -f%z "$VELA" 2>/dev/null || stat -c%s "$VELA")
python3 "$ROOT/tools/grove_set_info.py" "$NAME" "$CLASSES" "$SIZE" "$PORT"

echo ""
echo "✅ Deployed '$NAME'. Verify live:  python3 tools/grove_invoke.py 30"
