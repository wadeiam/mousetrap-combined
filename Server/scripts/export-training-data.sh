#!/bin/bash
#
# export-training-data.sh
#
# Package stored motion-event images as a tarball for Colab training.
# Outputs a tar.gz with:
#   - images/{classification}/{id}.jpg (images grouped by class)
#   - labels.csv (id, classification, confidence, corrected_class, device_id)
#
# Usage:
#   ./export-training-data.sh [output.tar.gz]
#   ./export-training-data.sh --min-confidence 0.8 mytraining.tar.gz
#   ./export-training-data.sh --corrected-only corrected.tar.gz
#
# Requires: psql, tar. Reads DB connection from Server/.env or env vars.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_ROOT="${IMAGE_STORAGE_ROOT:-$SERVER_DIR/image_storage}"

# Load DB config from .env if present
if [ -f "$SERVER_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVER_DIR/.env"
  set +a
fi

DB_NAME="${DB_NAME:-mousetrap}"
DB_USER="${DB_USER:-$USER}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Parse args
MIN_CONFIDENCE="0.5"
CORRECTED_ONLY=0
LABELED_ONLY=0
OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --min-confidence)
      MIN_CONFIDENCE="$2"
      shift 2
      ;;
    --corrected-only)
      CORRECTED_ONLY=1
      shift
      ;;
    --labeled-only)
      # Active-learning mode: only rows with an effective training label
      # (human correction OR auto_label); that label is used as the class.
      LABELED_ONLY=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      OUTPUT="$1"
      shift
      ;;
  esac
done

OUTPUT="${OUTPUT:-training-data-$(date +%Y%m%d-%H%M%S).tar.gz}"

# Build SQL filter
WHERE_CLAUSE="image_path IS NOT NULL"
if [ "$LABELED_ONLY" = "1" ]; then
  WHERE_CLAUSE="$WHERE_CLAUSE AND (user_corrected_class IS NOT NULL OR auto_label IS NOT NULL)"
elif [ "$CORRECTED_ONLY" = "1" ]; then
  WHERE_CLAUSE="$WHERE_CLAUSE AND user_corrected_class IS NOT NULL"
else
  WHERE_CLAUSE="$WHERE_CLAUSE AND confidence >= $MIN_CONFIDENCE"
fi

# Effective class column: corrected > auto_label > model classification.
# In --labeled-only mode auto_label flows into the corrected_class CSV column so
# the existing grouping logic uses it as the label.
if [ "$LABELED_ONLY" = "1" ]; then
  CORRECTED_EXPR="COALESCE(user_corrected_class, auto_label, '')"
else
  CORRECTED_EXPR="COALESCE(user_corrected_class, '')"
fi

# Staging dir
STAGING=$(mktemp -d)
trap "rm -rf $STAGING" EXIT

echo "Exporting images from $IMAGE_ROOT..."
echo "Filter: $WHERE_CLAUSE"
echo "Output: $OUTPUT"
echo ""

# Export labels CSV
LABELS_FILE="$STAGING/labels.csv"
echo "id,classification,confidence,corrected_class,device_id,classified_at,image_relpath" > "$LABELS_FILE"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -A -F',' -t \
  -c "SELECT id, classification, confidence, $CORRECTED_EXPR, device_id, classified_at, image_path
      FROM image_classifications
      WHERE $WHERE_CLAUSE
      ORDER BY classified_at DESC" >> "$LABELS_FILE"

COUNT=$(($(wc -l < "$LABELS_FILE") - 1))
echo "Found $COUNT classifications matching filter"

if [ "$COUNT" -eq 0 ]; then
  echo "Nothing to export. Exiting."
  exit 0
fi

# Copy images grouped by class (use corrected class if available)
echo "Staging images..."
mkdir -p "$STAGING/images"

tail -n +2 "$LABELS_FILE" | while IFS=',' read -r id classification confidence corrected_class device_id classified_at image_relpath; do
  # Strip any quotes
  image_relpath="${image_relpath//\"/}"
  classification="${classification//\"/}"
  corrected_class="${corrected_class//\"/}"

  # Use corrected class if present
  class_label="${corrected_class:-$classification}"

  src="$IMAGE_ROOT/$image_relpath"
  if [ -f "$src" ]; then
    dest_dir="$STAGING/images/$class_label"
    mkdir -p "$dest_dir"
    cp "$src" "$dest_dir/$id.jpg"
  fi
done

# Stats
echo ""
echo "Class counts:"
for dir in "$STAGING/images"/*/; do
  [ -d "$dir" ] || continue
  cls=$(basename "$dir")
  cnt=$(ls -1 "$dir" | wc -l | tr -d ' ')
  echo "  $cls: $cnt"
done

# Create tarball
echo ""
echo "Creating tarball..."
tar -czf "$OUTPUT" -C "$STAGING" images labels.csv

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "Done: $OUTPUT ($SIZE)"
echo ""
echo "Upload to Colab with:"
echo "  from google.colab import files"
echo "  files.upload()  # then select $OUTPUT"
