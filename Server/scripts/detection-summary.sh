#!/bin/bash
#
# detection-summary.sh
#
# Quick at-a-glance summary of edge classifier + server classifier performance.
# Shows: per-model event counts, edge/server agreement matrix, recent events.
#
# Usage:
#   ./detection-summary.sh [hours]
#   ./detection-summary.sh 24        # last 24 hours
#   ./detection-summary.sh 1         # last hour (default)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SERVER_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVER_DIR/.env"
  set +a
fi

DB_NAME="${DB_NAME:-mousetrap_monitor}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

HOURS="${1:-1}"

PSQL="$(command -v psql 2>/dev/null || true)"
if [ -z "$PSQL" ] || [ ! -x "$PSQL" ]; then
  for candidate in \
    /opt/homebrew/Cellar/postgresql@15/15.14_1/bin/psql \
    /opt/homebrew/opt/postgresql@15/bin/psql \
    /usr/local/bin/psql; do
    if [ -x "$candidate" ]; then
      PSQL="$candidate"
      break
    fi
  done
fi
if [ -z "$PSQL" ] || [ ! -x "$PSQL" ]; then
  echo "Error: psql not found" >&2
  exit 1
fi

Q() {
  PGPASSWORD="$DB_PASSWORD" "$PSQL" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

echo "=== Detection summary (last ${HOURS}h) ==="
echo ""

echo "--- Classifier usage ---"
Q "
SELECT
  model_version,
  COUNT(*) AS events,
  ROUND((AVG(confidence) * 100)::numeric, 1) AS avg_conf_pct,
  ROUND((AVG(inference_time_ms))::numeric, 0) AS avg_ms
FROM image_classifications
WHERE classified_at > NOW() - INTERVAL '${HOURS} hours'
GROUP BY model_version
ORDER BY events DESC;
"

echo ""
echo "--- Edge verdict distribution ---"
Q "
SELECT
  COALESCE(edge_verdict, '(none)') AS verdict,
  COUNT(*) AS events,
  ROUND((AVG(edge_confidence) * 100)::numeric, 1) AS avg_conf_pct
FROM image_classifications
WHERE classified_at > NOW() - INTERVAL '${HOURS} hours'
GROUP BY edge_verdict
ORDER BY events DESC;
"

echo ""
echo "--- Edge vs Server agreement (only when server also ran) ---"
Q "
SELECT
  edge_verdict,
  classification AS server_verdict,
  COUNT(*) AS count
FROM image_classifications
WHERE edge_verdict IS NOT NULL
  AND edge_verdict != 'rodent'
  AND edge_verdict != 'person_or_pet'
  AND edge_verdict != 'other'
  AND model_version = 'mobilenet-docker-v1'
  AND classified_at > NOW() - INTERVAL '${HOURS} hours'
GROUP BY edge_verdict, classification
ORDER BY count DESC;
"

echo ""
echo "--- Last 10 events ---"
Q "
SELECT
  LEFT(ic.id::text, 8) AS id,
  d.name AS device,
  ic.classification AS server_cls,
  ROUND(ic.confidence::numeric, 2) AS svr_conf,
  COALESCE(ic.edge_verdict, '') AS edge_v,
  ROUND(COALESCE(ic.edge_confidence, 0)::numeric, 2) AS edge_c,
  ic.model_version,
  to_char(ic.classified_at, 'HH24:MI:SS') AS time
FROM image_classifications ic
LEFT JOIN devices d ON d.id = ic.device_id
WHERE ic.classified_at > NOW() - INTERVAL '${HOURS} hours'
ORDER BY ic.classified_at DESC
LIMIT 10;
"

echo ""
echo "--- Storage footprint ---"
if [ -d "${IMAGE_STORAGE_ROOT:-$SERVER_DIR/image_storage}" ]; then
  STORAGE_ROOT="${IMAGE_STORAGE_ROOT:-$SERVER_DIR/image_storage}"
  IMG_COUNT=$(find "$STORAGE_ROOT" -type f -name "*.jpg" 2>/dev/null | wc -l | tr -d ' ')
  IMG_SIZE=$(du -sh "$STORAGE_ROOT" 2>/dev/null | cut -f1)
  echo "  Location: $STORAGE_ROOT"
  echo "  Images:   $IMG_COUNT files"
  echo "  Size:     $IMG_SIZE"
fi
