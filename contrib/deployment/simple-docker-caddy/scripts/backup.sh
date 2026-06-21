#!/usr/bin/env bash
# Back up the Carbon Swarm stack: a Postgres logical dump + the storage volume.
#
#   ./scripts/backup.sh                # -> ./backups/carbon-<timestamp>/
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# Restore (DB):  gunzip -c db.sql.gz | docker exec -i <pg> psql -U postgres postgres
# Restore (storage): untar into the `<stack>_storage` volume with a helper container.
#
# Run from cron for regular backups, and ship ./backups offsite (S3/Spaces/rclone)
# — a local copy on the same droplet is not a backup. For point-in-time recovery,
# also enable provider volume snapshots of the data volume.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

STACK_NAME="${STACK_NAME:-carbon}"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-./backups}/carbon-${TS}"
mkdir -p "$BACKUP_DIR"

log() { printf '\033[0;36m[backup]\033[0m %s\n' "$*"; }

# ── Postgres logical dump (password read from the in-container secret) ────────
PG_CID="$(docker ps -q -f "name=${STACK_NAME}_postgres" | head -1)"
[ -n "$PG_CID" ] || { echo "postgres task not running"; exit 1; }

log "Dumping database -> db.sql.gz"
docker exec "$PG_CID" sh -c \
	'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump -U postgres -Fp postgres' \
	| gzip >"$BACKUP_DIR/db.sql.gz"

# ── Storage objects (Supabase file backend) ──────────────────────────────────
log "Archiving storage volume -> storage.tar.gz"
docker run --rm \
	-v "${STACK_NAME}_storage:/data:ro" \
	-v "$(cd "$BACKUP_DIR" && pwd):/out" \
	alpine:3 sh -c 'tar czf /out/storage.tar.gz -C /data .'

log "Backup complete: $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
