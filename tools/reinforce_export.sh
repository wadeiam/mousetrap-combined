#!/usr/bin/env bash
#
# reinforce_export.sh — Layer 3, step 1: accumulate + export training data.
#
# Runs the server-side reinforce loop up to the point a human/GPU is needed:
#   1. Run an auto-label pass (teacher pseudo-labels + hard-negative mining).
#   2. Check how much NEW labeled data exists since the last training batch.
#   3. If >= threshold, export a labeled tarball, tag the batch, and print the
#      (manual) retrain handoff.
#
# Colab can't be triggered headlessly, so retrain itself stays manual unless you
# move it to a GPU VM/Vertex. Everything up to that is automated here; safe to
# run on a cron/loop.
#
# Usage:
#   tools/reinforce_export.sh [--threshold 500] [--api http://localhost:4000] [--token <JWT>]
#
# Env: ADMIN_TOKEN (JWT for an admin/superadmin) if --token not given.
set -euo pipefail

THRESHOLD=500
API="${MT_API:-http://localhost:4000}"
TOKEN="${ADMIN_TOKEN:-}"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Server" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --threshold) THRESHOLD="$2"; shift 2;;
    --api) API="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 1;;
  esac
done

if [ -z "$TOKEN" ]; then
  echo "ERROR: need an admin JWT (--token or ADMIN_TOKEN env)."; exit 1
fi
auth=(-H "Authorization: Bearer $TOKEN")

echo "==> 1/4 auto-label pass"
curl -fsS "${auth[@]}" -X POST "$API/api/active-learning/run-pass" \
  -H 'Content-Type: application/json' -d '{}' | tee /tmp/reinforce_pass.json; echo

echo "==> 2/4 dataset readiness"
stats=$(curl -fsS "${auth[@]}" "$API/api/active-learning/stats")
echo "$stats"
new=$(echo "$stats" | python3 -c "import sys,json; print(json.load(sys.stdin)['stats']['newSinceLastBatch'])")
echo "new labeled since last batch: $new (threshold $THRESHOLD)"

if [ "$new" -lt "$THRESHOLD" ]; then
  echo "Below threshold — nothing to export yet. Done."
  exit 0
fi

echo "==> 3/4 export labeled tarball"
BATCH="batch-$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/${BATCH}.tar.gz"
"$SERVER_DIR/scripts/export-training-data.sh" --labeled-only "$OUT"

echo "==> 4/4 tag training batch ($BATCH)"
curl -fsS "${auth[@]}" -X POST "$API/api/active-learning/batch" \
  -H 'Content-Type: application/json' -d "{\"batchId\":\"$BATCH\"}" | tee /tmp/reinforce_batch.json; echo

cat <<EOF

✅ Export ready: $OUT  (batch $BATCH)

NEXT (retrain — manual, Colab can't be triggered headlessly):
  1. Upload $OUT to the training notebook (or a GPU VM) and retrain.
     - Mix this real-world data with the base camera-trap datasets; do NOT train
       on it alone (keep the model GENERAL — the product must work anywhere).
  2. Download best.pt + rodent_v1_int8.tflite + rodent_v1_int8_vela.tflite.
  3. Gate + deploy:  tools/deploy_model.sh <vela.tflite> <int8.tflite> <eval.yaml>
EOF
