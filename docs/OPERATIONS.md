# Operations Guide

This project is typically used in two environments:

- local isolated development on your workstation
- a deployed server environment

Use this guide for everyday operations.

## Current setup

### Production

- repo path: `<repo-path>`
- boot service: `<systemd-service>`
- admin app: `http://<server-host>:3000/login`
- MinIO API: bind locally by default; expose it intentionally if you need remote access
- MinIO console: bind locally by default; expose it intentionally if you need remote access
- Mongo data: Docker volume `tg-archive_mongodb_data`
- MinIO data: `<minio-data-dir>`

If you use a network-mounted or otherwise external storage path for MinIO data, make sure it is available before the application stack starts.

### Local development

- local env file: `.env.local`
- local data dir: `.local-dev/`
- local app: `http://localhost:5173/login`
- local admin API: `http://localhost:3000`
- local MinIO API: `http://localhost:19000`
- local MinIO console: `http://localhost:19001`

Local development uses:

- a separate Compose project name: `tg-archive-local`
- separate local Mongo volumes
- separate MinIO bucket: `tg-archive-local`
- local MinIO storage under `./.local-dev/minio-data`

This keeps local work from touching deployed data.

## Local development workflow

First-time setup:

```bash
cp .env.local.example .env.local
```

Fill in Telegram credentials in `.env.local` if you want to run the agent locally.

Start the normal isolated dev stack:

```bash
./scripts/dev-local.sh up
```

Start the isolated dev stack with the Telegram agent too:

```bash
./scripts/dev-local.sh up --with-agent
```

Useful commands:

```bash
./scripts/dev-local.sh ps
./scripts/dev-local.sh logs admin
./scripts/dev-local.sh logs admin-web
./scripts/dev-local.sh logs agent
./scripts/dev-local.sh down
```

Notes:

- `admin`, `admin-web`, `db`, and `minio` start by default.
- `agent` is opt-in because it can immediately begin syncing Telegram data into the local isolated dataset.
- local login uses the values in `.env.local`, not production secrets.

## Git workflow

Use whatever branching model fits your team. A common flow is to do day-to-day work on feature branches, merge into `main` when ready, and deploy from a clean checkout.

## Deploy to your server

Prerequisites:

- the branch you want to deploy contains the code you want to release
- `git status` is clean
- do not overwrite the server's `.env` file during deploys

Deploy from the local repo:

```bash
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".local-dev" \
  "<repo-path>/" "<server-host>:<repo-path>/"

ssh <server-host> 'cd <repo-path> && docker compose up -d --build admin minio && sudo -n systemctl restart <systemd-service>'
```

Verify the deployment:

```bash
ssh <server-host> 'sudo -n systemctl is-active <systemd-service> && cd <repo-path> && docker compose ps'
curl -s -o /dev/null -w '%{http_code}\n' http://<server-host>:3000/login
curl -s -o /dev/null -w '%{http_code}\n' http://<server-host>:3000/api/dialogs
curl -s -o /dev/null -w '%{http_code}\n' http://<server-host>:9000/minio/health/live
```

Expected results:

- login page returns `200`
- unauthenticated API returns `401`
- MinIO health returns `200`

## Production operations

SSH in:

```bash
ssh <server-host>
```

Check service state:

```bash
sudo systemctl status <systemd-service> --no-pager
sudo journalctl -u <systemd-service> -n 100 --no-pager
```

Check containers:

```bash
cd <repo-path>
docker compose ps
docker compose logs -f admin
docker compose logs -f agent
docker compose logs -f minio
```

Restart production stack:

```bash
sudo systemctl restart <systemd-service>
```

Stop production stack:

```bash
sudo systemctl stop <systemd-service>
```

## Environment and secrets

- production secrets live in `<repo-path>/.env` on your server
- local-only settings live in `.env.local` on your workstation
- do not copy `.env.local` to the server
- do not overwrite the server `.env` during deploys

Admin authentication is controlled with:

- `ADMIN_PASSWORD`
- `ADMIN_COOKIE_SECRET`
- `ADMIN_SESSION_TTL_MS`
- `ADMIN_COOKIE_SECURE`

If you update those values on the server, restart the service:

```bash
ssh <server-host> 'sudo -n systemctl restart <systemd-service>'
```

## Data migration and backup notes

MongoDB helper scripts:

```bash
./scripts/mongo-sync-to-nas.sh
./scripts/mongo-sync-from-nas.sh
```

Defaults:

- Mongo backup dir: `<repo-path>/backups/mongodb-data`
- MinIO data dir: configure with `MINIO_DATA_DIR`

Use the Mongo sync scripts when moving Mongo data between machines. Keep MinIO data on a host path that is appropriate for your deployment.
