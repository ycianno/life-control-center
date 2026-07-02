#!/bin/sh
set -e

: "${DB_PATH:=/app/data/database.sqlite}"
DATA_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  # Best effort for bind mounts created by Docker/root on first run.
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec gosu node "$@"
fi

exec "$@"
