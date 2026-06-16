#!/usr/bin/env bash
# VM startup script (runs on boot via startup-script-url). Installs deps, runs
# the training, streams artifacts to GCS, then STOPS the VM (not delete) so it's
# available for troubleshooting. Guarded so a manual restart does NOT retrain.
set -uxo pipefail
exec > /var/log/rodent-train.log 2>&1

# Guard: only train once. A restart for troubleshooting skips straight to idle.
if [ -f /opt/rodent_trained ]; then
  echo "already trained on this disk — staying up idle for troubleshooting"
  exit 0
fi

# Read config from instance metadata
META="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
export BUCKET=$(curl -s -H "Metadata-Flavor: Google" "$META/bucket")
export RUN_ID=$(curl -s -H "Metadata-Flavor: Google" "$META/run-id")
export VALIDATION_MODE=$(curl -s -H "Metadata-Flavor: Google" "$META/validation-mode" || echo "")

# OpenCV (used by ultralytics/megadetector) needs libGL + libglib at the system
# level; headless DLVM images don't ship them.
apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 || true

# Deep Learning VM ships CUDA + torch; add our extras.
# Upgrade pip first (old pip's resolver throws AssertionError on big dep graphs
# like megadetector's), then install in stages to keep the resolver simple.
python3 -m pip install -q -U pip
python3 -m pip install -q ultralytics ethos-u-vela ijson
python3 -m pip install -q pycocotools
python3 -m pip install -q megadetector
python3 -m pip install -q "protobuf>=5.28.0"   # restore after megadetector pins it down
# Verify the critical imports before training; fail loudly to GCS if missing.
python3 - <<'PYCHK' || { echo "DEP CHECK FAILED"; gsutil cp /var/log/rodent-train.log "gs://$BUCKET/runs/$RUN_ID/startup.log"; }
import importlib
for m in ("ultralytics","pycocotools","ijson","megadetector"):
    importlib.import_module(m); print("ok", m)
PYCHK

# Fetch the trainer and run it
gsutil cp "gs://$BUCKET/code/train_rodent.py" /opt/train_rodent.py
python3 /opt/train_rodent.py
STATUS=$?
echo "training exited with $STATUS"
gsutil cp /var/log/rodent-train.log "gs://$BUCKET/runs/$RUN_ID/startup.log" || true

touch /opt/rodent_trained   # mark done so a restart won't retrain

# STOP (not delete) this VM: GPU billing ends, disk + VM persist for inspection.
NAME=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/name")
ZONE=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/zone" | awk -F/ '{print $NF}')
gcloud compute instances stop "$NAME" --zone "$ZONE" --quiet
