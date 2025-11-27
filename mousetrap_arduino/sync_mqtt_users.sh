#!/bin/bash
#
# sync_mqtt_users.sh - Sync MQTT users with server device database
#
# This script queries the server for all claimed devices and ensures
# corresponding MQTT users exist in mosquitto.
#
# Usage: ./sync_mqtt_users.sh [server_url]
#

set -e

SERVER_URL="${1:-http://192.168.133.110:3000}"
PASSWD_FILE="/opt/homebrew/etc/mosquitto/passwd"
BACKUP_FILE="${PASSWD_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

echo "🔄 Syncing MQTT users with server devices..."
echo "Server: $SERVER_URL"
echo "Password file: $PASSWD_FILE"
echo ""

# Backup current password file
if [ -f "$PASSWD_FILE" ]; then
    echo "📦 Backing up current password file to: $BACKUP_FILE"
    cp "$PASSWD_FILE" "$BACKUP_FILE"
fi

# Fetch devices from server
echo "📡 Fetching claimed devices from server..."
DEVICES_JSON=$(curl -s "${SERVER_URL}/api/devices" || echo "[]")

if [ "$DEVICES_JSON" = "[]" ] || [ -z "$DEVICES_JSON" ]; then
    echo "⚠️  No devices found or server not accessible"
    exit 1
fi

# Parse device list and create MQTT users
echo "$DEVICES_JSON" | python3 -c "
import sys, json

try:
    devices = json.load(sys.stdin)
    if not isinstance(devices, list):
        devices = devices.get('devices', [])

    print(f'Found {len(devices)} device(s)')

    for device in devices:
        if device.get('claimed'):
            device_id = device.get('id', 'unknown')
            mqtt_username = device.get('mqttUsername', f'device_{device_id[:8]}')
            mqtt_password = device.get('mqttPassword', 'changeme')
            device_name = device.get('name', 'Unnamed')

            print(f'  - {device_name} ({device_id[:8]}...): {mqtt_username}')

            # Output in format: username:password
            print(f'MQTT_USER:{mqtt_username}:{mqtt_password}')
except Exception as e:
    print(f'Error parsing devices: {e}', file=sys.stderr)
    sys.exit(1)
" | while IFS=: read -r prefix username password; do
    if [ "$prefix" = "MQTT_USER" ]; then
        echo "  ➕ Adding/updating user: $username"
        mosquitto_passwd -b "$PASSWD_FILE" "$username" "$password" 2>/dev/null || {
            echo "  ⚠️  Failed to add user: $username"
        }
    fi
done

echo ""
echo "✅ MQTT users synced"
echo ""
echo "Current MQTT users:"
cat "$PASSWD_FILE" | cut -d: -f1 | sed 's/^/  - /'

echo ""
echo "🔄 Reloading mosquitto..."
brew services restart mosquitto

echo ""
echo "✅ Done! Mosquitto restarted with updated credentials"
echo ""
echo "To verify:"
echo "  tail -f /opt/homebrew/var/log/mosquitto.log"
