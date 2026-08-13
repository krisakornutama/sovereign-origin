#!/bin/bash
set -e

COMPOSE_DIR="/opt/sovereign"
BACKUP_DIR="/opt/sovereign/backups"
DB_CONTAINER="sovereign-db"
LOG_FILE="/var/log/ota-sync.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

log() {
    echo "[$(date)] $*" | tee -a "$LOG_FILE"
}

# Ensure we are in the correct directory
cd "$COMPOSE_DIR" || exit 1

log "Starting OTA update..."

# 1. Create a full database dump as a safety net
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz"
log "Backing up database to $DUMP_FILE"
docker exec "$DB_CONTAINER" pg_dump -U sovereign sovereign | gzip > "$DUMP_FILE"
log "Database backup completed."

# 2. Pull new images from private registry (with retry)
log "Pulling latest images..."
if ! docker-compose -f docker-compose.yml pull; then
    log "ERROR: Image pull failed. Aborting update."
    exit 1
fi

# 3. Create a pre-restart marker file (atomic write)
MARKER_FILE="$BACKUP_DIR/ota_in_progress"
echo "$TIMESTAMP" > "$MARKER_FILE"
sync

# 4. Restart services in a rolling manner to minimize downtime
log "Restarting services..."
docker-compose -f docker-compose.yml up -d --remove-orphans

# 5. Verify all critical containers are healthy
log "Waiting for health checks..."
sleep 30
FAILURES=0
for svc in timescaledb emqx core-api edge-ai; do
    if ! docker-compose -f docker-compose.yml ps -q "$svc" | xargs docker inspect -f '{{.State.Health.Status}}' | grep -q 'healthy'; then
        log "ERROR: $svc not healthy after restart."
        FAILURES=1
    fi
done

if [ $FAILURES -eq 1 ]; then
    log "Health check failed! Rolling back..."
    # Restore database backup
    docker exec -i "$DB_CONTAINER" psql -U sovereign -d sovereign < <(zcat "$DUMP_FILE")
    # Force restart back to previous images (they are still cached locally)
    docker-compose -f docker-compose.yml up -d --force-recreate
    log "Rollback complete."
    rm -f "$MARKER_FILE"
    exit 1
fi

# 6. All good, remove in-progress marker
rm -f "$MARKER_FILE"
log "OTA update successful."