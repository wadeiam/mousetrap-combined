#!/usr/bin/env bash
# Launch a cost-capped GPU VM that trains the rodent detector unattended and
# self-STOPS when done. Artifacts land in gs://$BUCKET/runs/$RUN_ID/.
#
# Usage: gcp-training/launch.sh [run_id] [validation]
#   run_id      label for this run (default: vYYYYmmdd-HHMM passed in)
#   validation  pass "1" for a quick smoke run
set -euo pipefail

PROJECT=mousetrapv1
BUCKET=mousetrapv1-rodent-training
# All in us-central1 (where our regional T4 quota lives); try zones until one
# has T4 capacity (stockouts are common and transient).
ZONES=(us-central1-a us-central1-b us-central1-c us-central1-f)
RUN_ID="${1:?pass a run id, e.g. v2}"
VALID="${2:-}"
NAME="rodent-train-${RUN_ID}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> uploading code to gs://$BUCKET/code/"
gsutil -q cp "$HERE/train_rodent.py" "gs://$BUCKET/code/train_rodent.py"
gsutil -q cp "$HERE/startup.sh"      "gs://$BUCKET/code/startup.sh"

# Try GPU configs in order: T4 (cheapest) then L4 (newer, often more available).
# "config" = "machine-type|accelerator-flag" (empty accel = g2 bundles the L4).
CONFIGS=(
  "n1-standard-8|--accelerator=type=nvidia-tesla-t4,count=1"
  "g2-standard-8|"
)
ZONE=""
for cfg in "${CONFIGS[@]}"; do
  MT="${cfg%%|*}"; ACC="${cfg#*|}"
  for z in "${ZONES[@]}"; do
    echo "==> trying $NAME in $z ($MT ${ACC:-+L4}, self-stop, 4h cap)"
    if gcloud compute instances create "$NAME" \
        --project="$PROJECT" --zone="$z" \
        --machine-type="$MT" $ACC \
        --maintenance-policy=TERMINATE \
        --image-family=pytorch-2-9-cu129-ubuntu-2204-nvidia-580 \
        --image-project=deeplearning-platform-release \
        --boot-disk-size=120GB --boot-disk-type=pd-balanced \
        --scopes=cloud-platform \
        --max-run-duration=14400s \
        --instance-termination-action=STOP \
        --metadata=startup-script-url="gs://$BUCKET/code/startup.sh",bucket="$BUCKET",run-id="$RUN_ID",validation-mode="$VALID" 2>&1; then
      ZONE="$z"; break 2
    fi
    echo "   $z/$MT unavailable, trying next..."
  done
done
if [ -z "$ZONE" ]; then
  echo "❌ No T4 or L4 capacity in any us-central1 zone right now. Transient — retry in a bit."
  exit 1
fi

cat <<EOF

✅ Launched $NAME. It will train, write to gs://$BUCKET/runs/$RUN_ID/, then STOP itself.

Watch progress:   gsutil cat gs://$BUCKET/runs/$RUN_ID/train.log | tail -30
List artifacts:   gsutil ls gs://$BUCKET/runs/$RUN_ID/
VM status:        gcloud compute instances describe $NAME --zone $ZONE --format='value(status)'

KILL SWITCH (stop now):    gcloud compute instances stop   $NAME --zone $ZONE
DELETE when fully done:    gcloud compute instances delete $NAME --zone $ZONE
EOF
