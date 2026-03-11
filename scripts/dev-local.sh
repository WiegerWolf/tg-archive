#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"
LOCAL_DATA_DIR="${REPO_ROOT}/.local-dev"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.local.example to .env.local first." >&2
  exit 1
fi

mkdir -p "${LOCAL_DATA_DIR}/minio-data" "${LOCAL_DATA_DIR}/telegram-exports"

ACTION="${1:-up}"
WITH_AGENT="false"

if [[ "${ACTION}" == "--with-agent" ]]; then
  ACTION="up"
  WITH_AGENT="true"
elif [[ "${2:-}" == "--with-agent" ]]; then
  WITH_AGENT="true"
fi

COMPOSE_ARGS=(
  --env-file "${ENV_FILE}"
  -f "${REPO_ROOT}/docker-compose.yml"
  -f "${REPO_ROOT}/docker-compose.dev.yml"
)

case "${ACTION}" in
  up)
    SERVICES=(db minio admin admin-web)
    if [[ "${WITH_AGENT}" == "true" ]]; then
      SERVICES+=(agent)
    fi
    docker compose "${COMPOSE_ARGS[@]}" up -d "${SERVICES[@]}"
    ;;
  down)
    docker compose "${COMPOSE_ARGS[@]}" down
    ;;
  ps)
    docker compose "${COMPOSE_ARGS[@]}" ps
    ;;
  logs)
    shift || true
    docker compose "${COMPOSE_ARGS[@]}" logs -f "$@"
    ;;
  config)
    docker compose "${COMPOSE_ARGS[@]}" config
    ;;
  *)
    echo "Usage: $(basename "$0") [up|down|ps|logs|config] [--with-agent]" >&2
    exit 1
    ;;
esac
