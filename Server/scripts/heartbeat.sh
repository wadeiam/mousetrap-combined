#!/bin/bash
# Send heartbeat to external monitoring service
# This runs every minute via cron and pings healthchecks.io
# If the ping stops, healthchecks.io sends an alert

HEALTHCHECKS_URL="${HEALTHCHECKS_PING_URL:-}"

if [ -z "$HEALTHCHECKS_URL" ]; then
    echo "HEALTHCHECKS_PING_URL not set"
    exit 1
fi

# Check all critical services before sending heartbeat
FAILURES=""

# Check Docker
if ! docker info &>/dev/null; then
    FAILURES="$FAILURES Docker-down"
fi

# Check Mosquitto
if ! nc -z localhost 1883 2>/dev/null; then
    FAILURES="$FAILURES MQTT-down"
fi

# Check Node server
if ! curl -sf http://localhost:4000/health &>/dev/null; then
    FAILURES="$FAILURES Server-down"
fi

# If any failures, report failure to healthchecks.io
if [ -n "$FAILURES" ]; then
    curl -fsS --retry 3 "$HEALTHCHECKS_URL/fail" --data-raw "Failures:$FAILURES"
    exit 1
fi

# All good - send success ping
curl -fsS --retry 3 "$HEALTHCHECKS_URL"
