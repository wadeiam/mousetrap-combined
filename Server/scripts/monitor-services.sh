#!/bin/bash
# MouseTrap Service Monitor
# Checks Docker, Mosquitto, and Node server - restarts if needed, alerts if down

LOG_FILE="/tmp/mousetrap-monitor.log"
ALERT_COOLDOWN_FILE="/tmp/mousetrap-alert-cooldown"
COOLDOWN_SECONDS=3600  # Only alert once per hour per issue

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

send_alert() {
    local subject="$1"
    local message="$2"

    # Check cooldown
    if [ -f "$ALERT_COOLDOWN_FILE" ]; then
        last_alert=$(cat "$ALERT_COOLDOWN_FILE")
        now=$(date +%s)
        diff=$((now - last_alert))
        if [ $diff -lt $COOLDOWN_SECONDS ]; then
            log "Alert suppressed (cooldown): $subject"
            return
        fi
    fi

    # Send email via the server API (if running) or directly via mail
    if curl -s --connect-timeout 5 http://localhost:4000/health > /dev/null 2>&1; then
        # Server is up, could use API - for now just log
        log "ALERT: $subject - $message"
    fi

    # Also try sending via terminal-notifier if available
    if command -v terminal-notifier &> /dev/null; then
        terminal-notifier -title "MouseTrap Alert" -message "$subject: $message" -sound default
    fi

    # macOS notification via osascript
    osascript -e "display notification \"$message\" with title \"MouseTrap Alert\" subtitle \"$subject\"" 2>/dev/null

    # Update cooldown
    date +%s > "$ALERT_COOLDOWN_FILE"
    log "ALERT SENT: $subject - $message"
}

check_docker() {
    if ! docker info > /dev/null 2>&1; then
        log "Docker not responding..."

        # Check if Docker processes are running but socket is dead (stuck state)
        if pgrep -f "com.docker" > /dev/null 2>&1; then
            log "Docker processes running but socket dead - force killing..."
            pkill -9 -f "Docker Desktop" 2>/dev/null
            pkill -9 -f "com.docker" 2>/dev/null
            sleep 5
        fi

        log "Starting Docker Desktop..."
        open -a "Docker Desktop"

        # Wait up to 90 seconds for Docker to start
        for i in {1..30}; do
            sleep 3
            if docker info > /dev/null 2>&1; then
                log "Docker started successfully after ${i}x3 seconds"
                return 0
            fi
        done

        send_alert "Docker Down" "Docker Desktop failed to start automatically"
        return 1
    fi
    return 0
}

check_mosquitto() {
    local needs_restart=false
    local restart_reason=""

    # Check 1: Container running?
    if ! docker ps | grep -q mousetrap-mosquitto; then
        log "Mosquitto container not running"
        needs_restart=true
        restart_reason="container not running"
    fi

    # Check 2: Container health status (catches "unhealthy" state)
    if [ "$needs_restart" = false ]; then
        health_status=$(docker inspect --format='{{.State.Health.Status}}' mousetrap-mosquitto 2>/dev/null)
        if [ "$health_status" = "unhealthy" ]; then
            log "Mosquitto container unhealthy"
            needs_restart=true
            restart_reason="container unhealthy"
        fi
    fi

    # Check 3: Port accessible?
    if [ "$needs_restart" = false ]; then
        if ! nc -z localhost 1883 2>/dev/null; then
            log "MQTT port 1883 not responding"
            needs_restart=true
            restart_reason="port not responding"
        fi
    fi

    # Check 4: Verify broker responds (even auth rejection means it's alive)
    if [ "$needs_restart" = false ]; then
        # Try to connect - "Connection Refused: not authorised" (exit 5) means broker is alive
        # Use -W for timeout within mosquitto_sub
        test_result=$(docker exec mousetrap-mosquitto mosquitto_sub -h localhost -t 'test' -W 5 -C 1 2>&1)
        exit_code=$?
        # Exit code 5 = auth rejected (broker is alive), 0 = success, 27 = timeout (ok), other = problem
        if [ $exit_code -ne 0 ] && [ $exit_code -ne 5 ] && [ $exit_code -ne 27 ]; then
            log "MQTT broker not responding (exit code $exit_code): $test_result"
            needs_restart=true
            restart_reason="broker not responding"
        fi
    fi

    # Restart if needed
    if [ "$needs_restart" = true ]; then
        log "Restarting Mosquitto ($restart_reason)..."
        docker restart mousetrap-mosquitto 2>/dev/null
        sleep 10

        # Verify restart worked
        if ! docker ps | grep -q mousetrap-mosquitto; then
            send_alert "MQTT Broker Down" "Mosquitto failed to restart: $restart_reason"
            return 1
        fi

        # Verify broker is actually working after restart
        sleep 5
        test_result=$(docker exec mousetrap-mosquitto mosquitto_sub -h localhost -t 'test' -W 5 -C 1 2>&1)
        exit_code=$?
        if [ $exit_code -ne 0 ] && [ $exit_code -ne 5 ] && [ $exit_code -ne 27 ]; then
            send_alert "MQTT Broker Broken" "Mosquitto restarted but still not working (exit $exit_code)"
            return 1
        fi

        log "Mosquitto restarted successfully"
        send_alert "MQTT Broker Restarted" "Mosquitto was $restart_reason - now recovered"
    fi

    return 0
}

check_node_server() {
    if ! curl -s --connect-timeout 5 http://localhost:4000/health > /dev/null 2>&1; then
        log "Node server not responding - attempting restart via pm2..."
        pm2 restart mqtt-server 2>/dev/null
        sleep 10

        if ! curl -s --connect-timeout 5 http://localhost:4000/health > /dev/null 2>&1; then
            send_alert "Server Down" "MouseTrap server failed health check"
            return 1
        fi
        log "Node server restarted successfully"
    fi
    return 0
}

# Main monitoring loop (when run directly)
main() {
    log "Service monitor check started"

    check_docker
    docker_status=$?

    if [ $docker_status -eq 0 ]; then
        check_mosquitto
        mosquitto_status=$?
    fi

    check_node_server
    server_status=$?

    if [ $docker_status -eq 0 ] && [ ${mosquitto_status:-1} -eq 0 ] && [ $server_status -eq 0 ]; then
        log "All services healthy"
    fi
}

main
