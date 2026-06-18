#!/bin/bash
#
# Simple backup script for The Forge.
# Copies the SQLite database to a local backups directory, and optionally
# uploads it to a WebDAV/Nextcloud server if NEXTCLOUD_URL is set.
#
# Configure via environment variables or by editing the defaults below.
#
#   DB_FILE       Path to your Forge database.sqlite
#   BACKUP_DIR    Local directory to keep dated snapshots in
#   KEEP          How many local snapshots to retain (default 14)
#
# Optional offsite upload (WebDAV/Nextcloud):
#   NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASS
#
# Example cron (daily at 03:00):
#   0 3 * * *  /path/to/the-forge/backup.sh

set -euo pipefail

DB_FILE="${DB_FILE:-./data/database.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_NAME="forge-${STAMP}.sqlite"

if [ ! -f "$DB_FILE" ]; then
    echo "Database file not found at $DB_FILE" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# Use SQLite's online backup so we get a consistent copy even while the app runs.
if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/$BACKUP_NAME'"
else
    cp "$DB_FILE" "$BACKUP_DIR/$BACKUP_NAME"
fi
echo "Local snapshot: $BACKUP_DIR/$BACKUP_NAME"

# Prune old local snapshots, keeping the most recent $KEEP.
ls -1t "$BACKUP_DIR"/forge-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

# Optional offsite upload to a WebDAV/Nextcloud server.
if [ -n "${NEXTCLOUD_URL:-}" ]; then
    echo "Uploading to $NEXTCLOUD_URL ..."
    curl -fsS -u "${NEXTCLOUD_USER:-}:${NEXTCLOUD_PASS:-}" \
        -T "$BACKUP_DIR/$BACKUP_NAME" "$NEXTCLOUD_URL/$BACKUP_NAME"
    echo "Offsite upload complete: $BACKUP_NAME"
fi
