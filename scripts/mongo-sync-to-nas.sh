#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MONGO_BACKUP_DIR="${MONGO_BACKUP_DIR:-${REPO_ROOT}/backups/mongodb-data}"
MONGO_VOLUME_NAME="${MONGO_VOLUME_NAME:-tg-archive_mongodb_data}"

echo "[mongo-sync-to-nas] Stopping app services..."
docker compose -f "${REPO_ROOT}/docker-compose.yml" stop agent admin db

echo "[mongo-sync-to-nas] Preparing destination: ${MONGO_BACKUP_DIR}"
mkdir -p "${MONGO_BACKUP_DIR}"

echo "[mongo-sync-to-nas] Clearing existing destination contents..."
docker run --rm -v "${MONGO_BACKUP_DIR}:/data" alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* || true'

echo "[mongo-sync-to-nas] Copying volume ${MONGO_VOLUME_NAME} -> ${MONGO_BACKUP_DIR}"
docker run --rm -v "${MONGO_VOLUME_NAME}:/from" -v "${MONGO_BACKUP_DIR}:/to" alpine sh -c 'cp -a /from/. /to/'

echo "[mongo-sync-to-nas] Starting app services..."
docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d db admin agent

echo "[mongo-sync-to-nas] Done."
