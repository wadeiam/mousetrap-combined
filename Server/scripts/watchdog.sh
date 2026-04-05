#!/bin/bash
# MouseTrap Server Watchdog
# Monitors Docker and MQTT broker, restarts if unresponsive

LOG_FILE="/Users/wadehargrove/Documents/MouseTrap/Server/logs/watchdog.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Check Docker
if ! docker info &>/dev/null; then
    log "ERROR: Docker not responding, restarting..."
    pkill -9 -f "Docker Desktop" 2>/dev/null
    pkill -9 -f "com.docker" 2>/dev/null
    sleep 5
    open -a Docker
    sleep 60  # Wait for Docker to start
    log "Docker restarted"
fi

# Check Mosquitto container
if ! docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml ps mosquitto 2>/dev/null | grep -q "Up"; then
    log "ERROR: Mosquitto not running, starting..."
    docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml up -d mosquitto
    log "Mosquitto started"
fi

# Check MQTT broker is accepting connections
if ! timeout 5 bash -c "echo > /dev/tcp/localhost/1883" 2>/dev/null; then
    log "ERROR: MQTT port 1883 not responding, restarting Mosquitto..."
    docker compose -f /Users/wadehargrove/Documents/MouseTrap/Server/docker-compose.yml restart mosquitto
    log "Mosquitto restarted"
fi

# Check Node.js server via HTTP
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null | grep -q "200\|404"; then
    log "ERROR: Node.js server not responding, restarting pm2..."
    pm2 restart mqtt-server
    log "pm2 server restarted"
fi
