#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MONGO_BACKUP_DIR="${MONGO_BACKUP_DIR:-${REPO_ROOT}/backups/mongodb-data}"
MONGO_VOLUME_NAME="${MONGO_VOLUME_NAME:-tg-archive_mongodb_data}"

if [[ ! -d "${MONGO_BACKUP_DIR}" ]]; then
  echo "[mongo-sync-from-nas] Backup directory not found: ${MONGO_BACKUP_DIR}" >&2
  exit 1
fi

echo "[mongo-sync-from-nas] Stopping app services..."
docker compose -f "${REPO_ROOT}/docker-compose.yml" stop agent admin db

echo "[mongo-sync-from-nas] Clearing docker volume ${MONGO_VOLUME_NAME}..."
docker run --rm -v "${MONGO_VOLUME_NAME}:/data" alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* || true'

echo "[mongo-sync-from-nas] Copying ${MONGO_BACKUP_DIR} -> volume ${MONGO_VOLUME_NAME}"
docker run --rm -v "${MONGO_VOLUME_NAME}:/to" -v "${MONGO_BACKUP_DIR}:/from" alpine sh -c 'cp -a /from/. /to/'

echo "[mongo-sync-from-nas] Starting app services..."
docker compose -f "${REPO_ROOT}/docker-compose.yml" up -d db admin agent

echo "[mongo-sync-from-nas] Done."
